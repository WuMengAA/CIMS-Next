@echo off
rem ===================================================================
rem  Stelarith CIMS - Classroom Deploy  (step 3: upgrade / downgrade)
rem
rem  Usage (drag-free, from cmd):
rem    this-script.cmd -From E:\ClassroomDeploy-20261001
rem    this-script.cmd -From E:\ClassroomDeploy-20261001 -WithApp
rem  Without -From the script prints guidance and exits.
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
set "SCRIPT=%~dp0scripts\upgrade.ps1"

if not exist "%SCRIPT%" (
  echo   [ERROR] scripts\upgrade.ps1 not found.
  pause
  exit /b 1
)

if "%~1"=="" (
  echo.
  echo   This tool replaces the plugin and/or the ClassIsland app itself.
  echo   You must point it at a NEW deployment package folder.
  echo.
  echo   Examples:
  echo     -From E:\ClassroomDeploy-20261001
  echo     -From E:\ClassroomDeploy-20261001 -WithApp
  echo.
  echo   The data folder (timetable, plugin settings) is never touched.
  echo.
  pause
  exit /b 0
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
