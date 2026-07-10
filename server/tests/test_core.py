"""Tests for higgs.core — control-token prompt construction."""
from higgs.core import EMOTIONS, PROSODY, SOUND_EFFECTS, STYLES, build_input_text


def test_plain_text_unchanged():
    assert build_input_text("Hello") == "Hello"


def test_emotion_prepended():
    assert build_input_text("Hi", emotion="amusement") == "<|emotion:amusement|>Hi"


def test_invalid_tokens_ignored():
    assert build_input_text("Hi", emotion="joyful", style="rapping",
                            prosody=["speed_ludicrous"]) == "Hi"


def test_all_categories_combined():
    out = build_input_text("Go", emotion="anger", style="shouting",
                           prosody=["speed_fast", "pitch_high"],
                           sfx=[("laughter", "Haha")])
    assert out == ("<|emotion:anger|><|style:shouting|><|prosody:speed_fast|>"
                   "<|prosody:pitch_high|><|sfx:laughter|>HahaGo")


def test_sfx_requires_onomatopoeia():
    assert build_input_text("Hi", sfx=[("laughter", "")]) == "Hi"


def test_catalogues_are_nonempty():
    assert len(EMOTIONS) == 21
    assert len(STYLES) == 3
    assert len(PROSODY) == 10
    assert len(SOUND_EFFECTS) == 9
