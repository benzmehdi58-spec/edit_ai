# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for MedSub Studio desktop app.
Build:   pyinstaller medsub.spec --distpath ../dist --workpath ../build --noconfirm
Output:  dist/MedSub/MedSub.exe
"""

from pathlib import Path

block_cipher = None

BACKEND_DIR   = Path(SPECPATH)
FRONTEND_DIST = BACKEND_DIR.parent / "frontend" / "dist"
ASSETS_DIR    = BACKEND_DIR / "assets"
APP_PKG_DIR   = BACKEND_DIR / "app"
VENV_PKGS     = BACKEND_DIR / ".venv" / "Lib" / "site-packages"
FFMPEG_BIN    = VENV_PKGS / "imageio_ffmpeg" / "binaries" / "ffmpeg-win-x86_64-v9.0.2.exe"
WEBVIEW_HOOK  = str(VENV_PKGS / "webview" / "__pyinstaller")

hidden = [
    # Explicit app packages
    "app",
    "app.main",
    "app.config",
    "app.models",
    "app.services",
    "app.services.font_manager",
    "app.services.frame_renderer",
    "app.services.rtl_layout",
    "app.services.srt_parser",
    "app.services.video_pipeline",
    "app.utils",
    "app.utils.color_utils",
    # FastAPI / Uvicorn
    "uvicorn",
    "uvicorn.logging",
    "uvicorn.loops", "uvicorn.loops.auto", "uvicorn.loops.asyncio",
    "uvicorn.protocols", "uvicorn.protocols.http", "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl", "uvicorn.protocols.http.httptools_impl",
    "uvicorn.protocols.websockets", "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.websockets_impl",
    "uvicorn.protocols.websockets.wsproto_impl",
    "uvicorn.lifespan", "uvicorn.lifespan.off", "uvicorn.lifespan.on",
    "fastapi", "fastapi.routing",
    "starlette", "starlette.routing", "starlette.staticfiles", "starlette.responses",
    "starlette.middleware.cors",
    # Pydantic
    "pydantic", "pydantic_core",
    # Arabic / BiDi
    "arabic_reshaper", "bidi", "bidi.algorithm",
    # Imaging & processing
    "PIL", "PIL._imagingtk", "PIL.Image", "PIL.ImageFont", "PIL.ImageDraw", "PIL.ImageFilter",
    "numpy", "numpy.core._multiarray_umath",
    "cv2",
    "fontTools", "fontTools.ttLib",
    # Webview / WinForms
    "webview", "webview.platforms.winforms", "webview.platforms.edgechromium",
    # HTTP
    "httpx", "anyio", "anyio._backends._asyncio", "sniffio",
    "multipart", "python_multipart",
]

datas = [
    (str(FRONTEND_DIST), "frontend/dist"),
    (str(ASSETS_DIR),    "assets"),
    (str(FFMPEG_BIN),    "imageio_ffmpeg/binaries"),
]

a = Analysis(
    [str(BACKEND_DIR / "server.py")],
    pathex=[str(BACKEND_DIR)],
    binaries=[],
    datas=datas,
    hiddenimports=hidden,
    hookspath=[WEBVIEW_HOOK],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "scipy", "pandas", "IPython", "pytest"],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="MedSub",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="MedSub",
)
