import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerClientTool } from "../../client-routing.js";
import { resolveTargetClient, setActiveClientId } from "../../../bridge/handlers/shared/registry.js";
import { toolTextResponse } from "../../factory.js";

export default function register(server: McpServer): void {
  registerClientTool(server, "set-active-client", {
    title: "Set active Roblox client",
    description: "Set the default Roblox client for this MCP session. For concurrent multi-client work, pass clientId on each tool call instead. Use list-clients to get IDs.",
    inputSchema: z.object({ clientId: z.string().trim().min(1).max(160)
      .describe("The client ID to set as active. Use list-clients to get available client IDs.") }),
  }, async ({ clientId }) => {
    const target = resolveTargetClient(clientId.trim());
    if (!target) return toolTextResponse(`Invalid or inactive client ID: ${clientId}. Use list-clients to get active client IDs.`, {}, true);
    setActiveClientId(target.clientId);
    return toolTextResponse(`Active client set to ${target.clientId} (${target.username} @ ${target.placeName}, ${target.transport}).`);
  });
}
