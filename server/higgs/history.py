"""
HistoryStore — persistent log of synthesis runs.

Directory structure:
  output/
    <YYYY-MM-DD>/
      <HHMMSS>-<id>.json     ← metadata
      <HHMMSS>-<id>.wav      ← audio

Each entry has a date-stamped prefix so the filesystem is human-browseable.
The store walks date directories to list/delete — no flat 50-file directories.
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path

logger = logging.getLogger("higgs.history")


class HistoryStore:
    """CRUD over date-organized output directories."""

    def __init__(self, output_dir: Path):
        self.output_dir = output_dir
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def _today(self) -> str:
        return time.strftime("%Y-%m-%d")

    def _today_dir(self) -> Path:
        d = self.output_dir / self._today()
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _entry_prefix(self, entry_id: str) -> str:
        """Timestamped prefix for a given entry ID."""
        return f"{time.strftime('%H%M%S')}-{entry_id}"

    def save(
        self,
        *,
        entry_id: str,
        text: str,
        voice_id: str | None,
        references,
        file_path: Path,
        elapsed_sec: float,
        run_id: str | None = None,
    ) -> str:
        """Persist a synthesis entry. Writes to today's date directory."""
        today = self._today()
        prefix = self._entry_prefix(entry_id)
        meta = {
            "id": entry_id,
            "run_id": run_id,
            "text": text,
            "voice_id": voice_id,
            "references": references,
            "file": f"{today}/{prefix}.wav",
            "elapsed_sec": round(elapsed_sec, 2),
            "created_at": time.time(),
        }
        (self._today_dir() / f"{prefix}.json").write_text(
            json.dumps(meta, indent=2), encoding="utf-8"
        )
        return entry_id

    def list_all(self) -> list[dict]:
        """Return all entries across all date directories, newest first."""
        entries = []
        dirs = sorted(
            [d for d in self.output_dir.iterdir() if d.is_dir()],
            reverse=True,
        )
        for date_dir in dirs:
            json_files = sorted(
                date_dir.glob("*.json"),
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            )
            for jf in json_files:
                try:
                    entries.append(json.loads(jf.read_text(encoding="utf-8")))
                except Exception:
                    continue
        return entries

    def delete(self, entry_id: str) -> bool:
        """Remove both JSON and WAV for an entry across all date dirs."""
        deleted = False
        for date_dir in self.output_dir.iterdir():
            if not date_dir.is_dir():
                continue
            for f in date_dir.glob(f"*-{entry_id}.*"):
                f.unlink()
                deleted = True
            if deleted:
                break  # both files live in the same date dir
        return deleted

    def resolve_path(self, entry_id: str) -> Path | None:
        """Return the WAV file path for an entry ID, or None if not found.

        Walks date directories (same pattern as delete) so callers never
        need to know the output/YYYY-MM-DD/HHMMSS-id.wav scheme.
        """
        for date_dir in self.output_dir.iterdir():
            if not date_dir.is_dir():
                continue
            for f in date_dir.glob(f"*-{entry_id}.wav"):
                return f
        return None

    def make_output_path(self, entry_id: str) -> Path:
        """Build a date-stamped output path: output/YYYY-MM-DD/HHMMSS-<id>.wav.

        Canonical path — this is the single source of truth for the output
        filename scheme. Server.py delegates to this instead of duplicating
        the time.strftime pattern.
        """
        today = self._today()
        prefix = self._entry_prefix(entry_id)
        d = self.output_dir / today
        d.mkdir(parents=True, exist_ok=True)
        return d / f"{prefix}.wav"

    def list_sessions(self) -> list[dict]:
        """Group entries by synthesis session. Returns newest sessions first.

        Each session is one 'Synthesise' click. Entries carry a run_id since
        v0.2; legacy entries without one fall back to grouping by their HHMM
        minute prefix within a date folder.
        """
        sessions: dict[str, dict] = {}
        for date_dir in sorted(self.output_dir.iterdir(), reverse=True):
            if not date_dir.is_dir() or date_dir.name.startswith('.'):
                continue
            date_str = date_dir.name
            json_files = sorted(date_dir.glob("*.json"),
                               key=lambda p: p.stat().st_mtime, reverse=True)
            for jf in json_files:
                try:
                    entry = json.loads(jf.read_text(encoding="utf-8"))
                except Exception:
                    continue
                key = entry.get("run_id") or f"{date_str}/{jf.stem[:4]}"
                if key not in sessions:
                    sessions[key] = {
                        "date": date_str,
                        "first_text": entry.get("text", ""),
                        "sentence_count": 0,
                        "total_elapsed_sec": 0.0,
                        "created_at": entry.get("created_at", 0),
                        "ids": [],
                        "files": [],
                    }
                sessions[key]["sentence_count"] += 1
                sessions[key]["total_elapsed_sec"] += entry.get("elapsed_sec", 0)
                sessions[key]["ids"].append(entry.get("id", ""))
                if entry.get("file"):
                    sessions[key]["files"].append(entry["file"])
                # Keep the earliest (first sentence) as display text
                if entry.get("created_at", 0) < sessions[key]["created_at"]:
                    sessions[key]["created_at"] = entry["created_at"]
                    sessions[key]["first_text"] = entry.get("text", "")
        out = sorted(sessions.values(), key=lambda s: s["created_at"], reverse=True)
        # json_files iterate newest-first; playback wants synthesis order
        for s in out:
            s["ids"].reverse()
            s["files"].reverse()
        return out
