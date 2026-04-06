[CmdletBinding()]
param(
  [string]$InstallDir,
  [string]$RepoUrl = "https://github.com/JHJ1848/codex-thread-merge-weak.git",
  [switch]$SkipBuild,
  [switch]$SkipMcp,
  [switch]$SkipSkill,
  [switch]$SkipPull
)

. (Join-Path $PSScriptRoot "common.ps1")

$resolvedInstallDir = Get-FullPath -PathValue $(if ($InstallDir) { $InstallDir } else { Get-DefaultInstallDir })
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

Assert-GitRemoteMatches -RepoDir $resolvedInstallDir -ExpectedUrl $RepoUrl
Assert-CleanWorkingTree -RepoDir $resolvedInstallDir

if (-not $SkipPull) {
  Write-Step "Updating repository"
  Invoke-CheckedCommand -FilePath "git" -Arguments @("-C", $resolvedInstallDir, "fetch", "origin", "main", "--prune") -FailureMessage "git fetch failed"
  Invoke-CheckedCommand -FilePath "git" -Arguments @("-C", $resolvedInstallDir, "checkout", "main") -FailureMessage "git checkout main failed"
  Invoke-CheckedCommand -FilePath "git" -Arguments @("-C", $resolvedInstallDir, "pull", "--ff-only", "origin", "main") -FailureMessage "git pull failed"
}

Write-Step "Installing dependencies"
Invoke-CheckedCommand -FilePath "npm" -Arguments @("--prefix", $resolvedInstallDir, "install") -FailureMessage "npm install failed"

Write-Step "Running type checks"
Invoke-CheckedCommand -FilePath "npm" -Arguments @("--prefix", $resolvedInstallDir, "run", "check") -FailureMessage "npm run check failed"

if (-not $SkipBuild) {
  Write-Step "Building project"
  Invoke-CheckedCommand -FilePath "npm" -Arguments @("--prefix", $resolvedInstallDir, "run", "build") -FailureMessage "npm run build failed"

  Write-Step "Running tests"
  Invoke-CheckedCommand -FilePath "npm" -Arguments @("--prefix", $resolvedInstallDir, "test") -FailureMessage "npm test failed"
}

if (-not $SkipMcp) {
  Write-Step "Refreshing MCP registration"
  & $registerScript -InstallDir $resolvedInstallDir -Force
}

if (-not $SkipSkill) {
  Write-Step "Refreshing skill files"
  & $installSkillScript -InstallDir $resolvedInstallDir -Force
}

Write-Host "Update complete: $resolvedInstallDir" -ForegroundColor Green
