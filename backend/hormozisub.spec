# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for HormoziSub Studio desktop app.
Build:   pyinstaller hormozisub.spec --distpath ../dist --workpath ../build --noconfirm
Output:  dist/HormoziSub/HormoziSub.exe
"""

from pathlib import Path

block_cipher = None

BACKEND_DIR   = Path(SPECPATH)
FRONTEND_DIST = BACKEND_DIR.parent / "frontend" / "dist"
ASSETS_DIR    = BACKEND_DIR / "assets"
VENV_PKGS     = BACKEND_DIR / ".venv" / "Lib" / "site-packages"
FFMPEG_BIN    = VENV_PKGS / "imageio_ffmpeg" / "binaries" / "ffmpeg-win-x86_64-v9.0.2.exe"
WEBVIEW_HOOK  = str(VENV_PKGS / "webview" / "__pyinstaller")

hidden = [
    "uvicorn.logging",
    "uvicorn.loops", "uvicorn.loops.auto", "uvicorn.loops.asyncio",
    "uvicorn.protocols", "uvicorn.protocols.http", "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl", "uvicorn.protocols.http.httptools_impl",
    "uvicorn.protocols.websockets", "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.websockets_impl",
    "uvicorn.protocols.websockets.wsproto_impl",
    "uvicorn.lifespan", "uvicorn.lifespan.off", "uvicorn.lifespan.on",
    "starlette.routing", "starlette.staticfiles", "starlette.responses",
    "starlette.middleware.cors",
    "fastapi.routing",
    "pydantic.deprecated.class_validators", "pydantic_core",
    "arabic_reshaper", "bidi.algorithm",
    "PIL._imagingtk", "PIL.Image",
    "numpy", "numpy.core._multiarray_umath",
    "cv2",
    "fontTools", "fontTools.ttLib",
    "webview", "webview.platforms.winforms", "webview.platforms.edgechromium",
    "httpx", "anyio", "anyio._backends._asyncio", "sniffio",
    "multipart", "python_multipart",
]

datas = [
    (str(FRONTEND_DIST), "frontend/dist"),
    (str(ASSETS_DIR),    "assets"),
    (str(FFMPEG_BIN),    "imageio_ffmpeg/binaries"),
]

a = Analysis(
    [str(BACKEND_DIR / "desktop.py")],
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
    name="HormoziSub",
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
    name="HormoziSub",
)
