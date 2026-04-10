import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { MergedProjectState } from "../shared/merge-types.js";
import { getProjectMemoryPath } from "./projectPaths.js";
import { writeProjectMemory } from "./writeMemory.js";

const state: MergedProjectState = {
  generatedAt: "2026-04-09T00:00:00.000Z",
  projectName: "demo",
  projectGoals: ["goal"],
  confirmedDecisions: ["decision"],
  currentState: ["state"],
  todos: ["todo"],
  risksAndConflicts: [],
  blockers: [],
  conflicts: [],
  sourceThreads: [],
  warnings: [],
};

test("writeProjectMemory defaults to .codex/codex-thread-merge/MEMORY.md", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ctm-memory-path-"));
  const projectRoot = path.join(tempDir, "project");

  try {
    const result = await writeProjectMemory(state, { projectRoot });
    const expected = getProjectMemoryPath(projectRoot);
    assert.equal(result.path, expected);
    const content = await readFile(expected, "utf8");
    assert.match(content, /managed:start:codex-thread-merge/);
    assert.match(content, /## Merge History/);
    assert.doesNotMatch(content, /## 未完成任务/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("writeProjectMemory appends merge history only when mergeHistoryEntry is provided", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ctm-memory-history-"));
  const projectRoot = path.join(tempDir, "project");

  try {
    await writeProjectMemory(
      { ...state, generatedAt: "2026-04-09T01:00:00.000Z" },
      {
        projectRoot,
        mergeHistoryEntry: {
          mergedAt: "2026-04-09T01:00:00.000Z",
          canonicalThreadId: "canonical-1",
          canonicalThreadResumeVerified: true,
        },
      },
    );
    await writeProjectMemory(
      { ...state, generatedAt: "2026-04-09T02:00:00.000Z" },
      {
        projectRoot,
        mergeHistoryEntry: {
          mergedAt: "2026-04-09T02:00:00.000Z",
          canonicalThreadId: "canonical-2",
          canonicalThreadResumeVerified: true,
        },
      },
    );

    const content = await readFile(getProjectMemoryPath(projectRoot), "utf8");
    assert.match(content, /## Merge History/);
    assert.match(content, /### 2026-04-09T01:00:00.000Z/);
    assert.match(content, /### 2026-04-09T02:00:00.000Z/);
    assert.match(content, /canonical-1/);
    assert.match(content, /canonical-2/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("writeProjectMemory does not append history on refresh-style writes", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ctm-memory-refresh-"));
  const projectRoot = path.join(tempDir, "project");

  try {
    await writeProjectMemory(
      { ...state, generatedAt: "2026-04-09T03:00:00.000Z" },
      {
        projectRoot,
        mergeHistoryEntry: {
          mergedAt: "2026-04-09T03:00:00.000Z",
          canonicalThreadId: "canonical-3",
          canonicalThreadResumeVerified: true,
        },
      },
    );
    await writeProjectMemory(
      { ...state, generatedAt: "2026-04-09T04:00:00.000Z" },
      { projectRoot },
    );

    const content = await readFile(getProjectMemoryPath(projectRoot), "utf8");
    assert.match(content, /## Merge History/);
    assert.match(content, /### 2026-04-09T03:00:00.000Z/);
    assert.doesNotMatch(content, /### 2026-04-09T04:00:00.000Z/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
