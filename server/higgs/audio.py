"""
Audio post-processing: WAV normalisation, concatenation, silence generation.

No heavy dependencies — uses stdlib `wave` + `struct` for 16-bit PCM.
"""
from __future__ import annotations

import io
import struct
import wave


def apply_gain(wav_bytes: bytes, gain: float = 1.8) -> bytes:
    """Amplify a 16-bit mono WAV by `gain` (linear multiplier). Clips to [-32768, 32767]."""
    if not wav_bytes or gain == 1.0:
        return wav_bytes
    with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
        params = wf.getparams()
        frames = wf.readframes(params.nframes)
    fmt = f"<{params.nframes}h"
    samples = list(struct.unpack(fmt, frames))
    peak = 32767
    amplified = [max(-peak, min(peak, int(s * gain))) for s in samples]
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setparams(params)
        wf.writeframes(struct.pack(fmt, *amplified))
    return buf.getvalue()


def silence_ms(duration_ms: int, sample_rate: int = 24000, nchannels: int = 1, sampwidth: int = 2) -> bytes:
    """Generate `duration_ms` milliseconds of digital silence as a WAV."""
    nframes = int(sample_rate * duration_ms / 1000)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(nchannels)
        wf.setsampwidth(sampwidth)
        wf.setframerate(sample_rate)
        wf.setnframes(nframes)
        wf.writeframes(b'\x00\x00' * nframes)
    return buf.getvalue()


def concat_wavs(wavs: list[bytes], crossfade_ms: int = 50, gap_ms: int = 300) -> bytes:
    """
    Concatenate WAVs with crossfade between them and optional gap (silence) inserted
    between each pair so the listener can breathe between sentences.
    """
    if not wavs:
        raise ValueError("No WAVs to concatenate")
    if len(wavs) == 1:
        return wavs[0]

    parsed = []
    ref_params = None
    for wav in wavs:
        with wave.open(io.BytesIO(wav), "rb") as wf:
            p = wf.getparams()
            if ref_params is None:
                ref_params = p
            if (p.nchannels, p.sampwidth, p.framerate) != (ref_params.nchannels, ref_params.sampwidth, ref_params.framerate):
                continue
            frames = wf.readframes(p.nframes)
            fmt = f"<{p.nframes}h"
            samples = list(struct.unpack(fmt, frames))
            parsed.append((p, samples))

    if not parsed:
        return wavs[0]

    # Generate gap silence
    gap_samples: list[int] = []
    if gap_ms > 0:
        gap_silence = silence_ms(gap_ms, ref_params.framerate)
        with wave.open(io.BytesIO(gap_silence), "rb") as wf:
            frames = wf.readframes(wf.getnframes())
            fmt = f"<{wf.getnframes()}h"
            gap_samples = list(struct.unpack(fmt, frames))

    xfade_frames = max(1, int(ref_params.framerate * crossfade_ms / 1000))

    output: list[int] = parsed[0][1]
    for i in range(1, len(parsed)):
        # Insert gap silence between chunks
        if gap_samples:
            output.extend(gap_samples)

        prev = output
        curr = parsed[i][1]
        if len(prev) >= xfade_frames and len(curr) >= xfade_frames:
            for j in range(xfade_frames):
                t = j / xfade_frames
                idx_prev = len(prev) - xfade_frames + j
                idx_curr = j
                prev[idx_prev] = int(prev[idx_prev] * (1.0 - t) + curr[idx_curr] * t)
            output.extend(curr[xfade_frames:])
        else:
            output.extend(curr)

    total_frames = len(output)
    buf = io.BytesIO()
    new_params = ref_params._replace(nframes=total_frames)
    with wave.open(buf, "wb") as wf:
        wf.setparams(new_params)
        wf.writeframes(struct.pack(f"<{total_frames}h", *output))
    return buf.getvalue()


def trim_silence(wav_bytes: bytes, abs_threshold: int = 100, pad_sec: float = 0.3) -> bytes:
    """Trim trailing near-silence from a 16-bit mono WAV.

    Uses an absolute sample threshold (not ratio-based) to avoid clipping
    quiet speech. Scans backwards from the end; the first sample above
    `abs_threshold` marks the cutoff, plus `pad_sec` of breathing room.

    Safe default: abs_threshold=100 catches digital noise floor (~±100)
    while preserving real speech (hundreds to thousands).
    """
    if not wav_bytes:
        return wav_bytes
    with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
        params = wf.getparams()
        nframes = params.nframes
        frames = wf.readframes(nframes)
    fmt = f"<{nframes}h"
    samples = list(struct.unpack(fmt, frames))
    pad_frames = int(params.framerate * pad_sec)
    cutoff = nframes
    for i in range(nframes - 1, pad_frames, -1):
        if abs(samples[i]) > abs_threshold:
            cutoff = min(i + pad_frames, nframes)
            break
    # If the cutoff is within the last 10% of the clip, nothing to trim
    if cutoff >= nframes - int(params.framerate * 0.1):
        return wav_bytes
    trimmed = samples[:cutoff]
    buf = io.BytesIO()
    new_params = params._replace(nframes=len(trimmed))
    with wave.open(buf, "wb") as wf:
        wf.setparams(new_params)
        wf.writeframes(struct.pack(f"<{len(trimmed)}h", *trimmed))
    return buf.getvalue()
