[CmdletBinding()]
param(
  [string]$InstallDir,
  [string]$RepoUrl = "https://github.com/JHJ1848/codex-thread-merge-weak.git",
  [switch]$SkipBuild,
  [switch]$SkipMcp,
  [switch]$SkipSkill,
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

function Get-RemoteUrl {
  param([string]$RepoDir)

  $output = & git -C $RepoDir remote get-url origin 2>$null
  if ($LASTEXITCODE -ne 0) {
    return $null
  }

  return ($output | Select-Object -First 1).Trim()
}

function Assert-CleanWorkingTree {
  param([string]$RepoDir)

  $status = & git -C $RepoDir status --porcelain
  if ($LASTEXITCODE -ne 0) {
    Fail "Failed to read working tree status: $RepoDir"
  }

  if ($status) {
    Fail "Repository has uncommitted changes: $RepoDir"
  }
}

$resolvedInstallDir = [System.IO.Path]::GetFullPath($(if ($InstallDir) { $InstallDir } else { Get-DefaultInstallDir }))
$registerScript = Join-Path $resolvedInstallDir "scripts\register-mcp.ps1"
$installSkillScript = Join-Path $resolvedInstallDir "scripts\install-skill.ps1"

Assert-Command "git"
Assert-Command "node"
Assert-Command "npm"
if (-not $SkipMcp) {
  Assert-Command "codex"
}

if (-not (Test-Path -LiteralPath (Join-Path $resolvedInstallDir ".git"))) {
  Fail "Installed repository not found: $resolvedInstallDir"
}

$existingRemote = Get-RemoteUrl -RepoDir $resolvedInstallDir
if ($existingRemote -ne $RepoUrl) {
  Fail "Unexpected remote URL. Expected: $RepoUrl Actual: $existingRemote"
}

Assert-CleanWorkingTree -RepoDir $resolvedInstallDir

Write-Step "Updating repository"
& git -C $resolvedInstallDir fetch origin main --prune
if ($LASTEXITCODE -ne 0) {
  Fail "git fetch failed."
}

& git -C $resolvedInstallDir show-ref --verify --quiet refs/heads/main
if ($LASTEXITCODE -eq 0) {
  & git -C $resolvedInstallDir checkout main
} else {
  & git -C $resolvedInstallDir checkout -B main origin/main
}
if ($LASTEXITCODE -ne 0) {
  Fail "Failed to switch to the main branch."
}

& git -C $resolvedInstallDir pull --ff-only origin main
if ($LASTEXITCODE -ne 0) {
  Fail "git pull failed."
}

Write-Step "Installing dependencies"
& npm --prefix $resolvedInstallDir install
if ($LASTEXITCODE -ne 0) {
  Fail "npm install failed."
}

if (-not $SkipBuild) {
  Write-Step "Building project"
  & npm --prefix $resolvedInstallDir run build
  if ($LASTEXITCODE -ne 0) {
    Fail "npm run build failed."
  }
}

if (-not $SkipMcp) {
  Write-Step "Refreshing MCP config"
  & $registerScript -InstallDir $resolvedInstallDir -Force
}

if (-not $SkipSkill) {
  Write-Step "Refreshing skill"
  & $installSkillScript -InstallDir $resolvedInstallDir -Force
}

Write-Host "Update complete: $resolvedInstallDir" -ForegroundColor Green
