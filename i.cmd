@echo off
setlocal EnableExtensions EnableDelayedExpansion

for /F %%e in ('echo prompt $E^| cmd') do set "ESC=%%e"

set "SCRIPT_DIR=%~dp0"
set "LOCAL_BOOTSTRAP_PS1=%SCRIPT_DIR%i.ps1"
set "REMOTE_BOOTSTRAP_PS1=https://raw.githubusercontent.com/JHJ1848/codex-thread-merge-weak/main/i.ps1"
set "BOOTSTRAP_PS1="
set "DOWNLOADED_BOOTSTRAP_PS1="

call :print active "[#....] Preparing bootstrap entry"

if exist "%LOCAL_BOOTSTRAP_PS1%" (
  set "BOOTSTRAP_PS1=%LOCAL_BOOTSTRAP_PS1%"
  call :print done "[##...] Using local i.ps1"
) else (
  set "BOOTSTRAP_PS1=%TEMP%\ctm-bootstrap-%RANDOM%%RANDOM%.ps1"
  set "DOWNLOADED_BOOTSTRAP_PS1=!BOOTSTRAP_PS1!"
  where curl.exe >nul 2>nul
  if not errorlevel 1 (
    call :print active "[##...] Downloading i.ps1 with curl"
    curl.exe --retry 3 --retry-delay 1 -fsSL -o "!BOOTSTRAP_PS1!" "%REMOTE_BOOTSTRAP_PS1%"
    if errorlevel 1 (
      del /q "!BOOTSTRAP_PS1!" >nul 2>nul
      call :print warn "[##...] curl failed, switching to PowerShell"
      powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing -Uri '%REMOTE_BOOTSTRAP_PS1%' -OutFile '!BOOTSTRAP_PS1!'"
      if errorlevel 1 exit /b !ERRORLEVEL!
    )
  ) else (
    call :print warn "[##...] curl.exe not found, using PowerShell"
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing -Uri '%REMOTE_BOOTSTRAP_PS1%' -OutFile '!BOOTSTRAP_PS1!'"
    if errorlevel 1 exit /b !ERRORLEVEL!
  )
)

call :print done "[###..] Bootstrap ready"
call :print active "[###..] Starting installer"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%BOOTSTRAP_PS1%" %*
set "EXIT_CODE=%ERRORLEVEL%"

if defined DOWNLOADED_BOOTSTRAP_PS1 del /q "!DOWNLOADED_BOOTSTRAP_PS1!" >nul 2>nul

exit /b %EXIT_CODE%

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
