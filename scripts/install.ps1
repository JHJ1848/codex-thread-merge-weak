[CmdletBinding()]
param(
  [string]$InstallDir = "$HOME\tools\codex-thread-merge-weak",
  [string]$RepoUrl = "https://github.com/JHJ1848/codex-thread-merge-weak.git",
  [switch]$SkipBuild,
  [switch]$SkipMcp,
  [switch]$SkipSkill,
  [string]$InstallGlobalSkill = "",
  [switch]$Force,
  [switch]$SkipPull,
  [switch]$AutoHealDirtyInstall = $true,
  [switch]$RollbackOnFailure = $true,
  [string]$LogPath = ""
)

. (Join-Path $PSScriptRoot "common.ps1")

function Get-InstallDirectoryState {
  param(
    [Parameter(Mandatory = $true)][string]$ResolvedInstallDir,
    [Parameter(Mandatory = $true)][string]$ExpectedRepoUrl,
    [switch]$AllowGeneratedDirtyState
  )

  if (-not (Test-Path -LiteralPath $ResolvedInstallDir)) {
    return [pscustomobject]@{
      Exists = $false
      CanProceed = $true
      CanUseLocalFallback = $false
      HasExistingManagedInstall = $false
      BackupRequired = $false
      Summary = "No existing installation found."
    }
  }

  if (-not (Test-ManagedGitRepo -RepoDir $ResolvedInstallDir)) {
    if (Test-DirectoryEmpty -PathValue $ResolvedInstallDir) {
      return [pscustomobject]@{
        Exists = $true
        CanProceed = $true
        CanUseLocalFallback = $false
        HasExistingManagedInstall = $false
        BackupRequired = $false
        Summary = "Existing install directory is empty and will be reused."
      }
    }

    return [pscustomobject]@{
      Exists = $true
      CanProceed = $false
      CanUseLocalFallback = $false
      HasExistingManagedInstall = $false
      BackupRequired = $false
      Summary = "Install directory exists but is not a managed git repository: $ResolvedInstallDir"
    }
  }

  $actualRemote = Get-GitRemoteUrl -RepoDir $ResolvedInstallDir
  if ((Normalize-GitRemoteUrl -Url $actualRemote) -ne (Normalize-GitRemoteUrl -Url $ExpectedRepoUrl)) {
    return [pscustomobject]@{
      Exists = $true
      CanProceed = $false
      CanUseLocalFallback = $false
      HasExistingManagedInstall = $true
      BackupRequired = $false
      Summary = "Install directory remote does not match expected repository. Expected: $ExpectedRepoUrl Actual: $actualRemote"
    }
  }

  $workingTreeState = Get-GitWorkingTreeState -RepoDir $ResolvedInstallDir
  if ($workingTreeState.IsClean) {
    return [pscustomobject]@{
      Exists = $true
      CanProceed = $true
      CanUseLocalFallback = $true
      HasExistingManagedInstall = $true
      BackupRequired = $true
      WorkingTreeState = $workingTreeState
      Summary = "Managed install is clean."
    }
  }

  if ($workingTreeState.IsAutoHealable -and $AllowGeneratedDirtyState) {
    $paths = ($workingTreeState.Entries | ForEach-Object { $_.NormalizedPath }) -join ", "
    return [pscustomobject]@{
      Exists = $true
      CanProceed = $true
      CanUseLocalFallback = $true
      HasExistingManagedInstall = $true
      BackupRequired = $true
      WorkingTreeState = $workingTreeState
      Summary = "Managed install contains generated local changes and will be refreshed safely: $paths"
    }
  }

  $unsafePaths = ($workingTreeState.Entries | ForEach-Object { $_.NormalizedPath }) -join ", "
  return [pscustomobject]@{
    Exists = $true
    CanProceed = $false
    CanUseLocalFallback = $false
    HasExistingManagedInstall = $true
    BackupRequired = $true
    WorkingTreeState = $workingTreeState
    Summary = "Install directory has non-recoverable local changes: $unsafePaths"
  }
}

function Initialize-StagedRepository {
  param(
    [Parameter(Mandatory = $true)][string]$StageRepoDir,
    [Parameter(Mandatory = $true)][string]$ResolvedInstallDir,
    [Parameter(Mandatory = $true)][string]$ExpectedRepoUrl,
    [Parameter(Mandatory = $true)][psobject]$InstallState,
    [switch]$SkipRemoteClone
  )

  $usedLocalFallback = $false

  if (-not $SkipRemoteClone) {
    try {
      Invoke-CheckedCommand -FilePath "git" -Arguments @("clone", "--branch", "main", "--single-branch", $ExpectedRepoUrl, $StageRepoDir) -FailureMessage "git clone failed" -MaxAttempts 3
    } catch {
      if (-not $InstallState.CanUseLocalFallback) {
        throw
      }

      Write-Note "Remote clone failed. Falling back to the currently installed snapshot." -Level Warn
      $usedLocalFallback = $true
    }
  } else {
    if (-not $InstallState.CanUseLocalFallback) {
      Fail "SkipPull requires an existing managed install: $ResolvedInstallDir"
    }

    $usedLocalFallback = $true
    Write-Note "Using local installed snapshot because -SkipPull was specified." -Level Warn
  }

  if ($usedLocalFallback) {
    Invoke-CheckedCommand -FilePath "git" -Arguments @("clone", $ResolvedInstallDir, $StageRepoDir) -FailureMessage "Failed to clone current local snapshot"
    Invoke-CheckedCommand -FilePath "git" -Arguments @("-C", $StageRepoDir, "remote", "set-url", "origin", $ExpectedRepoUrl) -FailureMessage "Failed to normalize staged remote"
    Invoke-CheckedCommand -FilePath "git" -Arguments @("-C", $StageRepoDir, "checkout", "main") -FailureMessage "Failed to switch staged repository to main"
  }
}

$resolvedInstallDir = Get-FullPath -PathValue $InstallDir
$resolvedLogPath = if ($LogPath) { Get-FullPath -PathValue $LogPath } else { Get-DefaultLogPath }
Set-InstallLogPath -Path $resolvedLogPath

$phaseTotal = 6
$stageRoot = $null
$stageRepoDir = $null
$backupDir = $null
$installSwapped = $false

try {
  Write-Phase -Current 1 -Total $phaseTotal -Message "Preparing installer environment" -State active
  Assert-Command "git"
  Assert-Command "node"
  Assert-Command "npm"
  Write-Log "InstallDir=$resolvedInstallDir RepoUrl=$RepoUrl SkipBuild=$SkipBuild SkipMcp=$SkipMcp SkipSkill=$SkipSkill SkipPull=$SkipPull"

  $installState = Get-InstallDirectoryState -ResolvedInstallDir $resolvedInstallDir -ExpectedRepoUrl $RepoUrl -AllowGeneratedDirtyState:$AutoHealDirtyInstall
  if (-not $installState.CanProceed) {
    Fail $installState.Summary
  }
  Write-Note $installState.Summary

  $parentDir = Split-Path -Parent $resolvedInstallDir
  if ($parentDir) {
    New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
  }

  $stageRoot = New-TemporaryDirectory -Prefix "ctm-install"
  $stageRepoDir = Join-Path $stageRoot "repo"

  Write-Phase -Current 2 -Total $phaseTotal -Message "Preparing staged repository" -State active
  Initialize-StagedRepository -StageRepoDir $stageRepoDir -ResolvedInstallDir $resolvedInstallDir -ExpectedRepoUrl $RepoUrl -InstallState $installState -SkipRemoteClone:$SkipPull

  Write-Phase -Current 3 -Total $phaseTotal -Message "Installing dependencies and verifying build" -State active
  Invoke-CheckedCommand -FilePath "npm" -Arguments @("--prefix", $stageRepoDir, "install", "--include=dev") -FailureMessage "npm install failed"
  Invoke-CheckedCommand -FilePath "npm" -Arguments @("--prefix", $stageRepoDir, "run", "check") -FailureMessage "npm run check failed"
  if (-not $SkipBuild) {
    Invoke-CheckedCommand -FilePath "npm" -Arguments @("--prefix", $stageRepoDir, "run", "build") -FailureMessage "npm run build failed"
    Invoke-CheckedCommand -FilePath "npm" -Arguments @("--prefix", $stageRepoDir, "test") -FailureMessage "npm test failed"
  }

  Write-Phase -Current 4 -Total $phaseTotal -Message "Switching install directory" -State active
  if ((Test-Path -LiteralPath $resolvedInstallDir) -and -not (Test-ManagedGitRepo -RepoDir $resolvedInstallDir) -and (Test-DirectoryEmpty -PathValue $resolvedInstallDir)) {
    Remove-PathIfExists -PathValue $resolvedInstallDir
  }

  if ($installState.BackupRequired -and (Test-Path -LiteralPath $resolvedInstallDir)) {
    $backupDir = Join-Path $parentDir ("codex-thread-merge-weak.rollback-{0}" -f (Get-Date -Format "yyyyMMddHHmmss"))
  }

  Move-InstalledDirectoryWithBackup -SourceDir $stageRepoDir -TargetDir $resolvedInstallDir -BackupDir $backupDir
  $installSwapped = $true
  Write-Phase -Current 4 -Total $phaseTotal -Message "Install directory switched" -State done

  if (-not $SkipMcp) {
    Write-Phase -Current 5 -Total $phaseTotal -Message "Refreshing MCP registration" -State active
    & (Join-Path $resolvedInstallDir "scripts\register-mcp.ps1") -InstallDir $resolvedInstallDir -Force
    Write-Phase -Current 5 -Total $phaseTotal -Message "MCP registration ready" -State done
  } else {
    Write-Phase -Current 5 -Total $phaseTotal -Message "Skipping MCP registration" -State warn
  }

  if (-not $SkipSkill) {
    Write-Phase -Current 6 -Total $phaseTotal -Message "Refreshing skill installation" -State active
    $skillArguments = @{
      InstallDir = $resolvedInstallDir
      Force = $true
    }
    if ($InstallGlobalSkill) {
      $skillArguments.InstallGlobalSkill = $InstallGlobalSkill
    }
    & (Join-Path $resolvedInstallDir "scripts\install-skill.ps1") @skillArguments
    Write-Phase -Current 6 -Total $phaseTotal -Message "Skill installation ready" -State done
  } else {
    Write-Phase -Current 6 -Total $phaseTotal -Message "Skipping skill installation" -State warn
  }

  if ($backupDir -and (Test-Path -LiteralPath $backupDir)) {
    Remove-PathIfExists -PathValue $backupDir
  }

  if ($stageRoot -and (Test-Path -LiteralPath $stageRoot)) {
    Remove-PathIfExists -PathValue $stageRoot
  }

  Write-Note "Install complete: $resolvedInstallDir" -Level Success
  Write-Note "Install log: $resolvedLogPath"
} catch {
  $originalMessage = $_.Exception.Message
  Write-Phase -Current 6 -Total $phaseTotal -Message "Install failed, starting rollback" -State error

  if ($RollbackOnFailure -and $installSwapped) {
    try {
      if (Test-Path -LiteralPath $resolvedInstallDir) {
        Remove-PathIfExists -PathValue $resolvedInstallDir
      }

      if ($backupDir -and (Test-Path -LiteralPath $backupDir)) {
        Move-Item -LiteralPath $backupDir -Destination $resolvedInstallDir
        Write-Note "Rollback restored previous install directory." -Level Warn
      }
    } catch {
      $originalMessage = "$originalMessage Rollback failed: $($_.Exception.Message)"
    }
  }

  if ($stageRoot -and (Test-Path -LiteralPath $stageRoot)) {
    try {
      Remove-PathIfExists -PathValue $stageRoot
    } catch {
      Write-Log "Failed to clean staged directory: $stageRoot"
    }
  }

  Fail "$originalMessage See log: $resolvedLogPath"
}
