"""Shared fixtures for the Rungano server test suite."""
from __future__ import annotations

import io
import math
import struct
import sys
import wave
from pathlib import Path

import pytest

SERVER_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(SERVER_DIR))


def make_wav(seconds: float = 0.2, framerate: int = 24000, amplitude: int = 8000) -> bytes:
    """Small valid 16-bit mono WAV — a 440 Hz tone."""
    n = int(framerate * seconds)
    samples = [int(amplitude * math.sin(2 * math.pi * 440 * i / framerate)) for i in range(n)]
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(framerate)
        wf.writeframes(struct.pack(f"<{n}h", *samples))
    return buf.getvalue()


def read_samples(wav_bytes: bytes) -> list[int]:
    with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
        n = wf.getnframes()
        return list(struct.unpack(f"<{n}h", wf.readframes(n)))


@pytest.fixture
def tone_wav() -> bytes:
    return make_wav()


class FakeTTS:
    """Stands in for HiggsTTS — records calls, returns a fixed WAV."""

    def __init__(self, wav: bytes | None = None):
        self.wav = wav or make_wav()
        self.calls: list[dict] = []

    def synthesize(self, **kwargs) -> bytes:
        self.calls.append(kwargs)
        return self.wav


@pytest.fixture
def flask_app(tmp_path, monkeypatch):
    """The Flask app wired to temp dirs and a FakeTTS. Returns (client, ctx)."""
    import server as srv

    out_dir = tmp_path / "output"
    voices_dir = tmp_path / "voices"
    out_dir.mkdir()
    voices_dir.mkdir()

    fake = FakeTTS()
    monkeypatch.setattr(srv, "OUTPUT_DIR", out_dir)
    monkeypatch.setattr(srv, "VOICES_DIR", voices_dir)
    monkeypatch.setattr(srv, "_tts", fake)
    monkeypatch.setattr(srv, "_history", None)
    monkeypatch.setattr(srv, "_voice_catalog", None)
    monkeypatch.setattr(srv, "_text_chunker", None)

    srv.app.config["TESTING"] = True
    ctx = {"fake": fake, "output_dir": out_dir, "voices_dir": voices_dir, "srv": srv}
    with srv.app.test_client() as client:
        yield client, ctx
