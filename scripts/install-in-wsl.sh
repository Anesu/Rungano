#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
#  Higgs TTS — WSL2 installer
#
#  Installs CUDA toolkit, uv, SGLang, SGLang-Omni, and the Higgs model.
#  Total time: 15-30 min on a clean WSL2 instance.
#
#  Idempotent: safe to re-run.
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail  # note: pipefail disabled below for nvidia-smi/uv pipe calls
# Disable pipefail — SIGPIPE from `nvidia-smi | head` or `uv pip install | tail`
# kills the script on a WSL2 host. This is an idempotent install script, not a
# CI pipeline, so partial pipe failures are harmless.
set +o pipefail

VENV_DIR="$HOME/.higgs-sglang-venv"
MODEL_DIR="$HOME/.cache/huggingface/hub"
LOG="/tmp/higgs-install.log"

log() { echo "[higgs-wsl] $*"; }
fail() { echo "[higgs-wsl] FAIL: $*" | tee -a "$LOG"; exit 1; }

log "Logging to $LOG"
exec > >(tee -a "$LOG") 2>&1

# ── 1. CUDA toolkit check ──────────────────────────────────
log "[1/6] Checking CUDA toolkit in WSL..."
if ! command -v nvcc &> /dev/null; then
  log "Installing CUDA toolkit (this can take a few minutes)..."
  sudo apt-get update
  sudo apt-get install -y python3-pip python3-venv nvidia-cuda-toolkit
fi
nvcc --version || log "WARN: nvcc not on PATH yet (SGLang will use its own bundled CUDA libs)"

# ── 2. nvidia-smi sanity check ──────────────────────────────
log "[2/6] Verifying GPU visibility in WSL..."
if ! nvidia-smi &> /dev/null; then
  fail "nvidia-smi failed. Make sure you have the NVIDIA Windows driver + WSL2 installed. See https://learn.microsoft.com/en-us/windows/ai/directml/gpu-cuda-in-wsl"
fi
nvidia-smi | head -10

# ── 3. uv (fast Python package manager) ────────────────────
log "[3/6] Ensuring uv is installed..."
if ! command -v uv &> /dev/null; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
  # shellcheck disable=SC1091
  source "$HOME/.local/bin/env"
fi
uv --version

# ── 4. Python venv + SGLang-Omni ──────────────────────────
log "[4/6] Creating venv at $VENV_DIR (or reusing)..."
if [ ! -d "$VENV_DIR" ]; then
  uv venv --python 3.11 "$VENV_DIR"
fi
# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

log "[5/6] Installing SGLang + SGLang-Omni (source install — this is the slow part)..."
SGLANG_OMNI_DIR="$HOME/sglang-omni"
if [ ! -d "$SGLANG_OMNI_DIR" ]; then
  git clone https://github.com/sgl-project/sglang-omni.git "$SGLANG_OMNI_DIR"
fi
cd "$SGLANG_OMNI_DIR"
git pull --ff-only 2>/dev/null || true

# SGLang-Omni's setup is non-trivial. We install SGLang first (core only —
# the [all] extra pulls in flashinfer/xformers/sgl-kernel which balloon the
# dependency graph to hundreds of packages and can hang uv's resolver for
# 10+ minutes). SGLang-Omni's own install will pull in what it actually needs.
uv pip install --upgrade pip setuptools wheel
log "Installing sglang (core)..."
uv pip install "sglang" 2>&1 | tail -20 || log "WARN: sglang core install had errors — continuing"
log "Installing sglang-omni from source..."
uv pip install -v -e . 2>&1 | tail -30 || log "WARN: sglang-omni install had errors"

# Sanity: the CLI should now be available
if ! command -v sgl-omni &> /dev/null; then
  fail "sgl-omni CLI not found after install. Check $LOG for errors."
fi
log "sgl-omni installed: $(sgl-omni --version 2>&1 | head -1)"

# ── 6. Download the model ─────────────────────────────────
log "[6/6] Downloading Higgs Audio v3 TTS model (~8 GB)..."
python -c "import huggingface_hub" 2>/dev/null || uv pip install "huggingface_hub[cli]"

# Download to the standard HF cache (no --local-dir) so SGLang-Omni can find it
# via --model-path bosonai/higgs-audio-v3-tts-4b without path hacking.
# Kill any stale download locks first.
find "$HOME/.cache/huggingface" -name '*.lock' -path '*higgs*' -delete 2>/dev/null || true

log "Downloading model to HF cache (this is ~8 GB, may take 5-15 min)..."
if huggingface-cli download bosonai/higgs-audio-v3-tts-4b 2>&1 | tail -5; then
  log "Model downloaded successfully."
else
  log "WARN: huggingface-cli download had issues, trying Python fallback..."
  python -c "
from huggingface_hub import snapshot_download
snapshot_download('bosonai/higgs-audio-v3-tts-4b')
print('Model download complete.')
" || log "WARN: model download may be incomplete. Re-run manually: huggingface-cli download bosonai/higgs-audio-v3-tts-4b"
fi

log ""
log "════════════════════════════════════════"
log "  WSL install complete!"
log "════════════════════════════════════════"
log ""
log "Test SGLang-Omni directly:"
log "  source $VENV_DIR/bin/activate"
log "  sgl-omni serve --model-path bosonai/higgs-audio-v3-tts-4b --port 8000"
log ""
log "Then in another shell, from Windows:"
log "  curl -X POST http://127.0.0.1:8000/v1/audio/speech -H 'Content-Type: application/json' -d '{\"input\": \"Hello, world!\"}' --output test.wav"
log ""
