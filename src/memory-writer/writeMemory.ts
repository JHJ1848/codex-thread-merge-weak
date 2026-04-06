import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MergedProjectState } from "../shared/merge-types.js";
import { getMemoryManagedBlock, upsertManagedBlock } from "./memoryTemplate.js";

export interface WriteMemoryOptions {
  projectRoot: string;
  fileName?: string;
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
  const fileName = options.fileName ?? "MEMORY.md";
  const filePath = path.join(options.projectRoot, fileName);
  await mkdir(path.dirname(filePath), { recursive: true });

  const { existed, content } = await safeRead(filePath);
  const managedBlock = getMemoryManagedBlock(state);
  const next = upsertManagedBlock(content, managedBlock);

  await writeFile(filePath, next, "utf8");
  return { path: filePath, existed };
}
