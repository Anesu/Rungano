"""
One-shot migration: move old output/history/ → output/<YYYY-MM-DD>/
and output/voices/ → voices/<lang>/<name>/.

Run once: python scripts/migrate-v1-to-v2.py
Marker file output/.migrated-v2 prevents re-execution.
"""
import logging
import os
import shutil
import sys
import time
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [migrate] %(levelname)s: %(message)s")
logger = logging.getLogger("migrate-v2")

ROOT = Path(__file__).parent.parent
OUTPUT_DIR = Path(os.environ.get("HIGGS_OUTPUT_DIR", ROOT / "output"))
VOICES_DIR = ROOT / "voices"

def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    VOICES_DIR.mkdir(parents=True, exist_ok=True)

    legacy_history = OUTPUT_DIR / "history"
    legacy_voices = OUTPUT_DIR / "voices"
    legacy_voices_alt = ROOT / "output" / "voices"
    marker = OUTPUT_DIR / ".migrated-v2"

    if marker.exists():
        logger.info("Already migrated (marker exists). Nothing to do.")
        return

    logger.info("Running v2 migration...")

    # Migrate history: output/history/*.wav → output/<YYYY-MM-DD>/HHMMSS-<name>.wav
    if legacy_history.exists():
        migrated = 0
        for f in legacy_history.iterdir():
            if not f.is_file():
                continue
            try:
                mtime = time.strftime("%Y-%m-%d", time.localtime(f.stat().st_mtime))
                dest = OUTPUT_DIR / mtime
                dest.mkdir(parents=True, exist_ok=True)
                prefix = time.strftime("%H%M%S", time.localtime(f.stat().st_mtime))
                new_name = f"{prefix}-{f.name}"
                shutil.copy2(str(f), str(dest / new_name))
                f.unlink()
                migrated += 1
            except Exception as exc:
                logger.warning("  Skipping %s: %s", f.name, exc)
        try:
            legacy_history.rmdir()
        except Exception:
            pass
        logger.info("  Migrated %d history files → date directories", migrated)

    # Migrate voices: output/voices/<name>/ → voices/<lang>/<name>/
    # Also check old location (some early installs put voices under output/)
    for legacy in [legacy_voices, legacy_voices_alt]:
        if legacy.exists():
            moved = 0
            for item in legacy.iterdir():
                try:
                    dest = VOICES_DIR / item.name
                    if not dest.exists():
                        shutil.move(str(item), str(dest))
                        moved += 1
                except Exception as exc:
                    logger.warning("  Skipping voices/%s: %s", item.name, exc)
            try:
                legacy.rmdir()
            except Exception:
                pass
            if moved:
                logger.info("  Moved %d voice directories → voices/", moved)

    marker.touch()
    logger.info("Migration complete. Marker written to %s", marker)

if __name__ == "__main__":
    main()
