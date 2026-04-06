[CmdletBinding()]
param(
  [string]$InstallDir,
  [string]$ServerName = "codex-thread-merge",
  [string]$AppServerCommand,
  [string]$AppServerArgs,
  [switch]$Force
)

. (Join-Path $PSScriptRoot "common.ps1")

$resolvedInstallDir = Get-FullPath -PathValue $(if ($InstallDir) { $InstallDir } else { Get-DefaultInstallDir })
$serverEntry = Join-Path $resolvedInstallDir "dist\server\index.js"
$codexCommand = if (Get-Command -Name "codex.cmd" -ErrorAction SilentlyContinue) { "codex.cmd" } else { "codex" }

Assert-Command "codex"
Assert-Command "node"

if (-not (Test-Path -LiteralPath $serverEntry)) {
  Fail "Built MCP server entry not found. Run npm run build first: $serverEntry"
}

$existingConfig = $false
& cmd.exe /d /c "codex mcp get $ServerName --json 1>nul 2>nul"
if ($LASTEXITCODE -eq 0) {
  $existingConfig = $true
}

if ($existingConfig -and -not $Force) {
  Fail "MCP server '$ServerName' already exists. Re-run with -Force to replace it."
}

if ($existingConfig) {
  Write-Step "Removing existing MCP registration: $ServerName"
  Invoke-CheckedCommand -FilePath $codexCommand -Arguments @("mcp", "remove", $ServerName) -FailureMessage "Failed to remove MCP registration"
}

$arguments = @("mcp", "add", $ServerName)

if ($AppServerCommand) {
  $arguments += @("--env", "CODEX_APP_SERVER_COMMAND=$AppServerCommand")
}

if ($AppServerArgs) {
  $arguments += @("--env", "CODEX_APP_SERVER_ARGS=$AppServerArgs")
}

$arguments += @("--", "node", $serverEntry)

Write-Step "Registering MCP server: $ServerName"
Invoke-CheckedCommand -FilePath $codexCommand -Arguments $arguments -FailureMessage "Failed to register MCP server"

Write-Step "Verifying MCP registration: $ServerName"
Invoke-CheckedCommand -FilePath $codexCommand -Arguments @("mcp", "get", $ServerName, "--json") -FailureMessage "Failed to verify MCP registration"

Write-Host "MCP server ready: $ServerName" -ForegroundColor Green
