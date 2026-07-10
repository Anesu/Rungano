"""Endpoint tests for the Flask proxy, with HiggsTTS faked out."""
import io
import json


def test_health(flask_app):
    client, ctx = flask_app
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.get_json()["flask_ready"] is True


def test_controls_catalogue(flask_app):
    client, _ = flask_app
    d = client.get("/api/controls").get_json()
    assert len(d["emotions"]) == 21
    assert {"singing", "shouting", "whispering"} == set(d["styles"])
    assert all("token" in s and "suggested" in s for s in d["sfx"])


def test_voices_default_preset(flask_app):
    client, _ = flask_app
    d = client.get("/api/voices").get_json()
    assert d["voices"][0]["id"] == "default"


def test_voice_upload_and_delete(flask_app):
    client, _ = flask_app
    r = client.post("/api/voices/custom", data={
        "name": "Test Voice", "language": "shona", "transcript": "mhoro",
        "audio": (io.BytesIO(b"RIFFfake"), "clip.wav"),
    }, content_type="multipart/form-data")
    assert r.status_code == 200
    vid = r.get_json()["id"]

    d = client.get("/api/voices/custom").get_json()
    assert any(v["id"] == vid for v in d["voices"])

    assert client.delete(f"/api/voices/custom/{vid}").status_code == 200
    assert client.delete(f"/api/voices/custom/{vid}").status_code == 404


def test_voice_upload_requires_name_and_audio(flask_app):
    client, _ = flask_app
    r = client.post("/api/voices/custom", data={"name": "x"},
                    content_type="multipart/form-data")
    assert r.status_code == 400
    r = client.post("/api/voices/custom", data={
        "audio": (io.BytesIO(b"x"), "a.wav"),
    }, content_type="multipart/form-data")
    assert r.status_code == 400


def test_tts_single(flask_app):
    client, ctx = flask_app
    r = client.post("/api/tts", json={"text": "Mhoro shamwari.",
                                      "controls": {"emotion": "amusement"}})
    assert r.status_code == 200
    d = r.get_json()
    assert d["file"].startswith("/audio/")
    # Control tags reach the model but not the history record
    assert ctx["fake"].calls[0]["text"].startswith("<|emotion:amusement|>")
    entry = client.get("/api/history").get_json()["entries"][0]
    assert entry["text"] == "Mhoro shamwari."


def test_tts_requires_text(flask_app):
    client, _ = flask_app
    assert client.post("/api/tts", json={"text": " "}).status_code == 400
    assert client.post("/api/tts/batch", json={}).status_code == 400


def test_batch_returns_ids_and_groups_one_session(flask_app):
    client, _ = flask_app
    r = client.post("/api/tts/batch",
                    json={"text": "One. Two. Three.", "voice_id": "default"})
    d = r.get_json()
    assert d["total"] == 3 and d["failed"] == 0
    assert all(s["id"] for s in d["sentences"])

    sessions = client.get("/api/history/sessions").get_json()["sessions"]
    assert len(sessions) == 1
    assert sessions[0]["sentence_count"] == 3
    assert len(sessions[0]["files"]) == 3


def test_export_wav_roundtrip(flask_app):
    client, _ = flask_app
    d = client.post("/api/tts/batch", json={"text": "One. Two."}).get_json()
    ids = [s["id"] for s in d["sentences"]]
    r = client.post("/api/export/wav", json={"ids": ids})
    assert r.status_code == 200
    assert r.mimetype == "audio/wav"
    assert r.data[:4] == b"RIFF"


def test_export_wav_bad_ids(flask_app):
    client, _ = flask_app
    assert client.post("/api/export/wav", json={"ids": []}).status_code == 400
    assert client.post("/api/export/wav", json={"ids": ["nope"]}).status_code == 404


def test_batch_stream_sse_events(flask_app):
    client, _ = flask_app
    r = client.post("/api/tts/batch/stream", json={"text": "One. Two."})
    assert r.status_code == 200
    events = [json.loads(line[6:]) for line in r.data.decode().split("\n")
              if line.startswith("data: ")]
    types = [e["type"] for e in events]
    assert types[0] == "start" and events[0]["total"] == 2
    assert types.count("sentence") == 2
    assert types[-1] == "done"
    assert all(e.get("id") for e in events if e["type"] == "sentence")


def test_serve_audio_blocks_traversal(flask_app):
    client, _ = flask_app
    r = client.get("/audio/..%2F..%2Fsecret.txt")
    assert r.status_code in (403, 404)


def test_history_delete(flask_app):
    client, _ = flask_app
    d = client.post("/api/tts", json={"text": "Bye."}).get_json()
    eid = d["id"]
    assert client.delete(f"/api/history/{eid}").get_json()["ok"] is True
    assert client.get("/api/history").get_json()["entries"] == []
