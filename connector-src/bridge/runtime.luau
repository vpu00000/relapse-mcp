return function(context)
local CreateBridge = context.CreateBridge
local WaitForBridgeClientId = context.WaitForBridgeClientId
local ScriptMappingPipeline = context.ScriptMappingPipeline
local StartUploadQueue = context.StartUploadQueue
local PublishScriptMappingStatus = context.PublishScriptMappingStatus
local ResetScriptMappingState = context.ResetScriptMappingState
local StartScriptMapping = context.StartScriptMapping
local StartFailedScriptResync = context.StartFailedScriptResync
local ResumeDeferredScriptMappings = context.ResumeDeferredScriptMappings
local RecordBridgeEnded = context.RecordBridgeEnded
local registrars = {
    require("./handlers/core"),
    require("./handlers/scripts"),
    require("./handlers/instances"),
    require("./handlers/remote-spy/logs"),
    require("./handlers/remote-spy/control"),
    require("./handlers/input"),
}
local reconnectDelay = 1

--// Main Loop \\--
while true do
    local success, Bridge = pcall(CreateBridge)

    if not success then
        task.wait(reconnectDelay)
        reconnectDelay = math.min(reconnectDelay * 2, 10)
        continue
    end
    reconnectDelay = 1

    for _, registerHandlers in registrars do
        registerHandlers(context, Bridge)
    end

    local clientId = WaitForBridgeClientId(Bridge)
    if clientId then
        ScriptMappingPipeline.bridge = Bridge
        StartUploadQueue()

        if ScriptMappingPipeline.clientId ~= clientId then
            ResetScriptMappingState(clientId)
        end

        if not getgenv().DisableInitialScriptDecompMapping then
            StartScriptMapping(clientId)
            StartFailedScriptResync()
            ResumeDeferredScriptMappings()
            PublishScriptMappingStatus()
        else
            ScriptMappingPipeline.clientId = clientId
            ScriptMappingPipeline.disabled = true
            ScriptMappingPipeline.stateVersion += 1
            PublishScriptMappingStatus()
        end
    end

    Bridge:WaitForDisconnect()
    RecordBridgeEnded(Bridge)

    if ScriptMappingPipeline.bridge == Bridge then
        ScriptMappingPipeline.bridge = nil
    end
    task.wait(1)
end
end
