@echo off
REM ─────────────────────────────────────────────────────────────────────
REM     Rungano — Shona folktale narrator
REM
REM  Spawns the Electron app, which in turn starts SGLang-Omni (in WSL)
REM  and the Python Flask proxy. The window opens once Flask is ready.
REM
REM  First run: use scripts\install.bat once to set up the venv + model.
REM ─────────────────────────────────────────────────────────────────────
setlocal enabledelayedexpansion
cd /d "%~dp0\.."

if not exist "node_modules" (
    echo [higgs] First run detected — running installer...
    call scripts\install.bat
    if errorlevel 1 (
        echo.
        echo [higgs] Install failed. See output above.
        pause
        exit /b 1
    )
)

if not exist "electron\assets\icon.ico" (
    echo [higgs] WARNING: no icon.ico at electron\assets\. The app will still run.
)

echo.
echo   ========================================
echo     Rungano — launching
echo   ========================================
echo.

REM Launch via npm (so electron is on PATH)
call npm start --silent
if errorlevel 1 (
    echo [higgs] npm start failed. Trying electron directly...
    call npx electron .
)

endlocal
