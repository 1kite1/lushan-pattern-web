@echo off
setlocal
set PY_EXE=

REM --- Find python.exe (no sibling script dependency) ---
if exist "C:\Program Files\QClaw\v0.2.33.395\resources\python\python.exe" (
    set PY_EXE=C:\Program Files\QClaw\v0.2.33.395\resources\python\python.exe
    goto HAVE_PY
)
for %%P in (
    "%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
    "%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
    "%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
    "C:\Python311\python.exe"
    "C:\Python312\python.exe"
    "C:\Python313\python.exe"
) do (
    if not defined PY_EXE (
        if exist "%%~P" set PY_EXE=%%~P
    )
)

:HAVE_PY
if not defined PY_EXE (
    echo ============================================
    echo   Error: python.exe not found
    echo ============================================
    echo   Install Python 3 from python.org
    echo   and check Add Python to PATH.
    pause
    exit /b 1
)

cd /d "%~dp0"

REM --- Guard: refuse to serve a near-empty directory (common WinRAR trap) ---
if not exist index.html (
    echo ============================================
    echo   Error: index.html not found in this dir.
    echo ============================================
    echo   You must extract the FULL zip first.
    echo   Do NOT just double-click start_server.bat
    echo   from inside the zip — that only copies
    echo   the bat and the server has nothing to serve.
    echo.
    echo   Right-click the zip - Extract to folder,
    echo   then double-click start_server.bat inside.
    echo ============================================
    pause
    exit /b 1
)

REM --- Cleanup port 8000 ---
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000 " ^| findstr LISTENING') do (
    taskkill /F /PID %%a >nul 2>&1
)

REM --- Open browser in 1.5s in background (does not block bat) ---
start "" /b powershell -NoProfile -Command "Start-Sleep -Seconds 1.5; Start-Process 'http://127.0.0.1:8000'"

echo ============================================
echo   Lushan Pattern Recognition - Web
echo ============================================
echo   Python: %PY_EXE%
echo   Dir:    %cd%
echo   URL:    http://127.0.0.1:8000/
echo   Close this window to stop the server.
echo ============================================
echo.

REM --- Run built-in HTTP server (foreground, blocks until close) ---
"%PY_EXE%" -m http.server 8000 --bind 127.0.0.1

echo.
echo Server stopped.
pause