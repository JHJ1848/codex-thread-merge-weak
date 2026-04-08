[CmdletBinding()]
param(
  [string]$RepoBaseUrl = "https://raw.githubusercontent.com/JHJ1848/codex-thread-merge-weak/main",
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$InstallArgs
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$PSDefaultParameterValues["Out-File:Encoding"] = "utf8"
$PSDefaultParameterValues["Set-Content:Encoding"] = "utf8"

function Get-ScriptRootPath {
  if ($PSScriptRoot) {
    return $PSScriptRoot
  }

  if ($PSCommandPath) {
    return (Split-Path -Parent $PSCommandPath)
  }

  return $null
}

function Write-Stage {
  param(
    [Parameter(Mandatory = $true)][string]$Message,
    [ValidateSet("Info", "Warn", "Error", "Success")][string]$Level = "Info"
  )

  $color = switch ($Level) {
    "Warn" { "Yellow" }
    "Error" { "Red" }
    "Success" { "Green" }
    default { "Cyan" }
  }

  Write-Host $Message -ForegroundColor $color
}

function Download-WithRetry {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)][string]$OutFile,
    [int]$MaxAttempts = 3
  )

  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $OutFile
      return
    } catch {
      if ($attempt -eq $MaxAttempts) {
        throw
      }

      Write-Stage ("Retrying download ({0}/{1}): {2}" -f $attempt, $MaxAttempts, $Uri) -Level Warn
      Start-Sleep -Seconds 1
    }
  }
}

function Resolve-BootstrapSource {
  $scriptRoot = Get-ScriptRootPath
  if (-not $scriptRoot) {
    return $null
  }

  $localInstallScript = Join-Path $scriptRoot "scripts\install.ps1"
  $localCommonScript = Join-Path $scriptRoot "scripts\common.ps1"
  $hasInstallScript = Test-Path -LiteralPath $localInstallScript
  $hasCommonScript = Test-Path -LiteralPath $localCommonScript

  if ($hasInstallScript -and $hasCommonScript) {
    return [pscustomobject]@{
      Mode = "Local"
      InstallScript = $localInstallScript
      CommonScript = $localCommonScript
    }
  }

  if ($hasInstallScript -xor $hasCommonScript) {
    Write-Stage "Local bootstrap files are incomplete, switching to remote bootstrap" -Level Warn
  }

  return $null
}

$bootstrapRoot = Join-Path $env:TEMP "codex-thread-merge-weak-bootstrap"
$stageDir = Join-Path $bootstrapRoot ("stage-{0}" -f $PID)
$source = Resolve-BootstrapSource
$installScriptPath = $null

try {
  Write-Stage "[1/4] Preparing bootstrap workspace"
  New-Item -ItemType Directory -Path $bootstrapRoot -Force | Out-Null
  if (Test-Path -LiteralPath $stageDir) {
    Remove-Item -LiteralPath $stageDir -Recurse -Force
  }
  New-Item -ItemType Directory -Path $stageDir -Force | Out-Null

  if ($source) {
    Write-Stage "[2/4] Using local bootstrap sources"
    $installScriptPath = $source.InstallScript
  } else {
    $installScriptPath = Join-Path $stageDir "install.ps1"
    $commonScriptPath = Join-Path $stageDir "common.ps1"

    Write-Stage "[2/4] Downloading installer scripts"
    Download-WithRetry -Uri "$RepoBaseUrl/scripts/install.ps1" -OutFile $installScriptPath
    Download-WithRetry -Uri "$RepoBaseUrl/scripts/common.ps1" -OutFile $commonScriptPath
  }

  Write-Stage "[3/4] Launching transactional installer"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installScriptPath @InstallArgs
  $installExitCode = $LASTEXITCODE
  if ($installExitCode -ne 0) {
    throw "Installer exited with code $installExitCode"
  }

  Write-Stage "[4/4] Bootstrap completed" -Level Success
} catch {
  Write-Stage ("Bootstrap failed: {0}" -f $_.Exception.Message) -Level Error
  throw
} finally {
  if (Test-Path -LiteralPath $stageDir) {
    Remove-Item -LiteralPath $stageDir -Recurse -Force
  }
}
