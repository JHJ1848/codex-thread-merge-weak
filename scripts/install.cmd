@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
set "INSTALL_PS1=%SCRIPT_DIR%install.ps1"
set "REMOTE_INSTALL_PS1=https://raw.githubusercontent.com/JHJ1848/codex-thread-merge-weak/main/scripts/install.ps1"

if not exist "%INSTALL_PS1%" (
  set "INSTALL_PS1=%TEMP%\codex-thread-merge-weak-install.ps1"
  where curl.exe >nul 2>nul
  if not errorlevel 1 (
    curl.exe --retry 3 --retry-delay 1 -fsSL -o "!INSTALL_PS1!" "%REMOTE_INSTALL_PS1%"
    if errorlevel 1 (
      del /q "!INSTALL_PS1!" >nul 2>nul
      powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing -Uri '%REMOTE_INSTALL_PS1%' -OutFile '!INSTALL_PS1!'"
      if errorlevel 1 exit /b !ERRORLEVEL!
    )
  ) else (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing -Uri '%REMOTE_INSTALL_PS1%' -OutFile '!INSTALL_PS1!'"
    if errorlevel 1 exit /b !ERRORLEVEL!
  )
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%INSTALL_PS1%" %*
exit /b %ERRORLEVEL%
