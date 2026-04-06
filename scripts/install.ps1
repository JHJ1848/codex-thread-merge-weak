[CmdletBinding()]
param(
  [string]$InstallDir = "$HOME\tools\codex-thread-merge-weak",
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
    Fail "Install directory has uncommitted changes: $RepoDir"
  }
}

function Checkout-MainBranch {
  param([string]$RepoDir)

  & git -C $RepoDir fetch origin main --prune
  if ($LASTEXITCODE -ne 0) {
    Fail "Failed to fetch origin/main."
  }

  & git -C $RepoDir show-ref --verify --quiet refs/heads/main
  if ($LASTEXITCODE -eq 0) {
    & git -C $RepoDir checkout main
  } else {
    & git -C $RepoDir checkout -B main origin/main
  }

  if ($LASTEXITCODE -ne 0) {
    Fail "Failed to switch to the main branch."
  }

  & git -C $RepoDir pull --ff-only origin main
  if ($LASTEXITCODE -ne 0) {
    Fail "Failed to update the main branch."
  }
}

$resolvedInstallDir = [System.IO.Path]::GetFullPath($InstallDir)
$registerScript = Join-Path $resolvedInstallDir "scripts\register-mcp.ps1"
$installSkillScript = Join-Path $resolvedInstallDir "scripts\install-skill.ps1"

Assert-Command "git"
Assert-Command "node"
Assert-Command "npm"
if (-not $SkipMcp) {
  Assert-Command "codex"
}

if (Test-Path -LiteralPath $resolvedInstallDir) {
  if (-not (Test-Path -LiteralPath (Join-Path $resolvedInstallDir ".git"))) {
    if (-not $Force) {
      Fail "Install directory already exists but is not a Git repository: $resolvedInstallDir"
    }

    Write-Step "Removing non-git install directory"
    Remove-Item -LiteralPath $resolvedInstallDir -Recurse -Force
  }
}

if (-not (Test-Path -LiteralPath $resolvedInstallDir)) {
  Write-Step "Cloning repository into $resolvedInstallDir"
  New-Item -ItemType Directory -Path (Split-Path -Parent $resolvedInstallDir) -Force | Out-Null
  & git clone --branch main --single-branch $RepoUrl $resolvedInstallDir
  if ($LASTEXITCODE -ne 0) {
    Fail "Failed to clone the repository."
  }
} else {
  $existingRemote = Get-RemoteUrl -RepoDir $resolvedInstallDir
  if ($existingRemote -ne $RepoUrl) {
    Fail "Unexpected remote URL. Expected: $RepoUrl Actual: $existingRemote"
  }

  Assert-CleanWorkingTree -RepoDir $resolvedInstallDir
  Write-Step "Updating existing repository"
  Checkout-MainBranch -RepoDir $resolvedInstallDir
}

$currentCommit = (& git -C $resolvedInstallDir rev-parse HEAD | Select-Object -First 1).Trim()
if ($LASTEXITCODE -ne 0) {
  Fail "Failed to read the current commit."
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
  if (-not (Test-Path -LiteralPath $registerScript)) {
    Fail "Missing script: $registerScript"
  }

  Write-Step "Registering MCP server"
  & $registerScript -InstallDir $resolvedInstallDir -Force
}

if (-not $SkipSkill) {
  if (-not (Test-Path -LiteralPath $installSkillScript)) {
    Fail "Missing script: $installSkillScript"
  }

  Write-Step "Installing skill"
  & $installSkillScript -InstallDir $resolvedInstallDir -Force
}

Write-Host ""
Write-Host "Installation complete." -ForegroundColor Green
Write-Host "Install directory: $resolvedInstallDir"
Write-Host "Current commit: $currentCommit"
Write-Host "In Codex, try: merge project sessions"
