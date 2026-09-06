@echo off
setlocal
REM dev-clean.bat - free the dev port then start pnpm dev
REM usage: dev-clean.bat [port]   (default 8090)
set "PORT=%1"
if "%PORT%"=="" set "PORT=8090"

echo [dev-clean] Freeing port %PORT% ...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
    echo [dev-clean]   killing PID %%a on port %PORT%
    taskkill /PID %%a /F >nul 2>&1
)

REM also clear the common bumped port so a stale dev does not linger on 8091
if "%PORT%"=="8090" (
    echo [dev-clean] Freeing bumped port 8091 ...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8091 " ^| findstr "LISTENING"') do (
        echo [dev-clean]   killing PID %%a on port 8091
        taskkill /PID %%a /F >nul 2>&1
    )
)

timeout /t 1 >nul
echo [dev-clean] Starting pnpm dev on port %PORT% ...
pnpm dev
