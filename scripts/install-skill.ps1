[CmdletBinding()]
param(
  [string]$InstallDir,
  [string]$SkillName = "codex-thread-merge-weak",
  [string]$InstallGlobalSkill = "",
  [switch]$Force
)

. (Join-Path $PSScriptRoot "common.ps1")

$resolvedInstallDir = Get-FullPath -PathValue $(if ($InstallDir) { $InstallDir } else { Get-DefaultInstallDir })
$sourceDir = Join-Path $resolvedInstallDir "skills\$SkillName"
$targetRoot = Join-Path $HOME ".codex\skills"
$targetDir = Join-Path $targetRoot $SkillName

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

if (-not (Test-Path -LiteralPath $sourceDir)) {
  Fail "Skill source directory not found: $sourceDir"
}

if (-not (Resolve-InstallGlobalSkill -ResolvedSourceDir $sourceDir -RequestedInstallGlobalSkill $InstallGlobalSkill)) {
  Write-Host "Skipped global skill installation." -ForegroundColor Yellow
  exit 0
}

if ((Test-Path -LiteralPath $targetDir) -and -not $Force) {
  Fail "Skill already exists. Re-run with -Force to replace it: $targetDir"
}

New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null

if (Test-Path -LiteralPath $targetDir) {
  Assert-PathWithinRoot -RootPath $targetRoot -ChildPath $targetDir
  Write-Step "Removing existing skill directory"
  Remove-Item -LiteralPath $targetDir -Recurse -Force
}

Write-Step "Installing skill into $targetRoot"
Copy-Item -LiteralPath $sourceDir -Destination $targetRoot -Recurse -Force

if (-not (Test-Path -LiteralPath (Join-Path $targetDir "SKILL.md"))) {
  Fail "Installed skill is missing SKILL.md: $targetDir"
}

Write-Host "Skill ready: $targetDir" -ForegroundColor Green
