---
name: codex-thread-merge-weak
description: Merge, compact, consolidate, or sync multiple Codex conversations for the current project into one canonical thread and refresh MEMORY.md. Use when the user asks to merge project sessions, compact all sessions for a project, or sync the project's canonical thread. Prefer calling MCP tools preview_project_threads, merge_project_threads, and refresh_project_memory instead of encoding merge rules in the prompt.
---

# Codex Thread Merge

只负责触发 MCP 工具，不在提示词里重写归并算法。

安装入口（Windows）可参考：

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/JHJ1848/codex-thread-merge-weak/main/scripts/install.ps1 | iex"
```

## 默认流程

1. 先调用 `preview_project_threads` 查看当前 `cwd` 下的候选会话。
2. 再调用 `merge_project_threads` 生成或更新 canonical thread，并同步 `MEMORY.md`。
3. 如果用户只要求刷新记忆文件，调用 `refresh_project_memory`。

## 触发短语

- 归并当前项目会话
- 把这个项目的多个 Codex 会话合成主会话
- 同步当前项目的 canonical thread
- compact 并整合这个项目的会话上下文

## 约束

- 提示词保持短小，避免在 skill 里写复杂规则。
- 以 MCP 工具输出为准。
- 不在 skill 文本中定义冲突处理模板。
- 未被明确要求时，不主动 archive 旧会话。
