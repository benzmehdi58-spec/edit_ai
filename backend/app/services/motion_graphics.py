"""Kinetic Text Animations, Floating 3D Emojis, and Programmatic Motion Graphics (`services/motion_graphics.py` — Phase 3).

Provides:
    1. 8-frame Kinetic Word Entrance Transforms (`pop`, `shake_red`, `bounce`, `normal`)
       with overshoot spring scale (`0.85 -> 1.15 -> 1.0`), horizontal shake, and
       slight rotation (`-3 deg`), settling at frame 8 so static frames remain cached.
    2. Floating 3D Emoji / Icon Layer centered directly above the active word's
       highlight box with a spring pop-in animation.
    3. Programmatic Motion Graphic Overlays on the upper half of the 1080x1920 canvas:
       - `stat_badge`: Dark rounded metric card sliding in from the top.
       - `cta_bio` / `cta_follow`: High-contrast pill button with animated pointer click effect.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Optional, Tuple

import arabic_reshaper
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from ..config import KINETIC_ENTRANCE_FRAMES
from ..models import EmphasisType, MotionGraphicType, RenderConfig, VisualCuePlan
from ..utils.color_utils import hex_to_rgb
from .rtl_layout import shape_word

logger = logging.getLogger("hormozisub.motion_graphics")


@dataclass(frozen=True)
class KineticTransform:
    """Per-frame geometric transform for the active word & highlight box."""

    scale: float = 1.0
    dx: int = 0
    dy: int = 0
    angle_deg: float = 0.0
    box_rgb_override: Optional[Tuple[int, int, int]] = None
    is_animated: bool = False


# 8-frame entrance curves (frames 0..7; >=8 is settled static state)
_POP_SCALES = (0.85, 0.96, 1.08, 1.15, 1.12, 1.06, 1.02, 1.00)
_BOUNCE_SCALES = (0.86, 1.02, 1.14, 1.10, 0.97, 1.03, 1.01, 1.00)
_BOUNCE_DY = (-20, -12, -4, 5, -3, 2, -1, 0)
_SHAKE_SCALES = (0.90, 1.08, 1.15, 1.11, 1.06, 1.03, 1.01, 1.00)
_SHAKE_DX = (-11, 11, -9, 9, -6, 6, -3, 0)
_SHAKE_ANGLES = (-3.0, 2.8, -2.4, 2.0, -1.4, 1.0, -0.5, 0.0)
_NORMAL_SCALES = (0.92, 1.04, 1.02, 1.00, 1.00, 1.00, 1.00, 1.00)
_EMOJI_SCALES = (0.55, 0.88, 1.12, 1.18, 1.10, 1.04, 1.01, 1.00)


def compute_kinetic_transform(
    emphasis: EmphasisType,
    anim_frame: int,
    enable_kinetic: bool = True,
    highlight_override_hex: Optional[str] = None,
) -> KineticTransform:
    """Return the exact transform for `anim_frame` (0..7 = kinetic entrance, >=8 = static)."""
    box_override: Optional[Tuple[int, int, int]] = None
    if highlight_override_hex:
        try:
            box_override = hex_to_rgb(highlight_override_hex)
        except Exception:
            box_override = None
    elif emphasis == "shake_red":
        box_override = (255, 42, 42)  # High-urgency crimson red for pain points

    if not enable_kinetic or anim_frame >= KINETIC_ENTRANCE_FRAMES or anim_frame < 0:
        return KineticTransform(
            scale=1.0,
            dx=0,
            dy=0,
            angle_deg=0.0,
            box_rgb_override=box_override,
            is_animated=False,
        )

    idx = min(max(0, anim_frame), KINETIC_ENTRANCE_FRAMES - 1)
    if emphasis == "pop":
        return KineticTransform(
            scale=_POP_SCALES[idx],
            dx=0,
            dy=0,
            angle_deg=-1.8 if idx in (1, 2) else 0.0,
            box_rgb_override=box_override,
            is_animated=True,
        )
    if emphasis == "bounce":
        return KineticTransform(
            scale=_BOUNCE_SCALES[idx],
            dx=0,
            dy=_BOUNCE_DY[idx],
            angle_deg=0.0,
            box_rgb_override=box_override,
            is_animated=True,
        )
    if emphasis == "shake_red":
        return KineticTransform(
            scale=_SHAKE_SCALES[idx],
            dx=_SHAKE_DX[idx],
            dy=0,
            angle_deg=_SHAKE_ANGLES[idx],
            box_rgb_override=box_override,
            is_animated=True,
        )
    # "normal" subtle entrance
    scale = _NORMAL_SCALES[idx]
    return KineticTransform(
        scale=scale,
        dx=0,
        dy=0,
        angle_deg=0.0,
        box_rgb_override=box_override,
        is_animated=(scale != 1.0),
    )


def _is_emoji_char(ch: str) -> bool:
    """True for pictographs / symbols that need the color emoji font."""
    cp = ord(ch)
    return (
        0x1F000 <= cp <= 0x1FAFF
        or 0x2600 <= cp <= 0x27BF
        or 0x2190 <= cp <= 0x21FF
        or 0x2B00 <= cp <= 0x2BFF
        or cp in (0x274C, 0x2705, 0x26A0)
    )


@lru_cache(maxsize=16)
def _get_emoji_font(size: int) -> Optional[ImageFont.FreeTypeFont]:
    """Locate a system color/symbol emoji font (Segoe UI Emoji on Windows, Apple/Noto elsewhere)."""
    candidates = (
        "C:/Windows/Fonts/seguiemj.ttf",
        "C:/Windows/Fonts/seguisym.ttf",
        "/System/Library/Fonts/Apple Color Emoji.ttc",
        "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf",
    )
    for path in candidates:
        if Path(path).is_file():
            try:
                return ImageFont.truetype(path, size=size)
            except Exception:
                continue
    return None


# Accent palette for floating 3D emoji badges
_EMOJI_BADGE_COLORS = {
    "💸": ((255, 65, 65), (255, 220, 90)),
    "📉": ((255, 59, 59), (255, 160, 160)),
    "❌": ((240, 45, 45), (255, 255, 255)),
    "⚠️": ((255, 185, 0), (30, 30, 35)),
    "🚀": ((99, 102, 241), (255, 235, 0)),
    "📱": ((56, 189, 248), (255, 255, 255)),
    "🔗": ((255, 235, 0), (20, 22, 30)),
    "🔥": ((255, 110, 30), (255, 235, 80)),
    "💰": ((34, 197, 94), (255, 240, 120)),
    "🎯": ((236, 72, 153), (255, 255, 255)),
    "⚡": ((255, 230, 0), (25, 25, 35)),
}


@lru_cache(maxsize=128)
def _render_base_emoji_sprite(emoji_text: str, base_size: int) -> Image.Image:
    """Render a crisp 3D floating emoji sprite with soft shadow (cached per emoji & size)."""
    pad = 24
    canvas_dim = base_size + pad * 2
    sprite = Image.new("RGBA", (canvas_dim, canvas_dim), (0, 0, 0, 0))
    primary_rgb, accent_rgb = _EMOJI_BADGE_COLORS.get(emoji_text, ((255, 235, 0), (255, 255, 255)))

    # 1. Soft 3D elevation shadow disc
    shadow = Image.new("RGBA", (canvas_dim, canvas_dim), (0, 0, 0, 0))
    s_draw = ImageDraw.Draw(shadow)
    s_margin = pad + 4
    s_draw.ellipse(
        (s_margin, s_margin + 6, canvas_dim - s_margin, canvas_dim - s_margin + 6),
        fill=(0, 0, 0, 145),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(6))
    sprite.alpha_composite(shadow)

    # 2. Glossy circular 3D pill backing so the emoji pops against any background
    draw = ImageDraw.Draw(sprite)
    c_margin = pad + 2
    draw.ellipse(
        (c_margin, c_margin, canvas_dim - c_margin, canvas_dim - c_margin),
        fill=(22, 25, 36, 235),
        outline=(*primary_rgb, 255),
        width=4,
    )
    # Subtle top specular highlight arc
    draw.arc(
        (c_margin + 5, c_margin + 5, canvas_dim - c_margin - 5, canvas_dim - c_margin - 5),
        start=200,
        end=340,
        fill=(*accent_rgb, 140),
        width=2,
    )

    # 3. Draw the Unicode emoji using system color emoji font
    emoji_font = _get_emoji_font(int(base_size * 0.56))
    center = canvas_dim // 2
    drew_glyph = False
    if emoji_font is not None:
        try:
            glyph_layer = Image.new("RGBA", (canvas_dim, canvas_dim), (0, 0, 0, 0))
            g_draw = ImageDraw.Draw(glyph_layer)
            g_draw.text(
                (center, center + 2),
                emoji_text,
                font=emoji_font,
                anchor="mm",
                embedded_color=True,
            )
            if glyph_layer.getbbox() is not None:
                sprite.alpha_composite(glyph_layer)
                drew_glyph = True
        except Exception:
            drew_glyph = False

    if not drew_glyph:
        # Clean vector icon fallback if emoji font cannot render the glyph
        draw.ellipse(
            (center - 12, center - 12, center + 12, center + 12),
            fill=(*primary_rgb, 255),
        )
    return sprite


class MotionGraphicsCompositor:
    """Composites floating 3D emojis and upper-canvas motion graphic UI cards."""

    def __init__(
        self,
        config: RenderConfig,
        font: ImageFont.FreeTypeFont,
        reshaper: Optional[arabic_reshaper.ArabicReshaper] = None,
    ) -> None:
        self.config = config
        self.font = font
        self.reshaper = reshaper

    # ------------------------------------------------------------------ #
    # Floating 3D Emoji / Icon Layer
    # ------------------------------------------------------------------ #
    def draw_floating_emoji(
        self,
        canvas: Image.Image,
        emoji_text: str,
        word_box: Tuple[int, int, int, int],
        anim_frame: int = 8,
    ) -> None:
        """Render `emoji_text` centered directly above the active word's highlight box."""
        clean_emoji = (emoji_text or "").strip()
        if not clean_emoji or not self.config.enable_emojis:
            return

        x1, y1, x2, _y2 = word_box
        base_size = max(56, min(104, int(round(self.config.font_size * 1.05))))
        sprite = _render_base_emoji_sprite(clean_emoji, base_size)

        scale_idx = min(max(0, anim_frame), len(_EMOJI_SCALES) - 1)
        scale = _EMOJI_SCALES[scale_idx] if self.config.enable_kinetic_text else 1.0
        if abs(scale - 1.0) > 0.01:
            new_w = max(16, int(round(sprite.width * scale)))
            new_h = max(16, int(round(sprite.height * scale)))
            sprite = sprite.resize((new_w, new_h), Image.Resampling.BICUBIC)

        center_x = (x1 + x2) // 2
        # Float directly above the active highlight box
        float_offset_y = -6 if anim_frame in (2, 3) else 0
        paste_x = max(8, min(self.config.width - sprite.width - 8, center_x - sprite.width // 2))
        paste_y = max(12, y1 - sprite.height + 10 + float_offset_y)

        self._alpha_paste(canvas, sprite, (paste_x, paste_y))

    # ------------------------------------------------------------------ #
    # Programmatic Motion Graphic Overlays (`stat_badge`, `cta_bio`, `cta_follow`)
    # ------------------------------------------------------------------ #
    def draw_motion_graphic(
        self,
        canvas: Image.Image,
        visual_plan: VisualCuePlan,
        cue_frame_offset: int = 12,
    ) -> None:
        """Draw sleek UI overlay cards on the upper half of the 1080x1920 canvas."""
        if not self.config.enable_motion_graphics:
            return
        mg_type: MotionGraphicType = visual_plan.motion_graphic
        if mg_type == "none":
            return

        text = (visual_plan.graphic_text or "").strip()
        if not text:
            defaults_by_type = {
                "spotlight": "MVP 🚀",
                "stat_badge": "10x Speed 📈",
                "mistake_stamp": "خطأ شائع ❌",
                "solution_stamp": "الحل الأفضل ✅",
                "step_badge": "الخطوة 01 ⚡",
                "notification_toast": "🔔 New Client Order",
                "cta_bio": "اللينك راه في البايو 🔗",
                "cta_follow": "دير أبوني +",
                "neon_tape": "⚡ سر النجاح",
            }
            text = defaults_by_type.get(mg_type, "10x Value 🔥")

        card = self._build_card_sprite(mg_type, text, visual_plan.emphasis_type, cue_frame_offset)
        m_scale = float(visual_plan.motion_scale or 1.0)
        if abs(m_scale - 1.0) > 0.02:
            new_w = max(48, int(round(card.width * m_scale)))
            new_h = max(32, int(round(card.height * m_scale)))
            card = card.resize((new_w, new_h), Image.Resampling.BICUBIC)

        # Slide-in spring easing over the first 10 frames of the cue
        slide_progress = min(1.0, max(0.0, (cue_frame_offset + 1) / 10.0))
        c1 = 1.70158
        c3 = c1 + 1.0
        eased = 1.0 + c3 * pow(slide_progress - 1.0, 3) + c1 * pow(slide_progress - 1.0, 2)

        y_pct = float(visual_plan.motion_y if visual_plan.motion_y is not None else 14.0) / 100.0
        x_pct = float(visual_plan.motion_x if visual_plan.motion_x is not None else 50.0) / 100.0
        target_y = int(round(self.config.height * y_pct)) - card.height // 2
        start_y = -card.height
        current_y = int(round(start_y + (target_y - start_y) * eased))
        paste_x = max(16, min(self.config.width - card.width - 16, int(round(self.config.width * x_pct)) - card.width // 2))

        self._alpha_paste(canvas, card, (paste_x, max(20, current_y)))

    def _build_card_sprite(
        self,
        mg_type: MotionGraphicType,
        graphic_text: str,
        emphasis: EmphasisType,
        cue_frame_offset: int,
    ) -> Image.Image:
        # Separate emoji / pictographs (drawn with the color emoji font) from the text
        # (drawn with the caption font, which has no emoji glyphs).
        emoji_chars = "".join(ch for ch in graphic_text if _is_emoji_char(ch))
        text_only = "".join(ch for ch in graphic_text if not _is_emoji_char(ch) and ch not in "\ufe0f\u200d")
        words = [w for w in text_only.split() if w]
        shaped_tokens = [shape_word(w, self.reshaper) for w in words]
        # If any Arabic word is present, join in RTL visual order
        has_arabic = any(any("\u0600" <= ch <= "\u06FF" for ch in w) for w in words)
        display_str = " ".join(reversed(shaped_tokens)) if has_arabic else " ".join(shaped_tokens)
        if not display_str:
            display_str = " "

        bbox = self.font.getbbox(display_str, anchor="ls")
        text_w = max(80, bbox[2] - bbox[0])
        text_h = max(36, bbox[3] - bbox[1])

        emoji_font = _get_emoji_font(max(24, int(text_h * 0.95))) if emoji_chars else None
        emoji_w = 0
        if emoji_font is not None:
            e_box = emoji_font.getbbox(emoji_chars)
            emoji_w = (e_box[2] - e_box[0]) + 14

        pad_x = 46
        pad_y = 26
        badge_dot_space = 58
        card_w = min(self.config.width - 80, text_w + emoji_w + pad_x * 2 + badge_dot_space)
        card_h = text_h + pad_y * 2
        margin = 20

        sprite = Image.new("RGBA", (card_w + margin * 2, card_h + margin * 2 + 24), (0, 0, 0, 0))

        # 1. Drop shadow
        shadow = Image.new("RGBA", sprite.size, (0, 0, 0, 0))
        s_draw = ImageDraw.Draw(shadow)
        s_draw.rounded_rectangle(
            (margin, margin + 8, margin + card_w, margin + card_h + 8),
            radius=card_h // 2 if mg_type in ("cta_bio", "cta_follow") else 24,
            fill=(0, 0, 0, 155),
        )
        shadow = shadow.filter(ImageFilter.GaussianBlur(8))
        sprite.alpha_composite(shadow)

        draw = ImageDraw.Draw(sprite)
        x1, y1 = margin, margin
        x2, y2 = margin + card_w, margin + card_h

        if mg_type in ("stat_badge", "spotlight", "mistake_stamp", "solution_stamp", "step_badge", "notification_toast", "neon_tape"):
            palette_map = {
                "spotlight": ((129, 140, 248), (20, 24, 42, 244), (255, 255, 255, 255), 26),
                "stat_badge": ((255, 235, 0), (18, 21, 30, 242), (255, 255, 255, 255), 24),
                "mistake_stamp": ((255, 59, 59), (42, 14, 18, 246), (255, 220, 220, 255), 18),
                "solution_stamp": ((34, 197, 94), (12, 38, 24, 246), (220, 255, 235, 255), 18),
                "step_badge": ((56, 189, 248), (15, 26, 42, 246), (255, 255, 255, 255), 20),
                "notification_toast": ((168, 85, 247), (22, 18, 36, 246), (255, 255, 255, 255), 30),
                "neon_tape": ((255, 235, 0), (255, 235, 0, 248), (12, 14, 20, 255), 10),
            }
            accent, bg_fill, text_fill, radius = palette_map.get(
                mg_type, ((255, 235, 0), (18, 21, 30, 242), (255, 255, 255, 255), 24)
            )
            if mg_type == "stat_badge" and (
                emphasis == "shake_red"
                or any(tok in graphic_text.lower() for tok in ("0", "zero", "زيرو", "❌", "📉", "⚠️", "slow"))
            ):
                accent = (255, 59, 59)
            draw.rounded_rectangle(
                (x1, y1, x2, y2),
                radius=radius,
                fill=bg_fill,
                outline=(*accent, 255),
                width=4,
            )
            dot_cx = x1 + 38
            dot_cy = (y1 + y2) // 2
            dot_rgb = (12, 14, 20) if mg_type == "neon_tape" else accent
            draw.ellipse(
                (dot_cx - 14, dot_cy - 14, dot_cx + 14, dot_cy + 14),
                fill=(*dot_rgb, 255),
            )
        else:
            # High-contrast CTA pill button (`cta_bio` / `cta_follow`)
            accent = (255, 235, 0) if mg_type == "cta_bio" else (99, 102, 241)
            bg_fill = (20, 22, 30, 248) if mg_type == "cta_bio" else (30, 27, 75, 248)
            radius = card_h // 2
            draw.rounded_rectangle(
                (x1, y1, x2, y2),
                radius=radius,
                fill=bg_fill,
                outline=(*accent, 255),
                width=5,
            )
            # Pulsing accent dot
            dot_cx = x1 + 40
            dot_cy = (y1 + y2) // 2
            pulse_r = 15 if (cue_frame_offset // 4) % 2 == 0 else 12
            draw.ellipse(
                (dot_cx - pulse_r, dot_cy - pulse_r, dot_cx + pulse_r, dot_cy + pulse_r),
                fill=(*accent, 255),
            )
            text_fill = (255, 235, 0, 255) if mg_type == "cta_bio" else (255, 255, 255, 255)

        # Draw text (+ emoji) centered inside the card, right of the indicator dot
        content_w = text_w + emoji_w
        text_origin_x = x1 + badge_dot_space + (card_w - badge_dot_space - content_w) // 2 - bbox[0]
        text_baseline_y = y1 + (card_h - text_h) // 2 - bbox[1]
        draw.text(
            (text_origin_x, text_baseline_y),
            display_str,
            font=self.font,
            fill=text_fill,
            anchor="ls",
            stroke_width=max(2, self.config.stroke_width // 2),
            stroke_fill=(0, 0, 0, 255),
        )
        if emoji_font is not None:
            emoji_x = text_origin_x + bbox[2] + 14
            emoji_y = (y1 + y2) // 2
            try:
                draw.text((emoji_x, emoji_y), emoji_chars, font=emoji_font, anchor="lm", embedded_color=True)
            except Exception:
                pass

        # Animated pointer click ripple effect for CTA pills
        if mg_type in ("cta_bio", "cta_follow"):
            click_x = x2 - 36
            click_y = y2 - 10
            ripple_r = 10 + (cue_frame_offset % 12) * 2
            ripple_alpha = max(40, 220 - (cue_frame_offset % 12) * 15)
            draw.ellipse(
                (click_x - ripple_r, click_y - ripple_r, click_x + ripple_r, click_y + ripple_r),
                outline=(255, 235, 0, ripple_alpha),
                width=3,
            )
            # Pointer triangle icon
            draw.polygon(
                [
                    (click_x, click_y),
                    (click_x + 18, click_y + 8),
                    (click_x + 10, click_y + 12),
                    (click_x + 6, click_y + 20),
                ],
                fill=(255, 255, 255, 255),
                outline=(0, 0, 0, 255),
            )

        return sprite

    @staticmethod
    def _alpha_paste(dst: Image.Image, src_rgba: Image.Image, xy: Tuple[int, int]) -> None:
        if dst.mode == "RGBA":
            dst.alpha_composite(src_rgba, xy)
        else:
            dst.paste(src_rgba.convert("RGB"), xy, src_rgba.split()[3])
