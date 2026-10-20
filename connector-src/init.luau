local channelName = __relapse_mcp_channel
if not game:IsLoaded() then game.Loaded:Wait() end
local env = getgenv()
local key = "__relapse_mcp_" .. channelName
local previous = env[key]
if previous and previous.publish then
    previous.publish()
    return
end

local cloneref = cloneref or function(value) return value end
local HttpService = cloneref(game:GetService("HttpService"))
local LogService = cloneref(game:GetService("LogService"))
local Players = cloneref(game:GetService("Players"))
local MarketplaceService = cloneref(game:GetService("MarketplaceService"))
local RobloxReplicatedStorage = cloneref(game:GetService("RobloxReplicatedStorage"))
local CoreGui = cloneref(game:GetService("CoreGui"))
local CorePackages = cloneref(game:GetService("CorePackages"))
local ScriptContext = cloneref(game:GetService("ScriptContext"))
local VirtualInputManager = cloneref(Instance.new("VirtualInputManager"))

local function sanitize(value, depth, seen)
    local kind = typeof(value)
    if kind == "Instance" then
        local ok, name = pcall(function() return value:GetFullName() end)
        return ok and name or tostring(value)
    end
    if kind == "string" then
        if #value > 500 then return value:sub(1, 500) .. "… [truncated]" end
        return value
    end
    if kind == "number" or kind == "boolean" or kind == "nil" then return value end
    if kind ~= "table" then return tostring(value) end
    if depth >= 8 then return "<max depth>" end
    if seen[value] then return "<cycle>" end
    seen[value] = true
    local result = {}
    local count = 0
    for itemKey, itemValue in value do
        count += 1
        if count > 60 then result.__omitted = "more entries omitted" break end
        local key = if type(itemKey) == "string" or type(itemKey) == "number" then itemKey else tostring(itemKey)
        result[key] = sanitize(itemValue, depth + 1, seen)
    end
    seen[value] = nil
    return result
end

local function serialize(value, depth, seen)
    local kind = type(value)
    if kind == "string" then return string.format("%q", value) end
    if kind == "number" or kind == "boolean" then return tostring(value) end
    if kind == "nil" then return "nil" end
    if kind ~= "table" then return string.format("%q", tostring(value)) end
    if depth >= 8 or seen[value] then return "{...}" end
    seen[value] = true
    local parts = {}
    local count = 0
    local nextIndex = 1
    for itemKey, itemValue in value do
        count += 1
        if count > 60 then parts[#parts + 1] = "..." break end
        local label = "[" .. serialize(itemKey, depth + 1, seen) .. "] = "
        if itemKey == nextIndex then
            label = ""
            nextIndex += 1
        end
        parts[#parts + 1] = label .. serialize(itemValue, depth + 1, seen)
    end
    seen[value] = nil
    return "{" .. table.concat(parts, ", ") .. "}"
end

local state = { channel = nil, peers = {}, scripts = {}, scanGeneration = 0,
    mappingSessionId = "", mappingStartedAt = 0, revision = 0,
    descendantAdded = nil, descendantRemoving = nil, rescanScheduled = false }
local Bridge = { Callbacks = {}, RawCallbacks = {} }
function Bridge:BindToType(kind, callback) self.Callbacks[kind] = callback end
function Bridge:BindToTypeRaw(kind, callback)
    self.Callbacks[kind] = callback
    self.RawCallbacks[kind] = true
end
function Bridge:Send(payload)
    for peer in state.peers do
        if peer.Connected then pcall(peer.Send, peer, payload) else state.peers[peer] = nil end
    end
end
function Bridge:HandleMessage(message, peer)
    if type(message) ~= "table" or type(message.type) ~= "string" or type(message.id) ~= "string" then return end
    local callback = self.Callbacks[message.type]
    if not callback then
        peer:Send({ id = message.id, error = "Unknown command: " .. message.type })
        return
    end
    task.spawn(function()
        local ok, result = pcall(callback, message)
        if not peer.Connected then return end
        if not ok then
            pcall(peer.Send, peer, { id = message.id, error = tostring(result) })
        elseif result ~= nil then
            local output
            if self.RawCallbacks[message.type] then
                output = tostring(result)
            else
                local value = sanitize(result, 0, {})
                if type(value) ~= "table" then value = { value } end
                output = serialize(value, 0, {})
            end
            if #output > 7 * 1024 * 1024 then
                pcall(peer.Send, peer, { id = message.id,
                    error = "Result exceeds the Relapse channel limit. Request a smaller range or result." })
            else
                pcall(peer.Send, peer, { id = message.id, output = output })
            end
        end
    end)
end

local function isScript(instance)
    return instance:IsA("LuaSourceContainer") and
        (not instance:IsA("Script") or instance.RunContext == Enum.RunContext.Client) and
        not instance.RobloxLocked and not instance:IsDescendantOf(CoreGui) and
        not instance:IsDescendantOf(CorePackages) and not instance:IsDescendantOf(ScriptContext)
end
local function readSource(instance)
    local ok, result = pcall(decompile, instance)
    if ok and type(result) == "string" and #result > 0 then return result end
    return nil
end
local function emitSources(batch, done, total, processed, skipped)
    state.revision += 1
    Bridge:Send({ type = "script-sources", scripts = batch,
        hasFinishedMapping = done, sourcesToMap = total,
        processedSources = processed, skippedSources = skipped,
        mappingSessionId = state.mappingSessionId,
        mappingSessionStartedAt = state.mappingStartedAt,
        mappingRevision = state.revision,
        beginMappingSession = state.revision == 1 })
end
local function scanScripts(generation)
    state.scripts = {}
    state.mappingSessionId = HttpService:GenerateGUID(false)
    state.mappingStartedAt = math.max(os.time() * 1000, state.mappingStartedAt + 1)
    state.revision = 0
    local instances = game:QueryDescendants("LuaSourceContainer")
    if type(getnilinstances) == "function" then
        local ok, nilInstances = pcall(getnilinstances)
        if ok and type(nilInstances) == "table" then
            for _, instance in nilInstances do instances[#instances + 1] = instance end
        end
    end
    local scripts, seen = {}, {}
    for _, instance in instances do
        local ok, selected = pcall(isScript, instance)
        if ok and selected and not seen[instance] then
            seen[instance] = true
            scripts[#scripts + 1] = instance
        end
    end
    local total, processed, skipped = #scripts, 0, 0
    local batch, bytes = {}, 0
    emitSources({}, false, total, processed, skipped)
    for _, instance in scripts do
        task.wait()
        if generation ~= state.scanGeneration or not next(state.peers) then return end
        local ok, debugId = pcall(function() return instance:GetDebugId() end)
        local source = readSource(instance)
        if generation ~= state.scanGeneration or not next(state.peers) then return end
        if ok and source then
            state.scripts[debugId] = instance
            local pathOk, path = pcall(function() return instance:GetFullName() end)
            if not pathOk then path = tostring(instance) end
            local size = #source + #path + #debugId + 256
            if size > 7 * 1024 * 1024 then
                skipped += 1
            else
                if bytes + size > 512 * 1024 or #batch >= 16 then
                    emitSources(batch, false, total, processed, skipped)
                    batch, bytes = {}, 0
                end
                batch[#batch + 1] = { debugId = debugId, path = path, source = source }
                bytes += size
            end
        else
            skipped += 1
        end
        processed += 1
    end
    if generation == state.scanGeneration and next(state.peers) then
        emitSources(batch, true, total, processed, skipped)
    end
end

local function startScan()
    state.scanGeneration += 1
    local generation = state.scanGeneration
    task.spawn(function()
        setthreadidentity(8)
        local ok, failure = pcall(scanScripts, generation)
        if not ok then warn("Relapse MCP script scan failed: " .. tostring(failure)) end
    end)
end

local function scheduleRescan(instance)
    local ok, selected = pcall(isScript, instance)
    if not ok or not selected or state.rescanScheduled or not next(state.peers) then return end
    state.rescanScheduled = true
    task.delay(0.5, function()
        state.rescanScheduled = false
        if next(state.peers) then startScan() end
    end)
end

local context = {
    LogService = LogService,
    MarketplaceService = MarketplaceService,
    RobloxReplicatedStorage = RobloxReplicatedStorage,
    VirtualInputManager = VirtualInputManager,
    GetScriptByDebugId = function(debugId) return state.scripts[debugId] end,
    DecompileScriptSource = function(instance) return readSource(instance) end,
}
for _, registrar in {
    require("./bridge/handlers/core"),
    require("./bridge/handlers/scripts"),
    require("./bridge/handlers/instances"),
    require("./bridge/handlers/remote-spy/logs"),
    require("./bridge/handlers/remote-spy/control"),
    require("./bridge/handlers/input"),
} do registrar(context, Bridge) end

function state.publish()
    if state.channel and state.channel.IsPublished then return end
    local channel = RelapseChannel.new(channelName)
    state.channel = channel
    if not state.descendantAdded then
        state.descendantAdded = game.DescendantAdded:Connect(scheduleRescan)
        state.descendantRemoving = game.DescendantRemoving:Connect(scheduleRescan)
    end
    channel.Connected:Connect(function(peer)
        state.peers[peer] = true
        peer.Disconnected:Connect(function()
            state.peers[peer] = nil
            if not next(state.peers) and state.channel == channel then
                state.scanGeneration += 1
                state.scripts = {}
                channel:Close()
                state.descendantAdded:Disconnect()
                state.descendantRemoving:Disconnect()
                state.descendantAdded = nil
                state.descendantRemoving = nil
                if env[key] == state then env[key] = nil end
            end
        end)
        peer.MessageReceived:Connect(function(message) Bridge:HandleMessage(message, peer) end)
        local player = Players.LocalPlayer
        local placeName = "Unknown"
        pcall(function() placeName = MarketplaceService:GetProductInfo(game.PlaceId).Name end)
        peer:Send({ type = "hello", client = {
            username = player and player.Name or "Unknown",
            userId = player and player.UserId or 0,
            placeId = game.PlaceId,
            jobId = game.JobId,
            placeName = placeName,
        } })
        startScan()
    end)
end

env[key] = state
state.publish()
