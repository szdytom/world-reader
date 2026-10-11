"""Optional Piper service. Video inference runs entirely in the browser."""

from __future__ import annotations

import io
import logging
import os
import threading
import wave
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent
VOICE_PATH = Path(os.getenv("PIPER_VOICE", str(ROOT / "models/zh_CN-huayan-medium.onnx")))
app = FastAPI(title="世界阅读器 · Piper", version="1.0.0")
_voice = None
_lock = threading.Lock()
logger = logging.getLogger(__name__)


class SpeechRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    rate: float = Field(default=1.0, ge=0.7, le=1.5)


@app.get("/api/health")
def health():
    try:
        import piper  # noqa: F401
        installed = True
    except ImportError:
        installed = False
    return {
        "piper_ready": installed and VOICE_PATH.is_file() and Path(f"{VOICE_PATH}.json").is_file(),
        "voice": VOICE_PATH.stem,
        "loaded": _voice is not None,
    }


@app.post("/api/speech")
def speech(request: SpeechRequest):
    global _voice
    text = request.text.strip()
    if not text:
        raise HTTPException(422, "朗读文字不能为空。")
    if not VOICE_PATH.is_file() or not Path(f"{VOICE_PATH}.json").is_file():
        raise HTTPException(503, "Piper 中文音色尚未下载，请先运行 python backend/download_voice.py。")
    try:
        from piper import PiperVoice, SynthesisConfig
        # Piper's ONNX session and phonemizer share mutable state; serialize calls.
        with _lock:
            if _voice is None:
                _voice = PiperVoice.load(str(VOICE_PATH))
            audio = io.BytesIO()
            with wave.open(audio, "wb") as wav:
                _voice.synthesize_wav(text, wav, syn_config=SynthesisConfig(length_scale=1 / request.rate))
        return Response(audio.getvalue(), media_type="audio/wav", headers={"Cache-Control": "no-store"})
    except ImportError as exc:
        logger.exception("Piper dependency missing")
        raise HTTPException(503, "Piper 中文依赖未安装，请安装 backend/requirements.txt 中的依赖。") from exc
    except Exception as exc:
        logger.exception("Piper synthesis failed")
        raise HTTPException(503, "Piper 合成失败，请检查服务日志和中文音色文件。") from exc


# Production: the same origin serves the PWA and optional voice API.
if (ROOT / "dist").is_dir():
    app.mount("/", StaticFiles(directory=ROOT / "dist", html=True), name="pwa")
