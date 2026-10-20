import net from "node:net";
import { EventEmitter } from "node:events";

const MAX_FRAME = 8 * 1024 * 1024;

export class FramedSocket extends EventEmitter {
  private socket: net.Socket | null = null;
  private buffer = Buffer.alloc(0);
  private opened = false;
  private maxMessageBytes = MAX_FRAME;

  constructor(private readonly path: string, private readonly channel: string) {
    super();
  }

  get isOpen(): boolean { return this.opened; }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.path);
      this.socket = socket;
      let settled = false;
      const timeout = setTimeout(() => fail(new Error("Relapse channel handshake timed out")), 5000);
      const fail = (error: Error) => {
        if (!settled) { settled = true; clearTimeout(timeout); reject(error); }
        this.close();
      };
      socket.once("connect", () => this.writeFrame({ version: 1, channel: this.channel }));
      socket.on("data", (chunk: Buffer) => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        while (this.buffer.length >= 4) {
          const length = this.buffer.readUInt32BE(0);
          if (length > MAX_FRAME) { fail(new Error("Relapse frame exceeds 8 MiB")); return; }
          if (this.buffer.length < length + 4) break;
          const body = this.buffer.subarray(4, length + 4);
          this.buffer = this.buffer.subarray(length + 4);
          let message: Record<string, unknown>;
          try {
            const parsed: unknown = JSON.parse(body.toString("utf8"));
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected object");
            message = parsed as Record<string, unknown>;
          } catch { fail(new Error("Invalid Relapse JSON frame")); return; }
          if (!this.opened) {
            if (message.ok !== true || message.version !== 1 ||
                typeof message.max_message_bytes !== "number" || message.max_message_bytes <= 0) {
              fail(new Error(String(message.error ?? "Relapse channel handshake rejected")));
              return;
            }
            this.maxMessageBytes = Math.min(MAX_FRAME, message.max_message_bytes);
            this.opened = true;
            if (!settled) { settled = true; clearTimeout(timeout); resolve(); }
          } else {
            this.emit("message", message);
          }
        }
      });
      socket.on("error", (error) => { if (!settled) fail(error); else this.emit("error", error); });
      socket.on("close", () => {
        this.opened = false;
        this.socket = null;
        if (!settled) { settled = true; clearTimeout(timeout); reject(new Error("Relapse socket closed during handshake")); }
        this.emit("close");
      });
    });
  }

  private writeFrame(value: unknown): void {
    if (!this.socket || this.socket.destroyed) throw new Error("Relapse socket is closed");
    const body = Buffer.from(JSON.stringify(value), "utf8");
    if (body.length > this.maxMessageBytes) throw new Error("Relapse message exceeds channel limit");
    if (this.socket.writableLength + body.length + 4 > 16 * 1024 * 1024) {
      throw new Error("Relapse socket send queue is full");
    }
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32BE(body.length);
    this.socket.write(header);
    this.socket.write(body);
  }

  send(value: unknown): void {
    if (!this.opened) throw new Error("Relapse channel is not open");
    this.writeFrame(value);
  }

  close(): void { this.socket?.destroy(); }
}
