import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  enumRobloxWindows,
  isSupported,
} from "../../../platform/windows-screenshot.js";

export default function register(server: McpServer): void {
  server.registerTool(
    "list-roblox-windows",
    {
      title: "List visible Roblox windows",
      description:
        "List visible Roblox OS windows with PIDs. Use before screenshot-window when multiple Roblox windows may be open.",
      inputSchema: z.object({}),
    },
    async () => {
      if (!isSupported()) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Window enumeration is only supported on Windows. Current platform: " + process.platform,
            },
          ],
          isError: true,
        };
      }

      const wins = enumRobloxWindows();
      if (wins.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No visible Roblox windows found." }],
        };
      }

      const listing = wins.map((w) => `PID ${w.pid} — "${w.title}"`).join("\n");
      return { content: [{ type: "text" as const, text: listing }] };
    }
  );
}
