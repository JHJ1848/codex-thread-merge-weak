import type { MergedProjectState } from "../shared/merge-types.js";
import type { MemoryMergeHistoryEntry } from "./memoryTemplate.js";
import type { SessionMemoryInput } from "./writeSessionMemoryFiles.js";
import { writeProjectMemory } from "./writeMemory.js";
import { writeSessionMemoryFiles } from "./writeSessionMemoryFiles.js";

export interface WriteContextAndMemoryInput {
  projectRoot: string;
  mergedState: MergedProjectState;
  sessions: SessionMemoryInput[];
  selectionRule?: string;
  generatedAt?: string;
  mergeHistoryEntry?: MemoryMergeHistoryEntry;
}

export interface WriteContextAndMemoryResult {
  memoryPath: string;
  contextPath: string;
  sessionContextDir: string;
  sessionContextPaths: string[];
}

export async function writeContextAndMemory(
  input: WriteContextAndMemoryInput,
): Promise<WriteContextAndMemoryResult> {
  const contextResult = await writeSessionMemoryFiles({
    projectRoot: input.projectRoot,
    generatedAt: input.generatedAt ?? input.mergedState.generatedAt,
    selectionRule: input.selectionRule,
    sessions: input.sessions,
  });

  const sessionThreadIds = new Set(input.sessions.map((session) => session.threadId));
  const stateForMemory: MergedProjectState = {
    ...input.mergedState,
    sourceThreads: input.mergedState.sourceThreads.filter((thread) =>
      sessionThreadIds.has(thread.threadId),
    ),
  };

  const memoryResult = await writeProjectMemory(stateForMemory, {
    projectRoot: input.projectRoot,
    mergeHistoryEntry: input.mergeHistoryEntry,
  });

  return {
    memoryPath: memoryResult.path,
    contextPath: contextResult.contextPath,
    sessionContextDir: contextResult.dir,
    sessionContextPaths: contextResult.paths,
  };
}

