@echo off
echo ============================================
echo   Stop Lushan Web Server
echo ============================================
set PORT=8000
set KILLED=0

for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%PORT% " ^| findstr LISTENING') do (
    echo Killing PID %%a on port %PORT%
    taskkill /F /PID %%a >nul 2>&1
    if not errorlevel 1 set KILLED=1
)

tasklist /FI "IMAGENAME eq python.exe" 2>nul | findstr python.exe >nul
if not errorlevel 1 (
    echo Killing leftover python.exe...
    taskkill /F /IM python.exe /FI "WINDOWTITLE eq *launcher.py*" >nul 2>&1
)

if %KILLED%==0 (
    echo No server running on port %PORT%
) else (
    echo OK - stopped
)
echo.
pause
