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

function parseRequiredStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`"${fieldName}" is required and must be a non-empty string array.`);
  }

  const normalized = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (normalized.length === 0) {
    throw new Error(`"${fieldName}" is required and must be a non-empty string array.`);
  }

  return Array.from(new Set(normalized));
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
  const selectedThreadIds = parseRequiredStringArray(
    obj.selectedThreadIds ?? obj.selected_thread_ids,
    "selectedThreadIds",
  );
  return {
    cwd: maybeString(obj.cwd),
    selectedThreadIds,
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

