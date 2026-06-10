"""
VoiceCatalog — resolves voice IDs (preset or custom) into a uniform shape.

Two kinds of voices:
  - preset:   static list from config. May map to a bundled reference audio
              on disk if the user dropped one in voices/preset-*.wav.
  - custom:   user-uploaded reference audio + transcript, stored on disk under
              voices/custom/<id>/audio.wav and voices/custom/<id>/meta.json.

The catalog is the single seam for voice validation: callers never touch the
filesystem directly. (Koko pattern — small stable interface, real seam.)
"""
from __future__ import annotations

import json
import logging
import shutil
import uuid
from pathlib import Path

logger = logging.getLogger("higgs.voices")


class VoiceCatalog:
    def __init__(self, voices_dir: Path, preset_voices: tuple):
        self.voices_dir = voices_dir
        self.custom_dir = voices_dir / "custom"
        self.custom_dir.mkdir(parents=True, exist_ok=True)
        self._presets = list(preset_voices)
        # If a bundled preset-*.wav exists, wire it up
        for p in self._presets:
            if p.get("kind") != "preset":
                continue
            pid = p["id"]
            if pid == "default":
                continue
            wav = self.voices_dir / f"{pid}.wav"
            if wav.exists():
                p["audio_path"] = str(wav)
                # transcript is user-editable in voices/<id>.txt
                txt = self.voices_dir / f"{pid}.txt"
                if txt.exists():
                    p["transcript"] = txt.read_text(encoding="utf-8").strip()

    # ── Preset voices ───────────────────────────────────────────────
    def all_voices(self) -> list[dict]:
        return self._presets + self.custom_voices()

    def custom_voices(self) -> list[dict]:
        out = []
        if not self.custom_dir.exists():
            return out
        for d in sorted(self.custom_dir.iterdir()):
            if not d.is_dir():
                continue
            meta_path = d / "meta.json"
            if not meta_path.exists():
                continue
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except Exception:
                continue
            out.append({
                "id": meta["id"],
                "name": meta.get("name", meta["id"]),
                "kind": "custom",
                "audio_path": str(d / "audio" / meta.get("audio_filename", "ref.wav")),
                "transcript": meta.get("transcript", ""),
                "created_at": meta.get("created_at"),
            })
        return out

    # ── Resolve by ID ───────────────────────────────────────────────
    def resolve(self, voice_id: str) -> dict | None:
        """Return the voice record for `voice_id` or None."""
        for v in self._presets:
            if v["id"] == voice_id:
                return v
        for v in self.custom_voices():
            if v["id"] == voice_id:
                return v
        return None

    # ── CRUD on custom voices ───────────────────────────────────────
    def add_custom(self, *, name: str, audio_bytes: bytes, audio_filename: str, transcript: str) -> str:
        vid = uuid.uuid4().hex[:10]
        d = self.custom_dir / vid
        (d / "audio").mkdir(parents=True, exist_ok=True)
        # Sanitise the filename to a safe extension
        safe_name = Path(audio_filename).name or "ref.wav"
        (d / "audio" / safe_name).write_bytes(audio_bytes)
        meta = {
            "id": vid,
            "name": name,
            "transcript": transcript,
            "audio_filename": safe_name,
            "created_at": __import__("time").time(),
        }
        (d / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
        logger.info("Added custom voice: %s (%s, %d bytes audio)", vid, name, len(audio_bytes))
        return vid

    def remove_custom(self, voice_id: str) -> bool:
        d = self.custom_dir / voice_id
        if d.exists() and d.is_dir():
            shutil.rmtree(d, ignore_errors=True)
            logger.info("Removed custom voice: %s", voice_id)
            return True
        return False
