import test from "node:test";
import assert from "node:assert/strict";
import { getMemoryManagedBlock, upsertManagedBlock } from "./memoryTemplate.js";
import type { MergedProjectState } from "../shared/merge-types.js";

const state: MergedProjectState = {
  generatedAt: "2026-04-06T00:00:00.000Z",
  projectName: "demo",
  projectGoals: ["目标 A"],
  confirmedDecisions: ["决策 B"],
  currentState: ["状态 C"],
  todos: ["待办 D"],
  risksAndConflicts: ["风险 E"],
  blockers: [],
  conflicts: [],
  sourceThreads: [{ threadId: "t1", name: "thread", updatedAt: null, turnCount: 3 }],
  warnings: [],
};

test("upsertManagedBlock replaces existing managed block", () => {
  const block = getMemoryManagedBlock(state);
  const first = upsertManagedBlock("", block);
  const second = upsertManagedBlock(`${first}\n外部笔记\n`, block.replace("目标 A", "目标 Z"));

  assert.match(first, /# 项目目标/);
  assert.match(second, /目标 Z/);
  assert.match(second, /外部笔记/);
});
