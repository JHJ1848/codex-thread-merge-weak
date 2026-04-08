# codex-thread-merge-weak MEMORY

## 项目定位

- 本项目是一个本地 `STDIO MCP server + skill` 组合方案，用于把同一项目下分散的多个 Codex 会话归并为新的 canonical thread，并刷新项目根目录 `MEMORY.md`。
- 归并语义不是“修改旧 thread 历史”，而是：
  - 发现候选 thread
  - 读取 thread 内容
  - 提取事实并归并
  - 新建 canonical thread
  - 可选整理旧 thread
  - 写回 `MEMORY.md`
- 项目分发路线固定为 `MCP server + skill`，不走 plugin。

## 核心目标

- 解决同一项目多会话导致的上下文碎片化问题。
- 让后续新会话能够从 canonical thread 和 `MEMORY.md` 获得稳定上下文。
- 把“线程发现、线程归并、记忆刷新”收口为可重复调用的本地工具，而不是依赖 prompt 手工整理。

## 技术栈与目录

- 技术栈：
  - `TypeScript`
  - `Node.js >=18`
  - `@modelcontextprotocol/sdk`
  - `zod`
- 关键目录：
  - `src/server`
    - MCP server 启动、工具注册、参数协议、use-case 编排
  - `src/codex-client`
    - 本地 `codex app-server` JSON-RPC 客户端与进程传输层
  - `src/thread-discovery`
    - 基于 `cwd` 的项目 thread 发现
  - `src/thread-merge-engine`
    - 事实抽取、去重、冲突检测、canonical bootstrap 生成
  - `src/memory-writer`
    - `MEMORY.md` 托管区块生成与写入
  - `src/generated/app-server`
    - 生成绑定，已纳入版本控制，避免新设备生成失败
  - `skills/codex-thread-merge-weak/SKILL.md`
    - skill 定义，只负责引导 Codex 调 MCP
  - `scripts`
    - 安装、更新、发布、MCP 注册、skill 安装脚本

## 对外能力

- `preview_project_threads`
  - 只发现候选会话，不写入
- `merge_project_threads`
  - 完整归并流程：
    - 发现
    - 读取
    - 归并
    - 新建 canonical thread
    - 可选 compact/重命名旧 thread
    - 可选写 `MEMORY.md`
- `refresh_project_memory`
  - 只刷新 `MEMORY.md`
  - 不创建 canonical thread

## 端到端实现原理

### 1. MCP server 层

- `src/server/index.ts` 使用 `McpServer + StdioServerTransport` 启动本地 stdio 服务。
- `src/server/tools.ts` 定义工具元数据和 handler。
- `src/server/protocol.ts` 解析工具输入，主要是 `cwd` 和布尔参数。
- `src/server/use-cases.ts` 负责串联 discovery、read、merge、thread create、memory write。

### 2. Codex app-server 客户端层

- `src/codex-client/client.ts` 负责探测并拉起 `codex app-server`。
- Windows 上的启动优先级是：
  - `codex.js`
  - `powershell + codex.ps1`
  - `cmd + codex.cmd`
- `src/codex-client/process-transport.ts` 负责按行处理 JSON-RPC、维护 request-pending map，并在进程异常退出时附带 stderr 尾部信息。
- 当前封装的方法包括：
  - `thread/list`
  - `thread/read`
  - `thread/start`
  - `turn/start`
  - `thread/compact/start`
  - `thread/name/set`

### 3. 线程发现层

- `src/thread-discovery/discovery.ts` 按 `thread.cwd` 是否位于目标项目根目录内筛选候选线程。
- `include_archived=true` 时，会联合遍历 archived 和 non-archived 线程，再按 id 去重。
- 候选结果按 `updatedAt` / `createdAt` 倒序返回。
- 已标记 `[Canonical]` 或 `[Merged]` 的 thread 会被过滤，不再参与下一轮归并。

### 4. 读取与归一化层

- `src/server/use-cases.ts` 中的 `resolveMergeInput()` 会对候选线程调用 `thread/read(includeTurns=true)`。
- 当前支持的 item 归一化类型：
  - `userMessage`
  - `agentMessage`
  - `plan`
  - `reasoning`
- 不支持的 item 类型会被忽略。
- 单线程读取失败只会记录 warning，不会中断整批归并。

### 5. 归并引擎层

- `src/thread-merge-engine/extractors.ts` 使用中英混合关键词规则提取事实。
- 当前提取的主要类别：
  - `goals`
  - `decisions`
  - `state`
  - `todos`
  - `risks`
  - `blockers`
- `src/thread-merge-engine/mergeThreads.ts` 负责：
  - 去重
  - 限制每类条数
  - 检测粗粒度冲突
  - 组装 `MergedProjectState`
  - 生成 canonical thread 首条 bootstrap 文本

### 6. canonical thread 与 MEMORY 写入层

- `merge_project_threads` 会新建一个 canonical thread，并命名为：
  - `[Canonical] <projectName> <YYYY-MM-DD>`
- 默认会尝试：
  - compact 旧 thread
  - 给旧 thread 名称追加 `[Merged]`
- 不会自动 archive 旧 thread。
- `src/memory-writer/memoryTemplate.ts` 用托管标记维护 `MEMORY.md`：
  - `<!-- managed:start:codex-thread-merge -->`
  - `<!-- managed:end:codex-thread-merge -->`
- 如果文件中没有托管块，则在末尾追加。
- 如果已有托管块，则只替换托管块，尽量保留托管块外的手写内容。

## 安装与更新脚本事实

### 当前脚本结构

- `i.ps1`
  - 仓库根远程 bootstrap 入口
  - 会先准备 `install.ps1 + common.ps1`，再进入正式安装事务
- `i.cmd`
  - 仓库根 `cmd.exe` 短入口
  - 优先使用本地 `i.ps1`，否则下载远程 `i.ps1`
- `scripts/install.ps1`
  - 主安装事务入口
- `scripts/update.ps1`
  - 更新入口，本质上复用安装事务
- `scripts/register-mcp.ps1`
  - MCP 注册、幂等检查、失败回滚
- `scripts/install-skill.ps1`
  - 全局 skill 安装、幂等检查、失败回滚
- `scripts/*.cmd`
  - `cmd.exe` 包装器

### staged transaction 规则

- 安装和更新不再直接在正式安装目录边拉边改。
- 当前实现是 staged install：
  - 先在临时目录准备候选版本
  - 在临时目录运行 `npm install --include=dev`
  - 在临时目录运行 `npm run check`
  - 按需运行 `npm run build` 和 `npm test`
  - 全部成功后才切换正式安装目录
- 失败时优先回滚，避免把本地安装留在半完成状态。

### 幂等规则

- MCP 已是目标配置时，`register-mcp.ps1` 直接 no-op。
- 全局 skill 内容未变化时，`install-skill.ps1` 直接 no-op。
- 安装目录若只有安装生成物差异，当前视为可自动刷新：
  - `package-lock.json`
  - `dist/`
  - `node_modules/`
- 安装目录若存在源码、脚本、文档等人工改动，则脚本停止，不自动覆盖。

### 回滚规则

- 正式安装目录切换前会保留旧版本备份。
- 若切换后的 MCP 注册或全局 skill 安装失败，安装器会尝试恢复旧目录。
- `register-mcp.ps1` 会在替换失败时恢复旧 MCP 配置。
- `install-skill.ps1` 会先复制到临时目录，校验通过后再原子替换目标 skill；失败时恢复旧 skill。

### cmd 体验

- 仓库根 `i.cmd` 是更短的 `cmd.exe` 用户侧入口。
- `scripts/install.cmd` 保留为兼容入口：
  - 本地脚本完整时直接执行 `scripts/install.ps1`
  - 否则转发到根目录或远程 `i.ps1`
- 推荐入口区分终端：
  - PowerShell 优先走 `powershell -ep bypass -c "irm .../i.ps1|iex"`
  - `cmd.exe` 优先走远程 `i.cmd`
- 远程 bootstrap 不再单独下载 `install.ps1`，而是先准备 `install.ps1 + common.ps1`，避免函数未识别报错。
- 当前有分阶段提示：
  - bootstrap 准备
  - staged repository 准备
  - 依赖安装与校验
  - 正式目录切换
  - MCP 刷新
  - skill 刷新
- 支持 ANSI 的终端会显示彩色文本进度；不支持时退化为普通文本。
- 默认详细日志路径：
  - `%TEMP%\codex-thread-merge-weak-install.log`

## 当前行为边界

- 当前是“弱语义归并”，不是逐 turn 的强一致语义重建。
- 冲突检测仍是规则驱动的粗粒度策略，存在误报或漏报可能。
- `thread/read` 的兼容范围仍有限，历史 item 结构差异较大时会有信息损耗。
- `refresh_project_memory` 与 `merge_project_threads` 共用 discovery/read/merge 逻辑，只是少了 canonical thread 创建步骤。
- `thread/name/set` 和 `thread/compact/start` 失败不会阻断主流程，只会写 warning。

## 当前测试事实

- 当前已有测试：
  - `src/thread-merge-engine/mergeThreads.test.ts`
  - `src/memory-writer/memoryTemplate.test.ts`
- 基础检查命令：
  - `npm run check`
  - `npm test`
- 已知测试缺口：
  - discovery 分页和 archived 联合场景
  - `thread/read` 多版本 item 兼容
  - app-server 进程异常与 RPC 失败路径
  - use-case 级端到端流程
  - 安装脚本的自动化回滚场景

## 运维与使用事实

- 默认 MCP 名称：
  - `codex-thread-merge`
- 项目内 skill 源目录始终保留：
  - `skills/codex-thread-merge-weak`
- 全局 skill 只是复制副本：
  - `~/.codex/skills/codex-thread-merge-weak`
- 推荐安装方式：
  - PowerShell 优先执行远程 `i.ps1`
  - `cmd.exe` 优先执行远程 `i.cmd`
- 日常使用方式：
  - 在目标项目目录里对 Codex 说“归并当前项目会话”等自然语言

## 已确认的维护原则

- 根目录 `README.md` 面向使用者，优先说明安装、使用、项目流程和实现方式。
- `docs/usage.md` 保留更细的命令和参数说明。
- `MEMORY.md` 记录长期事实、实现约束、当前行为边界和维护原则。
- 中文文档统一 UTF-8。
- 安装器默认以“安全刷新”和“失败回滚”为最高优先级，不为了省一步操作去做毁灭性覆盖。

## 后续优先级建议

- 优先级 1：
  - 补安装事务的自动化测试，尤其是回滚分支
- 优先级 2：
  - 补 `thread/read` 多版本 item 兼容和 use-case 级端到端测试
- 优先级 3：
  - 提升冲突识别策略，降低规则误报
