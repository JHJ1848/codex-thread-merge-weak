import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  getProjectContextPath,
  getProjectSessionMemoryDir,
  getProjectSessionMemoryPath,
} from "./projectPaths.js";

export interface SessionMemoryTurn {
  role: string;
  text: string;
  createdAt?: string | null;
}

export interface SessionMemoryInput {
  threadId: string;
  name?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  archived?: boolean;
  mergedBefore?: boolean;
  mergedAt?: string | null;
  mergeCount?: number;
  turns: SessionMemoryTurn[];
}

export interface WriteSessionMemoryFilesInput {
  projectRoot: string;
  generatedAt?: string;
  selectionRule?: string;
  sessions: SessionMemoryInput[];
}

export interface WriteSessionMemoryFilesResult {
  dir: string;
  paths: string[];
  contextPath: string;
}

export async function writeSessionMemoryFiles(
  input: WriteSessionMemoryFilesInput,
): Promise<WriteSessionMemoryFilesResult> {
  const dir = getProjectSessionMemoryDir(input.projectRoot);
  await mkdir(dir, { recursive: true });

  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const paths: string[] = [];
  const activeFileNames = new Set<string>();

  for (const session of input.sessions) {
    const sessionPath = getProjectSessionMemoryPath(input.projectRoot, session.threadId);
    const content = formatSessionMemoryFile({
      generatedAt,
      projectRoot: input.projectRoot,
      selectionRule: input.selectionRule,
      session,
    });
    await writeFile(sessionPath, content, "utf8");
    paths.push(sessionPath);
    activeFileNames.add(path.basename(sessionPath));
  }

  const existingEntries = await readdir(dir, { withFileTypes: true });
  for (const entry of existingEntries) {
    if (!entry.isFile()) {
      continue;
    }
    if (!entry.name.endsWith(".md")) {
      continue;
    }
    if (activeFileNames.has(entry.name)) {
      continue;
    }
    await rm(path.join(dir, entry.name), { force: true });
  }

  const contextPath = getProjectContextPath(input.projectRoot);
  const contextMarkdown = formatProjectContextFile({
    generatedAt,
    projectRoot: input.projectRoot,
    selectionRule: input.selectionRule,
    sessions: input.sessions,
  });
  await writeFile(contextPath, contextMarkdown, "utf8");

  return { dir, paths, contextPath };
}

interface FormatSessionMemoryOptions {
  generatedAt: string;
  projectRoot: string;
  selectionRule?: string;
  session: SessionMemoryInput;
}

export function formatSessionMemoryFile(options: FormatSessionMemoryOptions): string {
  const { generatedAt, projectRoot, selectionRule, session } = options;
  const lines: string[] = [
    `# Session Context: ${session.threadId}`,
    "",
    `- generatedAt: ${generatedAt}`,
    `- projectRoot: ${projectRoot}`,
    `- threadId: ${session.threadId}`,
    `- name: ${session.name ?? "unnamed"}`,
    `- createdAt: ${session.createdAt ?? "unknown"}`,
    `- updatedAt: ${session.updatedAt ?? "unknown"}`,
    `- archived: ${typeof session.archived === "boolean" ? String(session.archived) : "unknown"}`,
    `- mergedBefore: ${typeof session.mergedBefore === "boolean" ? String(session.mergedBefore) : "unknown"}`,
    `- mergedAt: ${session.mergedAt ?? "unknown"}`,
    `- mergeCount: ${typeof session.mergeCount === "number" ? String(session.mergeCount) : "unknown"}`,
  ];

  if (selectionRule && selectionRule.trim().length > 0) {
    lines.push(`- selectionRule: ${selectionRule.trim()}`);
  }

  lines.push("", "## Conversation");
  lines.push(...formatSessionConversationLines(session));

  return `${lines.join("\n")}\n`;
}

interface FormatProjectContextOptions {
  generatedAt: string;
  projectRoot: string;
  selectionRule?: string;
  sessions: SessionMemoryInput[];
}

export function formatProjectContextFile(options: FormatProjectContextOptions): string {
  const lines: string[] = [
    "# Project Context",
    "",
    `- generatedAt: ${options.generatedAt}`,
    `- projectRoot: ${options.projectRoot}`,
    `- sessionCount: ${options.sessions.length}`,
  ];

  if (options.selectionRule && options.selectionRule.trim().length > 0) {
    lines.push(`- selectionRule: ${options.selectionRule.trim()}`);
  }

  lines.push("", "## Sessions");

  if (options.sessions.length === 0) {
    lines.push("- none");
    return `${lines.join("\n")}\n`;
  }

  for (const session of options.sessions) {
    lines.push(
      `- ${session.threadId}${session.name ? ` (${session.name})` : ""}${session.updatedAt ? ` | updatedAt=${session.updatedAt}` : ""}${typeof session.mergedBefore === "boolean" ? ` | mergedBefore=${session.mergedBefore}` : ""}`,
    );
  }

  for (const session of options.sessions) {
    lines.push("", `### ${session.threadId}`, "");
    lines.push(`- name: ${session.name ?? "unnamed"}`);
    lines.push(`- createdAt: ${session.createdAt ?? "unknown"}`);
    lines.push(`- updatedAt: ${session.updatedAt ?? "unknown"}`);
    lines.push(`- archived: ${typeof session.archived === "boolean" ? String(session.archived) : "unknown"}`);
    lines.push(`- mergedBefore: ${typeof session.mergedBefore === "boolean" ? String(session.mergedBefore) : "unknown"}`);
    lines.push(`- mergedAt: ${session.mergedAt ?? "unknown"}`);
    lines.push(`- mergeCount: ${typeof session.mergeCount === "number" ? String(session.mergeCount) : "unknown"}`);
    lines.push("", "#### Conversation");
    lines.push(...formatSessionConversationLines(session));
  }

  return `${lines.join("\n")}\n`;
}

export function formatSessionConversationLines(session: SessionMemoryInput): string[] {
  if (session.turns.length === 0) {
    return ["Codex: (no readable turns)"];
  }

  const lines: string[] = [];
  for (const turn of session.turns) {
    const speaker = normalizeSpeaker(turn);
    const text = normalizeText(turn.text);
    if (!text) {
      continue;
    }
    if (turn.createdAt && turn.createdAt.trim().length > 0) {
      lines.push(`[${turn.createdAt.trim()}] ${speaker}: ${text}`);
    } else {
      lines.push(`${speaker}: ${text}`);
    }
  }

  return lines.length > 0 ? lines : ["Codex: (no readable turns)"];
}

function normalizeSpeaker(
  turn: SessionMemoryTurn,
): "User" | "Codex" | "Codex-Plan" | "Codex-Reasoning" {
  if (turn.role.trim().toLowerCase() === "user") {
    return "User";
  }

  if (turn.text.startsWith("PLAN: ")) {
    return "Codex-Plan";
  }

  if (turn.text.startsWith("REASONING: ")) {
    return "Codex-Reasoning";
  }

  return "Codex";
}

function normalizeText(value: string): string {
  const normalized = value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();

  if (normalized.startsWith("PLAN: ")) {
    return normalized.slice("PLAN: ".length);
  }

  if (normalized.startsWith("REASONING: ")) {
    return normalized.slice("REASONING: ".length);
  }

  return normalized;
}
