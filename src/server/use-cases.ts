import path from "node:path";
import type { CodexAppServerClient } from "../codex-client/client.js";
import { appendMergeRecord } from "../memory-writer/writeMergeRecord.js";
import { writeSessionMemoryFiles } from "../memory-writer/writeSessionMemoryFiles.js";
import { discoverProjectThreads } from "../thread-discovery/discovery.js";
import type {
  MergeThreadsOptions,
  MergedProjectState,
  SourceThread,
  ThreadTurn,
} from "../shared/merge-types.js";
import type { JsonObject, JsonValue, ProjectThreadCandidate } from "../shared/types.js";
import {
  buildCanonicalBootstrap,
  mergeThreadsToProjectState,
} from "../thread-merge-engine/mergeThreads.js";
import { writeProjectMemory } from "../memory-writer/writeMemory.js";

export interface PreviewProjectThreadsInput {
  cwd?: string;
  includeArchived?: boolean;
}

export interface PreviewProjectThreadsOutput {
  projectRoot: string;
  candidateThreads: ProjectThreadCandidate[];
  selectionRule: string;
}

export interface MergeProjectThreadsInput {
  cwd?: string;
  includeArchived?: boolean;
  writeMemory?: boolean;
  compactOldThreads?: boolean;
  renameOldThreads?: boolean;
}

export interface MergeProjectThreadsOutput {
  canonicalThreadId: string;
  canonicalThreadName: string;
  mergedThreadIds: string[];
  skippedThreadIds: string[];
  memoryPath?: string;
  recordLogPath?: string;
  sessionMemoryDir?: string;
  sessionMemoryPaths: string[];
  warnings: string[];
  mergedState: MergedProjectState;
}

export interface RefreshProjectMemoryInput {
  cwd?: string;
}

export interface RefreshProjectMemoryOutput {
  memoryPath: string;
  sessionMemoryDir: string;
  sessionMemoryPaths: string[];
  updatedAt: string;
  warnings: string[];
}

export interface PreviewProjectThreadsUseCase {
  execute(input: PreviewProjectThreadsInput): Promise<PreviewProjectThreadsOutput>;
}

export interface MergeProjectThreadsUseCase {
  execute(input: MergeProjectThreadsInput): Promise<MergeProjectThreadsOutput>;
}

export interface RefreshProjectMemoryUseCase {
  execute(input: RefreshProjectMemoryInput): Promise<RefreshProjectMemoryOutput>;
}

export interface UseCaseDependencies {
  createCodexClient: (cwd: string) => CodexAppServerClient;
}

interface ResolvedMergeInput {
  projectRoot: string;
  selectionRule: string;
  candidateThreads: ProjectThreadCandidate[];
  sourceThreads: SourceThread[];
  mergedState: MergedProjectState;
  skippedThreadIds: string[];
  warnings: string[];
}

const MANAGED_THREAD_PATTERN = /^\[Canonical\].*|\[Merged\]\s*$/i;

export class PreviewProjectThreadsUseCaseImpl implements PreviewProjectThreadsUseCase {
  public constructor(private readonly deps: UseCaseDependencies) {}

  public async execute(
    input: PreviewProjectThreadsInput,
  ): Promise<PreviewProjectThreadsOutput> {
    const projectRoot = resolveProjectRoot(input.cwd);
    const client = this.deps.createCodexClient(projectRoot);
    try {
      const discovery = await discoverProjectThreads(client, {
        cwd: projectRoot,
        includeArchived: input.includeArchived ?? false,
      });
      return {
        projectRoot: discovery.projectRoot,
        candidateThreads: filterMergeableCandidates(discovery.candidateThreads),
        selectionRule: `${discovery.selectionRule} Exclude threads already marked as [Canonical] or [Merged].`,
      };
    } finally {
      client.close();
    }
  }
}

export class MergeProjectThreadsUseCaseImpl implements MergeProjectThreadsUseCase {
  public constructor(private readonly deps: UseCaseDependencies) {}

  public async execute(
    input: MergeProjectThreadsInput,
  ): Promise<MergeProjectThreadsOutput> {
    const projectRoot = resolveProjectRoot(input.cwd);
    const client = this.deps.createCodexClient(projectRoot);
    let resolved: ResolvedMergeInput | undefined;
    try {
      resolved = await resolveMergeInput(client, projectRoot, {
        includeArchived: input.includeArchived ?? false,
      });
      const warnings = [...resolved.warnings];
      const canonicalThreadName = buildCanonicalThreadName(
        path.basename(resolved.projectRoot) || "project",
      );

      const canonicalThread = await client.startThread({ cwd: resolved.projectRoot });
      try {
        await client.setThreadName({
          threadId: canonicalThread.id,
          name: canonicalThreadName,
        });
      } catch (error) {
        warnings.push(`canonical thread rename failed: ${toErrorMessage(error)}`);
      }

      await client.startTurn({
        threadId: canonicalThread.id,
        text: buildCanonicalBootstrap(resolved.mergedState),
      });

      const mergedThreadIds = resolved.sourceThreads.map((thread) => thread.threadId);

      if (input.compactOldThreads ?? true) {
        for (const threadId of mergedThreadIds) {
          try {
            await client.compactThread({ threadId });
          } catch (error) {
            warnings.push(`thread/compact/start failed for ${threadId}: ${toErrorMessage(error)}`);
          }
        }
      }

      if (input.renameOldThreads ?? true) {
        for (const candidate of resolved.candidateThreads) {
          if (!mergedThreadIds.includes(candidate.threadId)) {
            continue;
          }
          try {
            await client.setThreadName({
              threadId: candidate.threadId,
              name: tagMergedThreadName(candidate.name, candidate.threadId),
            });
          } catch (error) {
            warnings.push(`thread/name/set failed for ${candidate.threadId}: ${toErrorMessage(error)}`);
          }
        }
      }

      let memoryPath: string | undefined;
      if (input.writeMemory ?? true) {
        try {
          memoryPath = (
            await writeProjectMemory(resolved.mergedState, {
              projectRoot: resolved.projectRoot,
            })
          ).path;
        } catch (error) {
          warnings.push(`MEMORY.md update failed: ${toErrorMessage(error)}`);
        }
      }

      let sessionMemoryPaths: string[] = [];
      let sessionMemoryDir: string | undefined;
      if (input.writeMemory ?? true) {
        try {
          const sessionMemoryResult = await writeSessionMemoryFiles({
            projectRoot: resolved.projectRoot,
            generatedAt: resolved.mergedState.generatedAt,
            selectionRule: resolved.selectionRule,
            sessions: resolved.sourceThreads.map((thread) => ({
              threadId: thread.threadId,
              name: thread.name,
              updatedAt: thread.updatedAt,
              turns: thread.turns.map((turn) => ({
                role: turn.role,
                text: turn.text,
                createdAt: turn.createdAt,
              })),
            })),
          });
          sessionMemoryDir = sessionMemoryResult.dir;
          sessionMemoryPaths = sessionMemoryResult.paths;
        } catch (error) {
          warnings.push(`session memory write failed: ${toErrorMessage(error)}`);
        }
      }

      const mergeOutput: MergeProjectThreadsOutput = {
        canonicalThreadId: canonicalThread.id,
        canonicalThreadName,
        mergedThreadIds,
        skippedThreadIds: resolved.skippedThreadIds,
        memoryPath,
        sessionMemoryDir,
        sessionMemoryPaths,
        warnings,
        mergedState: resolved.mergedState,
      };

      try {
        mergeOutput.recordLogPath = (
          await appendMergeRecord({
            projectRoot: resolved.projectRoot,
            projectName: resolved.mergedState.projectName,
            resultStatus: "success",
            recordedAt: new Date().toISOString(),
            selectionRule: resolved.selectionRule,
            canonicalThreadId: canonicalThread.id,
            canonicalThreadName,
            memoryPath,
            candidateSessions: resolved.candidateThreads.map((candidate) => {
              const sourceThread = resolved?.sourceThreads.find(
                (thread) => thread.threadId === candidate.threadId,
              );
              return {
                threadId: candidate.threadId,
                name: candidate.name,
                updatedAt: candidate.updatedAt,
                turnCount: sourceThread?.turns.length,
              };
            }),
            mergedThreadIds,
            skippedThreadIds: resolved.skippedThreadIds,
            warnings,
            options: {
              includeArchived: input.includeArchived,
              writeMemory: input.writeMemory,
              compactOldThreads: input.compactOldThreads,
              renameOldThreads: input.renameOldThreads,
            },
          })
        ).path;
      } catch (error) {
        warnings.push(`record.log write failed: ${toErrorMessage(error)}`);
      }

      return mergeOutput;
    } catch (error) {
      try {
        await appendMergeRecord({
          projectRoot,
          projectName: path.basename(projectRoot) || "project",
          resultStatus: "failed",
          recordedAt: new Date().toISOString(),
          error: toErrorMessage(error),
          selectionRule: resolved?.selectionRule,
          candidateSessions:
            resolved?.candidateThreads.map((candidate) => {
              const sourceThread = resolved?.sourceThreads.find(
                (thread) => thread.threadId === candidate.threadId,
              );
              return {
                threadId: candidate.threadId,
                name: candidate.name,
                updatedAt: candidate.updatedAt,
                turnCount: sourceThread?.turns.length,
              };
            }) ?? [],
          mergedThreadIds: [],
          skippedThreadIds: resolved?.skippedThreadIds ?? [],
          warnings: resolved?.warnings ?? [toErrorMessage(error)],
          options: {
            includeArchived: input.includeArchived,
            writeMemory: input.writeMemory,
            compactOldThreads: input.compactOldThreads,
            renameOldThreads: input.renameOldThreads,
          },
        });
      } catch (recordError) {
        console.warn(`record.log write failed: ${toErrorMessage(recordError)}`);
      }

      throw error;
    } finally {
      client.close();
    }
  }
}

export class RefreshProjectMemoryUseCaseImpl implements RefreshProjectMemoryUseCase {
  public constructor(private readonly deps: UseCaseDependencies) {}

  public async execute(
    input: RefreshProjectMemoryInput,
  ): Promise<RefreshProjectMemoryOutput> {
    const projectRoot = resolveProjectRoot(input.cwd);
    const client = this.deps.createCodexClient(projectRoot);
    try {
      const resolved = await resolveMergeInput(client, projectRoot, {
        includeArchived: false,
      });
      const memory = await writeProjectMemory(resolved.mergedState, {
        projectRoot: resolved.projectRoot,
      });
      const sessionMemoryResult = await writeSessionMemoryFiles({
        projectRoot: resolved.projectRoot,
        generatedAt: resolved.mergedState.generatedAt,
        selectionRule: resolved.selectionRule,
        sessions: resolved.sourceThreads.map((thread) => ({
          threadId: thread.threadId,
          name: thread.name,
          updatedAt: thread.updatedAt,
          turns: thread.turns.map((turn) => ({
            role: turn.role,
            text: turn.text,
            createdAt: turn.createdAt,
          })),
        })),
      });
      return {
        memoryPath: memory.path,
        sessionMemoryDir: sessionMemoryResult.dir,
        sessionMemoryPaths: sessionMemoryResult.paths,
        updatedAt: resolved.mergedState.generatedAt,
        warnings: resolved.warnings,
      };
    } finally {
      client.close();
    }
  }
}

async function resolveMergeInput(
  client: CodexAppServerClient,
  projectRoot: string,
  options: { includeArchived: boolean },
): Promise<ResolvedMergeInput> {
  const discovery = await discoverProjectThreads(client, {
    cwd: projectRoot,
    includeArchived: options.includeArchived,
  });
  const candidateThreads = filterMergeableCandidates(discovery.candidateThreads);
  if (candidateThreads.length === 0) {
    throw new Error(`No mergeable project threads found under ${projectRoot}.`);
  }

  const sourceThreads: SourceThread[] = [];
  const skippedThreadIds: string[] = [];
  const warnings: string[] = [];

  for (const candidate of candidateThreads) {
    try {
      const readResponse = await client.readThread({
        threadId: candidate.threadId,
        includeTurns: true,
      });
      const sourceThread = normalizeSourceThread(candidate, readResponse.thread.turns ?? []);
      if (sourceThread.turns.length === 0) {
        skippedThreadIds.push(candidate.threadId);
        warnings.push(`thread/read returned no parsable turns for ${candidate.threadId}`);
        continue;
      }
      sourceThreads.push(sourceThread);
    } catch (error) {
      skippedThreadIds.push(candidate.threadId);
      warnings.push(`thread/read failed for ${candidate.threadId}: ${toErrorMessage(error)}`);
    }
  }

  if (sourceThreads.length === 0) {
    throw new Error(`No readable project threads found under ${projectRoot}.`);
  }

  const mergedState = mergeThreadsToProjectState(sourceThreads, {
    projectName: path.basename(projectRoot) || "project",
  } satisfies MergeThreadsOptions);

  warnings.push(...mergedState.warnings);

  return {
    projectRoot: discovery.projectRoot,
    selectionRule: `${discovery.selectionRule} Exclude threads already marked as [Canonical] or [Merged].`,
    candidateThreads,
    sourceThreads,
    mergedState,
    skippedThreadIds,
    warnings,
  };
}

function resolveProjectRoot(cwd?: string): string {
  return cwd && cwd.trim().length > 0 ? path.resolve(cwd) : process.cwd();
}

function filterMergeableCandidates(candidates: ProjectThreadCandidate[]): ProjectThreadCandidate[] {
  return candidates.filter((candidate) => !isManagedThreadName(candidate.name));
}

function isManagedThreadName(name: string | null): boolean {
  return typeof name === "string" && MANAGED_THREAD_PATTERN.test(name.trim());
}

function buildCanonicalThreadName(projectName: string): string {
  return `[Canonical] ${projectName} ${new Date().toISOString().slice(0, 10)}`;
}

function tagMergedThreadName(currentName: string | null, threadId: string): string {
  const base = currentName?.trim() || threadId;
  return /\[Merged\]\s*$/i.test(base) ? base : `${base} [Merged]`;
}

function normalizeSourceThread(
  candidate: ProjectThreadCandidate,
  turns: Array<{ id: string; status?: string; items?: JsonObject[] }>,
): SourceThread {
  const normalizedTurns: ThreadTurn[] = [];
  for (const turn of turns) {
    const createdAt = candidate.updatedAt ?? undefined;
    for (const item of turn.items ?? []) {
      const type = readString(item.type);
      if (!type) {
        continue;
      }

      if (type === "userMessage") {
        const text = readUserMessageText(item);
        if (text) {
          normalizedTurns.push({ id: turn.id, role: "user", text, createdAt });
        }
        continue;
      }

      if (type === "agentMessage") {
        const text = readString(item.text);
        if (text) {
          normalizedTurns.push({ id: turn.id, role: "assistant", text, createdAt });
        }
        continue;
      }

      if (type === "plan") {
        const text = readString(item.text);
        if (text) {
          normalizedTurns.push({
            id: turn.id,
            role: "assistant",
            text: `PLAN: ${text}`,
            createdAt,
          });
        }
        continue;
      }

      if (type === "reasoning") {
        const text = [
          joinStringArray(item.summary),
          joinStringArray(item.content),
        ]
          .filter(Boolean)
          .join("\n")
          .trim();
        if (text) {
          normalizedTurns.push({
            id: turn.id,
            role: "assistant",
            text: `REASONING: ${text}`,
            createdAt,
          });
        }
      }
    }
  }

  return {
    threadId: candidate.threadId,
    name: candidate.name,
    cwd: candidate.cwd,
    updatedAt: candidate.updatedAt,
    turns: normalizedTurns,
  };
}

function readUserMessageText(item: JsonObject): string {
  const content = Array.isArray(item.content) ? item.content : [];
  const lines: string[] = [];
  for (const entry of content) {
    if (!isObject(entry)) {
      continue;
    }
    if (readString(entry.type) === "text") {
      const text = readString(entry.text);
      if (text) {
        lines.push(text);
      }
    }
  }
  return lines.join("\n").trim();
}

function joinStringArray(value: JsonValue | undefined): string {
  if (!Array.isArray(value)) {
    return "";
  }
  return value.filter((entry): entry is string => typeof entry === "string").join("\n").trim();
}

function readString(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
