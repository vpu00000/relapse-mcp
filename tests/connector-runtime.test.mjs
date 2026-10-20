import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const prelude = String.raw`
local environment = {}
getgenv = function() return environment end
setthreadidentity = function() end
task = { spawn = function(fn, ...) return fn(...) end, wait = function() end,
    delay = function(_, fn) fn() end, defer = function(fn, ...) fn(...) end }
local function signal()
    local self = { callbacks = {} }
    function self:Connect(callback)
        self.callbacks[#self.callbacks + 1] = callback
        return { Disconnect = function()
            for index, value in self.callbacks do
                if value == callback then table.remove(self.callbacks, index) break end
            end
        end }
    end
    function self:Fire(...)
        for _, callback in self.callbacks do callback(...) end
    end
    return self
end
local scriptInstance = {}
function scriptInstance:IsA(class) return class == "LuaSourceContainer" or class == "LocalScript" end
function scriptInstance:GetDebugId() return "debug-1" end
function scriptInstance:GetFullName() return "game.TestScript" end
function scriptInstance:IsDescendantOf() return false end
local internalScript = setmetatable({}, { __index = scriptInstance })
function internalScript:IsDescendantOf() return true end
local lockedScript = setmetatable({ RobloxLocked = true }, { __index = scriptInstance })
local decompilations = 0
decompile = function(instance)
    assert(instance == scriptInstance, "Do not decompile Roblox internal scripts")
    decompilations += 1
    return "return 42"
end
getnilinstances = function() return { scriptInstance } end
Enum = { RunContext = { Client = "Client" } }
Instance = { new = function() return {} end }
local services = {
    HttpService = { GenerateGUID = function() return "mapping-guid" end },
    LogService = { GetLogHistory = function() return {} end },
    Players = { LocalPlayer = { Name = "Tester", UserId = 1 } },
    MarketplaceService = { GetProductInfo = function() return { Name = "Test Game" } end },
    RobloxReplicatedStorage = {},
    CoreGui = {}, CorePackages = {}, ScriptContext = {},
}
game = { PlaceId = 42, JobId = "job-1", DescendantAdded = signal(),
    DescendantRemoving = signal() }
function game:GetService(name) return services[name] end
function game:IsLoaded() return true end
function game:QueryDescendants() return { internalScript, lockedScript, scriptInstance } end
RelapseChannel = {}
function RelapseChannel.new(name)
    assert(name == "relapse.mcp.test")
    testChannel = { Connected = signal(), IsPublished = true }
    function testChannel:Close() self.IsPublished = false end
    return testChannel
end
testPeer = { Connected = true, MessageReceived = signal(), Disconnected = signal(), messages = {} }
function testPeer:Send(payload) self.messages[#self.messages + 1] = payload end
function testPeer:Close() self.Connected = false self.Disconnected:Fire() end
`;

const assertions = String.raw`
testChannel.Connected:Fire(testPeer)
assert(testPeer.messages[1].type == "hello")
assert(testPeer.messages[2].type == "script-sources")
assert(testPeer.messages[2].sourcesToMap == 1)
assert(testPeer.messages[3].scripts[1].source == "return 42")
assert(testPeer.messages[3].hasFinishedMapping == true)
assert(decompilations == 1, "Deduplicate scripts returned by both queries")
testPeer.MessageReceived:Fire({ id = "one", type = "get-data-by-code", source = "return 42" })
assert(testPeer.messages[4].id == "one")
assert(string.find(testPeer.messages[4].output, "42", 1, true))
local decoded = loadstring("return " .. testPeer.messages[4].output)()
assert(decoded[1] == 42 and decoded.n == 1, "Preserve Upio's packed return shape")
testPeer.MessageReceived:Fire({ id = "two", type = "get-script-content", debugId = "debug-1" })
assert(testPeer.messages[5].id == "two")
assert(string.find(testPeer.messages[5].output, "return 42", 1, true))
testPeer.MessageReceived:Fire({ id = "three", type = "get-data-by-code",
    source = "return { [12] = 'sparse', [0] = 'zero', key = true }" })
local sparse = loadstring("return " .. testPeer.messages[6].output)()[1]
assert(sparse[12] == "sparse" and sparse[0] == "zero" and sparse.key == true)
testPeer:Close()
assert(testChannel.IsPublished == false)
assert(next(environment) == nil, "Release the injected service after its last peer disconnects")
`;

test("injected Luau channel handles requests and closes after disconnect", (t) => {
  const probe = spawnSync("luau", ["--help"], { encoding: "utf8" });
  if (probe.error?.code === "ENOENT") { t.skip("Luau CLI is unavailable"); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relapse-mcp-luau-"));
  const file = path.join(dir, "connector.test.luau");
  try {
    const connector = fs.readFileSync("connector.luau", "utf8");
    fs.writeFileSync(file, `${prelude}\nlocal __relapse_mcp_channel = "relapse.mcp.test"\n${connector}\n${assertions}`);
    const result = spawnSync("luau", [file], { encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
