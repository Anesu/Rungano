# Rungano — Desktop Shell for Higgs Audio v3 TTS

## Domain Language
- **Rungano** — the desktop application described in this repo
- **Higgs Audio v3** — the 4B-parameter TTS model from Boson AI
- **SGLang-Omni** — the inference server (multi-stage omni-model serving)
- **Voice clone / reference** — a short audio clip + transcript that conditions the model's voice
- **Control token** — an inline `<|category:value|>` tag that the model interprets as a directive
- **Preset voice** — a built-in/default voice; may point to a bundled reference audio on disk
- **Custom voice** — user-uploaded reference audio stored under `voices/<language>/<name>/`
- **Session / run** — one 'Synthesise' click; every sentence it produces shares a `run_id` in its history metadata

## Architecture

Three deep modules in the Python server, mirroring the Koko pattern:
1. **HiggsTTS (`higgs/core.py`)** — small stable interface over the SGLang-Omni OpenAI-compat HTTP API. Owns control-token injection, request body construction, streaming.
2. **VoiceCatalog (`higgs/voices.py`)** — single seam for voice resolution. Presets + custom uploads. Validation lives here; callers never touch the filesystem.
3. **Config (`higgs/config.py`)** — immutable `HiggsConfig` dataclass. Single source of truth for sglang_url, request_timeout, preset_voices. Frozen.

Four supporting modules with real seams:
4. **TextChunker (`higgs/text.py`)** — sentence segmentation via spaCy (regex fallback). Interface: `chunk(text) → list[str]`.
5. **HistoryStore (`higgs/history.py`)** — CRUD over date-organized output directories. Owns the `output/YYYY-MM-DD/HHMMSS-id.{wav,json}` path scheme. Public path methods (`resolve_path`, `make_output_path`) so callers never walk the filesystem directly. Sessions group by `run_id` (one per synthesis request), with a minute-prefix fallback for legacy entries.
6. **SystemInfo (`higgs/system.py`)** — stateless GPU query + WSL path translation.
7. **Audio (`higgs/audio.py`)** — WAV post-processing: gain, silence, concatenation, silence trimming.

Flask layer is a thin adapter — endpoints map cleanly to the model operations. Shared synthesis pipeline (`_iter_synthesize_sentences`) eliminates duplication between batch and streaming endpoints.

Electron main process orchestrates:
- Window lifecycle (close → hide-to-tray)
- System tray with live status indicators
- Subprocess control (SGLang-Omni + Flask proxy)
- Single-instance lock
- First-run shortcut creation
- Health polling (10s interval) → pushes to renderer via IPC (single source, two consumers: tray + UI)

Renderer is split into ES modules with one concern per file:
- `state.js` — shared state, DOM refs, label mappings
- `synthesis.js` — SSE streaming engine + progress (deepest renderer module)
- `chips.js` — control-token chip UI (fetches catalogue, builds dynamically)
- `playlist.js` — sentence DOM rendering, click-to-play, download, shared `writeM3u` (the one place .m3u files are built)
- `voices.js` — voice dropdown + clone modal + upload flow
- `sessions.js` — recent-history cards: play (.m3u in system player), export, folder
- `settings.js` — model parameters modal + localStorage persistence
- `health.js` — IPC-driven traffic-light status
- `theme.js` — light/dark toggle with system detection
- `api.js` / `toast.js` / `dragdrop.js` — small shared utilities
- `app.js` — thin orchestrator: imports modules, wires DOM events (~150 lines)

## Paths (dev vs packaged)
Electron `main.js` resolves three roots that coincide in a dev checkout and diverge when packaged:
- **APP_ROOT** — bundled app code (`app.asar`): `renderer/`
- **RES_ROOT** — real on-disk files (`process.resourcesPath`): `server/`, `scripts/`
- **DATA_ROOT** — user-writable data: `output/`, `voices/` (`Documents\Rungano` when packaged)

The Flask server receives `HIGGS_OUTPUT_DIR` and `HIGGS_VOICES_DIR` from Electron; its own defaults (repo-relative) only apply when run standalone.

## Testing
`npm test` runs the pytest suite in `server/tests/` (50 tests): pure-module coverage (audio, text, history, voices, core) plus Flask endpoint tests against a `FakeTTS`. No GPU or SGLang needed. Dev deps: `server/requirements-dev.txt`.

## Design Principles Applied
- **Deep modules earn their keep** — `core.py` hides SGLang-Omni entirely from the renderer
- **Real seams** — Flask is the only Python entry point; renderer talks to it via fetch
- **One place for each concept** — voice resolution lives only in `VoiceCatalog`
- **Stable interface** — `HiggsTTS.synthesize()` is the only API surface
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
