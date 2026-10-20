import { AsyncLocalStorage } from "node:async_hooks";
import { runtime, type RelapseClientInfo } from "../../../relapse/runtime.js";

export interface ClientSelection { clientId?: string }
export interface RobloxClient extends RelapseClientInfo { transport: "relapse" }

const context = new AsyncLocalStorage<{ selection: ClientSelection; clientId?: string }>();
let activeClientId: string | undefined;

export function withClientSelection<T>(selection: ClientSelection, clientId: string | undefined, callback: () => T): T {
  return context.run({ selection, clientId }, callback);
}

export function getActiveClientId(): string | undefined {
  const current = context.getStore();
  if (current) return current.clientId;
  return activeClientId;
}

export function setActiveClientId(clientId: string): void {
  const current = context.getStore();
  if (current) { current.selection.clientId = clientId; current.clientId = clientId; }
  else activeClientId = clientId;
}

export function getActiveClients(): RobloxClient[] {
  const client = runtime.activeClient;
  return client ? [{ ...client, transport: "relapse" }] : [];
}

export function resolveTargetClient(clientId?: string): RobloxClient | null {
  const client = getActiveClients()[0];
  if (!client) return null;
  if (!clientId || client.clientId === clientId || client.clientId.startsWith(clientId.trim())) return client;
  return null;
}

export function formatActiveClientListForTool(selected = getActiveClientId()): string {
  const clients = getActiveClients();
  if (!clients.length) return "No Roblox clients are currently connected.";
  return clients.map((client) =>
    `${client.clientId === selected ? "* " : "  "}${client.clientId} | ${client.username} @ ${client.placeName} ` +
    `(place=${client.placeId} job=${client.jobId} relapse)`
  ).join("\n");
}
