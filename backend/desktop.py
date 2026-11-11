"""
MedSub Studio — Desktop launcher.
Starts the FastAPI/Uvicorn server on a free local port,
then opens a native WebView2 window. Closes server on window close.
"""
import logging
import multiprocessing
import os
import socket
import sys
import threading
import time
import urllib.request
from pathlib import Path

# Required for Windows frozen executables
multiprocessing.freeze_support()

# Setup logging
if getattr(sys, "frozen", False):
    log_dir = Path(sys.executable).parent
else:
    log_dir = Path(__file__).parent

log_file = log_dir / "medsub.log"
logging.basicConfig(
    filename=str(log_file),
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    force=True,
)
logger = logging.getLogger("medsub.desktop")
logger.info("Starting MedSub Desktop launcher...")

import uvicorn
import webview

# Explicit import ensures PyInstaller traces the whole app package
try:
    from app.main import app
    logger.info("FastAPI app imported successfully.")
except Exception as e:
    logger.exception("Failed to import app.main: %s", e)
    raise


def find_free_port(start=8000):
    for port in range(start, start + 100):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    return start


PORT = find_free_port(8000)
logger.info("Using port %d", PORT)

if "--server-only" in sys.argv:
    logger.info("Running in headless server mode...")
    config = uvicorn.Config(
        app=app,
        host="127.0.0.1",
        port=PORT,
        log_level="warning",
        access_log=False,
    )
    server = uvicorn.Server(config)
    server.run()
    sys.exit(0)

server_instance = None


def run_server():
    global server_instance
    try:
        config = uvicorn.Config(
            app=app,
            host="127.0.0.1",
            port=PORT,
            log_level="warning",
            access_log=False,
        )
        server_instance = uvicorn.Server(config)
        server_instance.run()
    except Exception as e:
        logger.exception("Server runtime error: %s", e)


server_thread = threading.Thread(target=run_server, daemon=True)
server_thread.start()

# Wait for server to become responsive (checks every 50ms up to 5s)
ready = False
for i in range(100):
    try:
        req = urllib.request.Request(f"http://127.0.0.1:{PORT}/api/health")
        with urllib.request.urlopen(req, timeout=0.5) as resp:
            if resp.status == 200:
                ready = True
                logger.info("Server ready after %.2f seconds", (i + 1) * 0.05)
                break
    except Exception:
        time.sleep(0.05)

if not ready:
    logger.error("Server health check timed out on port %d", PORT)

window = webview.create_window(
    "MedSub Studio",
    f"http://127.0.0.1:{PORT}",
    width=1400,
    height=900,
    min_size=(1050, 740),
    text_select=True,
)


def on_closed():
    logger.info("Window closed. Stopping server...")
    if server_instance:
        server_instance.should_exit = True


window.events.closed += on_closed

logger.info("Starting WebView2...")
webview.start()
logger.info("MedSub Studio terminated cleanly.")
