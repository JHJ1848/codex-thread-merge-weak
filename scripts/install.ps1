[CmdletBinding()]
param(
  [string]$InstallDir = "$HOME\tools\codex-thread-merge-weak",
  [string]$RepoUrl = "https://github.com/JHJ1848/codex-thread-merge-weak.git",
  [switch]$SkipBuild,
  [switch]$SkipMcp,
  [switch]$SkipSkill,
  [string]$InstallGlobalSkill = "",
  [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Step {
  param([Parameter(Mandatory = $true)][string]$Message)

  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Fail {
  param([Parameter(Mandatory = $true)][string]$Message)

  throw $Message
}

function Assert-Command {
  param([Parameter(Mandatory = $true)][string]$Name)

  if (-not (Get-Command -Name $Name -ErrorAction SilentlyContinue)) {
    Fail "Required command not found: $Name"
  }
}

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$Arguments = @(),
    [Parameter(Mandatory = $true)][string]$FailureMessage
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    Fail "$FailureMessage (exit code $LASTEXITCODE)"
  }
}

function Get-FullPath {
  param([Parameter(Mandatory = $true)][string]$PathValue)

  return [System.IO.Path]::GetFullPath($PathValue)
}

function Get-GitRemoteUrl {
  param([Parameter(Mandatory = $true)][string]$RepoDir)

  $output = & git -C $RepoDir config --get remote.origin.url 2>$null
  if ($LASTEXITCODE -ne 0) {
    return $null
  }

  return ($output | Select-Object -First 1).Trim()
}

function Assert-CleanWorkingTree {
  param([Parameter(Mandatory = $true)][string]$RepoDir)

  $status = & git -C $RepoDir status --porcelain
  if ($LASTEXITCODE -ne 0) {
    Fail "Failed to inspect working tree: $RepoDir"
  }

  if ($status) {
    Fail "Install directory has uncommitted changes: $RepoDir"
  }
}

$resolvedInstallDir = Get-FullPath -PathValue $InstallDir
$updateScript = Join-Path $resolvedInstallDir "scripts\update.ps1"
$powershellPath = (Get-Command powershell.exe -ErrorAction SilentlyContinue).Source
if (-not $powershellPath) {
  $powershellPath = "powershell.exe"
}

Assert-Command "git"

if (Test-Path -LiteralPath $resolvedInstallDir) {
  if (-not (Test-Path -LiteralPath (Join-Path $resolvedInstallDir ".git"))) {
    if (-not $Force) {
      Fail "Install directory exists but is not a git repository. Re-run with -Force to replace it: $resolvedInstallDir"
    }

    Write-Step "Removing non-git install directory"
    Remove-Item -LiteralPath $resolvedInstallDir -Recurse -Force
  }
}

if (-not (Test-Path -LiteralPath $resolvedInstallDir)) {
  $parentDir = Split-Path -Parent $resolvedInstallDir
  if ($parentDir) {
    New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
  }

  Write-Step "Cloning repository to $resolvedInstallDir"
  Invoke-CheckedCommand -FilePath "git" -Arguments @("clone", "--branch", "main", "--single-branch", $RepoUrl, $resolvedInstallDir) -FailureMessage "git clone failed"
} else {
  $existingRemote = Get-GitRemoteUrl -RepoDir $resolvedInstallDir
  if ($existingRemote -ne $RepoUrl) {
    Fail "Install directory remote does not match. Expected: $RepoUrl Actual: $existingRemote"
  }

  Assert-CleanWorkingTree -RepoDir $resolvedInstallDir

  Write-Step "Updating existing repository"
  Invoke-CheckedCommand -FilePath "git" -Arguments @("-C", $resolvedInstallDir, "fetch", "origin", "main", "--prune") -FailureMessage "git fetch failed"
  Invoke-CheckedCommand -FilePath "git" -Arguments @("-C", $resolvedInstallDir, "checkout", "main") -FailureMessage "git checkout main failed"
  Invoke-CheckedCommand -FilePath "git" -Arguments @("-C", $resolvedInstallDir, "pull", "--ff-only", "origin", "main") -FailureMessage "git pull failed"
}

if (-not (Test-Path -LiteralPath $updateScript)) {
  Fail "update.ps1 not found after clone: $updateScript"
}

$updateArgs = @(
  "-ExecutionPolicy", "Bypass",
  "-File", $updateScript,
  "-InstallDir", $resolvedInstallDir,
  "-SkipPull"
)

if ($SkipBuild) {
  $updateArgs += "-SkipBuild"
}
if ($SkipMcp) {
  $updateArgs += "-SkipMcp"
}
if ($SkipSkill) {
  $updateArgs += "-SkipSkill"
}
if ($InstallGlobalSkill) {
  $updateArgs += "-InstallGlobalSkill"
  $updateArgs += $InstallGlobalSkill
}

Write-Step "Running local update script"
Invoke-CheckedCommand -FilePath $powershellPath -Arguments $updateArgs -FailureMessage "install follow-up update failed"

Write-Host "Install complete: $resolvedInstallDir" -ForegroundColor Green
