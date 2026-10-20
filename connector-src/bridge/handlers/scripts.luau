return function(context, Bridge)
    Bridge:BindToTypeRaw("get-script-content", function(data)
        local scriptInstance
        if data.debugId then
            scriptInstance = context.GetScriptByDebugId(data.debugId)
            assert(scriptInstance, "No live script instance found for DebugId: " .. tostring(data.debugId))
        else
            setthreadidentity(8)
            scriptInstance = loadstring(data.source)()
            assert(typeof(scriptInstance) == "Instance", "Script instance is not an instance.")
            assert(scriptInstance:IsA("LuaSourceContainer"), "Script instance is not a LuaSourceContainer.")
            assert(not (scriptInstance:IsA("Script") and scriptInstance.RunContext ~= Enum.RunContext.Client),
                "Script instance is server-only.")
        end
        local source = context.DecompileScriptSource(scriptInstance)
        assert(source, "Failed to decompile script.")
        local lines = string.split(source, "\n")
        local total = #lines
        local maxLines = math.max(1, math.min(tonumber(data.maxLines) or 80, 2000))
        local startLine = math.max(1, math.min(tonumber(data.startLine) or 1, total))
        local requestedEnd = math.max(startLine, math.min(tonumber(data.endLine) or total, total))
        local endLine = math.min(requestedEnd, startLine + maxLines - 1)
        local sliced = {}
        for line = startLine, endLine do sliced[#sliced + 1] = lines[line] end
        local footer = if endLine < requestedEnd then
            "\n-- Output truncated to " .. maxLines .. " lines. Rerun with startLine=" .. (endLine + 1) .. "."
            else ""
        return "-- Lines " .. startLine .. "-" .. endLine .. " of " .. total .. "\n" ..
            table.concat(sliced, "\n") .. footer
    end)
end
