"""
VoiceCatalog — resolves voice IDs (preset or custom) into a uniform shape.

Directory structure:
  voices/                    ← parallel to output/, not inside it
    <language>/              ← auto-detected from folder name
      <voice-name>/          ← sanitized, human-readable
        reference.wav        ← consistent filename
        meta.json            ← {id, name, language, transcript, ...}

Language is inferred from the directory tree — drop a voice into voices/shona/
and it appears as Shona. No extra configuration needed.
"""
from __future__ import annotations

import json
import logging
import re
import shutil
import time
import uuid
from pathlib import Path

logger = logging.getLogger("higgs.voices")


def _sanitize_name(name: str) -> str:
    """Turn a user-provided name into a safe directory name."""
    safe = re.sub(r'[<>:"/\\|?*]', '_', name).strip().strip('.')
    return safe[:50] if safe else "voice"


class VoiceCatalog:
    def __init__(self, voices_dir: Path, preset_voices: tuple):
        self.voices_dir = voices_dir
        self.voices_dir.mkdir(parents=True, exist_ok=True)
        self._presets = list(preset_voices)
        # Wire up preset WAVs if they exist on disk
        for p in self._presets:
            if p.get("kind") != "preset":
                continue
            pid = p["id"]
            if pid == "default":
                continue
            wav = self.voices_dir / f"{pid}.wav"
            if wav.exists():
                p["audio_path"] = str(wav)
                txt = self.voices_dir / f"{pid}.txt"
                if txt.exists():
                    p["transcript"] = txt.read_text(encoding="utf-8").strip()

    # ── Preset voices ───────────────────────────────────────────────
    def all_voices(self) -> list[dict]:
        return self._presets + self.custom_voices()

    def custom_voices(self) -> list[dict]:
        """Scan voices/<lang>/<name>/meta.json for all custom voices."""
        out = []
        if not self.voices_dir.exists():
            return out
        for lang_dir in sorted(self.voices_dir.iterdir()):
            if not lang_dir.is_dir() or lang_dir.name.startswith('.'):
                continue
            language = lang_dir.name
            for voice_dir in sorted(lang_dir.iterdir()):
                if not voice_dir.is_dir():
                    continue
                meta_path = voice_dir / "meta.json"
                if not meta_path.exists():
                    continue
                try:
                    meta = json.loads(meta_path.read_text(encoding="utf-8"))
                except Exception:
                    continue
                out.append({
                    "id": meta.get("id", voice_dir.name),
                    "name": meta.get("name", voice_dir.name),
                    "kind": "custom",
                    "language": language,
                    "audio_path": str(voice_dir / meta.get("audio_filename", "reference.wav")),
                    "transcript": meta.get("transcript", ""),
                    "created_at": meta.get("created_at"),
                })
        return out

    # ── Resolve by ID ───────────────────────────────────────────────
    def resolve(self, voice_id: str) -> dict | None:
        for v in self._presets:
            if v["id"] == voice_id:
                return v
        for v in self.custom_voices():
            if v["id"] == voice_id:
                return v
        return None

    # ── Add custom voice ────────────────────────────────────────────
    def add_custom(
        self,
        *,
        name: str,
        language: str = "english",
        audio_bytes: bytes,
        audio_filename: str = "reference.wav",
        transcript: str = "",
    ) -> str:
        safe_name = _sanitize_name(name)
        voice_dir = self.voices_dir / language / safe_name
        voice_dir.mkdir(parents=True, exist_ok=True)

        # Consistent basename, but keep the real container format — writing
        # an .mp3 upload to "reference.wav" would lie to the inference server.
        ext = Path(audio_filename).suffix.lower()
        if ext not in (".wav", ".mp3", ".flac", ".ogg", ".m4a"):
            ext = ".wav"
        ref_name = f"reference{ext}"
        (voice_dir / ref_name).write_bytes(audio_bytes)

        vid = uuid.uuid4().hex[:10]
        meta = {
            "id": vid,
            "name": name,
            "language": language,
            "transcript": transcript,
            "audio_filename": ref_name,
            "created_at": time.time(),
        }
        (voice_dir / "meta.json").write_text(
            json.dumps(meta, indent=2), encoding="utf-8"
        )
        logger.info(
            "Added custom voice: %s (%s/%s, %d bytes audio)",
            vid, language, safe_name, len(audio_bytes),
        )
        return vid

    # ── Remove custom voice ─────────────────────────────────────────
    def remove_custom(self, voice_id: str) -> bool:
        """Find and remove a custom voice by ID across all languages."""
        for lang_dir in self.voices_dir.iterdir():
            if not lang_dir.is_dir():
                continue
            for voice_dir in lang_dir.iterdir():
                if not voice_dir.is_dir():
                    continue
                meta_path = voice_dir / "meta.json"
                if not meta_path.exists():
                    continue
                try:
                    meta = json.loads(meta_path.read_text(encoding="utf-8"))
                except Exception:
                    continue
                if meta.get("id") == voice_id:
                    shutil.rmtree(voice_dir, ignore_errors=True)
                    logger.info("Removed custom voice: %s", voice_id)
                    return True
        return False
