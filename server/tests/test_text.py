"""Tests for higgs.text — sentence chunking (regex strategy)."""
import pytest

from higgs.text import TextChunker


@pytest.fixture
def chunker():
    return TextChunker(strategy="regex")


def test_basic_sentences(chunker):
    assert chunker.chunk("Hello there. How are you? I am fine!") == [
        "Hello there.", "How are you?", "I am fine!",
    ]


def test_paragraph_breaks_split(chunker):
    out = chunker.chunk("First paragraph without punctuation\n\nSecond paragraph")
    assert out == ["First paragraph without punctuation", "Second paragraph"]


def test_single_sentence_no_terminal_punctuation(chunker):
    assert chunker.chunk("Mhoro shamwari") == ["Mhoro shamwari"]


def test_empty_and_whitespace_return_input(chunker):
    assert chunker.chunk("") == [""]
    assert chunker.chunk("   ") == ["   "]


def test_unknown_strategy_rejected():
    with pytest.raises(ValueError):
        TextChunker(strategy="paragraph")


def test_sentence_strategy_degrades_gracefully():
    # spaCy may or may not be installed; either way chunk() must work
    c = TextChunker(strategy="sentence")
    out = c.chunk("One. Two. Three.")
    assert len(out) == 3
