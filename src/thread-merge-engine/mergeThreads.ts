import type {
  DecisionConflict,
  MergeThreadsOptions,
  MergedProjectState,
  SourceThread,
} from "../shared/merge-types.js";
import { extractFactsFromTurns } from "./extractors.js";

const DEFAULT_MAX_ITEMS = 20;
const NEGATIVE_HINTS =
  /\b(not|no|never|do not|dont|cannot|can't|avoid|disable|forbid)\b|不要|不能|禁止|不做|不再/i;

function limitUnique(items: string[], limit: number): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of items) {
    const normalized = item.trim().toLocaleLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(item.trim());
    if (output.length >= limit) {
      break;
    }
  }
  return output;
}

function stripPolarity(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(NEGATIVE_HINTS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function hasNegativePolarity(value: string): boolean {
  return NEGATIVE_HINTS.test(value);
}

function collectDecisionConflicts(decisions: string[]): DecisionConflict[] {
  const byTopic = new Map<
    string,
    { positives: string[]; negatives: string[]; statements: string[] }
  >();

  for (const statement of decisions) {
    const topic = stripPolarity(statement);
    if (!topic) {
      continue;
    }
    const entry = byTopic.get(topic) ?? { positives: [], negatives: [], statements: [] };
    entry.statements.push(statement);
    if (hasNegativePolarity(statement)) {
      entry.negatives.push(statement);
    } else {
      entry.positives.push(statement);
    }
    byTopic.set(topic, entry);
  }

  const conflicts: DecisionConflict[] = [];
  for (const [topic, entry] of byTopic.entries()) {
    if (entry.positives.length === 0 || entry.negatives.length === 0) {
      continue;
    }
    conflicts.push({
      topic,
      statements: entry.statements,
      recommended: entry.statements[entry.statements.length - 1],
    });
  }
  return conflicts;
}

function asBulletList(items: string[], emptyText = "暂无"): string {
  if (items.length === 0) {
    return `- ${emptyText}`;
  }
  return items.map((item) => `- ${item}`).join("\n");
}

export function mergeThreadsToProjectState(
  threads: SourceThread[],
  options: MergeThreadsOptions,
): MergedProjectState {
  const maxItems = options.maxItemsPerSection ?? DEFAULT_MAX_ITEMS;
  const projectGoals: string[] = [];
  const confirmedDecisions: string[] = [];
  const currentState: string[] = [];
  const todos: string[] = [];
  const risks: string[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];

  for (const thread of threads) {
    if (thread.turns.length === 0) {
      warnings.push(`Thread ${thread.threadId} has no readable turns.`);
      continue;
    }

    const facts = extractFactsFromTurns(thread.turns);
    projectGoals.push(...facts.goals);
    confirmedDecisions.push(...facts.decisions);
    currentState.push(...facts.state);
    todos.push(...facts.todos);
    risks.push(...facts.risks);
    blockers.push(...facts.blockers);
  }

  const conflicts = collectDecisionConflicts(confirmedDecisions);
  const riskAndConflictLines = [
    ...risks,
    ...conflicts.map((conflict) => `决策冲突：${conflict.topic}；建议基线：${conflict.recommended}`),
    ...blockers.map((blocker) => `阻塞：${blocker}`),
  ];

  return {
    generatedAt: new Date().toISOString(),
    projectName: options.projectName,
    projectGoals: limitUnique(projectGoals, maxItems),
    confirmedDecisions: limitUnique(confirmedDecisions, maxItems),
    currentState: limitUnique(currentState, maxItems),
    todos: limitUnique(todos, maxItems),
    risksAndConflicts: limitUnique(riskAndConflictLines, maxItems),
    blockers: limitUnique(blockers, maxItems),
    conflicts,
    sourceThreads: threads.map((thread) => ({
      threadId: thread.threadId,
      name: thread.name ?? null,
      updatedAt: thread.updatedAt ?? null,
      turnCount: thread.turns.length,
    })),
    warnings: limitUnique(warnings, maxItems),
  };
}

export function buildCanonicalBootstrap(state: MergedProjectState): string {
  return [
    "# Canonical Thread Bootstrap",
    "",
    "将以下内容视为当前项目的规范化上下文。后续工作请基于这里继续推进；如发现冲突，先指出冲突再继续。",
    "",
    "## 项目目标",
    asBulletList(state.projectGoals),
    "",
    "## 当前状态",
    asBulletList(state.currentState),
    "",
    "## 已确认决策",
    asBulletList(state.confirmedDecisions),
    "",
    "## 风险与冲突",
    asBulletList(state.risksAndConflicts),
    "",
    "## 来源会话",
    asBulletList(
      state.sourceThreads.map((thread) =>
        `${thread.threadId}${thread.name ? ` (${thread.name})` : ""}${thread.updatedAt ? ` | updatedAt=${thread.updatedAt}` : ""}`,
      ),
    ),
  ].join("\n");
}
