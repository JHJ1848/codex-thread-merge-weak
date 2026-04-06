declare module "@modelcontextprotocol/sdk/server/mcp.js" {
  export class McpServer {
    public constructor(info: { name: string; version: string });
    public registerTool(
      name: string,
      config: {
        title: string;
        description: string;
        inputSchema: Record<string, unknown>;
      },
      handler: (args: unknown) => Promise<{
        content: Array<{ type: "text"; text: string }>;
        isError?: boolean;
      }>,
    ): void;
    public connect(transport: unknown): Promise<void>;
  }
}

declare module "@modelcontextprotocol/sdk/server/stdio.js" {
  export class StdioServerTransport {
    public constructor();
  }
}
