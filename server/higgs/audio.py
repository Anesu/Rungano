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


def trim_silence(wav_bytes: bytes, threshold_ratio: float = 0.01, pad_sec: float = 0.3, window_ms: int = 50) -> bytes:
    """Trim trailing low-energy audio. Used on single-chunk /api/tts only."""
    if not wav_bytes:
        return wav_bytes
    with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
        params = wf.getparams()
        framerate = params.framerate
        nframes = params.nframes
        frames = wf.readframes(nframes)
    fmt = f"<{nframes}h"
    samples = list(struct.unpack(fmt, frames))
    peak = max(abs(s) for s in samples)
    if peak == 0:
        return wav_bytes
    threshold = int(peak * threshold_ratio)
    window_frames = max(1, int(framerate * window_ms / 1000))
    last_loud_window_end = 0
    for start in range(0, nframes - window_frames, window_frames):
        end = start + window_frames
        window_avg = sum(abs(s) for s in samples[start:end]) / window_frames
        if window_avg > threshold:
            last_loud_window_end = end
    if last_loud_window_end == 0:
        return wav_bytes
    pad_frames = int(framerate * pad_sec)
    cut_idx = min(last_loud_window_end + pad_frames, nframes)
    if cut_idx >= nframes - window_frames:
        return wav_bytes
    trimmed_samples = samples[:cut_idx]
    new_nframes = len(trimmed_samples)
    buf = io.BytesIO()
    new_params = params._replace(nframes=new_nframes)
    with wave.open(buf, "wb") as wf:
        wf.setparams(new_params)
        wf.writeframes(struct.pack(f"<{new_nframes}h", *trimmed_samples))
    return buf.getvalue()
