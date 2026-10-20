import crypto from "node:crypto";
import { runtime } from "../../../relapse/runtime.js";
import { upsertScriptSources, clearScriptSourceIndex } from "./script-source-store.js";
import type { RobloxResponse, DispatchResult, ResponseResolver } from "../../types.js";
import { resolveTargetClient } from "./registry.js";

const resolvers = new Map<string, ResponseResolver>();
let currentClientId: string | null = null;

runtime.on("client", (client: { clientId: string } | null, previous: { clientId: string } | null) => {
  if (previous && previous.clientId !== client?.clientId) {
    clearScriptSourceIndex(previous.clientId);
    for (const [id, resolve] of resolvers) resolve({ id, error: "Relapse MCP channel disconnected while the request was running." });
    resolvers.clear();
  }
  currentClientId = client?.clientId ?? null;
});
runtime.on("session", () => {
  for (const [id, resolve] of resolvers) resolve({ id, error: "Relapse session changed while the request was running." });
  resolvers.clear();
});
runtime.on("message", (message: Record<string, unknown>) => {
  if (message.type === "script-sources") {
    const client = runtime.activeClient;
    if (!client || client.clientId !== currentClientId) return;
    try {
      upsertScriptSources({ clientId: client.clientId, placeId: client.placeId, jobId: client.jobId }, {
        scripts: Array.isArray(message.scripts) ? message.scripts as [] : [],
        hasFinishedMapping: message.hasFinishedMapping === true,
        sourcesToMap: Number(message.sourcesToMap ?? 0),
        processedSources: Number(message.processedSources ?? 0),
        skippedSources: Number(message.skippedSources ?? 0),
        mappingSessionId: message.mappingSessionId,
        mappingSessionStartedAt: message.mappingSessionStartedAt,
        mappingRevision: message.mappingRevision,
        beginMappingSession: message.beginMappingSession,
      });
    } catch (error) {
      console.error("[Relapse] Failed to index script sources:", error);
    }
    return;
  }
  if (typeof message.id !== "string") return;
  const resolver = resolvers.get(message.id);
  if (!resolver) return;
  resolvers.delete(message.id);
  resolver(message as RobloxResponse);
});

export function SendArbitraryDataToClient(
  type: string, data: Record<string, unknown>, id?: string, clientId?: string
): DispatchResult {
  const target = resolveTargetClient(clientId);
  if (!target) return clientId ? "INVALID_CLIENT" : null;
  const requestId = id ?? crypto.randomUUID();
  try { runtime.send(type, data, requestId); }
  catch (error) {
    console.error("[Relapse] Could not send command:", error);
    return null;
  }
  return requestId;
}

export function GetResponseOfIdFromClient(id: string, timeoutMs = 15_000): Promise<RobloxResponse> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolvers.delete(id);
      resolve({ id, error: `Timed out waiting for response after ${timeoutMs}ms.` });
    }, timeoutMs);
    resolvers.set(id, (response) => { clearTimeout(timeout); resolve(response); });
  });
}
