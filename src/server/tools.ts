import {
  TOOL_MERGE_PROJECT_THREADS,
  TOOL_PREVIEW_PROJECT_THREADS,
  TOOL_REFRESH_PROJECT_MEMORY,
} from "./protocol.js";

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export function getToolDefinitions(): McpToolDefinition[] {
  return [
    {
      name: TOOL_PREVIEW_PROJECT_THREADS,
      description:
        "Discover project-related Codex threads for the current cwd before merge.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          cwd: {
            type: "string",
            description:
              "Optional project root override. Defaults to the server process cwd.",
          },
          include_archived: {
            type: "boolean",
            description: "Whether archived threads should be included.",
            default: false,
          },
        },
      },
    },
    {
      name: TOOL_MERGE_PROJECT_THREADS,
      description:
        "Merge project threads into one canonical thread and optionally update MEMORY.md.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          cwd: {
            type: "string",
            description:
              "Optional project root override. Defaults to the server process cwd.",
          },
          include_archived: {
            type: "boolean",
            description: "Whether archived threads should be included.",
            default: false,
          },
          write_memory: {
            type: "boolean",
            description: "Whether to update project MEMORY.md.",
            default: true,
          },
          compact_old_threads: {
            type: "boolean",
            description: "Whether merged source threads should be compacted.",
            default: true,
          },
          rename_old_threads: {
            type: "boolean",
            description: "Whether merged source threads should get [Merged] tag.",
            default: true,
          },
        },
      },
    },
    {
      name: TOOL_REFRESH_PROJECT_MEMORY,
      description:
        "Refresh only MEMORY.md from current project merged state without creating a new canonical thread.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          cwd: {
            type: "string",
            description:
              "Optional project root override. Defaults to the server process cwd.",
          },
        },
      },
    },
  ];
}

