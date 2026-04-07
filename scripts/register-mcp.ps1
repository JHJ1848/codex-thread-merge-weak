[CmdletBinding()]
param(
  [string]$InstallDir,
  [string]$ServerName = "codex-thread-merge",
  [string]$AppServerCommand,
  [string]$AppServerArgs,
  [switch]$Force
)

. (Join-Path $PSScriptRoot "common.ps1")

function Get-DesiredMcpArguments {
  param(
    [Parameter(Mandatory = $true)][string]$ResolvedServerEntry,
    [string]$ResolvedAppServerCommand,
    [string]$ResolvedAppServerArgs
  )

  $arguments = @("mcp", "add", $ServerName)

  if ($ResolvedAppServerCommand) {
    $arguments += @("--env", "CODEX_APP_SERVER_COMMAND=$ResolvedAppServerCommand")
  }

  if ($ResolvedAppServerArgs) {
    $arguments += @("--env", "CODEX_APP_SERVER_ARGS=$ResolvedAppServerArgs")
  }

  $arguments += @("--", "node", $ResolvedServerEntry)
  return $arguments
}

function Test-McpConfigMatchesDesired {
  param(
    [string]$ExistingConfigJson,
    [Parameter(Mandatory = $true)][string]$ExpectedServerEntry,
    [string]$ExpectedAppServerCommand,
    [string]$ExpectedAppServerArgs
  )

  if (-not $ExistingConfigJson) {
    return $false
  }

  $config = $ExistingConfigJson | ConvertFrom-Json
  if ($config.transport.type -ne "stdio") {
    return $false
  }

  if ([string]$config.transport.command -ne "node") {
    return $false
  }

  $args = @($config.transport.args | ForEach-Object { [string]$_ })
  if ($args.Count -ne 1 -or $args[0] -ne $ExpectedServerEntry) {
    return $false
  }

  $existingEnv = @{}
  if ($config.transport.env) {
    foreach ($property in $config.transport.env.PSObject.Properties) {
      $existingEnv[$property.Name] = [string]$property.Value
    }
  }

  if ($ExpectedAppServerCommand) {
    if ($existingEnv["CODEX_APP_SERVER_COMMAND"] -ne $ExpectedAppServerCommand) {
      return $false
    }
  } elseif ($existingEnv.ContainsKey("CODEX_APP_SERVER_COMMAND")) {
    return $false
  }

  if ($ExpectedAppServerArgs) {
    if ($existingEnv["CODEX_APP_SERVER_ARGS"] -ne $ExpectedAppServerArgs) {
      return $false
    }
  } elseif ($existingEnv.ContainsKey("CODEX_APP_SERVER_ARGS")) {
    return $false
  }

  return $true
}

$resolvedInstallDir = Get-FullPath -PathValue $(if ($InstallDir) { $InstallDir } else { Get-DefaultInstallDir })
$serverEntry = Join-Path $resolvedInstallDir "dist\server\index.js"
$codexCommand = Get-CodexCommand
$previousConfigJson = $null
$registrationUpdated = $false

Assert-Command "node"

if (-not (Test-Path -LiteralPath $serverEntry)) {
  Fail "Built MCP server entry not found. Run npm run build first: $serverEntry"
}

$previousConfigJson = Get-McpServerConfigJson -ServerName $ServerName
if ((Test-McpConfigMatchesDesired -ExistingConfigJson $previousConfigJson -ExpectedServerEntry $serverEntry -ExpectedAppServerCommand $AppServerCommand -ExpectedAppServerArgs $AppServerArgs)) {
  Write-Note "MCP server is already up to date: $ServerName" -Level Success
  exit 0
}

if ($previousConfigJson -and -not $Force) {
  Fail "MCP server '$ServerName' already exists. Re-run with -Force to replace it."
}

try {
  if ($previousConfigJson) {
    Write-Step "Removing existing MCP registration: $ServerName"
    Invoke-CheckedCommand -FilePath $codexCommand -Arguments @("mcp", "remove", $ServerName) -FailureMessage "Failed to remove MCP registration"
  }

  $registrationUpdated = $true
  Write-Step "Registering MCP server: $ServerName"
  $arguments = Get-DesiredMcpArguments -ResolvedServerEntry $serverEntry -ResolvedAppServerCommand $AppServerCommand -ResolvedAppServerArgs $AppServerArgs
  Invoke-CheckedCommand -FilePath $codexCommand -Arguments $arguments -FailureMessage "Failed to register MCP server"

  Write-Step "Verifying MCP registration: $ServerName"
  Invoke-CheckedCommand -FilePath $codexCommand -Arguments @("mcp", "get", $ServerName, "--json") -FailureMessage "Failed to verify MCP registration"

  Write-Host "MCP server ready: $ServerName" -ForegroundColor Green
} catch {
  if ($registrationUpdated -and $previousConfigJson) {
    Write-Note "Registration failed. Restoring previous MCP configuration." -Level Warn
    try {
      Remove-McpServerIfExists -ServerName $ServerName | Out-Null
      Restore-McpServerFromJson -ConfigJson $previousConfigJson
    } catch {
      Fail "$($_.Exception.Message) Rollback failed while restoring previous MCP configuration."
    }
  }

  throw
}
