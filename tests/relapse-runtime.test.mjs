import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { FramedSocket } from "../dist/relapse/framed-socket.js";

const packagePath = process.env.RELAPSE_MCP_TEST_PACKAGE;

function frame(value) {
  const body = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length);
  return Buffer.concat([header, body]);
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function until(predicate, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for mock state");
    await delay(20);
  }
}

test("stdio MCP shares @main and reinjects its channel after a session change", { timeout: packagePath ? 60_000 : 15_000 }, async () => {
  const connector = fs.readFileSync(path.resolve("dist/connector.luau"), "utf8");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relapse-mcp-test-"));
  const socketPath = path.join(dir, "relapse.sock");
  const mainPeers = new Set();
  const bridgePeers = new Set();
  const allSockets = new Set();
  const commands = [];
  let session = 1;
  let boots = 0;
  let channelName = "";

  const server = net.createServer((socket) => {
    allSockets.add(socket);
    let buffer = Buffer.alloc(0);
    let channel;
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const size = buffer.readUInt32BE(0);
        if (buffer.length < 4 + size) return;
        const message = JSON.parse(buffer.subarray(4, 4 + size).toString("utf8"));
        buffer = buffer.subarray(4 + size);
        if (!channel) {
          channel = message.channel;
          if (channel !== "@main" && channel !== channelName) {
            socket.write(frame({ ok: false, error: "unknown channel" }));
            socket.destroy();
            return;
          }
          socket.write(frame({ ok: true, version: 1, max_message_bytes: 8 * 1024 * 1024 }));
          if (channel === "@main") {
            mainPeers.add(socket);
            socket.write(frame({ type: "hello", ready: true, session }));
          } else {
            bridgePeers.add(socket);
            socket.write(frame({ type: "hello", client: {
              username: "Tester", userId: 1, placeId: 42, jobId: `job-${session}`, placeName: "Test Game",
            } }));
            socket.write(frame({ type: "script-sources", scripts: [{
              debugId: "debug-1", path: "game.TestScript", source: `print('session${session}')`,
            }], hasFinishedMapping: true, sourcesToMap: 1, processedSources: 1, skippedSources: 0,
              mappingSessionId: `mapping-${session}`, mappingSessionStartedAt: session * 1000,
              mappingRevision: 1, beginMappingSession: true }));
          }
          continue;
        }
        if (channel === "@main" && message.op === "execute") {
          assert.equal(message.session, session);
          channelName = message.source.match(/local __relapse_mcp_channel = "([^"]+)"/)?.[1] ?? "";
          assert.ok(channelName.startsWith("relapse.mcp."));
          assert.equal(message.source, `local __relapse_mcp_channel = ${JSON.stringify(channelName)}\n${connector}`);
          boots++;
          socket.write(frame({ type: "exec_result", script_id: message.script_id, phase: "submitted" }));
        } else if (channel !== "@main") {
          commands.push(message);
          if (message.type === "get-game-info") {
            socket.write(frame({ id: message.id, output: '{["PlaceId"] = 42}' }));
          }
        }
      }
    });
    socket.on("close", () => { allSockets.delete(socket); mainPeers.delete(socket); bridgePeers.delete(socket); });
  });
  server.listen(socketPath);
  await once(server, "listening");

  const otherClient = new FramedSocket(socketPath, "@main");
  otherClient.on("message", () => {});
  await otherClient.connect();

  const transport = new StdioClientTransport({
    command: packagePath ? "npx" : process.execPath,
    args: packagePath ? ["-y", `--package=${path.resolve(packagePath)}`, "relapse-mcp"] : [path.resolve("dist/index.js")],
    cwd: dir,
    env: {
      ...process.env,
      RELAPSE_SOCKET_PATH: socketPath,
      ...(packagePath ? { npm_config_cache: path.join(dir, "npm-cache") } : {}),
    },
  });
  const client = new Client({ name: "test", version: "1" });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [
      "click-button", "execute", "execute-file", "get-console-output", "get-data-by-code",
      "get-descendants-tree", "get-game-info", "get-script-content", "list-clients",
      "list-roblox-windows", "remote-spy", "screenshot-window", "script-grep",
      "search-instances", "semantic-search-scripts", "set-active-client", "type-text-box",
    ].sort());
    await until(() => boots === 1 && bridgePeers.size === 1);
    let clients;
    await until(async () => {
      clients = await client.callTool({ name: "list-clients", arguments: {} });
      return /Tester @ Test Game/.test(clients.content[0].text);
    });
    assert.match(clients.content[0].text, /Tester @ Test Game/);
    const info = await client.callTool({ name: "get-game-info", arguments: {} });
    assert.match(info.content[0].text, /PlaceId/);
    assert.equal(commands.at(-1).type, "get-game-info");
    const grep = await client.callTool({ name: "script-grep", arguments: { query: "session1" } });
    assert.match(grep.content[0].text, /game.TestScript/);
    const source = await client.callTool({ name: "get-script-content", arguments: { scriptPath: "game.TestScript" } });
    assert.match(source.content[0].text, /session1/);
    const execute = await client.callTool({ name: "execute", arguments: { code: "print('ok')" } });
    assert.equal(execute.isError, undefined);
    assert.equal(commands.at(-1).type, "execute");
    assert.equal(mainPeers.size, 2);
    assert.equal(otherClient.isOpen, true);

    const interrupted = client.callTool({ name: "get-data-by-code", arguments: { code: "return 1" } });
    await until(() => commands.at(-1)?.type === "get-data-by-code");
    for (const peer of bridgePeers) peer.destroy();
    session = 2;
    for (const peer of mainPeers) {
      peer.write(frame({ type: "status", ready: false, session: 1 }));
      peer.write(frame({ type: "status", ready: true, session: 2 }));
    }
    const interruptedResult = await interrupted;
    assert.equal(interruptedResult.isError, true);
    assert.match(interruptedResult.content[0].text, /session changed|disconnected/i);
    await until(() => boots >= 2 && bridgePeers.size === 1);
    const next = await client.callTool({ name: "get-game-info", arguments: {} });
    assert.match(next.content[0].text, /PlaceId/);
    const nextGrep = await client.callTool({ name: "script-grep", arguments: { query: "session2" } });
    assert.match(nextGrep.content[0].text, /game.TestScript/);
    assert.equal(otherClient.isOpen, true);
  } finally {
    otherClient.close();
    for (const socket of allSockets) socket.destroy();
    await Promise.race([client.close().catch(() => {}), delay(1000)]);
    await Promise.race([transport.close().catch(() => {}), delay(1000)]);
    server.closeAllConnections?.();
    await Promise.race([new Promise((resolve) => server.close(resolve)), delay(1000)]);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
