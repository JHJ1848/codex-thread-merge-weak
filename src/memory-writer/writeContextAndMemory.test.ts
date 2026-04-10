import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { MergedProjectState } from "../shared/merge-types.js";
import {
  getProjectContextPath,
  getProjectMemoryPath,
  getProjectSessionContextPath,
} from "./projectPaths.js";
import { writeContextAndMemory } from "./writeContextAndMemory.js";

const mergedState: MergedProjectState = {
  generatedAt: "2026-04-09T10:00:00.000Z",
  projectName: "demo",
  projectGoals: ["goal-a"],
  confirmedDecisions: ["decision-a"],
  currentState: ["state-a"],
  todos: ["todo-a"],
  risksAndConflicts: ["risk-a"],
  blockers: [],
  conflicts: [],
  sourceThreads: [
    { threadId: "s1", name: "session-one", updatedAt: "2026-04-09T09:00:00.000Z", turnCount: 2 },
    { threadId: "s2", name: "session-two", updatedAt: "2026-04-09T09:01:00.000Z", turnCount: 1 },
  ],
  warnings: [],
};

test("writeContextAndMemory writes context artifacts and appends memory history", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ctm-context-memory-"));
  const projectRoot = path.join(tempDir, "project");

  try {
    const result = await writeContextAndMemory({
      projectRoot,
      mergedState,
      selectionRule: "same project cwd",
      sessions: [
        {
          threadId: "s1",
          name: "session-one",
          turns: [
            { role: "user", text: "继续" },
            { role: "assistant", text: "PLAN: 做归并" },
          ],
        },
      ],
      mergeHistoryEntry: {
        mergedAt: "2026-04-09T10:00:00.000Z",
        canonicalThreadId: "canonical-1",
        canonicalThreadResumeVerified: true,
      },
    });

    assert.equal(result.memoryPath, getProjectMemoryPath(projectRoot));
    assert.equal(result.contextPath, getProjectContextPath(projectRoot));
    assert.deepEqual(result.sessionContextPaths, [getProjectSessionContextPath(projectRoot, "s1")]);

    const context = await readFile(result.contextPath, "utf8");
    assert.match(context, /# Project Context/);
    assert.match(context, /### s1/);

    const sessionContext = await readFile(result.sessionContextPaths[0], "utf8");
    assert.match(sessionContext, /# Session Context: s1/);

    const memory = await readFile(result.memoryPath, "utf8");
    assert.match(memory, /## Merge History/);
    assert.match(memory, /canonical-1/);
    assert.doesNotMatch(memory, /## 未完成任务/);
    assert.doesNotMatch(memory, /s2/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

