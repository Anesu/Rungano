"""
Higgs TTS — immutable configuration.

Single source of truth for runtime knobs. Deep module: small surface, no behaviour.
Follow the Koko pattern: `config` is imported everywhere; overrides are explicit.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass(frozen=True)
class HiggsConfig:
    sglang_url: str = field(default_factory=lambda: os.environ.get("SGLANG_URL", "http://127.0.0.1:8000"))
    request_timeout: int = 600  # 10 min — long-form synthesis can be slow
    port: int = 7861

    # Preset voice catalogue. The model itself doesn't ship named voices —
    # these are conventional labels you can map to a "default" reference, or
    # used as IDs in the UI when the user hasn't supplied a custom clone.
    preset_voices: tuple = (
        {"id": "default", "name": "Default (no clone)", "kind": "preset", "description": "Model's default voice — natural, neutral."},
        {"id": "preset-male-en", "name": "Preset — Male (English)", "kind": "preset", "description": "If you have a bundled reference in voices/preset-male-en.wav, this is used."},
        {"id": "preset-female-en", "name": "Preset — Female (English)", "kind": "preset", "description": "If you have a bundled reference in voices/preset-female-en.wav, this is used."},
    )


config = HiggsConfig()
