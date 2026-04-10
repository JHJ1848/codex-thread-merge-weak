import { z } from "zod";
import {
  TOOL_MERGE_PROJECT_THREADS,
  TOOL_PREVIEW_PROJECT_THREADS,
  TOOL_REFRESH_PROJECT_MEMORY,
} from "./protocol.js";

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
}

export function getToolDefinitions(): McpToolDefinition[] {
  return [
    {
      name: TOOL_PREVIEW_PROJECT_THREADS,
      description:
        "Discover project-related Codex threads for the current cwd before merge.",
      inputSchema: {
        cwd: z
          .string()
          .optional()
          .describe("Optional project root override. Defaults to the server process cwd."),
        include_archived: z
          .boolean()
          .optional()
          .describe("Whether archived threads should be included."),
      },
    },
    {
      name: TOOL_MERGE_PROJECT_THREADS,
      description:
        "Merge project threads into one canonical thread, refresh .codex/codex-thread-merge/MEMORY.md, and persist per-session memory files.",
      inputSchema: {
        cwd: z
          .string()
          .optional()
          .describe("Optional project root override. Defaults to the server process cwd."),
        selectedThreadIds: z
          .array(z.string().min(1))
          .min(1)
          .describe("Required thread ids selected by user for this merge."),
        include_archived: z
          .boolean()
          .optional()
          .describe("Whether archived threads should be included."),
        write_memory: z
          .boolean()
          .optional()
          .describe("Whether to update project MEMORY.md."),
        compact_old_threads: z
          .boolean()
          .optional()
          .describe("Whether merged source threads should be compacted. Defaults to false."),
        rename_old_threads: z
          .boolean()
          .optional()
          .describe("Whether merged source threads should get [Merged] tag. Defaults to false."),
      },
    },
    {
      name: TOOL_REFRESH_PROJECT_MEMORY,
      description:
        "Refresh .codex/codex-thread-merge/MEMORY.md and per-session memory files without creating a new canonical thread.",
      inputSchema: {
        cwd: z
          .string()
          .optional()
          .describe("Optional project root override. Defaults to the server process cwd."),
      },
    },
  ];
}

