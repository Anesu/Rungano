"""
Higgs TTS — Flask proxy server.

Sits between the Electron renderer and SGLang-Omni. Provides:
  GET  /api/health              — readiness + GPU VRAM
  GET  /api/controls            — control token catalogue (emotion, style, prosody, sfx)
  GET  /api/voices              — list voices (presets + custom)
  GET  /api/voices/custom       — list custom cloned voices
  POST /api/voices/custom       — upload reference audio + transcript
  DELETE /api/voices/custom/<id>— remove a custom voice
  POST /api/tts                 — synthesise (single chunk, volume boost)
  POST /api/tts/batch           — synthesise (sentence-by-sentence, controls applied per utterance)
  GET  /api/history             — list past generations
  DELETE /api/history/<id>      — delete a history entry
  POST /v1/audio/speech         — OpenAI-compatible passthrough
  GET  /audio/<path>            — serve generated audio
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import threading
import time
import uuid
from pathlib import Path

import requests
from flask import Flask, Response, jsonify, request, send_from_directory, stream_with_context

# ── Project root on path ──────────────────────────────────
import sys
SERVER_DIR = Path(__file__).parent
sys.path.insert(0, str(SERVER_DIR))

from higgs.config import config
from higgs.core import EMOTIONS, PROSODY, SOUND_EFFECTS, STYLES, HiggsTTS, build_input_text
from higgs.history import HistoryStore
from higgs.system import gpu_info, wsl_path
from higgs.text import TextChunker
from higgs.voices import VoiceCatalog
from higgs.audio import apply_gain, concat_wavs, trim_silence  # noqa: E402

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
_text_chunker: TextChunker | None = None
_history: HistoryStore | None = None
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

def get_text_chunker() -> TextChunker:
    global _text_chunker
    if _text_chunker is None:
        _text_chunker = TextChunker(strategy="sentence")
    return _text_chunker

def get_history() -> HistoryStore:
    global _history
    if _history is None:
        _history = HistoryStore(history_dir=HISTORY_DIR)
    return _history

# ── Shared helpers (used by both TTS endpoints) ──────────

def _apply_controls(text: str, controls: dict) -> str:
    """Build control-tagged text from a structured controls dict.
    Canonical path — the server owns prompt format, not the renderer."""
    return build_input_text(text,
        emotion=controls.get("emotion"),
        style=controls.get("style"),
        prosody=controls.get("prosody"),
        sfx=controls.get("sfx"))

def _resolve_references(references, voice_id: str | None):
    """Resolve a voice_id into reference audio dicts for custom voices.
    Returns references unchanged if already set or voice is preset."""
    if references is not None or not voice_id:
        return references
    voice = get_voice_catalog().resolve(voice_id)
    if voice and voice.get("kind") == "custom":
        return [{"audio_path": wsl_path(voice.get("audio_path", "")),
                 "text": voice.get("transcript", "")}]
    return references

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
        "gpu": gpu_info(),
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
    language = (request.form.get("language") or "english").strip()
    transcript = (request.form.get("transcript") or "").strip()
    if not name:
        return jsonify({"error": "Field 'name' is required"}), 400
    voice_id = get_voice_catalog().add_custom(name=name, language=language, audio_bytes=audio.read(), audio_filename=audio.filename or "ref.wav", transcript=transcript)
    return jsonify({"id": voice_id, "name": name, "language": language, "transcript": transcript})

@app.route("/api/voices/custom/<voice_id>", methods=["DELETE"])
def api_voices_custom_delete(voice_id):
    ok = get_voice_catalog().remove_custom(voice_id)
    return jsonify({"deleted": voice_id}) if ok else (jsonify({"error": "Voice not found"}), 404)

# ── Controls catalogue ─────────────────────────────────────
@app.route("/api/controls", methods=["GET"])
def api_controls():
    """Single source of truth for control tokens. Renderer fetches this at startup."""
    sfx_suggested = {
        "cough": "Ahem", "laughter": "Haha", "crying": "Boohoo", "screaming": "Ahh",
        "burping": "Burp", "humming": "Hmm", "sigh": "Uh", "sniff": "Sff", "sneeze": "Achoo",
    }
    sfx_list = [{"token": t, "suggested": sfx_suggested.get(t, t)} for t in SOUND_EFFECTS]
    return jsonify({
        "emotions": list(EMOTIONS),
        "styles": list(STYLES),
        "prosody": list(PROSODY),
        "sfx": sfx_list,
    })

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
    top_p = float(data.get("top_p", 0.9))
    max_new_tokens = int(data.get("max_new_tokens", 4096))
    volume = float(data.get("volume", 1.8))
    controls = data.get("controls") or {}

    # Build tagged text from structured controls (canonical path — server owns prompt format)
    text = _apply_controls(text, controls)

    references = _resolve_references(references, voice_id)

    entry_id = uuid.uuid4().hex[:12]
    out_path = HISTORY_DIR / f"{entry_id}.wav"
    try:
        t0 = time.time()
        tts = get_tts()
        audio_bytes = tts.synthesize(text=text, references=references, temperature=temperature, top_k=top_k, top_p=top_p, max_new_tokens=max_new_tokens)
        audio_bytes = apply_gain(audio_bytes, gain=volume)
        audio_bytes = trim_silence(audio_bytes)
        out_path.write_bytes(audio_bytes)
        elapsed = time.time() - t0
        get_history().save(entry_id=entry_id, text=text, voice_id=voice_id, references=references, file_path=out_path, elapsed_sec=elapsed)
        return jsonify({"id": entry_id, "file": f"/audio/history/{entry_id}.wav", "elapsed_sec": round(elapsed, 2), "bytes": len(audio_bytes), "volume_applied": volume})
    except Exception as e:
        logger.exception("TTS failed")
        return jsonify({"error": str(e)}), 500

# ── TTS (batch / sentence-by-sentence) ────────────────────
# The Higgs model performs best on short utterances (it was designed for voice
# chat, not long-form narration). We work WITH this: split text into sentences,
# synthesize each independently with generous token budgets, and save individual
# WAV files. No trimming, no crossfading, no concatenation — each sentence
# stands alone, clean and complete.
#
# The renderer queues sentences sequentially and plays them as a playlist.

@app.route("/api/tts/batch", methods=["POST"])
def api_tts_batch():
    data = request.get_json(force=True)
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({"error": "Field 'text' is required"}), 400

    voice_id = data.get("voice_id")
    references = data.get("references")
    temperature = float(data.get("temperature", 0.8))
    top_k = int(data.get("top_k", 50))
    volume = float(data.get("volume", 1.8))
    controls = data.get("controls") or {}

    references = _resolve_references(references, voice_id)

    # Split into individual sentences using spaCy (with regex fallback).
    sentences = get_text_chunker().chunk(text)
    logger.info("Batch TTS: %d sentences for %d chars", len(sentences), len(text))

    t0 = time.time()
    tts = get_tts()
    results: list[dict] = []
    failed = 0

    for i, sentence in enumerate(sentences):
        # Apply controls per-sentence so every utterance gets emotion/style/prosody/sfx.
        tagged = _apply_controls(sentence, controls)

        entry_id = uuid.uuid4().hex[:12]
        out_path = HISTORY_DIR / f"{entry_id}.wav"
        try:
            t_start = time.time()
            raw = tts.synthesize(
                text=tagged,
                references=references,
                temperature=temperature,
                top_k=top_k,
                top_p=top_p,
                max_new_tokens=2048,  # single sentence — 40s is more than enough
            )
            boosted = apply_gain(raw, gain=volume)
            out_path.write_bytes(boosted)
            elapsed = time.time() - t_start
            results.append({
                "index": i,
                "text": sentence[:120] + ("..." if len(sentence) > 120 else ""),
                "chars": len(sentence),
                "file": f"/audio/history/{entry_id}.wav",
                "elapsed_sec": round(elapsed, 2),
                "bytes": len(boosted),
            })
            get_history().save(entry_id=entry_id, text=sentence, voice_id=voice_id, references=references, file_path=out_path, elapsed_sec=elapsed)
            logger.info("  Sentence %d/%d: %d chars -> %.1fs, %d bytes", i + 1, len(sentences), len(sentence), elapsed, len(boosted))
        except Exception as e:
            logger.error("Sentence %d failed: %s", i + 1, e)
            failed += 1
            continue

    total_elapsed = time.time() - t0
    return jsonify({
        "sentences": results,
        "total": len(sentences),
        "failed": failed,
        "elapsed_sec": round(total_elapsed, 2),
        "volume_applied": volume,
    })

# ── TTS (batch / streaming SSE) ───────────────────────────
# Progressive delivery via Server-Sent Events. Each sentence completion
# pushes an event to the renderer so the playlist builds in real time.
# The client sees "Sentence 3 of 12" instead of a 90-second spinner.

@app.route("/api/tts/batch/stream", methods=["POST"])
def api_tts_batch_stream():
    data = request.get_json(force=True)
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({"error": "Field 'text' is required"}), 400

    voice_id = data.get("voice_id")
    references = data.get("references")
    temperature = float(data.get("temperature", 0.8))
    top_k = int(data.get("top_k", 50))
    volume = float(data.get("volume", 1.8))
    controls = data.get("controls") or {}

    references = _resolve_references(references, voice_id)
    sentences = get_text_chunker().chunk(text)
    total = len(sentences)
    logger.info("Streaming TTS: %d sentences for %d chars", total, len(text))

    def generate():
        t0 = time.time()
        tts = get_tts()
        failed = 0

        # Initial event: total sentence count so the client can pre-allocate the playlist
        yield f"data: {json.dumps({'type': 'start', 'total': total})}\n\n"

        for i, sentence in enumerate(sentences):
            tagged = _apply_controls(sentence, controls)
            entry_id = uuid.uuid4().hex[:12]
            out_path = HISTORY_DIR / f"{entry_id}.wav"
            try:
                t_start = time.time()
                raw = tts.synthesize(
                    text=tagged,
                    references=references,
                    temperature=temperature,
                    top_k=top_k,
                    max_new_tokens=2048,
                )
                boosted = apply_gain(raw, gain=volume)
                out_path.write_bytes(boosted)
                elapsed = time.time() - t_start

                get_history().save(
                    entry_id=entry_id, text=sentence, voice_id=voice_id,
                    references=references, file_path=out_path, elapsed_sec=elapsed,
                )

                event = {
                    "type": "sentence",
                    "index": i,
                    "text": sentence[:120] + ("..." if len(sentence) > 120 else ""),
                    "chars": len(sentence),
                    "file": f"/audio/history/{entry_id}.wav",
                    "elapsed_sec": round(elapsed, 2),
                    "bytes": len(boosted),
                }
                yield f"data: {json.dumps(event)}\n\n"
                logger.info("  Stream %d/%d: %d chars -> %.1fs", i + 1, total, len(sentence), elapsed)

            except GeneratorExit:
                logger.info("Streaming TTS cancelled by client at sentence %d/%d", i + 1, total)
                return
            except Exception as e:
                logger.error("Sentence %d failed: %s", i + 1, e)
                failed += 1
                yield f"data: {json.dumps({'type': 'error', 'index': i, 'error': str(e)})}\n\n"

        total_elapsed = time.time() - t0
        yield f"data: {json.dumps({'type': 'done', 'total': total, 'failed': failed, 'elapsed_sec': round(total_elapsed, 2)})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

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
    return jsonify({"entries": get_history().list_all()})

@app.route("/api/history/<entry_id>", methods=["DELETE"])
def api_history_delete(entry_id):
    ok = get_history().delete(entry_id)
    return jsonify({"deleted": entry_id, "ok": ok})

# ── Static audio ─────────────────────────────────────────
@app.route("/audio/<path:filename>")
def serve_audio(filename):
    safe = (OUTPUT_DIR / filename).resolve()
    if not str(safe).startswith(str(OUTPUT_DIR.resolve())):
        return jsonify({"error": "Forbidden"}), 403
    if not safe.exists():
        return jsonify({"error": "Not found"}), 404
    return send_from_directory(OUTPUT_DIR, filename)

# ── Export ────────────────────────────────────────────────
@app.route("/api/export/wav", methods=["POST"])
def api_export_wav():
    """Concatenate multiple history entries into a single WAV download."""
    data = request.get_json(force=True)
    ids = data.get("ids") or []
    if not ids:
        return jsonify({"error": "Field 'ids' is required"}), 400
    wavs = []
    for eid in ids:
        f = HISTORY_DIR / f"{eid}.wav"
        if f.exists():
            wavs.append(f.read_bytes())
    if not wavs:
        return jsonify({"error": "No audio files found for the given ids"}), 404
    merged = concat_wavs(wavs, crossfade_ms=0, gap_ms=300)
    return Response(merged, mimetype="audio/wav",
                    headers={"Content-Disposition": "attachment; filename=rungano-export.wav"})

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
