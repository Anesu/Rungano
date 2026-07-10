"""Tests for higgs.history — persistence, resolution, session grouping."""
import json

import pytest

from higgs.history import HistoryStore


@pytest.fixture
def store(tmp_path):
    return HistoryStore(output_dir=tmp_path)


def _save(store, entry_id, text="hello", run_id=None):
    path = store.make_output_path(entry_id)
    path.write_bytes(b"RIFFfake")
    store.save(entry_id=entry_id, text=text, voice_id="default",
               references=None, file_path=path, elapsed_sec=1.5, run_id=run_id)
    return path


def test_save_and_list_all(store):
    _save(store, "aaa111", text="first")
    entries = store.list_all()
    assert len(entries) == 1
    assert entries[0]["id"] == "aaa111"
    assert entries[0]["text"] == "first"


def test_resolve_path_finds_wav(store):
    path = _save(store, "bbb222")
    assert store.resolve_path("bbb222") == path
    assert store.resolve_path("does-not-exist") is None


def test_delete_removes_entry(store):
    _save(store, "ccc333")
    assert store.delete("ccc333") is True
    assert store.resolve_path("ccc333") is None
    assert store.delete("ccc333") is False


def test_make_output_path_scheme(store):
    path = store.make_output_path("dead12")
    assert path.suffix == ".wav"
    assert path.stem.endswith("-dead12")
    assert path.parent.name.count("-") == 2  # YYYY-MM-DD


def test_sessions_group_by_run_id(store):
    for i in range(3):
        _save(store, f"run1-{i}", text=f"sentence {i}", run_id="runA")
    for i in range(2):
        _save(store, f"run2-{i}", text=f"other {i}", run_id="runB")
    sessions = store.list_sessions()
    assert len(sessions) == 2
    counts = sorted(s["sentence_count"] for s in sessions)
    assert counts == [2, 3]


def test_sessions_files_and_ids_in_synthesis_order(store):
    paths = [_save(store, f"ord-{i}", text=f"s{i}", run_id="runC") for i in range(3)]
    (session,) = store.list_sessions()
    assert session["ids"] == ["ord-0", "ord-1", "ord-2"]
    assert len(session["files"]) == 3
    assert session["first_text"] == "s0"


def test_sessions_legacy_entries_without_run_id_group_by_minute(store):
    # Legacy metas: same minute prefix, no run_id
    day = store._today_dir()
    for i, eid in enumerate(["leg1", "leg2"]):
        meta = {"id": eid, "text": f"t{i}", "file": f"x/{eid}.wav",
                "elapsed_sec": 1, "created_at": 100 + i}
        (day / f"1234{i:02d}-{eid}.json").write_text(json.dumps(meta), encoding="utf-8")
    (session,) = store.list_sessions()
    assert session["sentence_count"] == 2


def test_corrupt_json_is_skipped(store):
    _save(store, "good01")
    (store._today_dir() / "999999-corrupt.json").write_text("{not json", encoding="utf-8")
    assert len(store.list_all()) == 1
