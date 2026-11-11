"""Central configuration: filesystem paths, default render settings, preset fonts, FFmpeg, and AI keys."""

from __future__ import annotations

import os
import shutil
import sys
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Tuple

# --------------------------------------------------------------------------- #
# Filesystem layout
# --------------------------------------------------------------------------- #
IS_FROZEN = getattr(sys, "frozen", False)

if IS_FROZEN:
    BUNDLE_DIR: Path = Path(sys._MEIPASS)
    APP_DIR: Path = Path(sys.executable).parent

    ASSETS_DIR: Path = BUNDLE_DIR / "assets"
    FONTS_DIR: Path = ASSETS_DIR / "fonts"
    CUSTOM_FONTS_DIR: Path = FONTS_DIR / "custom"
    SFX_DIR: Path = APP_DIR / "assets" / "sfx"

    STORAGE_DIR: Path = APP_DIR / "storage"
    UPLOADS_DIR: Path = STORAGE_DIR / "uploads"
    UPLOADED_FONTS_DIR: Path = UPLOADS_DIR / "fonts"
    OUTPUTS_DIR: Path = STORAGE_DIR / "outputs"
    BROLL_CACHE_DIR: Path = STORAGE_DIR / "broll_cache"
    TEMP_DIR: Path = OUTPUTS_DIR / ".tmp"

    FRONTEND_DIR: Path = BUNDLE_DIR / "frontend"
else:
    BACKEND_DIR: Path = Path(__file__).resolve().parent.parent
    PROJECT_ROOT: Path = BACKEND_DIR.parent

    ASSETS_DIR: Path = BACKEND_DIR / "assets"
    FONTS_DIR: Path = ASSETS_DIR / "fonts"
    CUSTOM_FONTS_DIR: Path = FONTS_DIR / "custom"
    SFX_DIR: Path = ASSETS_DIR / "sfx"

    STORAGE_DIR: Path = BACKEND_DIR / "storage"
    UPLOADS_DIR: Path = STORAGE_DIR / "uploads"
    UPLOADED_FONTS_DIR: Path = UPLOADS_DIR / "fonts"
    OUTPUTS_DIR: Path = STORAGE_DIR / "outputs"
    BROLL_CACHE_DIR: Path = STORAGE_DIR / "broll_cache"
    TEMP_DIR: Path = OUTPUTS_DIR / ".tmp"

    FRONTEND_DIR: Path = PROJECT_ROOT / "frontend"


def _load_dotenv_files() -> None:
    """Load environment variables from .env files in backend/ or project root."""
    try:
        from dotenv import load_dotenv

        if not IS_FROZEN:
            load_dotenv(BACKEND_DIR / ".env", override=True)
            load_dotenv(PROJECT_ROOT / ".env", override=False)
        else:
            load_dotenv(APP_DIR / ".env", override=True)
    except Exception:
        # Fallback lightweight .env parser if python-dotenv is not installed yet
        candidates = [APP_DIR / ".env"] if IS_FROZEN else [BACKEND_DIR / ".env", PROJECT_ROOT / ".env"]
        for env_path in candidates:
            if not env_path.is_file():
                continue
            try:
                for raw_line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
                    line = raw_line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, val = line.split("=", 1)
                    key = key.strip()
                    val = val.strip().strip('"').strip("'")
                    if key:
                        os.environ[key] = val
            except OSError:
                pass


_load_dotenv_files()

ALL_DIRECTORIES: Tuple[Path, ...] = (
    ASSETS_DIR,
    FONTS_DIR,
    CUSTOM_FONTS_DIR,
    SFX_DIR,
    STORAGE_DIR,
    UPLOADS_DIR,
    UPLOADED_FONTS_DIR,
    OUTPUTS_DIR,
    BROLL_CACHE_DIR,
    TEMP_DIR,
    FRONTEND_DIR,
)


def ensure_directories() -> None:
    """Create every runtime directory if it does not exist yet."""
    for directory in ALL_DIRECTORIES:
        try:
            directory.mkdir(parents=True, exist_ok=True)
        except OSError:
            pass


# --------------------------------------------------------------------------- #
# AI / API Keys & Prompts (Phase 2 + Phase 3)
# --------------------------------------------------------------------------- #
def get_groq_api_key() -> str:
    val = os.getenv("GROQ_API_KEY", "").strip()
    return "" if val in ("", "your_groq_api_key_here") else val


def get_gemini_api_key() -> str:
    val = (os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or "").strip()
    return "" if val in ("", "your_gemini_api_key_here") else val


def get_pexels_api_key() -> str:
    val = os.getenv("PEXELS_API_KEY", "").strip()
    return "" if val in ("", "your_pexels_api_key_here") else val


def get_pixabay_api_key() -> str:
    val = os.getenv("PIXABAY_API_KEY", "").strip()
    return "" if val in ("", "your_pixabay_api_key_here") else val


def get_unsplash_access_key() -> str:
    val = (os.getenv("UNSPLASH_ACCESS_KEY") or os.getenv("UNSPLASH_API_KEY") or "").strip()
    return "" if val in ("", "your_unsplash_access_key_here") else val


def get_active_broll_providers() -> List[str]:
    providers: List[str] = []
    if get_unsplash_access_key():
        providers.append("unsplash")
    if get_pixabay_api_key():
        providers.append("pixabay")
    if get_pexels_api_key():
        providers.append("pexels")
    # Zero-API-key providers always active
    providers.extend(["coverr", "wikimedia", "openverse", "internet_archive", "procedural_fallback"])
    return providers


GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"
WHISPER_LOCAL_MODEL: str = os.getenv("WHISPER_LOCAL_MODEL", "small").strip() or "small"

DARIJA_WHISPER_PROMPT: str = (
    "دارجة جزائرية عامية. واش راك، راك حاب تبدا بروجي ولا ستارتاب، "
    "بصح دراهمك راهم يروحو بزاف بلا فايدة، الكليون تاعك ما يشريش، "
    "ديريكتومون، كوموند، سيت ويب، أبليكاسيون، فاستي، أبوني، "
    "Landing Page, Cost Per Click, Conversion, Business, MVP, Features, UI, UX, Sponsorisé"
)

MAX_WORDS_PER_CUE: int = 4
MICRO_PAUSE_BRIDGE_SECONDS: float = 0.25
KINETIC_ENTRANCE_FRAMES: int = 8

# --------------------------------------------------------------------------- #
# API / server settings
# --------------------------------------------------------------------------- #
APP_NAME = "MedSub"
API_PREFIX = "/api"

CORS_ORIGINS: List[str] = [
    origin.strip()
    for origin in os.getenv("HORMOZISUB_CORS_ORIGINS", "*").split(",")
    if origin.strip()
]

MAX_CONCURRENT_RENDERS: int = int(os.getenv("HORMOZISUB_MAX_RENDERS", "2"))

MAX_AUDIO_UPLOAD_BYTES: int = 500 * 1024 * 1024   # 500 MB
MAX_SRT_UPLOAD_BYTES: int = 5 * 1024 * 1024       # 5 MB
MAX_FONT_UPLOAD_BYTES: int = 25 * 1024 * 1024     # 25 MB

ALLOWED_AUDIO_EXTENSIONS = {".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".webm", ".mp4"}
ALLOWED_SRT_EXTENSIONS = {".srt"}
ALLOWED_FONT_EXTENSIONS = {".ttf", ".otf"}
DOWNLOADABLE_EXTENSIONS = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".png": "image/png",
    ".wav": "audio/wav",
    ".srt": "text/plain; charset=utf-8",
    ".zip": "application/zip",
}

# --------------------------------------------------------------------------- #
# Render defaults (consumed by models.RenderConfig)
# --------------------------------------------------------------------------- #
DEFAULT_PREVIEW_TEXT = "دراهمك راهم يروحوا"

DEFAULT_RENDER_SETTINGS: Dict[str, object] = {
    # Core spec
    "box_color_hex": "#FFEB00",
    "text_color_hex": "#FFFFFF",
    "active_text_color_hex": "#FFFFFF",
    "stroke_color_hex": "#000000",
    "green_screen_hex": "#00FF00",
    "transparent_bg": False,
    "font_choice": "Cairo-Bold",
    "font_size": 75,
    "stroke_width": 6,
    "box_radius": 20,
    "box_padding_x": 20,
    "box_padding_y": 14,
    "y_position": 960,
    "fps": 60,
    "width": 1080,
    "height": 1920,
    # Extended styling / timing
    "shadow_enabled": True,
    "shadow_color_hex": "#000000",
    "shadow_offset_x": 0,
    "shadow_offset_y": 6,
    "shadow_blur": 6,
    "shadow_opacity": 0.55,
    "word_spacing": 0,
    "line_spacing": 18,
    "horizontal_margin": 60,
    "min_word_duration": 0.12,
    "words_per_line": 4,
    "max_lines": 1,
    # Phase 2 + Phase 3 AI & Motion Graphics toggles
    "target_language": "darija_mixed",
    "enable_kinetic_text": True,
    "enable_emojis": True,
    "enable_motion_graphics": True,
    "enable_sfx": True,
    "enable_broll": False,
    "sfx_volume_db": -12.0,
}

# --------------------------------------------------------------------------- #
# Preset Google Arabic fonts
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class PresetFont:
    key: str
    family: str
    weight: int
    display_name: str
    urls: Tuple[str, ...]


PRESET_FONTS: Dict[str, PresetFont] = {
    "Cairo-Bold": PresetFont(
        key="Cairo-Bold",
        family="Cairo",
        weight=700,
        display_name="Cairo Bold",
        urls=(
            "https://fonts.gstatic.com/s/cairo/v31/SLXgc1nY6HkvangtZmpQdkhzfH5lkSs2SgRjCAGMQ1z0hAc5W1Q.ttf",
            "https://raw.githubusercontent.com/google/fonts/main/ofl/cairo/Cairo%5Bslnt%2Cwght%5D.ttf",
        ),
    ),
    "Tajawal-Bold": PresetFont(
        key="Tajawal-Bold",
        family="Tajawal",
        weight=700,
        display_name="Tajawal Bold",
        urls=(
            "https://raw.githubusercontent.com/google/fonts/main/ofl/tajawal/Tajawal-Bold.ttf",
            "https://fonts.gstatic.com/s/tajawal/v12/Iurf6YBj_oCad4k1l4qkLrY.ttf",
        ),
    ),
    "Almarai-ExtraBold": PresetFont(
        key="Almarai-ExtraBold",
        family="Almarai",
        weight=800,
        display_name="Almarai ExtraBold",
        urls=(
            "https://raw.githubusercontent.com/google/fonts/main/ofl/almarai/Almarai-ExtraBold.ttf",
            "https://fonts.gstatic.com/s/almarai/v19/tssoApxBaigK_hnnS_qjhng.ttf",
        ),
    ),
    "Changa-Bold": PresetFont(
        key="Changa-Bold",
        family="Changa",
        weight=700,
        display_name="Changa Bold",
        urls=(
            "https://fonts.gstatic.com/s/changa/v29/2-c79JNi2YuVOUcOarRPgnNGooxCZ0q2QjA.ttf",
            "https://raw.githubusercontent.com/google/fonts/main/ofl/changa/Changa%5Bwght%5D.ttf",
        ),
    ),
}

DEFAULT_FONT_KEY = "Cairo-Bold"
FONT_DOWNLOAD_TIMEOUT_SECONDS = 30

# --------------------------------------------------------------------------- #
# Video encoding
# --------------------------------------------------------------------------- #
X264_PRESET: str = os.getenv("HORMOZISUB_X264_PRESET", "medium")
X264_CRF: int = int(os.getenv("HORMOZISUB_X264_CRF", "16"))
AUDIO_BITRATE: str = os.getenv("HORMOZISUB_AUDIO_BITRATE", "192k")

_CODEC_EXTENSIONS: Dict[str, str] = {"MJPG": ".avi", "FFV1": ".mkv", "HFYU": ".avi", "mp4v": ".mp4"}
_FORCED_CODEC = os.getenv("HORMOZISUB_INTERMEDIATE_CODEC", "").strip()
INTERMEDIATE_CODECS: Tuple[Tuple[str, str], ...] = tuple(
    ([(_FORCED_CODEC, _CODEC_EXTENSIONS[_FORCED_CODEC])] if _FORCED_CODEC in _CODEC_EXTENSIONS else [])
    + [(codec, ext) for codec, ext in _CODEC_EXTENSIONS.items() if codec != _FORCED_CODEC]
)


@lru_cache(maxsize=1)
def resolve_ffmpeg_binary() -> str:
    """Locate an FFmpeg executable."""
    env_path = os.getenv("MEDSUB_FFMPEG") or os.getenv("HORMOZISUB_FFMPEG")
    if env_path and Path(env_path).exists():
        return env_path

    if IS_FROZEN:
        bundled = BUNDLE_DIR / "imageio_ffmpeg" / "binaries" / "ffmpeg-win-x86_64-v9.0.2.exe"
        if bundled.exists():
            return str(bundled)
        for cand in (BUNDLE_DIR / "imageio_ffmpeg" / "binaries").glob("ffmpeg*"):
            if cand.is_file():
                return str(cand)

    system_ffmpeg = shutil.which("ffmpeg")
    if system_ffmpeg:
        return system_ffmpeg
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:  # pragma: no cover - environment dependent
        raise RuntimeError(
            "FFmpeg not found. Install FFmpeg, add it to PATH, set MEDSUB_FFMPEG, "
            "or ensure imageio-ffmpeg is installed."
        ) from exc
