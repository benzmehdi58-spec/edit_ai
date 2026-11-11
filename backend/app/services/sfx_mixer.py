"""Auto-SFX Audio Synthesizer & Timeline Mixer (`services/sfx_mixer.py` — Phase 3).

Responsibilities:
    1. Manage `/assets/sfx/` (`whoosh.wav`, `pop.wav`, `cash.wav`, `error.wav`, `click.wav`).
       Automatically synthesizes clean 44.1kHz 16-bit stereo `.wav` sound effects
       using `numpy` and `scipy.signal` on startup if any file is missing.
    2. Build a 44.1kHz stereo `sfx_track.wav` placing each cue's triggered SFX
       at its exact millisecond timestamp (`cue.start`).
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Dict, Optional, Sequence, Tuple

import numpy as np
from scipy import signal
from scipy.io import wavfile

from ..config import SFX_DIR
from ..models import EnrichedSubtitleCue, SfxTriggerType

logger = logging.getLogger("hormozisub.sfx")

SAMPLE_RATE = 44100
SFX_NAMES: Tuple[str, ...] = ("whoosh", "pop", "cash", "error", "click")


def _to_int16_stereo(left: np.ndarray, right: Optional[np.ndarray] = None, peak: float = 0.85) -> np.ndarray:
    """Normalize float64 channels to 16-bit PCM stereo `(N, 2)`."""
    if right is None:
        right = left.copy()
    max_val = max(float(np.max(np.abs(left))), float(np.max(np.abs(right))), 1e-6)
    scale = (peak / max_val) * 32767.0
    stereo = np.column_stack((left * scale, right * scale))
    return np.clip(stereo, -32768, 32767).astype(np.int16)


def _synth_whoosh(sr: int = SAMPLE_RATE) -> np.ndarray:
    """Cinematic stereo Doppler whoosh transition (0.34s)."""
    dur = 0.34
    n = int(sr * dur)
    t = np.linspace(0.0, dur, n, endpoint=False)
    rng = np.random.default_rng(42)
    noise = rng.standard_normal(n)

    # Bandpass swept filter + low-end punch
    sos = signal.butter(4, [220.0 / (sr / 2), 3400.0 / (sr / 2)], btype="bandpass", output="sos")
    filtered = signal.sosfilt(sos, noise)
    sub_sweep = np.sin(2.0 * np.pi * (90.0 + 260.0 * np.sin(np.pi * t / dur)) * t)
    env = np.sin(np.pi * (t / dur)) ** 1.8

    mono = (filtered * 0.72 + sub_sweep * 0.45) * env
    # Stereo pan from left to right
    pan = np.linspace(0.2, 0.8, n)
    left = mono * np.cos(pan * np.pi / 2.0)
    right = mono * np.sin(pan * np.pi / 2.0)
    return _to_int16_stereo(left, right, peak=0.82)


def _synth_pop(sr: int = SAMPLE_RATE) -> np.ndarray:
    """Crisp bubble/caption pop sound effect (0.14s)."""
    dur = 0.14
    n = int(sr * dur)
    t = np.linspace(0.0, dur, n, endpoint=False)
    # Rapid pitch drop 480Hz -> 110Hz + harmonic overtone
    freq = 110.0 + 370.0 * np.exp(-t * 36.0)
    phase = 2.0 * np.pi * np.cumsum(freq) / sr
    env = np.exp(-t * 26.0) * (1.0 - np.exp(-t * 450.0))
    wave = (np.sin(phase) + 0.35 * np.sin(2.0 * phase)) * env
    return _to_int16_stereo(wave, wave, peak=0.85)


def _synth_cash(sr: int = SAMPLE_RATE) -> np.ndarray:
    """Bright metallic cash-register / cha-ching chime (0.52s)."""
    dur = 0.52
    n = int(sr * dur)
    t = np.linspace(0.0, dur, n, endpoint=False)

    # First bell strike at t=0.0 (E6 + B6 + E7), second higher strike at t=0.085 (A6 + E7 + A7)
    env1 = np.exp(-t * 14.0)
    bell1 = (
        np.sin(2.0 * np.pi * 1318.5 * t)
        + 0.6 * np.sin(2.0 * np.pi * 1975.5 * t)
        + 0.4 * np.sin(2.0 * np.pi * 2637.0 * t)
    ) * env1

    t2 = np.maximum(0.0, t - 0.085)
    mask2 = (t >= 0.085).astype(np.float64)
    env2 = np.exp(-t2 * 7.5) * mask2
    bell2 = (
        np.sin(2.0 * np.pi * 1760.0 * t2)
        + 0.65 * np.sin(2.0 * np.pi * 2637.0 * t2)
        + 0.45 * np.sin(2.0 * np.pi * 3520.0 * t2)
        + 0.25 * np.sin(2.0 * np.pi * 5274.0 * t2)
    ) * env2

    wave = bell1 * 0.55 + bell2 * 0.85
    return _to_int16_stereo(wave * 0.96, wave * 1.0, peak=0.85)


def _synth_error(sr: int = SAMPLE_RATE) -> np.ndarray:
    """Double-pulse pain-point / wrong-answer buzzer (0.38s)."""
    dur = 0.38
    n = int(sr * dur)
    t = np.linspace(0.0, dur, n, endpoint=False)

    # Two distinct pulses: [0.0..0.15] at 155Hz, [0.18..0.38] at 122Hz
    p1_mask = ((t >= 0.0) & (t < 0.15)).astype(np.float64)
    p2_mask = (t >= 0.18).astype(np.float64)

    env1 = p1_mask * np.exp(-t * 6.0)
    env2 = p2_mask * np.exp(-np.maximum(0.0, t - 0.18) * 7.0)

    # Rich odd-harmonic buzz
    buzz1 = (
        np.sin(2.0 * np.pi * 155.0 * t)
        + 0.5 * np.sin(2.0 * np.pi * 310.0 * t)
        + 0.35 * signal.sawtooth(2.0 * np.pi * 155.0 * t)
    ) * env1
    buzz2 = (
        np.sin(2.0 * np.pi * 122.0 * t)
        + 0.5 * np.sin(2.0 * np.pi * 244.0 * t)
        + 0.35 * signal.sawtooth(2.0 * np.pi * 122.0 * t)
    ) * env2

    wave = buzz1 + buzz2
    return _to_int16_stereo(wave, wave, peak=0.84)


def _synth_click(sr: int = SAMPLE_RATE) -> np.ndarray:
    """Crisp UI button / mouse click transient (0.09s)."""
    dur = 0.09
    n = int(sr * dur)
    t = np.linspace(0.0, dur, n, endpoint=False)

    click1 = np.sin(2.0 * np.pi * 1950.0 * t) * np.exp(-t * 95.0)
    t2 = np.maximum(0.0, t - 0.028)
    mask2 = (t >= 0.028).astype(np.float64)
    click2 = np.sin(2.0 * np.pi * 1350.0 * t2) * np.exp(-t2 * 110.0) * mask2 * 0.65
    wave = click1 + click2
    return _to_int16_stereo(wave, wave, peak=0.85)


_SYNTH_BUILDERS = {
    "whoosh": _synth_whoosh,
    "pop": _synth_pop,
    "cash": _synth_cash,
    "error": _synth_error,
    "click": _synth_click,
}


class SfxMixer:
    """Synthesizes/loads `/assets/sfx/*.wav` and builds synchronized `sfx_track.wav` tracks."""

    def __init__(self, sfx_dir: Path = SFX_DIR) -> None:
        self.sfx_dir = sfx_dir
        self._cache: Dict[str, np.ndarray] = {}
        self.ensure_sfx_assets()

    def ensure_sfx_assets(self) -> Dict[str, Path]:
        """Ensure all 5 `.wav` SFX files exist in `/assets/sfx/`, synthesizing any missing ones."""
        self.sfx_dir.mkdir(parents=True, exist_ok=True)
        paths: Dict[str, Path] = {}
        for name, builder in _SYNTH_BUILDERS.items():
            wav_path = self.sfx_dir / f"{name}.wav"
            if not wav_path.is_file() or wav_path.stat().st_size < 256:
                try:
                    samples = builder(SAMPLE_RATE)
                    wavfile.write(str(wav_path), SAMPLE_RATE, samples)
                    logger.info("Synthesized default SFX asset: %s", wav_path)
                except Exception as exc:
                    logger.error("Failed to synthesize SFX '%s': %s", name, exc)
            paths[name] = wav_path
        return paths

    def load_sfx_samples(self, name: str) -> Optional[np.ndarray]:
        """Load a 44.1kHz stereo float32 `[-1.0, 1.0]` array for `name`."""
        name = (name or "").strip().lower()
        if name not in _SYNTH_BUILDERS:
            return None
        if name in self._cache:
            return self._cache[name]

        wav_path = self.sfx_dir / f"{name}.wav"
        if not wav_path.is_file() or wav_path.stat().st_size < 256:
            self.ensure_sfx_assets()

        try:
            sr, data = wavfile.read(str(wav_path))
            if data.dtype == np.int16:
                arr = data.astype(np.float32) / 32768.0
            elif data.dtype == np.int32:
                arr = data.astype(np.float32) / 2147483648.0
            elif data.dtype == np.uint8:
                arr = (data.astype(np.float32) - 128.0) / 128.0
            else:
                arr = data.astype(np.float32)

            if arr.ndim == 1:
                arr = np.column_stack((arr, arr))
            elif arr.shape[1] > 2:
                arr = arr[:, :2]

            if sr != SAMPLE_RATE and len(arr) > 0:
                target_len = max(1, int(round(len(arr) * SAMPLE_RATE / sr)))
                arr = signal.resample(arr, target_len, axis=0).astype(np.float32)

            self._cache[name] = arr
            return arr
        except Exception as exc:
            logger.warning("Could not read SFX '%s' (%s); using in-memory synthesizer.", wav_path, exc)
            raw = _SYNTH_BUILDERS[name](SAMPLE_RATE).astype(np.float32) / 32768.0
            self._cache[name] = raw
            return raw

    def build_sfx_track(
        self,
        cues: Sequence[EnrichedSubtitleCue],
        total_duration: float,
        output_wav_path: Path,
    ) -> Tuple[Path, int]:
        """Build a 44.1kHz stereo `sfx_track.wav` placing each triggered SFX at `cue.start`.

        Returns `(output_wav_path, triggers_placed_count)`.
        """
        duration = max(0.5, float(total_duration))
        total_samples = max(1, int(round(duration * SAMPLE_RATE)))
        timeline = np.zeros((total_samples, 2), dtype=np.float32)
        triggers_placed = 0

        for cue in cues:
            trigger: SfxTriggerType = cue.visual_plan.sfx_trigger
            if trigger == "none":
                continue
            clip = self.load_sfx_samples(trigger)
            if clip is None or len(clip) == 0:
                continue

            # Place at exact millisecond of cue.start (or first word start)
            timestamp = cue.words[0].start if cue.words else cue.start
            start_sample = max(0, int(round(timestamp * SAMPLE_RATE)))
            if start_sample >= total_samples:
                continue

            end_sample = min(total_samples, start_sample + len(clip))
            copy_len = end_sample - start_sample
            if copy_len <= 0:
                continue

            timeline[start_sample:end_sample] += clip[:copy_len]
            triggers_placed += 1

        # Soft-clip / limit master SFX track and write 16-bit PCM stereo WAV
        timeline = np.tanh(timeline)
        pcm16 = np.clip(timeline * 32767.0, -32768, 32767).astype(np.int16)
        output_wav_path.parent.mkdir(parents=True, exist_ok=True)
        wavfile.write(str(output_wav_path), SAMPLE_RATE, pcm16)
        logger.info("Built SFX track %s (%d triggers placed, %.2fs)", output_wav_path.name, triggers_placed, duration)
        return output_wav_path, triggers_placed
