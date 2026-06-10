@echo off
REM ─────────────────────────────────────────────────────────────────────
REM  Start SGLang-Omni in WSL2.
REM  Run this BEFORE launching the Electron app.
REM ─────────────────────────────────────────────────────────────────────

echo [higgs-sglang] Killing any process on port 8000...
wsl -d Ubuntu -- bash -c "lsof -ti :8000 | xargs -r kill -9 2>/dev/null; sleep 1; echo done"

echo [higgs-sglang] Starting sgl-omni serve...

wsl -d Ubuntu -- bash -c "source ~/.higgs-sglang-venv/bin/activate && sgl-omni serve --model-path bosonai/higgs-audio-v3-tts-4b --port 8000"
