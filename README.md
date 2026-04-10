# codex-thread-merge-weak

本项目提供一个本地 `STDIO MCP server + skill`，用于把同一项目下的多个 Codex 会话归并为新的 canonical thread，并同步项目级工作目录 `.codex/codex-thread-merge/` 下的记忆产物。

## 使用方法

### 环境要求

先确认本机已经安装：

- `git`
- `Node.js 18+`
- `npm`
- `codex`

### 一键安装

推荐（最短命令，适合 PowerShell）：

```powershell
powershell -ep bypass -c "irm https://raw.githubusercontent.com/JHJ1848/codex-thread-merge-weak/main/i.ps1|iex"
```

如果你当前在 `cmd.exe`，用这个更稳：

```cmd
curl.exe -fsSL --retry 3 --retry-delay 1 -o "%TEMP%\ctm-i.cmd" https://raw.githubusercontent.com/JHJ1848/codex-thread-merge-weak/main/i.cmd && call "%TEMP%\ctm-i.cmd"
```

这条 `cmd` 命令同时支持首次安装和后续更新：

- 未安装时：自动拉取并安装
- 已安装时：自动进入更新流程，刷新到最新版本

更安全的做法是先下载、检查，再执行：

```powershell
iwr https://raw.githubusercontent.com/JHJ1848/codex-thread-merge-weak/main/i.ps1 -OutFile .\i.ps1
Get-Content .\i.ps1
powershell -ExecutionPolicy Bypass -File .\i.ps1
```

旧报错根因说明：早期远程链路只下载了 `install.ps1`，但脚本运行时还依赖同目录 `common.ps1`，因此会出现 `Get-FullPath`、`Write-Phase` 等函数未识别报错。新入口会先准备完整 bootstrap 依赖，再进入安装事务。

如果你已经在仓库根目录，也可以直接执行：

```cmd
i.cmd
```

```powershell
powershell -ExecutionPolicy Bypass -File .\i.ps1
```

### 安装后如何使用

安装完成后，在任意项目目录里打开 Codex，直接说这些话即可：

- `归并当前项目会话`
- `把这个项目的多个 Codex 会话合成主会话`
- `同步当前项目的 canonical thread`

如果你想验证 MCP 是否已经注册成功，可以执行：

```cmd
codex.cmd mcp get codex-thread-merge --json
```

### 日常更新

如果是已安装过的设备，执行：

```cmd
%USERPROFILE%\tools\codex-thread-merge-weak\scripts\update.cmd
```

或者在仓库内执行：

```powershell
powershell .\scripts\update.ps1
```

## 项目解决什么问题

当同一个项目在 Codex 中产生多个会话时，历史上下文会分散在多个 thread 里，后续继续开发很容易出现这些问题：

- 新会话不知道旧会话已经做过什么
- `.codex/codex-thread-merge/MEMORY.md` 失真或长期不更新
- 项目事实、待办、风险分散在不同 thread 中
- 需要人工复制粘贴多个会话内容，成本高且容易漏信息

本项目的目标就是把这件事变成一个本地可调用的 MCP 能力：

1. 发现当前项目相关的 Codex threads
2. 先 preview 候选 thread，再由用户在聊天里选择要合并的编号或 thread id
3. 先生成项目上下文文件（`CONTEXT.md` + `context/<session_id>.md`）和记忆文件（`MEMORY.md`）
4. 再新建 canonical thread 并写入 bootstrap
5. 可选 compact/重命名旧 thread

## 整体流程

从用户说一句“归并当前项目会话”开始，整体流程如下：

1. Codex 识别到已安装的 skill：`codex-thread-merge-weak`
2. skill 引导 Codex 调用本地 MCP 工具，而不是让模型自己硬编归并规则
3. MCP server 先执行 `preview_project_threads`，按当前 `cwd` 返回候选列表
4. Agent 在聊天中让用户选择编号或直接提供 `thread id`
5. Agent 再执行 `merge_project_threads`，按用户选择的集合继续
6. 先生成 `.codex/codex-thread-merge/CONTEXT.md` 与 `.codex/codex-thread-merge/context/<session_id>.md`
7. 生成/刷新 `.codex/codex-thread-merge/MEMORY.md`
8. 新建 canonical thread，并等待首个 canonical turn 完成与可恢复验证
9. 追加 `.codex/codex-thread-merge/record.log` 审计记录，并按配置处理旧线程

这个项目的核心思路是：把“线程发现、归并、记忆刷新”做成稳定的本地工具链，而不是把这些规则全塞进 prompt。

补充说明：
- `.codex/codex-thread-merge/CONTEXT.md`：本次归并的项目上下文汇总，偏“工作上下文入口”
- `.codex/codex-thread-merge/context/<session_id>.md`：候选会话级上下文快照，偏“来源明细”
- `.codex/codex-thread-merge/MEMORY.md`：项目长期事实与决策沉淀，偏“长期记忆”
- `.codex/codex-thread-merge/record.log`：每次 merge/refresh 的审计留痕，不替代 MEMORY/CONTEXT

### Merge 成功判定

`merge_project_threads` 判定为成功，至少同时满足：

1. 已完成 preview 且用户已在聊天中确认选择编号或 thread id
2. `.codex/codex-thread-merge/CONTEXT.md` 与 `.codex/codex-thread-merge/context/<session_id>.md` 已生成
3. `.codex/codex-thread-merge/MEMORY.md` 已完成更新
4. 已创建 canonical thread，并写入 bootstrap 内容
5. canonical thread 可以在 Codex 中通过 `codex resume` 正常看到并恢复
6. `.codex/codex-thread-merge/record.log` 已追加本次 merge 记录

## 实现方式

### 1. skill 层

项目内的 skill 源目录是：

```text
skills/codex-thread-merge-weak
```

它的作用不是实现业务逻辑，而是定义什么时候应该调用这个 MCP，以及优先调用哪些工具。skill 会先要求 `preview_project_threads`，再要求用户在聊天中明确选择编号或 thread id，之后才允许执行 merge。项目内 skill 源目录始终保留；安装脚本只是在你确认后，额外复制到全局 `~/.codex/skills/codex-thread-merge-weak`。

### 2. MCP server 层

本地 MCP server 是一个 Node.js `stdio` 服务，入口是：

```text
dist/server/index.js
```

它向 Codex 暴露的能力主要包括：

- `preview_project_threads`
- `merge_project_threads`
- `refresh_project_memory`

这些工具负责把“读取 thread、做归并、生成 memory”收口在一个稳定接口里。

### 3. 线程发现层

线程发现逻辑负责按当前工作目录 `cwd` 识别同项目相关的会话。它不是简单按名称匹配，而是结合项目路径和 thread 元数据做候选筛选，减少误归并。

### 4. 线程归并引擎

线程归并引擎负责：

- 提取每个 thread 的关键事实
- 做去重和冲突归并
- 生成新的 canonical thread 内容
- 保留必要的 warning/conflict 信息

对应代码主要在：

- `src/thread-merge-engine`
- `src/thread-discovery`
- `src/server`

### 5. CONTEXT/MEMORY 写入层

归并工作会先产出上下文层，再产出长期记忆层：
- `.codex/codex-thread-merge/CONTEXT.md`：项目级上下文聚合（面向当前归并批次）
- `.codex/codex-thread-merge/context/<session_id>.md`：按会话拆分的上下文文件（可追溯来源）
- `.codex/codex-thread-merge/MEMORY.md`：项目长期事实、决策和稳定结论
- `.codex/codex-thread-merge/record.log`：操作审计日志（成功/失败、警告、选择集）

对应代码主要在：

- `src/memory-writer`

## 安装与更新脚本的实现方式

当前安装器不是“直接在正式目录边拉边改”，而是 staged transaction 模式。

### 1. staged install

安装和更新都会先在临时目录完成这些动作：

1. 拉取远程仓库，或在必要时回退到本地已安装快照
2. 执行 `npm install --include=dev`
3. 执行 `npm run check`
4. 按需执行 `npm run build`
5. 按需执行 `npm test`

只有临时目录里的候选版本全部验证通过，才会切换正式安装目录。

### 2. 幂等性

脚本现在按“重复执行应该尽量是安全 no-op 或安全刷新”的原则实现：

- 如果 MCP 配置已经是目标配置，则直接跳过
- 如果全局 skill 内容没有变化，则直接跳过
- 如果安装目录里只有安装生成物差异，例如：
  - `package-lock.json`
  - `dist/`
  - `node_modules/`
  脚本会把它们视为可自动刷新状态，而不是直接报错

如果检测到源码、脚本、文档等人工修改，脚本会停止，避免覆盖本地手工改动。

### 3. 回滚

安装事务的关键点是“失败后不要把本地安装搞坏”。

因此当前流程是：

1. 先准备 staged 版本
2. 切换正式目录前给旧版本做备份
3. 切换正式目录
4. 再执行 MCP 注册和全局 skill 安装
5. 如果切换后的后续步骤失败，则回滚到之前的安装目录

MCP 注册和 skill 安装本身也做了回滚处理：

- `register-mcp.ps1`
  - 已是目标配置则 no-op
  - 替换失败则恢复旧 MCP 配置
- `install-skill.ps1`
  - 先复制到临时目录
  - 校验 `SKILL.md`
  - 再原子替换目标 skill 目录
  - 失败则恢复旧 skill

### 4. 进度提示

`cmd` 入口不是静默执行，而是给出分阶段提示，包括：

- bootstrap 下载
- staged repository 准备
- 依赖安装和校验
- 正式目录切换
- MCP 刷新
- skill 刷新

在支持 ANSI 的终端里会带彩色文本进度条；不支持时也会退化成普通文本输出。

详细日志默认写到：

```text
%TEMP%\codex-thread-merge-weak-install.log
```

## 目录结构

主要目录如下：

```text
src/
  server/                 MCP server 入口与工具编排
  thread-discovery/       项目 thread 发现逻辑
  thread-merge-engine/    thread 归并引擎
  memory-writer/          MEMORY.md 生成与写入
  codex-client/           与 Codex / app server 交互的客户端封装

scripts/
  install.ps1             主安装事务
  update.ps1              更新入口，复用安装事务
  register-mcp.ps1        MCP 注册与回滚
  install-skill.ps1       全局 skill 安装与回滚
  *.cmd                   Windows cmd 包装器

skills/
  codex-thread-merge-weak/
    SKILL.md              skill 定义

docs/
  usage.md                安装、更新、发布和工具说明
```

## 开发与发布

### 本地检查

```powershell
npm run check
npm test
npm run build
```

### 本地脚本

```cmd
scripts\install.cmd
scripts\update.cmd
scripts\register-mcp.cmd -Force
scripts\install-skill.cmd -Force
```

### 发布到 GitHub

首次发布：

```powershell
powershell .\scripts\publish.ps1 -Bootstrap -Message "chore: initial publish"
```

后续发布：

```powershell
powershell .\scripts\publish.ps1 -Message "chore: update"
```

发布脚本会严格校验远程仓库必须是：

```text
https://github.com/JHJ1848/codex-thread-merge-weak.git
```

## 相关说明

- 如果你在 Windows PowerShell 里执行 `codex` 遇到包装脚本异常，优先改用 `codex.cmd`
- 项目内 `skills/codex-thread-merge-weak` 是唯一 skill 源目录
- 全局 skill 只是从项目源目录复制出的副本
- 更详细的命令和工具参数说明见 [docs/usage.md](docs/usage.md)
