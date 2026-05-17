@echo off
title Caustic Lens Designer

echo Starting backend...
start "Backend" cmd /k "cd /d %~dp0backend && .venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8001 --log-level info"

echo Waiting for backend...
timeout /t 3 /nobreak >nul

echo Starting frontend...
start "Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo Waiting for frontend...
timeout /t 4 /nobreak >nul

echo Opening browser...
start http://localhost:5173

echo Done. Close this window to keep servers running.
