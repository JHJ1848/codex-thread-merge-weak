import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  getProjectArtifactRoot,
  getProjectMemoryPath,
  getProjectRecordLogPath,
  getProjectSessionMemoryDir,
  getProjectSessionMemoryPath,
} from "./projectPaths.js";

test("project artifact paths are rooted under .codex/codex-thread-merge", () => {
  const root = "D:\\workspace\\demo";
  assert.equal(
    getProjectArtifactRoot(root),
    path.join(root, ".codex", "codex-thread-merge"),
  );
  assert.equal(
    getProjectMemoryPath(root),
    path.join(root, ".codex", "codex-thread-merge", "MEMORY.md"),
  );
  assert.equal(
    getProjectRecordLogPath(root),
    path.join(root, ".codex", "codex-thread-merge", "record.log"),
  );
  assert.equal(
    getProjectSessionMemoryDir(root),
    path.join(root, ".codex", "codex-thread-merge", "memory"),
  );
  assert.equal(
    getProjectSessionMemoryPath(root, "thread-1"),
    path.join(root, ".codex", "codex-thread-merge", "memory", "thread-1.md"),
  );
});

test("getProjectArtifactRoot is idempotent when projectRoot already points at artifact root", () => {
  const artifactRoot = path.join("D:\\workspace\\demo", ".codex", "codex-thread-merge");
  assert.equal(getProjectArtifactRoot(artifactRoot), artifactRoot);
  assert.equal(getProjectMemoryPath(artifactRoot), path.join(artifactRoot, "MEMORY.md"));
  assert.equal(getProjectRecordLogPath(artifactRoot), path.join(artifactRoot, "record.log"));
});

test("getProjectSessionMemoryPath rejects thread ids that would escape the memory directory", () => {
  assert.throws(
    () => getProjectSessionMemoryPath("D:\\workspace\\demo", "../thread"),
    /Invalid threadId/,
  );
  assert.throws(
    () => getProjectSessionMemoryPath("D:\\workspace\\demo", "nested/thread"),
    /Invalid threadId/,
  );
});
