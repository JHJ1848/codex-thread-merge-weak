@echo off
setlocal

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0register-mcp.ps1" %*
exit /b %ERRORLEVEL%
