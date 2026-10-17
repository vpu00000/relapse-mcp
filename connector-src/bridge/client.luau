return function(context)
local HttpService = context.HttpService
local BridgeURL = context.BridgeURL
local WebSocketAvailable = context.WebSocketAvailable
local GetRegistrationInfo = context.GetRegistrationInfo
local SanitizeForOutput = context.SanitizeForOutput
local LuaEncode = context.LuaEncode
local WebSocketConnectTimeout = 5
local WebSocketRegisterTimeout = 5
local WebSocketPingInterval = 5
local WebSocketStaleTimeout = 20
local WebSocketShortSessionSeconds = 30
local WebSocketMaxFailures = 3
local WebSocketRetryAfterSeconds = 300
local HttpMaxPollFailures = 5
local TransportState = { webSocketFailures = 0, httpOnlyUntil = 0 }

--// Base Bridge Class \\--
local BaseBridge = {}; do
    BaseBridge.__index = BaseBridge
    
    function BaseBridge:BindToType(type, callback)
        self.Callbacks[type] = callback
    end

    function BaseBridge:BindToTypeRaw(type, callback)
        self.Callbacks[type] = callback
        self.RawCallbacks = self.RawCallbacks or {}
        self.RawCallbacks[type] = true
    end

    function BaseBridge:CreateAlias(type, aliases)
        for _, alias in aliases do
            self.Callbacks[alias] = self.Callbacks[type]
            if self.RawCallbacks and self.RawCallbacks[type] then
                self.RawCallbacks[alias] = true
            end
        end
    end

    function BaseBridge:HandleMessage(data)
        if self.Callbacks[data.type] then
            local success, result = pcall(function()
                return self.Callbacks[data.type](data)
            end)

            if success and result == nil then
                return nil
            end

            if not success then
                return self:FormatResponse(result, data.id, true)
            end

            if self.RawCallbacks and self.RawCallbacks[data.type] then
                return {
                    output = tostring(result),
                    success = true,
                    id = data.id
                }
            end

            return self:FormatResponse(result, data.id, false)
        end
        return nil
    end
    
    function BaseBridge:FormatResponse(message, id, isError)
        if isError then
            return {
                error = tostring(message),
                success = false,
                id = id
            }
        end
        
        local output = SanitizeForOutput(message)
        if typeof(output) ~= "table" then
            output = { output }
        end
    
        return {
            output = LuaEncode(output, {
                Prettify = false
            }),
            success = true,
            id = id
        }
    end
    
    function BaseBridge:IsAlive()
        local success, result = pcall(function()
            local response
            local thread = task.spawn(function()
                local success, data = pcall(request, {
                    Url = "http://" .. BridgeURL,
                    Method = "GET"
                })

                if success then
                    response = data
                end
            end)

            local start = os.clock()
            repeat task.wait(0.05) until response ~= nil or os.clock() - start > 5

            if response == nil then
                task.cancel(thread)
                return false
            end
    
            -- 426 = Upgrade Required (WebSocket), 200 = HTTP mode
            if response.StatusCode == 426 or response.StatusCode == 200 then
                return true
            end
    
            return false
        end)
    
        if not success then
            return false
        end
    
        return result
    end
end

local function WaitForServer(bridge)
    local retryDelay = 0.5
    local maxRetryDelay = 5
    local maxAttempts = 10
    local attempts = 0

    while not bridge:IsAlive() do
        attempts += 1
        if attempts >= maxAttempts then
            error("Failed to connect to bridge server after " .. maxAttempts .. " attempts")
        end
        task.wait(retryDelay)
        retryDelay = math.min(retryDelay * 1.5, maxRetryDelay)
    end
end

--// WebSocket Bridge \\--
local WebSocketBridge = setmetatable({}, {__index = BaseBridge}); do
    WebSocketBridge.__index = WebSocketBridge

    function WebSocketBridge.new()
        local self = setmetatable({}, WebSocketBridge)
        WaitForServer(self)

        --// Connect to the server with timeout \\--
        local wsConnection = nil
        local connectionThread = task.spawn(function()
            local success, result = pcall(function()
                return WebSocket.connect("ws://" .. BridgeURL)
            end)
            if success then
                wsConnection = result
            end
        end)

        local connectionStart = os.clock()
        repeat
            task.wait(0.05)
        until wsConnection ~= nil or os.clock() - connectionStart > WebSocketConnectTimeout

        if wsConnection == nil then
            pcall(task.cancel, connectionThread)
            error("WebSocket connection timed out after " .. WebSocketConnectTimeout .. " seconds")
        end

        self.WebSocket = wsConnection
        self.Connected = true
        self.Callbacks = {}
        self.ClientId = nil
        self.Transport = "ws"
        self.ConnectedAt = os.clock()
        self.LastReceivedAt = os.clock()
        self.HeartbeatSupported = false

        --// On Message \\--
        self.MessageConnection = self.WebSocket.OnMessage:Connect(function(message)
            self.LastReceivedAt = os.clock()

            local decodedOk, data = pcall(HttpService.JSONDecode, HttpService, message)
            if not decodedOk or type(data) ~= "table" then
                return
            end

            if data.type == "registered" then
                self.ClientId = data.clientId
                return
            end

            if data.type == "pong" then
                self.HeartbeatSupported = true
                return
            end

            task.spawn(function()
                local response = self:HandleMessage(data)
                if response then
                    self:Send(response)
                end
            end)
        end)

        --// On Close \\--
        self.CloseConnection = self.WebSocket.OnClose:Connect(function()
            self.Connected = false
        end)

        --// Send registration \\--
        if not self:Send(GetRegistrationInfo()) then
            self:Close()
            error("Failed to send WebSocket registration.")
        end

        local registerStart = os.clock()
        repeat
            task.wait(0.05)
        until (
            self.ClientId ~= nil or
            not self.Connected or
            os.clock() - registerStart > WebSocketRegisterTimeout
        )

        if self.ClientId == nil then
            self:Close()
            error("WebSocket registration was not acknowledged.")
        end

        --// Heartbeat \\--
        self.HeartbeatThread = task.spawn(function()
            local consecutiveFailures = 0
            while self.Connected do
                task.wait(WebSocketPingInterval)
                if not self.Connected then
                    break
                end

                if not self:Send({ type = "ping" }) then
                    self.Connected = false
                    break
                end

                if self.HeartbeatSupported then
                    if os.clock() - self.LastReceivedAt > WebSocketStaleTimeout then
                        self.Connected = false
                        break
                    end
                elseif os.clock() - self.LastReceivedAt > WebSocketStaleTimeout then
                    if self:IsAlive() then
                        consecutiveFailures = 0
                    else
                        consecutiveFailures += 1
                        if consecutiveFailures >= 3 then
                            self.Connected = false
                            break
                        end
                    end
                end
            end
        end)

        return self
    end

    function WebSocketBridge:Send(payload)
        if not self.Connected then
            return false
        end

        local encodedOk, encoded = pcall(HttpService.JSONEncode, HttpService, payload)
        if not encodedOk then
            return false
        end

        local sentOk = pcall(function()
            self.WebSocket:Send(encoded)
        end)
        if not sentOk then
            self.Connected = false
        end

        return sentOk
    end

    function WebSocketBridge:Close()
        self.Connected = false

        if self.HeartbeatThread and coroutine.running() ~= self.HeartbeatThread then
            pcall(task.cancel, self.HeartbeatThread)
        end

        if self.MessageConnection then
            pcall(function()
                self.MessageConnection:Disconnect()
            end)
        end

        if self.CloseConnection then
            pcall(function()
                self.CloseConnection:Disconnect()
            end)
        end

        pcall(function()
            self.WebSocket:Close()
        end)
    end

    function WebSocketBridge:WaitForDisconnect()
        while self.Connected do
            task.wait(0.1)
        end
        self:Close()
    end
end

--// HTTP Polling Bridge \\--
local HTTPBridge = setmetatable({}, {__index = BaseBridge}); do
    HTTPBridge.__index = HTTPBridge
    
    function HTTPBridge.new()
        local self = setmetatable({}, HTTPBridge)
        WaitForServer(self)

        self.Connected = true
        self.Callbacks = {}
        self.PollInterval = 0.1
        self.ClientId = nil
        self.Transport = "http"

        if not self:Register() then
            self.Connected = false
            error("Failed to register with the bridge server over HTTP.")
        end

        --// Start polling thread \\--
        self.PollThread = task.spawn(function()
            local consecutiveFailures = 0

            while self.Connected do
                local gotCommands = false
                local success, statusCode = pcall(function()
                    local response = request({
                        Url = "http://" .. BridgeURL .. "/poll?clientId=" .. HttpService:UrlEncode(self.ClientId),
                        Method = "GET"
                    })

                    if response.StatusCode ~= 204 and response.StatusCode ~= 200 then
                        return response.StatusCode
                    end

                    if response.Body and response.Body ~= "" then
                        local data = HttpService:JSONDecode(response.Body)
                        local commands = {}
                        if typeof(data) == "table" and data.type == nil and #data > 0 then
                            commands = data
                        elseif typeof(data) == "table" and data.type ~= nil then
                            commands = { data }
                        end

                        for _, command in ipairs(commands) do
                            gotCommands = true
                            task.spawn(function()
                                local result = self:HandleMessage(command)
                                if result == nil then
                                    return
                                end

                                self:Respond(result)
                            end)
                        end
                    end

                    return response.StatusCode
                end)

                if success and (statusCode == 200 or statusCode == 204) then
                    consecutiveFailures = 0
                elseif success and statusCode == 404 then
                    self.Connected = false
                    break
                else
                    consecutiveFailures += 1
                    if consecutiveFailures >= HttpMaxPollFailures then
                        self.Connected = false
                        break
                    end

                    task.wait(math.min(0.25 * 2 ^ consecutiveFailures, 4))
                end

                if self.RetryWebSocketAt and os.clock() >= self.RetryWebSocketAt then
                    self.Connected = false
                    break
                end

                if not gotCommands then
                    task.wait(self.PollInterval)
                end
            end
        end)

        return self
    end

    function HTTPBridge:Register()
        local ok, clientId = pcall(function()
            local regResponse = request({
                Url = "http://" .. BridgeURL .. "/register",
                Method = "POST",
                Headers = { ["Content-Type"] = "application/json" },
                Body = HttpService:JSONEncode(GetRegistrationInfo()),
            })
            if regResponse.StatusCode ~= 200 or not regResponse.Body then
                return nil
            end

            local regData = HttpService:JSONDecode(regResponse.Body)
            if type(regData) ~= "table" or type(regData.clientId) ~= "string" then
                return nil
            end

            return regData.clientId
        end)

        if not ok or clientId == nil then
            return false
        end

        self.ClientId = clientId
        return true
    end

    function HTTPBridge:Respond(result)
        local body = HttpService:JSONEncode(result)

        for attempt = 1, 3 do
            local ok, response = pcall(request, {
                Url = "http://" .. BridgeURL .. "/respond",
                Method = "POST",
                Headers = { ["Content-Type"] = "application/json" },
                Body = body,
            })
            if ok and type(response) == "table" and response.StatusCode == 200 then
                return true
            end

            task.wait(0.25 * attempt)
        end

        return false
    end

    function HTTPBridge:WaitForDisconnect()
        while self.Connected do
            task.wait(0.1)
        end
    end
end

--// Create Bridge \\--
local function CanUseWebSocket()
    return WebSocketAvailable and os.clock() >= TransportState.httpOnlyUntil
end

local function RecordWebSocketFailure()
    TransportState.webSocketFailures += 1

    if TransportState.webSocketFailures >= WebSocketMaxFailures then
        TransportState.webSocketFailures = 0
        TransportState.httpOnlyUntil = os.clock() + WebSocketRetryAfterSeconds
    end
end

local function RecordBridgeEnded(bridge)
    if bridge.Transport ~= "ws" then
        return
    end

    if os.clock() - bridge.ConnectedAt < WebSocketShortSessionSeconds then
        RecordWebSocketFailure()
    else
        TransportState.webSocketFailures = 0
    end
end

local function CreateBridge()
    if CanUseWebSocket() then
        local success, bridge = pcall(WebSocketBridge.new)
        if success then
            return bridge
        end

        RecordWebSocketFailure()
    end

    local bridge = HTTPBridge.new()
    if WebSocketAvailable then
        bridge.RetryWebSocketAt = math.max(TransportState.httpOnlyUntil, os.clock() + 60)
    end

    return bridge
end

return {
    CreateBridge = CreateBridge,
    RecordBridgeEnded = RecordBridgeEnded,
}
end
