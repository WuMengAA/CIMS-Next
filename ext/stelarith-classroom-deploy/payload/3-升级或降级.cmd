@echo off
rem ===================================================================
rem  Stelarith CIMS - Classroom Deploy  (step 3: upgrade / downgrade)
rem
rem  Usage (drag-free, from cmd):
rem    3-升级或降级.cmd -From E:\ClassroomDeploy-20261001
rem    3-升级或降级.cmd -From E:\ClassroomDeploy-20261001 -WithApp
rem  Without -From the script prints guidance and exits.
rem ===================================================================
chcp 65001 >nul 2>&1
setlocal
cd /d "%~dp0"

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
  echo     3-升级或降级.cmd -From E:\ClassroomDeploy-20261001
  echo     3-升级或降级.cmd -From E:\ClassroomDeploy-20261001 -WithApp
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
