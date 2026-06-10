"""
Higgs TTS — immutable configuration.

Single source of truth for runtime knobs. Deep module: small surface, no behaviour.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass(frozen=True)
class HiggsConfig:
    sglang_url: str = field(default_factory=lambda: os.environ.get("SGLANG_URL", "http://127.0.0.1:8000"))
    request_timeout: int = 600
    port: int = 7861

    # Only the model's default voice is a preset. All real voices come from
    # the voices/<language>/<name>/ directory structure.
    preset_voices: tuple = (
        {"id": "default", "name": "Default (no clone)", "kind": "preset",
         "description": "Model's default voice — natural, neutral."},
    )


config = HiggsConfig()
