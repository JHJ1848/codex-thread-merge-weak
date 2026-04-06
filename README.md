# codex-thread-merge-weak

本项目提供一个本地 `STDIO MCP server + skill`，用于把同一项目下的多个 Codex 会话归并为新的 canonical thread，并同步根目录 `MEMORY.md`。

## 新设备安装

先确认本机已经安装 `git`、`Node.js 18+`、`npm`、`codex`，然后执行：

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/JHJ1848/codex-thread-merge-weak/main/scripts/install.ps1 | iex"
```

更安全的做法是先下载再查看：

```powershell
iwr https://raw.githubusercontent.com/JHJ1848/codex-thread-merge-weak/main/scripts/install.ps1 -OutFile .\install.ps1
Get-Content .\install.ps1
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

安装完成后，在 Codex 里说：

- `归并当前项目会话`
- `同步当前项目的 canonical thread`

## 日常更新

```powershell
powershell .\scripts\update.ps1
```

更新脚本会执行 `git pull --ff-only`、`npm install`、`npm run check`、`npm run build`、`npm test`，然后重新同步 MCP 和 skill。

## 发布到 GitHub

首次发布：

```powershell
powershell .\scripts\publish.ps1 -Bootstrap -Message "chore: initial publish"
```

后续发布：

```powershell
powershell .\scripts\publish.ps1 -Message "chore: update"
```

发布脚本会严格校验远程仓库是否为：

```text
https://github.com/JHJ1848/codex-thread-merge-weak.git
```

## 详细说明

详细安装、更新、发布和 MCP 工具说明见 [docs/usage.md](docs/usage.md)。
