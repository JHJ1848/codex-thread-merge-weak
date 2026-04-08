import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  MergeProjectThreadsUseCaseImpl,
  type UseCaseDependencies,
} from "./use-cases.js";

test("merge creates a canonical thread with merged bootstrap content", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ctm-merge-success-"));
  const calls: {
    startThread?: { cwd?: string };
    setThreadNames: string[];
    startTurnTexts: string[];
    compactThreadIds: string[];
  } = {
    setThreadNames: [],
    startTurnTexts: [],
    compactThreadIds: [],
  };

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

  const deps: UseCaseDependencies = {
    createCodexClient: () => client as never,
  };

  try {
    const useCase = new MergeProjectThreadsUseCaseImpl(deps);
    const result = await useCase.execute({
      cwd: projectRoot,
      writeMemory: false,
      compactOldThreads: true,
      renameOldThreads: true,
    });

    assert.equal(calls.startThread?.cwd, projectRoot);
    assert.equal(result.canonicalThreadId, "canonical-thread");
    assert.match(result.canonicalThreadName, /^\[Canonical\] ctm-merge-success-.* \d{4}-\d{2}-\d{2}$/);
    assert.equal(result.mergedThreadIds[0], "t1");
    assert.equal(calls.compactThreadIds[0], "t1");
    assert.match(calls.setThreadNames[0], /^canonical-thread:\[Canonical\] ctm-merge-success-/);
    assert.match(calls.setThreadNames[1], /^t1:feature discussion \[Merged\]$/);
    assert.match(calls.startTurnTexts[0], /^canonical-thread:.*来源会话/s);
    assert.equal(result.recordLogPath, path.join(projectRoot, "memory", "record.log"));

    const logContent = await readFile(result.recordLogPath, "utf8");
    assert.match(logContent, /status: success/);
    assert.match(logContent, /canonicalThread: canonical-thread/);
    assert.match(logContent, /1\. t1/);
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
          writeMemory: false,
        }),
      /thread\/start failed/,
    );

    const recordLogPath = path.join(projectRoot, "memory", "record.log");
    const logContent = await readFile(recordLogPath, "utf8");
    assert.match(logContent, /status: failed/);
    assert.match(logContent, /thread\/start failed/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("merge warns when record log cannot be written", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ctm-merge-warning-"));
  await writeFile(path.join(projectRoot, "memory"), "occupied", "utf8");

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

  const deps: UseCaseDependencies = {
    createCodexClient: () => client as never,
  };

  try {
    const useCase = new MergeProjectThreadsUseCaseImpl(deps);
    const result = await useCase.execute({
      cwd: projectRoot,
      writeMemory: false,
    });

    assert.equal(result.recordLogPath, undefined);
    assert.match(result.warnings.join("\n"), /record\.log write failed/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
