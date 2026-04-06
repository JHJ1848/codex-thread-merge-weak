export type ThreadRole = "user" | "assistant" | "system" | string;

export interface ThreadTurn {
  id?: string;
  role: ThreadRole;
  text: string;
  createdAt?: string;
}

export interface SourceThread {
  threadId: string;
  name?: string | null;
  cwd?: string | null;
  updatedAt?: string | null;
  turns: ThreadTurn[];
}

export interface SourceThreadInfo {
  threadId: string;
  name?: string | null;
  updatedAt?: string | null;
  turnCount: number;
}

export interface DecisionConflict {
  topic: string;
  statements: string[];
  recommended: string;
}

export interface MergedProjectState {
  generatedAt: string;
  projectName: string;
  projectGoals: string[];
  confirmedDecisions: string[];
  currentState: string[];
  todos: string[];
  risksAndConflicts: string[];
  blockers: string[];
  conflicts: DecisionConflict[];
  sourceThreads: SourceThreadInfo[];
  warnings: string[];
}

export interface MergeThreadsOptions {
  projectName: string;
  maxItemsPerSection?: number;
}
