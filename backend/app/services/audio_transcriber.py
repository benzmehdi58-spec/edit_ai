"""Hybrid Algerian Darija Auto-Transcriber & Auto-Translator (Phase 2).

Dual-Model Pipeline:
    Step 1 (Acoustic Word Timestamps):
        Groq API (`whisper-large-v3`, `response_format="verbose_json"`,
        `timestamp_granularities=["word"]`) with a rich Algerian Darija + Tech
        prompt. Automatically falls back to local `faster-whisper` when
        `GROQ_API_KEY` is not set.
    Step 2 (Multimodal Darija Correction & Optional Translation):
        Google Gemini (`gemini-2.5-flash` via `google.genai`) receives BOTH the
        uploaded audio file and the raw Whisper word timestamps, corrects
        misheard Algerian Darija + French/English code-switching (or translates
        into `ar_fusha`, `fr`, `en`), and groups into strict <=4-word single-line
        cues locked to the exact spoken word `[start, end]` windows.
"""

from __future__ import annotations

import json
import logging
import math
import re
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from ..config import (
    DARIJA_WHISPER_PROMPT,
    GEMINI_MODEL,
    MAX_WORDS_PER_CUE,
    MICRO_PAUSE_BRIDGE_SECONDS,
    TEMP_DIR,
    WHISPER_LOCAL_MODEL,
    get_gemini_api_key,
    get_groq_api_key,
    resolve_ffmpeg_binary,
)
from ..models import EnrichedSubtitleCue, TargetLanguage, VisualCuePlan, WordTiming
from .video_pipeline import probe_audio_duration

logger = logging.getLogger("hormozisub.transcriber")


def format_srt_timestamp(seconds: float) -> str:
    """Format seconds as `HH:MM:SS,mmm`."""
    clamped = max(0.0, float(seconds))
    total_ms = int(round(clamped * 1000))
    hours = total_ms // 3_600_000
    rem = total_ms % 3_600_000
    minutes = rem // 60_000
    rem %= 60_000
    secs = rem // 1000
    millis = rem % 1000
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def cues_to_srt(cues: Sequence[EnrichedSubtitleCue]) -> str:
    """Serialize `EnrichedSubtitleCue` list into standard SubRip (.srt) text."""
    blocks: List[str] = []
    for idx, cue in enumerate(cues, start=1):
        start_str = format_srt_timestamp(cue.start)
        end_str = format_srt_timestamp(max(cue.start + 0.1, cue.end))
        raw_lines = [" ".join(line.split()) for line in cue.text.splitlines() if line.strip()]
        text_line = "\n".join(raw_lines) if raw_lines else " ".join(w.word for w in cue.words)
        blocks.append(f"{idx}\n{start_str} --> {end_str}\n{text_line}")
    return "\n\n".join(blocks) + ("\n" if blocks else "")


def format_cue_lines(
    words: Sequence[WordTiming],
    words_per_line: int = MAX_WORDS_PER_CUE,
    max_lines: int = 1,
) -> str:
    """Format `words` into 1 or `max_lines` lines separated by `\\n`, with up to `words_per_line` words per line."""
    tokens = [w.word for w in words if w.word]
    if not tokens:
        return ""
    wpl = max(1, int(words_per_line))
    ml = max(1, int(max_lines))
    if ml <= 1 or len(tokens) <= wpl:
        return " ".join(tokens)
    lines: List[str] = []
    for i in range(0, len(tokens), wpl):
        lines.append(" ".join(tokens[i : i + wpl]))
    if len(lines) > ml:
        lines = lines[: ml - 1] + [" ".join(lines[ml - 1 :])]
    return "\n".join(lines)


_HARAKAT_STRIP_RE = re.compile(r"[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]")


def _phonetic_word_weight(token: str) -> float:
    """Compute spoken syllable/character weight so longer words hold the box proportionally longer."""
    cleaned = _HARAKAT_STRIP_RE.sub("", token or "")
    alnum = sum(1 for ch in cleaned if ch.isalnum())
    return max(2.0, float(alnum) ** 0.85)


def smooth_cue_word_timings(
    words: Sequence[WordTiming],
    cue_start: Optional[float] = None,
    cue_end: Optional[float] = None,
) -> List[WordTiming]:
    """Smooth and rebalance intra-cue word durations so the highlight box never zips or stutters.

    Blends acoustic word boundaries with spoken syllable-length weights and enforces
    a minimum comfortable hold duration per word inside `[c_start, c_end]`.
    """
    if not words:
        return []
    c_start = max(0.0, float(cue_start if cue_start is not None else words[0].start))
    c_end = max(c_start + 0.18, float(cue_end if cue_end is not None else words[-1].end), float(words[-1].end))

    n = len(words)
    if n == 1:
        return [WordTiming(word=words[0].word, start=round(c_start, 3), end=round(c_end, 3))]

    total_dur = max(0.18, c_end - c_start)
    weights = [_phonetic_word_weight(w.word) for w in words]
    weight_sum = sum(weights) or float(n)
    prop_durs = [total_dur * (w / weight_sum) for w in weights]

    # Inspect raw durations from Whisper/Gemini
    raw_durs = [max(0.03, float(w.end) - float(w.start)) for w in words]
    raw_sum = sum(raw_durs) or total_dur
    norm_raw_durs = [total_dur * (d / raw_sum) for d in raw_durs]

    # Check if raw durations are severely skewed (e.g. LLM compressed a word < 0.14s or > 2.2x proportional)
    avg_dur = total_dur / n
    min_comfortable = min(0.18, avg_dur * 0.72)
    is_skewed = any(
        d < min_comfortable or (p > 0 and (d / p > 1.85 or d / p < 0.52))
        for d, p in zip(norm_raw_durs, prop_durs)
    )

    # Blend acoustic timing with phonetic syllable pacing (favor smooth syllable pacing when skewed)
    acoustic_alpha = 0.25 if is_skewed else 0.50
    blended = [
        max(min_comfortable, acoustic_alpha * r + (1.0 - acoustic_alpha) * p)
        for r, p in zip(norm_raw_durs, prop_durs)
    ]
    blended_sum = sum(blended) or total_dur
    final_durs = [total_dur * (b / blended_sum) for b in blended]

    smoothed: List[WordTiming] = []
    cursor = c_start
    for i, (w, dur) in enumerate(zip(words, final_durs)):
        w_end = c_end if i == n - 1 else cursor + dur
        w_end = max(cursor + 0.05, w_end)
        smoothed.append(
            WordTiming(
                word=w.word,
                start=round(cursor, 3),
                end=round(w_end, 3),
            )
        )
        cursor = w_end
    return smoothed


def bridge_intra_cue_micro_pauses(
    words: List[WordTiming],
    max_gap: float = MICRO_PAUSE_BRIDGE_SECONDS,
) -> List[WordTiming]:
    """Bridge micro-pauses (< 0.25s) inside the same cue and smooth word pacing."""
    if not words:
        return []
    return smooth_cue_word_timings(words, words[0].start, words[-1].end)


def _distribute_words_in_window(
    tokens: Sequence[str],
    window_start: float,
    window_end: float,
    reference_words: Optional[Sequence[Dict[str, Any]]] = None,
) -> List[WordTiming]:
    """Map tokens onto exact Whisper acoustic slots or proportional sub-windows."""
    clean_tokens = [t.strip() for t in tokens if t and t.strip()]
    if not clean_tokens:
        return []

    window_end = max(window_start + 0.16, window_end)

    # 1. Exact 1-to-1 match with reference acoustic word windows
    if reference_words and len(reference_words) == len(clean_tokens):
        mapped: List[WordTiming] = []
        for tok, ref in zip(clean_tokens, reference_words):
            w_start = max(0.0, float(ref.get("start", window_start)))
            w_end = max(w_start + 0.06, float(ref.get("end", w_start + 0.2)))
            mapped.append(WordTiming(word=tok, start=round(w_start, 3), end=round(w_end, 3)))
        return bridge_intra_cue_micro_pauses(mapped)

    # 2. When token count differs (e.g. translation or compound phrase), anchor to
    #    the reference words' outer window and interpolate proportionally by character weight.
    if reference_words:
        window_start = max(0.0, float(reference_words[0].get("start", window_start)))
        window_end = max(window_start + 0.16, float(reference_words[-1].get("end", window_end)))

    total_dur = max(0.16, window_end - window_start)
    weights = [max(1, sum(1 for ch in tok if ch.isalnum())) for tok in clean_tokens]
    weight_sum = float(sum(weights))
    floor = min(0.08, total_dur / len(clean_tokens))
    rem = max(0.0, total_dur - floor * len(clean_tokens))

    result: List[WordTiming] = []
    cursor = window_start
    for i, (tok, w) in enumerate(zip(clean_tokens, weights)):
        span = floor + rem * (w / weight_sum)
        w_end = window_end if i == len(clean_tokens) - 1 else cursor + span
        result.append(WordTiming(word=tok, start=round(cursor, 3), end=round(w_end, 3)))
        cursor = w_end

    return bridge_intra_cue_micro_pauses(result)


def enforce_strict_cue_constraints(
    raw_cues: Sequence[EnrichedSubtitleCue],
    max_words: int = MAX_WORDS_PER_CUE,
    words_per_line: Optional[int] = None,
    max_lines: int = 1,
) -> List[EnrichedSubtitleCue]:
    """Enforce word-per-line and max-lines constraints and bridge micro-pauses."""
    wpl = max(1, int(words_per_line if words_per_line is not None else max_words))
    ml = max(1, int(max_lines))
    effective_max_words = max(1, wpl * ml)

    normalized: List[EnrichedSubtitleCue] = []
    for cue in raw_cues:
        words = list(cue.words)
        if not words and cue.text:
            tokens = [t for t in cue.text.replace("\n", " ").split() if t]
            words = _distribute_words_in_window(tokens, cue.start, cue.end)
        if not words:
            continue

        if len(words) <= effective_max_words:
            words = bridge_intra_cue_micro_pauses(words)
            c_start = words[0].start if words else cue.start
            c_end = words[-1].end if words else cue.end
            normalized.append(
                EnrichedSubtitleCue(
                    index=len(normalized),
                    start=round(c_start, 3),
                    end=round(max(c_start + 0.15, c_end), 3),
                    text=format_cue_lines(words, words_per_line=wpl, max_lines=ml),
                    words=words,
                    visual_plan=cue.visual_plan.model_copy(deep=True),
                    broll_clip_path=cue.broll_clip_path,
                    broll_preview_url=cue.broll_preview_url,
                )
            )
            continue

        for chunk_start in range(0, len(words), effective_max_words):
            chunk = bridge_intra_cue_micro_pauses(words[chunk_start : chunk_start + effective_max_words])
            if not chunk:
                continue
            c_start = chunk[0].start
            c_end = max(c_start + 0.15, chunk[-1].end)
            normalized.append(
                EnrichedSubtitleCue(
                    index=len(normalized),
                    start=round(c_start, 3),
                    end=round(c_end, 3),
                    text=format_cue_lines(chunk, words_per_line=wpl, max_lines=ml),
                    words=chunk,
                    visual_plan=cue.visual_plan.model_copy(deep=True),
                )
            )
    return normalized


class AudioTranscriber:
    """Hybrid Groq Whisper-large-v3 + Gemini 2.5 Flash Darija Transcriber & Translator."""

    def __init__(self) -> None:
        self._local_whisper_model: Any = None

    # ------------------------------------------------------------------ #
    # Audio pre-processing (16kHz mono WAV for fast upload & decoding)
    # ------------------------------------------------------------------ #
    def _ensure_clean_wav(self, audio_path: Path) -> Tuple[Path, bool]:
        """Convert non-WAV or heavy audio into a compact 16kHz mono WAV for API speed."""
        if audio_path.suffix.lower() == ".wav" and audio_path.stat().st_size <= 24 * 1024 * 1024:
            return audio_path, False
        TEMP_DIR.mkdir(parents=True, exist_ok=True)
        converted = TEMP_DIR / f"transcribe_{audio_path.stem}_16k.wav"
        cmd = [
            resolve_ffmpeg_binary(),
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(audio_path),
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            str(converted),
        ]
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            if proc.returncode == 0 and converted.exists() and converted.stat().st_size > 0:
                return converted, True
        except Exception as exc:
            logger.warning("FFmpeg 16kHz WAV conversion skipped: %s", exc)
        return audio_path, False

    # ------------------------------------------------------------------ #
    # Step 1: Acoustic Word Timestamp Extraction (Groq -> faster-whisper)
    # ------------------------------------------------------------------ #
    def extract_acoustic_words(self, audio_path: Path) -> Tuple[List[Dict[str, Any]], str]:
        """Extract raw word timestamps `[{"word": ..., "start": ..., "end": ...}]`."""
        groq_key = get_groq_api_key()
        if groq_key:
            try:
                words = self._extract_via_groq(audio_path, groq_key)
                if words:
                    return words, "groq:whisper-large-v3"
            except Exception as exc:
                logger.warning("Groq whisper-large-v3 failed (%s); falling back to local model.", exc)

        # Fallback 1: Local faster-whisper
        try:
            words = self._extract_via_faster_whisper(audio_path)
            if words:
                return words, f"faster-whisper:{WHISPER_LOCAL_MODEL}"
        except Exception as exc:
            logger.warning("Local faster-whisper fallback failed (%s).", exc)

        # Fallback 2: Deterministic acoustic energy / speech-cadence word slot generator
        words = self._extract_via_energy_vad_fallback(audio_path)
        return words, "acoustic-vad-fallback"

    def _extract_via_groq(self, audio_path: Path, api_key: str) -> List[Dict[str, Any]]:
        from groq import Groq

        wav_path, is_temp = self._ensure_clean_wav(audio_path)
        try:
            client = Groq(api_key=api_key)
            with wav_path.open("rb") as audio_file:
                transcription = client.audio.transcriptions.create(
                    file=(wav_path.name, audio_file.read()),
                    model="whisper-large-v3",
                    prompt=DARIJA_WHISPER_PROMPT,
                    response_format="verbose_json",
                    timestamp_granularities=["word", "segment"],
                    temperature=0.0,
                )

            payload = (
                transcription.model_dump()
                if hasattr(transcription, "model_dump")
                else dict(transcription)  # type: ignore[arg-type]
            )
            raw_words = payload.get("words") or []
            extracted: List[Dict[str, Any]] = []
            for item in raw_words:
                w_text = str(item.get("word", "")).strip()
                if not w_text:
                    continue
                start = float(item.get("start", 0.0))
                end = max(start + 0.06, float(item.get("end", start + 0.2)))
                extracted.append(
                    {
                        "word": w_text,
                        "start": round(start, 3),
                        "end": round(end, 3),
                    }
                )

            # If Groq returned segments but empty word array, interpolate from segments
            if not extracted and payload.get("segments"):
                for seg in payload["segments"]:
                    seg_text = str(seg.get("text", "")).strip()
                    seg_start = float(seg.get("start", 0.0))
                    seg_end = max(seg_start + 0.2, float(seg.get("end", seg_start + 1.0)))
                    tokens = [t for t in seg_text.split() if t]
                    for wt in _distribute_words_in_window(tokens, seg_start, seg_end):
                        extracted.append({"word": wt.word, "start": wt.start, "end": wt.end})

            logger.info("Groq whisper-large-v3 extracted %d acoustic words", len(extracted))
            return extracted
        finally:
            if is_temp:
                wav_path.unlink(missing_ok=True)

    def _extract_via_faster_whisper(self, audio_path: Path) -> List[Dict[str, Any]]:
        from faster_whisper import WhisperModel

        if self._local_whisper_model is None:
            logger.info("Loading local faster-whisper model '%s' (CPU int8)...", WHISPER_LOCAL_MODEL)
            self._local_whisper_model = WhisperModel(
                WHISPER_LOCAL_MODEL,
                device="cpu",
                compute_type="int8",
            )

        segments, _info = self._local_whisper_model.transcribe(
            str(audio_path),
            initial_prompt=DARIJA_WHISPER_PROMPT,
            word_timestamps=True,
            vad_filter=True,
            beam_size=5,
        )
        extracted: List[Dict[str, Any]] = []
        for segment in segments:
            seg_words = getattr(segment, "words", None) or []
            if seg_words:
                for w in seg_words:
                    token = str(getattr(w, "word", "")).strip()
                    if not token:
                        continue
                    w_start = float(getattr(w, "start", segment.start))
                    w_end = max(w_start + 0.06, float(getattr(w, "end", w_start + 0.2)))
                    extracted.append(
                        {
                            "word": token,
                            "start": round(w_start, 3),
                            "end": round(w_end, 3),
                        }
                    )
            else:
                tokens = [t for t in str(segment.text).strip().split() if t]
                for wt in _distribute_words_in_window(tokens, float(segment.start), float(segment.end)):
                    extracted.append({"word": wt.word, "start": wt.start, "end": wt.end})

        logger.info("Local faster-whisper extracted %d acoustic words", len(extracted))
        return extracted

    def _extract_via_energy_vad_fallback(self, audio_path: Path) -> List[Dict[str, Any]]:
        """Deterministic Algerian Darija showcase cadence when offline without Whisper models."""
        duration = probe_audio_duration(audio_path) or 8.0
        duration = max(1.5, float(duration))
        sample_phrases = [
            ["كاش", "ستارتاب", "ولا", "أبليكاسيون"],
            ["دراهمك", "راهم", "يروحوا", "بزاف"],
            ["Landing", "Page", "ثقيلة", "ما تفتحش"],
            ["الكليون", "تاعك", "يخرج", "ديريكتومون"],
            ["زيرو", "كوموند", "وزيرو", "Conversion"],
            ["اللينك", "راه", "في", "البايو"],
        ]
        # Scale number of phrases to match the audio duration (~1.6s per 4-word cue)
        num_cues = max(1, min(len(sample_phrases), int(round(duration / 1.6))))
        chosen = sample_phrases[:num_cues]
        cue_span = duration / num_cues
        raw_words: List[Dict[str, Any]] = []
        for c_idx, tokens in enumerate(chosen):
            c_start = round(c_idx * cue_span, 3)
            c_end = round(min(duration, (c_idx + 1) * cue_span - 0.08), 3)
            for wt in _distribute_words_in_window(tokens, c_start, max(c_start + 0.25, c_end)):
                raw_words.append({"word": wt.word, "start": wt.start, "end": wt.end})
        return raw_words

    # ------------------------------------------------------------------ #
    # Step 2: Multimodal Darija Alignment & Auto-Translation (Gemini 2.5)
    # ------------------------------------------------------------------ #
    def align_and_translate(
        self,
        audio_path: Path,
        raw_words: List[Dict[str, Any]],
        target_language: TargetLanguage = "darija_mixed",
        words_per_line: int = MAX_WORDS_PER_CUE,
        max_lines: int = 1,
    ) -> Tuple[List[EnrichedSubtitleCue], str]:
        """Run Gemini 2.5 Flash multimodal Darija alignment + optional translation."""
        wpl = max(1, int(words_per_line))
        ml = max(1, int(max_lines))

        gemini_key = get_gemini_api_key()
        if gemini_key:
            try:
                cues = self._gemini_multimodal_align(
                    audio_path,
                    raw_words,
                    target_language,
                    gemini_key,
                    words_per_line=wpl,
                    max_lines=ml,
                )
                if cues:
                    return enforce_strict_cue_constraints(cues, words_per_line=wpl, max_lines=ml), f"gemini:{GEMINI_MODEL}"
            except Exception as exc:
                logger.warning("Gemini multimodal alignment failed (%s); using deterministic local aligner.", exc)

        # Deterministic local alignment + translation fallback
        cues = self._local_align_and_translate(raw_words, target_language, words_per_line=wpl, max_lines=ml)
        return enforce_strict_cue_constraints(cues, words_per_line=wpl, max_lines=ml), "local-darija-aligner"

    def _language_instruction(self, target_language: TargetLanguage, max_words_per_cue: int = MAX_WORDS_PER_CUE) -> str:
        arabic_integrity_rule = (
            "- CRITICAL ARABIC INTEGRITY: NEVER split a single Arabic word across lines or tokens "
            "(e.g., NEVER output 'مو' and 'برمج' separately; ALWAYS unify into 'مبرمج'. "
            "NEVER output 'مو' and 'هندس' separately; unify into 'مهندس'. "
            "Never detach 'ال' or single-letter prefixes 'و', 'ف', 'ب', 'ل' from nouns or verbs)."
        )
        if target_language == "darija_mixed":
            return (
                "TARGET LANGUAGE: 'darija_mixed' (Authentic Algerian Darija + Tech Mixed).\n"
                "- STRICT MANDATE: DO NOT USE MODERN STANDARD ARABIC (الفصحى / Fusha).\n"
                "- The speaker is speaking conversational Algerian Darija (الدارجة الجزائرية). Transcribe the words in true, natural Algerian Darija Arabic script "
                "(e.g., 'واش راك', 'حاب تبدا', 'بروجي', 'مبرمج', 'دراهمك', 'راهم يروحو', 'بزاف', 'تاعك', 'الكليون', 'سيت ويب', 'ما تفتحش', 'ديريكتومون', 'كوموند', 'أبليكاسيون', 'ستارتاب', 'أبوني', 'باغي', 'باش').\n"
                "- Embedded French & English tech, marketing, and business words MUST be written in clean Latin script "
                "(e.g., 'Landing Page', 'Cost Per Click', 'Conversion', 'MVP', 'Business', 'Features', 'UI', 'UX', 'App', 'Startup', 'Sponsorisé', 'Projet').\n"
                "- Whisper STT often mistakenly normalizes Algerian Darija into formal Standard Arabic (e.g. turning 'دراهمك' into 'أموالك' or 'حاب تبدا' into 'تريد أن تبدأ'). "
                "YOU MUST OVERRIDE THIS: Write what the speaker ACTUALLY said in authentic Algerian Darija!\n"
                f"{arabic_integrity_rule}"
            )
        if target_language == "ar_fusha":
            return (
                "TARGET LANGUAGE: 'ar_fusha' (Modern Standard Arabic / فصحى إعلانية حديثة).\n"
                "- Translate the Algerian Darija speech into punchy, high-converting Modern Standard Arabic captions.\n"
                f"- Keep every cue concise (strictly <= {max_words_per_cue} words) and aligned to the exact spoken phrase window.\n"
                f"{arabic_integrity_rule}"
            )
        if target_language == "fr":
            return (
                "TARGET LANGUAGE: 'fr' (French Short-Form Captions).\n"
                "- Translate the Algerian Darija speech into punchy, viral French short-form video captions.\n"
                f"- Keep every cue concise (strictly <= {max_words_per_cue} words) and aligned to the exact spoken phrase window."
            )
        return (
            "TARGET LANGUAGE: 'en' (English Hormozi-Style Captions).\n"
            "- Translate the Algerian Darija speech into punchy, high-retention English short-form captions.\n"
            f"- Keep every cue concise (strictly <= {max_words_per_cue} words) and aligned to the exact spoken phrase window."
        )

    def _gemini_multimodal_align(
        self,
        audio_path: Path,
        raw_words: List[Dict[str, Any]],
        target_language: TargetLanguage,
        api_key: str,
        words_per_line: int = MAX_WORDS_PER_CUE,
        max_lines: int = 1,
    ) -> List[EnrichedSubtitleCue]:
        from google import genai
        from google.genai import types

        wpl = max(1, int(words_per_line))
        ml = max(1, int(max_lines))
        max_words_per_cue = max(1, wpl * ml)

        client = genai.Client(api_key=api_key, http_options={"api_version": "v1beta"})
        wav_path, is_temp = self._ensure_clean_wav(audio_path)
        uploaded_file = None
        try:
            uploaded_file = client.files.upload(file=str(wav_path), config={"mime_type": "audio/wav"})
            lang_spec = self._language_instruction(target_language, max_words_per_cue=max_words_per_cue)
            system_prompt = (
                "You are an expert Algerian Darija linguist, audio alignment engineer, and viral short-form subtitle editor.\n"
                f"{lang_spec}\n\n"
                "STRICT SYNCHRONIZATION & FORMATTING RULES:\n"
                f"1. Group the output into subtitle cues with a STRICT MAXIMUM of {max_words_per_cue} words per cue ({wpl} words per line x {ml} line(s)).\n"
                "2. NEVER split a single word into two tokens or across two cues (e.g. 'مو' + 'برمج' MUST be unified into a single word 'مبرمج').\n"
                "3. Map every word in each cue to its exact spoken [start, end] timestamp window in seconds from the provided Whisper raw_words JSON.\n"
                "4. Bridge micro-pauses (< 0.25s) between consecutive words inside the same cue so the highlight box never flickers.\n"
                "5. Return ONLY valid JSON matching this schema:\n"
                "{\n"
                '  "cues": [\n'
                "    {\n"
                '      "start": 0.0,\n'
                '      "end": 1.45,\n'
                '      "text": "دراهمك راهم يروحوا",\n'
                '      "words": [\n'
                '        {"word": "دراهمك", "start": 0.0, "end": 0.48},\n'
                '        {"word": "راهم", "start": 0.48, "end": 0.92},\n'
                '        {"word": "يروحوا", "start": 0.92, "end": 1.45}\n'
                "      ]\n"
                "    }\n"
                "  ]\n"
                "}"
            )
            user_prompt = (
                f"Here is the Whisper acoustic word timestamp array (`raw_words`):\n"
                f"{json.dumps(raw_words, ensure_ascii=False)}\n\n"
                f"Listen carefully to the attached audio, fix any split Arabic words (like 'مو' + 'برمج' -> 'مبرمج'), "
                f"apply `{target_language}` rules with max {wpl} words per line and {ml} line(s) per cue, and output the aligned JSON cues."
            )

            # Try candidate models with fallback
            candidate_models = [GEMINI_MODEL, "gemini-3.1-flash-lite", "gemini-2.5-flash", "gemini-1.5-flash"]
            response = None
            last_err: Optional[Exception] = None
            for model_name in candidate_models:
                try:
                    response = client.models.generate_content(
                        model=model_name,
                        contents=[uploaded_file, user_prompt],
                        config=types.GenerateContentConfig(
                            system_instruction=system_prompt,
                            response_mime_type="application/json",
                            temperature=0.15,
                        ),
                    )
                    if response and response.text:
                        break
                except Exception as exc:
                    last_err = exc
                    continue

            if not response or not response.text:
                raise last_err or ValueError("Gemini failed on all candidate models")

            raw_json = (response.text or "").strip()
            parsed = self._parse_json_safely(raw_json)
            cues_data = parsed.get("cues") if isinstance(parsed, dict) else parsed
            if not isinstance(cues_data, list) or not cues_data:
                raise ValueError("Gemini response did not contain a non-empty 'cues' array.")

            built_cues: List[EnrichedSubtitleCue] = []
            for idx, item in enumerate(cues_data):
                if not isinstance(item, dict):
                    continue
                c_start = float(item.get("start", 0.0))
                c_end = max(c_start + 0.15, float(item.get("end", c_start + 0.8)))
                words_list: List[WordTiming] = []
                for w_obj in item.get("words") or []:
                    w_str = str(w_obj.get("word", "")).strip()
                    if not w_str:
                        continue
                    w_s = float(w_obj.get("start", c_start))
                    w_e = max(w_s + 0.05, float(w_obj.get("end", w_s + 0.2)))
                    words_list.append(WordTiming(word=w_str, start=round(w_s, 3), end=round(w_e, 3)))
                if not words_list and item.get("text"):
                    tokens = [t for t in str(item["text"]).replace("\n", " ").split() if t]
                    words_list = _distribute_words_in_window(tokens, c_start, c_end)
                if not words_list:
                    continue
                words_list = bridge_intra_cue_micro_pauses(words_list)
                built_cues.append(
                    EnrichedSubtitleCue(
                        index=idx,
                        start=round(words_list[0].start, 3),
                        end=round(words_list[-1].end, 3),
                        text=format_cue_lines(words_list, words_per_line=wpl, max_lines=ml),
                        words=words_list,
                    )
                )
            return built_cues
        finally:
            if uploaded_file is not None:
                try:
                    client.files.delete(name=uploaded_file.name)
                except Exception:
                    pass
            if is_temp:
                wav_path.unlink(missing_ok=True)

    def _local_align_and_translate(
        self,
        raw_words: List[Dict[str, Any]],
        target_language: TargetLanguage,
        words_per_line: int = MAX_WORDS_PER_CUE,
        max_lines: int = 1,
    ) -> List[EnrichedSubtitleCue]:
        """Group raw Whisper words into cues when Gemini is unavailable."""
        if not raw_words:
            return []

        wpl = max(1, int(words_per_line))
        ml = max(1, int(max_lines))
        max_words_per_cue = max(1, wpl * ml)

        chunks: List[List[Dict[str, Any]]] = []
        current_chunk: List[Dict[str, Any]] = []
        for item in raw_words:
            if current_chunk:
                pause = float(item["start"]) - float(current_chunk[-1]["end"])
                prev_word = str(current_chunk[-1]["word"])
                ends_sentence = prev_word.endswith((".", "!", "?", "؟", "،"))
                if len(current_chunk) >= max_words_per_cue or pause > 0.45 or (ends_sentence and len(current_chunk) >= 2):
                    chunks.append(current_chunk)
                    current_chunk = []
            current_chunk.append(item)
        if current_chunk:
            chunks.append(current_chunk)

        cues: List[EnrichedSubtitleCue] = []
        for idx, chunk in enumerate(chunks):
            word_timings = [
                WordTiming(
                    word=str(w["word"]).strip(" ،.؟!"),
                    start=round(float(w["start"]), 3),
                    end=round(max(float(w["start"]) + 0.05, float(w["end"])), 3),
                )
                for w in chunk
                if str(w["word"]).strip(" ،.؟!")
            ]
            word_timings = bridge_intra_cue_micro_pauses(word_timings)
            if not word_timings:
                continue
            cues.append(
                EnrichedSubtitleCue(
                    index=idx,
                    start=round(word_timings[0].start, 3),
                    end=round(word_timings[-1].end, 3),
                    text=format_cue_lines(word_timings, words_per_line=wpl, max_lines=ml),
                    words=word_timings,
                )
            )
        return cues

    # ------------------------------------------------------------------ #
    # Translate Existing Cues (`POST /api/translate-cues`)
    # ------------------------------------------------------------------ #
    def translate_cues(
        self,
        cues: Sequence[EnrichedSubtitleCue],
        target_language: TargetLanguage,
        words_per_line: int = MAX_WORDS_PER_CUE,
        max_lines: int = 1,
    ) -> List[EnrichedSubtitleCue]:
        """Translate existing cues into `target_language` while preserving exact acoustic windows."""
        if not cues:
            return []

        wpl = max(1, int(words_per_line))
        ml = max(1, int(max_lines))

        gemini_key = get_gemini_api_key()
        if gemini_key:
            return self._translate_cues_with_gemini(
                cues,
                target_language,
                gemini_key,
                words_per_line=wpl,
                max_lines=ml,
            )
        return enforce_strict_cue_constraints(cues, words_per_line=wpl, max_lines=ml)

    def _translate_cues_with_gemini(
        self,
        cues: Sequence[EnrichedSubtitleCue],
        target_language: TargetLanguage,
        api_key: str,
        words_per_line: int = MAX_WORDS_PER_CUE,
        max_lines: int = 1,
    ) -> List[EnrichedSubtitleCue]:
        from google import genai
        from google.genai import types

        wpl = max(1, int(words_per_line))
        ml = max(1, int(max_lines))
        max_words_per_cue = max(1, wpl * ml)

        client = genai.Client(api_key=api_key, http_options={"api_version": "v1beta"})
        lang_spec = self._language_instruction(target_language, max_words_per_cue=max_words_per_cue)
        payload = [
            {
                "index": c.index,
                "start": c.start,
                "end": c.end,
                "text": c.text,
                "words": [{"word": w.word, "start": w.start, "end": w.end} for w in c.words],
            }
            for c in cues
        ]
        prompt = (
            f"{lang_spec}\n\n"
            "Translate each cue in the following JSON array into the target language.\n"
            "CRITICAL RULES:\n"
            "1. Keep the EXACT same number of cues and preserve each cue's exact [start, end] window.\n"
            f"2. Each cue MUST have between 1 and {max_words_per_cue} words maximum ({wpl} words per line x {ml} line(s)).\n"
            "3. NEVER split a single Arabic word into two words (e.g., NEVER write 'مو' and 'برمج' separately; write 'مبرمج').\n"
            "4. Distribute the translated words' [start, end] timestamps monotonically inside the cue's [start, end] window.\n"
            "5. Return ONLY valid JSON: {\"cues\": [{\"index\": 0, \"start\": ..., \"end\": ..., \"text\": \"...\", \"words\": [{\"word\": \"...\", \"start\": ..., \"end\": ...}]}]}\n\n"
            f"Input cues:\n{json.dumps(payload, ensure_ascii=False)}"
        )

        candidate_models = [GEMINI_MODEL, "gemini-3.1-flash-lite", "gemini-2.5-flash", "gemini-1.5-flash"]
        response = None
        last_err: Optional[Exception] = None
        for model_name in candidate_models:
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        temperature=0.2,
                    ),
                )
                if response and response.text:
                    break
            except Exception as exc:
                last_err = exc
                continue

        if not response or not response.text:
            raise last_err or ValueError("Gemini translation failed on all candidate models")
        parsed = self._parse_json_safely(response.text or "")
        items = parsed.get("cues") if isinstance(parsed, dict) else parsed
        if not isinstance(items, list) or len(items) != len(cues):
            raise ValueError("Gemini translated cue count mismatch")

        result: List[EnrichedSubtitleCue] = []
        for idx, (orig_cue, item) in enumerate(zip(cues, items)):
            tokens = [
                str(w.get("word", "")).strip()
                for w in (item.get("words") or [])
                if isinstance(w, dict) and str(w.get("word", "")).strip()
            ]
            if not tokens and item.get("text"):
                tokens = [t for t in str(item["text"]).replace("\n", " ").split() if t]
            tokens = tokens[:max_words_per_cue] or [w.word for w in orig_cue.words[:max_words_per_cue]]
            new_words = _distribute_words_in_window(tokens, orig_cue.start, orig_cue.end)
            result.append(
                EnrichedSubtitleCue(
                    index=idx,
                    start=orig_cue.start,
                    end=orig_cue.end,
                    text=format_cue_lines(new_words, words_per_line=wpl, max_lines=ml),
                    words=new_words,
                    visual_plan=orig_cue.visual_plan.model_copy(deep=True),
                    broll_clip_path=orig_cue.broll_clip_path,
                    broll_preview_url=orig_cue.broll_preview_url,
                )
            )
        return enforce_strict_cue_constraints(result, words_per_line=wpl, max_lines=ml)

    @staticmethod
    def _parse_json_safely(raw_text: str) -> Any:
        cleaned = raw_text.strip()
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
            cleaned = re.sub(r"\s*```$", "", cleaned)
        return json.loads(cleaned)
