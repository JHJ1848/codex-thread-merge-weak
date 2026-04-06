[CmdletBinding()]
param(
  [string]$InstallDir,
  [string]$SkillName = "codex-thread-merge-weak",
  [switch]$Force
)

. (Join-Path $PSScriptRoot "common.ps1")

$resolvedInstallDir = Get-FullPath -PathValue $(if ($InstallDir) { $InstallDir } else { Get-DefaultInstallDir })
$sourceDir = Join-Path $resolvedInstallDir "skills\$SkillName"
$targetRoot = Join-Path $HOME ".codex\skills"
$targetDir = Join-Path $targetRoot $SkillName

if (-not (Test-Path -LiteralPath $sourceDir)) {
  Fail "Skill source directory not found: $sourceDir"
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
