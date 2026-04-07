@echo off
setlocal EnableExtensions EnableDelayedExpansion

for /F %%e in ('echo prompt $E^| cmd') do set "ESC=%%e"

set "SCRIPT_DIR=%~dp0"
set "INSTALL_PS1=%SCRIPT_DIR%install.ps1"
set "REMOTE_INSTALL_PS1=https://raw.githubusercontent.com/JHJ1848/codex-thread-merge-weak/main/scripts/install.ps1"

call :print active "[#.....] Preparing installer bootstrap"

if not exist "%INSTALL_PS1%" (
  set "INSTALL_PS1=%TEMP%\ctm-install.ps1"
  where curl.exe >nul 2>nul
  if not errorlevel 1 (
    call :print active "[##....] Downloading installer with curl"
    curl.exe --retry 3 --retry-delay 1 -fsSL -o "!INSTALL_PS1!" "%REMOTE_INSTALL_PS1%"
    if errorlevel 1 (
      del /q "!INSTALL_PS1!" >nul 2>nul
      call :print warn "[##....] curl failed, switching to PowerShell download"
      powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing -Uri '%REMOTE_INSTALL_PS1%' -OutFile '!INSTALL_PS1!'"
      if errorlevel 1 exit /b !ERRORLEVEL!
    )
  ) else (
    call :print warn "[##....] curl.exe not found, using PowerShell download"
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing -Uri '%REMOTE_INSTALL_PS1%' -OutFile '!INSTALL_PS1!'"
    if errorlevel 1 exit /b !ERRORLEVEL!
  )
) else (
  call :print done "[##....] Using bundled PowerShell installer"
)

call :print done "[###...] Bootstrap ready"
call :print active "[###...] Starting transactional installer"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%INSTALL_PS1%" %*
exit /b %ERRORLEVEL%

:print
set "STATE=%~1"
set "TEXT=%~2"
set "COLOR="

if /I "%STATE%"=="done" set "COLOR=92"
if /I "%STATE%"=="warn" set "COLOR=93"
if /I "%STATE%"=="error" set "COLOR=91"
if /I "%STATE%"=="active" set "COLOR=96"

if defined ESC if defined COLOR (
  <nul set /p "=!ESC![!COLOR!m%TEXT%!ESC![0m"
  echo.
) else (
  echo %TEXT%
)

exit /b 0
