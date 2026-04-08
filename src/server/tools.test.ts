import test from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getToolDefinitions } from "./tools.js";

test("tool definitions can be registered with the current MCP SDK", () => {
  const server = new McpServer({
    name: "codex-thread-merge-mcp-test",
    version: "0.1.0",
  });

  for (const tool of getToolDefinitions()) {
    assert.doesNotThrow(() => {
      server.registerTool(
        tool.name,
        {
          title: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        },
        async () => ({
          content: [{ type: "text", text: "ok" }],
        }),
      );
    });
  }
});
