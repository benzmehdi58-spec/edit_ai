"""Multi-layer Pillow frame renderer with Kinetic Text, 3D Emojis, and Motion Graphics (Phase 1 + Phase 3).

Layer order (bottom -> top):
    1. Solid chroma-key background (`green_screen_hex`), transparent RGBA, or B-Roll background frame
    2. Rounded highlight box behind ONLY the active word (with optional kinetic spring scale/shake/rotation)
    3. Soft drop shadow, then ALL words: every outline is drawn first (pass A)
       and every fill afterwards (pass B).
    4. Floating 3D Emoji / Icon centered above the active word's highlight box
    5. Upper-canvas Motion Graphic UI card (`stat_badge`, `cta_bio`, `cta_follow`)
"""

from __future__ import annotations

from typing import Dict, Optional, Sequence, Tuple

import arabic_reshaper
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from ..models import RenderConfig, VisualCuePlan
from ..utils.color_utils import hex_to_rgb
from .motion_graphics import MotionGraphicsCompositor, compute_kinetic_transform
from .rtl_layout import RTLLayoutEngine, TextLayout, WordBox


class FrameRenderer:
    def __init__(
        self,
        config: RenderConfig,
        font: ImageFont.FreeTypeFont,
        reshaper: Optional[arabic_reshaper.ArabicReshaper] = None,
        card_font: Optional[ImageFont.FreeTypeFont] = None,
    ) -> None:
        self.config = config
        self.font = font
        self.reshaper = reshaper
        self.size: Tuple[int, int] = (config.width, config.height)

        self.green_rgb = hex_to_rgb(config.green_screen_hex)
        self.box_rgb = hex_to_rgb(config.box_color_hex)
        self.text_rgb = hex_to_rgb(config.text_color_hex)
        self.active_rgb = hex_to_rgb(config.active_text_color_hex)
        self.stroke_rgb = hex_to_rgb(config.stroke_color_hex)
        self.shadow_rgb = hex_to_rgb(config.shadow_color_hex)
        opacity = config.shadow_opacity
        self._shadow_lut = [int(round(v * opacity)) for v in range(256)]

        self.engine = RTLLayoutEngine(
            font,
            config.width,
            config.height,
            stroke_width=config.stroke_width,
            word_spacing=config.word_spacing,
            line_spacing=config.line_spacing,
            box_padding_y=config.box_padding_y,
            max_line_width=config.max_line_width,
            reshaper=reshaper,
        )
        self.mg_compositor = MotionGraphicsCompositor(
            config=config,
            font=card_font or font,
            reshaper=reshaper,
        )
        self._layout_cache: Dict[Tuple[Tuple[str, ...], ...], TextLayout] = {}
        self._blank: Optional[Image.Image] = None

    # ------------------------------------------------------------------ #
    # Layout
    # ------------------------------------------------------------------ #
    def layout_lines(self, lines: Sequence[Sequence[str]]) -> TextLayout:
        key = tuple(tuple(line) for line in lines)
        layout = self._layout_cache.get(key)
        if layout is None:
            layout = self.engine.layout(key, self.config.y_position)
            self._layout_cache[key] = layout
        return layout

    def layout_text(self, text: str) -> TextLayout:
        return self.engine.layout_text(text, self.config.y_position)

    # ------------------------------------------------------------------ #
    # Rendering
    # ------------------------------------------------------------------ #
    def blank_frame(self) -> Image.Image:
        if self._blank is None:
            if self.config.transparent_bg:
                self._blank = Image.new("RGBA", self.size, (0, 0, 0, 0))
            else:
                self._blank = Image.new("RGB", self.size, self.green_rgb)
        return self._blank.copy()

    def render(
        self,
        layout: TextLayout,
        active_index: Optional[int],
        visual_plan: Optional[VisualCuePlan] = None,
        anim_frame: int = 8,
        cue_frame_offset: int = 12,
        background_frame: Optional[Image.Image] = None,
        prev_active_index: Optional[int] = None,
    ) -> Image.Image:
        """Render one visual state to an RGB or RGBA PIL image."""
        cfg = self.config
        transparent = cfg.transparent_bg
        if background_frame is not None:
            image = background_frame.resize(self.size, Image.Resampling.BILINEAR).convert(
                "RGBA" if transparent else "RGB"
            )
        elif transparent:
            image = Image.new("RGBA", self.size, (0, 0, 0, 0))
        else:
            image = Image.new("RGB", self.size, self.green_rgb)

        if layout.is_empty:
            if visual_plan is not None and cfg.enable_motion_graphics:
                self.mg_compositor.draw_motion_graphic(image, visual_plan, cue_frame_offset)
            return image

        plan = visual_plan or VisualCuePlan()
        kinetic = compute_kinetic_transform(
            emphasis=plan.emphasis_type,
            anim_frame=anim_frame,
            enable_kinetic=cfg.enable_kinetic_text,
            highlight_override_hex=plan.highlight_color_override,
        )

        # On a transparent canvas, draw the soft shadow onto the transparent base first
        if transparent and cfg.shadow_enabled and cfg.shadow_opacity > 0:
            self._draw_shadow_rgba(image, layout)

        draw = ImageDraw.Draw(image)
        effective_box_rgb = kinetic.box_rgb_override or self.box_rgb
        box_fill = (*effective_box_rgb, 255) if transparent else effective_box_rgb
        stroke_fill = (*self.stroke_rgb, 255) if transparent else self.stroke_rgb
        active_fill = (*self.active_rgb, 255) if transparent else self.active_rgb
        inactive_fill = (*self.text_rgb, 255) if transparent else self.text_rgb

        has_active = active_index is not None and 0 <= active_index < layout.word_count
        active_word_box: Optional[WordBox] = layout.words[active_index] if has_active and active_index is not None else None
        padded_box: Optional[Tuple[int, int, int, int]] = None

        if active_word_box is not None:
            padded_box = active_word_box.padded(cfg.box_padding_x, cfg.box_padding_y)
            # Smooth 5-frame (~83ms @ 60fps) glide from previous word box inside the same cue
            if (
                prev_active_index is not None
                and prev_active_index != active_index
                and 0 <= prev_active_index < layout.word_count
                and 0 <= anim_frame < 5
            ):
                prev_padded = layout.words[prev_active_index].padded(cfg.box_padding_x, cfg.box_padding_y)
                t = (anim_frame + 1) / 5.0
                ease = 1.0 - (1.0 - t) ** 3
                padded_box = (
                    int(round(prev_padded[0] + (padded_box[0] - prev_padded[0]) * ease)),
                    int(round(prev_padded[1] + (padded_box[1] - prev_padded[1]) * ease)),
                    int(round(prev_padded[2] + (padded_box[2] - prev_padded[2]) * ease)),
                    int(round(prev_padded[3] + (padded_box[3] - prev_padded[3]) * ease)),
                )

        # Layer 2 (static path): highlight box behind the active word when not kinetically transformed
        if active_word_box is not None and padded_box is not None and not kinetic.is_animated:
            x1, y1, x2, y2 = padded_box
            radius = max(0, min(cfg.box_radius, (x2 - x1) // 2, (y2 - y1) // 2))
            draw.rounded_rectangle((x1, y1, x2, y2), radius=radius, fill=box_fill)

        # Layer 3a: subtle drop shadow (solid background path)
        if not transparent and cfg.shadow_enabled and cfg.shadow_opacity > 0:
            self._draw_shadow(image, layout)

        # Layer 3b: outlines & fills
        stroke = cfg.stroke_width
        if not kinetic.is_animated or active_word_box is None:
            if stroke > 0:
                for word in layout.words:
                    draw.text(
                        (word.origin_x, word.baseline_y),
                        word.display,
                        font=self.font,
                        fill=stroke_fill,
                        anchor="ls",
                        stroke_width=stroke,
                        stroke_fill=stroke_fill,
                    )
            for word in layout.words:
                draw.text(
                    (word.origin_x, word.baseline_y),
                    word.display,
                    font=self.font,
                    fill=active_fill if word.index == active_index else inactive_fill,
                    anchor="ls",
                )
        else:
            # Kinetic entrance path: draw inactive words onto the main canvas first,
            # then composite the scaled/rotated/shaken active word + highlight box on top.
            if stroke > 0:
                for word in layout.words:
                    if word.index == active_index:
                        continue
                    draw.text(
                        (word.origin_x, word.baseline_y),
                        word.display,
                        font=self.font,
                        fill=stroke_fill,
                        anchor="ls",
                        stroke_width=stroke,
                        stroke_fill=stroke_fill,
                    )
            for word in layout.words:
                if word.index == active_index:
                    continue
                draw.text(
                    (word.origin_x, word.baseline_y),
                    word.display,
                    font=self.font,
                    fill=inactive_fill,
                    anchor="ls",
                )
            self._draw_kinetic_active_word(
                canvas=image,
                word=active_word_box,
                box_rgb=effective_box_rgb,
                kinetic=kinetic,
            )

        # Layer 4: Floating 3D Emoji / Icon centered above the active word's highlight box
        if active_word_box is not None and padded_box is not None and cfg.enable_emojis and plan.emoji_or_icon:
            emoji_box = (
                padded_box[0] + kinetic.dx,
                padded_box[1] + kinetic.dy,
                padded_box[2] + kinetic.dx,
                padded_box[3] + kinetic.dy,
            )
            self.mg_compositor.draw_floating_emoji(image, plan.emoji_or_icon, emoji_box, anim_frame=anim_frame)

        # Layer 5: Upper-canvas Motion Graphic UI Card (`stat_badge`, `cta_bio`, `cta_follow`)
        if cfg.enable_motion_graphics and plan.motion_graphic != "none":
            self.mg_compositor.draw_motion_graphic(image, plan, cue_frame_offset=cue_frame_offset)

        return image

    def _draw_kinetic_active_word(
        self,
        canvas: Image.Image,
        word: WordBox,
        box_rgb: Tuple[int, int, int],
        kinetic,
    ) -> None:
        """Render the active word + highlight box onto a local RGBA sprite, transform, and composite."""
        cfg = self.config
        x1, y1, x2, y2 = word.padded(cfg.box_padding_x, cfg.box_padding_y)
        margin = cfg.stroke_width + 24
        patch_w = max(16, (x2 - x1) + margin * 2)
        patch_h = max(16, (y2 - y1) + margin * 2)

        patch = Image.new("RGBA", (patch_w, patch_h), (0, 0, 0, 0))
        p_draw = ImageDraw.Draw(patch)

        local_x1 = margin
        local_y1 = margin
        local_x2 = margin + (x2 - x1)
        local_y2 = margin + (y2 - y1)
        radius = max(0, min(cfg.box_radius, (local_x2 - local_x1) // 2, (local_y2 - local_y1) // 2))
        p_draw.rounded_rectangle(
            (local_x1, local_y1, local_x2, local_y2),
            radius=radius,
            fill=(*box_rgb, 255),
        )

        local_origin_x = word.origin_x - x1 + margin
        local_baseline_y = word.baseline_y - y1 + margin
        if cfg.stroke_width > 0:
            p_draw.text(
                (local_origin_x, local_baseline_y),
                word.display,
                font=self.font,
                fill=(*self.stroke_rgb, 255),
                anchor="ls",
                stroke_width=cfg.stroke_width,
                stroke_fill=(*self.stroke_rgb, 255),
            )
        p_draw.text(
            (local_origin_x, local_baseline_y),
            word.display,
            font=self.font,
            fill=(*self.active_rgb, 255),
            anchor="ls",
        )

        if abs(kinetic.scale - 1.0) > 0.01:
            scaled_w = max(8, int(round(patch.width * kinetic.scale)))
            scaled_h = max(8, int(round(patch.height * kinetic.scale)))
            patch = patch.resize((scaled_w, scaled_h), Image.Resampling.BICUBIC)

        if abs(kinetic.angle_deg) > 0.05:
            patch = patch.rotate(kinetic.angle_deg, resample=Image.Resampling.BICUBIC, expand=True)

        center_x = (x1 + x2) // 2 + kinetic.dx
        center_y = (y1 + y2) // 2 + kinetic.dy
        paste_x = center_x - patch.width // 2
        paste_y = center_y - patch.height // 2

        if canvas.mode == "RGBA":
            canvas.alpha_composite(patch, (paste_x, paste_y))
        else:
            canvas.paste(patch.convert("RGB"), (paste_x, paste_y), patch.split()[3])

    def _build_shadow_mask(self, layout: TextLayout) -> Optional[Tuple[Image.Image, int, int, int, int]]:
        cfg = self.config
        ox, oy = cfg.shadow_offset_x, cfg.shadow_offset_y
        margin = cfg.stroke_width + cfg.shadow_blur * 3 + 4
        width, height = self.size
        bx1, by1, bx2, by2 = layout.bbox
        x0 = max(0, bx1 - margin + min(0, ox))
        y0 = max(0, by1 - margin + min(0, oy) - cfg.font_size // 2)
        x1 = min(width, bx2 + margin + max(0, ox))
        y1 = min(height, by2 + margin + max(0, oy) + cfg.font_size // 2)
        if x1 <= x0 or y1 <= y0:
            return None
        mask = Image.new("L", (x1 - x0, y1 - y0), 0)
        mask_draw = ImageDraw.Draw(mask)
        for word in layout.words:
            mask_draw.text(
                (word.origin_x - x0 + ox, word.baseline_y - y0 + oy),
                word.display,
                font=self.font,
                fill=255,
                anchor="ls",
                stroke_width=cfg.stroke_width,
                stroke_fill=255,
            )
        if cfg.shadow_blur > 0:
            mask = mask.filter(ImageFilter.GaussianBlur(cfg.shadow_blur))
        if cfg.shadow_opacity < 1.0:
            mask = mask.point(self._shadow_lut)
        return mask, x0, y0, x1, y1

    def _draw_shadow(self, image: Image.Image, layout: TextLayout) -> None:
        built = self._build_shadow_mask(layout)
        if built is None:
            return
        mask, x0, y0, x1, y1 = built
        image.paste(self.shadow_rgb, (x0, y0, x1, y1), mask)

    def _draw_shadow_rgba(self, image: Image.Image, layout: TextLayout) -> None:
        built = self._build_shadow_mask(layout)
        if built is None:
            return
        mask, x0, y0, x1, y1 = built
        patch = Image.new("RGBA", (x1 - x0, y1 - y0), (*self.shadow_rgb, 0))
        patch.putalpha(mask)
        image.alpha_composite(patch, (x0, y0))

    # ------------------------------------------------------------------ #
    # OpenCV & Raw RGBA helpers
    # ------------------------------------------------------------------ #
    @staticmethod
    def to_bgr(image: Image.Image) -> np.ndarray:
        """RGB PIL image -> contiguous BGR uint8 array for cv2.VideoWriter."""
        if image.mode != "RGB":
            image = image.convert("RGB")
        return np.ascontiguousarray(np.asarray(image, dtype=np.uint8)[:, :, ::-1])

    def render_bgr(
        self,
        layout: TextLayout,
        active_index: Optional[int],
        visual_plan: Optional[VisualCuePlan] = None,
        anim_frame: int = 8,
        cue_frame_offset: int = 12,
        background_frame: Optional[Image.Image] = None,
    ) -> np.ndarray:
        return self.to_bgr(
            self.render(
                layout,
                active_index,
                visual_plan=visual_plan,
                anim_frame=anim_frame,
                cue_frame_offset=cue_frame_offset,
                background_frame=background_frame,
            )
        )

    def blank_bgr(self) -> np.ndarray:
        return self.to_bgr(self.blank_frame())

    def render_rgba_bytes(
        self,
        layout: TextLayout,
        active_index: Optional[int],
        visual_plan: Optional[VisualCuePlan] = None,
        anim_frame: int = 8,
        cue_frame_offset: int = 12,
        background_frame: Optional[Image.Image] = None,
    ) -> bytes:
        image = self.render(
            layout,
            active_index,
            visual_plan=visual_plan,
            anim_frame=anim_frame,
            cue_frame_offset=cue_frame_offset,
            background_frame=background_frame,
        )
        if image.mode != "RGBA":
            image = image.convert("RGBA")
        return image.tobytes()

    def blank_rgba_bytes(self) -> bytes:
        return bytes(self.size[0] * self.size[1] * 4)
