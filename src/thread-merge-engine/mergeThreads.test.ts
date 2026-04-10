import test from "node:test";
import assert from "node:assert/strict";
import { buildCanonicalBootstrap, mergeThreadsToProjectState } from "./mergeThreads.js";
import type { SourceThread } from "../shared/merge-types.js";

test("mergeThreadsToProjectState deduplicates facts and records conflicts", () => {
  const threads: SourceThread[] = [
    {
      threadId: "t1",
      name: "thread-1",
      turns: [
        { role: "user", text: "项目目标是实现一个本地 STDIO MCP server。" },
        { role: "assistant", text: "已决定使用 TypeScript + Node.js 18+。" },
        { role: "assistant", text: "当前状态：已经实现 preview_project_threads。" },
      ],
    },
    {
      threadId: "t2",
      name: "thread-2",
      turns: [
        { role: "user", text: "决定：不做 plugin，改为 MCP server + skill。" },
        { role: "assistant", text: "待办：继续实现 MEMORY.md 写入。" },
        { role: "assistant", text: "风险：rename 接口可能变化。" },
      ],
    },
  ];

  const merged = mergeThreadsToProjectState(threads, { projectName: "demo" });

  assert.equal(merged.projectName, "demo");
  assert.match(merged.projectGoals.join("\n"), /STDIO MCP server/);
  assert.match(merged.confirmedDecisions.join("\n"), /TypeScript/);
  assert.match(merged.confirmedDecisions.join("\n"), /不做 plugin/);
  assert.match(merged.todos.join("\n"), /MEMORY/i);
  assert.match(merged.risksAndConflicts.join("\n"), /rename/);
  assert.ok(merged.sourceThreads.length === 2);
  const bootstrap = buildCanonicalBootstrap(merged);
  assert.match(bootstrap, /来源会话/);
  assert.doesNotMatch(bootstrap, /## 未完成任务/);
});
