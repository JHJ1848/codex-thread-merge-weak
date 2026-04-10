import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getProjectContextPath, getProjectSessionMemoryPath } from "./projectPaths.js";
import {
  formatProjectContextFile,
  formatSessionMemoryFile,
  writeSessionMemoryFiles,
} from "./writeSessionMemoryFiles.js";

test("formatSessionMemoryFile preserves normalized role markers", () => {
  const content = formatSessionMemoryFile({
    generatedAt: "2026-04-09T00:00:00.000Z",
    projectRoot: "D:\\workspace\\demo",
    session: {
      threadId: "demo",
      turns: [
        { role: "user", text: "继续" },
        { role: "assistant", text: "PLAN: 先预览候选会话。" },
        { role: "assistant", text: "REASONING: 检查路径与返回值。" },
      ],
    },
  });

  assert.match(content, /User: 继续/);
  assert.match(content, /Codex-Plan: 先预览候选会话。/);
  assert.match(content, /Codex-Reasoning: 检查路径与返回值。/);
});

test("formatProjectContextFile writes grouped session overview and turns", () => {
  const content = formatProjectContextFile({
    generatedAt: "2026-04-09T00:00:00.000Z",
    projectRoot: "D:\\workspace\\demo",
    sessions: [
      {
        threadId: "s1",
        name: "alpha",
        turns: [
          { role: "user", text: "继续" },
          { role: "assistant", text: "PLAN: 先预览" },
        ],
      },
    ],
  });

  assert.match(content, /# Project Context/);
  assert.match(content, /- s1 \(alpha\)/);
  assert.match(content, /### s1/);
  assert.match(content, /User: 继续/);
  assert.match(content, /Codex-Plan: 先预览/);
});

test("writeSessionMemoryFiles creates one file per session under project .codex directory", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ctm-session-memory-"));
  const projectRoot = path.join(tempDir, "project");

  try {
    const result = await writeSessionMemoryFiles({
      projectRoot,
      generatedAt: "2026-04-09T00:00:00.000Z",
      selectionRule: "test rule",
      sessions: [
        {
          threadId: "s1",
          name: "session one",
          updatedAt: "2026-04-08T10:00:00.000Z",
          turns: [
            { role: "user", text: "需求：合并会话。", createdAt: "2026-04-08T10:01:00.000Z" },
            { role: "assistant", text: "已开始处理。", createdAt: "2026-04-08T10:01:10.000Z" },
          ],
        },
        {
          threadId: "s2",
          name: null,
          updatedAt: null,
          turns: [{ role: "assistant", text: "PLAN: 先预览再合并。" }],
        },
      ],
    });

    const sessionOnePath = getProjectSessionMemoryPath(projectRoot, "s1");
    const sessionTwoPath = getProjectSessionMemoryPath(projectRoot, "s2");
    const contextPath = getProjectContextPath(projectRoot);
    assert.equal(result.paths.length, 2);
    assert.deepEqual(result.paths, [sessionOnePath, sessionTwoPath]);
    assert.equal(result.contextPath, contextPath);

    const sessionOne = await readFile(sessionOnePath, "utf8");
    assert.match(sessionOne, /# Session Context: s1/);
    assert.match(sessionOne, /- selectionRule: test rule/);
    assert.match(sessionOne, /\[2026-04-08T10:01:00.000Z\] User: 需求：合并会话。/);
    assert.match(sessionOne, /\[2026-04-08T10:01:10.000Z\] Codex: 已开始处理。/);

    const sessionTwo = await readFile(sessionTwoPath, "utf8");
    assert.match(sessionTwo, /# Session Context: s2/);
    assert.match(sessionTwo, /- name: unnamed/);
    assert.match(sessionTwo, /Codex-Plan: 先预览再合并。/);

    const context = await readFile(contextPath, "utf8");
    assert.match(context, /# Project Context/);
    assert.match(context, /### s1/);
    assert.match(context, /### s2/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("writeSessionMemoryFiles removes stale markdown files from the session memory directory", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ctm-session-memory-clean-"));
  const projectRoot = path.join(tempDir, "project");
  const stalePath = getProjectSessionMemoryPath(projectRoot, "stale");

  try {
    await writeSessionMemoryFiles({
      projectRoot,
      generatedAt: "2026-04-09T00:00:00.000Z",
      sessions: [{ threadId: "stale", turns: [{ role: "user", text: "old" }] }],
    });

    await writeFile(path.join(path.dirname(stalePath), "notes.txt"), "keep", "utf8");

    const result = await writeSessionMemoryFiles({
      projectRoot,
      generatedAt: "2026-04-09T01:00:00.000Z",
      sessions: [{ threadId: "fresh", turns: [{ role: "assistant", text: "new" }] }],
    });

    await assert.rejects(() => readFile(stalePath, "utf8"));
    assert.equal(result.paths.length, 1);
    assert.equal(
      result.paths[0],
      getProjectSessionMemoryPath(projectRoot, "fresh"),
    );
    assert.equal(
      await readFile(path.join(path.dirname(stalePath), "notes.txt"), "utf8"),
      "keep",
    );
    assert.match(await readFile(result.contextPath, "utf8"), /# Project Context/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
