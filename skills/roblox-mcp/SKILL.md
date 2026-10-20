---
name: roblox-mcp
description: Inspect, search, debug, and intentionally modify a Roblox client through Relapse MCP. Use for live instance or script inspection, Luau data probes, garbage-collector searches, remote inspection, client-side execution, Roblox UI interaction, and Roblox window capture.
---

# Roblox MCP

Use the connected MCP server's live tool schemas as the source of truth for names, parameters, defaults, and limits.

## Core decision rules

Apply these defaults unless the task meets an exception in [references/runtime-patterns.md](references/runtime-patterns.md):

1. Prefer a specialized read tool over arbitrary Luau.
2. Use `search-instances` for filtered instance discovery. It runs `QueryDescendants`; do not fetch every descendant and filter it manually.
3. In custom Luau, use `QueryDescendants` for selector-expressible instance filters instead of a `GetDescendants()` scan.
4. Use `filtergc` for garbage-collector searches instead of iterating `getgc`.
5. Use `get-data-by-code` when the task needs values returned from Luau. Return compact raw Lua values; do not print data through `execute` or JSON-encode it manually.
6. Use `execute` or `execute-file` only for intentional side effects or code that does not need to return data. Verify the effect with a focused read.

## Operating workflow

1. Select the client. Call `list-clients` when the target is unclear or multiple clients may exist, then call `set-active-client` if needed.
2. Narrow with the cheapest specialized tool:
   - Structure or instances: `search-instances`, or `get-descendants-tree` with `summaryOnly=true`.
   - Known text or identifier: `script-grep`.
   - Unknown implementation with known behavior: `semantic-search-scripts`.
   - Source: `get-script-content` with a focused line range.
   - Arbitrary compact values: `get-data-by-code`.
3. Reduce the root, selector, range, filters, and limit before increasing any output budget.
4. For GC or custom instance probes, follow [references/runtime-patterns.md](references/runtime-patterns.md).
5. Mutate only when the user's request authorizes mutation. Use `execute` or `execute-file`, then verify the resulting state with a specialized read, a targeted `get-data-by-code` probe, or a small console read.
6. For remotes, call `remote-spy` with `operation=list`, a small limit, and `summaryOnly=true` before requesting arguments or changing capture state.
7. Report the observed result. Distinguish scheduled execution from verified state.

Read [references/functions.md](references/functions.md) when choosing among tools. Read [references/bad-practices.md](references/bad-practices.md) before broad inspection, arbitrary Luau, remote-state changes, or client mutation.
