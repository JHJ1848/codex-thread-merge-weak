import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MergedProjectState } from "../shared/merge-types.js";
import {
  appendHistoryBody,
  getManagedHistoryBody,
  getMemoryManagedBlock,
  type MemoryMergeHistoryEntry,
  upsertManagedBlock,
} from "./memoryTemplate.js";
import { getProjectMemoryPath } from "./projectPaths.js";

export interface WriteMemoryOptions {
  projectRoot: string;
  fileName?: string;
  mergeHistoryEntry?: MemoryMergeHistoryEntry;
}

export interface WriteMemoryResult {
  path: string;
  existed: boolean;
}

async function safeRead(filePath: string): Promise<{ existed: boolean; content: string }> {
  try {
    const content = await readFile(filePath, "utf8");
    return { existed: true, content };
  } catch {
    return { existed: false, content: "" };
  }
}

export async function writeProjectMemory(
  state: MergedProjectState,
  options: WriteMemoryOptions,
): Promise<WriteMemoryResult> {
  const filePath = options.fileName
    ? path.join(options.projectRoot, options.fileName)
    : getProjectMemoryPath(options.projectRoot);
  await mkdir(path.dirname(filePath), { recursive: true });

  const { existed, content } = await safeRead(filePath);
  const existingHistoryBody = getManagedHistoryBody(content);
  const historyBody = options.mergeHistoryEntry
    ? appendHistoryBody(existingHistoryBody, options.mergeHistoryEntry)
    : existingHistoryBody;
  const managedBlock = getMemoryManagedBlock(state, { historyBody });
  const next = upsertManagedBlock(content, managedBlock);

  await writeFile(filePath, next, "utf8");
  return { path: filePath, existed };
}
