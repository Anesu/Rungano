@echo off
REM ─────────────────────────────────────────────────────────────────────
REM  Rungano — Windows host installer.
REM
REM  This handles the Windows-side of the install:
REM    1. Verify Python 3.10+ is on PATH
REM    2. Verify Node.js 18+ is on PATH
REM    3. npm install (Electron + electron-builder)
REM    4. Create the Python venv in server\.venv and install flask + requests
REM    5. Delegate the WSL install to scripts\install-in-wsl.sh
REM
REM  Total install: ~5–10 min on a clean machine.
REM ─────────────────────────────────────────────────────────────────────
setlocal enabledelayedexpansion
cd /d "%~dp0\.."

echo.
echo   ========================================
echo     Rungano — Installer
echo   ========================================
echo.

REM ── 1. Python ──────────────────────────────────────────────
echo [1/5] Checking Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo [higgs] Python not found on PATH. Install Python 3.10+ from https://python.org
    echo        Make sure to tick "Add to PATH" during install.
    pause
    exit /b 1
)
python --version

REM ── 2. Node ───────────────────────────────────────────────
echo.
echo [2/5] Checking Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo [higgs] Node.js not found. Install Node 18+ from https://nodejs.org
    pause
    exit /b 1
)
node --version

REM ── 3. npm install ───────────────────────────────────────
echo.
echo [3/5] Installing Electron + electron-builder (npm)...
if not exist "node_modules" (
    call npm install
    if errorlevel 1 (
        echo [higgs] npm install failed. Check your network and try again.
        pause
        exit /b 1
    )
) else (
    echo [higgs] node_modules already present, skipping.
)

REM ── 4. Python venv ───────────────────────────────────────
echo.
echo [4/5] Setting up Python venv + deps...
if not exist "server\.venv\Scripts\python.exe" (
    python -m venv server\.venv
    if errorlevel 1 (
        echo [higgs] venv creation failed.
        pause
        exit /b 1
    )
)
call server\.venv\Scripts\activate.bat
python -m pip install --upgrade pip
python -m pip install -r server\requirements.txt
if errorlevel 1 (
    echo [higgs] pip install failed.
    pause
    exit /b 1
)

REM ── 5. WSL install (SGLang-Omni) ─────────────────────────
echo.
echo [5/5] Setting up SGLang-Omni in WSL2 (this is the big one)...
echo.
echo This will install CUDA, SGLang, SGLang-Omni, and download the
echo 4B-parameter Higgs model (~8 GB). It can take 15-30 minutes.
echo.
set /p CONTINUE="Continue? [y/N] "
if /i not "%CONTINUE%"=="y" (
    echo Skipping WSL install. You can run scripts\install-in-wsl.sh later.
    goto :finish
)
wsl bash -c "cd $(wslpath '%cd%') && bash scripts/install-in-wsl.sh"
if errorlevel 1 (
    echo.
    echo [higgs] WSL install failed or was cancelled.
    echo         You can re-run with:  wsl bash scripts/install-in-wsl.sh
)

:finish
echo.
echo   ========================================
echo     Rungano — Install complete
echo   ========================================
echo.
echo Run the app:  scripts\launch-higgs.bat
echo Or double-click the desktop shortcut (created on first run).
echo.
pause
endlocal
