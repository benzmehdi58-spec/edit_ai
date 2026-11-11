"""State-cached OpenCV frame writer + FFmpeg audio/SFX muxer (Phase 1 + Phase 2 + Phase 3).

Key optimizations:
    * Exact word-level timing: ``start_frame = int(word.start * fps)`` and
      ``end_frame = int(word.end * fps)`` straight from the acoustic Whisper
      timestamps (no proportional character-length estimation). Micro-pauses
      (< 0.25s) inside the same cue are bridged so the caption never flickers.
    * Kinetic entrances: only the first 8 frames of an emphasized word (and the
      first 12 frames of a cue carrying a motion graphic) are rendered one by
      one. The settled state is rendered ONCE and written ``N`` times.
    * B-roll compositing (optional): cues with a downloaded clip are rendered
      per-frame on top of the time-synced stock footage.
    * SFX mixing: the voice-over and ``sfx_track.wav`` (at ``sfx_volume_db``,
      default -12dB) are mixed in the final FFmpeg mux.
"""

from __future__ import annotations

import logging
import math
import re
import subprocess
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, Iterator, List, Optional, Sequence, Tuple, Union

import cv2
import numpy as np
from PIL import Image

from ..config import (
    AUDIO_BITRATE,
    INTERMEDIATE_CODECS,
    KINETIC_ENTRANCE_FRAMES,
    MICRO_PAUSE_BRIDGE_SECONDS,
    TEMP_DIR,
    X264_CRF,
    X264_PRESET,
    resolve_ffmpeg_binary,
)
from ..models import EnrichedSubtitleCue, JobState, RenderConfig, RenderStats, WordTiming
from .font_manager import FontManager
from .frame_renderer import FrameRenderer
from .srt_parser import distribute_word_timings, parse_srt_file

logger = logging.getLogger("hormozisub.pipeline")

ProgressCallback = Callable[[JobState, float, str], None]
FramePayload = Union[np.ndarray, bytes]

_DURATION_RE = re.compile(r"Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)")

# Progress budget: rendering 0.02 -> 0.90, muxing 0.90 -> 1.0
_RENDER_START, _RENDER_END = 0.02, 0.90
# Motion graphic cards slide in over the first frames of a cue, then freeze.
_MOTION_GRAPHIC_ANIM_FRAMES = 12


class PipelineError(RuntimeError):
    """Raised for any unrecoverable render / mux failure."""


@dataclass(frozen=True)
class FrameSegment:
    start_frame: int              # inclusive
    end_frame: int                # exclusive
    cue_index: int
    word_index: Optional[int]     # None = cue visible, no active word (long intra-cue pause)
    cue_start_frame: int


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def probe_audio_duration(audio_path: Path) -> Optional[float]:
    """Read the media duration (seconds) from FFmpeg's stream banner."""
    try:
        proc = subprocess.run(
            [resolve_ffmpeg_binary(), "-hide_banner", "-i", str(audio_path)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=60,
        )
    except Exception as exc:
        logger.warning("Audio probe failed: %s", exc)
        return None
    match = _DURATION_RE.search(proc.stderr or "")
    if not match:
        return None
    hours, minutes, seconds = match.groups()
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def cues_from_srt(srt_path: Path, min_word_duration: float = 0.12) -> List[EnrichedSubtitleCue]:
    """Legacy path: parse an uploaded .srt into enriched cues (proportional word timing)."""
    enriched: List[EnrichedSubtitleCue] = []
    for cue in parse_srt_file(srt_path):
        timed = distribute_word_timings(cue, min_word_duration)
        words = [WordTiming(word=t.text, start=round(t.start, 3), end=round(t.end, 3)) for t in timed]
        if not words:
            continue
        enriched.append(
            EnrichedSubtitleCue(
                index=len(enriched),
                start=round(cue.start, 3),
                end=round(cue.end, 3),
                text=" ".join(w.word for w in words),
                words=words,
            )
        )
    return enriched


def _bridge_words(words: Sequence[WordTiming], max_gap: float = MICRO_PAUSE_BRIDGE_SECONDS) -> List[WordTiming]:
    """Sort, de-overlap and bridge micro-pauses (< max_gap) between words of one cue."""
    ordered = sorted((w.model_copy(deep=True) for w in words), key=lambda w: w.start)
    for prev, nxt in zip(ordered, ordered[1:]):
        gap = nxt.start - prev.end
        if 0.0 < gap <= max_gap:
            prev.end = nxt.start
        elif gap < 0.0:
            prev.end = max(prev.start, nxt.start)
    return ordered


def build_frame_segments(cues: Sequence[EnrichedSubtitleCue], fps: int, total_frames: int) -> List[FrameSegment]:
    """Map exact word timestamps to non-overlapping, monotonically increasing frame ranges."""
    segments: List[FrameSegment] = []
    previous_end = 0
    ordered = sorted(cues, key=lambda c: c.start)
    for ci, cue in enumerate(ordered):
        words = _bridge_words(cue.words)
        if not words:
            continue
        limit = total_frames
        if ci + 1 < len(ordered):
            limit = min(limit, max(previous_end, int(ordered[ci + 1].start * fps)))

        cue_start = min(max(int(words[0].start * fps), previous_end), limit)
        cursor = cue_start
        last = len(words) - 1
        for wi, word in enumerate(words):
            start_frame = max(int(word.start * fps), cursor)
            if wi == last:
                # Hold the last word until the cue ends (never past the next cue).
                end_frame = max(int(word.end * fps), int(round(cue.end * fps)))
            else:
                end_frame = int(word.end * fps)
            end_frame = min(end_frame, limit)
            start_frame = min(start_frame, end_frame)
            if start_frame > cursor:
                # Longer intra-cue pause: keep the line on screen without a highlight.
                segments.append(FrameSegment(cursor, start_frame, cue.index, None, cue_start))
            if end_frame <= start_frame:
                continue
            segments.append(FrameSegment(start_frame, end_frame, cue.index, wi, cue_start))
            cursor = end_frame
        previous_end = max(previous_end, cursor)
    return segments


def _open_writer(base_path: Path, fps: int, size: Tuple[int, int]) -> Tuple[cv2.VideoWriter, Path, str]:
    """Open the best available intermediate codec (lossless preferred)."""
    for fourcc, extension in INTERMEDIATE_CODECS:
        path = base_path.with_suffix(extension)
        writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*fourcc), float(fps), size)
        if writer.isOpened():
            if fourcc == "MJPG":
                writer.set(cv2.VIDEOWRITER_PROP_QUALITY, 100)
            return writer, path, fourcc
        writer.release()
        path.unlink(missing_ok=True)
    raise PipelineError("OpenCV could not open any VideoWriter codec (tried FFV1, HFYU, MJPG, mp4v).")


def _audio_filter_args(sfx_path: Optional[Path], sfx_db: float, voice_input: int, sfx_input: int) -> Tuple[List[str], str]:
    """Return (filter_complex fragments, audio map label) for voice-only or voice+SFX."""
    if sfx_path is None:
        return [], f"{voice_input}:a:0"
    graph = (
        f"[{voice_input}:a]aformat=sample_rates=44100:channel_layouts=stereo[voice];"
        f"[{sfx_input}:a]aformat=sample_rates=44100:channel_layouts=stereo,volume={sfx_db:.2f}dB[sfx];"
        "[voice][sfx]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]"
    )
    return [graph], "[aout]"


def mux_audio(
    video_path: Path,
    audio_path: Path,
    output_path: Path,
    fps: int,
    sfx_path: Optional[Path] = None,
    sfx_db: float = -12.0,
) -> None:
    """Encode H.264 (BT.709 tv-range) and mux the voice-over (+ optional SFX track at ``sfx_db``)."""
    inputs = ["-i", str(video_path), "-i", str(audio_path)]
    if sfx_path is not None:
        inputs += ["-i", str(sfx_path)]
    audio_graph, audio_map = _audio_filter_args(sfx_path, sfx_db, 1, 2)
    video_graph = "[0:v]scale=out_range=tv:out_color_matrix=bt709,format=yuv420p[vout]"
    filter_complex = ";".join([video_graph, *audio_graph])

    command = [
        resolve_ffmpeg_binary(),
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        *inputs,
        "-filter_complex", filter_complex,
        "-map", "[vout]",
        "-map", audio_map,
        "-c:v", "libx264",
        "-preset", X264_PRESET,
        "-crf", str(X264_CRF),
        "-pix_fmt", "yuv420p",
        "-colorspace", "bt709",
        "-color_primaries", "bt709",
        "-color_trc", "bt709",
        "-color_range", "tv",
        "-r", str(fps),
        "-c:a", "aac",
        "-b:a", AUDIO_BITRATE,
        "-shortest",
        "-movflags", "+faststart",
        str(output_path),
    ]
    logger.info("Muxing: %s", " ".join(command))
    proc = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0 or not output_path.exists():
        tail = (proc.stderr or "").strip()[-2000:]
        raise PipelineError(f"FFmpeg mux failed (exit {proc.returncode}): {tail}")


class _BrollReader:
    """Time-synced sequential reader for a B-roll clip (loops when the clip is shorter than the cue)."""

    def __init__(self, path: Path, size: Tuple[int, int]) -> None:
        self.cap = cv2.VideoCapture(str(path))
        self.size = size
        fps = self.cap.get(cv2.CAP_PROP_FPS) if self.cap.isOpened() else 0.0
        self.src_fps = fps if fps and fps > 1 else 30.0
        self.frame_count = int(self.cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0) if self.cap.isOpened() else 0
        self._pos = -1
        self._last: Optional[Image.Image] = None

    @property
    def ok(self) -> bool:
        return self.cap.isOpened()

    def _cover(self, bgr: np.ndarray) -> Image.Image:
        """Center-crop to the output aspect ratio (object-fit: cover)."""
        tw, th = self.size
        h, w = bgr.shape[:2]
        scale = max(tw / w, th / h)
        nw, nh = max(tw, int(round(w * scale))), max(th, int(round(h * scale)))
        resized = cv2.resize(bgr, (nw, nh), interpolation=cv2.INTER_LINEAR)
        x0, y0 = (nw - tw) // 2, (nh - th) // 2
        crop = resized[y0:y0 + th, x0:x0 + tw]
        return Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))

    def frame_at(self, offset_seconds: float) -> Optional[Image.Image]:
        target = int(offset_seconds * self.src_fps)
        if self.frame_count > 0:
            target %= self.frame_count
        if target < self._pos:
            self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            self._pos = -1
        frame = None
        while self._pos < target:
            ok, frame = self.cap.read()
            if not ok:
                self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                self._pos = -1
                ok, frame = self.cap.read()
                if not ok:
                    return self._last
                self._pos = 0
                break
            self._pos += 1
        if frame is not None:
            self._last = self._cover(frame)
        return self._last

    def release(self) -> None:
        self.cap.release()


class VideoPipeline:
    def __init__(self, font_manager: FontManager, sfx_mixer=None) -> None:
        self.font_manager = font_manager
        self._sfx_mixer = sfx_mixer

    @property
    def sfx_mixer(self):
        if self._sfx_mixer is None:
            from .sfx_mixer import SfxMixer

            self._sfx_mixer = SfxMixer()
        return self._sfx_mixer

    # ------------------------------------------------------------------ #
    # Public entry points
    # ------------------------------------------------------------------ #
    def render(
        self,
        audio_path: Path,
        srt_path: Path,
        config: RenderConfig,
        output_path: Path,
        progress: Optional[ProgressCallback] = None,
        sfx_output_path: Optional[Path] = None,
    ) -> RenderStats:
        """Legacy Phase 1 entry: render from an uploaded .srt file."""
        cues = cues_from_srt(srt_path, config.min_word_duration)
        if not cues:
            raise PipelineError("The SRT file contains no valid cues.")
        return self.render_cues(audio_path, cues, config, output_path, progress, sfx_output_path)

    def render_cues(
        self,
        audio_path: Path,
        cues: Sequence[EnrichedSubtitleCue],
        config: RenderConfig,
        output_path: Path,
        progress: Optional[ProgressCallback] = None,
        sfx_output_path: Optional[Path] = None,
    ) -> RenderStats:
        report = progress or (lambda state, value, message: None)
        stats = RenderStats()
        cue_list = [c.model_copy(update={"index": i}, deep=True) for i, c in enumerate(sorted(cues, key=lambda c: c.start))]
        if not cue_list:
            raise PipelineError("No subtitle cues to render.")

        # ---- 1. Timeline ------------------------------------------------ #
        report(JobState.PARSING, 0.0, "Building exact word-level timeline")
        audio_duration = probe_audio_duration(audio_path)
        if audio_duration is None or audio_duration <= 0:
            logger.warning("Could not determine audio duration; falling back to last cue end.")
            audio_duration = max(c.end for c in cue_list)
        fps = config.fps
        total_frames = max(1, int(math.ceil(audio_duration * fps)))
        segments = build_frame_segments(cue_list, fps, total_frames)

        stats.audio_duration = round(audio_duration, 3)
        stats.total_frames = total_frames
        stats.cue_count = len(cue_list)
        stats.word_count = sum(len(c.words) for c in cue_list)

        # ---- 2. SFX track ---------------------------------------------- #
        sfx_path: Optional[Path] = None
        if config.enable_sfx and sfx_output_path is not None:
            try:
                sfx_path, placed = self.sfx_mixer.build_sfx_track(cue_list, audio_duration, sfx_output_path)
                stats.sfx_triggers_placed = placed
                if placed == 0:
                    sfx_path = None  # nothing to mix; keep the exported (silent) file anyway
            except Exception as exc:
                logger.warning("SFX track generation failed (%s); rendering without SFX.", exc)
                sfx_path = None

        # ---- 3. Renderer ----------------------------------------------- #
        font = self.font_manager.get_font(config.font_choice, config.font_size)
        card_font = self.font_manager.get_font(config.font_choice, max(28, int(round(config.font_size * 0.62))))
        renderer = FrameRenderer(config, font, self.font_manager.get_reshaper(config.font_choice), card_font=card_font)

        use_broll = config.enable_broll and not config.transparent_bg
        if use_broll:
            stats.broll_clips_used = sum(
                1 for c in cue_list if c.broll_clip_path and Path(c.broll_clip_path).is_file()
            )

        if config.transparent_bg:
            return self._render_transparent_mov(
                renderer=renderer,
                cues=cue_list,
                segments=segments,
                total_frames=total_frames,
                fps=fps,
                audio_path=audio_path,
                output_path=output_path,
                stats=stats,
                report=report,
                sfx_path=sfx_path,
                sfx_db=config.sfx_volume_db,
            )

        TEMP_DIR.mkdir(parents=True, exist_ok=True)
        temp_base = TEMP_DIR / f"temp_video_{uuid.uuid4().hex}"
        writer, temp_path, codec = _open_writer(temp_base, fps, (config.width, config.height))
        stats.intermediate_codec = codec
        logger.info("Rendering %d frames (%d segments) with %s intermediate", total_frames, len(segments), codec)

        render_started = time.perf_counter()
        frames_written = 0
        last_report = 0.0
        try:
            report(JobState.RENDERING, _RENDER_START, "Rendering kinetic caption states")
            for payload, count in self._iter_frame_payloads(renderer, cue_list, segments, total_frames, False, stats, use_broll):
                for _ in range(count):
                    writer.write(payload)  # type: ignore[arg-type]
                frames_written += count
                now = time.perf_counter()
                if now - last_report >= 0.25:
                    last_report = now
                    fraction = frames_written / total_frames
                    report(
                        JobState.RENDERING,
                        _RENDER_START + (_RENDER_END - _RENDER_START) * fraction,
                        f"Writing frame {frames_written}/{total_frames}",
                    )
        finally:
            writer.release()
        stats.render_seconds = round(time.perf_counter() - render_started, 3)

        # ---- 4. Mux voice-over (+ SFX) --------------------------------- #
        try:
            report(JobState.MUXING, _RENDER_END, "Encoding H.264 and mixing voice-over + SFX")
            mux_started = time.perf_counter()
            output_path.parent.mkdir(parents=True, exist_ok=True)
            mux_audio(temp_path, audio_path, output_path, fps, sfx_path=sfx_path, sfx_db=config.sfx_volume_db)
            stats.mux_seconds = round(time.perf_counter() - mux_started, 3)
        finally:
            temp_path.unlink(missing_ok=True)

        report(JobState.COMPLETED, 1.0, "Render complete")
        return stats

    # ------------------------------------------------------------------ #
    # Frame generation (shared by the green-screen MP4 and alpha MOV paths)
    # ------------------------------------------------------------------ #
    def _iter_frame_payloads(
        self,
        renderer: FrameRenderer,
        cues: Sequence[EnrichedSubtitleCue],
        segments: Sequence[FrameSegment],
        total_frames: int,
        as_rgba: bool,
        stats: RenderStats,
        use_broll: bool,
    ) -> Iterator[Tuple[FramePayload, int]]:
        """Yield ``(frame_payload, repeat_count)``; animated frames have count 1."""
        cfg = renderer.config
        fps = cfg.fps

        def encode(image: Image.Image) -> FramePayload:
            if as_rgba:
                return (image if image.mode == "RGBA" else image.convert("RGBA")).tobytes()
            return FrameRenderer.to_bgr(image)

        blank: FramePayload = renderer.blank_rgba_bytes() if as_rgba else renderer.blank_bgr()
        cue_by_index: Dict[int, EnrichedSubtitleCue] = {c.index: c for c in cues}
        layouts: Dict[int, object] = {}
        broll_reader: Optional[_BrollReader] = None
        broll_cue: Optional[int] = None
        unique_states = 1

        try:
            cursor = 0
            for seg in segments:
                if seg.start_frame > cursor:
                    yield blank, seg.start_frame - cursor
                cue = cue_by_index[seg.cue_index]
                plan = cue.visual_plan
                layout = layouts.get(cue.index)
                if layout is None:
                    ordered_words = [w.word for w in sorted(cue.words, key=lambda w: w.start)]
                    wpl = max(1, int(getattr(cfg, "words_per_line", 4)))
                    ml = max(1, int(getattr(cfg, "max_lines", 1)))
                    lines_arg: List[List[str]]
                    if "\n" in cue.text:
                        raw_rows = [r.split() for r in cue.text.splitlines() if r.strip()]
                        if sum(len(r) for r in raw_rows) == len(ordered_words):
                            lines_arg = []
                            idx_cursor = 0
                            for r in raw_rows:
                                lines_arg.append(ordered_words[idx_cursor : idx_cursor + len(r)])
                                idx_cursor += len(r)
                        elif ml > 1 and len(ordered_words) > wpl:
                            lines_arg = [ordered_words[i : i + wpl] for i in range(0, len(ordered_words), wpl)]
                        else:
                            lines_arg = [ordered_words]
                    elif ml > 1 and len(ordered_words) > wpl:
                        lines_arg = [ordered_words[i : i + wpl] for i in range(0, len(ordered_words), wpl)]
                    else:
                        lines_arg = [ordered_words]
                    if len(lines_arg) > ml:
                        lines_arg = lines_arg[: ml - 1] + [[w for row in lines_arg[ml - 1 :] for w in row]]
                    layout = renderer.layout_lines(lines_arg)
                    layouts[cue.index] = layout

                # Switch B-roll reader when entering a new cue.
                if use_broll and broll_cue != cue.index:
                    if broll_reader is not None:
                        broll_reader.release()
                    broll_reader, broll_cue = None, cue.index
                    if cue.broll_clip_path and Path(cue.broll_clip_path).is_file():
                        reader = _BrollReader(Path(cue.broll_clip_path), renderer.size)
                        broll_reader = reader if reader.ok else None
                has_broll = broll_reader is not None and broll_cue == cue.index

                is_word = seg.word_index is not None
                prev_word_idx = (
                    seg.word_index - 1
                    if is_word and seg.word_index is not None and seg.word_index > 0
                    else None
                )
                emphasized = cfg.enable_kinetic_text and plan.emphasis_type != "normal"
                has_emoji = cfg.enable_emojis and bool(plan.emoji_or_icon)
                has_card = cfg.enable_motion_graphics and plan.motion_graphic != "none"
                length = seg.end_frame - seg.start_frame

                def is_dynamic(i: int) -> bool:
                    if has_broll:
                        return True
                    if is_word and prev_word_idx is not None and i < 5:
                        return True
                    if is_word and i < KINETIC_ENTRANCE_FRAMES and (emphasized or has_emoji):
                        return True
                    return has_card and (seg.start_frame + i - seg.cue_start_frame) < _MOTION_GRAPHIC_ANIM_FRAMES

                i = 0
                while i < length and is_dynamic(i):
                    frame_index = seg.start_frame + i
                    background = None
                    if has_broll and broll_reader is not None:
                        background = broll_reader.frame_at((frame_index - seg.cue_start_frame) / fps)
                    image = renderer.render(
                        layout,  # type: ignore[arg-type]
                        seg.word_index,
                        visual_plan=plan,
                        anim_frame=i if is_word else KINETIC_ENTRANCE_FRAMES,
                        cue_frame_offset=frame_index - seg.cue_start_frame,
                        background_frame=background,
                        prev_active_index=prev_word_idx,
                    )
                    unique_states += 1
                    yield encode(image), 1
                    i += 1

                if i < length:
                    # Settled state: rendered ONCE, repeated for the rest of the word.
                    offset = max(_MOTION_GRAPHIC_ANIM_FRAMES, seg.start_frame + i - seg.cue_start_frame)
                    image = renderer.render(
                        layout,  # type: ignore[arg-type]
                        seg.word_index,
                        visual_plan=plan,
                        anim_frame=KINETIC_ENTRANCE_FRAMES,
                        cue_frame_offset=offset,
                    )
                    unique_states += 1
                    yield encode(image), length - i
                cursor = seg.end_frame
            if cursor < total_frames:
                yield blank, total_frames - cursor
        finally:
            if broll_reader is not None:
                broll_reader.release()
            stats.unique_states = unique_states

    def _render_transparent_mov(
        self,
        *,
        renderer: FrameRenderer,
        cues: Sequence[EnrichedSubtitleCue],
        segments: List[FrameSegment],
        total_frames: int,
        fps: int,
        audio_path: Path,
        output_path: Path,
        stats: RenderStats,
        report: ProgressCallback,
        sfx_path: Optional[Path] = None,
        sfx_db: float = -12.0,
    ) -> RenderStats:
        """Stream RGBA frames directly into FFmpeg qtrle (.mov with alpha) + voice/SFX mix."""
        output_path.parent.mkdir(parents=True, exist_ok=True)
        width, height = renderer.size
        inputs = [
            "-f", "rawvideo",
            "-pix_fmt", "rgba",
            "-s", f"{width}x{height}",
            "-r", str(fps),
            "-i", "pipe:0",
            "-i", str(audio_path),
        ]
        if sfx_path is not None:
            inputs += ["-i", str(sfx_path)]
        audio_graph, audio_map = _audio_filter_args(sfx_path, sfx_db, 1, 2)
        filter_args = ["-filter_complex", audio_graph[0]] if audio_graph else []

        command = [
            resolve_ffmpeg_binary(),
            "-hide_banner",
            "-loglevel", "error",
            "-y",
            *inputs,
            *filter_args,
            "-map", "0:v:0",
            "-map", audio_map,
            "-c:v", "qtrle",
            "-pix_fmt", "argb",
            "-r", str(fps),
            "-c:a", "aac",
            "-b:a", AUDIO_BITRATE,
            "-shortest",
            "-movflags", "+faststart",
            str(output_path),
        ]
        stats.intermediate_codec = "qtrle-rgba"
        logger.info("Rendering %d transparent RGBA frames (%d segments) -> %s", total_frames, len(segments), output_path.name)

        render_started = time.perf_counter()
        frames_written = 0
        last_report = 0.0
        proc = subprocess.Popen(command, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
        assert proc.stdin is not None
        try:
            report(JobState.RENDERING, _RENDER_START, "Rendering transparent kinetic caption states")
            for payload, count in self._iter_frame_payloads(renderer, cues, segments, total_frames, True, stats, False):
                for _ in range(count):
                    proc.stdin.write(payload)  # type: ignore[arg-type]
                frames_written += count
                now = time.perf_counter()
                if now - last_report >= 0.25:
                    last_report = now
                    report(
                        JobState.RENDERING,
                        _RENDER_START + (0.98 - _RENDER_START) * (frames_written / total_frames),
                        f"Writing alpha frame {frames_written}/{total_frames}",
                    )
        finally:
            try:
                proc.stdin.close()
            except Exception:
                pass

        stderr_bytes = proc.stderr.read() if proc.stderr else b""
        ret = proc.wait()
        if ret != 0 or not output_path.exists():
            tail = stderr_bytes.decode("utf-8", errors="replace").strip()[-2000:]
            raise PipelineError(f"FFmpeg transparent MOV encode failed (exit {ret}): {tail}")

        stats.render_seconds = round(time.perf_counter() - render_started, 3)
        stats.mux_seconds = 0.0
        report(JobState.COMPLETED, 1.0, "Transparent MOV render complete")
        return stats
