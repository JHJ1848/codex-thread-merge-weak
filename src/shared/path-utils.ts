import path from "node:path";

function normalizeSeparators(input: string): string {
  return input.replace(/\\/g, "/");
}

export function normalizePathForCompare(inputPath: string): string {
  const normalized = normalizeSeparators(path.resolve(inputPath));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function isPathWithinRoot(candidatePath: string, rootPath: string): boolean {
  const candidate = normalizePathForCompare(candidatePath);
  const root = normalizePathForCompare(rootPath);
  if (candidate === root) {
    return true;
  }
  const rootWithSlash = root.endsWith("/") ? root : `${root}/`;
  return candidate.startsWith(rootWithSlash);
}
