import path from "node:path";

function normalizeWindowsExtendedPathPrefix(input: string): string {
  if (!input.startsWith("\\\\?\\")) {
    return input;
  }

  // \\?\UNC\server\share\path -> \\server\share\path
  if (input.startsWith("\\\\?\\UNC\\")) {
    return `\\\\${input.slice("\\\\?\\UNC\\".length)}`;
  }

  // \\?\C:\path -> C:\path
  return input.slice("\\\\?\\".length);
}

function normalizeSeparators(input: string): string {
  return input.replace(/\\/g, "/");
}

export function normalizePathForCompare(inputPath: string): string {
  const resolvedPath = path.resolve(normalizeWindowsExtendedPathPrefix(inputPath));
  const normalized = normalizeSeparators(resolvedPath);
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
