"""Pydantic schemas: RenderConfig, WordTiming, VisualCuePlan, EnrichedSubtitleCue, JobStatus and API models."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .config import DEFAULT_PREVIEW_TEXT, DEFAULT_RENDER_SETTINGS as D
from .utils.color_utils import normalize_hex

TargetLanguage = Literal["darija_mixed", "ar_fusha", "fr", "en"]
EmphasisType = Literal["normal", "pop", "shake_red", "bounce"]
MotionGraphicType = Literal[
    "none",
    "spotlight",
    "stat_badge",
    "mistake_stamp",
    "solution_stamp",
    "step_badge",
    "notification_toast",
    "cta_bio",
    "cta_follow",
    "neon_tape",
]
SfxTriggerType = Literal["none", "whoosh", "pop", "cash", "error", "click"]

_HEX_FIELDS = (
    "box_color_hex",
    "text_color_hex",
    "active_text_color_hex",
    "stroke_color_hex",
    "green_screen_hex",
    "shadow_color_hex",
)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------- #
# Phase 2 & 3 Subtitle, Word Timing & AI Director Schemas
# --------------------------------------------------------------------------- #
class WordTiming(BaseModel):
    """Exact acoustic word-level timing window (seconds)."""

    model_config = ConfigDict(extra="ignore")

    word: str = Field(..., min_length=1, description="Display word token")
    start: float = Field(..., ge=0.0, description="Word start timestamp in seconds")
    end: float = Field(..., ge=0.0, description="Word end timestamp in seconds")
    confidence: float = Field(1.0, ge=0.0, le=1.0)

    @model_validator(mode="after")
    def _ensure_order(self) -> "WordTiming":
        if self.end < self.start:
            self.end = round(self.start + 0.12, 3)
        return self


class VisualCuePlan(BaseModel):
    """AI Video Director plan attached to a single subtitle cue."""

    model_config = ConfigDict(extra="ignore")

    emphasis_type: EmphasisType = Field(
        "normal",
        description="Kinetic word transition style ('normal' | 'pop' | 'shake_red' | 'bounce')",
    )
    emoji_or_icon: str = Field(
        "",
        description="Contextual Unicode emoji (e.g. '💸', '📱', '🚀', '📉', '🔗') floating above the active word",
    )
    broll_query: str = Field(
        "",
        description="English search query for Pexels vertical stock footage matching the Darija meaning",
    )
    motion_graphic: MotionGraphicType = Field(
        "none",
        description="Upper-canvas overlay card style",
    )
    graphic_text: str = Field(
        "",
        description="Display text inside the motion graphic card (e.g. '0 Orders ❌', 'اللينك في البايو 🔗')",
    )
    graphic_subtext: str = Field(
        "",
        description="Optional secondary label/subtitle inside the motion graphic card",
    )
    motion_start: Optional[float] = Field(None, ge=0.0)
    motion_end: Optional[float] = Field(None, ge=0.0)
    motion_x: Optional[float] = Field(None, ge=5.0, le=95.0)
    motion_y: Optional[float] = Field(None, ge=5.0, le=90.0)
    motion_scale: Optional[float] = Field(None, ge=0.5, le=2.0)
    sfx_trigger: SfxTriggerType = Field(
        "none",
        description="Synchronized sound effect trigger ('none' | 'whoosh' | 'pop' | 'cash' | 'error' | 'click')",
    )
    sfx_start: Optional[float] = Field(None, ge=0.0)
    sfx_end: Optional[float] = Field(None, ge=0.0)
    highlight_color_override: Optional[str] = Field(
        None,
        description="Optional hex override for active word box (e.g. '#FF2A2A' on 'shake_red')",
    )


class EnrichedSubtitleCue(BaseModel):
    """A subtitle cue (strict max 4 words) with word-level timings and AI Director plan."""

    model_config = ConfigDict(extra="ignore")

    index: int = Field(0, ge=0)
    start: float = Field(..., ge=0.0)
    end: float = Field(..., ge=0.0)
    text: str = Field(..., description="Single-line caption text (up to 4 words)")
    words: List[WordTiming] = Field(default_factory=list)
    visual_plan: VisualCuePlan = Field(default_factory=VisualCuePlan)
    broll_clip_path: Optional[str] = Field(None, description="Local path to downloaded Pexels B-Roll clip")
    broll_preview_url: Optional[str] = Field(None, description="Public/relative URL to preview B-Roll clip")

    @model_validator(mode="after")
    def _ensure_cue_consistency(self) -> "EnrichedSubtitleCue":
        raw_lines = [" ".join(line.split()) for line in self.text.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
        self.text = "\n".join(line for line in raw_lines if line)
        if self.end <= self.start:
            self.end = round(self.start + 0.5, 3)
        if not self.words and self.text:
            tokens = [w for w in self.text.replace("\n", " ").split(" ") if w]
            n = max(1, len(tokens))
            span = max(0.05, (self.end - self.start) / n)
            cursor = self.start
            built: List[WordTiming] = []
            for i, tok in enumerate(tokens):
                w_end = self.end if i == n - 1 else round(cursor + span, 3)
                built.append(WordTiming(word=tok, start=round(cursor, 3), end=w_end))
                cursor = w_end
            self.words = built
        elif self.words and not self.text:
            self.text = " ".join(w.word for w in self.words)
        return self


# --------------------------------------------------------------------------- #
# Render Configuration
# --------------------------------------------------------------------------- #
class RenderConfig(BaseModel):
    """Full styling + AI Director + output configuration for a render or preview."""

    model_config = ConfigDict(extra="ignore")

    # ---- Colors ---------------------------------------------------------- #
    box_color_hex: str = Field(D["box_color_hex"], description="Active-word highlight box color")
    text_color_hex: str = Field(D["text_color_hex"], description="Inactive word fill color")
    active_text_color_hex: str = Field(D["active_text_color_hex"], description="Active word fill color")
    stroke_color_hex: str = Field(D["stroke_color_hex"], description="Text outline color")
    green_screen_hex: str = Field(D["green_screen_hex"], description="Chroma-key background color (or 'transparent')")
    transparent_bg: bool = Field(
        D["transparent_bg"],
        description="When True, renders a transparent RGBA video (.mov) with no background",
    )

    # ---- Typography ------------------------------------------------------ #
    font_choice: str = Field(
        D["font_choice"],
        description="Preset key (Cairo-Bold, Tajawal-Bold, Almarai-ExtraBold, Changa-Bold) "
        "or the filename / stem of an uploaded custom font.",
    )
    font_size: int = Field(D["font_size"], ge=8, le=500)
    stroke_width: int = Field(D["stroke_width"], ge=0, le=60)

    # ---- Highlight box --------------------------------------------------- #
    box_radius: int = Field(D["box_radius"], ge=0, le=500)
    box_padding_x: int = Field(D["box_padding_x"], ge=0, le=300)
    box_padding_y: int = Field(D["box_padding_y"], ge=0, le=300)

    # ---- Placement / output --------------------------------------------- #
    y_position: int = Field(D["y_position"], ge=0, le=8000, description="Vertical center of the caption block")
    fps: int = Field(D["fps"], ge=1, le=240)
    width: int = Field(D["width"], ge=64, le=7680)
    height: int = Field(D["height"], ge=64, le=7680)

    # ---- Extended styling ----------------------------------------------- #
    shadow_enabled: bool = Field(D["shadow_enabled"])
    shadow_color_hex: str = Field(D["shadow_color_hex"])
    shadow_offset_x: int = Field(D["shadow_offset_x"], ge=-100, le=100)
    shadow_offset_y: int = Field(D["shadow_offset_y"], ge=-100, le=100)
    shadow_blur: int = Field(D["shadow_blur"], ge=0, le=60)
    shadow_opacity: float = Field(D["shadow_opacity"], ge=0.0, le=1.0)
    word_spacing: int = Field(D["word_spacing"], ge=-100, le=400, description="Extra px between words")
    line_spacing: int = Field(D["line_spacing"], ge=0, le=500, description="Extra px between wrapped lines")
    horizontal_margin: int = Field(D["horizontal_margin"], ge=0, le=2000, description="Safe margin left/right; lines wrap beyond it")

    # ---- Timing & Caption Layout ----------------------------------------- #
    min_word_duration: float = Field(D["min_word_duration"], ge=0.0, le=5.0, description="Seconds; floor per word")
    words_per_line: int = Field(
        int(D.get("words_per_line", 4)),  # type: ignore[arg-type]
        ge=1,
        le=8,
        description="Maximum words per line (1 to 6)",
    )
    max_lines: int = Field(
        int(D.get("max_lines", 1)),  # type: ignore[arg-type]
        ge=1,
        le=3,
        description="Maximum lines per subtitle cue (1 or 2)",
    )

    # ---- Phase 2 + Phase 3 AI Toggles ------------------------------------ #
    target_language: TargetLanguage = Field(
        D["target_language"],  # type: ignore[arg-type]
        description="Target language for auto-transcription / translation",
    )
    enable_kinetic_text: bool = Field(
        D["enable_kinetic_text"],  # type: ignore[arg-type]
        description="Enable 8-frame overshoot spring / bounce / shake_red kinetic word animations",
    )
    enable_emojis: bool = Field(
        D["enable_emojis"],  # type: ignore[arg-type]
        description="Render contextual floating 3D emoji above active word",
    )
    enable_motion_graphics: bool = Field(
        D["enable_motion_graphics"],  # type: ignore[arg-type]
        description="Render upper-canvas motion graphic cards (stat_badge, cta_bio, cta_follow)",
    )
    enable_sfx: bool = Field(
        D["enable_sfx"],  # type: ignore[arg-type]
        description="Generate and mix synchronized SFX track into final video",
    )
    enable_broll: bool = Field(
        D["enable_broll"],  # type: ignore[arg-type]
        description="Fetch Pexels B-Roll clips and composite or bundle as a .zip",
    )
    sfx_volume_db: float = Field(
        D["sfx_volume_db"],  # type: ignore[arg-type]
        ge=-40.0,
        le=6.0,
        description="SFX mix level in dB relative to voiceover (default -12dB)",
    )

    @field_validator(*_HEX_FIELDS)
    @classmethod
    def _validate_hex(cls, value: str, info) -> str:
        if info.field_name == "green_screen_hex" and isinstance(value, str) and value.strip().lower() == "transparent":
            return "transparent"
        return normalize_hex(value)

    @field_validator("font_choice")
    @classmethod
    def _validate_font_choice(cls, value: str) -> str:
        value = (value or "").strip()
        if not value:
            raise ValueError("font_choice must not be empty")
        if any(sep in value for sep in ("/", "\\", "..")):
            raise ValueError("font_choice must be a preset key or a bare font filename")
        return value

    @model_validator(mode="after")
    def _validate_geometry(self) -> "RenderConfig":
        if self.green_screen_hex == "transparent":
            self.transparent_bg = True
            self.green_screen_hex = "#00FF00"
        if self.width % 2 or self.height % 2:
            raise ValueError("width and height must be even numbers (required by yuv420p H.264)")
        if self.y_position > self.height:
            raise ValueError("y_position must lie inside the canvas height")
        if self.horizontal_margin * 2 >= self.width:
            raise ValueError("horizontal_margin is too large for the canvas width")
        return self

    @property
    def max_line_width(self) -> int:
        return self.width - 2 * self.horizontal_margin


# --------------------------------------------------------------------------- #
# Preview Request / Response
# --------------------------------------------------------------------------- #
class PreviewRequest(BaseModel):
    """Body for POST /api/preview-frame."""

    config: RenderConfig = Field(default_factory=RenderConfig)
    text: str = Field(DEFAULT_PREVIEW_TEXT, max_length=2000, description="Caption text; '\\n' forces a line break")
    active_word_index: int = Field(0, ge=-1, description="Logical (reading-order) word index; -1 = no highlight")
    visual_plan: Optional[VisualCuePlan] = Field(
        None,
        description="Optional AI Director visual plan (emoji, emphasis, motion graphic) to preview",
    )
    anim_frame: int = Field(
        8,
        ge=0,
        le=60,
        description="Animation frame index within active word (0..7 = kinetic entrance, >=8 = settled)",
    )
    response_format: Literal["png", "base64"] = "png"
    preview_scale: float = Field(1.0, gt=0.05, le=1.0, description="Downscale factor for faster UI previews")


class PreviewBase64Response(BaseModel):
    image_base64: str
    mime_type: str = "image/png"
    width: int
    height: int
    word_count: int
    active_word_index: int
    render_ms: float
    words: List["WordBoxInfo"]


class WordBoxInfo(BaseModel):
    index: int
    text: str
    line: int
    x1: int
    y1: int
    x2: int
    y2: int


# --------------------------------------------------------------------------- #
# Phase 2 & 3 API Request / Response Models
# --------------------------------------------------------------------------- #
class TranscribeAndDirectResponse(BaseModel):
    """Response for POST /api/transcribe-and-direct."""

    target_language: TargetLanguage
    audio_duration: float
    cues: List[EnrichedSubtitleCue]
    visual_plan: List[VisualCuePlan]
    srt_content: str
    engine_used: str


class TranslateCuesRequest(BaseModel):
    """Request body for POST /api/translate-cues."""

    cues: List[EnrichedSubtitleCue]
    target_language: TargetLanguage
    words_per_line: int = Field(4, ge=1, le=8, description="Maximum words per line (1 to 6)")
    max_lines: int = Field(1, ge=1, le=3, description="Maximum lines per subtitle cue (1 or 2)")
    direct_visuals: bool = Field(
        True,
        description="When True, re-runs or preserves AI Director visual plan for translated cues",
    )


class TranslateCuesResponse(BaseModel):
    """Response for POST /api/translate-cues."""

    target_language: TargetLanguage
    cues: List[EnrichedSubtitleCue]
    srt_content: str


class FetchBrollRequest(BaseModel):
    """Request body for POST /api/fetch-broll."""

    job_id: Optional[str] = None
    cues: List[EnrichedSubtitleCue]
    create_zip: bool = True


class BrollClipInfo(BaseModel):
    cue_index: int
    query: str
    start: float
    end: float
    filename: str
    local_path: str
    preview_url: str
    pexels_video_id: Optional[int] = None
    provider_video_id: Optional[str] = None
    duration: float = 0.0
    source: Literal[
        "unsplash",
        "pixabay",
        "pexels",
        "coverr",
        "wikimedia",
        "openverse",
        "internet_archive",
        "procedural_fallback",
    ] = "unsplash"


class FetchBrollResponse(BaseModel):
    """Response for POST /api/fetch-broll."""

    job_id: str
    clips: List[BrollClipInfo]
    zip_download_url: Optional[str] = None
    cues: List[EnrichedSubtitleCue]


# --------------------------------------------------------------------------- #
# Job & Font Models
# --------------------------------------------------------------------------- #
class JobState(str, Enum):
    QUEUED = "queued"
    TRANSCRIBING = "transcribing"
    DIRECTING = "directing"
    PARSING = "parsing"
    RENDERING = "rendering"
    MUXING = "muxing"
    COMPLETED = "completed"
    FAILED = "failed"


class RenderStats(BaseModel):
    audio_duration: float = 0.0
    total_frames: int = 0
    unique_states: int = 0
    cue_count: int = 0
    word_count: int = 0
    intermediate_codec: str = ""
    render_seconds: float = 0.0
    mux_seconds: float = 0.0
    sfx_triggers_placed: int = 0
    broll_clips_used: int = 0


class JobStatus(BaseModel):
    job_id: str
    state: JobState = JobState.QUEUED
    progress: float = Field(0.0, ge=0.0, le=1.0)
    message: str = ""
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
    finished_at: Optional[datetime] = None
    output_filename: Optional[str] = None
    download_url: Optional[str] = None
    sfx_download_url: Optional[str] = None
    srt_download_url: Optional[str] = None
    broll_zip_url: Optional[str] = None
    cues: Optional[List[EnrichedSubtitleCue]] = None
    error: Optional[str] = None
    stats: Optional[RenderStats] = None
    config: RenderConfig = Field(default_factory=RenderConfig)


class FontInfo(BaseModel):
    key: str
    display_name: str
    kind: Literal["preset", "custom"]
    available: bool
    filename: Optional[str] = None


class FontListResponse(BaseModel):
    default: str
    presets: List[FontInfo]
    custom: List[FontInfo]


PreviewBase64Response.model_rebuild()
