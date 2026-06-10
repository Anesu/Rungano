"""
HistoryStore — persistent log of synthesis runs.

Deep module: small interface (save / list / delete) over filesystem I/O.
Callers never touch output/history/ directly — they go through this seam.

Each entry is a {id}.json metadata file paired with a {id}.wav audio file.
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path

logger = logging.getLogger("higgs.history")


class HistoryStore:
    """CRUD over the history directory.

    >>> store = HistoryStore(Path("output/history"))
    >>> store.save(entry_id="abc123", text="Hello.", voice_id="default",
    ...            references=None, file_path=Path("output/history/abc123.wav"),
    ...            elapsed_sec=1.5)
    'abc123'
    """

    def __init__(self, history_dir: Path):
        self.dir = history_dir
        self.dir.mkdir(parents=True, exist_ok=True)

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
        """Persist a synthesis entry. Returns the entry_id."""
        meta = {
            "id": entry_id,
            "text": text,
            "voice_id": voice_id,
            "references": references,
            "file": str(file_path.relative_to(self.dir.parent)),
            "elapsed_sec": round(elapsed_sec, 2),
            "created_at": time.time(),
        }
        (self.dir / f"{entry_id}.json").write_text(
            json.dumps(meta, indent=2), encoding="utf-8"
        )
        logger.debug("Saved history entry: %s", entry_id)
        return entry_id

    def list_all(self) -> list[dict]:
        """Return all entries, newest first."""
        entries = []
        for jf in sorted(
            self.dir.glob("*.json"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        ):
            try:
                entries.append(json.loads(jf.read_text(encoding="utf-8")))
            except Exception:
                continue
        return entries

    def delete(self, entry_id: str) -> bool:
        """Remove both the JSON metadata and the WAV file. Returns True if anything was deleted."""
        deleted = False
        for ext in (".json", ".wav"):
            f = self.dir / f"{entry_id}{ext}"
            if f.exists():
                f.unlink()
                deleted = True
        if deleted:
            logger.debug("Deleted history entry: %s", entry_id)
        return deleted
