@echo off
REM ===========================================================================
REM  Stelarith site backup entry point.
REM
REM  Plain ASCII + CRLF on purpose: cmd decodes this file under the system code
REM  page, so a UTF-8 comment becomes GBK and a trailing half-character swallows
REM  the next line (which then runs as a bogus command).
REM
REM  usage:
REM    backup.bat                 run a backup right now
REM    backup.bat --plan          show what would happen, write nothing
REM    backup.bat --verify <f>    verify one encrypted snapshot
REM    backup.bat --restore <f>   restore drill (writes to a temp dir, no data touched)
REM    backup.bat --install-task  create the daily 03:00 scheduled task
REM    backup.bat --uninstall-task  remove it
REM ===========================================================================
setlocal
cd /d "%~dp0.."

set "NODEXE=C:\Program Files\nodejs\node.exe"
if exist "%NODEXE%" goto :haveNode
set "NODEXE=node"
:haveNode

if /i "%~1"=="--install-task" goto :installTask
if /i "%~1"=="--uninstall-task" goto :uninstallTask

"%NODEXE%" scripts\backup-db.mjs %2 %3
exit /b %errorlevel%

:installTask
set "TASKNAME=StelarithBackup"
set "CMD=%~f0"
schtasks /create /tn "%TASKNAME%" /tr "\"%CMD%\"" /sc daily /st 03:00 /f
if errorlevel 1 (
  echo.
  echo FAILED. Run this from an elevated shell (Run as administrator).
  exit /b 1
)
echo.
echo Scheduled task "%TASKNAME%" created: daily at 03:00.
echo Test it immediately with:  schtasks /run /tn "%TASKNAME%"
echo Its output goes nowhere by default - it has to be captured. Prefer running
echo this script by hand from a console first and reading the output.
exit /b 0

:uninstallTask
schtasks /delete /tn "StelarithBackup" /f
exit /b %errorlevel%
