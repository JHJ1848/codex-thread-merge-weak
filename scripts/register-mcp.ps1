[CmdletBinding()]
param(
  [string]$InstallDir,
  [string]$ServerName = "codex-thread-merge",
  [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)

function Write-Step {
  param([string]$Text)
  Write-Host "==> $Text" -ForegroundColor Cyan
}

function Fail {
  param([string]$Text)
  throw $Text
}

function Assert-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    Fail "Missing required command: $Name"
  }
}

function Get-DefaultInstallDir {
  if ($PSScriptRoot) {
    return (Split-Path -Parent $PSScriptRoot)
  }

  return (Join-Path $HOME "tools\codex-thread-merge-weak")
}

$resolvedInstallDir = [System.IO.Path]::GetFullPath($(if ($InstallDir) { $InstallDir } else { Get-DefaultInstallDir }))
$serverEntry = Join-Path $resolvedInstallDir "dist\server\index.js"

Assert-Command "codex"
Assert-Command "node"

if (-not (Test-Path -LiteralPath $serverEntry)) {
  Fail "Missing MCP server entry: $serverEntry. Run npm run build first."
}

$existingConfig = $false
& codex mcp get $ServerName --json 1>$null 2>$null
if ($LASTEXITCODE -eq 0) {
  $existingConfig = $true
}

if ($existingConfig -and -not $Force) {
  Fail "MCP config '$ServerName' already exists. Re-run with -Force to replace it."
}

if ($existingConfig) {
  Write-Step "Removing existing MCP config: $ServerName"
  & codex mcp remove $ServerName
  if ($LASTEXITCODE -ne 0) {
    Fail "Failed to remove MCP config: $ServerName"
  }
}

Write-Step "Registering MCP config: $ServerName"
& codex mcp add $ServerName -- node $serverEntry
if ($LASTEXITCODE -ne 0) {
  Fail "Failed to register MCP config: $ServerName"
}

Write-Step "Validating MCP config: $ServerName"
& codex mcp get $ServerName --json
if ($LASTEXITCODE -ne 0) {
  Fail "Failed to validate MCP config: $ServerName"
}

Write-Host "MCP registered: $ServerName" -ForegroundColor Green
