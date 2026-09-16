@echo off
rem ===================================================================
rem  Stelarith CIMS - Classroom Deploy  (step 2: health check)
rem  Read-only: inspects system, install, process, server, logs.
rem ===================================================================
chcp 65001 >nul 2>&1
setlocal
cd /d "%~dp0"

set "PS=powershell -NoProfile -ExecutionPolicy Bypass -File"
set "SCRIPT=%~dp0scripts\preflight.ps1"

if not exist "%SCRIPT%" (
  echo   [ERROR] scripts\preflight.ps1 not found.
  pause
  exit /b 1
)

%PS% "%SCRIPT%" %*
echo.
echo   ------------------------------------------------------------
echo   Tip: add " -Report check.txt" to save this output to a file.
echo   ------------------------------------------------------------
echo.
pause
endlocal
