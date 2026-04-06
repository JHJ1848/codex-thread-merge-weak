[CmdletBinding()]
param(
  [string]$InstallDir,
  [string]$SkillName = "codex-thread-merge-weak",
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

function Get-DefaultInstallDir {
  if ($PSScriptRoot) {
    return (Split-Path -Parent $PSScriptRoot)
  }

  return (Join-Path $HOME "tools\codex-thread-merge-weak")
}

$resolvedInstallDir = [System.IO.Path]::GetFullPath($(if ($InstallDir) { $InstallDir } else { Get-DefaultInstallDir }))
$sourceDir = Join-Path $resolvedInstallDir "skills\$SkillName"
$targetRoot = Join-Path $HOME ".codex\skills"
$targetDir = Join-Path $targetRoot $SkillName

if (-not (Test-Path -LiteralPath $sourceDir)) {
  Fail "Missing skill source directory: $sourceDir"
}

if ((Test-Path -LiteralPath $targetDir) -and -not $Force) {
  Fail "Skill already exists: $targetDir. Re-run with -Force to replace it."
}

if (Test-Path -LiteralPath $targetDir) {
  Write-Step "Removing existing skill directory"
  Remove-Item -LiteralPath $targetDir -Recurse -Force
}

New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null

Write-Step "Installing skill into $targetRoot"
Copy-Item -LiteralPath $sourceDir -Destination $targetRoot -Recurse -Force

if (-not (Test-Path -LiteralPath (Join-Path $targetDir "SKILL.md"))) {
  Fail "Installed skill is missing SKILL.md: $targetDir"
}

Write-Host "Skill installed: $targetDir" -ForegroundColor Green
