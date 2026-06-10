"""
Higgs TTS — Flask proxy server.

Sits between the Electron renderer and SGLang-Omni. Provides:
  GET  /api/health              — readiness + GPU VRAM
  GET  /api/voices              — list voices (presets + custom)
  GET  /api/voices/custom       — list custom cloned voices
  POST /api/voices/custom       — upload reference audio + transcript
  DELETE /api/voices/custom/<id>— remove a custom voice
  POST /api/tts                 — synthesise (single chunk, volume boost)
  POST /api/tts/long            — synthesise (auto-chunked for long text)
  GET  /api/history             — list past generations
  DELETE /api/history/<id>      — delete a history entry
  POST /v1/audio/speech         — OpenAI-compatible passthrough
  GET  /audio/<path>            — serve generated audio
"""
from __future__ import annotations

import argparse
import base64
import json
import logging
import os
import re as _re
import shutil
import struct
import subprocess as _subprocess
import threading
import time
import uuid
import wave
from pathlib import Path
from typing import Any

import requests
from flask import Flask, Response, jsonify, request, send_from_directory, stream_with_context

# ── Project root on path ──────────────────────────────────
import sys
SERVER_DIR = Path(__file__).parent
sys.path.insert(0, str(SERVER_DIR))

from higgs.config import config
from higgs.core import HiggsTTS
from higgs.voices import VoiceCatalog
from higgs.audio import apply_gain, concat_wavs, silence_ms, trim_silence  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger("higgs-server")

# ── Paths ────────────────────────────────────────────────
OUTPUT_DIR = Path(os.environ.get("HIGGS_OUTPUT_DIR", SERVER_DIR.parent / "output"))
VOICES_DIR = OUTPUT_DIR / "voices"
HISTORY_DIR = OUTPUT_DIR / "history"
VOICES_DIR.mkdir(parents=True, exist_ok=True)
HISTORY_DIR.mkdir(parents=True, exist_ok=True)

# ── State ─────────────────────────────────────────────────
app = Flask(__name__, static_folder=None)
_voice_catalog: VoiceCatalog | None = None
_tts: HiggsTTS | None = None
_tts_lock = threading.Lock()

# ── Lazy init ────────────────────────────────────────────
def get_voice_catalog() -> VoiceCatalog:
    global _voice_catalog
    if _voice_catalog is None:
        _voice_catalog = VoiceCatalog(voices_dir=VOICES_DIR, preset_voices=config.preset_voices)
    return _voice_catalog

def get_tts() -> HiggsTTS:
    global _tts
    if _tts is None:
        with _tts_lock:
            if _tts is None:
                sglang_url = os.environ.get("SGLANG_URL", "http://127.0.0.1:8000")
                logger.info("Initialising HiggsTTS adapter -> %s", sglang_url)
                _tts = HiggsTTS(sglang_url=sglang_url, timeout=config.request_timeout)
    return _tts

# ── Helpers ──────────────────────────────────────────────
def _wsl_path(windows_path: str) -> str:
    p = windows_path.replace("\\", "/")
    m = _re.match(r"^([A-Za-z]):/", p)
    if m:
        p = f"/mnt/{m.group(1).lower()}/{p[3:]}"
    return p

def _gpu_info() -> dict:
    gpu = {"name": "", "vram_used_mb": 0, "vram_total_mb": 0, "vram_free_mb": 0}
    try:
        nvsmi = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32", "nvidia-smi.exe")
        out = _subprocess.check_output(
            [nvsmi, "--query-gpu=name,memory.used,memory.total,memory.free", "--format=csv,noheader,nounits"],
            timeout=5, text=True
        ).strip()
        parts = out.split(",")
        if len(parts) >= 4:
            gpu["name"] = parts[0].strip()
            gpu["vram_used_mb"] = int(parts[1].strip())
            gpu["vram_total_mb"] = int(parts[2].strip())
            gpu["vram_free_mb"] = int(parts[3].strip())
    except Exception:
        pass
    return gpu

def _save_history_entry(entry_id, text, voice_id, references, file_path, elapsed_sec):
    meta = {"id": entry_id, "text": text, "voice_id": voice_id, "references": references,
            "file": str(file_path.relative_to(OUTPUT_DIR)), "elapsed_sec": round(elapsed_sec, 2),
            "created_at": time.time()}
    (HISTORY_DIR / f"{entry_id}.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

def _split_sentences(text: str, max_chunk: int = 350) -> list[str]:
    parts = _re.split(r"(?<=[.!?])\s+|\n\n+", text)
    chunks: list[str] = []
    buf = ""
    for p in parts:
        p = p.strip()
        if not p:
            continue
        if len(buf) + len(p) + 1 <= max_chunk:
            buf = (buf + " " + p).strip() if buf else p
        else:
            if buf:
                chunks.append(buf)
            buf = p
    if buf:
        chunks.append(buf)
    return chunks if chunks else [text]

# ── Health ───────────────────────────────────────────────
@app.route("/api/health", methods=["GET"])
def api_health():
    sglang_url = os.environ.get("SGLANG_URL", "http://127.0.0.1:8000")
    sglang_ok, sglang_models = False, []
    try:
        r = requests.get(f"{sglang_url}/v1/models", timeout=2)
        if r.status_code == 200:
            payload = r.json()
            sglang_models = [m.get("id", "?") for m in payload.get("data", [])]
            sglang_ok = True
    except Exception:
        pass
    return jsonify({
        "flask_ready": True,
        "sglang_ready": sglang_ok,
        "sglang_url": sglang_url,
        "sglang_models": sglang_models,
        "server_version": "0.1.0",
        "preset_voices_count": len(config.preset_voices),
        "gpu": _gpu_info(),
    })

# ── Voices ───────────────────────────────────────────────
@app.route("/api/voices", methods=["GET"])
def api_voices():
    return jsonify({"voices": get_voice_catalog().all_voices()})

@app.route("/api/voices/custom", methods=["GET"])
def api_voices_custom():
    return jsonify({"voices": get_voice_catalog().custom_voices()})

@app.route("/api/voices/custom", methods=["POST"])
def api_voices_custom_upload():
    if "audio" not in request.files:
        return jsonify({"error": "No audio file provided (field 'audio')"}), 400
    audio = request.files["audio"]
    name = (request.form.get("name") or "").strip()
    transcript = (request.form.get("transcript") or "").strip()
    if not name:
        return jsonify({"error": "Field 'name' is required"}), 400
    voice_id = get_voice_catalog().add_custom(name=name, audio_bytes=audio.read(), audio_filename=audio.filename or "ref.wav", transcript=transcript)
    return jsonify({"id": voice_id, "name": name, "transcript": transcript})

@app.route("/api/voices/custom/<voice_id>", methods=["DELETE"])
def api_voices_custom_delete(voice_id):
    ok = get_voice_catalog().remove_custom(voice_id)
    return jsonify({"deleted": voice_id}) if ok else (jsonify({"error": "Voice not found"}), 404)

# ── TTS (single) ─────────────────────────────────────────
@app.route("/api/tts", methods=["POST"])
def api_tts():
    data = request.get_json(force=True)
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({"error": "Field 'text' is required"}), 400

    voice_id = data.get("voice_id")
    references = data.get("references")
    temperature = float(data.get("temperature", 0.8))
    top_k = int(data.get("top_k", 50))
    max_new_tokens = int(data.get("max_new_tokens", 4096))
    volume = float(data.get("volume", 1.8))

    if references is None and voice_id:
        voice = get_voice_catalog().resolve(voice_id)
        if voice and voice.get("kind") == "custom":
            references = [{"audio_path": _wsl_path(voice.get("audio_path", "")), "text": voice.get("transcript", "")}]

    entry_id = uuid.uuid4().hex[:12]
    out_path = HISTORY_DIR / f"{entry_id}.wav"
    try:
        t0 = time.time()
        tts = get_tts()
        audio_bytes = tts.synthesize(text=text, references=references, temperature=temperature, top_k=top_k, max_new_tokens=max_new_tokens)
        audio_bytes = apply_gain(audio_bytes, gain=volume)
        audio_bytes = trim_silence(audio_bytes, threshold_ratio=0.02, pad_sec=0.2)
        out_path.write_bytes(audio_bytes)
        elapsed = time.time() - t0
        _save_history_entry(entry_id, text=text, voice_id=voice_id, references=references, file_path=out_path, elapsed_sec=elapsed)
        return jsonify({"id": entry_id, "file": f"/audio/history/{entry_id}.wav", "elapsed_sec": round(elapsed, 2), "bytes": len(audio_bytes), "volume_applied": volume})
    except Exception as e:
        logger.exception("TTS failed")
        return jsonify({"error": str(e)}), 500

def _trim_trailing_quiet(wav_bytes: bytes, abs_threshold: int = 100, pad_sec: float = 0.3) -> bytes:
    """
    Trim trailing audio where samples stay below `abs_threshold`.
    Only catches digital noise floor — real speech is hundreds to thousands.
    Much safer than ratio-based trimming which can clip quiet speech.
    """
    import io as _io
    with wave.open(_io.BytesIO(wav_bytes), "rb") as wf:
        params = wf.getparams()
        nframes = params.nframes
        frames = wf.readframes(nframes)
    fmt = f"<{nframes}h"
    samples = list(struct.unpack(fmt, frames))
    pad_frames = int(params.framerate * pad_sec)
    # Scan backwards — find the last sample above threshold
    cutoff = nframes
    for i in range(nframes - 1, pad_frames, -1):
        if abs(samples[i]) > abs_threshold:
            cutoff = min(i + pad_frames, nframes)
            break
    if cutoff >= nframes - int(params.framerate * 0.1):
        return wav_bytes  # nothing to trim
    trimmed = samples[:cutoff]
    buf = _io.BytesIO()
    new_params = params._replace(nframes=len(trimmed))
    with wave.open(buf, "wb") as wf:
        wf.setparams(new_params)
        wf.writeframes(struct.pack(f"<{len(trimmed)}h", *trimmed))
    return buf.getvalue()


# ── TTS (long / chunked) ─────────────────────────────────
@app.route("/api/tts/long", methods=["POST"])
def api_tts_long():
    try:
        return _api_tts_long_impl()
    except Exception as e:
        logger.exception("Long TTS crashed")
        return jsonify({"error": str(e)}), 500


def _api_tts_long_impl():
    data = request.get_json(force=True)
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({"error": "Field 'text' is required"}), 400

    voice_id = data.get("voice_id")
    references = data.get("references")
    temperature = float(data.get("temperature", 0.8))
    top_k = int(data.get("top_k", 50))
    volume = float(data.get("volume", 1.8))
    chunk_size = int(data.get("chunk_size", 200))

    if references is None and voice_id:
        voice = get_voice_catalog().resolve(voice_id)
        if voice and voice.get("kind") == "custom":
            references = [{"audio_path": _wsl_path(voice.get("audio_path", "")), "text": voice.get("transcript", "")}]

    chunks = _split_sentences(text, max_chunk=chunk_size)
    logger.info("Long TTS: %d chunks for %d chars (max %d/chunk)", len(chunks), len(text), chunk_size)

    # v2 token budget — known to work best
    def _tok_budget(chars):
        return min(4096, max(768, int(len(chars) / 8 * 50 * 2.0)))

    t0 = time.time()
    tts = get_tts()
    wavs: list[bytes] = []
    for i, chunk in enumerate(chunks):
        tok = _tok_budget(chunk)
        logger.info("  Chunk %d/%d: %d chars -> max %d tokens", i + 1, len(chunks), len(chunk), tok)
        try:
            raw = tts.synthesize(text=chunk, references=references, temperature=temperature, top_k=top_k, max_new_tokens=tok)
            boosted = apply_gain(raw, gain=volume)
            # No trimming — it eats words unpredictably depending on model output variance.
            # The 100ms gap between chunks provides clean separation.
            wavs.append(boosted)
        except Exception as e:
            logger.error("Chunk %d failed: %s", i + 1, e)
            continue

    if not wavs:
        return jsonify({"error": "All chunks failed — SGLang-Omni may be down"}), 500

    combined = concat_wavs(wavs, crossfade_ms=0, gap_ms=100)
    entry_id = uuid.uuid4().hex[:12]
    out_path = HISTORY_DIR / f"{entry_id}.wav"
    out_path.write_bytes(combined)
    elapsed = time.time() - t0
    _save_history_entry(entry_id, text=f"[long:{len(chunks)} chunks] {text[:80]}...", voice_id=voice_id, references=references, file_path=out_path, elapsed_sec=elapsed)
    return jsonify({"id": entry_id, "file": f"/audio/history/{entry_id}.wav", "elapsed_sec": round(elapsed, 2), "bytes": len(combined), "chunks": len(chunks), "failed": len(chunks) - len(wavs), "volume_applied": volume})

# ── OpenAI passthrough ───────────────────────────────────
@app.route("/v1/audio/speech", methods=["POST"])
def openai_passthrough():
    sglang_url = os.environ.get("SGLANG_URL", "http://127.0.0.1:8000")
    try:
        r = requests.post(f"{sglang_url}/v1/audio/speech", data=request.get_data(),
                         headers={"Content-Type": request.content_type or "application/json"},
                         stream=True, timeout=config.request_timeout)
        return Response(stream_with_context(r.iter_content(chunk_size=8192)), status=r.status_code,
                       content_type=r.headers.get("Content-Type", "audio/wav"))
    except Exception as e:
        return jsonify({"error": str(e)}), 502

# ── History ──────────────────────────────────────────────
@app.route("/api/history", methods=["GET"])
def api_history():
    entries = []
    for jf in sorted(HISTORY_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            entries.append(json.loads(jf.read_text(encoding="utf-8")))
        except Exception:
            continue
    return jsonify({"entries": entries})

@app.route("/api/history/<entry_id>", methods=["DELETE"])
def api_history_delete(entry_id):
    deleted = False
    for ext in (".json", ".wav"):
        f = HISTORY_DIR / f"{entry_id}{ext}"
        if f.exists():
            f.unlink()
            deleted = True
    return jsonify({"deleted": entry_id, "ok": deleted})

# ── Static audio ─────────────────────────────────────────
@app.route("/audio/<path:filename>")
def serve_audio(filename):
    safe = (OUTPUT_DIR / filename).resolve()
    if not str(safe).startswith(str(OUTPUT_DIR.resolve())):
        return jsonify({"error": "Forbidden"}), 403
    if not safe.exists():
        return jsonify({"error": "Not found"}), 404
    return send_from_directory(OUTPUT_DIR, filename)

# ── Entrypoint ───────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=7861)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--sglang-url", default=os.environ.get("SGLANG_URL", "http://127.0.0.1:8000"))
    parser.add_argument("--debug", action="store_true")
    args = parser.parse_args()
    os.environ["SGLANG_URL"] = args.sglang_url
    logger.info("Higgs TTS Flask proxy on http://%s:%d  (sglang: %s)", args.host, args.port, args.sglang_url)
    app.run(host=args.host, port=args.port, debug=args.debug, threaded=True, use_reloader=False)

if __name__ == "__main__":
    main()
