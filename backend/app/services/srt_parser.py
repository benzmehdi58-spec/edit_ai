"""SRT parsing + proportional word-by-word timestamp distribution."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Sequence, Union

_TIMESTAMP_RE = re.compile(r"(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?")
_ARROW = "-->"
_BLOCK_SPLIT_RE = re.compile(r"\n[ \t]*\n")
_TAG_RE = re.compile(r"<[^>]+>|\{\\[^}]*\}")
# Harakat, Quranic marks, superscript alef and tatweel do not add visual width.
_ARABIC_NON_SPACING_RE = re.compile(r"[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]")
_PUNCT_ONLY_RE = re.compile(r"^[\W_]+$", re.UNICODE)


@dataclass
class Cue:
    """A single subtitle cue. ``lines`` holds the words of each original text line."""

    index: int
    start: float
    end: float
    lines: List[List[str]] = field(default_factory=list)

    @property
    def words(self) -> List[str]:
        return [word for line in self.lines for word in line]

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)

    @property
    def text(self) -> str:
        return "\n".join(" ".join(line) for line in self.lines)


@dataclass
class TimedWord:
    cue_index: int
    word_index: int  # logical (reading-order) index within the cue
    text: str
    start: float
    end: float


def parse_timestamp(value: str) -> float:
    """Parse ``HH:MM:SS,mmm`` (also accepts ``.`` separators / missing ms) into seconds."""
    match = _TIMESTAMP_RE.search(value.strip())
    if not match:
        raise ValueError(f"Invalid SRT timestamp: {value!r}")
    hours, minutes, seconds, millis = match.groups()
    millis_value = int(millis.ljust(3, "0")) if millis else 0
    return int(hours or 0) * 3600 + int(minutes) * 60 + int(seconds) + millis_value / 1000.0


def clean_text(line: str) -> str:
    """Strip HTML/ASS styling tags and normalize whitespace."""
    line = _TAG_RE.sub("", line)
    line = line.replace("\u200f", "").replace("\u200e", "").replace("\ufeff", "")
    return " ".join(line.split())


def split_words(line: str) -> List[str]:
    """Split a caption line into display words (whitespace separated)."""
    return [word for word in clean_text(line).split(" ") if word]


def word_weight(word: str) -> int:
    """Visual length weight of a word for proportional timing."""
    stripped = _ARABIC_NON_SPACING_RE.sub("", word)
    if _PUNCT_ONLY_RE.match(stripped or "_"):
        return 1
    return max(1, sum(1 for ch in stripped if ch.isalnum()))


def parse_srt(content: str) -> List[Cue]:
    """Parse SRT text content into chronologically sorted cues."""
    content = content.replace("\ufeff", "").replace("\r\n", "\n").replace("\r", "\n").strip()
    cues: List[Cue] = []
    if not content:
        return cues
    for block in _BLOCK_SPLIT_RE.split(content):
        rows = [row for row in block.split("\n")]
        timing_row = next((i for i, row in enumerate(rows) if _ARROW in row), None)
        if timing_row is None:
            continue
        start_raw, end_raw = rows[timing_row].split(_ARROW, 1)
        try:
            start = parse_timestamp(start_raw)
            end = parse_timestamp(end_raw.strip().split(" ")[0])
        except ValueError:
            continue
        lines = [split_words(row) for row in rows[timing_row + 1:]]
        lines = [line for line in lines if line]
        if not lines or end <= start:
            continue
        cues.append(Cue(index=0, start=start, end=end, lines=lines))
    cues.sort(key=lambda cue: (cue.start, cue.end))
    for i, cue in enumerate(cues):
        cue.index = i
    return cues


def read_text_file(path: Union[str, Path]) -> str:
    raw = Path(path).read_bytes()
    for encoding in ("utf-8-sig", "utf-16", "cp1256", "latin-1"):
        try:
            text = raw.decode(encoding)
            if encoding == "utf-16" and _ARROW not in text:
                continue
            return text
        except UnicodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def parse_srt_file(path: Union[str, Path]) -> List[Cue]:
    return parse_srt(read_text_file(path))


def distribute_word_timings(cue: Cue, min_word_duration: float = 0.12) -> List[TimedWord]:
    """Split a cue's duration across its words proportionally to character length.

    Every word first receives ``min_word_duration`` (reduced automatically when
    the cue is too short to give every word the floor). The remaining time is
    distributed proportionally to each word's visual character count. The last
    word always ends exactly at ``cue.end``.
    """
    words = cue.words
    count = len(words)
    if count == 0 or cue.duration <= 0:
        return []
    duration = cue.duration
    floor = min(max(0.0, min_word_duration), duration / count)
    remaining = duration - floor * count
    weights = [word_weight(word) for word in words]
    total_weight = float(sum(weights))

    timed: List[TimedWord] = []
    cursor = cue.start
    for i, (word, weight) in enumerate(zip(words, weights)):
        span = floor + remaining * (weight / total_weight)
        end = cue.end if i == count - 1 else cursor + span
        timed.append(TimedWord(cue_index=cue.index, word_index=i, text=word, start=cursor, end=end))
        cursor = end
    return timed


def build_word_timeline(cues: Sequence[Cue], min_word_duration: float = 0.12) -> List[TimedWord]:
    timeline: List[TimedWord] = []
    for cue in cues:
        timeline.extend(distribute_word_timings(cue, min_word_duration))
    return timeline
