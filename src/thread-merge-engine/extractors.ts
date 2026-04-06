import type { ThreadTurn } from "../shared/merge-types.js";

export interface ExtractedFacts {
  goals: string[];
  decisions: string[];
  state: string[];
  todos: string[];
  risks: string[];
  blockers: string[];
}

const GOAL_HINTS =
  /(goal|objective|scope|target|aim|purpose|deliverable|milestone|项目目标|目标|范围|里程碑|交付|愿景)/i;
const DECISION_HINTS =
  /(decision|decided|we will|chosen|adopt|must|should|policy|rule|确认|决定|采用|统一|不做|路线|方案|约定)/i;
const STATE_HINTS =
  /(current state|status|progress|implemented|completed|done|shipped|当前状态|现状|进度|已实现|已完成|已支持)/i;
const TODO_HINTS =
  /(todo|next step|follow up|pending|need to|remaining|fix|improve|未完成|待办|下一步|需要|待处理|剩余|修复|完善)/i;
const RISK_HINTS =
  /(risk|conflict|compatibility|failure|issue|warning|unstable|tradeoff|风险|冲突|兼容|问题|警告|不稳定|取舍|约束)/i;
const BLOCKER_HINTS =
  /(blocker|blocked|dependency|missing|cannot|permission|unavailable|阻塞|卡住|依赖|缺失|无法|权限|不可用)/i;
const SENTENCE_SPLIT = /[\r\n]+|(?<=[.!?;。！？；])\s*/g;

function normalizeLine(line: string): string {
  return line.replace(/\s+/g, " ").replace(/^[\-\*\d\.\)\s]+/, "").trim();
}

function splitSentences(text: string): string[] {
  return text
    .split(SENTENCE_SPLIT)
    .map((line) => normalizeLine(line))
    .filter((line) => line.length >= 4);
}

function select(sentences: string[], pattern: RegExp): string[] {
  return sentences.filter((sentence) => pattern.test(sentence));
}

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of items) {
    const normalized = item.toLocaleLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(item);
  }
  return output;
}

export function extractFactsFromTurns(turns: ThreadTurn[]): ExtractedFacts {
  const sentences = turns.flatMap((turn) => splitSentences(turn.text));
  return {
    goals: unique(select(sentences, GOAL_HINTS)),
    decisions: unique(select(sentences, DECISION_HINTS)),
    state: unique(select(sentences, STATE_HINTS)),
    todos: unique(select(sentences, TODO_HINTS)),
    risks: unique(select(sentences, RISK_HINTS)),
    blockers: unique(select(sentences, BLOCKER_HINTS)),
  };
}
