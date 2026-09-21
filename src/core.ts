#!/usr/bin/env node

import { registerLocalDecompilerLifetime } from "./decompiler/local-process-lifetime.js";
import { loadDecompilerSettings } from "./decompiler/settings.js";
import { ensureConfiguredLocalDecompilerProvidersRunning } from "./http/routes/api/decompiler-settings/setup.js";
import { startAsPrimary } from "./bridge/handlers/server/primary.js";
import { installServerLogCapture } from "./http/server-logs.js";

installServerLogCapture();
registerLocalDecompilerLifetime();

startAsPrimary()
  .then(async () => {
    console.error("[Core] Background MCP core is ready.");
    try {
      const settings = await loadDecompilerSettings();
      await ensureConfiguredLocalDecompilerProvidersRunning(settings);
    } catch (error) {
      console.error(
        "[Core] Failed to auto-start local decompilers:",
        error instanceof Error ? error.message : error
      );
    }
  })
  .catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error("[Core] Another process already owns the MCP core port.");
    } else {
      console.error("[Core] Failed to start:", error);
    }
    process.exit(1);
  });
