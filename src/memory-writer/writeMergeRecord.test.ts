import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  appendMergeRecord,
  formatMergeRecord,
  getDefaultSessionRoots,
  type WriteMergeRecordInput,
} from "./writeMergeRecord.js";

async function withTempDir(run: (tempDir: string) => Promise<void>): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ctm-record-test-"));
  try {
    await run(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

test("appendMergeRecord writes readable log and resolves session files with preferred roots", async () => {
  await withTempDir(async (tempDir) => {
    const projectRoot = path.join(tempDir, "project");
    const sessionRoot = path.join(tempDir, ".codex", "sessions");
    const archivedRoot = path.join(tempDir, ".codex", "archived_sessions");
    await mkdir(path.join(projectRoot, "memory"), { recursive: true });
    await mkdir(path.join(sessionRoot, "2026", "04"), { recursive: true });
    await mkdir(path.join(archivedRoot, "2026", "04"), { recursive: true });

    const preferredSessionPath = path.join(sessionRoot, "2026", "04", "demo-thread-a.jsonl");
    const archivedSessionPath = path.join(archivedRoot, "2026", "04", "demo-thread-a.jsonl");
    const archivedOnlyPath = path.join(archivedRoot, "2026", "04", "demo-thread-b.jsonl");
    await writeFile(preferredSessionPath, '{"id":"1"}\n{"id":"2"}\n', "utf8");
    await writeFile(archivedSessionPath, '{"id":"archived"}\n', "utf8");
    await writeFile(archivedOnlyPath, '{"id":"x"}\n', "utf8");

    const input: WriteMergeRecordInput = {
      projectRoot,
      projectName: "demo-project",
      resultStatus: "success",
      recordedAt: "2026-04-08T10:00:00.000Z",
      canonicalThreadId: "canonical-1",
      canonicalThreadName: "[Canonical] demo-project 2026-04-08",
      memoryPath: path.join(projectRoot, "MEMORY.md"),
      selectionRule: "include project cwd",
      candidateSessions: [
        { threadId: "thread-a", name: "Session A", updatedAt: "2026-04-08T09:00:00.000Z", turnCount: 5 },
        { threadId: "thread-b", name: "Session B", updatedAt: "2026-04-08T08:00:00.000Z", turnCount: 2 },
        { threadId: "thread-c", name: "Session C", updatedAt: null, turnCount: 1 },
      ],
      mergedThreadIds: ["thread-a"],
      skippedThreadIds: ["thread-c"],
      warnings: ["rename failed for thread-c"],
      options: {
        includeArchived: true,
        writeMemory: true,
        compactOldThreads: true,
        renameOldThreads: false,
      },
      sessionRoots: [sessionRoot, archivedRoot],
    };

    const result = await appendMergeRecord(input);

    assert.equal(result.path, path.join(projectRoot, "memory", "record.log"));
    assert.equal(result.sessionSummaries[0]?.path, preferredSessionPath);
    assert.equal(result.sessionSummaries[1]?.path, archivedOnlyPath);
    assert.equal(result.sessionSummaries[2]?.found, false);
    assert.equal(result.sessionSummaries[0]?.responseItemCountApprox, 0);

    const logContent = await readFile(result.path, "utf8");
    assert.match(logContent, /=== Merge Record ===/);
    assert.match(logContent, /project: demo-project/);
    assert.match(logContent, /status: success/);
    assert.match(logContent, /1\. thread-a/);
    assert.match(logContent, /mergeState: merged/);
    assert.match(logContent, /mergeState: skipped/);
    assert.match(logContent, /sessionFile: NOT_FOUND/);
    assert.match(logContent, /rename failed for thread-c/);
  });
});

test("formatMergeRecord renders human readable size fallback", () => {
  const text = formatMergeRecord(
    {
      projectRoot: "D:\\demo",
      projectName: "demo",
      resultStatus: "partial",
      candidateSessions: [{ threadId: "thread-z" }],
      warnings: [],
    },
    [
      {
        threadId: "thread-z",
        found: false,
        path: null,
        sourceRoot: null,
        approxLineCount: null,
        approxBytes: null,
        responseItemCountApprox: null,
        toolRelatedHitCountApprox: null,
        note: "session file not found under ~/.codex/sessions or ~/.codex/archived_sessions",
        name: null,
        updatedAt: null,
        turnCount: null,
        mergeState: "candidate",
      },
    ],
  );

  assert.match(text, /status: partial/);
  assert.match(text, /sessionSizeApprox: unavailable/);
  assert.match(text, /1\. thread-z/);
});

test("getDefaultSessionRoots points to live and archived Codex session directories", () => {
  const roots = getDefaultSessionRoots("C:\\Users\\demo");
  assert.deepEqual(roots, [
    path.join("C:\\Users\\demo", ".codex", "sessions"),
    path.join("C:\\Users\\demo", ".codex", "archived_sessions"),
  ]);
});
