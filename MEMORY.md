# codex-thread-merge-weak MEMORY

## 项目定位

- 本项目是本地 `STDIO MCP server + skill` 方案，用于把同一项目下多个 Codex 会话归并为一个新的 canonical thread，并同步项目根目录 `MEMORY.md`。
- 归并语义是“读旧会话 -> 提取事实 -> 新建 canonical thread -> 可选整理旧会话 -> 刷新 MEMORY”，不是对旧 thread 做历史改写。
- 分发路线固定为 `MCP server + skill`，不走 plugin。

## 技术栈与目录

- 技术栈：`TypeScript`、`Node.js >=18`、`@modelcontextprotocol/sdk`、`zod`。
- 关键目录：
  - `src/server`：MCP server 启动、工具注册、参数协议、use-case 组装。
  - `src/codex-client`：本地 `codex app-server` JSON-RPC 客户端与进程传输层。
  - `src/thread-discovery`：基于 `thread.cwd` 的项目线程发现。
  - `src/thread-merge-engine`：turn 文本事实提取、汇总去重、冲突检测、bootstrap 生成。
  - `src/memory-writer`：`MEMORY.md` 托管区块生成与回写。
  - `scripts`：安装、更新、发布、MCP 注册、skill 安装脚本。
  - `skills/codex-thread-merge-weak/SKILL.md`：弱提示词 skill，只负责触发 MCP 工具。
  - `src/generated/app-server`：生成绑定（已纳入版本控制，避免新设备构建失败）。

## 对外能力

- `preview_project_threads`
  - 发现当前项目候选会话，不做归并写入。
- `merge_project_threads`
  - 完整归并流程：发现 + 读取 + 归并 + 新建 canonical thread + 可选 compact/重命名旧线程 + 可选写 MEMORY。
- `refresh_project_memory`
  - 只刷新 `MEMORY.md`，不创建 canonical thread。

## 端到端实现原理

### 1) MCP server 层

- `src/server/index.ts` 使用 `McpServer + StdioServerTransport` 启动本地服务。
- 工具输入由 `src/server/protocol.ts` 做轻量解析（`cwd`/布尔参数）。
- 工具元数据定义在 `src/server/tools.ts`，handler 统一输出 JSON 文本，异常时返回 `isError: true`。

### 2) app-server 客户端层

- `src/codex-client/client.ts` 负责探测并拉起 `codex app-server`：
  - Windows：优先 `codex.js`，其次 `powershell + codex.ps1`，再到 `cmd + codex.cmd`。
  - 其他平台：默认 `codex app-server`。
- `src/codex-client/process-transport.ts` 按行处理 JSON-RPC，维护 request-id 对应的 pending map；进程异常退出时附带 stderr 尾部诊断。
- 封装的方法包括 `thread/list`、`thread/read`、`thread/start`、`turn/start`、`thread/compact/start`、`thread/name/set`。

### 3) 线程发现层

- `src/thread-discovery/discovery.ts` 规则：只保留 `thread.cwd` 位于目标项目根目录内的线程。
- `include_archived=true` 时会联合遍历 archived/non-archived 两路分页，再按 id 去重。
- 结果按 `updatedAt`/`createdAt` 倒序，得到候选线程列表（不含 turn 内容）。

### 4) 读取与归一化层

- `src/server/use-cases.ts` 的 `resolveMergeInput()` 会对候选线程执行 `thread/read(includeTurns=true)`。
- `normalizeSourceThread()` 当前支持 item 类型：
  - `userMessage`：抽取 `content[].type=text`。
  - `agentMessage`：读取 `item.text`。
  - `plan`：转为 `PLAN: ...`。
  - `reasoning`：合并 `summary[]/content[]`，转为 `REASONING: ...`。
- 不支持的 item 类型直接忽略；单线程失败只记 warning 并跳过，不中断整批流程。

### 5) 归并引擎层

- `src/thread-merge-engine/extractors.ts` 使用关键词规则（中英混合）抽取 6 类事实：
  - `goals`、`decisions`、`state`、`todos`、`risks`、`blockers`。
- `src/thread-merge-engine/mergeThreads.ts` 负责：
  - 去重和条数限制（默认每区块 20）。
  - 基于“否定极性”做粗粒度冲突检测，生成 `conflicts`。
  - 组装 `MergedProjectState`。
  - 生成 canonical thread 首条 `bootstrap` 文本。

### 6) canonical 与 MEMORY 写入层

- `merge_project_threads` 会：
  - 创建新 thread，并命名为 `[Canonical] <projectName> <YYYY-MM-DD>`。
  - 写入 bootstrap 文本作为第一条 turn。
  - 默认尝试对旧线程 `compact` + 名称追加 `[Merged]`（不会自动 archive）。
  - 可选写入 `MEMORY.md`。
- `src/memory-writer/memoryTemplate.ts` 用托管标记更新 MEMORY：
  - `<!-- managed:start:codex-thread-merge -->`
  - `<!-- managed:end:codex-thread-merge -->`
- 若文件中无托管块，则在末尾追加；有托管块则只替换该块并尽量保留外部手写内容。

## 行为边界（明确事实）

- 当前是“弱语义归并”，不是逐 turn 的强一致合并。
- 已标记 `[Canonical]` 或 `[Merged]` 的会话会在发现阶段被过滤，不再参与新一轮归并。
- `refresh_project_memory` 与 `merge_project_threads` 共用 discovery/read/merge 逻辑，仅缺少 canonical 创建步骤。
- `thread/name/set`、`thread/compact/start` 失败时只记录 warning，不阻断主流程。

## 只读审查结论（2026-04-07）

### 实现风险

- 中风险：脚本默认使用 `npm install`，在 `NODE_ENV=production` 或 `npm config omit=dev` 环境下会漏装 devDependencies，随后 `npm run check/build/test` 失败（涉及 `scripts/update.ps1`、`scripts/install.ps1`、`scripts/publish.ps1`）。
- 中风险：turn 归一化时间戳使用候选线程 `updatedAt` 作为 `createdAt`，不是 turn 粒度真实时间，可能影响后续时序分析精度（`src/server/use-cases.ts`）。
- 低风险：冲突识别依赖否定词和关键词，存在误报/漏报的已知可能（`src/thread-merge-engine/mergeThreads.ts`）。

### 行为边界与兼容点

- `thread/read` 历史 item 结构差异较大，当前仅覆盖 `userMessage/agentMessage/plan/reasoning`，其余结构会丢弃，存在信息损耗风险。
- Windows 启动 `codex app-server` 采取多候选降级路径，提升可运行性，但也增加环境差异行为。

### 测试缺口

- 当前仅有两组测试：
  - `src/thread-merge-engine/mergeThreads.test.ts`
  - `src/memory-writer/memoryTemplate.test.ts`
- 缺口主要在：
  - discovery 分页与 archived 联合场景。
  - `thread/read` 多版本 item 兼容归一化。
  - app-server 进程异常与 RPC 错误路径。
  - use-case 级端到端链路（discover -> read -> merge -> writeMemory）。
  - 脚本在不同 npm 环境变量下的兼容性。

## 脚本与分发事实

- `scripts/install.ps1`：新设备入口，clone/更新后委托 `scripts/update.ps1`。
- `scripts/update.ps1`：校验仓库后执行 pull/install/check/build/test，并刷新 MCP + skill。
- `scripts/publish.ps1`：校验 `gh` 和远程仓库后执行检查、提交和推送。
- `scripts/register-mcp.ps1`：把 `dist/server/index.js` 注册为 MCP server（名称默认 `codex-thread-merge`）。
- `scripts/install-skill.ps1`：同步 `skills/codex-thread-merge-weak` 到 `~/.codex/skills`。

## 后续优先级建议

- 优先级 1：修复脚本对 production npm 环境的不兼容（确保 devDependencies 可用或改为不依赖 dev 工具链）。
- 优先级 2：补齐 `thread/read` 归一化兼容和 use-case 端到端测试。
- 优先级 3：为冲突检测增加更稳的语义策略或可配置规则，降低误报。
