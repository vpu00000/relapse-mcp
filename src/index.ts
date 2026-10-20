#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcp/server.js";
import { runtime } from "./relapse/runtime.js";

const server = createMcpServer();
const transport = new StdioServerTransport();
runtime.start();

process.on("SIGINT", () => { runtime.stop(); void server.close(); });
process.on("SIGTERM", () => { runtime.stop(); void server.close(); });
process.stdin.on("end", () => { runtime.stop(); void server.close(); });

await server.connect(transport);
