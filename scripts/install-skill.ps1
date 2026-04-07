[CmdletBinding()]
param(
  [string]$InstallDir,
  [string]$SkillName = "codex-thread-merge-weak",
  [string]$InstallGlobalSkill = "",
  [switch]$Force
)

. (Join-Path $PSScriptRoot "common.ps1")

function Resolve-InstallGlobalSkill {
  param(
    [Parameter(Mandatory = $true)][string]$ResolvedSourceDir,
    [string]$RequestedInstallGlobalSkill
  )

  if ($RequestedInstallGlobalSkill) {
    switch ($RequestedInstallGlobalSkill.Trim().ToLowerInvariant()) {
      "true" { return $true }
      "1" { return $true }
      "yes" { return $true }
      "y" { return $true }
      "false" { return $false }
      "0" { return $false }
      "no" { return $false }
      "n" { return $false }
      default { Fail "Invalid InstallGlobalSkill value: $RequestedInstallGlobalSkill. Use true or false." }
    }
  }

  Write-Host "Project skill source is always kept in: $ResolvedSourceDir" -ForegroundColor Yellow
  $answer = Read-Host "Install skill to global Codex skills directory (~/.codex/skills/$SkillName)? [y/N]"
  if (-not $answer) {
    return $false
  }

  switch -Regex ($answer.Trim().ToLowerInvariant()) {
    "^(y|yes)$" { return $true }
    default { return $false }
  }
}

function Test-SkillAlreadyCurrent {
  param(
    [Parameter(Mandatory = $true)][string]$SourceDir,
    [Parameter(Mandatory = $true)][string]$TargetDir
  )

  $sourceSkill = Join-Path $SourceDir "SKILL.md"
  $targetSkill = Join-Path $TargetDir "SKILL.md"
  if (-not (Test-Path -LiteralPath $sourceSkill) -or -not (Test-Path -LiteralPath $targetSkill)) {
    return $false
  }

  return (Get-FileHash -LiteralPath $sourceSkill).Hash -eq (Get-FileHash -LiteralPath $targetSkill).Hash
}

$resolvedInstallDir = Get-FullPath -PathValue $(if ($InstallDir) { $InstallDir } else { Get-DefaultInstallDir })
$sourceDir = Join-Path $resolvedInstallDir "skills\$SkillName"
$targetRoot = Join-Path $HOME ".codex\skills"
$targetDir = Join-Path $targetRoot $SkillName
$stagedDir = Join-Path $targetRoot (".{0}.new-{1}" -f $SkillName, [guid]::NewGuid().ToString("N"))
$backupDir = Join-Path $targetRoot (".{0}.bak-{1}" -f $SkillName, [guid]::NewGuid().ToString("N"))
$targetMoved = $false

if (-not (Test-Path -LiteralPath $sourceDir)) {
  Fail "Skill source directory not found: $sourceDir"
}

if (-not (Resolve-InstallGlobalSkill -ResolvedSourceDir $sourceDir -RequestedInstallGlobalSkill $InstallGlobalSkill)) {
  Write-Host "Skipped global skill installation." -ForegroundColor Yellow
  exit 0
}

New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null

if ((Test-Path -LiteralPath $targetDir) -and (Test-SkillAlreadyCurrent -SourceDir $sourceDir -TargetDir $targetDir)) {
  Write-Note "Global skill is already current: $targetDir" -Level Success
  exit 0
}

if ((Test-Path -LiteralPath $targetDir) -and -not $Force) {
  Fail "Skill already exists. Re-run with -Force to replace it: $targetDir"
}

try {
  Write-Step "Staging global skill files"
  Copy-Item -LiteralPath $sourceDir -Destination $stagedDir -Recurse -Force

  if (-not (Test-Path -LiteralPath (Join-Path $stagedDir "SKILL.md"))) {
    Fail "Staged skill is missing SKILL.md: $stagedDir"
  }

  if (Test-Path -LiteralPath $targetDir) {
    Assert-PathWithinRoot -RootPath $targetRoot -ChildPath $targetDir
    Move-Item -LiteralPath $targetDir -Destination $backupDir
    $targetMoved = $true
  }

  Move-Item -LiteralPath $stagedDir -Destination $targetDir

  if (-not (Test-Path -LiteralPath (Join-Path $targetDir "SKILL.md"))) {
    Fail "Installed skill is missing SKILL.md: $targetDir"
  }

  if ($targetMoved -and (Test-Path -LiteralPath $backupDir)) {
    Remove-PathIfExists -PathValue $backupDir
  }

  Write-Host "Skill ready: $targetDir" -ForegroundColor Green
} catch {
  if (Test-Path -LiteralPath $stagedDir) {
    Remove-PathIfExists -PathValue $stagedDir
  }

  if ($targetMoved -and (Test-Path -LiteralPath $backupDir)) {
    if (Test-Path -LiteralPath $targetDir) {
      Remove-PathIfExists -PathValue $targetDir
    }

    Move-Item -LiteralPath $backupDir -Destination $targetDir
    Write-Note "Skill install failed. Restored previous global skill." -Level Warn
  }

  throw
}
