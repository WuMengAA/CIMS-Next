@echo off
setlocal
cd /d "%~dp0"

REM ==========================================================================
REM  Stelarith website - DEV launcher (port 8091)
REM
REM  Division of labour with run-prod.bat:
REM    run-prod.bat   serves build/ (pre-built)  data: content/ + uploads/   port 8090
REM    run-dev.bat    runs vite dev (HMR)        data: .dev-data/            port 8091
REM
REM  Because port and data root both differ, the two CAN RUN AT THE SAME TIME.
REM  That is the whole point: editing a schema or wiping a table while developing
REM  must never reach production data.
REM
REM  Naming rule (docs/architecture review 5.6): environments are only
REM  prod|dev|preview, and every launcher is named run-<env>.bat.
REM  The old name dev-clean.bat is retired - it encoded *what it does* (clean)
REM  instead of *what it is*, so the prod counterpart could not be derived from
REM  it by analogy, and a third spelling (start-website.ps1) grew in the repo.
REM
REM  WARNING: keep this file ASCII-only and CRLF. Same reason as run-prod.bat:
REM  a UTF-8 comment is decoded as GBK under the system code page, and a trailing
REM  half-character swallows the next line, which then executes as a command.
REM
REM  WARNING: deliberately does NOT go through pnpm. The pnpm entry point on this
REM  machine is broken (corepack path resolves to D:\c\Users\... -> MODULE_NOT_FOUND),
REM  which is why the previous dev-clean.bat could never actually start vite.
REM  Calling node + node_modules\vite\bin\vite.js directly removes that middleman.
REM ==========================================================================

REM --- release only the DEV port. 8090 belongs to production and is never touched ---
for /f "tokens=5" %%p in ('netstat -ano -p tcp ^| findstr /r /c:":8091 .*LISTENING"') do (
  echo [dev] releasing stale listener pid=%%p on port 8091
  taskkill /f /pid %%p >nul 2>&1
)

REM --- resolve node.exe: system install first, managed runtime as fallback ---
set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-2\node.exe"
if not exist "%NODE%" (
  echo [dev] FATAL node.exe not found
  exit /b 1
)

set "VITE=%~dp0node_modules\vite\bin\vite.js"
if not exist "%VITE%" (
  echo [dev] FATAL vite not found: %VITE%
  echo [dev] install dependencies first ^(npm install^)
  exit /b 1
)

REM --- .env.dev is loaded automatically by vite because --mode dev is passed.
REM     It overrides .env key by key, so .env keeps owning all the shared values
REM     (CIMS_* / VOICEHUB_* / R2_* ...) and this file only carries the deltas ---
echo [dev] starting vite dev on http://localhost:8091
echo [dev] data root = .dev-data   ^(production on 8090 is NOT touched^)
echo.

"%NODE%" "%VITE%" dev --mode dev --port 8091
set "RC=%ERRORLEVEL%"
echo.
echo [dev] vite exited RC=%RC%
exit /b %RC%
