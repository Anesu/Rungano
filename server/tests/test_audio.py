"""Tests for higgs.audio — gain, silence, concatenation, trimming."""
import io
import struct
import wave

from conftest import make_wav, read_samples
from higgs.audio import apply_gain, concat_wavs, silence_ms, trim_silence


def test_apply_gain_scales_samples(tone_wav):
    original = read_samples(tone_wav)
    boosted = read_samples(apply_gain(tone_wav, gain=2.0))
    assert len(boosted) == len(original)
    # Non-clipped samples double
    for o, b in zip(original, boosted):
        if abs(o * 2) <= 32767:
            assert b == int(o * 2)


def test_apply_gain_unity_is_passthrough(tone_wav):
    assert apply_gain(tone_wav, gain=1.0) == tone_wav


def test_apply_gain_clips_instead_of_wrapping():
    loud = make_wav(amplitude=30000)
    boosted = read_samples(apply_gain(loud, gain=2.0))
    # apply_gain clamps symmetrically to ±32767
    assert max(boosted) == 32767
    assert min(boosted) == -32767


def test_apply_gain_empty_bytes():
    assert apply_gain(b"", gain=1.8) == b""


def test_silence_ms_duration():
    wav = silence_ms(500, sample_rate=24000)
    with wave.open(io.BytesIO(wav), "rb") as wf:
        assert wf.getnframes() == 12000
        assert wf.getframerate() == 24000
    assert all(s == 0 for s in read_samples(wav))


def test_concat_wavs_single_returns_unchanged(tone_wav):
    assert concat_wavs([tone_wav]) == tone_wav


def test_concat_wavs_length_with_gap():
    a, b = make_wav(seconds=0.5), make_wav(seconds=0.5)
    merged = concat_wavs([a, b], crossfade_ms=0, gap_ms=300)
    samples = read_samples(merged)
    # 0.5s + 0.3s gap + 0.5s at 24 kHz; crossfade_ms=0 still overlaps 1 frame
    expected = int(24000 * 1.3)
    assert abs(len(samples) - expected) <= 2


def test_concat_wavs_skips_mismatched_formats(tone_wav):
    other = make_wav(framerate=44100)
    merged = concat_wavs([tone_wav, other], crossfade_ms=0, gap_ms=0)
    with wave.open(io.BytesIO(merged), "rb") as wf:
        assert wf.getframerate() == 24000  # mismatched clip dropped


def test_trim_silence_removes_trailing_quiet():
    speech = make_wav(seconds=0.5)
    tail = silence_ms(2000)  # 2s of silence
    with wave.open(io.BytesIO(speech), "rb") as wf:
        p = wf.getparams()
        speech_frames = wf.readframes(p.nframes)
    with wave.open(io.BytesIO(tail), "rb") as wf:
        tail_frames = wf.readframes(wf.getnframes())
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setparams(p._replace(nframes=0))
        wf.writeframes(speech_frames + tail_frames)
    padded = buf.getvalue()

    trimmed = trim_silence(padded, pad_sec=0.3)
    n_trimmed = len(read_samples(trimmed))
    n_padded = len(read_samples(padded))
    assert n_trimmed < n_padded
    # Speech (0.5s) + ~0.3s pad kept, most of the 2s tail gone
    assert n_trimmed <= int(24000 * 0.9)
    assert n_trimmed >= int(24000 * 0.5)


def test_trim_silence_no_trailing_silence_is_noop(tone_wav):
    assert trim_silence(tone_wav) == tone_wav
