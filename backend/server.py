"""Headless FastAPI backend server for MedSub Studio."""
import multiprocessing
import os
import sys
import uvicorn
from app.main import app

if __name__ == "__main__":
    multiprocessing.freeze_support()
    port = int(os.getenv("PORT", "8000"))
    host = os.getenv("HOST", "0.0.0.0")
    for arg in sys.argv[1:]:
        if arg.startswith("--port="):
            port = int(arg.split("=")[1])
        elif arg.startswith("--host="):
            host = arg.split("=")[1]
    uvicorn.run(app, host=host, port=port, log_level="info")
