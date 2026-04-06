Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$PSDefaultParameterValues["Out-File:Encoding"] = "utf8"
$PSDefaultParameterValues["Set-Content:Encoding"] = "utf8"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

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

function Get-ProjectRoot {
  if ($PSScriptRoot) {
    return (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
  }

  return (Get-Location).Path
}

function Get-DefaultInstallDir {
  return (Join-Path $HOME "tools\codex-thread-merge-weak")
}

function Get-FullPath {
  param([Parameter(Mandatory = $true)][string]$PathValue)

  return [System.IO.Path]::GetFullPath($PathValue)
}

function Normalize-GitRemoteUrl {
  param([Parameter(Mandatory = $true)][string]$Url)

  $normalized = $Url.Trim()

  if ($normalized.StartsWith("git@github.com:", [System.StringComparison]::OrdinalIgnoreCase)) {
    $normalized = "https://github.com/" + $normalized.Substring("git@github.com:".Length)
  }

  if ($normalized.EndsWith(".git", [System.StringComparison]::OrdinalIgnoreCase)) {
    $normalized = $normalized.Substring(0, $normalized.Length - 4)
  }

  return $normalized.TrimEnd("/").ToLowerInvariant()
}

function Get-GitRemoteUrl {
  param([Parameter(Mandatory = $true)][string]$RepoDir)

  $output = & git -C $RepoDir config --get remote.origin.url 2>$null
  if ($LASTEXITCODE -ne 0) {
    return $null
  }

  return ($output | Select-Object -First 1).Trim()
}

function Assert-GitRemoteMatches {
  param(
    [Parameter(Mandatory = $true)][string]$RepoDir,
    [Parameter(Mandatory = $true)][string]$ExpectedUrl
  )

  $actualUrl = Get-GitRemoteUrl -RepoDir $RepoDir
  if (-not $actualUrl) {
    Fail "Git remote origin is missing: $RepoDir"
  }

  if ((Normalize-GitRemoteUrl -Url $actualUrl) -ne (Normalize-GitRemoteUrl -Url $ExpectedUrl)) {
    Fail "Git remote origin does not match expected repository. Expected: $ExpectedUrl Actual: $actualUrl"
  }
}

function Assert-CleanWorkingTree {
  param([Parameter(Mandatory = $true)][string]$RepoDir)

  $status = & git -C $RepoDir status --porcelain
  if ($LASTEXITCODE -ne 0) {
    Fail "Failed to inspect working tree: $RepoDir"
  }

  if ($status) {
    Fail "Working tree has uncommitted changes: $RepoDir"
  }
}

function Assert-PathWithinRoot {
  param(
    [Parameter(Mandatory = $true)][string]$RootPath,
    [Parameter(Mandatory = $true)][string]$ChildPath
  )

  $normalizedRoot = Get-FullPath -PathValue $RootPath
  $normalizedChild = Get-FullPath -PathValue $ChildPath

  if (
    -not $normalizedChild.StartsWith(
      "$normalizedRoot$([System.IO.Path]::DirectorySeparatorChar)",
      [System.StringComparison]::OrdinalIgnoreCase
    ) -and
    -not $normalizedChild.Equals($normalizedRoot, [System.StringComparison]::OrdinalIgnoreCase)
  ) {
    Fail "Refusing to operate outside root. Root: $normalizedRoot Child: $normalizedChild"
  }
}
