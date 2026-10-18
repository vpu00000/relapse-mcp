import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { installBuildDependencies, resolveTypeScriptCompiler } from "../scripts/package-command.mjs";
import { runUpdateCommand } from "../scripts/update-runner.mjs";

test("an incomplete successful dependency install is repaired before building", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "roblox-mcp-build-deps-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manifest = JSON.stringify({ name: "build-deps-fixture", private: true, devDependencies: { typescript: "file:./compiler" } });
  await fs.writeFile(path.join(root, "package.json"), manifest);
  await fs.mkdir(path.join(root, "compiler", "bin"), { recursive: true });
  await fs.writeFile(path.join(root, "compiler", "package.json"), JSON.stringify({ name: "typescript", version: "1.0.0" }));
  await fs.writeFile(path.join(root, "compiler", "bin", "tsc"), 'console.log("compiler ready");\n');
  const calls = [];
  await installBuildDependencies("bun", { cwd: root }, async (command, args, options) => {
    calls.push([command, args]);
    if (command === "bun") return "success, but compiler omitted";
    return runUpdateCommand(command, args, {
      ...options,
      env: { ...process.env, NODE_ENV: "production", npm_config_omit: "dev" },
    });
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1][0], "npm");
  const compiler = spawnSync(process.execPath, [resolveTypeScriptCompiler(root)], { encoding: "utf8" });
  assert.equal(compiler.status, 0, compiler.stderr);
  assert.match(compiler.stdout, /compiler ready/);
  assert.equal(await fs.readFile(path.join(root, "package.json"), "utf8"), manifest);
  await assert.rejects(fs.access(path.join(root, "package-lock.json")));
  await installBuildDependencies("bun", { cwd: root }, async () => calls.push("primary success"));
  assert.equal(calls.length, 3, "a complete install must not trigger npm repair");
});

test("compiler resolution supports a parent workspace node_modules directory", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "roblox-mcp-hoisted-compiler-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const app = path.join(root, "app");
  const compiler = path.join(root, "node_modules", "typescript", "bin", "tsc");
  await fs.mkdir(path.dirname(compiler), { recursive: true });
  await fs.writeFile(compiler, "process.exit(0);\n");
  await fs.mkdir(app);
  await fs.writeFile(path.join(app, "package.json"), "{}");
  assert.equal(resolveTypeScriptCompiler(app), await fs.realpath(compiler));
});

test("missing compiler leaves the existing build intact and dry runs do not install repairs", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "roblox-mcp-missing-compiler-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "scripts"));
  await fs.mkdir(path.join(root, "dist"));
  await fs.writeFile(path.join(root, "package.json"), '{"type":"module"}');
  await fs.writeFile(path.join(root, "dist", "existing.txt"), "keep");
  for (const name of ["build-server.mjs", "package-command.mjs"]) {
    await fs.copyFile(new URL(`../scripts/${name}`, import.meta.url), path.join(root, "scripts", name));
  }
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "build-server.mjs")], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /npm install --include=dev --ignore-scripts/);
  assert.equal(await fs.readFile(path.join(root, "dist", "existing.txt"), "utf8"), "keep");
  const calls = [];
  await installBuildDependencies("bun", { cwd: root, dryRun: true }, async command => calls.push(command));
  assert.deepEqual(calls, ["bun"]);
});
