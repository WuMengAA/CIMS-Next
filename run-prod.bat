@echo off
setlocal
cd /d "%~dp0"
set ADMIN_PASSWORD=Hiow6OSlpcCqDrx8P4ZdjLGs
set COOKIE_SECURE=true
set ORIGIN=https://www.245959623.xyz
set PUBLIC_SITE_URL=https://www.245959623.xyz
set PORT=8090
set HOST=0.0.0.0
set "LOG=%~dp0stelarith.out.log"
set "NODE=C:\Program Files\nodejs\node.exe"
set "LOADENV=D:\Stelarith\loadenv.cjs"

:loop
echo [%date% %time%] starting stelarith on port %PORT% >> "%LOG%"
"%NODE%" -r "%LOADENV%" "%~dp0build\index.js" >> "%LOG%" 2>&1
set RC=%ERRORLEVEL%
echo [%date% %time%] node exited RC=%RC% >> "%LOG%"
if not "%RC%"=="0" (
  echo [%date% %time%] 启动失败，退避 10 秒后重试 >> "%LOG%"
  timeout /t 10 /nobreak >nul
) else (
  timeout /t 3 /nobreak >nul
)
goto loop
