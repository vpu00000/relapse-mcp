#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
fs.rmSync(dist, { recursive: true, force: true });
const compiler = path.join(root, "node_modules", "typescript", "bin", "tsc");
const result = spawnSync(process.execPath, [compiler], { cwd: root, stdio: "inherit" });
if (result.status !== 0) process.exit(result.status || 1);
fs.copyFileSync(path.join(root, "connector.luau"), path.join(dist, "connector.luau"));
fs.chmodSync(path.join(dist, "index.js"), 0o755);
