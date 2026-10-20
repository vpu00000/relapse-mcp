import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { SERVER_NAME, SERVER_VERSION } from "../config.js";
import { registerAllTools } from "../tools/index.js";

const INSTRUCTIONS = [
  "Relapse MCP server. Recommended workflow to keep results small and accurate:",
  "1. Call list-clients to identify the active Relapse session. Each MCP process connects to one Relapse socket; pass clientId to target the reported session explicitly. OS window tools use pid instead.",
  "2. Explore structure cheaply first: get-descendants-tree (summaryOnly) or search-instances with a tight selector and low limit; widen only when needed.",
  "3. Find code with script-grep (exact identifiers/regex) or semantic-search-scripts (behavior); then read just the relevant range with get-script-content (use startLine/endLine).",
  "4. Use get-data-by-code only for small, targeted value probes — prefer the specialized inspection tools above, and have the returned code return compact values, never whole instances or large tables.",
  "5. After execute / execute-file, verify effects with a small get-console-output (low limit) or a targeted get-data-by-code probe.",
  "6. Keep tool outputs lean: prefer summaryOnly, filters, and low limits; only raise maxOutputChars when a single result truly needs it. Large/raw outputs degrade reasoning quality.",
  "7. For remote spying, use remote-spy with operation=list first. Start with summaryOnly=true and a low limit; narrow by name before requesting call arguments or changing block/ignore state.",
].join("\n");

export function createMcpServer(serverName = SERVER_NAME): McpServer {
  const server = new McpServer(
    {
      name: serverName,
      version: SERVER_VERSION,
      description:
        "Expose MCP tools for inspecting, executing Luau in, and interacting with the active Relapse Roblox session.",
    },
    { instructions: INSTRUCTIONS }
  );
  registerAllTools(server);
  return server;
}
