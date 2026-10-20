import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerClientTool } from "../../client-routing.js";
import { formatActiveClientListForTool } from "../../../bridge/handlers/shared/registry.js";

export default function register(server: McpServer): void {
  registerClientTool(server, "list-clients", {
    title: "List connected Roblox clients",
    description: "List connected Roblox game clients with clientId and session metadata. Use before set-active-client when multiple clients are connected or the target client is unknown.",
  }, async () => ({ content: [{ type: "text", text: formatActiveClientListForTool() }] }));
}
