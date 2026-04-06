import type { DecisionConflict, MergedProjectState } from "../shared/merge-types.js";

const START_MARKER = "<!-- managed:start:codex-thread-merge -->";
const END_MARKER = "<!-- managed:end:codex-thread-merge -->";

function formatConflicts(conflicts: DecisionConflict[]): string[] {
  return conflicts.map(
    (conflict) =>
      `决策冲突：${conflict.topic}；建议基线：${conflict.recommended}；证据：${conflict.statements.join(" | ")}`,
  );
}

function asBulletList(items: string[], emptyText = "暂无"): string {
  if (items.length === 0) {
    return `- ${emptyText}`;
  }
  return items.map((item) => `- ${item}`).join("\n");
}

export function getMemoryManagedBlock(state: MergedProjectState): string {
  const riskLines = [...state.risksAndConflicts, ...formatConflicts(state.conflicts)];

  return [
    START_MARKER,
    `> generatedAt: ${state.generatedAt}`,
    `> projectName: ${state.projectName}`,
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
    "## 未完成任务",
    asBulletList(state.todos),
    "",
    "## 风险与冲突",
    asBulletList(riskLines),
    "",
    "## 来源会话",
    asBulletList(
      state.sourceThreads.map((thread) =>
        `${thread.threadId}${thread.name ? ` (${thread.name})` : ""}${thread.updatedAt ? ` | updatedAt=${thread.updatedAt}` : ""}`,
      ),
    ),
    END_MARKER,
    "",
  ].join("\n");
}

export function upsertManagedBlock(existingContent: string, block: string): string {
  if (!existingContent.trim()) {
    return block;
  }

  const start = existingContent.indexOf(START_MARKER);
  const end = existingContent.indexOf(END_MARKER);
  if (start >= 0 && end > start) {
    const before = existingContent.slice(0, start).trimEnd();
    const after = existingContent.slice(end + END_MARKER.length).trimStart();
    const body = before ? `${before}\n\n${block}` : block;
    return `${body}${after ? `\n${after}` : ""}`.trimEnd() + "\n";
  }

  return `${existingContent.trimEnd()}\n\n${block}`;
}

export const MEMORY_BLOCK_MARKERS = { START_MARKER, END_MARKER };
