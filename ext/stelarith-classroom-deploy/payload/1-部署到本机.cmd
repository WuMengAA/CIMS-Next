@echo off
rem ===================================================================
rem  Stelarith CIMS - Classroom Deploy  (step 1: install to this PC)
rem  IMPORTANT: keep this file ASCII-only. Chinese lives in the .ps1
rem  payload (which is shipped as UTF-8 with BOM) and in docs/.
rem ===================================================================
chcp 65001 >nul 2>&1
setlocal
cd /d "%~dp0"

rem ---- self elevate: writing to install dir + startup folder needs admin
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo.
  echo   Administrator privileges required. Re-launching elevated...
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo.
echo   ============================================================
echo     Stelarith CIMS . Classroom Install
echo   ============================================================
echo.

set "PS=powershell -NoProfile -ExecutionPolicy Bypass -File"
set "SCRIPT=%~dp0scripts\deploy.ps1"

if not exist "%SCRIPT%" (
  echo   [ERROR] scripts\deploy.ps1 not found.
  echo           Make sure the whole package was copied from the USB drive.
  echo.
  pause
  exit /b 1
)

%PS% "%SCRIPT%" %*
set "RC=%errorlevel%"

echo.
echo   ------------------------------------------------------------
if "%RC%"=="0" (
  echo   Done.
) else (
  echo   Finished with exit code %RC% - see messages above.
)
echo   ------------------------------------------------------------
echo.
pause
endlocal
