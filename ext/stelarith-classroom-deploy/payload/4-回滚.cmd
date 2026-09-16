@echo off
rem ===================================================================
rem  Stelarith CIMS - Classroom Deploy  (step 4: rollback)
rem    -Last            restore the most recent backup
rem    -RestoreSyncOnly only reset the server address config
rem    -RemoveAutoStart drop autostart + desktop shortcuts (keep data)
rem  No argument: list available backups and ask which one.
rem ===================================================================
setlocal
rem cd first, then chcp: a CJK %~dp0 breaks if the codepage changes first.
cd /d "%~dp0"
chcp 65001 >nul 2>&1

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo.
  echo   Administrator privileges required. Re-launching elevated...
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -ArgumentList '%*' -Verb RunAs"
  exit /b
)

set "PS=powershell -NoProfile -ExecutionPolicy Bypass -File"

rem  -RemoveAutoStart is handled by upgrade.ps1
set "SCRIPT=%~dp0scripts\rollback.ps1"
echo %* | findstr /i /c:"-RemoveAutoStart" >nul 2>&1
if %errorlevel% equ 0 set "SCRIPT=%~dp0scripts\upgrade.ps1"

if not exist "%SCRIPT%" (
  echo   [ERROR] script not found.
  pause
  exit /b 1
)

%PS% "%SCRIPT%" %*
set "RC=%errorlevel%"
echo.
echo   ------------------------------------------------------------
echo   Exit code: %RC%
echo   ------------------------------------------------------------
echo.
pause
endlocal
