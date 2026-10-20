import fs from "node:fs";

const { name, version } = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")
) as { name: string; version: string };

export const SERVER_NAME = process.env.RELAPSE_MCP_SERVER_NAME || name;
export const SERVER_VERSION = version;
