"""MedSub / HormoziSub FastAPI application (Phase 1 + Phase 2 + Phase 3).

Endpoints:
    POST /api/transcribe-and-direct  audio -> word-timed cues + AI Director plan + SRT
    POST /api/translate-cues         cues -> translated cues (acoustic windows preserved)
    POST /api/fetch-broll            cues -> Pexels vertical B-roll pack (+ .zip)
    POST /api/preview-frame          single 1080x1920 PNG (kinetic text, emoji, motion graphic)
    POST /api/render                 audio (+ optional cues JSON or .srt) -> 60fps render job
"""

from __future__ import annotations

import base64
import io
import json
import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pydantic import TypeAdapter, ValidationError

from . import __version__
from .config import (
    ALLOWED_AUDIO_EXTENSIONS,
    ALLOWED_FONT_EXTENSIONS,
    ALLOWED_SRT_EXTENSIONS,
    API_PREFIX,
    APP_NAME,
    CORS_ORIGINS,
    DEFAULT_FONT_KEY,
    DEFAULT_PREVIEW_TEXT,
    DOWNLOADABLE_EXTENSIONS,
    FRONTEND_DIR,
    GEMINI_MODEL,
    MAX_AUDIO_UPLOAD_BYTES,
    MAX_CONCURRENT_RENDERS,
    MAX_FONT_UPLOAD_BYTES,
    MAX_SRT_UPLOAD_BYTES,
    OUTPUTS_DIR,
    UPLOADS_DIR,
    ensure_directories,
    get_active_broll_providers,
    get_gemini_api_key,
    get_groq_api_key,
    get_pexels_api_key,
    get_pixabay_api_key,
    get_unsplash_access_key,
    resolve_ffmpeg_binary,
)
from .models import (
    EnrichedSubtitleCue,
    FetchBrollRequest,
    FetchBrollResponse,
    FontInfo,
    FontListResponse,
    JobState,
    JobStatus,
    PreviewBase64Response,
    PreviewRequest,
    RenderConfig,
    TargetLanguage,
    TranscribeAndDirectResponse,
    TranslateCuesRequest,
    TranslateCuesResponse,
    VisualCuePlan,
    WordBoxInfo,
    utcnow,
)
from .services.ai_director import AIDirector
from .services.audio_transcriber import AudioTranscriber, cues_to_srt
from .services.broll_fetcher import BrollFetcher
from .services.font_manager import FontManager, FontNotFoundError, InvalidFontError
from .services.frame_renderer import FrameRenderer
from .services.sfx_mixer import SfxMixer
from .services.video_pipeline import PipelineError, VideoPipeline, cues_from_srt, probe_audio_duration

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
logger = logging.getLogger("hormozisub.api")

ensure_directories()

font_manager = FontManager()
sfx_mixer = SfxMixer()
pipeline = VideoPipeline(font_manager, sfx_mixer=sfx_mixer)
transcriber = AudioTranscriber()
director = AIDirector()
broll_fetcher = BrollFetcher()

_CUES_ADAPTER = TypeAdapter(List[EnrichedSubtitleCue])
_VALID_LANGUAGES = ("darija_mixed", "ar_fusha", "fr", "en")


# --------------------------------------------------------------------------- #
# Shared AI orchestration
# --------------------------------------------------------------------------- #
def transcribe_and_direct(
    audio_path: Path,
    target_language: TargetLanguage,
    words_per_line: int = 4,
    max_lines: int = 1,
) -> Dict[str, object]:
    """Groq/faster-whisper word timing -> Gemini Darija alignment/translation -> AI Director."""
    raw_words, asr_engine = transcriber.extract_acoustic_words(audio_path)
    if not raw_words:
        raise PipelineError("No speech could be detected in the uploaded audio.")
    cues, align_engine = transcriber.align_and_translate(
        audio_path,
        raw_words,
        target_language,
        words_per_line=words_per_line,
        max_lines=max_lines,
    )
    if not cues:
        raise PipelineError("Transcription produced no subtitle cues.")
    directed, director_engine = director.direct_cues(cues)
    return {
        "cues": directed,
        "engine_used": f"{asr_engine} + {align_engine} + {director_engine}",
    }


def _plans_are_default(cues: List[EnrichedSubtitleCue]) -> bool:
    default = VisualCuePlan()
    return all(c.visual_plan == default for c in cues)


# --------------------------------------------------------------------------- #
# Job manager
# --------------------------------------------------------------------------- #
class JobManager:
    """Thread-safe in-memory registry of render jobs backed by a worker pool."""

    def __init__(self, max_workers: int) -> None:
        self._jobs: Dict[str, JobStatus] = {}
        self._lock = threading.Lock()
        self._executor = ThreadPoolExecutor(max_workers=max(1, max_workers), thread_name_prefix="render")

    def create(self, config: RenderConfig) -> JobStatus:
        job = JobStatus(job_id=uuid.uuid4().hex, config=config, message="Queued")
        with self._lock:
            self._jobs[job.job_id] = job
        return job.model_copy(deep=True)

    def get(self, job_id: str) -> Optional[JobStatus]:
        with self._lock:
            job = self._jobs.get(job_id)
            return job.model_copy(deep=True) if job else None

    def list(self) -> List[JobStatus]:
        with self._lock:
            return [job.model_copy(deep=True) for job in sorted(self._jobs.values(), key=lambda j: j.created_at, reverse=True)]

    def update(self, job_id: str, **changes) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            for key, value in changes.items():
                setattr(job, key, value)
            job.updated_at = utcnow()

    def run(
        self,
        job_id: str,
        audio_path: Path,
        config: RenderConfig,
        cues: Optional[List[EnrichedSubtitleCue]] = None,
        srt_path: Optional[Path] = None,
    ) -> JobStatus:
        """Execute the (optionally end-to-end) pipeline synchronously in the calling thread."""
        ext = ".mov" if config.transparent_bg else ".mp4"
        output_name = f"medsub_{job_id}{ext}"
        output_path = OUTPUTS_DIR / output_name
        sfx_name = f"medsub_{job_id}_sfx_track.wav"
        srt_name = f"medsub_{job_id}.srt"

        def on_progress(state: JobState, progress: float, message: str) -> None:
            if state is JobState.COMPLETED:
                return  # finalized below together with stats / URLs
            self.update(job_id, state=state, progress=round(min(max(progress, 0.0), 0.999), 4), message=message)

        try:
            # 1. Resolve cues: user-edited JSON > uploaded SRT > full AI transcription.
            if cues:
                working = cues
                if _plans_are_default(working) and (
                    config.enable_emojis or config.enable_motion_graphics or config.enable_sfx or config.enable_broll
                ):
                    self.update(job_id, state=JobState.DIRECTING, progress=0.01, message="AI Director planning visuals")
                    working, _ = director.direct_cues(working)
            elif srt_path is not None:
                self.update(job_id, state=JobState.PARSING, progress=0.0, message="Parsing subtitles")
                working = cues_from_srt(srt_path, config.min_word_duration)
                if not working:
                    raise PipelineError("The SRT file contains no valid cues.")
                if config.enable_emojis or config.enable_motion_graphics or config.enable_sfx or config.enable_broll:
                    self.update(job_id, state=JobState.DIRECTING, progress=0.01, message="AI Director planning visuals")
                    working, _ = director.direct_cues(working)
            else:
                self.update(job_id, state=JobState.TRANSCRIBING, progress=0.0, message="Transcribing Darija audio")
                result = transcribe_and_direct(
                    audio_path,
                    config.target_language,
                    words_per_line=config.words_per_line,
                    max_lines=config.max_lines,
                )
                working = result["cues"]  # type: ignore[assignment]

            # 2. Optional B-roll download (composited behind captions + .zip pack).
            broll_zip_url: Optional[str] = None
            if config.enable_broll and not config.transparent_bg:
                self.update(job_id, state=JobState.DIRECTING, progress=0.015, message="Fetching Pexels B-roll")
                _, _, broll_zip_url, working = broll_fetcher.fetch_for_cues(working, job_id=job_id, create_zip=True)

            (OUTPUTS_DIR / srt_name).write_text(cues_to_srt(working), encoding="utf-8")
            self.update(job_id, cues=working, srt_download_url=f"{API_PREFIX}/download/{srt_name}", broll_zip_url=broll_zip_url)

            # 3. Render + mux.
            stats = pipeline.render_cues(
                audio_path,
                working,
                config,
                output_path,
                progress=on_progress,
                sfx_output_path=(OUTPUTS_DIR / sfx_name) if config.enable_sfx else None,
            )
            sfx_url = f"{API_PREFIX}/download/{sfx_name}" if config.enable_sfx and (OUTPUTS_DIR / sfx_name).is_file() else None
            self.update(
                job_id,
                state=JobState.COMPLETED,
                progress=1.0,
                message="Render complete",
                stats=stats,
                output_filename=output_name,
                download_url=f"{API_PREFIX}/download/{output_name}",
                sfx_download_url=sfx_url,
                finished_at=utcnow(),
            )
        except Exception as exc:
            logger.exception("Render job %s failed", job_id)
            self.update(job_id, state=JobState.FAILED, message="Render failed", error=str(exc), finished_at=utcnow())
        finally:
            for path in (audio_path, srt_path):
                if path is None:
                    continue
                try:
                    path.unlink(missing_ok=True)
                except OSError:
                    pass
        return self.get(job_id)  # type: ignore[return-value]

    def submit(self, job_id: str, audio_path: Path, config: RenderConfig, cues=None, srt_path=None) -> None:
        self._executor.submit(self.run, job_id, audio_path, config, cues, srt_path)

    def shutdown(self) -> None:
        self._executor.shutdown(wait=False, cancel_futures=True)


jobs = JobManager(MAX_CONCURRENT_RENDERS)


# --------------------------------------------------------------------------- #
# Lifespan
# --------------------------------------------------------------------------- #
@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_directories()
    threading.Thread(target=font_manager.prefetch_presets, name="font-prefetch", daemon=True).start()
    sfx_mixer.ensure_sfx_assets()
    try:
        logger.info("FFmpeg binary: %s", resolve_ffmpeg_binary())
    except RuntimeError as exc:
        logger.error(str(exc))
    logger.info(
        "AI engines: groq=%s gemini=%s unsplash=%s broll_providers=%s",
        bool(get_groq_api_key()),
        bool(get_gemini_api_key()),
        bool(get_unsplash_access_key()),
        get_active_broll_providers(),
    )
    yield
    jobs.shutdown()


app = FastAPI(
    title=f"{APP_NAME} API",
    version=__version__,
    description="Algerian Darija auto-transcription, AI video direction and 1080x1920 60fps kinetic caption rendering.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials="*" not in CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Render-Time-Ms", "X-Word-Count", "Content-Disposition"],
)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _extension(upload: UploadFile) -> str:
    return Path(upload.filename or "").suffix.lower()


async def _save_upload(upload: UploadFile, destination: Path, max_bytes: int) -> int:
    written = 0
    try:
        with destination.open("wb") as handle:
            while chunk := await upload.read(1024 * 1024):
                written += len(chunk)
                if written > max_bytes:
                    raise HTTPException(
                        status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        f"'{upload.filename}' exceeds the {max_bytes // (1024 * 1024)} MB limit",
                    )
                handle.write(chunk)
    except HTTPException:
        destination.unlink(missing_ok=True)
        raise
    finally:
        await upload.close()
    if written == 0:
        destination.unlink(missing_ok=True)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"'{upload.filename}' is empty")
    return written


async def _save_audio_or_400(audio_file: UploadFile) -> Path:
    if _extension(audio_file) not in ALLOWED_AUDIO_EXTENSIONS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unsupported audio type. Allowed: {sorted(ALLOWED_AUDIO_EXTENSIONS)}")
    path = UPLOADS_DIR / f"{uuid.uuid4().hex}_audio{_extension(audio_file)}"
    await _save_upload(audio_file, path, MAX_AUDIO_UPLOAD_BYTES)
    return path


def _parse_config(raw: Optional[str]) -> RenderConfig:
    try:
        return RenderConfig.model_validate_json(raw) if raw and raw.strip() else RenderConfig()
    except ValidationError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, exc.errors(include_url=False)) from exc


def _parse_cues(raw: Optional[str]) -> Optional[List[EnrichedSubtitleCue]]:
    if not raw or not raw.strip():
        return None
    try:
        data = json.loads(raw)
        if isinstance(data, dict) and "cues" in data:
            data = data["cues"]
        cues = _CUES_ADAPTER.validate_python(data)
    except (ValueError, ValidationError) as exc:
        detail = exc.errors(include_url=False) if isinstance(exc, ValidationError) else str(exc)
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail) from exc
    return cues or None


def _validate_language(value: str) -> TargetLanguage:
    value = (value or "darija_mixed").strip()
    if value not in _VALID_LANGUAGES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"target_language must be one of {list(_VALID_LANGUAGES)}")
    return value  # type: ignore[return-value]


def _load_font_or_400(config: RenderConfig):
    try:
        return font_manager.get_font(config.font_choice, config.font_size)
    except FontNotFoundError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


# --------------------------------------------------------------------------- #
# System / config / fonts
# --------------------------------------------------------------------------- #
@app.get(f"{API_PREFIX}/health", tags=["system"])
def health() -> dict:
    try:
        ffmpeg = resolve_ffmpeg_binary()
    except RuntimeError:
        ffmpeg = None
    return {
        "status": "ok",
        "app": APP_NAME,
        "version": __version__,
        "ffmpeg": ffmpeg,
        "ai": {
            "transcription": "groq:whisper-large-v3" if get_groq_api_key() else "faster-whisper (local fallback)",
            "alignment": f"gemini:{GEMINI_MODEL}" if get_gemini_api_key() else "local-darija-aligner",
            "director": f"gemini:{GEMINI_MODEL}" if get_gemini_api_key() else "heuristic-darija-director",
            "broll_providers": get_active_broll_providers(),
        },
    }


@app.get(f"{API_PREFIX}/config/defaults", response_model=RenderConfig, tags=["config"])
def default_config() -> RenderConfig:
    return RenderConfig()


@app.get(f"{API_PREFIX}/fonts", response_model=FontListResponse, tags=["fonts"])
def list_fonts() -> FontListResponse:
    listing = font_manager.list_fonts()
    return FontListResponse(
        default=DEFAULT_FONT_KEY,
        presets=[FontInfo(**item) for item in listing["presets"]],
        custom=[FontInfo(**item) for item in listing["custom"]],
    )


@app.post(f"{API_PREFIX}/upload-font", response_model=FontInfo, status_code=201, tags=["fonts"])
async def upload_font(font_file: UploadFile = File(..., description=".ttf or .otf font file")) -> FontInfo:
    if _extension(font_file) not in ALLOWED_FONT_EXTENSIONS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only .ttf and .otf fonts are supported")
    data = await font_file.read(MAX_FONT_UPLOAD_BYTES + 1)
    await font_file.close()
    if len(data) > MAX_FONT_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Font file is too large")
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Font file is empty")
    try:
        path = await run_in_threadpool(font_manager.save_custom_font, font_file.filename or "font.ttf", data)
    except InvalidFontError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return FontInfo(key=path.name, display_name=path.stem.replace("_", " "), kind="custom", available=True, filename=path.name)


# --------------------------------------------------------------------------- #
# Phase 2: transcription & translation
# --------------------------------------------------------------------------- #
@app.post(f"{API_PREFIX}/transcribe-and-direct", response_model=TranscribeAndDirectResponse, tags=["ai"])
async def transcribe_and_direct_endpoint(
    audio_file: UploadFile = File(..., description="Voice-over (.wav / .mp3) in Algerian Darija"),
    target_language: str = Form("darija_mixed", description="darija_mixed | ar_fusha | fr | en"),
    words_per_line: int = Form(4, ge=1, le=8, description="Maximum words per line (1 to 6)"),
    max_lines: int = Form(1, ge=1, le=3, description="Maximum lines per subtitle cue (1 or 2)"),
) -> TranscribeAndDirectResponse:
    language = _validate_language(target_language)
    audio_path = await _save_audio_or_400(audio_file)
    try:
        result = await run_in_threadpool(
            transcribe_and_direct,
            audio_path,
            language,
            words_per_line,
            max_lines,
        )
        duration = await run_in_threadpool(probe_audio_duration, audio_path)
    finally:
        audio_path.unlink(missing_ok=True)
    cues: List[EnrichedSubtitleCue] = result["cues"]  # type: ignore[assignment]
    return TranscribeAndDirectResponse(
        target_language=language,
        audio_duration=round(duration or max((c.end for c in cues), default=0.0), 3),
        cues=cues,
        visual_plan=[c.visual_plan for c in cues],
        srt_content=cues_to_srt(cues),
        engine_used=str(result["engine_used"]),
    )


@app.post(f"{API_PREFIX}/translate-cues", response_model=TranslateCuesResponse, tags=["ai"])
async def translate_cues_endpoint(request: TranslateCuesRequest) -> TranslateCuesResponse:
    if not request.cues:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "cues must not be empty")
    translated = await run_in_threadpool(
        transcriber.translate_cues,
        request.cues,
        request.target_language,
        request.words_per_line,
        request.max_lines,
    )
    if request.direct_visuals and _plans_are_default(translated):
        translated, _ = await run_in_threadpool(director.direct_cues, translated)
    return TranslateCuesResponse(
        target_language=request.target_language,
        cues=translated,
        srt_content=cues_to_srt(translated),
    )


# --------------------------------------------------------------------------- #
# Phase 3: B-roll
# --------------------------------------------------------------------------- #
@app.post(f"{API_PREFIX}/fetch-broll", response_model=FetchBrollResponse, tags=["ai"])
async def fetch_broll_endpoint(request: FetchBrollRequest) -> FetchBrollResponse:
    if not request.cues:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "cues must not be empty")
    cues = request.cues
    if all(not c.visual_plan.broll_query for c in cues):
        cues, _ = await run_in_threadpool(director.direct_cues, cues)
    job_id = request.job_id
    if job_id and (any(sep in job_id for sep in ("/", "\\", "..")) or len(job_id) > 64):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid job_id")
    resolved_id, clips, zip_url, updated = await run_in_threadpool(
        broll_fetcher.fetch_for_cues, cues, job_id, request.create_zip
    )
    return FetchBrollResponse(job_id=resolved_id, clips=clips, zip_download_url=zip_url, cues=updated)


# --------------------------------------------------------------------------- #
# Preview & render
# --------------------------------------------------------------------------- #
@app.post(f"{API_PREFIX}/preview-frame", tags=["render"], responses={200: {"content": {"image/png": {}}}})
def preview_frame(request: PreviewRequest):
    """Render one styled frame (kinetic word, floating emoji, motion graphic) as PNG or base64 JSON."""
    started = time.perf_counter()
    config = request.config
    font = _load_font_or_400(config)
    card_font = font_manager.get_font(config.font_choice, max(28, int(round(config.font_size * 0.62))))
    renderer = FrameRenderer(config, font, font_manager.get_reshaper(config.font_choice), card_font=card_font)
    layout = renderer.layout_text(request.text or DEFAULT_PREVIEW_TEXT)
    active = request.active_word_index if 0 <= request.active_word_index < layout.word_count else None
    image = renderer.render(
        layout,
        active,
        visual_plan=request.visual_plan,
        anim_frame=request.anim_frame,
        cue_frame_offset=max(12, request.anim_frame),
    )

    if request.preview_scale < 1.0:
        scaled = (max(1, round(config.width * request.preview_scale)), max(1, round(config.height * request.preview_scale)))
        image = image.resize(scaled, Image.Resampling.BILINEAR)

    buffer = io.BytesIO()
    image.save(buffer, format="PNG", compress_level=1)
    png_bytes = buffer.getvalue()
    render_ms = round((time.perf_counter() - started) * 1000, 2)

    if request.response_format == "base64":
        return PreviewBase64Response(
            image_base64="data:image/png;base64," + base64.b64encode(png_bytes).decode("ascii"),
            width=image.width,
            height=image.height,
            word_count=layout.word_count,
            active_word_index=active if active is not None else -1,
            render_ms=render_ms,
            words=[
                WordBoxInfo(index=w.index, text=w.text, line=w.line_index, x1=w.x1, y1=w.y1, x2=w.x2, y2=w.y2)
                for w in layout.words
            ],
        )
    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={"X-Render-Time-Ms": str(render_ms), "X-Word-Count": str(layout.word_count), "Cache-Control": "no-store"},
    )


@app.post(f"{API_PREFIX}/render", response_model=JobStatus, tags=["render"])
async def render_video(
    audio_file: UploadFile = File(..., description="Voice-over audio (.wav/.mp3/...)"),
    srt_file: Optional[UploadFile] = File(None, description="Optional legacy subtitle file (.srt)"),
    cues: Optional[str] = Form(None, description="Optional EnrichedSubtitleCue[] JSON (user-edited)"),
    config: Optional[str] = Form(None, description="RenderConfig as a JSON string"),
    sync: bool = Query(False, description="Block until the render finishes instead of returning a job immediately"),
):
    """Start a 60fps render.

    Priority: ``cues`` JSON > ``srt_file`` > full end-to-end Darija transcription + AI direction.
    Poll ``GET /api/jobs/{job_id}`` or use ``?sync=true``.
    """
    render_config = _parse_config(config)
    parsed_cues = _parse_cues(cues)
    has_srt = srt_file is not None and bool(srt_file.filename)
    if has_srt and _extension(srt_file) not in ALLOWED_SRT_EXTENSIONS:  # type: ignore[arg-type]
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Subtitle file must be a .srt")
    await run_in_threadpool(_load_font_or_400, render_config)  # fail fast on bad font

    audio_path = await _save_audio_or_400(audio_file)
    srt_path: Optional[Path] = None
    if has_srt and parsed_cues is None:
        srt_path = UPLOADS_DIR / f"{uuid.uuid4().hex}_subs.srt"
        try:
            await _save_upload(srt_file, srt_path, MAX_SRT_UPLOAD_BYTES)  # type: ignore[arg-type]
        except HTTPException:
            audio_path.unlink(missing_ok=True)
            raise

    job = jobs.create(render_config)
    if sync:
        result = await run_in_threadpool(jobs.run, job.job_id, audio_path, render_config, parsed_cues, srt_path)
        if result.state is JobState.FAILED:
            return JSONResponse(status_code=500, content=result.model_dump(mode="json"))
        return result
    jobs.submit(job.job_id, audio_path, render_config, parsed_cues, srt_path)
    return JSONResponse(status_code=202, content=job.model_dump(mode="json"))


@app.get(f"{API_PREFIX}/jobs", response_model=List[JobStatus], tags=["render"])
def list_jobs() -> List[JobStatus]:
    return jobs.list()


@app.get(f"{API_PREFIX}/jobs/{{job_id}}", response_model=JobStatus, tags=["render"])
def get_job(job_id: str) -> JobStatus:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    return job


@app.get(f"{API_PREFIX}/download/{{filename}}", tags=["render"])
def download(filename: str):
    safe_name = Path(filename).name
    suffix = Path(safe_name).suffix.lower()
    if safe_name != filename or suffix not in DOWNLOADABLE_EXTENSIONS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid filename")
    path = OUTPUTS_DIR / safe_name
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found")
    return FileResponse(path, media_type=DOWNLOADABLE_EXTENSIONS[suffix], filename=safe_name)


@app.exception_handler(PipelineError)
async def pipeline_error_handler(_: Request, exc: PipelineError):
    return JSONResponse(status_code=500, content={"detail": str(exc)})


# --------------------------------------------------------------------------- #
# Static mounts
# --------------------------------------------------------------------------- #
app.mount("/outputs", StaticFiles(directory=str(OUTPUTS_DIR)), name="outputs")

_FRONTEND_DIST = FRONTEND_DIR / "dist"
if (_FRONTEND_DIST / "index.html").is_file():
    app.mount("/", StaticFiles(directory=str(_FRONTEND_DIST), html=True), name="frontend")
elif (FRONTEND_DIR / "index.html").is_file():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
else:

    @app.get("/", include_in_schema=False)
    def root() -> dict:
        return {
            "app": APP_NAME,
            "version": __version__,
            "docs": "/docs",
            "frontend": "Place the built UI (index.html + assets) in /frontend to serve it here.",
        }
