import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { FramedSocket } from "./framed-socket.js";

export interface RelapseClientInfo {
  clientId: string;
  username: string;
  userId: number;
  placeId: number;
  jobId: string;
  placeName: string;
  session: number;
}

const CONNECTOR_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../connector.luau");
const BOOT_TIMEOUT_MS = 12_000;

export class RelapseRuntime extends EventEmitter {
  private main: FramedSocket | null = null;
  private bridge: FramedSocket | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private generation = 0;
  private booting = false;
  private scriptId = 1;
  private session = 0;
  private ready = false;
  private client: RelapseClientInfo | null = null;
  readonly channelName = `relapse.mcp.${crypto.randomUUID()}`;

  constructor(readonly socketPath = process.env.RELAPSE_SOCKET_PATH || "/tmp/relapse.sock") {
    super();
  }

  get activeClient(): RelapseClientInfo | null { return this.client; }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.connectMain();
  }

  stop(): void {
    this.running = false;
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.bridge?.close();
    this.main?.close();
    this.bridge = this.main = null;
    this.setClient(null);
  }

  send(type: string, data: Record<string, unknown>, id: string): void {
    if (!this.bridge?.isOpen || !this.client) throw new Error("Relapse MCP channel is unavailable");
    this.bridge.send({ id, type, ...data });
  }

  private setClient(value: RelapseClientInfo | null): void {
    const previous = this.client;
    this.client = value;
    if (previous?.clientId !== value?.clientId) this.emit("client", value, previous);
  }

  private scheduleReconnect(): void {
    if (!this.running || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.connectMain();
    }, 1000);
  }

  private async connectMain(): Promise<void> {
    if (!this.running || this.main) return;
    const socket = new FramedSocket(this.socketPath, "@main");
    this.main = socket;
    socket.on("error", () => {});
    socket.on("message", (message) => this.onMainMessage(message));
    socket.on("close", () => {
      if (this.main !== socket) return;
      this.main = null;
      this.newSession(0, false);
      this.scheduleReconnect();
    });
    try { await socket.connect(); }
    catch { if (this.main === socket) { this.main = null; this.scheduleReconnect(); } }
  }

  private onMainMessage(message: Record<string, unknown>): void {
    if (message.type === "hello" || message.type === "status") {
      const session = typeof message.session === "number" && Number.isSafeInteger(message.session) ? message.session : 0;
      const ready = message.ready === true && session > 0;
      if (session !== this.session || ready !== this.ready) this.newSession(session, ready);
      return;
    }
    if (message.type === "exec_result") this.emit("exec_result", message);
  }

  private newSession(session: number, ready: boolean): void {
    this.generation++;
    this.session = session;
    this.ready = ready;
    this.booting = false;
    this.emit("session", session, ready);
    this.setClient(null);
    this.bridge?.close();
    this.bridge = null;
    if (ready) void this.bootstrap(this.generation);
  }

  private async bootstrap(generation: number): Promise<void> {
    if (this.booting || !this.main?.isOpen || !this.ready || generation !== this.generation) return;
    this.booting = true;
    try {
      const source = `local __relapse_mcp_channel = ${JSON.stringify(this.channelName)}\n` +
        fs.readFileSync(CONNECTOR_PATH, "utf8");
      const scriptId = this.scriptId++;
      const submitted = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { cleanup(); reject(new Error("Bootstrap submission timed out")); }, BOOT_TIMEOUT_MS);
        const onResult = (message: Record<string, unknown>) => {
          if (message.script_id !== scriptId) return;
          cleanup();
          if (message.phase === "submitted") resolve();
          else reject(new Error(String(message.detail ?? "Bootstrap rejected")));
        };
        const cleanup = () => { clearTimeout(timeout); this.off("exec_result", onResult); };
        this.on("exec_result", onResult);
        try { this.main!.send({ op: "execute", script_id: scriptId, session: this.session,
          name: "relapse-mcp.luau", source }); }
        catch (error) { cleanup(); reject(error); }
      });
      await submitted;
      const deadline = Date.now() + BOOT_TIMEOUT_MS;
      while (this.running && generation === this.generation && Date.now() < deadline) {
        const channel = new FramedSocket(this.socketPath, this.channelName);
        channel.on("error", () => {});
        channel.on("message", (message) => this.onBridgeMessage(message, generation));
        try {
          await channel.connect();
          if (generation !== this.generation) { channel.close(); return; }
          this.bridge = channel;
          channel.on("close", () => {
            if (this.bridge !== channel) return;
            this.bridge = null;
            this.setClient(null);
            if (this.running && generation === this.generation) {
              setTimeout(() => void this.bootstrap(generation), 500);
            }
          });
          return;
        } catch { channel.close(); }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      throw new Error("Luau channel did not publish");
    } catch (error) {
      if (generation === this.generation) {
        console.error(`[Relapse] ${error instanceof Error ? error.message : error}`);
        setTimeout(() => void this.bootstrap(generation), 1000);
      }
    } finally { if (generation === this.generation) this.booting = false; }
  }

  private onBridgeMessage(message: Record<string, unknown>, generation: number): void {
    if (generation !== this.generation) return;
    if (message.type === "hello") {
      const value = message.client;
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      const info = value as Record<string, unknown>;
      this.setClient({
        clientId: `${this.session}:${String(info.jobId ?? "")}`,
        username: String(info.username ?? "Unknown"),
        userId: Number(info.userId ?? 0),
        placeId: Number(info.placeId ?? 0),
        jobId: String(info.jobId ?? ""),
        placeName: String(info.placeName ?? "Unknown"),
        session: this.session,
      });
      return;
    }
    this.emit("message", message);
  }
}

export const runtime = new RelapseRuntime();
