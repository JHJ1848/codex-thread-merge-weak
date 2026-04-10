import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  MergeProjectThreadsUseCaseImpl,
  PreviewProjectThreadsUseCaseImpl,
  RefreshProjectMemoryUseCaseImpl,
  type UseCaseDependencies,
} from "./use-cases.js";

test("preview includes merge history fields from record.log", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ctm-preview-history-"));
  const artifactRoot = path.join(projectRoot, ".codex", "codex-thread-merge");
  await mkdir(artifactRoot, { recursive: true });
  await writeFile(
    path.join(artifactRoot, "record.log"),
    [
      "=== Merge Record ===",
      "recordedAt: 2026-04-08T10:00:00.000Z",
      "status: success",
      "",
      "candidateSessions:",
      "1. t1",
      "   - mergeState: merged",
      "2. t2",
      "   - mergeState: skipped",
      "",
      "warnings:",
      "- none",
      "",
      "=== Merge Record ===",
      "recordedAt: 2026-04-08T11:00:00.000Z",
      "status: success",
      "",
      "candidateSessions:",
      "1. t1",
      "   - mergeState: merged",
      "",
      "warnings:",
      "- none",
      "",
    ].join("\n"),
    "utf8",
  );

  const client = {
    async listThreads() {
      return {
        threads: [
          {
            id: "t1",
            name: "feature discussion",
            cwd: projectRoot,
            archived: false,
            updatedAt: "2026-04-08T12:00:00.000Z",
          },
          {
            id: "t2",
            name: "secondary thread",
            cwd: projectRoot,
            archived: false,
            updatedAt: "2026-04-08T09:00:00.000Z",
          },
          {
            id: "managed-thread",
            name: "[Merged]",
            cwd: projectRoot,
            archived: false,
            updatedAt: "2026-04-08T08:00:00.000Z",
          },
        ],
        nextCursor: undefined,
      };
    },
    close() {},
  };

  const deps: UseCaseDependencies = {
    createCodexClient: () => client as never,
  };

  try {
    const useCase = new PreviewProjectThreadsUseCaseImpl(deps);
    const result = await useCase.execute({ cwd: projectRoot });

    assert.equal(result.candidateThreads.length, 2);
    const t1 = result.candidateThreads.find((thread) => thread.threadId === "t1");
    const t2 = result.candidateThreads.find((thread) => thread.threadId === "t2");
    assert.equal(t1?.mergedBefore, true);
    assert.equal(t1?.mergeCount, 2);
    assert.equal(t1?.mergedAt, "2026-04-08T11:00:00.000Z");
    assert.equal(t2?.mergedBefore, false);
    assert.equal(t2?.mergeCount, 0);
    assert.equal(t2?.mergedAt, null);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("merge creates a canonical thread with merged bootstrap content", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ctm-merge-success-"));
  const calls: {
    startThread?: { cwd?: string };
    setThreadNames: string[];
    startTurnTexts: string[];
    compactThreadIds: string[];
    resumeCalls: Array<{ threadId: string; cwd?: string }>;
    createdClients: number;
  } = {
    setThreadNames: [],
    startTurnTexts: [],
    compactThreadIds: [],
    resumeCalls: [],
    createdClients: 0,
  };

  const primaryClient = {
    async listThreads() {
      return {
        threads: [
          {
            id: "t1",
            name: "feature discussion",
            cwd: projectRoot,
            archived: false,
            createdAt: "2026-04-08T00:00:00.000Z",
            updatedAt: "2026-04-08T00:10:00.000Z",
            turns: [],
          },
        ],
        nextCursor: undefined,
      };
    },
    async readThread(params?: { threadId?: string; includeTurns?: boolean }) {
      if (params?.threadId === "canonical-thread") {
        return {
          thread: {
            id: "canonical-thread",
            turns: [{ id: "turn-new", status: "completed", items: [] }],
          },
        };
      }
      return {
        thread: {
          id: "t1",
          turns: [
            {
              id: "turn-1",
              items: [
                {
                  type: "userMessage",
                  content: [{ type: "text", text: "项目目标是归并当前项目的所有会话。" }],
                },
                {
                  type: "agentMessage",
                  text: "当前状态：已经完成预览逻辑。",
                },
              ],
            },
          ],
        },
      };
    },
    async startThread(params: { cwd?: string }) {
      calls.startThread = params;
      return { id: "canonical-thread" };
    },
    async setThreadName(params: { threadId: string; name: string }) {
      calls.setThreadNames.push(`${params.threadId}:${params.name}`);
    },
    async startTurn(params: { threadId: string; text: string }) {
      calls.startTurnTexts.push(`${params.threadId}:${params.text}`);
      return { id: "turn-new", status: "completed", items: [] };
    },
    async compactThread(params: { threadId: string }) {
      calls.compactThreadIds.push(params.threadId);
    },
    close() {},
  };

  const resumeClient = {
    async resumeThread(params: { threadId: string; cwd?: string }) {
      calls.resumeCalls.push(params);
      return { id: "canonical-thread", status: "active" };
    },
    close() {},
  };

  const deps: UseCaseDependencies = {
    createCodexClient: () => {
      calls.createdClients += 1;
      return (calls.createdClients === 1 ? primaryClient : resumeClient) as never;
    },
  };

  try {
    const useCase = new MergeProjectThreadsUseCaseImpl(deps);
    const result = await useCase.execute({
      cwd: projectRoot,
      selectedThreadIds: ["t1"],
      writeMemory: false,
      compactOldThreads: true,
      renameOldThreads: true,
    });

    assert.equal(calls.startThread?.cwd, projectRoot);
    assert.equal(result.canonicalThreadId, "canonical-thread");
    assert.equal(result.canonicalTurnId, "turn-new");
    assert.equal(result.canonicalTurnStatus, "completed");
    assert.equal(result.resumeVerified, true);
    assert.equal(result.resumeThreadStatus, "active");
    assert.match(result.canonicalThreadName, /^\[Canonical\] ctm-merge-success-.* \d{4}-\d{2}-\d{2}$/);
    assert.equal(result.mergedThreadIds[0], "t1");
    assert.deepEqual(result.selectedThreadIds, ["t1"]);
    assert.equal(calls.compactThreadIds[0], "t1");
    assert.equal(calls.resumeCalls.length, 1);
    assert.equal(calls.resumeCalls[0]?.threadId, "canonical-thread");
    assert.equal(calls.resumeCalls[0]?.cwd, projectRoot);
    assert.match(calls.setThreadNames[0], /^canonical-thread:\[Canonical\] ctm-merge-success-/);
    assert.match(calls.setThreadNames[1], /^t1:feature discussion \[Merged\]$/);
    assert.match(calls.startTurnTexts[0], /^canonical-thread:.*来源会话/s);
    const artifactRoot = path.join(projectRoot, ".codex", "codex-thread-merge");
    assert.equal(result.recordLogPath, path.join(artifactRoot, "record.log"));
    assert.equal(result.sessionMemoryDir, undefined);
    assert.equal(result.sessionMemoryPaths.length, 0);
    assert.equal(result.contextPath, undefined);
    assert.equal(result.sessionContextDir, undefined);
    assert.deepEqual(result.sessionContextPaths, []);

    const logContent = await readFile(result.recordLogPath, "utf8");
    assert.match(logContent, /status: success/);
    assert.match(logContent, /canonicalThread: canonical-thread/);
    assert.match(logContent, /1\. t1/);

  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("merge only processes selected thread ids", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ctm-merge-selected-"));
  const readThreadCalls: string[] = [];

  const primaryClient = {
    async listThreads() {
      return {
        threads: [
          {
            id: "t1",
            name: "thread-1",
            cwd: projectRoot,
            archived: false,
            createdAt: "2026-04-08T00:00:00.000Z",
            updatedAt: "2026-04-08T00:10:00.000Z",
            turns: [],
          },
          {
            id: "t2",
            name: "thread-2",
            cwd: projectRoot,
            archived: false,
            createdAt: "2026-04-08T00:00:00.000Z",
            updatedAt: "2026-04-08T00:11:00.000Z",
            turns: [],
          },
        ],
        nextCursor: undefined,
      };
    },
    async readThread(params?: { threadId?: string; includeTurns?: boolean }) {
      if (params?.threadId === "canonical-thread") {
        return {
          thread: {
            id: "canonical-thread",
            turns: [{ id: "turn-new", status: "completed", items: [] }],
          },
        };
      }
      readThreadCalls.push(params?.threadId ?? "unknown");
      return {
        thread: {
          id: "t2",
          turns: [
            {
              id: "turn-2",
              items: [{ type: "agentMessage", text: "当前状态：仅处理选中线程。" }],
            },
          ],
        },
      };
    },
    async startThread() {
      return { id: "canonical-thread" };
    },
    async setThreadName() {},
    async startTurn() {
      return { id: "turn-new", status: "completed", items: [] };
    },
    async compactThread() {},
    close() {},
  };

  const resumeClient = {
    async resumeThread() {
      return { id: "canonical-thread", status: "active" };
    },
    close() {},
  };

  let createdClients = 0;
  const deps: UseCaseDependencies = {
    createCodexClient: () => {
      createdClients += 1;
      return (createdClients === 1 ? primaryClient : resumeClient) as never;
    },
  };

  try {
    const useCase = new MergeProjectThreadsUseCaseImpl(deps);
    const result = await useCase.execute({
      cwd: projectRoot,
      selectedThreadIds: ["t2"],
      writeMemory: false,
    });

    assert.deepEqual(result.selectedThreadIds, ["t2"]);
    assert.deepEqual(result.mergedThreadIds, ["t2"]);
    assert.deepEqual(readThreadCalls, ["t2"]);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("merge fails when selected thread is not mergeable", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ctm-merge-selected-missing-"));

  const client = {
    async listThreads() {
      return {
        threads: [
          {
            id: "t1",
            name: "thread-1",
            cwd: projectRoot,
            archived: false,
            createdAt: "2026-04-08T00:00:00.000Z",
            updatedAt: "2026-04-08T00:10:00.000Z",
            turns: [],
          },
        ],
        nextCursor: undefined,
      };
    },
    close() {},
  };

  const deps: UseCaseDependencies = {
    createCodexClient: () => client as never,
  };

  try {
    const useCase = new MergeProjectThreadsUseCaseImpl(deps);
    await assert.rejects(
      () =>
        useCase.execute({
          cwd: projectRoot,
          selectedThreadIds: ["missing-thread"],
          writeMemory: false,
        }),
      /Selected threads are not mergeable/,
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("merge logs failures without replacing the original error", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ctm-merge-fail-"));

  const client = {
    async listThreads() {
      return {
        threads: [
          {
            id: "t1",
            name: "feature discussion",
            cwd: projectRoot,
            archived: false,
            createdAt: "2026-04-08T00:00:00.000Z",
            updatedAt: "2026-04-08T00:10:00.000Z",
            turns: [],
          },
        ],
        nextCursor: undefined,
      };
    },
    async readThread() {
      return {
        thread: {
          id: "t1",
          turns: [
            {
              id: "turn-1",
              items: [
                {
                  type: "agentMessage",
                  text: "当前状态：已经完成预览逻辑。",
                },
              ],
            },
          ],
        },
      };
    },
    async startThread() {
      throw new Error("thread/start failed");
    },
    close() {},
  };

  const deps: UseCaseDependencies = {
    createCodexClient: () => client as never,
  };

  try {
    const useCase = new MergeProjectThreadsUseCaseImpl(deps);
    await assert.rejects(
      () =>
        useCase.execute({
          cwd: projectRoot,
          selectedThreadIds: ["t1"],
          writeMemory: false,
        }),
      /thread\/start failed/,
    );

    const recordLogPath = path.join(
      projectRoot,
      ".codex",
      "codex-thread-merge",
      "record.log",
    );
    const logContent = await readFile(recordLogPath, "utf8");
    assert.match(logContent, /status: failed/);
    assert.match(logContent, /thread\/start failed/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("merge fails when record log cannot be written", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ctm-merge-warning-"));
  const artifactRoot = path.join(projectRoot, ".codex", "codex-thread-merge");
  await mkdir(artifactRoot, { recursive: true });
  await mkdir(path.join(artifactRoot, "record.log"), { recursive: true });

  const primaryClient = {
    async listThreads() {
      return {
        threads: [
          {
            id: "t1",
            name: "feature discussion",
            cwd: projectRoot,
            archived: false,
            createdAt: "2026-04-08T00:00:00.000Z",
            updatedAt: "2026-04-08T00:10:00.000Z",
            turns: [],
          },
        ],
        nextCursor: undefined,
      };
    },
    async readThread(params?: { threadId?: string; includeTurns?: boolean }) {
      if (params?.threadId === "canonical-thread") {
        return {
          thread: {
            id: "canonical-thread",
            turns: [{ id: "turn-new", status: "completed", items: [] }],
          },
        };
      }
      return {
        thread: {
          id: "t1",
          turns: [
            {
              id: "turn-1",
              items: [
                {
                  type: "agentMessage",
                  text: "当前状态：已经完成预览逻辑。",
                },
              ],
            },
          ],
        },
      };
    },
    async startThread(params: { cwd?: string }) {
      return { id: "canonical-thread", cwd: params.cwd };
    },
    async setThreadName() {},
    async startTurn() {
      return { id: "turn-new", status: "completed", items: [] };
    },
    async compactThread() {},
    close() {},
  };

  const resumeClient = {
    async resumeThread() {
      return { id: "canonical-thread", status: "active" };
    },
    close() {},
  };

  let createdClients = 0;
  const deps: UseCaseDependencies = {
    createCodexClient: () => {
      createdClients += 1;
      return (createdClients === 1 ? primaryClient : resumeClient) as never;
    },
  };

  try {
    const useCase = new MergeProjectThreadsUseCaseImpl(deps);
    await assert.rejects(
      () =>
        useCase.execute({
          cwd: projectRoot,
          selectedThreadIds: ["t1"],
          writeMemory: false,
        }),
      /EISDIR|record\.log/,
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("merge with writeMemory false skips session memory files", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ctm-merge-no-memory-"));
  const compactThreadIds: string[] = [];
  const renamedOldThreadIds: string[] = [];

  const primaryClient = {
    async listThreads() {
      return {
        threads: [
          {
            id: "t1",
            name: "feature discussion",
            cwd: projectRoot,
            archived: false,
            createdAt: "2026-04-08T00:00:00.000Z",
            updatedAt: "2026-04-08T00:10:00.000Z",
            turns: [],
          },
        ],
        nextCursor: undefined,
      };
    },
    async readThread(params?: { threadId?: string; includeTurns?: boolean }) {
      if (params?.threadId === "canonical-thread") {
        return {
          thread: {
            id: "canonical-thread",
            turns: [{ id: "turn-new", status: "completed", items: [] }],
          },
        };
      }
      return {
        thread: {
          id: "t1",
          turns: [
            {
              id: "turn-1",
              items: [
                {
                  type: "agentMessage",
                  text: "当前状态：已经完成预览逻辑。",
                },
              ],
            },
          ],
        },
      };
    },
    async startThread() {
      return { id: "canonical-thread" };
    },
    async setThreadName(params: { threadId: string; name: string }) {
      if (params.threadId === "t1") {
        renamedOldThreadIds.push(params.threadId);
      }
    },
    async startTurn() {
      return { id: "turn-new", status: "completed", items: [] };
    },
    async compactThread(params: { threadId: string }) {
      compactThreadIds.push(params.threadId);
    },
    close() {},
  };

  const resumeClient = {
    async resumeThread() {
      return { id: "canonical-thread", status: "active" };
    },
    close() {},
  };

  let createdClients = 0;
  const deps: UseCaseDependencies = {
    createCodexClient: () => {
      createdClients += 1;
      return (createdClients === 1 ? primaryClient : resumeClient) as never;
    },
  };

  try {
    const useCase = new MergeProjectThreadsUseCaseImpl(deps);
    const result = await useCase.execute({
      cwd: projectRoot,
      selectedThreadIds: ["t1"],
      writeMemory: false,
    });

    assert.equal(result.memoryPath, undefined);
    assert.equal(result.sessionMemoryDir, undefined);
    assert.deepEqual(result.sessionMemoryPaths, []);
    assert.equal(result.resumeVerified, true);
    assert.deepEqual(compactThreadIds, []);
    assert.deepEqual(renamedOldThreadIds, []);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("merge fails when fresh resume client cannot resume canonical thread", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ctm-merge-resume-fail-"));

  const primaryClient = {
    async listThreads() {
      return {
        threads: [
          {
            id: "t1",
            name: "feature discussion",
            cwd: projectRoot,
            archived: false,
            createdAt: "2026-04-08T00:00:00.000Z",
            updatedAt: "2026-04-08T00:10:00.000Z",
            turns: [],
          },
        ],
        nextCursor: undefined,
      };
    },
    async readThread(params?: { threadId?: string; includeTurns?: boolean }) {
      if (params?.threadId === "canonical-thread") {
        return {
          thread: {
            id: "canonical-thread",
            turns: [{ id: "turn-new", status: "completed", items: [] }],
          },
        };
      }
      return {
        thread: {
          id: "t1",
          turns: [
            {
              id: "turn-1",
              items: [
                {
                  type: "agentMessage",
                  text: "当前状态：已经完成预览逻辑。",
                },
              ],
            },
          ],
        },
      };
    },
    async startThread() {
      return { id: "canonical-thread" };
    },
    async setThreadName() {},
    async startTurn() {
      return { id: "turn-new", status: "completed", items: [] };
    },
    async compactThread() {},
    close() {},
  };

  const resumeClient = {
    async resumeThread() {
      throw new Error("thread/resume failed");
    },
    close() {},
  };

  let createdClients = 0;
  const deps: UseCaseDependencies = {
    createCodexClient: () => {
      createdClients += 1;
      return (createdClients === 1 ? primaryClient : resumeClient) as never;
    },
  };

  try {
    const useCase = new MergeProjectThreadsUseCaseImpl(deps);
    await assert.rejects(
      () =>
        useCase.execute({
          cwd: projectRoot,
          selectedThreadIds: ["t1"],
          writeMemory: false,
        }),
      /thread\/resume failed/,
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("merge fails when fresh resume client returns different thread id", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ctm-merge-resume-mismatch-"));

  const primaryClient = {
    async listThreads() {
      return {
        threads: [
          {
            id: "t1",
            name: "feature discussion",
            cwd: projectRoot,
            archived: false,
            createdAt: "2026-04-08T00:00:00.000Z",
            updatedAt: "2026-04-08T00:10:00.000Z",
            turns: [],
          },
        ],
        nextCursor: undefined,
      };
    },
    async readThread(params?: { threadId?: string; includeTurns?: boolean }) {
      if (params?.threadId === "canonical-thread") {
        return {
          thread: {
            id: "canonical-thread",
            turns: [{ id: "turn-new", status: "completed", items: [] }],
          },
        };
      }
      return {
        thread: {
          id: "t1",
          turns: [
            {
              id: "turn-1",
              items: [
                {
                  type: "agentMessage",
                  text: "当前状态：已经完成预览逻辑。",
                },
              ],
            },
          ],
        },
      };
    },
    async startThread() {
      return { id: "canonical-thread" };
    },
    async setThreadName() {},
    async startTurn() {
      return { id: "turn-new", status: "completed", items: [] };
    },
    async compactThread() {},
    close() {},
  };

  const resumeClient = {
    async resumeThread() {
      return { id: "other-thread", status: "active" };
    },
    close() {},
  };

  let createdClients = 0;
  const deps: UseCaseDependencies = {
    createCodexClient: () => {
      createdClients += 1;
      return (createdClients === 1 ? primaryClient : resumeClient) as never;
    },
  };

  try {
    const useCase = new MergeProjectThreadsUseCaseImpl(deps);
    await assert.rejects(
      () =>
        useCase.execute({
          cwd: projectRoot,
          selectedThreadIds: ["t1"],
          writeMemory: false,
        }),
      /thread\/resume returned unexpected thread id/,
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("refresh writes memory and session files under .codex/codex-thread-merge", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ctm-refresh-success-"));

  const client = {
    async listThreads() {
      return {
        threads: [
          {
            id: "t1",
            name: "refresh-thread",
            cwd: projectRoot,
            archived: false,
            createdAt: "2026-04-08T00:00:00.000Z",
            updatedAt: "2026-04-08T00:10:00.000Z",
            turns: [],
          },
        ],
        nextCursor: undefined,
      };
    },
    async readThread() {
      return {
        thread: {
          id: "t1",
          turns: [
            {
              id: "turn-1",
              items: [
                {
                  type: "userMessage",
                  content: [{ type: "text", text: "刷新记忆并产出会话文件。" }],
                },
                {
                  type: "agentMessage",
                  text: "收到，开始刷新。",
                },
              ],
            },
          ],
        },
      };
    },
    close() {},
  };

  const deps: UseCaseDependencies = {
    createCodexClient: () => client as never,
  };

  try {
    const useCase = new RefreshProjectMemoryUseCaseImpl(deps);
    const result = await useCase.execute({ cwd: projectRoot });
    const artifactRoot = path.join(projectRoot, ".codex", "codex-thread-merge");

    assert.equal(result.memoryPath, path.join(artifactRoot, "MEMORY.md"));
    assert.equal(result.sessionMemoryDir, path.join(artifactRoot, "context"));
    assert.equal(result.sessionMemoryPaths.length, 1);
    assert.equal(result.sessionMemoryPaths[0], path.join(artifactRoot, "context", "t1.md"));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("merge with writeMemory true writes summary plus merge history without unfinished tasks", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ctm-merge-memory-history-"));

  const primaryClient = {
    async listThreads() {
      return {
        threads: [
          {
            id: "t1",
            name: "memory-thread",
            cwd: projectRoot,
            archived: false,
            createdAt: "2026-04-08T00:00:00.000Z",
            updatedAt: "2026-04-08T00:10:00.000Z",
            turns: [],
          },
        ],
        nextCursor: undefined,
      };
    },
    async readThread(params?: { threadId?: string; includeTurns?: boolean }) {
      if (params?.threadId === "canonical-thread") {
        return {
          thread: {
            id: "canonical-thread",
            turns: [{ id: "turn-new", status: "completed", items: [] }],
          },
        };
      }
      return {
        thread: {
          id: "t1",
          turns: [
            {
              id: "turn-1",
              items: [
                {
                  type: "userMessage",
                  content: [{ type: "text", text: "项目目标是沉淀长期记忆。" }],
                },
                {
                  type: "agentMessage",
                  text: "待办：这句不应进入 MEMORY.md。",
                },
                {
                  type: "agentMessage",
                  text: "当前状态：已经实现归并主流程。",
                },
              ],
            },
          ],
        },
      };
    },
    async startThread() {
      return { id: "canonical-thread" };
    },
    async setThreadName() {},
    async startTurn() {
      return { id: "turn-new", status: "completed", items: [] };
    },
    async compactThread() {},
    close() {},
  };

  const resumeClient = {
    async resumeThread() {
      return { id: "canonical-thread", status: "active" };
    },
    close() {},
  };

  let createdClients = 0;
  const deps: UseCaseDependencies = {
    createCodexClient: () => {
      createdClients += 1;
      return (createdClients === 1 ? primaryClient : resumeClient) as never;
    },
  };

  try {
    const useCase = new MergeProjectThreadsUseCaseImpl(deps);
    const result = await useCase.execute({
      cwd: projectRoot,
      selectedThreadIds: ["t1"],
      writeMemory: true,
      compactOldThreads: false,
      renameOldThreads: false,
    });

    const memoryContent = await readFile(result.memoryPath!, "utf8");
    assert.match(memoryContent, /## Merge History/);
    assert.match(memoryContent, /canonical-thread/);
    assert.match(memoryContent, /record\.log/);
    assert.doesNotMatch(memoryContent, /未完成任务/);
    assert.equal(result.sessionMemoryPaths.length, 1);
    assert.equal(result.contextPath, path.join(projectRoot, ".codex", "codex-thread-merge", "CONTEXT.md"));
    assert.equal(result.sessionContextDir, result.sessionMemoryDir);
    assert.deepEqual(result.sessionContextPaths, result.sessionMemoryPaths);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
