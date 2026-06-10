# Rungano — Desktop Shell for Higgs Audio v3 TTS

## Domain Language
- **Higgs TTS** — the desktop application described in this repo
- **Higgs Audio v3** — the 4B-parameter TTS model from Boson AI
- **SGLang-Omni** — the inference server (multi-stage omni-model serving)
- **Voice clone / reference** — a short audio clip + transcript that conditions the model's voice
- **Control token** — an inline `<|category:value|>` tag that the model interprets as a directive
- **Preset voice** — a built-in/default voice; may point to a bundled reference audio on disk
- **Custom voice** — user-uploaded reference audio stored under `output/voices/custom/`

## Architecture

Three deep modules in the Python server, mirroring the Koko pattern:
1. **HiggsTTS (`higgs/core.py`)** — small stable interface over the SGLang-Omni OpenAI-compat HTTP API. Owns control-token injection, request body construction, streaming.
2. **VoiceCatalog (`higgs/voices.py`)** — single seam for voice resolution. Presets + custom uploads. Validation lives here; callers never touch the filesystem.
3. **Config (`higgs/config.py`)** — immutable `HiggsConfig` dataclass. Single source of truth for sglang_url, request_timeout, preset_voices. Frozen.

Flask layer is a thin adapter — endpoints map cleanly to the model operations.

Electron main process orchestrates:
- Window lifecycle (close → hide-to-tray)
- System tray with live status indicators
- Subprocess control (SGLang-Omni + Flask proxy)
- Single-instance lock
- First-run shortcut creation
- Health polling (10s interval)

## Design Principles Applied
- **Deep modules earn their keep** — `core.py` hides SGLang-Omni entirely from the renderer
- **Real seams** — Flask is the only Python entry point; renderer talks to it via fetch
- **One place for each concept** — voice resolution lives only in `VoiceCatalog`
- **Stable interface** — `HiggsTTS.synthesize()` / `stream_synthesize()` are the only API surface
- **Configuration concentrated** — `config` is the single source of truth

## Anti-Goals
- Do not become a general-purpose audio editor
- Do not embed LM Studio / LLM dependencies (Koko has them; we don't)
- Do not commit to a single voice model — the adapter pattern lets us swap to vLLM or transformers-loop if SGLang-Omni breaks
- Do not break the offline / self-hosted property — no telemetry, no remote calls beyond optional SGLang-Omni URL

## Tradeoff Notes
- **Electron over Tauri** — chose the larger binary for the faster first-build success rate and reuse of Node toolchain (Win95/WinXP precedent)
- **WSL2 over native Windows** — SGLang-Omni is Linux-first; native Windows install is unsupported
- **Flask proxy over direct SGLang calls from renderer** — gives us a place to add features (history, voice management, rate limiting) without touching the renderer
- **Tray-hide-on-close** — matches the Koko pattern of "always running, dismissable" — appropriate for a tool you use daily
