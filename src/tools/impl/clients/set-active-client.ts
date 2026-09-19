import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerClientTool } from "../../client-routing.js";
import crypto from "crypto";
import { WebSocket } from "ws";
import { z } from "zod";
import {
  getInstanceRole,
  getRelaySocket,
  GetResponseOfIdFromClient,
} from "../../../bridge/handlers/shared/communication.js";
import { resolveTargetClient, setActiveClientId } from "../../../bridge/handlers/shared/registry.js";
import { toolTextResponse } from "../../factory.js";
import { NO_CLIENT_ERROR } from "../../errors.js";

export default function register(server: McpServer): void {
  registerClientTool(
    server,
    "set-active-client",
    {
      title: "Set active Roblox client",
      description:
        "Set the default Roblox client for this MCP session. For concurrent multi-client work, pass clientId on each tool call instead. Use list-clients to get IDs.",
      inputSchema: z.object({
        clientId: z
          .string()
          .trim()
          .min(1)
          .max(160)
          .describe(
            "The client ID to set as active. Use list-clients to get available client IDs."
          ),
      }),
    },
    async ({ clientId }) => {
      const normalizedClientId = clientId.trim();

      if (getInstanceRole() === "secondary") {
        const id = crypto.randomUUID();
        const socket = getRelaySocket();
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(
            JSON.stringify({
              id,
              type: "set-active-client",
              targetClientId: normalizedClientId,
            })
          );
          const response = await GetResponseOfIdFromClient(id);
          if (response?.error || !response?.output) {
            return toolTextResponse(response?.error ?? "Failed to set active client.", {}, true);
          }
          const selectedClientId =
            typeof response.clientId === "string" ? response.clientId : normalizedClientId;
          setActiveClientId(selectedClientId, { remote: true });
          return toolTextResponse(response.output);
        }
        return NO_CLIENT_ERROR;
      }

      const target = resolveTargetClient(normalizedClientId);
      if (!target) {
        return toolTextResponse(
          `Invalid or inactive client ID: ${normalizedClientId}. Use list-clients to get active client IDs.`,
          {},
          true
        );
      }

      setActiveClientId(target.clientId);
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Active client set to ${target.clientId} ` +
              `(${target.username} @ ${target.placeName}, ${target.transport}).`,
          },
        ],
      };
    }
  );
}
