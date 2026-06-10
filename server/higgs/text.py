"""
TextChunker — deep module for text segmentation strategies.

Small interface: chunk(text) → list[str]. The implementation handles
spaCy model loading, regex fallback, and strategy selection internally.

Strategies:
  - "sentence": spaCy en_core_web_sm segmentation (default)
  - "regex":    simple regex split on sentence-ending punctuation

The caller just asks for chunks. How they're produced is the module's business.
"""
from __future__ import annotations

import logging
import re

logger = logging.getLogger("higgs.text")

# ── Strategy implementations (private) ─────────────────────────────────

def _split_regex(text: str) -> list[str]:
    """Fallback: split on sentence-ending punctuation + whitespace / paragraph breaks."""
    parts = re.split(r"(?<=[.!?])\s+|\n\n+", text)
    return [p.strip() for p in parts if p.strip()]


def _split_spacy(text: str, nlp) -> list[str]:
    """spaCy sentence segmentation. Handles abbreviations, quotes, ellipsis."""
    doc = nlp(text)
    return [sent.text.strip() for sent in doc.sents if sent.text.strip()]


# ── Public module ──────────────────────────────────────────────────────

class TextChunker:
    """Segment text into chunks using pluggable strategies.

    >>> chunker = TextChunker()
    >>> chunker.chunk("Hello there. How are you?")
    ['Hello there.', 'How are you?']
    """

    def __init__(self, strategy: str = "sentence"):
        if strategy not in ("sentence", "regex"):
            raise ValueError(f"Unknown strategy: {strategy!r}. Use 'sentence' or 'regex'.")
        self._strategy = strategy
        self._nlp = None

        if strategy == "sentence":
            try:
                import spacy
                self._nlp = spacy.load("en_core_web_sm")
                logger.info("TextChunker: spaCy en_core_web_sm loaded")
            except Exception:
                logger.warning("TextChunker: spaCy unavailable, falling back to regex")
                # self._strategy stays "sentence" — degradation is internal only

    def chunk(self, text: str) -> list[str]:
        """Return a list of sentence strings from `text`."""
        if not text.strip():
            return [text]
        if self._strategy == "sentence" and self._nlp is not None:
            result = _split_spacy(text, self._nlp)
        else:
            result = _split_regex(text)
        return result if result else [text]

    @property
    def strategy(self) -> str:
        return self._strategy
