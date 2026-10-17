import type { WebSocket } from "ws";
import { handleRobloxResponse } from "../../bridge/handlers/shared/communication.js";
import {
  detachClientSocket,
  getClientIdByWs,
  registerClient,
} from "../../bridge/handlers/shared/registry.js";
import type { RobloxResponse } from "../../bridge/types.js";

const HEARTBEAT_CHECK_MS = 10000;
const HEARTBEAT_STALE_MS = 30000;

interface RegisterMessage {
  type: "register";
  username?: string;
  userId?: number;
  placeId?: number;
  jobId?: string;
  placeName?: string;
  sessionId?: string;
}

interface PingMessage {
  type: "ping";
}

export function WS(ws: WebSocket): void {
  console.error("[Primary] Roblox client connected via WebSocket (awaiting registration).");

  let lastMessageAt = Date.now();
  let usesHeartbeat = false;
  const heartbeat = setInterval(() => {
    if (!usesHeartbeat || Date.now() - lastMessageAt < HEARTBEAT_STALE_MS) {
      return;
    }

    console.error("[Primary] Roblox WebSocket heartbeat timed out; closing stale socket.");
    ws.terminate();
  }, HEARTBEAT_CHECK_MS);
  heartbeat.unref();

  ws.on("message", (rawData) => {
    lastMessageAt = Date.now();
    try {
      const data = JSON.parse(rawData.toString()) as RegisterMessage | PingMessage | RobloxResponse;

      if ((data as PingMessage).type === "ping") {
        usesHeartbeat = true;
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }

      if ((data as RegisterMessage).type === "register") {
        const info = data as RegisterMessage;
        const clientId = registerClient({
          username: info.username || "Unknown",
          userId: info.userId || 0,
          placeId: info.placeId || 0,
          jobId: info.jobId || "",
          placeName: info.placeName || "Unknown",
          sessionId: info.sessionId,
          transport: "ws",
          ws,
        });
        ws.send(JSON.stringify({ type: "registered", clientId }));
        return;
      }

      handleRobloxResponse(data as RobloxResponse);
    } catch (e) {
      console.error("[Primary] Error parsing Roblox WS message:", e);
    }
  });

  ws.on("error", (err) => {
    console.error("[Primary] Roblox WebSocket error:", err.message);
  });

  ws.on("close", () => {
    clearInterval(heartbeat);
    const clientId = getClientIdByWs(ws);
    if (clientId) detachClientSocket(clientId, ws);
    console.error("[Primary] Roblox client disconnected.");
  });
}