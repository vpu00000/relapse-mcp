# Relapse MCP

Relapse MCP exposes the Roblox executor MCP tools through Relapse's local Unix socket. It runs as a stdio MCP server and does not require a separate HTTP core, WebSocket connector, dashboard, or manual in-game script execution.

It works alongside other Relapse UIs and socket clients, so you can keep your UI open while using MCP tools.

## Using a release

Requires Node.js 20 or newer with npm, and a running Relapse executor. Restart your MCP client after updating its configuration.

### JSON configuration

Add this to your MCP client's configuration:

```json
{
  "mcpServers": {
    "relapse": {
      "command": "npx",
      "args": [
        "-y",
        "--package=https://github.com/vpu00000/relapse-mcp/releases/download/v0.1.0/relapse-mcp-0.1.0.tgz",
        "relapse-mcp"
      ]
    }
  }
}
```

### Codex

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.relapse]
command = "npx"
args = [
  "-y",
  "--package=https://github.com/vpu00000/relapse-mcp/releases/download/v0.1.0/relapse-mcp-0.1.0.tgz",
  "relapse-mcp"
]
startup_timeout_sec = 60
```

The package includes the compiled server and bundled Luau. The first launch downloads its runtime dependencies. Darklua is not required to run it.

You can also use `--package=/absolute/path/to/relapse-mcp-0.1.0.tgz` for a downloaded package. Release URLs require the repository to be public for unauthenticated downloads.

## Development setup

Requires Node.js 20 or newer, [Darklua](https://darklua.com/docs/installation/) on your `PATH` (tested with 0.19.0), and a running Relapse executor. From this repository:

```sh
npm ci
npm run build
npm start
```

Edit the Luau modules under `connector-src/`. The build uses Darklua to bundle them into `connector.luau` and copies the result into `dist/`. Darklua is only needed to build; running the built MCP requires Node.js and Relapse.

Configure your MCP client to run `node /absolute/path/to/relapse-mcp/dist/index.js` as a stdio server. `RELAPSE_SOCKET_PATH` overrides the default `/tmp/relapse.sock` when needed. The process connects automatically when Relapse becomes available.

The MCP process connects to Relapse's `@main` channel to watch the current session and inject its bundled Luau handler. It then uses a private `RelapseChannel` for tool requests, replies, and script-source updates. The handler is re-injected after a session change. Relapse MCP is an independent socket client with no dependency on any UI. Other implementations can use `@main` and their own channels at the same time.

All 17 Upio MCP tool names and input schemas remain exposed. Script search and semantic search use an in-memory index of sources decompiled by the active Relapse session. Relapse's built-in `decompile` function is used; scripts that cannot be decompiled are reported as gaps in the index. The two OS window tools retain their Windows-only implementation.

Semantic search can use OpenAI-compatible embeddings or Ollama. Set `RELAPSE_MCP_EMBEDDING_PROVIDER` to `openai` or `ollama`. For OpenAI, set `RELAPSE_MCP_OPENAI_API_KEY` (or `OPENAI_API_KEY`); optional overrides are `RELAPSE_MCP_OPENAI_BASE_URL` and `RELAPSE_MCP_OPENAI_MODEL`. For Ollama, optional overrides are `RELAPSE_MCP_OLLAMA_BASE_URL` and `RELAPSE_MCP_OLLAMA_MODEL`.

## Testing

```sh
npm test
```

The integration test uses a mock Relapse Unix socket to exercise MCP tool registration, a second `@main` client, script indexing, request/reply routing, and session reinjection. With the `luau` CLI on your `PATH`, the tests also execute the bundled connector against a mocked Roblox environment. These tests do not replace a live Roblox session test.

## Creating a release

Set the version in `package.json` and `package-lock.json`, then commit and push the release changes. With the development prerequisites installed:

```sh
npm ci
npm pack
```

`npm pack` builds the project and runs the tests before writing `relapse-mcp-0.1.0.tgz`. Upload this file as a GitHub Release asset. The GitHub-generated source archives do not contain the built server.

To test the actual package through `npx` with a fresh npm cache and mock Relapse socket:

```sh
RELAPSE_MCP_TEST_PACKAGE="$PWD/relapse-mcp-0.1.0.tgz" node --test tests/relapse-runtime.test.mjs
```

For version `0.1.0`, using the GitHub CLI:

```sh
git tag v0.1.0
git push origin v0.1.0
gh release create v0.1.0 relapse-mcp-0.1.0.tgz --verify-tag --title v0.1.0 --notes "Relapse MCP 0.1.0"
```

Use the new version in the tag, filename, and MCP config for subsequent releases.

## Attribution

This project derives from [Upio's Roblox Executor MCP](https://gitlab.com/upio/roblox-executor-mcp). The original and modified code are distributed under the MIT license; see [LICENSE](LICENSE).
