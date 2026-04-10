import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CodexAppServerClient } from "../codex-client/client.js";
import { getMemoryBootstrapSnapshot, type MemoryMergeHistoryEntry } from "../memory-writer/memoryTemplate.js";
import {
  appendMergeRecord,
  readMergeHistoryByThreadId,
} from "../memory-writer/writeMergeRecord.js";
import {
  type SessionMemoryInput,
  writeSessionMemoryFiles,
} from "../memory-writer/writeSessionMemoryFiles.js";
import { writeProjectMemory } from "../memory-writer/writeMemory.js";
import { discoverProjectThreads } from "../thread-discovery/discovery.js";
import type {
  MergeThreadsOptions,
  MergedProjectState,
  SourceThread,
  ThreadTurn,
} from "../shared/merge-types.js";
import type {
  JsonObject,
  JsonValue,
  ProjectThreadCandidate,
  ProjectThreadCandidateWithMergeHistory,
} from "../shared/types.js";
import {
  buildCanonicalBootstrap,
  mergeThreadsToProjectState,
} from "../thread-merge-engine/mergeThreads.js";

export interface PreviewProjectThreadsInput {
  cwd?: string;
  includeArchived?: boolean;
}

export interface PreviewProjectThreadsOutput {
  projectRoot: string;
  candidateThreads: ProjectThreadCandidateWithMergeHistory[];
  selectionRule: string;
}

export interface MergeProjectThreadsInput {
  cwd?: string;
  selectedThreadIds: string[];
  includeArchived?: boolean;
  writeMemory?: boolean;
  compactOldThreads?: boolean;
  renameOldThreads?: boolean;
}

export interface MergeProjectThreadsOutput {
  canonicalThreadId: string;
  canonicalThreadName: string;
  canonicalTurnId: string;
  canonicalTurnStatus: string;
  resumeVerified: boolean;
  resumeThreadStatus?: string;
  resumeVerificationMessage?: string;
  mergedThreadIds: string[];
  skippedThreadIds: string[];
  selectedThreadIds: string[];
  contextPath?: string;
  memoryPath?: string;
  recordLogPath?: string;
  sessionContextDir?: string;
  sessionContextPaths: string[];
  sessionMemoryDir?: string;
  sessionMemoryPaths: string[];
  warnings: string[];
  mergedState: MergedProjectState;
}

export interface RefreshProjectMemoryInput {
  cwd?: string;
}

export interface RefreshProjectMemoryOutput {
  contextPath: string;
  memoryPath: string;
  sessionContextDir: string;
  sessionContextPaths: string[];
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
  candidateThreads: ProjectThreadCandidateWithMergeHistory[];
  sourceThreads: SourceThread[];
  mergedState: MergedProjectState;
  skippedThreadIds: string[];
  warnings: string[];
}

const MANAGED_THREAD_PATTERN = /^\[Canonical\].*|\[Merged\]\s*$/i;
const CANONICAL_TURN_WAIT_TIMEOUT_MS = 15_000;
const CANONICAL_TURN_WAIT_INTERVAL_MS = 300;

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
      const historyByThread = await readMergeHistoryByThreadId(discovery.projectRoot);
      return {
        projectRoot: discovery.projectRoot,
        candidateThreads: annotateCandidatesWithMergeHistory(
          filterMergeableCandidates(discovery.candidateThreads),
          historyByThread,
        ),
        selectionRule: buildSelectionRule(discovery.selectionRule),
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
    if (!input.selectedThreadIds || input.selectedThreadIds.length === 0) {
      throw new Error('"selectedThreadIds" is required and must contain at least one thread id.');
    }

    const projectRoot = resolveProjectRoot(input.cwd);
    const client = this.deps.createCodexClient(projectRoot);
    let resolved: ResolvedMergeInput | undefined;
    let warnings: string[] = [];
    let canonicalThreadName: string | undefined;
    let canonicalThreadId: string | undefined;
    let canonicalTurnId: string | undefined;
    let canonicalTurnStatus: string | undefined;
    let resumeThreadStatus: string | undefined;
    let resumeVerificationMessage: string | undefined;
    let contextPath: string | undefined;
    let memoryPath: string | undefined;
    let sessionContextDir: string | undefined;
    let sessionContextPaths: string[] = [];
    let bootstrapSource = "";

    try {
      resolved = await resolveMergeInput(client, projectRoot, {
        includeArchived: input.includeArchived ?? false,
        selectedThreadIds: input.selectedThreadIds,
      });
      warnings = [...resolved.warnings];

      if (input.writeMemory ?? true) {
        const sessionContextResult = await writeSessionMemoryFiles({
          projectRoot: resolved.projectRoot,
          generatedAt: resolved.mergedState.generatedAt,
          selectionRule: resolved.selectionRule,
          sessions: buildSessionContextInputs(resolved.candidateThreads, resolved.sourceThreads),
        });
        contextPath = sessionContextResult.contextPath;
        sessionContextDir = sessionContextResult.dir;
        sessionContextPaths = sessionContextResult.paths;

        const memoryResult = await writeProjectMemory(resolved.mergedState, {
          projectRoot: resolved.projectRoot,
        });
        memoryPath = memoryResult.path;
        bootstrapSource = await readFile(memoryResult.path, "utf8");
      }

      canonicalThreadName = buildCanonicalThreadName(
        path.basename(resolved.projectRoot) || "project",
      );
      const canonicalThread = await client.startThread({ cwd: resolved.projectRoot });
      canonicalThreadId = canonicalThread.id;
      try {
        await client.setThreadName({
          threadId: canonicalThread.id,
          name: canonicalThreadName,
        });
      } catch (error) {
        warnings.push(`canonical thread rename failed: ${toErrorMessage(error)}`);
      }

      const canonicalTurn = await client.startTurn({
        threadId: canonicalThread.id,
        text: buildCanonicalBootstrapFromMemory(bootstrapSource, resolved.mergedState),
      });
      canonicalTurnId = canonicalTurn.id;
      canonicalTurnStatus = await waitForTurnCompletion({
        client,
        threadId: canonicalThread.id,
        turnId: canonicalTurn.id,
        initialStatus: canonicalTurn.status,
        timeoutMs: CANONICAL_TURN_WAIT_TIMEOUT_MS,
        intervalMs: CANONICAL_TURN_WAIT_INTERVAL_MS,
      });

      const resumeClient = this.deps.createCodexClient(resolved.projectRoot);
      try {
        const resumedThread = await resumeClient.resumeThread({
          threadId: canonicalThread.id,
          cwd: resolved.projectRoot,
        });
        if (resumedThread.id !== canonicalThread.id) {
          throw new Error(
            `thread/resume returned unexpected thread id: expected=${canonicalThread.id}, actual=${resumedThread.id}`,
          );
        }
        resumeThreadStatus = resumedThread.status;
        resumeVerificationMessage = "fresh client thread/resume succeeded";
      } finally {
        resumeClient.close();
      }

      const mergedThreadIds = resolved.sourceThreads.map((thread) => thread.threadId);
      const selectedThreadIds = resolved.candidateThreads.map((candidate) => candidate.threadId);

      if (input.compactOldThreads ?? false) {
        for (const threadId of mergedThreadIds) {
          try {
            await client.compactThread({ threadId });
          } catch (error) {
            warnings.push(`thread/compact/start failed for ${threadId}: ${toErrorMessage(error)}`);
          }
        }
      }

      if (input.renameOldThreads ?? false) {
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

      const mergeOutput: MergeProjectThreadsOutput = {
        canonicalThreadId: canonicalThread.id,
        canonicalThreadName,
        canonicalTurnId: canonicalTurn.id,
        canonicalTurnStatus,
        resumeVerified: true,
        resumeThreadStatus,
        resumeVerificationMessage,
        mergedThreadIds,
        skippedThreadIds: resolved.skippedThreadIds,
        selectedThreadIds,
        contextPath,
        memoryPath,
        sessionContextDir,
        sessionContextPaths,
        sessionMemoryDir: sessionContextDir,
        sessionMemoryPaths: sessionContextPaths,
        warnings,
        mergedState: resolved.mergedState,
      };

      const mergeHistoryEntry = createMergeHistoryEntry({
        mergedAt: new Date().toISOString(),
        canonicalThreadId: canonicalThread.id,
        canonicalThreadName,
        canonicalTurnId: canonicalTurn.id,
        canonicalTurnStatus,
        resumeVerificationMessage,
        contextPath,
        memoryPath,
        selectedThreadIds,
        sessionContextDir,
        mergedSessionCount: mergedThreadIds.length,
        skippedSessionCount: resolved.skippedThreadIds.length,
        warnings,
      });

      const recordResult = await appendMergeRecord({
        projectRoot: resolved.projectRoot,
        projectName: resolved.mergedState.projectName,
        resultStatus: "success",
        recordedAt: mergeHistoryEntry.mergedAt,
        selectionRule: resolved.selectionRule,
        canonicalThreadId: canonicalThread.id,
        canonicalThreadName,
        canonicalTurnId: canonicalTurn.id,
        canonicalTurnStatus,
        resumeVerified: true,
        resumeThreadStatus,
        resumeVerificationMessage,
        contextPath,
        memoryPath,
        selectedThreadIds,
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
        sessionContextDir,
        warnings,
        options: {
          includeArchived: input.includeArchived,
          writeMemory: input.writeMemory,
          compactOldThreads: input.compactOldThreads,
          renameOldThreads: input.renameOldThreads,
        },
      });
      mergeOutput.recordLogPath = recordResult.path;

      if (memoryPath) {
        await writeProjectMemory(resolved.mergedState, {
          projectRoot: resolved.projectRoot,
          mergeHistoryEntry: {
            ...mergeHistoryEntry,
            recordLogPath: recordResult.path,
          },
        });
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
          canonicalThreadId,
          canonicalThreadName,
          canonicalTurnId,
          canonicalTurnStatus,
          resumeVerified: false,
          resumeThreadStatus,
          resumeVerificationMessage:
            resumeVerificationMessage ?? (canonicalThreadId ? toErrorMessage(error) : undefined),
          contextPath,
          memoryPath,
          selectedThreadIds: resolved?.candidateThreads.map((candidate) => candidate.threadId),
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
          mergedThreadIds: resolved?.sourceThreads.map((thread) => thread.threadId) ?? [],
          skippedThreadIds: resolved?.skippedThreadIds ?? [],
          sessionContextDir,
          warnings: warnings.length > 0 ? warnings : resolved?.warnings ?? [toErrorMessage(error)],
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
      const sessionContextResult = await writeSessionMemoryFiles({
        projectRoot: resolved.projectRoot,
        generatedAt: resolved.mergedState.generatedAt,
        selectionRule: resolved.selectionRule,
        sessions: buildSessionContextInputs(resolved.candidateThreads, resolved.sourceThreads),
      });
      const memory = await writeProjectMemory(resolved.mergedState, {
        projectRoot: resolved.projectRoot,
      });

      return {
        contextPath: sessionContextResult.contextPath,
        memoryPath: memory.path,
        sessionContextDir: sessionContextResult.dir,
        sessionContextPaths: sessionContextResult.paths,
        sessionMemoryDir: sessionContextResult.dir,
        sessionMemoryPaths: sessionContextResult.paths,
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
  options: { includeArchived: boolean; selectedThreadIds?: string[] },
): Promise<ResolvedMergeInput> {
  const discovery = await discoverProjectThreads(client, {
    cwd: projectRoot,
    includeArchived: options.includeArchived,
  });
  const historyByThread = await readMergeHistoryByThreadId(discovery.projectRoot);
  const mergeableCandidates = annotateCandidatesWithMergeHistory(
    filterMergeableCandidates(discovery.candidateThreads),
    historyByThread,
  );
  if (mergeableCandidates.length === 0) {
    throw new Error(`No mergeable project threads found under ${projectRoot}.`);
  }

  const candidateThreads = resolveSelectedCandidates(
    mergeableCandidates,
    options.selectedThreadIds,
    projectRoot,
  );
  if (candidateThreads.length === 0) {
    throw new Error(`No selected project threads found under ${projectRoot}.`);
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
    selectionRule: buildSelectionRule(discovery.selectionRule),
    candidateThreads,
    sourceThreads,
    mergedState,
    skippedThreadIds,
    warnings,
  };
}

function buildSessionContextInputs(
  candidates: ProjectThreadCandidateWithMergeHistory[],
  sourceThreads: SourceThread[],
): SessionMemoryInput[] {
  const candidateByThreadId = new Map(candidates.map((candidate) => [candidate.threadId, candidate]));
  return sourceThreads.map((thread) => {
    const candidate = candidateByThreadId.get(thread.threadId);
    return {
      threadId: thread.threadId,
      name: thread.name ?? candidate?.name ?? null,
      createdAt: candidate?.createdAt ?? null,
      updatedAt: thread.updatedAt ?? candidate?.updatedAt ?? null,
      archived: candidate?.archived,
      mergedBefore: candidate?.mergedBefore,
      mergedAt: candidate?.mergedAt ?? null,
      mergeCount: candidate?.mergeCount ?? 0,
      turns: thread.turns.map((turn) => ({
        role: turn.role,
        text: turn.text,
        createdAt: turn.createdAt,
      })),
    };
  });
}

function createMergeHistoryEntry(input: {
  mergedAt: string;
  canonicalThreadId: string;
  canonicalThreadName: string;
  canonicalTurnId: string;
  canonicalTurnStatus: string;
  resumeVerificationMessage?: string;
  contextPath?: string;
  memoryPath?: string;
  selectedThreadIds: string[];
  sessionContextDir?: string;
  mergedSessionCount: number;
  skippedSessionCount: number;
  warnings: string[];
}): MemoryMergeHistoryEntry {
  return {
    mergedAt: input.mergedAt,
    canonicalThreadId: input.canonicalThreadId,
    canonicalThreadName: input.canonicalThreadName,
    canonicalTurnId: input.canonicalTurnId,
    canonicalTurnStatus: input.canonicalTurnStatus,
    canonicalThreadResumeVerified: true,
    canonicalThreadResumeVerificationMessage: input.resumeVerificationMessage,
    contextPath: input.contextPath,
    memoryPath: input.memoryPath,
    selectedThreadIds: input.selectedThreadIds,
    sessionContextDir: input.sessionContextDir,
    sessionMemoryDir: input.sessionContextDir,
    mergedSessionCount: input.mergedSessionCount,
    skippedSessionCount: input.skippedSessionCount,
    warnings: input.warnings,
  };
}

function resolveProjectRoot(cwd?: string): string {
  return cwd && cwd.trim().length > 0 ? path.resolve(cwd) : process.cwd();
}

function buildCanonicalBootstrapFromMemory(
  memoryContent: string,
  state: MergedProjectState,
): string {
  const snapshot = getMemoryBootstrapSnapshot(memoryContent);
  if (!snapshot) {
    return buildCanonicalBootstrap(state);
  }

  return [
    "# Canonical Thread Bootstrap",
    "",
    "将以下 MEMORY 快照视为当前项目的规范化上下文。后续工作请基于这里继续推进；如发现冲突，先指出冲突再继续。",
    "",
    snapshot,
  ].join("\n");
}

async function waitForTurnCompletion(input: {
  client: CodexAppServerClient;
  threadId: string;
  turnId: string;
  initialStatus?: string;
  timeoutMs: number;
  intervalMs: number;
}): Promise<string> {
  if (input.initialStatus === "completed") {
    return input.initialStatus;
  }
  if (isFailedTurnStatus(input.initialStatus)) {
    throw new Error(`canonical turn failed: turnId=${input.turnId}, status=${input.initialStatus}`);
  }

  const deadline = Date.now() + input.timeoutMs;
  let lastStatus = "unknown";
  while (Date.now() <= deadline) {
    const thread = await input.client.readThread({
      threadId: input.threadId,
      includeTurns: true,
    });
    const matchedTurn = (thread.thread.turns ?? []).find((turn) => turn.id === input.turnId);
    if (matchedTurn?.status) {
      lastStatus = matchedTurn.status;
      if (matchedTurn.status === "completed") {
        return matchedTurn.status;
      }
      if (isFailedTurnStatus(matchedTurn.status)) {
        throw new Error(`canonical turn failed: turnId=${input.turnId}, status=${matchedTurn.status}`);
      }
    }
    await sleep(input.intervalMs);
  }
  throw new Error(
    `canonical turn did not complete in time: turnId=${input.turnId}, lastStatus=${lastStatus}`,
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isFailedTurnStatus(status?: string): boolean {
  return status === "failed" || status === "cancelled" || status === "interrupted";
}

function filterMergeableCandidates(
  candidates: ProjectThreadCandidate[],
): ProjectThreadCandidate[] {
  return candidates.filter((candidate) => !isManagedThreadName(candidate.name));
}

function resolveSelectedCandidates(
  mergeableCandidates: ProjectThreadCandidateWithMergeHistory[],
  selectedThreadIds: string[] | undefined,
  projectRoot: string,
): ProjectThreadCandidateWithMergeHistory[] {
  if (!selectedThreadIds) {
    return mergeableCandidates;
  }

  const normalizedSelectedThreadIds = normalizeSelectedThreadIds(selectedThreadIds);
  const candidateByThreadId = new Map(
    mergeableCandidates.map((candidate) => [candidate.threadId, candidate]),
  );
  const missingThreadIds = normalizedSelectedThreadIds.filter(
    (threadId) => !candidateByThreadId.has(threadId),
  );
  if (missingThreadIds.length > 0) {
    throw new Error(
      `Selected threads are not mergeable under ${projectRoot}: ${missingThreadIds.join(", ")}`,
    );
  }

  return normalizedSelectedThreadIds.map((threadId) => candidateByThreadId.get(threadId)!);
}

function normalizeSelectedThreadIds(threadIds: string[]): string[] {
  return Array.from(
    new Set(threadIds.map((threadId) => threadId.trim()).filter((threadId) => threadId.length > 0)),
  );
}

function annotateCandidatesWithMergeHistory(
  candidates: ProjectThreadCandidate[],
  historyByThread: Map<string, { mergedAt: string; mergeCount: number }>,
): ProjectThreadCandidateWithMergeHistory[] {
  return candidates.map((candidate) => {
    const history = historyByThread.get(candidate.threadId);
    return {
      ...candidate,
      mergedBefore: Boolean(history),
      mergedAt: history?.mergedAt ?? null,
      mergeCount: history?.mergeCount ?? 0,
    };
  });
}

function buildSelectionRule(discoverySelectionRule: string): string {
  return `${discoverySelectionRule} Exclude threads already marked as [Canonical] or [Merged].`;
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
        const text = [joinStringArray(item.summary), joinStringArray(item.content)]
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
