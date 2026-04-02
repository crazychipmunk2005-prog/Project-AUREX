@echo off
setlocal

set "PY=backend\.venv\Scripts\python.exe"
if not exist "%PY%" (
  echo [ERROR] Missing virtualenv python at %PY%
  exit /b 1
)

if /I "%1"=="demo" (
  set "DEMO_MODE=true"
  echo [INFO] Starting backend in DEMO_MODE=true
) else (
  echo [INFO] Starting backend with DEMO_MODE from environment
)

"%PY%" -m uvicorn backend.main:app --host 127.0.0.1 --port 8001 --reload

endlocal
