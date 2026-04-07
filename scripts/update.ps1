[CmdletBinding()]
param(
  [string]$InstallDir,
  [string]$RepoUrl = "https://github.com/JHJ1848/codex-thread-merge-weak.git",
  [switch]$SkipBuild,
  [switch]$SkipMcp,
  [switch]$SkipSkill,
  [string]$InstallGlobalSkill = "",
  [switch]$SkipPull,
  [string]$LogPath = ""
)

. (Join-Path $PSScriptRoot "common.ps1")

$resolvedInstallDir = Get-FullPath -PathValue $(if ($InstallDir) { $InstallDir } else { Get-DefaultInstallDir })
$installScript = Join-Path $PSScriptRoot "install.ps1"
$powershellPath = (Get-Command powershell.exe -ErrorAction SilentlyContinue).Source
if (-not $powershellPath) {
  $powershellPath = "powershell.exe"
}

$arguments = @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", $installScript,
  "-InstallDir", $resolvedInstallDir,
  "-RepoUrl", $RepoUrl
)

if ($SkipBuild) {
  $arguments += "-SkipBuild"
}
if ($SkipMcp) {
  $arguments += "-SkipMcp"
}
if ($SkipSkill) {
  $arguments += "-SkipSkill"
}
if ($InstallGlobalSkill) {
  $arguments += @("-InstallGlobalSkill", $InstallGlobalSkill)
}
if ($SkipPull) {
  $arguments += "-SkipPull"
}
if ($LogPath) {
  $arguments += @("-LogPath", (Get-FullPath -PathValue $LogPath))
}

Invoke-CheckedCommand -FilePath $powershellPath -Arguments $arguments -FailureMessage "update command failed"
