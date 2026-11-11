"""Hugging Face Spaces entrypoint (runs FastAPI + Uvicorn on port 7860 using the free Gradio SDK)."""
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

import uvicorn
from app.main import app

# If the Space is (mistakenly) set to ZeroGPU hardware, Hugging Face requires at least one
# @spaces.GPU function at startup. This no-op satisfies that check; it is harmless on CPU hardware.
try:
    import spaces  # type: ignore

    @spaces.GPU
    def _zerogpu_noop() -> None:
        return None
except Exception:
    pass

if __name__ == "__main__":
    port = int(os.getenv("PORT", os.getenv("GRADIO_SERVER_PORT", "7860")))
    host = os.getenv("HOST", "0.0.0.0")
    uvicorn.run(app, host=host, port=port, log_level="info")
