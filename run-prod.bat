@echo off
setlocal
cd /d "%~dp0"

REM ==========================================================================
REM  Stelarith website - production launcher (port 8090)
REM  Called by scheduled task "StelarithServer", trigger At startup, run as SYSTEM.
REM  Every project path is derived from this script's own folder, so the
REM  launcher survives container moves such as Stellara to Stelarith.
REM  Keep this file CRLF and free of characters that cmd treats as operators.
REM ==========================================================================

REM --- production env overrides. These must be set BEFORE the .env loader runs:
REM     loadenv.cjs only fills variables that are still undefined, so whatever
REM     is set here wins over .env ---
set ADMIN_PASSWORD=Hiow6OSlpcCqDrx8P4ZdjLGs
set COOKIE_SECURE=true
set ORIGIN=https://www.245959623.xyz
set PUBLIC_SITE_URL=https://www.245959623.xyz
set PORT=8090
set HOST=0.0.0.0

set "LOG=%~dp0stelarith.out.log"
set "ENTRY=%~dp0build\index.js"

REM --- runtime .env loader: adapter-node never reads .env at runtime while
REM     dynamic private env snapshots process.env at boot, so without this the
REM     CIMS_MANAGEMENT_URL and VOICEHUB variables would be missing ---
set "LOADENV=D:\Stelarith\loadenv.cjs"
if not exist "%LOADENV%" set "LOADENV="

REM --- resolve node.exe: system install first, managed runtime as fallback ---
set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-2\node.exe"
if not exist "%NODE%" (
  echo [%date% %time%] FATAL node.exe not found, aborting >> "%LOG%"
  exit /b 1
)
if not exist "%ENTRY%" (
  echo [%date% %time%] FATAL entry not found: %ENTRY% >> "%LOG%"
  exit /b 1
)

echo [%date% %time%] launcher up - node=%NODE% - entry=%ENTRY% - env=%LOADENV% >> "%LOG%"

:loop
echo [%date% %time%] starting stelarith on port %PORT% >> "%LOG%"

REM --- release a stale listener on the target port first. Without this a node
REM     left behind by a manual run makes every attempt fail on EADDRINUSE and
REM     the loop would spin forever without ever recovering the port ---
for /f "tokens=5" %%p in ('netstat -ano -p tcp ^| findstr /r /c:":%PORT% .*LISTENING"') do (
  echo [%date% %time%] releasing stale listener pid=%%p on port %PORT% >> "%LOG%"
  taskkill /f /pid %%p >> "%LOG%" 2>&1
  ping -n 3 127.0.0.1 >nul
)

if defined LOADENV (
  "%NODE%" -r "%LOADENV%" "%ENTRY%" >> "%LOG%" 2>&1
) else (
  "%NODE%" "%ENTRY%" >> "%LOG%" 2>&1
)
set RC=%ERRORLEVEL%
echo [%date% %time%] node exited RC=%RC% >> "%LOG%"

REM --- use ping, not timeout: under Task Scheduler there is no console and
REM     timeout fails instantly, which would turn this loop into a busy spin ---
if not "%RC%"=="0" (
  echo [%date% %time%] backoff 10s before restart >> "%LOG%"
  ping -n 11 127.0.0.1 >nul
) else (
  ping -n 4 127.0.0.1 >nul
)
goto loop
