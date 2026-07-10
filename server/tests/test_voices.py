"""Tests for higgs.voices — catalog, upload, resolution, removal."""
import pytest

from higgs.voices import VoiceCatalog, _sanitize_name

PRESETS = (
    {"id": "default", "name": "Default", "kind": "preset"},
)


@pytest.fixture
def catalog(tmp_path):
    return VoiceCatalog(voices_dir=tmp_path, preset_voices=PRESETS)


def test_sanitize_name_strips_path_hostile_chars():
    assert _sanitize_name('a<b>:c"/d\\e|f?g*h') == "a_b__c__d_e_f_g_h"
    assert _sanitize_name("...") == "voice"
    assert len(_sanitize_name("x" * 200)) == 50


def test_add_custom_and_list(catalog, tmp_path):
    vid = catalog.add_custom(name="Anesu", language="shona",
                             audio_bytes=b"RIFFdata", audio_filename="clip.wav",
                             transcript="mhoro")
    voices = catalog.custom_voices()
    assert len(voices) == 1
    v = voices[0]
    assert v["id"] == vid
    assert v["language"] == "shona"
    assert v["transcript"] == "mhoro"
    assert (tmp_path / "shona" / "Anesu" / "reference.wav").exists()


def test_add_custom_preserves_container_extension(catalog, tmp_path):
    catalog.add_custom(name="Mp3Voice", language="english",
                       audio_bytes=b"ID3data", audio_filename="clip.mp3")
    assert (tmp_path / "english" / "Mp3Voice" / "reference.mp3").exists()
    (v,) = catalog.custom_voices()
    assert v["audio_path"].endswith("reference.mp3")


def test_add_custom_unknown_extension_defaults_to_wav(catalog, tmp_path):
    catalog.add_custom(name="Weird", language="english",
                       audio_bytes=b"x", audio_filename="clip.xyz")
    assert (tmp_path / "english" / "Weird" / "reference.wav").exists()


def test_resolve_preset_and_custom(catalog):
    assert catalog.resolve("default")["kind"] == "preset"
    vid = catalog.add_custom(name="V", language="english", audio_bytes=b"x")
    assert catalog.resolve(vid)["kind"] == "custom"
    assert catalog.resolve("nope") is None


def test_all_voices_presets_first(catalog):
    catalog.add_custom(name="V", language="english", audio_bytes=b"x")
    voices = catalog.all_voices()
    assert voices[0]["id"] == "default"
    assert len(voices) == 2


def test_remove_custom(catalog, tmp_path):
    vid = catalog.add_custom(name="Gone", language="english", audio_bytes=b"x")
    assert catalog.remove_custom(vid) is True
    assert catalog.custom_voices() == []
    assert not (tmp_path / "english" / "Gone").exists()
    assert catalog.remove_custom(vid) is False
