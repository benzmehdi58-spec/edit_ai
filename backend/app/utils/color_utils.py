"""HEX <-> RGB / RGBA / BGR color conversion helpers.

Accepted HEX formats (leading ``#`` optional, case-insensitive):
    #RGB, #RGBA, #RRGGBB, #RRGGBBAA
"""

from __future__ import annotations

import re
from typing import Optional, Tuple

RGB = Tuple[int, int, int]
RGBA = Tuple[int, int, int, int]
BGR = Tuple[int, int, int]

_HEX_RE = re.compile(r"^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")


def is_valid_hex(value: str) -> bool:
    """Return True if ``value`` is a supported HEX color string."""
    return isinstance(value, str) and bool(_HEX_RE.match(value.strip()))


def normalize_hex(value: str) -> str:
    """Normalize a HEX color to upper-case ``#RRGGBB`` or ``#RRGGBBAA``.

    Raises:
        ValueError: if the value is not a valid HEX color.
    """
    if not isinstance(value, str):
        raise ValueError(f"Color must be a HEX string, got {type(value).__name__}")
    match = _HEX_RE.match(value.strip())
    if not match:
        raise ValueError(f"Invalid HEX color: {value!r} (expected #RRGGBB, #RGB, #RRGGBBAA or #RGBA)")
    digits = match.group(1)
    if len(digits) in (3, 4):
        digits = "".join(ch * 2 for ch in digits)
    return f"#{digits.upper()}"


def hex_to_rgba(value: str, alpha: Optional[int] = None) -> RGBA:
    """Convert HEX to an ``(R, G, B, A)`` tuple. ``alpha`` overrides any alpha in the HEX."""
    digits = normalize_hex(value)[1:]
    r, g, b = int(digits[0:2], 16), int(digits[2:4], 16), int(digits[4:6], 16)
    a = int(digits[6:8], 16) if len(digits) == 8 else 255
    if alpha is not None:
        a = max(0, min(255, int(alpha)))
    return r, g, b, a


def hex_to_rgb(value: str) -> RGB:
    """Convert HEX to an ``(R, G, B)`` tuple (alpha is discarded)."""
    r, g, b, _ = hex_to_rgba(value)
    return r, g, b


def rgb_to_bgr(rgb: RGB) -> BGR:
    """Swap an ``(R, G, B)`` tuple into OpenCV ``(B, G, R)`` order."""
    r, g, b = rgb[:3]
    return b, g, r


def hex_to_bgr(value: str) -> BGR:
    """Convert HEX to an OpenCV ``(B, G, R)`` tuple."""
    return rgb_to_bgr(hex_to_rgb(value))


def rgb_to_hex(rgb: Tuple[int, ...]) -> str:
    """Convert ``(R, G, B)`` or ``(R, G, B, A)`` to an upper-case HEX string."""
    if len(rgb) not in (3, 4):
        raise ValueError("rgb_to_hex expects a 3- or 4-tuple")
    return "#" + "".join(f"{max(0, min(255, int(c))):02X}" for c in rgb)
