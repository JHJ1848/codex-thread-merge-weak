# codex-thread-merge-mcp

本项目提供一个本地 `STDIO MCP server + skill`，用于把同一项目下的多个 Codex 会话归并为新的 canonical thread，并同步项目根目录 `MEMORY.md`。

## 1. 新设备安装

先确认本机已经安装：

- `git`
- `Node.js 18+`
- `npm`
- `codex`

推荐直接执行远程安装脚本：

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/JHJ1848/codex-thread-merge-weak/main/scripts/install.ps1 | iex"
```

更安全的方式是先下载、检查，再运行：

```powershell
iwr https://raw.githubusercontent.com/JHJ1848/codex-thread-merge-weak/main/scripts/install.ps1 -OutFile .\install.ps1
Get-Content .\install.ps1
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

默认安装目录：

```text
$HOME\tools\codex-thread-merge-weak
```

安装脚本会自动完成：

1. 克隆或更新仓库
2. 执行 `npm install --include=dev`
3. 执行 `npm run check`
4. 执行 `npm run build`
4. 注册 MCP server
5. 保留项目内 `./skills/codex-thread-merge-weak` 作为 skill 来源目录
6. 用英文提示是否将 skill 安装到全局 `~/.codex/skills/codex-thread-merge-weak`

可选参数：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 `
  -InstallDir "D:\tools\codex-thread-merge-weak" `
  -SkipBuild `
  -SkipMcp `
  -InstallGlobalSkill true `
  -SkipSkill
```

## 2. 本机更新

如果仓库已经在本机，执行：

```powershell
powershell .\scripts\update.ps1
```

该脚本会执行：

1. `git pull --ff-only`
2. `npm install --include=dev`
3. `npm run check`
4. `npm run build`
5. `npm test`
6. 重新注册 MCP
7. 重新同步 skill，并在未显式传参时询问是否安装到全局目录

## 3. 发布到 GitHub

发布前先确认：

- `gh auth status` 已登录
- 当前仓库目标远程是 `https://github.com/JHJ1848/codex-thread-merge-weak.git`

首次发布：

```powershell
powershell .\scripts\publish.ps1 -Bootstrap -Message "chore: initial publish"
```

后续发布：

```powershell
powershell .\scripts\publish.ps1 -Message "feat: update merge workflow"
```

发布脚本默认会执行：

1. `npm install --include=dev`
2. `npm run check`
3. `npm run build`
4. `npm test`
5. `git add -A`
6. `git commit`
7. `git push`

如果只是临时跳过检查：

```powershell
powershell .\scripts\publish.ps1 -Message "chore: quick publish" -SkipChecks
```

## 4. 单独操作

只重新注册 MCP：

```powershell
powershell .\scripts\register-mcp.ps1 -Force
```

只重新安装 skill：

```powershell
powershell .\scripts\install-skill.ps1 -Force
```

如果你想跳过提示并直接安装到全局：

```powershell
powershell .\scripts\install-skill.ps1 -Force -InstallGlobalSkill true
```

如果你想跳过全局安装：

```powershell
powershell .\scripts\install-skill.ps1 -InstallGlobalSkill false
```

## 5. 注册 MCP Server

默认脚本会把 MCP 注册为：

```text
codex-thread-merge
```

也可以手动注册：

```powershell
codex mcp add codex-thread-merge -- node dist/server/index.js
```

验证注册结果：

```powershell
codex mcp list --json
codex mcp get codex-thread-merge --json
```

如果你在 Windows PowerShell 里遇到 `codex` 包装脚本异常，可直接改用：

```powershell
codex.cmd mcp list --json
codex.cmd mcp get codex-thread-merge --json
```

## 6. 工具说明

- `preview_project_threads`
  - 按 `cwd` 发现候选会话
- `merge_project_threads`
  - 读取候选会话并归并为 canonical thread，可选更新 `MEMORY.md`，并可选 compact 或重命名旧会话
- `refresh_project_memory`
  - 只刷新 `MEMORY.md`，不创建 canonical thread

## 7. 调用示例

### preview_project_threads

```json
{
  "cwd": "C:\\Users\\jinghongjie\\Desktop\\temp\\新建文件夹",
  "include_archived": false
}
```

### merge_project_threads

```json
{
  "cwd": "C:\\Users\\jinghongjie\\Desktop\\temp\\新建文件夹",
  "include_archived": false,
  "write_memory": true,
  "compact_old_threads": true,
  "rename_old_threads": true
}
```

### refresh_project_memory

```json
{
  "cwd": "C:\\Users\\jinghongjie\\Desktop\\temp\\新建文件夹"
}
```

## 8. 在 Codex 中如何触发

安装完成后，在 Codex 中可以直接说：

- `归并当前项目会话`
- `把这个项目的多个 Codex 会话合成主会话`
- `同步当前项目的 canonical thread`

## 9. Windows UTF-8 提示

如果 PowerShell 出现中文乱码，可先执行：

```powershell
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)
chcp 65001 > $null
```

## 10. 行为约定

- 归并语义是“新建 canonical thread”，不是物理合并旧 thread
- 默认会尝试 compact 旧 thread，并将旧 thread 名称追加 `[Merged]`
- 如果部分 thread 读取失败，工具返回 `warnings[]`，其余线程继续处理
