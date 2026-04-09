import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getProjectSessionMemoryDir, getProjectSessionMemoryPath } from "./projectPaths.js";

export interface SessionMemoryTurn {
  role: string;
  text: string;
  createdAt?: string | null;
}

export interface SessionMemoryInput {
  threadId: string;
  name?: string | null;
  updatedAt?: string | null;
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

  return { dir, paths };
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
    `# Session Memory: ${session.threadId}`,
    "",
    `- generatedAt: ${generatedAt}`,
    `- projectRoot: ${projectRoot}`,
    `- threadId: ${session.threadId}`,
    `- name: ${session.name ?? "unnamed"}`,
    `- updatedAt: ${session.updatedAt ?? "unknown"}`,
  ];

  if (selectionRule && selectionRule.trim().length > 0) {
    lines.push(`- selectionRule: ${selectionRule.trim()}`);
  }

  lines.push("", "## Conversation");

  if (session.turns.length === 0) {
    lines.push("Codex: (no readable turns)");
    return `${lines.join("\n")}\n`;
  }

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

  return `${lines.join("\n")}\n`;
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
