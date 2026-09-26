@echo off
setlocal
cd /d "%~dp0"

REM ==========================================================================
REM  Stelarith website - production launcher (port 8090)
REM  Called by scheduled task "StelarithServer", trigger At startup, run as SYSTEM.
REM  Every project path is derived from this script's own folder, so the
REM  launcher survives container moves such as Stellara to Stelarith.
REM  Keep this file CRLF, strictly ASCII (a UTF-8 comment is decoded as GBK
REM  under the system code page and a trailing half-character swallows the
REM  next line, which then runs as a bogus command), and free of characters
REM  that cmd treats as operators. Never put a bare ) inside a parenthesised
REM  block - it closes the block early and the whole script stops parsing.
REM ==========================================================================

REM --- production env overrides. These must be set BEFORE the .env loader runs:
REM     loadenv.cjs only fills variables that are still undefined, so whatever
REM     is set here wins over .env ---
REM ADMIN_PASSWORD is deliberately NOT hardcoded here: a plaintext value once
REM leaked with the public repo. The real value lives in the untracked
REM D:\Stelarith\Stelarith-website\stelarith\.env and is injected at startup by
REM D:\Stelarith\loadenv.cjs, which only fills variables that are still undefined.
set COOKIE_SECURE=true
set ORIGIN=https://www.245959623.xyz
set PUBLIC_SITE_URL=https://www.245959623.xyz
set PORT=8090
set HOST=0.0.0.0

REM --- log split (2026-09-20). node inherits an open handle to whatever its
REM     stdout is redirected to, and it lives for hours under Task Scheduler.
REM     When the launcher appended to that SAME file, every redundant 5-minute
REM     trigger died on ERROR_SHARING_VIOLATION (0x80070020, measured) and its
REM     messages were silently lost - the service looked healthy in the log
REM     while the watchdog was actually failing on every single fire.
REM     So: the launcher speaks to its own file, node owns the app log alone ---
set "LOG=%~dp0stelarith-launcher.log"
set "NODELOG=%~dp0stelarith.out.log"
set "ENTRY=%~dp0build\index.js"

REM --- runtime .env loader: adapter-node never reads .env at runtime while
REM     dynamic private env snapshots process.env at boot, so without this the
REM     CIMS_MANAGEMENT_URL and VOICEHUB variables would be missing ---
set "LOADENV=D:\Stelarith\loadenv.cjs"
if not exist "%LOADENV%" set "LOADENV="

REM --- crash guard (2026-09-24). Builds rewrite build/client in place and
REM     sync-console.mjs rewrites the .br/.gz siblings. sirv opens a ReadStream
REM     for a name that existed when it scanned at startup; the file is gone by
REM     now -> the stream emits 'error' with nobody listening -> node aborts the
REM     WHOLE process. Measured: two crash loops in one day (22 and 24 restarts
REM     10s apart = the panel was dead for 3-4 minutes each time). The guard
REM     swallows only that transient class (ENOENT under build/client, plus real
REM     socket aborts) and keeps serving; every other uncaught exception still
REM     exits as before. Behaviour is logged to stelarith-crashguard.log.
REM     A missing guard must degrade to the previous behaviour, never to a boot
REM     failure - so the loader falls back to running without it, loudly. ---
set "GUARD=%~dp0site-crash-guard.cjs"
if not exist "%GUARD%" (
  echo [%date% %time%] WARN crash guard missing: %GUARD% - starting without it >> "%LOG%"
  set "GUARD="
)

REM --- health probe binary. System32 ships curl.exe here; if absent the probe
REM     is skipped and the guard takes the benign branch, so a missing curl can
REM     never turn into a taskkill of a live node ---
set "CURL=%SystemRoot%\System32\curl.exe"
if not exist "%CURL%" set "CURL="

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

REM --- idempotent guard (2026-09-20): the scheduled task carries BOTH a
REM     BootTrigger AND a TimeTrigger repeating every 5 minutes. The repetition
REM     is only meant to resurrect a dead tree; when the service is already
REM     healthy, IgnoreNew is unreliable (measured: extra instances still get
REM     started and then fail on a file-sharing violation). So this launcher
REM     self-guards: if port %PORT% is already LISTENING, this is a redundant
REM     trigger - exit quietly instead of taskkill-ing the healthy instance. ---
set "EXISTING_PID="
for /f "tokens=5" %%p in ('netstat -ano -p tcp ^| findstr /r /c:":%PORT% .*LISTENING"') do set "EXISTING_PID=%%p"
if defined EXISTING_PID (
  call :guard
  if defined SKIP_SERVE exit /b 0
)

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

REM --- assemble the -r preload chain. The guard goes first so its handler is
REM     installed before anything else can throw; loadenv follows because
REM     adapter-node snapshots process.env at boot. Either may be absent, so the
REM     chain is built with `if defined` instead of a fixed command line. ---
set "PRELOAD="
if defined GUARD set "PRELOAD=-r "%GUARD%""
if defined LOADENV set "PRELOAD=%PRELOAD% -r "%LOADENV%""

REM --- node must redirect to the node log, never the launcher log: the
REM     inherited handle is held for the whole lifetime of the process,
REM     which is exactly what locked the shared file before ---
if defined PRELOAD (
  "%NODE%" %PRELOAD% "%ENTRY%" >> "%NODELOG%" 2>&1
) else (
  "%NODE%" "%ENTRY%" >> "%NODELOG%" 2>&1
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

REM --- health probe. Only "port bound but nothing answers HTTP" counts as stuck:
REM     a 5xx still proves the process is alive, and a missing curl leaves STUCK
REM     undefined. Every ambiguous outcome must resolve to leaving the running
REM     service alone - a guard that can kill a live node is worse than none ---
:guard
call :healthcheck
if defined STUCK (
  echo [%date% %time%] port %PORT% held by pid=%EXISTING_PID% but no HTTP answer - %STUCK% - taking over >> "%LOG%"
  goto :eof
)
echo [%date% %time%] port %PORT% already served by pid=%EXISTING_PID% - HTTP=%HTTP_CODE% - redundant trigger, exit >> "%LOG%"
set "SKIP_SERVE=1"
goto :eof

REM --- health probe. capture the code through a temp file instead of for /f:
REM     measured that for /f with a QUOTED executable path in the command string
REM     silently yields nothing, which would have made every healthy service look
REM     dead. Only "port bound but nothing answers HTTP" counts as stuck - a 5xx
REM     still proves the process is alive, and a missing curl leaves STUCK empty
REM     so the caller exits quietly. Ambiguity must always resolve to "leave the
REM     running service alone" ---
:healthcheck
set "STUCK="
set "HTTP_CODE="
if not defined CURL goto :eof
set "HCHK=%~dp0stelarith-health.tmp"
break>"%HCHK%"
"%CURL%" -s -o NUL -w "%%{http_code}" --max-time 6 "http://127.0.0.1:%PORT%/" >"%HCHK%" 2>NUL
set /p HTTP_CODE=<"%HCHK%"
del "%HCHK%" >NUL 2>&1
if not defined HTTP_CODE set "STUCK=no-response"
if "%HTTP_CODE%"=="000" set "STUCK=no-response"
goto :eof
