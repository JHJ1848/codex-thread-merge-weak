# 项目目标

- 实现本地 `STDIO MCP server`，支持同一项目多会话归并。
- 使用“新建 canonical thread”替代旧会话物理 merge。
- 将项目摘要稳定写入根目录 `MEMORY.md`。
- 补齐 GitHub 发布、一键安装和本机更新脚本，降低新设备部署复杂度。

# 当前状态

- 已有 MCP server 入口与工具协议定义：`preview_project_threads`、`merge_project_threads`、`refresh_project_memory`。
- 已接入 use-case wiring，能够把 discovery、merge engine、memory writer 串联执行。
- 已提供弱提示词 skill，只负责触发 MCP 工具，不承载归并规则。
- 已新增 PowerShell 自动化脚本：`install.ps1`、`update.ps1`、`register-mcp.ps1`、`install-skill.ps1`、`publish.ps1`。
- 已补充 README 和使用文档，默认入口为远程 `install.ps1`。
- 已新增 GitHub 分发与本地维护脚本：`scripts/install.ps1`、`scripts/update.ps1`、`scripts/publish.ps1`、`scripts/register-mcp.ps1`、`scripts/install-skill.ps1`。
- 已新增 `README.md`，并将新设备默认入口固定为 GitHub Raw PowerShell 安装命令。

# 已确认决策

- 不使用 plugin 分发路径，固定为 `MCP server + skill`。
- 技术栈使用 `TypeScript + Node.js 18+`。
- 旧会话默认策略：compact + 重命名追加 `[Merged]`，不自动 archive。
- 允许在 `MEMORY.md` 与 skill 中使用中文（UTF-8）。
- 新设备安装入口采用 GitHub Raw 上的 `install.ps1`，形态参考 `irm ... | iex`。
- 发布流程收敛到 `publish.ps1`，首次发布允许直接初始化仓库并推送到 `main`。
- `src/generated` 需要纳入版本控制，避免新设备 clone 后无法直接构建。

# 未完成任务

- 继续增强线程 turn 归一化精度，适配更多历史 item 形态。
- 增加自动化测试：发现逻辑、归并冲突、MEMORY 更新幂等性、异常路径。
- 验证在真实多项目环境下的筛选准确率与性能。
- 观察真实使用中脚本的兼容性，按需要补充更细的参数和回滚提示。
- 如后续 Codex CLI 暴露稳定的工具调用 CLI，可再补一个纯命令行的会话归并脚本入口。

# 风险与冲突

- `thread/name/set` 等 API 在不同版本 app-server 可能存在行为差异；当前策略为失败记 warning，不阻断主流程。
- `thread/read` 历史 item 结构具有版本差异，文本提取存在信息损耗风险。
- 当项目无有效会话时仍会创建 canonical thread 的策略是否最优，后续可能需要配置开关。
- `install.ps1` 使用 `irm | iex` 分发，后续修改脚本时要保持动作固定、可审计、尽量短。

# 来源会话

- 用户需求会话：确定技术路线为“本地 STDIO MCP server + skill 弱提示词”。
- 当前实现会话：完成 wiring、use-cases 接入、GitHub 发布脚本化与文档整理。
