"""
HiggsTTS — deep module: small stable interface over the SGLang-Omni HTTP API.

This is the TTS adapter. It owns:
  - building the /v1/audio/speech request bodies (with control tokens, voice refs)
  - non-streaming synthesis (returns raw WAV bytes)
  - streaming synthesis (yields PCM chunks as they arrive via SSE)

The renderer / Flask layer never talks to SGLang-Omni directly — it goes
through this module. That gives us a single place to:
  - inject control tags from UI selections (emotion, style, prosody, sfx)
  - swap serving backends later (e.g. vLLM, transformers) without touching callers
"""
from __future__ import annotations

import json
import logging
from typing import Any

import requests

logger = logging.getLogger("higgs.core")

# ── Control token reference (mirrors the model card) ─────────────────
EMOTIONS = (
    "elation", "amusement", "enthusiasm", "determination", "pride",
    "contentment", "affection", "relief", "contemplation", "confusion",
    "surprise", "awe", "longing", "arousal", "anger", "fear", "disgust",
    "bitterness", "sadness", "shame", "helplessness",
)
STYLES = ("singing", "shouting", "whispering")
PROSODY = (
    "speed_very_slow", "speed_slow", "speed_fast", "speed_very_fast",
    "pitch_low", "pitch_high",
    "pause", "long_pause",
    "expressive_high", "expressive_low",
)
SOUND_EFFECTS = (
    "cough", "laughter", "crying", "screaming", "burping",
    "humming", "sigh", "sniff", "sneeze",
)


def build_input_text(text: str, *,
                     emotion: str | None = None,
                     style: str | None = None,
                     prosody: list[str] | None = None,
                     sfx: list[tuple[str, str]] | None = None) -> str:
    """
    Prepend a single block of control tokens to the text. Multiple tokens
    from different categories can be combined. The model also supports
    inline (mid-text) tags, but the UI uses a simple "global prefix" model
    for v0.1 — users who want fine control can still type tags directly.
    """
    tags: list[str] = []
    if emotion and emotion in EMOTIONS:
        tags.append(f"<|emotion:{emotion}|>")
    if style and style in STYLES:
        tags.append(f"<|style:{style}|>")
    for p in prosody or []:
        if p in PROSODY:
            tags.append(f"<|prosody:{p}|>")
    for sfx_token, onomatopoeia in (sfx or []):
        if sfx_token in SOUND_EFFECTS and onomatopoeia:
            tags.append(f"<|sfx:{sfx_token}|>{onomatopoeia}")
    if tags:
        return "".join(tags) + text
    return text


class HiggsTTS:
    """
    Thin client for SGLang-Omni's /v1/audio/speech endpoint.

    OpenAI-compatible payload:
        {
          "input":          "<|emotion:amusement|>Hello there",
          "references":     [{"audio_path": "...", "text": "..."}],   # optional
          "temperature":    0.8,
          "top_k":          50,
          "max_new_tokens": 1024,
          "stream":         true|false
        }
    """

    def __init__(self, sglang_url: str, timeout: int = 600):
        self.sglang_url = sglang_url.rstrip("/")
        self.timeout = timeout
        self._session = requests.Session()

    def synthesize(self, *,
                   text: str,
                   references: list[dict] | None = None,
                   temperature: float = 0.8,
                   top_k: int = 50,
                   top_p: float = 0.9,
                   max_new_tokens: int = 1024) -> bytes:
        """Non-streaming. Returns the complete WAV file bytes."""
        payload: dict[str, Any] = {
            "input": text,
            "temperature": temperature,
            "top_k": top_k,
            "top_p": top_p,
            "max_new_tokens": max_new_tokens,
            "stream": False,
        }
        if references:
            payload["references"] = references
        url = f"{self.sglang_url}/v1/audio/speech"
        logger.info("Synthesising %d chars (refs=%d) → %s", len(text), len(references or []), url)
        r = self._session.post(url, json=payload, timeout=self.timeout)
        r.raise_for_status()
        return r.content
