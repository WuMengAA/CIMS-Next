@echo off
rem Stelarith Cloudflare Tunnel launcher (auto-start via Scheduled Task)
rem NOTE: keep this file pure ASCII + CRLF (no BOM).
rem
rem 2026-09-20: switched to TOKEN mode. Why:
rem   The previous command was
rem     cloudflared tunnel --config <path> run stelarith-local
rem   but that config path died in the Stellara -> Stelarith migration (the
rem   Stelarith-vue project got archived), so cloudflared exited RC=1 in ~0.1s
rem   and the public site returned HTTP 530 (no connector). It had been running
rem   on borrowed time: the tunnel was already up before the path broke.
rem   This tunnel is token-based with REMOTELY MANAGED ingress; its credential is
rem   C:\ProgramData\cloudflared\token, whose payload tunnelId matches the
rem   archived stelarith-local.json (same tunnel). The token is read at runtime
rem   and is NEVER hardcoded in this file.
rem
rem   Also wrapped in a restart loop: the scheduled task's RestartCount only
rem   fires on a NON-ZERO exit, so a clean exit (RC=0, e.g. cloudflared logging
rem   "no more connections active and exiting" during a DNS hiccup) would leave
rem   the tunnel down with nobody to bring it back.
rem   NOTE: D:\Stelarith\_logs must exist - the redirect below fails if it does
rem   not, and the tunnel would silently not start.
setlocal
set "LOGDIR=D:\Stelarith\_logs"
set "LOG=%LOGDIR%\cloudflared.log"
set "RUNLOG=%LOGDIR%\cloudflared-launcher.log"
set "CF=C:\Program Files (x86)\cloudflared\cloudflared.exe"
set "TOKENFILE=C:\ProgramData\cloudflared\token"

if not exist "%LOGDIR%" mkdir "%LOGDIR%"

set "TOKEN="
if exist "%TOKENFILE%" set /p TOKEN=<%TOKENFILE%
if not defined TOKEN (
  echo [%date% %time%] FATAL token file missing or empty >> "%RUNLOG%"
  exit /b 1
)

:loop
echo [%date% %time%] starting cloudflared (token mode) >> "%RUNLOG%"
"%CF%" tunnel --no-autoupdate run --token "%TOKEN%" >> "%LOG%" 2>&1
set "RC=%ERRORLEVEL%"
echo [%date% %time%] cloudflared exited RC=%RC% - backoff 5s before restart >> "%RUNLOG%"
rem Use ping, NOT timeout: under Session 0 there is no console, so timeout fails
rem instantly and this loop would degenerate into a busy spin.
ping -n 6 127.0.0.1 >nul
goto loop
