# codex-thread-merge-weak MEMORY

## 项目定位

- 本项目是一个本地 `STDIO MCP server + skill` 组合，用于归并同一项目下分散的 Codex 会话。
- 归并结果不会改写旧会话历史，而是新建一个 canonical thread，并刷新目标项目的项目级记忆目录。
- 目标项目的运行产物统一落在 `.codex/codex-thread-merge/`：
  - `.codex/codex-thread-merge/MEMORY.md`
  - `.codex/codex-thread-merge/record.log`
  - `.codex/codex-thread-merge/memory/<session_id>.md`

## 核心实现

- `src/server`
  - 暴露 `preview_project_threads`、`merge_project_threads`、`refresh_project_memory`
  - 编排 discovery、thread read、merge、canonical thread 创建、memory 写入
- `src/codex-client`
  - 通过本地 `codex app-server` 走 JSON-RPC
  - 当前项目本身不需要常驻独立服务，Codex 调 MCP 时会拉起它
- `src/thread-discovery`
  - 按 `cwd` 发现属于当前项目的会话
  - 默认排除已带 `[Canonical]` 或 `[Merged]` 标记的线程
- `src/thread-merge-engine`
  - 将多会话归一化为 `MergedProjectState`
  - 抽取 goals、decisions、state、todos、risks、blockers 等结构化事实
- `src/memory-writer`
  - 写 `.codex/codex-thread-merge/MEMORY.md`
  - 写 `.codex/codex-thread-merge/record.log`
  - 按会话写 `.codex/codex-thread-merge/memory/<session_id>.md`

## 当前约束

- `merge_project_threads` 默认会：
  - 创建 canonical thread
  - 尝试 compact 来源线程
  - 尝试给来源线程追加 `[Merged]`
  - 刷新项目级 `MEMORY.md`
  - 写出会话级 `memory/<session_id>.md`
  - 追加 `record.log`
- `refresh_project_memory` 只刷新项目级记忆文件和会话级记忆文件，不创建 canonical thread。
- 会话级 memory 的来源应基于归一化后的 `resolved.sourceThreads`，不要回退到更原始的 item 层重复拼装。

## 开发注意事项

- 目标项目的运行产物应始终写入 `.codex/codex-thread-merge/`，不要再写项目根 `MEMORY.md` 或 `memory/record.log`。
- 文档、skill 描述、工具说明要与实际路径保持一致。
- 运行产物属于生成文件；仓库源码不应依赖目标项目中已有的 `.codex/codex-thread-merge/` 内容。
- Nothing is perfect：优先保持实现可解释、幂等、易排查，不追求把所有历史场景一次性兜满。
