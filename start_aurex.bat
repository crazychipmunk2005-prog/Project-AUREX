@echo off
echo ========================================
echo  AUREX - Starting...
echo ========================================
echo.

cd /d "%~dp0"

echo Starting frontend on port 5173...
start "AUREX Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo Starting backend on port 8000...
start "AUREX Backend" cmd /k "cd /d %~dp0 && python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000"

echo.
echo Waiting for servers to start...
timeout /t 5 /nobreak >nul

start http://localhost:5173

echo Done! If page doesn't load, check the opened windows for errors.
pause
