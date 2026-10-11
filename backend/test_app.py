import io
import wave

from fastapi.testclient import TestClient
from backend import app as service


def test_missing_voice_is_reported_without_loading_a_model(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "VOICE_PATH", tmp_path / "missing.onnx")
    client = TestClient(service.app)
    assert client.get("/api/health").json()["piper_ready"] is False
    assert client.post("/api/speech", json={"text": "你好"}).status_code == 503


def test_invalid_text_and_rate_are_rejected():
    client = TestClient(service.app)
    for data in ({"text": ""}, {"text": "x" * 501}, {"text": "你好", "rate": 9}, {"text": "  "}):
        assert client.post("/api/speech", json=data).status_code == 422


def test_speech_returns_a_real_wav_container(tmp_path, monkeypatch):
    voice = tmp_path / "voice.onnx"
    voice.touch(); (tmp_path / "voice.onnx.json").touch()
    monkeypatch.setattr(service, "VOICE_PATH", voice)

    class FakeVoice:
        def synthesize_wav(self, text, wav, syn_config):
            assert text == "你好"
            assert syn_config.length_scale == 1 / 1.2
            wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(22050)
            wav.writeframes(b"\x00\x00" * 100)

    monkeypatch.setattr(service, "_voice", FakeVoice())
    response = TestClient(service.app).post("/api/speech", json={"text": "你好", "rate": 1.2})
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    with wave.open(io.BytesIO(response.content)) as wav:
        assert wav.getframerate() == 22050
        assert wav.getnframes() == 100
