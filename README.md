# Rungano

**A native desktop shell for [Higgs Audio v3 TTS](https://huggingface.co/bosonai/higgs-audio-v3-tts-4b) — multi-language, voice-cloning, emotion/style/SFX control.**

*Rungano* means "folktale" in Shona. Built to faithfully narrate Shona oral storytelling traditions — voice cloning, auto-chunking for long-form narration, and complete control over emotion, style, and sound effects.

![icon](electron/assets/tray-icon.png)

## What this is

Higgs TTS wraps the [SGLang-Omni](https://github.com/sgl-project/sglang-omni)
serving stack in a real desktop application (Electron) with a clean dark UI,
system-tray integration, and a one-click launcher. It exposes the **full**
control surface of the Higgs v3 model:

- 21 emotions
- 3 styles (singing, shouting, whispering)
- 10 prosody tags (speed, pitch, pauses, expressiveness)
- 9 sound effects (laughter, crying, screaming, etc.)
- Zero-shot voice cloning from a 10-30s reference clip
- 102 languages, 24 kHz output

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Electron Desktop App  (C:\Users\Anesu\Documents\GitHub\Higgs-TTS\)  │
│  ┌──────────────────┐    IPC    ┌────────────────────────┐  │
│  │  Renderer (UI)   │◄────────►│  Main process          │  │
│  │  HTML/CSS/JS     │          │  - Window mgmt         │  │
│  │                  │          │  - System tray         │  │
│  └────────┬─────────┘          │  - Subprocess control  │  │
│           │ fetch              └──────┬──────────┬──────┘  │
│           │                          │          │         │
│           ▼                          ▼          ▼         │
└─────────────────────────────────────────────────────────────┘
                                    │          │
                    ┌───────────────┘          └──────────────┐
                    ▼                                        ▼
         ┌──────────────────────┐                ┌──────────────────────┐
         │  Python Flask proxy  │                │  SGLang-Omni (WSL2)  │
         │  :7861               │  OpenAI-compat │  :8000               │
         │  - /api/voices       │ ─────────────► │  - /v1/audio/speech  │
         │  - /api/tts          │                │  - 4B model on GPU   │
         │  - /api/health       │                │  - Voice cloning     │
         │  - /api/history      │                │  - 24 kHz output     │
         └──────────────────────┘                └──────────────────────┘
```

## Install

**Prerequisites (one-time):**
- Windows 10/11 with WSL2 enabled
- NVIDIA GPU with CUDA drivers (RTX 3090 verified)
- Python 3.10+
- Node.js 18+

**Run the installer:**
```cmd
scripts\install.bat
```

This will:
1. Create `node_modules/` (Electron)
2. Create `server\.venv\` and install `flask` + `requests`
3. Inside WSL2: install CUDA toolkit, `uv`, SGLang, SGLang-Omni (from source)
4. Download the 4B Higgs model (~8 GB)

**Total install time: 15-30 minutes** (mostly the SGLang-Omni source compile).

## Run

**Easiest:** double-click the desktop shortcut created on first launch.
**Alternative:**
```cmd
scripts\launch-higgs.bat
```

The window opens once the Flask proxy is healthy (~30 sec on warm start).
Closing the window hides to the system tray. Use the tray menu to quit.

## License

**Non-commercial use only.** See [LICENSE.md](LICENSE.md) for the full text.
Commercial deployment requires a license from Boson AI.
