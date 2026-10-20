import type { ToolTextResponse } from "./factory.js";

export const NO_CLIENT_ERROR: ToolTextResponse = {
  content: [
    {
      type: "text",
      text: "Relapse has no ready Roblox session or its MCP channel is still connecting. Start the game and retry shortly.",
    },
  ],
  isError: true,
};

export const INVALID_CLIENT_ERROR: ToolTextResponse = {
  content: [
    {
      type: "text",
      text: "Invalid client ID provided. Please use the list-clients tool to get a list of valid client IDs.",
    },
  ],
  isError: true,
};
