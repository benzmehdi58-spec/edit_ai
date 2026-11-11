"""Multi-Provider Auto B-Roll Fetcher (`services/broll_fetcher.py` — Phase 3).

Aggregates multiple stock video & high-res photo sources in a resilient waterfall
so B-Roll fetching works immediately without relying on paused Pexels/Pixabay keys:
    1. Unsplash API (`UNSPLASH_ACCESS_KEY` — instant free key; high-res 9:16
       portrait photos animated into smooth 30fps Ken Burns zoom/pan MP4 clips)
    2. Pixabay Video API (`PIXABAY_API_KEY` — optional if user has a key)
    3. Pexels Video Search API (`PEXELS_API_KEY` — optional if user has a key)
    4. Coverr Public Stock Video API (Zero API key required)
    5. Wikimedia Commons Open MediaWiki Video API (Zero API key required)
    6. Openverse Creative Commons Portrait Photo API (Zero API key required;
       animated with Ken Burns zoom/pan into 9:16 MP4)
    7. Internet Archive Open Video Search API (Zero API key required)
    8. Procedural 9:16 Motion Canvas Fallback (Offline / guaranteed fallback)
"""

from __future__ import annotations

import hashlib
import logging
import re
import shutil
import subprocess
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Literal, Optional, Sequence, Set, Tuple

import cv2
import numpy as np
import requests
from PIL import Image

from ..config import (
    API_PREFIX,
    BROLL_CACHE_DIR,
    OUTPUTS_DIR,
    TEMP_DIR,
    get_pexels_api_key,
    get_pixabay_api_key,
    get_unsplash_access_key,
    resolve_ffmpeg_binary,
)
from ..models import BrollClipInfo, EnrichedSubtitleCue

logger = logging.getLogger("hormozisub.broll")

UNSPLASH_SEARCH_URL = "https://api.unsplash.com/search/photos"
OPENVERSE_IMAGES_URL = "https://api.openverse.org/v1/images/"
PIXABAY_VIDEOS_URL = "https://pixabay.com/api/videos/"
PEXELS_VIDEOS_SEARCH_URL = "https://api.pexels.com/videos/search"
COVERR_VIDEOS_URL = "https://api.coverr.co/videos"
WIKIMEDIA_API_URL = "https://commons.wikimedia.org/w/api.php"
INTERNET_ARCHIVE_SEARCH_URL = "https://archive.org/advancedsearch.php"

_SLUG_RE = re.compile(r"[^a-z0-9]+")
_STOPWORDS = {"with", "from", "that", "this", "into", "over", "under", "very", "person", "modern"}


@dataclass
class StockCandidate:
    provider: str
    video_id: str
    download_url: str
    width: int = 720
    height: int = 1280
    media_type: Literal["video", "image"] = "video"


def _format_ts_token(seconds: float) -> str:
    """Format `4.25` -> `00s04` (`MMsSS`)."""
    total_sec = max(0, int(round(seconds)))
    mins = total_sec // 60
    secs = total_sec % 60
    return f"{mins:02d}s{secs:02d}"


def _slugify_query(query: str, max_words: int = 3) -> str:
    words = [w for w in _SLUG_RE.sub(" ", query.lower()).split() if w][:max_words]
    return "_".join(words) if words else "broll"


def _simplify_query(query: str, max_terms: int = 3) -> str:
    """Distill a verbose AI Director query into 2-3 core visual nouns/verbs for broader stock hits."""
    tokens = [w for w in _SLUG_RE.sub(" ", query.lower()).split() if len(w) > 2 and w not in _STOPWORDS]
    return " ".join(tokens[:max_terms]) if tokens else query.strip()


def build_broll_filename(cue_index: int, start: float, end: float, query: str) -> str:
    """Return e.g. `cue_03_00s04_to_00s07_slow_phone.mp4`."""
    s_tok = _format_ts_token(start)
    e_tok = _format_ts_token(end)
    slug = _slugify_query(query)
    return f"cue_{cue_index + 1:02d}_{s_tok}_to_{e_tok}_{slug}.mp4"


class BrollFetcher:
    """Multi-provider stock B-Roll engine (Unsplash + Pixabay + Pexels + Coverr + Wikimedia + Openverse + Archive)."""

    def __init__(self) -> None:
        BROLL_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        self._session = requests.Session()
        self._session.headers.update(
            {
                "User-Agent": "MedSubStudio/2.0 (https://localhost:8000; AI Video Editor)",
                "Accept": "application/json, */*",
            }
        )

    def fetch_for_cues(
        self,
        cues: Sequence[EnrichedSubtitleCue],
        job_id: Optional[str] = None,
        create_zip: bool = True,
    ) -> Tuple[str, List[BrollClipInfo], Optional[str], List[EnrichedSubtitleCue]]:
        """Fetch B-roll clips for all cues with a `broll_query` across multiple providers."""
        resolved_job_id = (job_id or uuid.uuid4().hex[:12]).strip()
        job_broll_dir = OUTPUTS_DIR / resolved_job_id / "broll"
        job_broll_dir.mkdir(parents=True, exist_ok=True)

        used_ids: Set[str] = set()
        clips: List[BrollClipInfo] = []
        updated_cues: List[EnrichedSubtitleCue] = []

        for idx, cue in enumerate(cues):
            query = (cue.visual_plan.broll_query or "").strip()
            if not query:
                updated_cues.append(cue.model_copy(deep=True))
                continue

            filename = build_broll_filename(idx, cue.start, cue.end, query)
            dest_path = job_broll_dir / filename
            duration_needed = max(1.5, round(cue.end - cue.start, 2))

            provider_used = "procedural_fallback"
            provider_vid_id: Optional[str] = None
            pexels_int_id: Optional[int] = None

            cached_clip, candidate = self._fetch_from_multi_providers(
                query=query,
                duration_needed=duration_needed,
                used_ids=used_ids,
            )
            if cached_clip is not None and cached_clip.is_file() and candidate is not None:
                shutil.copy2(cached_clip, dest_path)
                provider_used = candidate.provider
                provider_vid_id = candidate.video_id
                used_ids.add(f"{candidate.provider}:{candidate.video_id}")
                if candidate.provider == "pexels" and candidate.video_id.isdigit():
                    pexels_int_id = int(candidate.video_id)

            if not dest_path.is_file() or dest_path.stat().st_size == 0:
                provider_used = "procedural_fallback"
                self._generate_procedural_broll_mp4(
                    dest_path=dest_path,
                    query=query,
                    cue_text=cue.text,
                    duration=duration_needed,
                )

            preview_url = f"/outputs/{resolved_job_id}/broll/{filename}"
            clip_info = BrollClipInfo(
                cue_index=idx,
                query=query,
                start=cue.start,
                end=cue.end,
                filename=filename,
                local_path=str(dest_path),
                preview_url=preview_url,
                pexels_video_id=pexels_int_id,
                provider_video_id=provider_vid_id,
                duration=duration_needed,
                source=provider_used,  # type: ignore[arg-type]
            )
            clips.append(clip_info)
            updated_cues.append(
                cue.model_copy(
                    update={
                        "broll_clip_path": str(dest_path),
                        "broll_preview_url": preview_url,
                    },
                    deep=True,
                )
            )

        zip_download_url: Optional[str] = None
        if create_zip and clips:
            zip_filename = f"broll_{resolved_job_id}.zip"
            zip_path = OUTPUTS_DIR / zip_filename
            with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
                for clip in clips:
                    p = Path(clip.local_path)
                    if p.is_file():
                        zf.write(p, arcname=clip.filename)
            zip_download_url = f"{API_PREFIX}/download/{zip_filename}"

        return resolved_job_id, clips, zip_download_url, updated_cues

    # ------------------------------------------------------------------ #
    # Multi-Provider Waterfall Orchestrator
    # ------------------------------------------------------------------ #
    def _fetch_from_multi_providers(
        self,
        query: str,
        duration_needed: float,
        used_ids: Set[str],
    ) -> Tuple[Optional[Path], Optional[StockCandidate]]:
        """Query providers in waterfall order; download and normalize the first healthy clip."""
        unsplash_key = get_unsplash_access_key()
        pixabay_key = get_pixabay_api_key()
        pexels_key = get_pexels_api_key()
        short_query = _simplify_query(query)
        queries_to_try = [query] if short_query == query.lower() else [query, short_query]

        provider_chain = []
        if unsplash_key:
            provider_chain.append(("unsplash", lambda q: self._search_unsplash(q, unsplash_key)))
        if pixabay_key:
            provider_chain.append(("pixabay", lambda q: self._search_pixabay(q, pixabay_key)))
        if pexels_key:
            provider_chain.append(("pexels", lambda q: self._search_pexels(q, pexels_key)))
        # Zero-key providers (videos + high-res portrait photos)
        provider_chain.extend(
            [
                ("coverr", self._search_coverr),
                ("wikimedia", self._search_wikimedia),
                ("openverse", self._search_openverse),
                ("internet_archive", self._search_internet_archive),
            ]
        )

        for provider_name, search_fn in provider_chain:
            for q in queries_to_try:
                try:
                    candidates = search_fn(q)
                except Exception as exc:
                    logger.debug("Provider '%s' search failed for '%s': %s", provider_name, q, exc)
                    continue

                for cand in candidates:
                    unique_key = f"{cand.provider}:{cand.video_id}"
                    if unique_key in used_ids:
                        continue
                    cached = self._download_and_normalize_candidate(cand, duration_needed)
                    if cached is not None and cached.is_file() and cached.stat().st_size > 8_000:
                        logger.info(
                            "Fetched B-Roll [%s id=%s type=%s] for query '%s' -> %s",
                            cand.provider,
                            cand.video_id,
                            cand.media_type,
                            q,
                            cached.name,
                        )
                        return cached, cand
                if candidates:
                    break

        return None, None

    # ------------------------------------------------------------------ #
    # Provider 1: Unsplash API (Instant Free Access Key -> Ken Burns 9:16 Video)
    # ------------------------------------------------------------------ #
    def _search_unsplash(self, query: str, access_key: str) -> List[StockCandidate]:
        headers = {
            "Authorization": f"Client-ID {access_key}",
            "Accept-Version": "v1",
        }
        params = {
            "query": query,
            "orientation": "portrait",
            "per_page": 8,
            "content_filter": "high",
        }
        resp = self._session.get(UNSPLASH_SEARCH_URL, headers=headers, params=params, timeout=12)
        resp.raise_for_status()
        results_json = resp.json().get("results") or []
        candidates: List[StockCandidate] = []
        for item in results_json:
            photo_id = str(item.get("id") or "").strip()
            urls = item.get("urls") or {}
            img_url = str(urls.get("regular") or urls.get("full") or urls.get("small") or "").strip()
            if not photo_id or not img_url:
                continue
            candidates.append(
                StockCandidate(
                    provider="unsplash",
                    video_id=photo_id,
                    download_url=img_url,
                    width=int(item.get("width") or 1080),
                    height=int(item.get("height") or 1920),
                    media_type="image",
                )
            )
        return candidates

    # ------------------------------------------------------------------ #
    # Provider 2: Openverse Portrait Photo API (Zero API Key -> Ken Burns 9:16)
    # ------------------------------------------------------------------ #
    def _search_openverse(self, query: str) -> List[StockCandidate]:
        params = {
            "q": query,
            "aspect_ratio": "tall",
            "page_size": 6,
        }
        resp = self._session.get(OPENVERSE_IMAGES_URL, params=params, timeout=10)
        if resp.status_code != 200:
            return []
        items = resp.json().get("results") or []
        candidates: List[StockCandidate] = []
        for item in items:
            img_id = str(item.get("id") or "").strip()
            img_url = str(item.get("url") or "").strip()
            if not img_id or not img_url:
                continue
            candidates.append(
                StockCandidate(
                    provider="openverse",
                    video_id=img_id,
                    download_url=img_url,
                    width=int(item.get("width") or 1080),
                    height=int(item.get("height") or 1920),
                    media_type="image",
                )
            )
        return candidates

    # ------------------------------------------------------------------ #
    # Provider 3: Pixabay Video API
    # ------------------------------------------------------------------ #
    def _search_pixabay(self, query: str, api_key: str) -> List[StockCandidate]:
        params = {
            "key": api_key,
            "q": query,
            "per_page": 8,
            "safesearch": "true",
        }
        resp = self._session.get(PIXABAY_VIDEOS_URL, params=params, timeout=12)
        resp.raise_for_status()
        hits = resp.json().get("hits") or []
        results: List[StockCandidate] = []
        for hit in hits:
            vid_id = str(hit.get("id") or "")
            videos = hit.get("videos") or {}
            chosen = videos.get("medium") or videos.get("small") or videos.get("large") or {}
            url = str(chosen.get("url") or "").strip()
            if not url or not vid_id:
                continue
            results.append(
                StockCandidate(
                    provider="pixabay",
                    video_id=vid_id,
                    download_url=url,
                    width=int(chosen.get("width") or 1280),
                    height=int(chosen.get("height") or 720),
                    media_type="video",
                )
            )
        return results

    # ------------------------------------------------------------------ #
    # Provider 4: Pexels Video Search API
    # ------------------------------------------------------------------ #
    def _search_pexels(self, query: str, api_key: str) -> List[StockCandidate]:
        headers = {"Authorization": api_key}
        params = {
            "query": query,
            "orientation": "portrait",
            "size": "medium",
            "per_page": 6,
        }
        resp = self._session.get(PEXELS_VIDEOS_SEARCH_URL, headers=headers, params=params, timeout=12)
        resp.raise_for_status()
        videos = resp.json().get("videos") or []
        results: List[StockCandidate] = []
        for v in videos:
            vid_id = str(v.get("id") or "")
            v_files: List[Dict] = v.get("video_files") or []
            mp4s = [vf for vf in v_files if str(vf.get("file_type", "")).lower() == "video/mp4" and vf.get("link")]
            if not mp4s or not vid_id:
                continue
            best = sorted(
                mp4s,
                key=lambda vf: (
                    1 if int(vf.get("height") or 0) >= int(vf.get("width") or 0) else 0,
                    -abs(int(vf.get("height") or 1280) - 1280),
                ),
                reverse=True,
            )[0]
            results.append(
                StockCandidate(
                    provider="pexels",
                    video_id=vid_id,
                    download_url=str(best["link"]),
                    width=int(best.get("width") or 720),
                    height=int(best.get("height") or 1280),
                    media_type="video",
                )
            )
        return results

    # ------------------------------------------------------------------ #
    # Provider 5: Coverr Public Stock API (Zero API Key)
    # ------------------------------------------------------------------ #
    def _search_coverr(self, query: str) -> List[StockCandidate]:
        params = {"query": query, "urls": "true", "page_size": 6}
        resp = self._session.get(COVERR_VIDEOS_URL, params=params, timeout=10)
        if resp.status_code != 200:
            return []
        data = resp.json()
        hits = data.get("hits") if isinstance(data, dict) else []
        results: List[StockCandidate] = []
        for hit in hits or []:
            if not isinstance(hit, dict):
                continue
            vid_id = str(hit.get("id") or hit.get("slug") or "")
            urls = hit.get("urls") or {}
            mp4_url = str(urls.get("mp4_download") or urls.get("mp4") or hit.get("mp4") or "").strip()
            if not mp4_url or not vid_id:
                continue
            results.append(
                StockCandidate(
                    provider="coverr",
                    video_id=vid_id,
                    download_url=mp4_url,
                    media_type="video",
                )
            )
        return results

    # ------------------------------------------------------------------ #
    # Provider 6: Wikimedia Commons Video API (Zero API Key)
    # ------------------------------------------------------------------ #
    def _search_wikimedia(self, query: str) -> List[StockCandidate]:
        params = {
            "action": "query",
            "format": "json",
            "generator": "search",
            "gsrsearch": f"filetype:video {query}",
            "gsrnamespace": 6,
            "gsrlimit": 6,
            "prop": "imageinfo",
            "iiprop": "url|size|mime",
        }
        resp = self._session.get(WIKIMEDIA_API_URL, params=params, timeout=12)
        resp.raise_for_status()
        pages = (resp.json().get("query") or {}).get("pages") or {}
        results: List[StockCandidate] = []
        for page_id, page in pages.items():
            infos = page.get("imageinfo") or []
            if not infos:
                continue
            info = infos[0]
            mime = str(info.get("mime") or "").lower()
            url = str(info.get("url") or "").strip()
            size_bytes = int(info.get("size") or 0)
            if not url or not mime.startswith("video/"):
                continue
            if size_bytes > 35 * 1024 * 1024:
                continue
            results.append(
                StockCandidate(
                    provider="wikimedia",
                    video_id=str(page_id),
                    download_url=url,
                    width=int(info.get("width") or 1280),
                    height=int(info.get("height") or 720),
                    media_type="video",
                )
            )
        return results

    # ------------------------------------------------------------------ #
    # Provider 7: Internet Archive Open Video Search API (Zero API Key)
    # ------------------------------------------------------------------ #
    def _search_internet_archive(self, query: str) -> List[StockCandidate]:
        clean_q = _simplify_query(query, max_terms=2)
        params = {
            "q": f'mediatype:(movies) AND ({clean_q}) AND format:(MPEG4)',
            "fl[]": ["identifier", "title"],
            "rows": 4,
            "page": 1,
            "output": "json",
        }
        resp = self._session.get(INTERNET_ARCHIVE_SEARCH_URL, params=params, timeout=12)
        resp.raise_for_status()
        docs = ((resp.json().get("response") or {}).get("docs")) or []
        results: List[StockCandidate] = []
        for doc in docs:
            ident = str(doc.get("identifier") or "").strip()
            if not ident:
                continue
            meta_resp = self._session.get(f"https://archive.org/metadata/{ident}/files", timeout=10)
            if meta_resp.status_code != 200:
                continue
            files = meta_resp.json().get("result") or []
            for f_obj in files:
                name = str(f_obj.get("name") or "")
                size_b = int(f_obj.get("size") or 0)
                if name.lower().endswith(".mp4") and 50_000 < size_b <= 25 * 1024 * 1024:
                    dl_url = f"https://archive.org/download/{ident}/{name}"
                    results.append(
                        StockCandidate(
                            provider="internet_archive",
                            video_id=f"{ident}/{name}",
                            download_url=dl_url,
                            media_type="video",
                        )
                    )
                    break
        return results

    # ------------------------------------------------------------------ #
    # Download + 9:16 Vertical Normalization (Video OR Ken Burns Image)
    # ------------------------------------------------------------------ #
    def _download_and_normalize_candidate(
        self,
        candidate: StockCandidate,
        duration_needed: float,
    ) -> Optional[Path]:
        key_hash = hashlib.sha1(f"{candidate.provider}:{candidate.video_id}".encode("utf-8")).hexdigest()[:16]
        normalized_path = BROLL_CACHE_DIR / f"{candidate.provider}_{key_hash}_9x16.mp4"
        if normalized_path.is_file() and normalized_path.stat().st_size > 10_000:
            return normalized_path

        TEMP_DIR.mkdir(parents=True, exist_ok=True)
        if candidate.media_type == "image":
            raw_tmp = TEMP_DIR / f"raw_img_{key_hash}.jpg"
        else:
            raw_ext = Path(candidate.download_url.split("?")[0]).suffix.lower() or ".mp4"
            if raw_ext not in (".mp4", ".webm", ".ogv", ".mov"):
                raw_ext = ".mp4"
            raw_tmp = TEMP_DIR / f"raw_broll_{key_hash}{raw_ext}"

        try:
            with self._session.get(candidate.download_url, stream=True, timeout=30) as dl_resp:
                dl_resp.raise_for_status()
                written = 0
                with raw_tmp.open("wb") as handle:
                    for chunk in dl_resp.iter_content(chunk_size=256 * 1024):
                        if not chunk:
                            continue
                        written += len(chunk)
                        if written > 40 * 1024 * 1024:
                            break
                        handle.write(chunk)

            if not raw_tmp.is_file() or raw_tmp.stat().st_size < 4_000:
                return None

            clip_dur = max(2.5, min(10.0, duration_needed + 0.8))

            # Path A: High-res Portrait Photo (Unsplash / Openverse) -> Ken Burns 9:16 MP4
            if candidate.media_type == "image":
                ok = self._render_ken_burns_mp4_from_image(
                    image_path=raw_tmp,
                    output_mp4_path=normalized_path,
                    duration=clip_dur,
                    seed_key=candidate.video_id,
                )
                return normalized_path if ok else None

            # Path B: Video Clip -> FFmpeg 9:16 Center-Crop & H.264 Normalization
            tmp_out = normalized_path.with_suffix(".part.mp4")
            cmd = [
                resolve_ffmpeg_binary(),
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(raw_tmp),
                "-t",
                f"{clip_dur:.2f}",
                "-vf",
                "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1",
                "-r",
                "30",
                "-an",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "21",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
                str(tmp_out),
            ]
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=45)
            if proc.returncode == 0 and tmp_out.is_file() and tmp_out.stat().st_size > 8_000:
                tmp_out.replace(normalized_path)
                return normalized_path
            tmp_out.unlink(missing_ok=True)
            return None
        except Exception as exc:
            logger.debug("Download/normalize failed for %s (%s): %s", candidate.provider, candidate.download_url, exc)
            return None
        finally:
            raw_tmp.unlink(missing_ok=True)

    # ------------------------------------------------------------------ #
    # Ken Burns 9:16 Animated Video Generator (for Unsplash / Openverse Photos)
    # ------------------------------------------------------------------ #
    @staticmethod
    def _render_ken_burns_mp4_from_image(
        image_path: Path,
        output_mp4_path: Path,
        duration: float,
        seed_key: str = "",
        fps: int = 30,
        out_w: int = 720,
        out_h: int = 1280,
    ) -> bool:
        """Turn a high-res photo into a smooth 30fps 9:16 Ken Burns zoom/pan H.264 MP4 clip."""
        try:
            with Image.open(image_path) as pil_img:
                rgb = pil_img.convert("RGB")
                # Scale & center-crop to an oversampled 9:16 master canvas (900x1600)
                master_w, master_h = 900, 1600
                scale = max(master_w / max(1, rgb.width), master_h / max(1, rgb.height))
                resized_w = max(master_w, int(round(rgb.width * scale)))
                resized_h = max(master_h, int(round(rgb.height * scale)))
                rgb_resized = rgb.resize((resized_w, resized_h), Image.Resampling.LANCZOS)
                x0 = (resized_w - master_w) // 2
                y0 = (resized_h - master_h) // 2
                master_rgb = np.asarray(rgb_resized.crop((x0, y0, x0 + master_w, y0 + master_h)), dtype=np.uint8)
                master_bgr = cv2.cvtColor(master_rgb, cv2.COLOR_RGB2BGR)
        except Exception as exc:
            logger.debug("Could not decode image %s for Ken Burns: %s", image_path, exc)
            return False

        total_frames = max(30, min(300, int(round(duration * fps))))
        tmp_avi = output_mp4_path.with_suffix(".kb_raw.mp4")
        writer = cv2.VideoWriter(
            str(tmp_avi),
            cv2.VideoWriter_fourcc(*"mp4v"),
            float(fps),
            (out_w, out_h),
        )
        if not writer.isOpened():
            return False

        zoom_in = (int(hashlib.md5(seed_key.encode("utf-8")).hexdigest()[:4], 16) % 2) == 0
        try:
            for idx in range(total_frames):
                t = idx / max(1, total_frames - 1)
                # Smooth cosine easing
                smooth_t = 0.5 - 0.5 * np.cos(np.pi * t)
                zoom = (1.0 + 0.16 * smooth_t) if zoom_in else (1.16 - 0.16 * smooth_t)
                crop_w = int(round(master_w / zoom))
                crop_h = int(round(master_h / zoom))
                cx = master_w // 2 + int(round((smooth_t - 0.5) * 28))
                cy = master_h // 2 + int(round((0.5 - smooth_t) * 36))
                cx1 = max(0, min(master_w - crop_w, cx - crop_w // 2))
                cy1 = max(0, min(master_h - crop_h, cy - crop_h // 2))
                sub = master_bgr[cy1 : cy1 + crop_h, cx1 : cx1 + crop_w]
                frame = cv2.resize(sub, (out_w, out_h), interpolation=cv2.INTER_LINEAR)
                writer.write(frame)
        finally:
            writer.release()

        # Transcode to web-compatible H.264 yuv420p MP4
        tmp_h264 = output_mp4_path.with_suffix(".part.mp4")
        cmd = [
            resolve_ffmpeg_binary(),
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(tmp_avi),
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "20",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(tmp_h264),
        ]
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            if proc.returncode == 0 and tmp_h264.is_file() and tmp_h264.stat().st_size > 8_000:
                tmp_h264.replace(output_mp4_path)
                return True
            if tmp_avi.is_file() and tmp_avi.stat().st_size > 8_000:
                tmp_avi.replace(output_mp4_path)
                return True
            return False
        finally:
            tmp_avi.unlink(missing_ok=True)
            tmp_h264.unlink(missing_ok=True)

    # ------------------------------------------------------------------ #
    # Procedural 9:16 Vertical B-Roll Fallback (when offline)
    # ------------------------------------------------------------------ #
    @staticmethod
    def _generate_procedural_broll_mp4(
        dest_path: Path,
        query: str,
        cue_text: str,
        duration: float,
        fps: int = 30,
        width: int = 540,
        height: int = 960,
    ) -> None:
        """Synthesize a clean, atmospheric 9:16 vertical B-Roll clip when offline."""
        total_frames = max(15, min(180, int(round(duration * fps))))
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(str(dest_path), fourcc, float(fps), (width, height))
        if not writer.isOpened():
            return

        seed = int(hashlib.md5(query.encode("utf-8")).hexdigest()[:8], 16)
        base_b = 35 + (seed & 0x3F)
        base_g = 22 + ((seed >> 6) & 0x2F)
        base_r = 28 + ((seed >> 12) & 0x3F)

        y_grid = np.linspace(0.0, 1.0, height, dtype=np.float32)[:, None]
        x_grid = np.linspace(0.0, 1.0, width, dtype=np.float32)[None, :]

        try:
            for f_idx in range(total_frames):
                phase = (f_idx / max(1, total_frames)) * 2.0 * np.pi
                wave = 0.5 + 0.5 * np.sin(y_grid * 3.5 + x_grid * 2.0 + phase)
                frame = np.zeros((height, width, 3), dtype=np.uint8)
                frame[:, :, 0] = np.clip(base_b + wave * 42, 10, 140).astype(np.uint8)
                frame[:, :, 1] = np.clip(base_g + (1.0 - y_grid) * 35, 10, 120).astype(np.uint8)
                frame[:, :, 2] = np.clip(base_r + wave * 38, 10, 140).astype(np.uint8)

                for c_i in range(3):
                    cx = int(width * (0.25 + 0.25 * c_i + 0.08 * np.sin(phase + c_i * 1.7)))
                    cy = int(height * (0.30 + 0.20 * c_i + 0.06 * np.cos(phase + c_i * 1.3)))
                    cv2.circle(frame, (cx, cy), 65 + c_i * 18, (base_b + 30, base_g + 25, base_r + 35), -1, cv2.LINE_AA)

                cv2.rectangle(frame, (24, height - 110), (width - 24, height - 38), (16, 18, 26), -1)
                cv2.putText(
                    frame,
                    f"B-ROLL: {query[:36]}",
                    (40, height - 66),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.52,
                    (220, 230, 245),
                    1,
                    cv2.LINE_AA,
                )
                writer.write(frame)
        finally:
            writer.release()
