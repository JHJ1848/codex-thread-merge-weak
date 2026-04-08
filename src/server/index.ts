import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseMergeProjectThreadsInput,
  parsePreviewProjectThreadsInput,
  parseRefreshProjectMemoryInput,
  serializeToolResult,
  TOOL_MERGE_PROJECT_THREADS,
  TOOL_PREVIEW_PROJECT_THREADS,
  TOOL_REFRESH_PROJECT_MEMORY,
} from "./protocol.js";
import { getToolDefinitions } from "./tools.js";
import { createDefaultUseCases, type ServerUseCases } from "./wiring.js";

function registerTools(server: McpServer, useCases: ServerUseCases): void {
  for (const tool of getToolDefinitions()) {
    server.registerTool(
      tool.name,
      {
        title: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (args: unknown) => {
        try {
          if (tool.name === TOOL_PREVIEW_PROJECT_THREADS) {
            const input = parsePreviewProjectThreadsInput(args);
            const output = await useCases.previewProjectThreads.execute(input);
            return {
              content: [{ type: "text", text: serializeToolResult(output) }],
            };
          }

          if (tool.name === TOOL_MERGE_PROJECT_THREADS) {
            const input = parseMergeProjectThreadsInput(args);
            const output = await useCases.mergeProjectThreads.execute(input);
            return {
              content: [{ type: "text", text: serializeToolResult(output) }],
            };
          }

          if (tool.name === TOOL_REFRESH_PROJECT_MEMORY) {
            const input = parseRefreshProjectMemoryInput(args);
            const output = await useCases.refreshProjectMemory.execute(input);
            return {
              content: [{ type: "text", text: serializeToolResult(output) }],
            };
          }

          return {
            content: [{ type: "text", text: `Unsupported tool: ${tool.name}` }],
            isError: true,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: message }],
            isError: true,
          };
        }
      },
    );
  }
}

export async function startServer(): Promise<void> {
  const useCases = createDefaultUseCases();
  const server = new McpServer({
    name: "codex-thread-merge-mcp",
    version: "0.1.0",
  });

  registerTools(server, useCases);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export function isMainModule(
  moduleUrl: string = import.meta.url,
  argvEntry: string | undefined = process.argv[1],
): boolean {
  if (!argvEntry) {
    return false;
  }

  const modulePath = fileURLToPath(moduleUrl);
  return path.resolve(modulePath) === path.resolve(argvEntry);
}

if (isMainModule()) {
  startServer().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
