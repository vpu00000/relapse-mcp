import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../dist/mcp/server.js";
import {
  registerClient, getClientById, resetRegistry, unregisterClient,
  getActiveClientId, setActiveClientId,
} from "../dist/bridge/handlers/shared/registry.js";
import {
  handleRobloxResponse, resetPrimaryState, setInstanceRole,
  SendArbitraryDataToClient, setRelaySocket, secondaryResponseResolvers,
} from "../dist/bridge/handlers/shared/communication.js";
import { upsertScriptSources } from "../dist/bridge/handlers/shared/script-source-store.js";
import { POST as toolPost } from "../dist/http/routes/api/tool.js";
import { WS as attachRelay } from "../dist/http/routes/mcp-relay.js";

test.beforeEach(() => { resetRegistry(); resetPrimaryState(); setInstanceRole("primary"); });
test.afterEach(() => { resetRegistry(); resetPrimaryState(); setInstanceRole("primary"); setRelaySocket(null); });

function roblox(name) {
  const id = registerClient({ username: name, userId: 1, placeId: 1, jobId: name, placeName: name, transport: "http" });
  return getClientById(id);
}

async function session(t) {
  const server = createMcpServer();
  const client = new Client({ name: "routing-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  return client;
}

function call(client, name, args = {}) {
  return client.callTool({ name, arguments: args });
}

async function nextCommand(client) {
  for (let i = 0; i < 200; i++) {
    if (client.pendingHttpCommands.length) return JSON.parse(client.pendingHttpCommands.shift());
    await delay(5);
  }
  assert.fail(`No command delivered to ${client.username}`);
}

test("session defaults and concurrent per-call targets stay isolated through responses", async (t) => {
  const a = roblox("A"), b = roblox("B");
  const one = await session(t), two = await session(t);
  await call(one, "set-active-client", { clientId: a.clientId });
  await call(two, "set-active-client", { clientId: b.clientId });
  assert.equal(getActiveClientId(), undefined, "MCP selection must not mutate the dashboard default");

  const schemas = (await one.listTools()).tools;
  for (const tool of schemas) {
    if (["list-clients", "set-active-client", "screenshot-window", "list-roblox-windows"].includes(tool.name)) continue;
    assert.equal(tool.inputSchema.properties.clientId.type, "string", tool.name);
    assert.ok(!tool.inputSchema.required?.includes("clientId"), tool.name);
  }
  assert.ok(schemas.find(tool => tool.name === "remote-spy").inputSchema.properties.operation);

  const pendingA = call(one, "get-game-info");
  const pendingB = call(two, "get-game-info");
  const [commandA, commandB] = await Promise.all([nextCommand(a), nextCommand(b)]);
  await call(one, "set-active-client", { clientId: b.clientId });
  setActiveClientId(b.clientId);
  handleRobloxResponse({ id: commandB.id, output: "only B" });
  handleRobloxResponse({ id: commandA.id, output: "only A" });
  const [resultA, resultB] = await Promise.all([pendingA, pendingB]);
  assert.ok(resultA.content[0].text.includes(`[client=${a.clientId} `));
  assert.ok(resultB.content[0].text.includes(`[client=${b.clientId} `));
  assert.match(resultA.content[0].text, /only A/);
  assert.doesNotMatch(resultA.content[0].text, /only B/);

  const explicitA = call(one, "get-game-info", { clientId: a.clientId.slice(0, 12) });
  const explicitB = call(one, "get-game-info", { clientId: b.clientId });
  const [overrideA, overrideB] = await Promise.all([nextCommand(a), nextCommand(b)]);
  handleRobloxResponse({ id: overrideB.id, output: "override B" });
  handleRobloxResponse({ id: overrideA.id, output: "override A" });
  const overrides = await Promise.all([explicitA, explicitB]);
  assert.ok(overrides[0].content[0].text.includes(a.clientId));
  assert.ok(overrides[1].content[0].text.includes(b.clientId));

  await call(one, "execute", { code: "print('default B')" });
  assert.match((await nextCommand(b)).source, /default B/);
  assert.equal(a.pendingHttpCommands.length, 0);
  for (const clientId of ["not-a-client", " "]) {
    assert.equal((await call(one, "execute", { code: "must not run", clientId })).isError, true);
  }
  assert.equal((await call(one, "set-active-client", { clientId: " " })).isError, true);
  unregisterClient(b.clientId);
  assert.equal((await call(one, "execute", { code: "must not fall back" })).isError, true);
  assert.equal(a.pendingHttpCommands.length, 0);
});

test("cached scripts and HTTP tool calls use explicit targets without changing defaults", async (t) => {
  const a = roblox("A"), b = roblox("B"), client = await session(t);
  for (const target of [a, b]) {
    upsertScriptSources(target, {
      hasFinishedMapping: true, sourcesToMap: 1, processedSources: 1,
      scripts: [{ debugId: "same-id", path: "game.Shared", source: `return '${target.username}'` }],
    });
  }
  await call(client, "set-active-client", { clientId: a.clientId });
  const results = await Promise.all([a, b].map(target => call(client, "get-script-content", {
    clientId: target.clientId, scriptPath: "game.Shared",
  })));
  for (const [i, target] of [a, b].entries()) {
    assert.ok(results[i].content[0].text.includes(`[client=${target.clientId} `));
    assert.ok(results[i].content[0].text.includes(`return '${target.username}'`));
  }
  const greps = await Promise.all([a, b].map(target => call(client, "script-grep", {
    clientId: target.clientId, query: "return", literal: true,
  })));
  assert.match(greps[0].content[0].text, /return 'A'/);
  assert.doesNotMatch(greps[0].content[0].text, /return 'B'/);
  assert.match(greps[1].content[0].text, /return 'B'/);

  setActiveClientId(a.clientId);
  let body;
  await toolPost(Readable.from([JSON.stringify({ type: "script-grep", clientId: b.clientId, query: "return" })]), {
    writeHead() {}, end(value) { body = JSON.parse(value); },
  });
  assert.match(body.result, /return 'B'/);
  assert.equal(getActiveClientId(), a.clientId);
  assert.equal(a.pendingHttpCommands.length + b.pendingHttpCommands.length, 0);
});

test("implicit dispatch goes to one client, never broadcasts", async () => {
  const a = roblox("A");
  assert.ok(SendArbitraryDataToClient("execute", { source: "single" }));
  assert.equal((await nextCommand(a)).source, "single");
  const b = roblox("B");
  SendArbitraryDataToClient("execute", { source: "one only" });
  assert.equal(a.pendingHttpCommands.length + b.pendingHttpCommands.length, 1);
});

test("explicit HTTP targets win over a connected WebSocket client, including RemoteSpy", async (t) => {
  const http = roblox("HTTP"), ws = relay(), client = await session(t);
  const wsId = registerClient({ username: "WS", userId: 2, placeId: 2, jobId: "ws", placeName: "WS", transport: "ws", ws });
  await call(client, "set-active-client", { clientId: wsId });
  const pending = call(client, "remote-spy", { operation: "list", clientId: http.clientId });
  const command = await nextCommand(http);
  assert.equal(command.type, "remote-spy");
  assert.equal(command.direction, "Both");
  assert.equal(command.clientId, undefined, "routing metadata must not leak into the Roblox payload");
  assert.equal(ws.messages.length, 0);
  handleRobloxResponse({ id: command.id, output: "HTTP remotes" });
  assert.ok((await pending).content[0].text.includes(http.clientId));
  assert.equal((await call(client, "remote-spy", { operation: "block", clientId: http.clientId })).isError, true);
  assert.equal(http.pendingHttpCommands.length, 0);
  await call(client, "execute", { code: "WS default" });
  assert.match(ws.messages.at(-1).source, /WS default/);
});

function relay() {
  const socket = new EventEmitter();
  socket.readyState = 1;
  socket.messages = [];
  socket.send = message => socket.messages.push(JSON.parse(message));
  return socket;
}

test("relay selection only validates, and secondary calls forward session or explicit IDs", async (t) => {
  const a = roblox("A"), b = roblox("B");
  const one = relay(), two = relay();
  attachRelay(one); attachRelay(two);
  one.emit("message", JSON.stringify({ id: "select-a", type: "set-active-client", targetClientId: a.clientId }));
  two.emit("message", JSON.stringify({ id: "select-b", type: "set-active-client", targetClientId: b.clientId }));
  assert.equal(getActiveClientId(), undefined);
  one.emit("message", JSON.stringify({ id: "do-a", type: "execute", targetClientId: a.clientId }));
  two.emit("message", JSON.stringify({ id: "do-b", type: "execute", targetClientId: b.clientId }));
  assert.equal((await nextCommand(a)).id, "do-a");
  assert.equal((await nextCommand(b)).id, "do-b");
  one.emit("message", JSON.stringify({ id: "blank", type: "set-active-client", targetClientId: "" }));
  assert.ok(one.messages.at(-1).error);
  one.emit("close"); two.emit("close");

  const client = await session(t), socket = relay();
  setInstanceRole("secondary"); setRelaySocket(socket);
  await call(client, "execute", { code: "target A", clientId: a.clientId });
  assert.equal(socket.messages.at(-1).targetClientId, a.clientId);
  const selected = call(client, "set-active-client", { clientId: b.clientId });
  for (let i = 0; i < 200 && socket.messages.at(-1).type !== "set-active-client"; i++) await delay(5);
  const request = socket.messages.at(-1);
  const resolve = secondaryResponseResolvers.get(request.id);
  assert.ok(resolve);
  resolve({ id: request.id, clientId: b.clientId, output: "selected B" });
  secondaryResponseResolvers.delete(request.id);
  await selected;
  await call(client, "execute", { code: "default B" });
  assert.equal(socket.messages.at(-1).targetClientId, b.clientId);

  const fetches = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    fetches.push(JSON.parse(options.body));
    return { json: async () => ({ result: "cached" }) };
  });
  await call(client, "script-grep", { clientId: a.clientId, query: "x" });
  await call(client, "semantic-search-scripts", { clientId: a.clientId, query: "x" });
  await call(client, "get-script-content", { clientId: a.clientId, scriptPath: "game.Shared" });
  assert.deepEqual(fetches.map(x => x.clientId), [a.clientId, a.clientId, a.clientId]);
  await call(client, "script-grep", { query: "x" });
  assert.equal(fetches.at(-1).clientId, b.clientId);
});
