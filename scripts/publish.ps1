[CmdletBinding()]
param(
  [string]$Message = "",
  [string]$Branch = "main",
  [string]$RemoteUrl = "https://github.com/JHJ1848/codex-thread-merge-weak.git",
  [switch]$SkipChecks,
  [switch]$Bootstrap
)

. (Join-Path $PSScriptRoot "common.ps1")

$repoRoot = Get-FullPath -PathValue (Get-ProjectRoot)

Assert-Command "git"
Assert-Command "gh"
Assert-Command "node"
Assert-Command "npm"
Assert-Command "codex"

Write-Step "Checking GitHub authentication"
Invoke-CheckedCommand -FilePath "gh" -Arguments @("auth", "status") -FailureMessage "gh auth status failed"

Write-Step "Checking target repository"
Invoke-CheckedCommand -FilePath "gh" -Arguments @("repo", "view", "JHJ1848/codex-thread-merge-weak", "--json", "name,url") -FailureMessage "Target GitHub repository is not accessible"

if (-not (Test-Path -LiteralPath (Join-Path $repoRoot ".git"))) {
  Write-Step "Initializing git repository"
  Invoke-CheckedCommand -FilePath "git" -Arguments @("-C", $repoRoot, "init", "-b", $Branch) -FailureMessage "git init failed"
}

$originUrl = Get-GitRemoteUrl -RepoDir $repoRoot
if (-not $originUrl) {
  Write-Step "Adding origin remote"
  Invoke-CheckedCommand -FilePath "git" -Arguments @("-C", $repoRoot, "remote", "add", "origin", $RemoteUrl) -FailureMessage "Failed to add origin remote"
} else {
  Assert-GitRemoteMatches -RepoDir $repoRoot -ExpectedUrl $RemoteUrl
}

Write-Step "Ensuring branch is $Branch"
Invoke-CheckedCommand -FilePath "git" -Arguments @("-C", $repoRoot, "checkout", "-B", $Branch) -FailureMessage "Failed to switch branch"

Write-Step "Installing dependencies"
Invoke-CheckedCommand -FilePath "npm" -Arguments @("--prefix", $repoRoot, "install", "--include=dev") -FailureMessage "npm install failed"

if (-not $SkipChecks) {
  Write-Step "Running type checks"
  Invoke-CheckedCommand -FilePath "npm" -Arguments @("--prefix", $repoRoot, "run", "check") -FailureMessage "npm run check failed"

  Write-Step "Building project"
  Invoke-CheckedCommand -FilePath "npm" -Arguments @("--prefix", $repoRoot, "run", "build") -FailureMessage "npm run build failed"

  Write-Step "Running tests"
  Invoke-CheckedCommand -FilePath "npm" -Arguments @("--prefix", $repoRoot, "test") -FailureMessage "npm test failed"
}

Write-Step "Staging files"
Invoke-CheckedCommand -FilePath "git" -Arguments @("-C", $repoRoot, "add", "-A") -FailureMessage "git add failed"

& git -C $repoRoot diff --cached --quiet
switch ($LASTEXITCODE) {
  0 { $hasStagedChanges = $false }
  1 { $hasStagedChanges = $true }
  default { Fail "Failed to inspect staged changes" }
}

if ($hasStagedChanges) {
  $commitMessage = $Message
  if (-not $commitMessage) {
    $commitMessage = "chore: publish $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
  }

  Write-Step "Creating commit"
  Invoke-CheckedCommand -FilePath "git" -Arguments @("-C", $repoRoot, "commit", "-m", $commitMessage) -FailureMessage "git commit failed"
} else {
  Write-Host "No staged changes to commit." -ForegroundColor Yellow
}

$hasUpstream = $false
$branchRemote = & git -C $repoRoot config --get "branch.$Branch.remote" 2>$null
if ($LASTEXITCODE -eq 0 -and $branchRemote) {
  $hasUpstream = $true
}

Write-Step "Pushing to GitHub"
if ($Bootstrap -or -not $hasUpstream) {
  Invoke-CheckedCommand -FilePath "git" -Arguments @("-C", $repoRoot, "push", "-u", "origin", $Branch) -FailureMessage "git push failed"
} else {
  Invoke-CheckedCommand -FilePath "git" -Arguments @("-C", $repoRoot, "push", "origin", $Branch) -FailureMessage "git push failed"
}

Write-Host "Publish complete: $RemoteUrl" -ForegroundColor Green
