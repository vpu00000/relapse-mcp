import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { getInstanceRole } from "../bridge/handlers/shared/communication.js";
import {
  resolveTargetClient,
  withClientSelection,
  type ClientSelection,
} from "../bridge/handlers/shared/registry.js";
import { INVALID_CLIENT_ERROR, NO_CLIENT_ERROR } from "./errors.js";

const selections = new WeakMap<McpServer, ClientSelection>();
const clientIdSchema = z.string().trim().min(1).max(160).describe(
  "Target client ID (or unique prefix) from list-clients. Overrides this session's default for this call only; use for concurrent multi-client work."
);

export function registerClientTool<Shape extends z.ZodRawShape = {}>(
  server: McpServer,
  name: string,
  config: { title: string; description: string; inputSchema?: z.ZodObject<Shape> },
  callback: (args: z.output<z.ZodObject<Shape>>) => CallToolResult | Promise<CallToolResult>
): void {
  let selection = selections.get(server);
  if (!selection) {
    selection = {};
    selections.set(server, selection);
  }
  const sessionSelection = selection;
  const management = name === "list-clients" || name === "set-active-client";
  const schema = config.inputSchema ?? z.object({});
  const inputSchema = management ? schema : schema.extend({ clientId: clientIdSchema.optional() });

  server.registerTool(name, { ...config, inputSchema }, async (args) => {
    const requested = !management ? (args as { clientId?: string }).clientId : undefined;
    let clientId = requested ?? sessionSelection.clientId;
    if (!management && getInstanceRole() !== "secondary") {
      const target = resolveTargetClient(clientId);
      if (!target) return clientId ? INVALID_CLIENT_ERROR : NO_CLIENT_ERROR;
      clientId = target.clientId;
    }
    // Pin the target for the whole async call, including cache reads and result stamps.
    return withClientSelection(sessionSelection, clientId, () =>
      callback(args as z.output<z.ZodObject<Shape>>)
    );
  });
}
