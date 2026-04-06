import type { CodexAppServerClient } from "../codex-client/client.js";
import { isPathWithinRoot, normalizePathForCompare } from "../shared/path-utils.js";
import type {
  ProjectThreadCandidate,
  ProjectThreadDiscoveryResult,
} from "../shared/types.js";

export interface ThreadDiscoveryOptions {
  cwd: string;
  includeArchived?: boolean;
  pageLimit?: number;
  pageSize?: number;
}

const DEFAULT_PAGE_LIMIT = 100;
const DEFAULT_PAGE_SIZE = 100;

function timestampToIso(value: string | number | null | undefined): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 1e12 ? value : value * 1000;
    return new Date(millis).toISOString();
  }
  return null;
}

export async function discoverProjectThreads(
  client: CodexAppServerClient,
  options: ThreadDiscoveryOptions,
): Promise<ProjectThreadDiscoveryResult> {
  const includeArchived = options.includeArchived ?? false;
  const archivedModes = includeArchived ? [false, true] : [false];
  const seen = new Set<string>();
  const candidates: ProjectThreadCandidate[] = [];
  const projectRoot = normalizePathForCompare(options.cwd);

  for (const archived of archivedModes) {
    let cursor: string | undefined;

    for (let page = 0; page < (options.pageLimit ?? DEFAULT_PAGE_LIMIT); page += 1) {
      const response = await client.listThreads({
        cursor,
        archived,
        limit: options.pageSize ?? DEFAULT_PAGE_SIZE,
      });

      for (const thread of response.threads) {
        if (seen.has(thread.id)) {
          continue;
        }
        seen.add(thread.id);

        const threadCwd = thread.cwd ? normalizePathForCompare(thread.cwd) : null;
        if (!threadCwd || !isPathWithinRoot(threadCwd, projectRoot)) {
          continue;
        }

        candidates.push({
          threadId: thread.id,
          name: thread.name ?? null,
          cwd: thread.cwd ?? null,
          archived: archived || Boolean(thread.archived),
          status: thread.status ?? null,
          createdAt: timestampToIso(thread.createdAt),
          updatedAt: timestampToIso(thread.updatedAt),
        });
      }

      cursor = response.nextCursor ?? undefined;
      if (!cursor) {
        break;
      }
    }
  }

  candidates.sort((left, right) => {
    const leftValue = left.updatedAt ?? left.createdAt ?? "";
    const rightValue = right.updatedAt ?? right.createdAt ?? "";
    return rightValue.localeCompare(leftValue);
  });

  return {
    projectRoot: options.cwd,
    selectionRule:
      "Include threads whose thread.cwd is inside the provided project root. When include_archived=true, combine archived and non-archived pages.",
    candidateThreads: candidates,
  };
}
