@echo off
set ADMIN_PASSWORD=Hiow6OSlpcCqDrx8P4ZdjLGs
set COOKIE_SECURE=true
set ORIGIN=https://www.245959623.xyz
set PUBLIC_SITE_URL=https://www.245959623.xyz
set PORT=8090
set HOST=0.0.0.0
set LOG="%~dp0stelarith.out.log"
:loop
echo [%date% %time%] NODEVER= >> %LOG%
"C:\Program Files\nodejs\node.exe" -v >> %LOG% 2>&1
echo [%date% %time%] starting stelarith on port %PORT% >> %LOG%
"C:\Program Files\nodejs\node.exe" "D:\Stellara\stelarith-website\stelarith\build\index.js" >> %LOG% 2>&1
echo [%date% %time%] node exited RC=%ERRORLEVEL% >> %LOG%
timeout /t 3 /nobreak >nul
goto loop
