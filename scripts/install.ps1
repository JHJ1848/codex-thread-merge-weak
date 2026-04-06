[CmdletBinding()]
param(
  [string]$InstallDir = "$HOME\tools\codex-thread-merge-weak",
  [string]$RepoUrl = "https://github.com/JHJ1848/codex-thread-merge-weak.git",
  [switch]$SkipBuild,
  [switch]$SkipMcp,
  [switch]$SkipSkill,
  [switch]$Force
)

. (Join-Path $PSScriptRoot "common.ps1")

$resolvedInstallDir = Get-FullPath -PathValue $InstallDir
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
      Fail "Install directory exists but is not a git repository. Re-run with -Force to replace it: $resolvedInstallDir"
    }

    Write-Step "Replacing non-git install directory"
    Remove-Item -LiteralPath $resolvedInstallDir -Recurse -Force
  }
}

if (-not (Test-Path -LiteralPath $resolvedInstallDir)) {
  Write-Step "Cloning repository to $resolvedInstallDir"
  New-Item -ItemType Directory -Path (Split-Path -Parent $resolvedInstallDir) -Force | Out-Null
  Invoke-CheckedCommand -FilePath "git" -Arguments @("clone", $RepoUrl, $resolvedInstallDir) -FailureMessage "git clone failed"
} else {
  Assert-GitRemoteMatches -RepoDir $resolvedInstallDir -ExpectedUrl $RepoUrl
  Assert-CleanWorkingTree -RepoDir $resolvedInstallDir
  Write-Step "Updating existing repository"
  Invoke-CheckedCommand -FilePath "git" -Arguments @("-C", $resolvedInstallDir, "fetch", "origin", "main", "--prune") -FailureMessage "git fetch failed"
  Invoke-CheckedCommand -FilePath "git" -Arguments @("-C", $resolvedInstallDir, "checkout", "main") -FailureMessage "git checkout main failed"
  Invoke-CheckedCommand -FilePath "git" -Arguments @("-C", $resolvedInstallDir, "pull", "--ff-only", "origin", "main") -FailureMessage "git pull failed"
}

$currentCommitOutput = & git -C $resolvedInstallDir rev-parse HEAD 2>$null
$currentCommit = ($currentCommitOutput | Select-Object -First 1).Trim()
if (-not $currentCommit) {
  Fail "Failed to resolve current commit"
}

Write-Step "Installing dependencies"
Invoke-CheckedCommand -FilePath "npm" -Arguments @("--prefix", $resolvedInstallDir, "install") -FailureMessage "npm install failed"

Write-Step "Running type checks"
Invoke-CheckedCommand -FilePath "npm" -Arguments @("--prefix", $resolvedInstallDir, "run", "check") -FailureMessage "npm run check failed"

if (-not $SkipBuild) {
  Write-Step "Building project"
  Invoke-CheckedCommand -FilePath "npm" -Arguments @("--prefix", $resolvedInstallDir, "run", "build") -FailureMessage "npm run build failed"
}

if (-not $SkipMcp) {
  if (-not (Test-Path -LiteralPath $registerScript)) {
    Fail "register-mcp.ps1 not found: $registerScript"
  }

  Write-Step "Registering MCP server"
  & $registerScript -InstallDir $resolvedInstallDir -Force
}

if (-not $SkipSkill) {
  if (-not (Test-Path -LiteralPath $installSkillScript)) {
    Fail "install-skill.ps1 not found: $installSkillScript"
  }

  Write-Step "Installing skill"
  & $installSkillScript -InstallDir $resolvedInstallDir -Force
}

Write-Host ""
Write-Host "Install complete." -ForegroundColor Green
Write-Host "InstallDir: $resolvedInstallDir"
Write-Host "Current commit: $currentCommit"
Write-Host "In Codex you can now say: 归并当前项目会话"
