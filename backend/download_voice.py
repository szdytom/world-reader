"""Download the Chinese Piper voice to the local models directory."""
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main/zh/zh_CN/huayan/medium/"


def main():
    target = ROOT / "models"
    target.mkdir(exist_ok=True)
    for filename in ("zh_CN-huayan-medium.onnx", "zh_CN-huayan-medium.onnx.json", "MODEL_CARD"):
        destination = target / filename
        if destination.exists():
            print(f"Already downloaded: {filename}")
            continue
        print(f"Downloading {filename}…", flush=True)
        temporary = destination.with_suffix(destination.suffix + ".part")
        try:
            urllib.request.urlretrieve(BASE + filename, temporary)
            temporary.replace(destination)
        finally:
            temporary.unlink(missing_ok=True)
    print("中文音色已就绪。启动：.venv/bin/uvicorn backend.app:app --host 0.0.0.0 --port 8000")


if __name__ == "__main__":
    main()
