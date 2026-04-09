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
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

