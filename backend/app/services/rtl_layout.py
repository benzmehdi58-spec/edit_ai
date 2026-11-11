"""Arabic reshaping, BiDi and RTL word bounding-box layout engine.

Pipeline per word:
    logical word --arabic_reshaper.reshape--> contextual glyph forms
                 --bidi.get_display------------> visual order glyph string
                 --font.getbbox----------------> exact ink box

Line layout:
    * Words are wrapped (logical order) to ``max_line_width``.
    * Each line is centered horizontally; ``x_cursor`` starts at the line's right
      edge and moves LEFT by ``word_width + gap`` per word (strict RTL).
    * Consecutive Latin (LTR) words such as "Landing Page" are kept as an LTR
      run so they still read left-to-right inside the RTL sentence.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

import arabic_reshaper
from bidi.algorithm import get_display
from PIL import ImageFont

from .srt_parser import split_words

Box = Tuple[int, int, int, int]

_REFERENCE_GLYPHS = "أإلآكطظ ـجـيـ Hgjy|"


def word_direction(word: str) -> str:
    """Return ``"rtl"`` (has Arabic/Hebrew), ``"ltr"`` (has Latin letters) or ``"neutral"``."""
    has_ltr = False
    for ch in word:
        bidi_class = unicodedata.bidirectional(ch)
        if bidi_class in ("R", "AL"):
            return "rtl"
        if bidi_class == "L":
            has_ltr = True
    return "ltr" if has_ltr else "neutral"


def shape_word(word: str, reshaper: Optional[arabic_reshaper.ArabicReshaper] = None) -> str:
    """Reshape (contextual Arabic forms + lam-alef ligatures) then BiDi-reorder one word.

    ``reshaper`` is a font-aware ``ArabicReshaper`` (see FontManager.get_reshaper);
    when omitted the module-level ``arabic_reshaper.reshape`` default is used.
    """
    reshaped = reshaper.reshape(word) if reshaper is not None else arabic_reshaper.reshape(word)
    return get_display(reshaped)


def visual_order_rtl(directions: Sequence[str]) -> List[int]:
    """Return word positions (indices into ``directions``) ordered from RIGHT to LEFT.

    RTL / neutral words follow reading order right-to-left. A run of consecutive
    LTR words is reversed so that, when laid out right-to-left, the run itself
    reads left-to-right (e.g. "Landing Page" instead of "Page Landing").
    """
    order: List[int] = []
    i = 0
    n = len(directions)
    while i < n:
        if directions[i] == "ltr":
            j = i
            while j + 1 < n and directions[j + 1] == "ltr":
                j += 1
            order.extend(range(j, i - 1, -1))
            i = j + 1
        else:
            order.append(i)
            i += 1
    return order


@dataclass(frozen=True)
class WordBox:
    index: int          # logical (reading-order) index across the whole caption
    line_index: int     # visual line (after wrapping)
    text: str           # original logical text
    display: str        # reshaped + BiDi visual string passed to Pillow
    direction: str
    x1: int
    y1: int
    x2: int
    y2: int
    origin_x: int       # Pillow draw origin (anchor "ls" = left/baseline)
    baseline_y: int

    @property
    def width(self) -> int:
        return self.x2 - self.x1

    @property
    def height(self) -> int:
        return self.y2 - self.y1

    def padded(self, pad_x: int, pad_y: int) -> Box:
        return self.x1 - pad_x, self.y1 - pad_y, self.x2 + pad_x, self.y2 + pad_y


@dataclass(frozen=True)
class LineLayout:
    line_index: int
    word_indices: Tuple[int, ...]  # logical order
    x1: int
    y1: int
    x2: int
    y2: int
    baseline_y: int


@dataclass(frozen=True)
class TextLayout:
    words: Tuple[WordBox, ...]
    lines: Tuple[LineLayout, ...]
    bbox: Box
    canvas_size: Tuple[int, int]

    @property
    def word_count(self) -> int:
        return len(self.words)

    @property
    def is_empty(self) -> bool:
        return not self.words


@dataclass(frozen=True)
class _Measured:
    display: str
    direction: str
    left: int
    top: int
    right: int
    bottom: int

    @property
    def width(self) -> int:
        return self.right - self.left


class RTLLayoutEngine:
    """Computes exact per-word boxes for RTL (mixed-script) caption lines."""

    def __init__(
        self,
        font: ImageFont.FreeTypeFont,
        canvas_width: int,
        canvas_height: int,
        *,
        stroke_width: int = 0,
        word_spacing: int = 0,
        line_spacing: int = 0,
        box_padding_y: int = 0,
        max_line_width: int | None = None,
        reshaper: Optional[arabic_reshaper.ArabicReshaper] = None,
    ) -> None:
        self.font = font
        self.reshaper = reshaper
        self.canvas_width = canvas_width
        self.canvas_height = canvas_height
        self.stroke_width = stroke_width
        self.line_spacing = line_spacing
        self.box_padding_y = box_padding_y
        self.max_line_width = max_line_width or canvas_width
        # Gap = natural space + user spacing + room for both neighbouring outlines.
        self.space_width = float(font.getlength(" "))
        self.gap = max(0.0, self.space_width + word_spacing + stroke_width)
        ref = font.getbbox(shape_word(_REFERENCE_GLYPHS, reshaper), anchor="ls")
        self.ref_top, self.ref_bottom = ref[1], ref[3]
        self._cache: Dict[str, _Measured] = {}

    # ------------------------------------------------------------------ #
    def measure(self, word: str) -> _Measured:
        cached = self._cache.get(word)
        if cached is not None:
            return cached
        display = shape_word(word, self.reshaper)
        left, top, right, bottom = self.font.getbbox(display, anchor="ls")
        if right <= left:  # glyph-less word (e.g. zero-width chars)
            right = left + int(round(self.space_width))
        measured = _Measured(display, word_direction(word), left, top, right, bottom)
        self._cache[word] = measured
        return measured

    def _run_width(self, indices: Sequence[int], words: Sequence[str]) -> float:
        if not indices:
            return 0.0
        return sum(self.measure(words[i]).width for i in indices) + self.gap * (len(indices) - 1)

    def wrap(self, lines: Sequence[Sequence[str]]) -> List[List[int]]:
        """Greedy wrap in logical order. Returns logical word indices per visual line.

        A Latin phrase (consecutive LTR words, e.g. "Landing Page") is moved to
        the next line as a whole rather than being split across two lines.
        """
        flat = [word for line in lines for word in line]
        wrapped: List[List[int]] = []
        index = 0
        for line in lines:
            current: List[int] = []
            for word in line:
                width = self.measure(word).width
                current_width = self._run_width(current, flat)
                projected = width if not current else current_width + self.gap + width
                if current and projected > self.max_line_width:
                    carry: List[int] = []
                    if self.measure(word).direction == "ltr":
                        while current and self.measure(flat[current[-1]]).direction == "ltr":
                            carry.insert(0, current.pop())
                        if not current:  # whole line is one LTR run: split normally
                            current, carry = carry, []
                    wrapped.append(current)
                    current = carry + [index]
                else:
                    current.append(index)
                index += 1
            if current:
                wrapped.append(current)
        return wrapped

    def layout(self, lines: Sequence[Sequence[str]], y_center: int) -> TextLayout:
        words: List[str] = [word for line in lines for word in line]
        if not words:
            return TextLayout(words=(), lines=(), bbox=(0, 0, 0, 0), canvas_size=(self.canvas_width, self.canvas_height))

        measured = [self.measure(word) for word in words]
        visual_lines = self.wrap(lines)

        # Uniform vertical extents -> every highlight box has the same height.
        glyph_top = min(self.ref_top, min(m.top for m in measured))
        glyph_bottom = max(self.ref_bottom, max(m.bottom for m in measured))
        glyph_height = glyph_bottom - glyph_top
        advance = glyph_height + 2 * self.box_padding_y + self.line_spacing
        block_height = (len(visual_lines) - 1) * advance + glyph_height
        first_baseline = y_center - block_height / 2.0 - glyph_top

        boxes: Dict[int, WordBox] = {}
        line_layouts: List[LineLayout] = []
        for line_no, indices in enumerate(visual_lines):
            baseline = int(round(first_baseline + line_no * advance))
            widths = [measured[i].width for i in indices]
            total_width = sum(widths) + self.gap * (len(indices) - 1)
            line_left = (self.canvas_width - total_width) / 2.0
            line_right = line_left + total_width

            order = visual_order_rtl([measured[i].direction for i in indices])
            x_cursor = line_right
            for position in order:
                logical_index = indices[position]
                m = measured[logical_index]
                x2 = x_cursor
                x1 = x2 - m.width
                ix1 = int(round(x1))
                boxes[logical_index] = WordBox(
                    index=logical_index,
                    line_index=line_no,
                    text=words[logical_index],
                    display=m.display,
                    direction=m.direction,
                    x1=ix1,
                    y1=baseline + glyph_top,
                    x2=ix1 + m.width,
                    y2=baseline + glyph_bottom,
                    origin_x=ix1 - m.left,
                    baseline_y=baseline,
                )
                x_cursor = x1 - self.gap

            line_layouts.append(
                LineLayout(
                    line_index=line_no,
                    word_indices=tuple(indices),
                    x1=int(round(line_left)),
                    y1=baseline + glyph_top,
                    x2=int(round(line_right)),
                    y2=baseline + glyph_bottom,
                    baseline_y=baseline,
                )
            )

        ordered = tuple(boxes[i] for i in range(len(words)))
        bbox = (
            min(b.x1 for b in ordered),
            min(b.y1 for b in ordered),
            max(b.x2 for b in ordered),
            max(b.y2 for b in ordered),
        )
        return TextLayout(words=ordered, lines=tuple(line_layouts), bbox=bbox, canvas_size=(self.canvas_width, self.canvas_height))

    def layout_text(self, text: str, y_center: int) -> TextLayout:
        """Convenience: ``\\n`` separated text -> layout."""
        lines = [split_words(row) for row in text.replace("\r\n", "\n").split("\n")]
        return self.layout([line for line in lines if line], y_center)
