import { appendFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getProjectRecordLogPath } from "./projectPaths.js";

export interface MergeRecordSessionInput {
  threadId: string;
  name?: string | null;
  updatedAt?: string | null;
  turnCount?: number;
}

export interface MergeRecordOptionsSnapshot {
  includeArchived?: boolean;
  writeMemory?: boolean;
  compactOldThreads?: boolean;
  renameOldThreads?: boolean;
}

export interface WriteMergeRecordInput {
  projectRoot: string;
  projectName: string;
  resultStatus: string;
  recordedAt?: string;
  error?: string;
  selectionRule?: string;
  canonicalThreadId?: string;
  canonicalThreadName?: string;
  memoryPath?: string;
  candidateSessions: MergeRecordSessionInput[];
  mergedThreadIds?: string[];
  skippedThreadIds?: string[];
  warnings?: string[];
  options?: MergeRecordOptionsSnapshot;
  sessionRoots?: string[];
}

export interface SessionFileSummary {
  threadId: string;
  found: boolean;
  path: string | null;
  sourceRoot: string | null;
  approxLineCount: number | null;
  approxBytes: number | null;
  responseItemCountApprox: number | null;
  toolRelatedHitCountApprox: number | null;
  note: string;
}

export interface WriteMergeRecordResult {
  path: string;
  sessionSummaries: SessionFileSummary[];
}

interface EnrichedSessionSummary extends SessionFileSummary {
  name: string | null;
  updatedAt: string | null;
  turnCount: number | null;
  mergeState: "merged" | "skipped" | "candidate";
}

export function getDefaultSessionRoots(homeDir = os.homedir()): string[] {
  return [
    path.join(homeDir, ".codex", "sessions"),
    path.join(homeDir, ".codex", "archived_sessions"),
  ];
}

export async function appendMergeRecord(
  input: WriteMergeRecordInput,
): Promise<WriteMergeRecordResult> {
  const logPath = getProjectRecordLogPath(input.projectRoot);
  const logDir = path.dirname(logPath);
  const sessionRoots = input.sessionRoots ?? getDefaultSessionRoots();

  await mkdir(logDir, { recursive: true });

  const sessionSummaries = await Promise.all(
    input.candidateSessions.map(async (session) => {
      const lookup = await findSessionFileSummary(session.threadId, sessionRoots);
      return {
        ...lookup,
        name: session.name ?? null,
        updatedAt: session.updatedAt ?? null,
        turnCount: typeof session.turnCount === "number" ? session.turnCount : null,
        mergeState: classifyMergeState(
          session.threadId,
          input.mergedThreadIds ?? [],
          input.skippedThreadIds ?? [],
        ),
      } satisfies EnrichedSessionSummary;
    }),
  );

  const recordText = formatMergeRecord(input, sessionSummaries);
  await appendFile(logPath, recordText, "utf8");

  return {
    path: logPath,
    sessionSummaries,
  };
}

function classifyMergeState(
  threadId: string,
  mergedThreadIds: string[],
  skippedThreadIds: string[],
): "merged" | "skipped" | "candidate" {
  if (mergedThreadIds.includes(threadId)) {
    return "merged";
  }
  if (skippedThreadIds.includes(threadId)) {
    return "skipped";
  }
  return "candidate";
}

async function findSessionFileSummary(
  threadId: string,
  sessionRoots: string[],
): Promise<SessionFileSummary> {
  for (const root of sessionRoots) {
    const filePath = await findSessionFilePath(root, threadId);
    if (!filePath) {
      continue;
    }

    const fileStat = await stat(filePath);
    const content = await readFile(filePath, "utf8");
    const approxLineCount = content.length === 0 ? 0 : content.split(/\r?\n/).length;

    return {
      threadId,
      found: true,
      path: filePath,
      sourceRoot: root,
      approxLineCount,
      approxBytes: fileStat.size,
      responseItemCountApprox: countMatches(content, /"type":"response_item"/g),
      toolRelatedHitCountApprox: countMatches(
        content,
        /"type":"function_call"|"type":"function_call_output"|"mcpToolCall"|"dynamic_tool"|"custom_tool_call"/g,
      ),
      note: "session file found",
    };
  }

  return {
    threadId,
    found: false,
    path: null,
    sourceRoot: null,
    approxLineCount: null,
    approxBytes: null,
    responseItemCountApprox: null,
    toolRelatedHitCountApprox: null,
    note: "session file not found under ~/.codex/sessions or ~/.codex/archived_sessions",
  };
}

async function findSessionFilePath(rootDir: string, threadId: string): Promise<string | null> {
  let entries;
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const expectedSuffix = `${threadId}.jsonl`.toLowerCase();

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findSessionFilePath(fullPath, threadId);
      if (nested) {
        return nested;
      }
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith(expectedSuffix)) {
      return fullPath;
    }
  }

  return null;
}

export function formatMergeRecord(
  input: WriteMergeRecordInput,
  sessions: EnrichedSessionSummary[],
): string {
  const recordedAt = input.recordedAt ?? new Date().toISOString();
  const warnings = input.warnings ?? [];
  const mergedCount = sessions.filter((session) => session.mergeState === "merged").length;
  const skippedCount = sessions.filter((session) => session.mergeState === "skipped").length;

  const lines = [
    "=== Merge Record ===",
    `recordedAt: ${recordedAt}`,
    `project: ${input.projectName}`,
    `projectRoot: ${input.projectRoot}`,
    `status: ${input.resultStatus}`,
    `canonicalThread: ${formatCanonicalThreadLine(input)}`,
    `memoryPath: ${input.memoryPath ?? "not written"}`,
    `candidateSessionCount: ${sessions.length}`,
    `mergedSessionCount: ${mergedCount}`,
    `skippedSessionCount: ${skippedCount}`,
  ];

  if (input.selectionRule) {
    lines.push(`selectionRule: ${input.selectionRule}`);
  }

  if (input.options) {
    lines.push(`options: ${formatOptions(input.options)}`);
  }

  if (input.error) {
    lines.push(`error: ${input.error}`);
  }

  lines.push("", "candidateSessions:");
  if (sessions.length === 0) {
    lines.push("- none");
  } else {
    sessions.forEach((session, index) => {
      lines.push(`${index + 1}. ${session.threadId}`);
      lines.push(`   - mergeState: ${session.mergeState}`);
      lines.push(`   - name: ${session.name ?? "unnamed"}`);
      lines.push(`   - updatedAt: ${session.updatedAt ?? "unknown"}`);
      lines.push(`   - turnCountApprox: ${session.turnCount ?? "unknown"}`);
      if (session.found) {
        lines.push(`   - sessionFile: ${session.path}`);
        lines.push(`   - sessionRoot: ${session.sourceRoot}`);
        lines.push(`   - fileSize: ${formatBytesWithRaw(session.approxBytes)}`);
        lines.push(`   - lineCount: ${session.approxLineCount ?? "unknown"}`);
        lines.push(`   - responseItemCount: ${session.responseItemCountApprox ?? "unknown"}`);
        lines.push(`   - toolRelatedHitCount: ${session.toolRelatedHitCountApprox ?? "unknown"}`);
      } else {
        lines.push("   - sessionFile: NOT_FOUND");
        lines.push(`   - sessionSizeApprox: unavailable (${session.note})`);
      }
    });
  }

  lines.push("", "warnings:");
  if (warnings.length === 0) {
    lines.push("- none");
  } else {
    for (const warning of warnings) {
      lines.push(`- ${warning}`);
    }
  }

  return `${lines.join("\n")}\n\n`;
}

function formatCanonicalThreadLine(input: WriteMergeRecordInput): string {
  if (!input.canonicalThreadId && !input.canonicalThreadName) {
    return "not created";
  }

  if (input.canonicalThreadId && input.canonicalThreadName) {
    return `${input.canonicalThreadId} (${input.canonicalThreadName})`;
  }

  return input.canonicalThreadId ?? input.canonicalThreadName ?? "not created";
}

function formatOptions(options: MergeRecordOptionsSnapshot): string {
  return [
    `includeArchived=${formatBooleanOption(options.includeArchived)}`,
    `writeMemory=${formatBooleanOption(options.writeMemory)}`,
    `compactOldThreads=${formatBooleanOption(options.compactOldThreads)}`,
    `renameOldThreads=${formatBooleanOption(options.renameOldThreads)}`,
  ].join(", ");
}

function formatBooleanOption(value: boolean | undefined): string {
  return typeof value === "boolean" ? String(value) : "default";
}

function formatBytesWithRaw(bytes: number | null): string {
  if (bytes === null) {
    return "unknown";
  }
  return `${bytes} bytes (${formatBytes(bytes)})`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function countMatches(content: string, pattern: RegExp): number {
  return content.match(pattern)?.length ?? 0;
}
