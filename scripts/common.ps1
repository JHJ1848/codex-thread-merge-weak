Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$PSDefaultParameterValues["Out-File:Encoding"] = "utf8"
$PSDefaultParameterValues["Set-Content:Encoding"] = "utf8"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

$script:InstallLogPath = $null

function Set-InstallLogPath {
  param([string]$Path)

  if (-not $Path) {
    return
  }

  $resolvedPath = [System.IO.Path]::GetFullPath($Path)
  $parent = Split-Path -Parent $resolvedPath
  if ($parent) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }

  $script:InstallLogPath = $resolvedPath
  if (-not (Test-Path -LiteralPath $script:InstallLogPath)) {
    New-Item -ItemType File -Path $script:InstallLogPath -Force | Out-Null
  }
}

function Get-DefaultLogPath {
  return (Join-Path $env:TEMP "codex-thread-merge-weak-install.log")
}

function Write-Log {
  param([Parameter(Mandatory = $true)][string]$Message)

  if (-not $script:InstallLogPath) {
    return
  }

  Add-Content -LiteralPath $script:InstallLogPath -Value ("[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message)
}

function Write-Phase {
  param(
    [Parameter(Mandatory = $true)][int]$Current,
    [Parameter(Mandatory = $true)][int]$Total,
    [Parameter(Mandatory = $true)][string]$Message,
    [ValidateSet("active", "done", "warn", "error")][string]$State = "active"
  )

  $filled = [Math]::Max([Math]::Min($Current, $Total), 0)
  $empty = [Math]::Max($Total - $filled, 0)
  $bar = ("#" * $filled) + ("." * $empty)
  $color = switch ($State) {
    "done" { "Green" }
    "warn" { "Yellow" }
    "error" { "Red" }
    default { "Cyan" }
  }

  $line = "[{0}] [{1}/{2}] {3}" -f $bar, $Current, $Total, $Message
  Write-Host $line -ForegroundColor $color
  Write-Log $line
}

function Write-Step {
  param([Parameter(Mandatory = $true)][string]$Message)

  Write-Host "==> $Message" -ForegroundColor Cyan
  Write-Log "STEP: $Message"
}

function Write-Note {
  param(
    [Parameter(Mandatory = $true)][string]$Message,
    [ValidateSet("Info", "Warn", "Error", "Success")][string]$Level = "Info"
  )

  $color = switch ($Level) {
    "Warn" { "Yellow" }
    "Error" { "Red" }
    "Success" { "Green" }
    default { "Gray" }
  }

  Write-Host $Message -ForegroundColor $color
  Write-Log "${Level}: $Message"
}

function Fail {
  param([Parameter(Mandatory = $true)][string]$Message)

  Write-Log "ERROR: $Message"
  throw $Message
}

function Assert-Command {
  param([Parameter(Mandatory = $true)][string]$Name)

  if (-not (Get-Command -Name $Name -ErrorAction SilentlyContinue)) {
    Fail "Required command not found: $Name"
  }
}

function ConvertTo-ProcessArgumentString {
  param([string[]]$ProcessArguments)

  $escaped = foreach ($arg in $ProcessArguments) {
    if ($null -eq $arg -or $arg -eq "") {
      '""'
      continue
    }

    if ($arg -notmatch '[\s"]') {
      $arg
      continue
    }

    $value = $arg -replace '(\\*)"', '$1$1\"'
    $value = $value -replace '(\\+)$', '$1$1'
    '"' + $value + '"'
  }

  return ($escaped -join " ")
}

function Resolve-ExternalCommand {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$Arguments = @()
  )

  $resolvedCommand = $FilePath
  $resolvedArguments = @($Arguments)
  $commandInfo = Get-Command -Name $FilePath -ErrorAction SilentlyContinue
  if ($commandInfo -and $commandInfo.Source) {
    $resolvedCommand = $commandInfo.Source
  }

  if ($commandInfo -and $commandInfo.CommandType -eq "ExternalScript" -and $resolvedCommand.EndsWith(".ps1", [System.StringComparison]::OrdinalIgnoreCase)) {
    $resolvedArguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $resolvedCommand) + $resolvedArguments
    $resolvedCommand = "powershell.exe"
  }

  return [pscustomobject]@{
    Command = $resolvedCommand
    Arguments = $resolvedArguments
  }
}

function Invoke-CapturedCommand {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$Arguments = @()
  )

  $resolved = Resolve-ExternalCommand -FilePath $FilePath -Arguments $Arguments

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $resolved.Command
  $startInfo.Arguments = ConvertTo-ProcessArgumentString -ProcessArguments $resolved.Arguments
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  [void]$process.Start()

  $standardOutput = $process.StandardOutput.ReadToEnd()
  $standardError = $process.StandardError.ReadToEnd()
  $process.WaitForExit()

  return [pscustomobject]@{
    ExitCode = $process.ExitCode
    StdOut = $standardOutput
    StdErr = $standardError
    ResolvedCommand = $resolved.Command
    ResolvedArguments = $resolved.Arguments
  }
}

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$Arguments = @(),
    [Parameter(Mandatory = $true)][string]$FailureMessage,
    [int]$MaxAttempts = 1,
    [int]$RetryDelaySec = 2
  )

  $attempt = 0
  $lastExitCode = 0

  while ($attempt -lt $MaxAttempts) {
    $attempt += 1
    $resolved = Resolve-ExternalCommand -FilePath $FilePath -Arguments $Arguments
    $resolvedCommand = $resolved.Command
    $resolvedArguments = $resolved.Arguments

    $commandText = $resolvedCommand
    if ($resolvedArguments.Count -gt 0) {
      $commandText += " " + (($resolvedArguments | ForEach-Object { $_.ToString() }) -join " ")
    }
    Write-Log "CMD[$attempt/$MaxAttempts]: $commandText"

    $result = Invoke-CapturedCommand -FilePath $FilePath -Arguments $Arguments
    $standardOutput = $result.StdOut
    $standardError = $result.StdErr
    $lastExitCode = $result.ExitCode

    if ($script:InstallLogPath) {
      if ($standardOutput) {
        Add-Content -LiteralPath $script:InstallLogPath -Value $standardOutput
      }
      if ($standardError) {
        Add-Content -LiteralPath $script:InstallLogPath -Value $standardError
      }
    } else {
      if ($standardOutput) {
        Write-Host $standardOutput -NoNewline
      }
      if ($standardError) {
        Write-Host $standardError -ForegroundColor DarkYellow -NoNewline
      }
    }

    if ($lastExitCode -eq 0) {
      return
    }

    if ($attempt -lt $MaxAttempts) {
      Write-Note "Command failed, retrying ($attempt/$MaxAttempts): $FailureMessage" -Level Warn
      Start-Sleep -Seconds $RetryDelaySec
    }
  }

  $suffix = if ($script:InstallLogPath) { " See log: $script:InstallLogPath" } else { "" }
  Fail "$FailureMessage (exit code $lastExitCode).$suffix"
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

  $result = Invoke-CapturedCommand -FilePath "git" -Arguments @("-C", $RepoDir, "config", "--get", "remote.origin.url")
  if ($result.ExitCode -ne 0) {
    return $null
  }

  return (($result.StdOut -split "`r?`n" | Select-Object -First 1).Trim())
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

function Test-ManagedGitRepo {
  param([Parameter(Mandatory = $true)][string]$RepoDir)

  return (Test-Path -LiteralPath (Join-Path $RepoDir ".git"))
}

function Get-GitWorkingTreeState {
  param([Parameter(Mandatory = $true)][string]$RepoDir)

  $result = Invoke-CapturedCommand -FilePath "git" -Arguments @("-C", $RepoDir, "status", "--porcelain")
  if ($result.ExitCode -ne 0) {
    Fail "Failed to inspect working tree: $RepoDir"
  }

  $statusLines = $result.StdOut -split "`r?`n"
  $entries = @()
  foreach ($line in $statusLines) {
    if ([string]::IsNullOrWhiteSpace($line)) {
      continue
    }

    $pathText = ""
    if ($line.Length -ge 4) {
      $pathText = $line.Substring(3).Trim()
    }

    $normalizedPath = $pathText.Replace("\", "/")
    $isAutoHealable = $false
    if (
      $normalizedPath -eq "package-lock.json" -or
      $normalizedPath.StartsWith("dist/", [System.StringComparison]::OrdinalIgnoreCase) -or
      $normalizedPath.StartsWith("node_modules/", [System.StringComparison]::OrdinalIgnoreCase)
    ) {
      $isAutoHealable = $true
    }

    if ($normalizedPath.Contains(" -> ")) {
      $isAutoHealable = $false
    }

    $entries += [pscustomobject]@{
      Raw = $line
      Path = $pathText
      NormalizedPath = $normalizedPath
      IsAutoHealable = $isAutoHealable
    }
  }

  return [pscustomobject]@{
    IsClean = ($entries.Count -eq 0)
    IsAutoHealable = ($entries.Count -gt 0 -and @($entries | Where-Object { -not $_.IsAutoHealable }).Count -eq 0)
    Entries = $entries
  }
}

function Assert-CleanWorkingTree {
  param([Parameter(Mandatory = $true)][string]$RepoDir)

  $state = Get-GitWorkingTreeState -RepoDir $RepoDir
  if (-not $state.IsClean) {
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

function New-TemporaryDirectory {
  param(
    [string]$Prefix = "codex-thread-merge-weak"
  )

  $path = Join-Path $env:TEMP ("{0}-{1}" -f $Prefix, [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $path -Force | Out-Null
  return $path
}

function Remove-PathIfExists {
  param([Parameter(Mandatory = $true)][string]$PathValue)

  if (Test-Path -LiteralPath $PathValue) {
    Remove-Item -LiteralPath $PathValue -Recurse -Force
  }
}

function Test-DirectoryEmpty {
  param([Parameter(Mandatory = $true)][string]$PathValue)

  if (-not (Test-Path -LiteralPath $PathValue)) {
    return $true
  }

  return @((Get-ChildItem -LiteralPath $PathValue -Force | Select-Object -First 1)).Count -eq 0
}

function Get-CodexCommand {
  if (Get-Command -Name "codex.cmd" -ErrorAction SilentlyContinue) {
    return "codex.cmd"
  }

  if (Get-Command -Name "codex" -ErrorAction SilentlyContinue) {
    return "codex"
  }

  Fail "Required command not found: codex"
}

function Get-McpServerConfigJson {
  param([Parameter(Mandatory = $true)][string]$ServerName)

  $codexCommand = Get-CodexCommand
  $result = Invoke-CapturedCommand -FilePath $codexCommand -Arguments @("mcp", "get", $ServerName, "--json")
  if ($result.ExitCode -ne 0) {
    return $null
  }

  return $result.StdOut.Trim()
}

function Remove-McpServerIfExists {
  param([Parameter(Mandatory = $true)][string]$ServerName)

  $codexCommand = Get-CodexCommand
  $existing = Get-McpServerConfigJson -ServerName $ServerName
  if (-not $existing) {
    return $false
  }

  Invoke-CheckedCommand -FilePath $codexCommand -Arguments @("mcp", "remove", $ServerName) -FailureMessage "Failed to remove MCP registration"
  return $true
}

function Restore-McpServerFromJson {
  param([Parameter(Mandatory = $true)][string]$ConfigJson)

  $config = $ConfigJson | ConvertFrom-Json
  $codexCommand = Get-CodexCommand
  $arguments = @("mcp", "add", $config.name)

  if ($config.transport.env) {
    foreach ($property in $config.transport.env.PSObject.Properties) {
      $arguments += @("--env", ("{0}={1}" -f $property.Name, [string]$property.Value))
    }
  }

  $arguments += "--"
  $arguments += [string]$config.transport.command
  foreach ($arg in $config.transport.args) {
    $arguments += [string]$arg
  }

  Invoke-CheckedCommand -FilePath $codexCommand -Arguments $arguments -FailureMessage "Failed to restore MCP registration"
}

function Move-InstalledDirectoryWithBackup {
  param(
    [Parameter(Mandatory = $true)][string]$SourceDir,
    [Parameter(Mandatory = $true)][string]$TargetDir,
    [string]$BackupDir
  )

  $parentDir = Split-Path -Parent $TargetDir
  if ($parentDir) {
    New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
  }

  if ($BackupDir -and (Test-Path -LiteralPath $TargetDir)) {
    Move-Item -LiteralPath $TargetDir -Destination $BackupDir
  }

  Move-Item -LiteralPath $SourceDir -Destination $TargetDir
}
