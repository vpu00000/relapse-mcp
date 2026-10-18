import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runUpdateCommand } from "../scripts/update-runner.mjs";

test("updater package scripts find Node with a background service PATH", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "roblox-mcp-update-path-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PATH"));
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  env[pathKey] = root;
  env.ROBLOX_MCP_TEST_VALUE = "preserved";
  const source = [
    'const { spawnSync } = require("node:child_process");',
    'const result = spawnSync("node --version", { shell: true, encoding: "utf8" });',
    'process.stdout.write(result.stdout || "");',
    'process.stderr.write(result.stderr || "");',
    'if (result.status !== 0) process.exit(result.status || 1);',
    'console.log(process.env.CI, process.env.ROBLOX_MCP_TEST_VALUE);',
  ].join("\n");
  const before = spawnSync(process.execPath, ["-e", source], { cwd: root, env, encoding: "utf8" });
  assert.notEqual(before.status, 0, "the fixture must reproduce Node missing from PATH");

  const output = await runUpdateCommand(process.execPath, ["-e", source], { cwd: root, env });
  assert.ok(output.includes(process.version));
  assert.match(output, /true preserved/);
  assert.equal(env[pathKey], root, "the caller's environment must not be mutated");
});
