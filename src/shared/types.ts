export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export type JsonObject = { [key: string]: JsonValue };
export type JsonArray = JsonValue[];

export interface AppServerThread {
  id: string;
  name?: string | null;
  preview?: string;
  cwd?: string | null;
  archived?: boolean;
  status?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  turns?: AppServerTurn[];
}

export interface AppServerTurn {
  id: string;
  status?: string;
  items?: JsonObject[];
}

export interface AppServerThreadListResult {
  threads: AppServerThread[];
  nextCursor?: string | null;
}

export interface AppServerThreadReadResult {
  thread: AppServerThread;
}

export interface ProjectThreadCandidate {
  threadId: string;
  name: string | null;
  cwd: string | null;
  archived: boolean;
  status: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ProjectThreadCandidateWithMergeHistory extends ProjectThreadCandidate {
  mergedBefore: boolean;
  mergedAt: string | null;
  mergeCount: number;
}

export interface ProjectThreadDiscoveryResult {
  projectRoot: string;
  selectionRule: string;
  candidateThreads: ProjectThreadCandidate[];
}
