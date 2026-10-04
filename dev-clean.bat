@echo off
REM ==========================================================================
REM  RETIRED 2026-09-26 - use run-dev.bat instead.
REM  This file now only forwards, so existing shortcuts / pinned tasks keep working.
REM
REM  Why it was retired:
REM    1) It ran `pnpm dev`, and the pnpm entry point on this machine is broken
REM       (corepack path resolves to D:\c\Users\... -> MODULE_NOT_FOUND),
REM       so it could never actually start vite.
REM    2) It defaulted to port 8090 and taskkill-ed whatever held that port -
REM       and 8090 is PRODUCTION. Running the dev script could take the live
REM       site down. The new launcher only ever touches 8091.
REM    3) Its name encoded what it does (clean) rather than what it is, so the
REM       production counterpart could not be derived from it by analogy.
REM ==========================================================================
call "%~dp0run-dev.bat" %*
exit /b %ERRORLEVEL%
