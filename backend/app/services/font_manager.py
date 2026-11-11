"""Font manager: auto-downloads preset Google Arabic fonts and manages custom uploads.

All fonts are loaded with Pillow's BASIC layout engine. HormoziSub performs
Arabic shaping (arabic_reshaper) and BiDi reordering (python-bidi) itself, so
letting libraqm shape the text a second time would reverse/garble it.

Presentation-form patching
--------------------------
``arabic_reshaper`` emits Unicode *Arabic Presentation Forms* (U+FB50-U+FEFF).
Modern OpenType Arabic fonts (Cairo, Tajawal, Changa, ...) do NOT map those
code points in their cmap; they shape through GSUB features (init/medi/fina,
rlig) instead, so raw reshaped text renders as tofu boxes. For every font we
therefore build a *shaping-compatible copy* whose cmap maps each presentation
form code point to the glyph the font's own GSUB lookups would produce. The
resulting glyphs are identical to what HarfBuzz would select, while keeping
the pipeline pure Python (no libraqm / FriBiDi system dependency).
"""

from __future__ import annotations

import io
import logging
import re
import threading
import urllib.request
import uuid
from functools import lru_cache
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence

import arabic_reshaper
from arabic_reshaper.letters import LETTERS_ARABIC
from arabic_reshaper.ligatures import LETTERS_LIGATURES, WORDS_LIGATURES
from fontTools.ttLib import TTFont
from PIL import ImageFont

from ..config import (
    ALLOWED_FONT_EXTENSIONS,
    CUSTOM_FONTS_DIR,
    DEFAULT_FONT_KEY,
    FONT_DOWNLOAD_TIMEOUT_SECONDS,
    FONTS_DIR,
    PRESET_FONTS,
    UPLOADED_FONTS_DIR,
    PresetFont,
)

logger = logging.getLogger("hormozisub.fonts")

_SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9_\-]+")


class FontNotFoundError(LookupError):
    """Raised when a font choice cannot be resolved to a usable font file."""


class InvalidFontError(ValueError):
    """Raised when uploaded bytes are not a loadable TrueType/OpenType font."""


def _pin_weight(font: ImageFont.FreeTypeFont, weight: Optional[int]) -> None:
    """If ``font`` is a variable font, pin its weight axis (others stay default)."""
    if weight is None:
        return
    try:
        axes = font.get_variation_axes()
    except Exception:
        return  # static font
    values = []
    for axis in axes:
        name = axis.get("name", b"")
        if isinstance(name, bytes):
            name = name.decode("utf-8", "ignore")
        if str(name).lower() in ("weight", "wght"):
            values.append(max(axis["minimum"], min(axis["maximum"], weight)))
        else:
            values.append(axis.get("default", axis["minimum"]))
    try:
        font.set_variation_by_axes(values)
    except Exception as exc:  # pragma: no cover - font dependent
        logger.debug("Could not pin variable font weight: %s", exc)


_FORM_FEATURES = ("isol", "init", "medi", "fina")  # same order as arabic_reshaper forms
_LIGATURE_FEATURES = ("rlig", "liga", "ccmp", "dlig")
PATCH_VERSION = "pf1"


class _GsubResolver:
    """Minimal GSUB evaluator for single (type 1) and ligature (type 4) lookups."""

    def __init__(self, ttfont: TTFont) -> None:
        self.cmap: Dict[int, str] = ttfont.getBestCmap() or {}
        self.lookups: list = []
        self.features: Dict[str, List[int]] = {}
        if "GSUB" in ttfont and ttfont["GSUB"].table.LookupList is not None:
            table = ttfont["GSUB"].table
            self.lookups = table.LookupList.Lookup
            for record in table.FeatureList.FeatureRecord:
                self.features.setdefault(record.FeatureTag, []).extend(record.Feature.LookupListIndex)
            for tag in self.features:
                self.features[tag] = sorted(set(self.features[tag]))

    def _subtables(self, lookup_index: int) -> Iterable:
        lookup = self.lookups[lookup_index]
        for sub in lookup.SubTable:
            yield getattr(sub, "ExtSubTable", sub)  # unwrap Extension (type 7)

    def single(self, glyph: str, tag: str) -> Optional[str]:
        """Apply every single-substitution lookup of ``tag``; None if unchanged."""
        result = glyph
        for index in self.features.get(tag, ()):
            for sub in self._subtables(index):
                mapping = getattr(sub, "mapping", None)
                if mapping and result in mapping:
                    result = mapping[result]
                    break
        return result if result != glyph else None

    def ligate(self, glyphs: Sequence[str]) -> Optional[str]:
        if len(glyphs) < 2:
            return None
        for tag in _LIGATURE_FEATURES:
            for index in self.features.get(tag, ()):
                for sub in self._subtables(index):
                    ligatures = getattr(sub, "ligatures", None)
                    if not ligatures:
                        continue
                    for ligature in ligatures.get(glyphs[0], ()):
                        if list(ligature.Component) == list(glyphs[1:]):
                            return ligature.LigGlyph
        return None


def _ligature_form_tags(length: int, form_index: int) -> List[str]:
    if form_index == 0:   # isolated
        return ["init"] + ["medi"] * (length - 2) + ["fina"]
    if form_index == 1:   # initial
        return ["init"] + ["medi"] * (length - 1)
    if form_index == 2:   # medial
        return ["medi"] * length
    return ["medi"] * (length - 1) + ["fina"]  # final


def build_presentation_form_font(source: Path, destination: Path) -> int:
    """Write a copy of ``source`` whose cmap covers Arabic presentation forms.

    Returns the number of code points added.
    """
    ttfont = TTFont(str(source), lazy=False)
    resolver = _GsubResolver(ttfont)
    cmap = resolver.cmap
    additions: Dict[int, str] = {}

    # 1. Positional letter forms (fallback: base glyph, never tofu).
    for base_char, forms in LETTERS_ARABIC.items():
        base_glyph = cmap.get(ord(base_char))
        if base_glyph is None:
            continue
        for form_index, tag in enumerate(_FORM_FEATURES):
            form_char = forms[form_index]
            if not form_char or ord(form_char) in cmap:
                continue
            additions[ord(form_char)] = resolver.single(base_glyph, tag) or base_glyph

    # 2. Ligatures (lam-alef etc.) - only when the font really has the ligature glyph.
    for _name, (sequence, forms) in list(LETTERS_LIGATURES) + list(WORDS_LIGATURES):
        if " " in sequence:
            continue
        base_glyphs = [cmap.get(ord(ch)) for ch in sequence]
        if any(glyph is None for glyph in base_glyphs):
            continue
        for form_index, form_char in enumerate(forms):
            if not form_char or ord(form_char) in cmap or ord(form_char) in additions:
                continue
            tags = _ligature_form_tags(len(base_glyphs), form_index)
            positional = [resolver.single(g, t) or g for g, t in zip(base_glyphs, tags)]
            ligature = resolver.ligate(positional) or resolver.ligate(base_glyphs)
            if ligature:
                additions[ord(form_char)] = ligature

    for table in ttfont["cmap"].tables:
        if table.isUnicode():
            for code_point, glyph in additions.items():
                if code_point <= 0xFFFF or table.format in (12, 13):
                    table.cmap.setdefault(code_point, glyph)

    destination.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = destination.with_name(destination.name + ".part")
    ttfont.save(str(tmp_path))
    ttfont.close()
    tmp_path.replace(destination)
    return len(additions)


@lru_cache(maxsize=32)
def _reshaper_for(patched_path: str, mtime_ns: int) -> arabic_reshaper.ArabicReshaper:
    """Font-aware reshaper: ligatures the font cannot draw are disabled."""
    configuration = arabic_reshaper.config_for_true_type_font(patched_path)
    configuration["delete_harakat"] = True
    return arabic_reshaper.ArabicReshaper(configuration=configuration)


@lru_cache(maxsize=64)
def _load_font_cached(path: str, size: int, mtime_ns: int, weight: Optional[int]) -> ImageFont.FreeTypeFont:
    # ``mtime_ns`` is part of the cache key so replacing a custom font file
    # with the same name invalidates the cached instance.
    font = ImageFont.truetype(path, size=size, layout_engine=ImageFont.Layout.BASIC)
    _pin_weight(font, weight)
    return font


class FontManager:
    """Resolves font choices to files, downloading preset fonts on demand."""

    def __init__(
        self,
        fonts_dir: Path = FONTS_DIR,
        custom_dir: Path = CUSTOM_FONTS_DIR,
        upload_archive_dir: Path = UPLOADED_FONTS_DIR,
    ) -> None:
        self.fonts_dir = fonts_dir
        self.custom_dir = custom_dir
        self.upload_archive_dir = upload_archive_dir
        self.patched_dir = fonts_dir / "_shaped"
        for directory in (self.fonts_dir, self.custom_dir, self.upload_archive_dir, self.patched_dir):
            directory.mkdir(parents=True, exist_ok=True)
        self._locks: Dict[str, threading.Lock] = {key: threading.Lock() for key in PRESET_FONTS}
        self._patch_lock = threading.Lock()

    # ------------------------------------------------------------------ #
    # Presets
    # ------------------------------------------------------------------ #
    @staticmethod
    def is_preset(choice: str) -> bool:
        return choice in PRESET_FONTS

    def preset_path(self, key: str) -> Path:
        return self.fonts_dir / f"{key}.ttf"

    def is_preset_available(self, key: str) -> bool:
        path = self.preset_path(key)
        return path.exists() and path.stat().st_size > 0

    def ensure_preset(self, key: str) -> Path:
        """Return the local path of a preset font, downloading it if necessary."""
        if key not in PRESET_FONTS:
            raise FontNotFoundError(f"Unknown preset font: {key}")
        path = self.preset_path(key)
        if self.is_preset_available(key):
            return path
        with self._locks[key]:
            if self.is_preset_available(key):
                return path
            self._download_preset(PRESET_FONTS[key], path)
        return path

    def _download_preset(self, preset: PresetFont, destination: Path) -> None:
        errors: List[str] = []
        for url in preset.urls:
            try:
                logger.info("Downloading font %s from %s", preset.key, url)
                request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 HormoziSub/1.0"})
                with urllib.request.urlopen(request, timeout=FONT_DOWNLOAD_TIMEOUT_SECONDS) as response:
                    data = response.read()
                ImageFont.truetype(io.BytesIO(data), size=24)  # validate
                tmp_path = destination.with_suffix(".part")
                tmp_path.write_bytes(data)
                tmp_path.replace(destination)
                logger.info("Font %s cached at %s (%d bytes)", preset.key, destination, len(data))
                return
            except Exception as exc:
                errors.append(f"{url}: {exc}")
                logger.warning("Font download failed for %s (%s): %s", preset.key, url, exc)
        raise FontNotFoundError(
            f"Could not download preset font '{preset.key}'. Tried:\n  " + "\n  ".join(errors)
        )

    def prefetch_presets(self) -> Dict[str, bool]:
        """Download every preset font (used at startup). Never raises."""
        results: Dict[str, bool] = {}
        for key in PRESET_FONTS:
            try:
                self.ensure_shaped(self.ensure_preset(key))
                results[key] = True
            except Exception as exc:
                logger.error("Prefetch failed for %s: %s", key, exc)
                results[key] = False
        return results

    # ------------------------------------------------------------------ #
    # Custom fonts
    # ------------------------------------------------------------------ #
    def list_custom_fonts(self) -> List[Path]:
        return sorted(
            (p for p in self.custom_dir.iterdir() if p.is_file() and p.suffix.lower() in ALLOWED_FONT_EXTENSIONS),
            key=lambda p: p.name.lower(),
        )

    @staticmethod
    def sanitize_font_filename(filename: str) -> str:
        original = Path(filename or "").name
        suffix = Path(original).suffix.lower()
        if suffix not in ALLOWED_FONT_EXTENSIONS:
            raise InvalidFontError(f"Unsupported font extension '{suffix}'. Allowed: .ttf, .otf")
        stem = _SAFE_NAME_RE.sub("_", Path(original).stem).strip("_")
        if not stem:
            stem = f"font_{uuid.uuid4().hex[:8]}"
        if stem in PRESET_FONTS:
            stem = f"{stem}-custom"
        return f"{stem}{suffix}"

    def save_custom_font(self, filename: str, data: bytes) -> Path:
        """Validate and store an uploaded font. Returns the path inside the font cache."""
        safe_name = self.sanitize_font_filename(filename)
        try:
            ImageFont.truetype(io.BytesIO(data), size=24)
        except Exception as exc:
            raise InvalidFontError(f"File is not a valid TrueType/OpenType font: {exc}") from exc
        # Archive the raw upload, then publish into the font cache used by the renderer.
        (self.upload_archive_dir / safe_name).write_bytes(data)
        destination = self.custom_dir / safe_name
        tmp_path = destination.with_suffix(destination.suffix + ".part")
        tmp_path.write_bytes(data)
        tmp_path.replace(destination)
        return destination

    # ------------------------------------------------------------------ #
    # Resolution / loading
    # ------------------------------------------------------------------ #
    def resolve_font_path(self, choice: str) -> Path:
        """Map a font choice (preset key or custom filename/stem) to a local file."""
        choice = (choice or DEFAULT_FONT_KEY).strip()
        if self.is_preset(choice):
            return self.ensure_preset(choice)
        name = Path(choice).name
        direct = self.custom_dir / name
        if direct.is_file() and direct.suffix.lower() in ALLOWED_FONT_EXTENSIONS:
            return direct
        stem = Path(name).stem
        for candidate in self.list_custom_fonts():
            if candidate.stem == stem or candidate.stem.lower() == stem.lower():
                return candidate
        raise FontNotFoundError(
            f"Font '{choice}' not found. Use a preset ({', '.join(PRESET_FONTS)}) or upload it via /api/upload-font."
        )

    def get_font(self, choice: str, size: int) -> ImageFont.FreeTypeFont:
        shaped = self.ensure_shaped(self.resolve_font_path(choice))
        weight = PRESET_FONTS[choice].weight if self.is_preset(choice) else None
        return _load_font_cached(str(shaped), int(size), shaped.stat().st_mtime_ns, weight)

    def get_reshaper(self, choice: str) -> arabic_reshaper.ArabicReshaper:
        """ArabicReshaper configured for the glyph coverage of ``choice``."""
        shaped = self.ensure_shaped(self.resolve_font_path(choice))
        return _reshaper_for(str(shaped), shaped.stat().st_mtime_ns)

    # ------------------------------------------------------------------ #
    # Presentation-form patched copies
    # ------------------------------------------------------------------ #
    def shaped_path(self, source: Path) -> Path:
        stat = source.stat()
        return self.patched_dir / f"{source.stem}.{PATCH_VERSION}-{stat.st_size}-{stat.st_mtime_ns}{source.suffix.lower()}"

    def ensure_shaped(self, source: Path) -> Path:
        """Return a presentation-form-capable copy of ``source`` (built once, cached on disk)."""
        destination = self.shaped_path(source)
        if destination.exists():
            return destination
        with self._patch_lock:
            if destination.exists():
                return destination
            for stale in self.patched_dir.glob(f"{source.stem}.*{source.suffix.lower()}"):
                stale.unlink(missing_ok=True)
            try:
                added = build_presentation_form_font(source, destination)
                logger.info("Built shaping-compatible font %s (+%d presentation forms)", destination.name, added)
            except Exception as exc:
                logger.warning("Presentation-form patch failed for %s (%s); using original font", source.name, exc)
                return source
        return destination

    def list_fonts(self) -> Dict[str, List[dict]]:
        presets = [
            {
                "key": preset.key,
                "display_name": preset.display_name,
                "kind": "preset",
                "available": self.is_preset_available(preset.key),
                "filename": self.preset_path(preset.key).name,
            }
            for preset in PRESET_FONTS.values()
        ]
        custom = [
            {
                "key": path.name,
                "display_name": path.stem.replace("_", " "),
                "kind": "custom",
                "available": True,
                "filename": path.name,
            }
            for path in self.list_custom_fonts()
        ]
        return {"presets": presets, "custom": custom}
