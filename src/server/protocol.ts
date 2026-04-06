import type {
  MergeProjectThreadsInput,
  PreviewProjectThreadsInput,
  RefreshProjectMemoryInput,
} from "./use-cases.js";

export const TOOL_PREVIEW_PROJECT_THREADS = "preview_project_threads";
export const TOOL_MERGE_PROJECT_THREADS = "merge_project_threads";
export const TOOL_REFRESH_PROJECT_MEMORY = "refresh_project_memory";

function toObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function maybeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function maybeBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function parsePreviewProjectThreadsInput(
  args: unknown,
): PreviewProjectThreadsInput {
  const obj = toObject(args);
  return {
    cwd: maybeString(obj.cwd),
    includeArchived: maybeBoolean(obj.include_archived),
  };
}

export function parseMergeProjectThreadsInput(
  args: unknown,
): MergeProjectThreadsInput {
  const obj = toObject(args);
  return {
    cwd: maybeString(obj.cwd),
    includeArchived: maybeBoolean(obj.include_archived),
    writeMemory: maybeBoolean(obj.write_memory),
    compactOldThreads: maybeBoolean(obj.compact_old_threads),
    renameOldThreads: maybeBoolean(obj.rename_old_threads),
  };
}

export function parseRefreshProjectMemoryInput(
  args: unknown,
): RefreshProjectMemoryInput {
  const obj = toObject(args);
  return {
    cwd: maybeString(obj.cwd),
  };
}

export function serializeToolResult(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

