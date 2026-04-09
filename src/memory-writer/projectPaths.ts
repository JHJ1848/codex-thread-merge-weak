import path from "node:path";

const PROJECT_ARTIFACT_ROOT_PARTS = [".codex", "codex-thread-merge"] as const;
const ARTIFACT_SUFFIX = path.join(...PROJECT_ARTIFACT_ROOT_PARTS).toLowerCase();

export function getProjectArtifactRoot(projectRoot: string): string {
  const resolved = path.resolve(projectRoot);
  if (resolved.toLowerCase().endsWith(ARTIFACT_SUFFIX)) {
    return resolved;
  }
  return path.join(resolved, ...PROJECT_ARTIFACT_ROOT_PARTS);
}

export function getProjectMemoryPath(projectRoot: string): string {
  return path.join(getProjectArtifactRoot(projectRoot), "MEMORY.md");
}

export function getProjectRecordLogPath(projectRoot: string): string {
  return path.join(getProjectArtifactRoot(projectRoot), "record.log");
}

export function getProjectSessionMemoryDir(projectRoot: string): string {
  return path.join(getProjectArtifactRoot(projectRoot), "memory");
}

export function getProjectSessionMemoryPath(projectRoot: string, threadId: string): string {
  return path.join(getProjectSessionMemoryDir(projectRoot), `${normalizeThreadIdForFileName(threadId)}.md`);
}

function normalizeThreadIdForFileName(threadId: string): string {
  const value = threadId.trim();
  if (!value) {
    throw new Error("threadId must not be empty.");
  }
  if (value === "." || value === "..") {
    throw new Error(`Invalid threadId for session memory path: ${threadId}`);
  }
  if (value.includes("/") || value.includes("\\")) {
    throw new Error(`Invalid threadId for session memory path: ${threadId}`);
  }
  return value;
}
