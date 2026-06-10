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
    ) -> str:
        """Persist a synthesis entry. Writes to today's date directory."""
        today = self._today()
        prefix = self._entry_prefix(entry_id)
        meta = {
            "id": entry_id,
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
        for date_dir in self.output_dir.iterdir():
            if not date_dir.is_dir():
                continue
            for f in date_dir.glob(f"*-{entry_id}.*"):
                f.unlink()
                return True
        return False
