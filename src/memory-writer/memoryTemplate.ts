import type { DecisionConflict, MergedProjectState } from "../shared/merge-types.js";

const START_MARKER = "<!-- managed:start:codex-thread-merge -->";
const END_MARKER = "<!-- managed:end:codex-thread-merge -->";
const MERGE_HISTORY_HEADING = "## Merge History";

export interface MemoryMergeHistoryEntry {
  mergedAt: string;
  canonicalThreadId?: string;
  canonicalThreadName?: string;
  canonicalTurnId?: string;
  canonicalTurnStatus?: string;
  canonicalThreadResumeVerified?: boolean;
  canonicalThreadResumeVerificationMessage?: string;
  contextPath?: string;
  memoryPath?: string;
  recordLogPath?: string;
  selectedThreadIds?: string[];
  sessionMemoryDir?: string;
  sessionContextDir?: string;
  mergedSessionCount?: number;
  skippedSessionCount?: number;
  warnings?: string[];
}

interface ManagedBlockOptions {
  historyBody?: string;
}

function formatConflicts(conflicts: DecisionConflict[]): string[] {
  return conflicts.map(
    (conflict) =>
      `决策冲突：${conflict.topic}；建议基线：${conflict.recommended}；证据：${conflict.statements.join(" | ")}`,
  );
}

function asBulletList(items: string[], emptyText = "暂无"): string {
  if (items.length === 0) {
    return `- ${emptyText}`;
  }
  return items.map((item) => `- ${item}`).join("\n");
}

export function getMemoryManagedBlock(
  state: MergedProjectState,
  options: ManagedBlockOptions = {},
): string {
  const riskLines = [...state.risksAndConflicts, ...formatConflicts(state.conflicts)];
  const historyBody = options.historyBody?.trim() || "- none";

  return [
    START_MARKER,
    `> generatedAt: ${state.generatedAt}`,
    `> projectName: ${state.projectName}`,
    "",
    "## 项目目标",
    asBulletList(state.projectGoals),
    "",
    "## 当前状态",
    asBulletList(state.currentState),
    "",
    "## 已确认决策",
    asBulletList(state.confirmedDecisions),
    "",
    "## 风险与冲突",
    asBulletList(riskLines),
    "",
    "## 来源会话",
    asBulletList(
      state.sourceThreads.map((thread) =>
        `${thread.threadId}${thread.name ? ` (${thread.name})` : ""}${thread.updatedAt ? ` | updatedAt=${thread.updatedAt}` : ""}`,
      ),
    ),
    "",
    MERGE_HISTORY_HEADING,
    historyBody,
    END_MARKER,
    "",
  ].join("\n");
}

export function formatMergeHistoryEntry(entry: MemoryMergeHistoryEntry): string {
  const warnings = entry.warnings?.filter((warning) => warning.trim().length > 0) ?? [];
  const selectedThreadIds = entry.selectedThreadIds?.filter((threadId) => threadId.trim().length > 0) ?? [];
  const sessionContextDir = entry.sessionContextDir ?? entry.sessionMemoryDir;

  return [
    `### ${entry.mergedAt}`,
    `- canonicalThread: ${formatCanonicalThread(entry)}`,
    `- canonicalTurn: ${entry.canonicalTurnId ?? "unknown"} (${entry.canonicalTurnStatus ?? "unknown"})`,
    `- resumeVerified: ${formatResumeVerification(entry)}`,
    `- contextPath: ${entry.contextPath ?? "not written"}`,
    `- memoryPath: ${entry.memoryPath ?? "not written"}`,
    `- recordLogPath: ${entry.recordLogPath ?? "not written"}`,
    `- selectedThreadIds: ${selectedThreadIds.length > 0 ? selectedThreadIds.join(", ") : "none"}`,
    `- sessionContextDir: ${sessionContextDir ?? "not written"}`,
    `- mergedSessionCount: ${entry.mergedSessionCount ?? 0}`,
    `- skippedSessionCount: ${entry.skippedSessionCount ?? 0}`,
    `- warnings: ${warnings.length > 0 ? warnings.join(" | ") : "none"}`,
  ].join("\n");
}

export function getManagedHistoryBody(existingContent: string): string {
  const managedBlock = extractManagedBlock(existingContent);
  if (!managedBlock) {
    return "";
  }

  const historyHeadingIndex = managedBlock.indexOf(MERGE_HISTORY_HEADING);
  if (historyHeadingIndex < 0) {
    return "";
  }

  const historyStart = historyHeadingIndex + MERGE_HISTORY_HEADING.length;
  const historyBody = managedBlock.slice(historyStart).replace(END_MARKER, "").trim();
  return historyBody === "- none" ? "" : historyBody;
}

export function appendHistoryBody(existingHistoryBody: string, entry: MemoryMergeHistoryEntry): string {
  const nextEntry = formatMergeHistoryEntry(entry).trim();
  if (!existingHistoryBody.trim()) {
    return nextEntry;
  }
  return `${existingHistoryBody.trim()}\n\n${nextEntry}`;
}

export function upsertManagedBlock(existingContent: string, block: string): string {
  if (!existingContent.trim()) {
    return block;
  }

  const start = existingContent.indexOf(START_MARKER);
  const end = existingContent.indexOf(END_MARKER);
  if (start >= 0 && end > start) {
    const before = existingContent.slice(0, start).trimEnd();
    const after = existingContent.slice(end + END_MARKER.length).trimStart();
    const body = before ? `${before}\n\n${block}` : block;
    return `${body}${after ? `\n${after}` : ""}`.trimEnd() + "\n";
  }

  return `${existingContent.trimEnd()}\n\n${block}`;
}

function extractManagedBlock(existingContent: string): string | null {
  const start = existingContent.indexOf(START_MARKER);
  const end = existingContent.indexOf(END_MARKER);
  if (start < 0 || end <= start) {
    return null;
  }
  return existingContent.slice(start, end + END_MARKER.length);
}

function formatCanonicalThread(entry: MemoryMergeHistoryEntry): string {
  if (entry.canonicalThreadId && entry.canonicalThreadName) {
    return `${entry.canonicalThreadId} (${entry.canonicalThreadName})`;
  }
  return entry.canonicalThreadId ?? entry.canonicalThreadName ?? "not created";
}

function formatResumeVerification(entry: MemoryMergeHistoryEntry): string {
  const status =
    typeof entry.canonicalThreadResumeVerified === "boolean"
      ? String(entry.canonicalThreadResumeVerified)
      : "unknown";
  if (!entry.canonicalThreadResumeVerificationMessage) {
    return status;
  }
  return `${status} (${entry.canonicalThreadResumeVerificationMessage})`;
}

export function getMemoryBootstrapSnapshot(existingContent: string): string {
  const managedBlock = extractManagedBlock(existingContent);
  const source = managedBlock ?? existingContent.trim();
  if (!source) {
    return "";
  }

  const historyHeadingIndex = source.indexOf(MERGE_HISTORY_HEADING);
  const snapshot = historyHeadingIndex >= 0 ? source.slice(0, historyHeadingIndex) : source;
  return snapshot
    .replace(START_MARKER, "")
    .replace(END_MARKER, "")
    .trim();
}

export const MEMORY_BLOCK_MARKERS = { START_MARKER, END_MARKER, MERGE_HISTORY_HEADING };
