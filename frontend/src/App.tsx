import { LOGO_URL } from "./logo";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { DesktopTitleBar } from "./components/DesktopTitleBar";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { NewProjectModal } from "./components/NewProjectModal";
import type {
  MedSubProject,
  RecentProjectItem,
  AspectRatio,
  CueItem,
  TargetLanguage,
  EmphasisType,
  MotionGraphicType,
  SfxTriggerType,
  VisualCuePlan,
  AISettingsConfig,
  BrollClipInfo,
  SequenceTrack,
  TrackKind,
} from "./types/project";

/** Width (px) of the sticky Premiere-style track header column. */
/** AI Director & Studio FX panel is hidden while it is still being reworked. */
const SHOW_AI_DIRECTOR = false;
let TRACK_HEADER_W = 150;
const TRACK_MIN_H = 24;
const TRACK_MAX_H = 360;
const TRACK_KIND_META: Record<
  TrackKind,
  { label: string; icon: string; video: boolean; defaultH: number }
> = {
  motion: { label: "Motion FX", icon: "✨", video: true, defaultH: 38 },
  subtitle: { label: "Subtitles", icon: "T", video: true, defaultH: 48 },
  broll: { label: "B-Roll", icon: "🎬", video: true, defaultH: 42 },
  voice: { label: "Voice", icon: "🎙", video: false, defaultH: 60 },
  sfx: { label: "Sound FX", icon: "🔊", video: false, defaultH: 38 },
};
const makeTrack = (kind: TrackKind, name?: string): SequenceTrack => ({
  id: `trk_${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
  kind,
  name: name || TRACK_KIND_META[kind].label,
  height: TRACK_KIND_META[kind].defaultH,
  locked: false,
  hidden: false,
  muted: false,
  solo: false,
});
/** Default sequence: video tracks listed bottom-up (V1 first), then audio top-down (A1 first). */
const makeDefaultTracks = (): SequenceTrack[] => [
  { ...makeTrack("broll"), id: "trk_v_broll" },
  { ...makeTrack("subtitle"), id: "trk_v_subtitle" },
  { ...makeTrack("motion"), id: "trk_v_motion" },
  { ...makeTrack("voice"), id: "trk_a_voice" },
  { ...makeTrack("sfx"), id: "trk_a_sfx" },
];

type IconName =
  | "upload"
  | "audio"
  | "wave"
  | "file"
  | "chevron"
  | "play"
  | "pause"
  | "back"
  | "forward"
  | "volume"
  | "check"
  | "download"
  | "spark"
  | "box"
  | "type"
  | "screen"
  | "undo"
  | "redo"
  | "help"
  | "close"
  | "expand"
  | "folder"
  | "plus";
function Icon({
  name,
  size = 18,
  ...props
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  const paths: Record<IconName, ReactNode> = {
    upload: (
      <>
        <path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5" />
      </>
    ),
    audio: (
      <>
        <path d="M9 18V5l11-2v13M9 9l11-2" />
        <ellipse cx="6" cy="18" rx="3" ry="3" />
        <ellipse cx="17" cy="16" rx="3" ry="3" />
      </>
    ),
    wave: <path d="M3 10v4m4-7v10m5-14v18m5-15v12m4-9v6" />,
    file: (
      <>
        <path d="M14 3H5v18h14V8zM14 3v6h5M8 13h8M8 17h5" />
      </>
    ),
    chevron: <path d="m8 10 4 4 4-4" />,
    play: <path d="m9 5 11 7-11 7z" fill="currentColor" strokeWidth="0" />,
    pause: (
      <>
        <path d="M8 5v14M16 5v14" strokeWidth="4" />
      </>
    ),
    back: (
      <>
        <path d="M5 5v14m14-14L8 12l11 7z" />
      </>
    ),
    forward: (
      <>
        <path d="M19 5v14M5 5l11 7-11 7z" />
      </>
    ),
    volume: (
      <>
        <path d="m11 4-6 5H2v6h3l6 5zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    download: <path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4" />,
    spark: (
      <>
        <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5zM20 2v4m-2-2h4" />
      </>
    ),
    box: (
      <>
        <rect x="4" y="5" width="16" height="14" rx="3" />
        <path d="M1 2h4M1 2v4m18-4h4v4M1 18v4h4m14 0h4v-4" />
      </>
    ),
    type: (
      <>
        <path d="m3 19 6-15 6 15M5 14h8M15 10h7m-3-3v12" />
      </>
    ),
    screen: (
      <>
        <rect x="3" y="4" width="18" height="14" rx="2" />
        <path d="M8 22h8m-4-4v4" />
      </>
    ),
    undo: (
      <>
        <path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12" />
      </>
    ),
    redo: (
      <>
        <path d="m16 4 5 5-5 5m5-5H10a6 6 0 0 0 0 12" />
      </>
    ),
    help: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 8a2.6 2.6 0 0 1 5 .8c0 2-2.5 2-2.5 4M12 17h.01" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    expand: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />,
    folder: <path d="M3 6h7l2 3h9v12H3z" />,
    plus: <path d="M12 5v14M5 12h14" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}

type Cue = CueItem;
const initialCues: Cue[] = [
  {
    start: 0,
    end: 1.2,
    text: "عندك فكرة تغيّر كل شيء",
    visual_plan: {
      emphasis_type: "pop",
      emoji_or_icon: "💡",
      broll_query: "creative startup founder brainstorming",
      motion_graphic: "none",
      graphic_text: "",
      sfx_trigger: "whoosh",
    },
  },
  {
    start: 1.2,
    end: 3.2,
    text: "بس مش عارف من وين تبدأ",
    visual_plan: {
      emphasis_type: "shake_red",
      emoji_or_icon: "❌",
      broll_query: "stressed entrepreneur looking at screen",
      motion_graphic: "stat_badge",
      graphic_text: "80% des projets échouent ❌",
      sfx_trigger: "error",
    },
  },
  {
    start: 3.2,
    end: 5.8,
    text: "كاش ستارتاب ولا أبليكاسيون",
    visual_plan: {
      emphasis_type: "pop",
      emoji_or_icon: "🚀",
      broll_query: "developer coding mobile application on laptop",
      motion_graphic: "stat_badge",
      graphic_text: "SaaS & Mobile App 🚀",
      sfx_trigger: "pop",
    },
  },
  {
    start: 5.8,
    end: 8.4,
    text: "الموضوع أبسط مما تتخيّل",
    visual_plan: {
      emphasis_type: "bounce",
      emoji_or_icon: "✨",
      broll_query: "modern minimalist tech workspace",
      motion_graphic: "none",
      graphic_text: "",
      sfx_trigger: "whoosh",
    },
  },
  {
    start: 8.4,
    end: 11.2,
    text: "ابدأ بالمشكلة مش بالحل",
    visual_plan: {
      emphasis_type: "shake_red",
      emoji_or_icon: "🎯",
      broll_query: "team analyzing problem on whiteboard",
      motion_graphic: "stat_badge",
      graphic_text: "Focus sur le Problème 🎯",
      sfx_trigger: "click",
    },
  },
  {
    start: 11.2,
    end: 14.3,
    text: "واسأل الناس شو بيحتاجوا",
    visual_plan: {
      emphasis_type: "normal",
      emoji_or_icon: "🗣️",
      broll_query: "customer interview feedback conversation",
      motion_graphic: "none",
      graphic_text: "",
      sfx_trigger: "pop",
    },
  },
  {
    start: 14.3,
    end: 18.5,
    text: "قدّم قيمة حقيقية للناس",
    visual_plan: {
      emphasis_type: "pop",
      emoji_or_icon: "💰",
      broll_query: "business growth chart success",
      motion_graphic: "stat_badge",
      graphic_text: "10x Valeur Réelle 💰",
      sfx_trigger: "cash",
    },
  },
  {
    start: 18.5,
    end: 23,
    text: "وبعدين خلّي شغلك يحكي",
    visual_plan: {
      emphasis_type: "bounce",
      emoji_or_icon: "🔥",
      broll_query: "product launch presentation stage",
      motion_graphic: "cta_bio",
      graphic_text: "Full System in Bio 🔗",
      sfx_trigger: "whoosh",
    },
  },
  {
    start: 23,
    end: 28,
    text: "كل رحلة بتبدأ بخطوة",
    visual_plan: {
      emphasis_type: "pop",
      emoji_or_icon: "🚀",
      broll_query: "ambitious founder walking in city",
      motion_graphic: "cta_follow",
      graphic_text: "Follow for Part 2 🚀",
      sfx_trigger: "pop",
    },
  },
];
type Style = {
  box: string;
  radius: number;
  padX: number;
  padY: number;
  size: number;
  text: string;
  active: string;
  stroke: string;
  width: number;
  bg: string;
  y: number;
};
const defaults: Style = {
  box: "#FFEB00",
  radius: 12,
  padX: 18,
  padY: 8,
  size: 76,
  text: "#FFFFFF",
  active: "#FFFFFF",
  stroke: "#000000",
  width: 7,
  bg: "#00FF00",
  y: 52,
};
const defaultAISettings: AISettingsConfig = {
  targetLanguage: "darija_mixed",
  wordsPerLine: 4,
  maxLines: 1,
  enableKineticText: true,
  enableEmojis: true,
  enableMotionGraphics: false,
  enableSfx: true,
  enableBroll: false,
  sfxVolumeDb: -12,
};

export interface MotionSuggestionItem {
  type: MotionGraphicType;
  label: string;
  badgeIcon: string;
  text: string;
  subtext: string;
  sfx: SfxTriggerType;
  recommended?: boolean;
}

const getCaptionMotionSuggestions = (cueText: string, cueIdx = 0): MotionSuggestionItem[] => {
  const clean = (cueText || "").replace(/\s+/g, " ").trim();
  const words = clean.split(" ").filter(Boolean);
  const latinMatch = clean.match(/[A-Za-z][A-Za-z0-9+._-]*(?:\s+[A-Za-z][A-Za-z0-9+._-]*)?/);
  const numMatch = clean.match(/\d+(?:[.,]\d+)?(?:\s*[%xX$€kK]|(?:\s*مليون|\s*ألف))?/);
  const keyPhrase = latinMatch?.[0] || numMatch?.[0] || words.slice(0, 2).join(" ") || "فكرة قوية";

  const hasNegative = /مشكل|خطأ|صعيب|ثقيلة|ما تفتحش|تضيع|يروحو|خسارة|زيرو|بدون|مش عارف/.test(clean);
  const hasSolution = /حل|ساهل|أحسن|طريق|نجاح|برمج|طور|بني|أسرع|قوي|نتيجة/.test(clean);
  const hasStep = /أول|ثاني|ثالث|خطوة|مرحلة|1|2|3|تبدأ|تبدا/.test(clean);
  const hasClient = /كليون|زبون|كوموند|مبيعات|رسالة|طلب|بيزنس|شركة|ستارتاب/.test(clean);
  const hasCta = /بايو|لينك|رابط|أبوني|تابع|اشترك|bio|link|follow/i.test(clean);

  const items: MotionSuggestionItem[] = [
    {
      type: "spotlight",
      label: "Tech / Concept Spotlight",
      badgeIcon: "🚀",
      text: `${keyPhrase} 🚀`,
      subtext: "Concept & Feature Focus",
      sfx: "pop",
      recommended: Boolean(latinMatch) || (!hasNegative && !hasCta),
    },
    {
      type: "stat_badge",
      label: "Metric / Stat Callout",
      badgeIcon: "📈",
      text: numMatch ? `${numMatch[0]} Impact 📈` : `10x ${keyPhrase} 📈`,
      subtext: "High-retention metric badge",
      sfx: "cash",
      recommended: Boolean(numMatch),
    },
    {
      type: "mistake_stamp",
      label: "Mistake Warning",
      badgeIcon: "❌",
      text: `خطأ: ${words.slice(0, 3).join(" ") || keyPhrase} ❌`,
      subtext: "Pain-point alert banner",
      sfx: "error",
      recommended: hasNegative,
    },
    {
      type: "solution_stamp",
      label: "Verified Solution",
      badgeIcon: "✅",
      text: `الحل: ${keyPhrase} ✅`,
      subtext: "Green verified solution card",
      sfx: "pop",
      recommended: hasSolution,
    },
    {
      type: "step_badge",
      label: "Step / Checklist",
      badgeIcon: "🔢",
      text: `الخطوة 0${(cueIdx % 5) + 1}: ${keyPhrase} ⚡`,
      subtext: "Numbered framework step",
      sfx: "click",
      recommended: hasStep,
    },
    {
      type: "notification_toast",
      label: "Client / Order Toast",
      badgeIcon: "🔔",
      text: `🔔 ${keyPhrase} — New Update`,
      subtext: "iOS / Stripe notification banner",
      sfx: "cash",
      recommended: hasClient,
    },
    {
      type: "neon_tape",
      label: "Neon Hook Tape",
      badgeIcon: "⚡",
      text: `⚡ ${words.slice(0, 3).join(" ") || keyPhrase}`,
      subtext: "High-contrast headline strip",
      sfx: "whoosh",
      recommended: cueIdx === 0,
    },
    {
      type: "cta_bio",
      label: "Link in Bio CTA",
      badgeIcon: "🔗",
      text: "اللينك راه في البايو 🔗",
      subtext: "Animated pointer click CTA",
      sfx: "click",
      recommended: hasCta,
    },
    {
      type: "cta_follow",
      label: "Follow / Subscribe CTA",
      badgeIcon: "➕",
      text: "دير أبوني للمزيد 🚀",
      subtext: "Social growth callout",
      sfx: "pop",
      recommended: hasCta,
    },
  ];

  return items.sort((a, b) => Number(Boolean(b.recommended)) - Number(Boolean(a.recommended)));
};

let sharedAudioCtx: AudioContext | null = null;
const playSfxPreview = (sfx: SfxTriggerType, volumeDb = -12) => {
  if (!sfx || sfx === "none" || typeof window === "undefined") return;
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!sharedAudioCtx) sharedAudioCtx = new Ctx();
    const ctx = sharedAudioCtx;
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    const linVol = Math.min(0.6, Math.max(0.05, Math.pow(10, volumeDb / 20)));
    gain.gain.setValueAtTime(linVol, now);
    gain.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.connect(gain);

    if (sfx === "pop") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(780, now + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if (sfx === "whoosh") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.22);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      osc.start(now);
      osc.stop(now + 0.25);
    } else if (sfx === "cash") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(987.77, now); // B5
      osc.frequency.setValueAtTime(1318.51, now + 0.07); // E6
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc.start(now);
      osc.stop(now + 0.29);
    } else if (sfx === "error") {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(175, now);
      osc.frequency.setValueAtTime(140, now + 0.09);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      osc.start(now);
      osc.stop(now + 0.25);
    } else {
      // click
      osc.type = "square";
      osc.frequency.setValueAtTime(1100, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
      osc.start(now);
      osc.stop(now + 0.045);
    }
  } catch {}
};

const formatClientCueLines = (tokens: string[], wordsPerLine: number, maxLines: number): string => {
  const clean = tokens.filter(Boolean);
  if (!clean.length) return "";
  const wpl = Math.max(1, wordsPerLine);
  const ml = Math.max(1, maxLines);
  if (ml <= 1 || clean.length <= wpl) return clean.join(" ");
  const lines: string[] = [];
  for (let i = 0; i < clean.length; i += wpl) {
    lines.push(clean.slice(i, i + wpl).join(" "));
  }
  if (lines.length > ml) {
    return [...lines.slice(0, ml - 1), lines.slice(ml - 1).join(" ")].join("\n");
  }
  return lines.join("\n");
};
const stamp = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${(s % 60).toFixed(2).padStart(5, "0")}`;
const textDirection = (text: string) => {
  const firstLetter = text.match(/\p{L}/u)?.[0] || "ع";
  return /[\u0590-\u08ff\ufb1d-\ufefc]/.test(firstLetter) ? "rtl" : "ltr";
};
const fontWeight = (font: string) => (font === "Almarai" ? 800 : 700);
const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") || "";
const BACKEND_FONT_MAP: Record<string, string> = {
  Cairo: "Cairo-Bold",
  Tajawal: "Tajawal-Bold",
  Almarai: "Almarai-ExtraBold",
  Changa: "Changa-Bold",
};
const formatSrtTimestamp = (seconds: number) => {
  const clamped = Math.max(0, seconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const ms = Math.round((clamped - Math.floor(clamped)) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
};
const cuesToSrt = (list: Cue[]) =>
  list
    .map((cue, idx) => `${idx + 1}\n${formatSrtTimestamp(cue.start)} --> ${formatSrtTimestamp(cue.end)}\n${cue.text.trim()}\n`)
    .join("\n");
const createSilentWavFile = (durationSec: number, sampleRate = 22050): File => {
  const numSamples = Math.max(1, Math.ceil(durationSec * sampleRate));
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, numSamples * 2, true);
  return new File([buffer], "silent_track.wav", { type: "audio/wav" });
};
const getWordTimings = (cue: Cue): { start: number; end: number; text: string }[] => {
  const list = cue.text.trim().split(/\s+/).filter(Boolean);
  if (!list.length) return [];
  const cStart = cue.start;
  const cEnd = Math.max(cStart + 0.18, cue.end);
  const totalDur = Math.max(0.18, cEnd - cStart);

  if (list.length === 1) {
    return [{ start: cStart, end: cEnd, text: list[0] }];
  }

  // Compute spoken syllable/character weights
  const weights = list.map((w) => {
    const stripped = w.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, "");
    const alnum = Array.from(stripped).filter((ch) => /[\p{L}\p{N}]/u.test(ch)).length;
    return Math.max(2.0, Math.pow(Math.max(1, alnum), 0.85));
  });
  const totalWeight = weights.reduce((a, b) => a + b, 0) || list.length;
  const propDurs = weights.map((w) => totalDur * (w / totalWeight));

  // If cue.words exists and matches token count, blend acoustic timing with smooth syllable pacing
  if (cue.words && cue.words.length === list.length) {
    const rawDurs = cue.words.map((w) => Math.max(0.03, w.end - w.start));
    const rawSum = rawDurs.reduce((a, b) => a + b, 0) || totalDur;
    const normRawDurs = rawDurs.map((d) => totalDur * (d / rawSum));

    const avgDur = totalDur / list.length;
    const minHold = Math.min(0.18, avgDur * 0.72);
    const isSkewed = normRawDurs.some(
      (d, idx) =>
        d < minHold ||
        (propDurs[idx] > 0 && (d / propDurs[idx] > 1.85 || d / propDurs[idx] < 0.52)),
    );
    const alpha = isSkewed ? 0.25 : 0.5;
    const blended = normRawDurs.map((r, idx) =>
      Math.max(minHold, alpha * r + (1 - alpha) * propDurs[idx]),
    );
    const blendedSum = blended.reduce((a, b) => a + b, 0) || totalDur;

    let cursor = cStart;
    return list.map((word, idx) => {
      const span = totalDur * (blended[idx] / blendedSum);
      const end = idx === list.length - 1 ? cEnd : cursor + span;
      const item = { start: cursor, end, text: word };
      cursor = end;
      return item;
    });
  }

  let cursor = cStart;
  return list.map((word, i) => {
    const span = propDurs[i];
    const end = i === list.length - 1 ? cEnd : cursor + span;
    const item = { start: cursor, end, text: word };
    cursor = end;
    return item;
  });
};

const getProportionalActiveWord = (cue: Cue | undefined, currentTime: number): number => {
  if (!cue) return 0;
  const timings = getWordTimings(cue);
  if (timings.length <= 1) return 0;
  for (let i = 0; i < timings.length; i++) {
    if (currentTime < timings[i].end || i === timings.length - 1) {
      return i;
    }
  }
  return timings.length - 1;
};
const rechunkCuesByLayout = (
  existingCues: Cue[],
  wordsPerLine: number,
  maxLines: number,
): Cue[] => {
  if (!existingCues.length) return [];
  const wpl = Math.max(1, wordsPerLine);
  const ml = Math.max(1, maxLines);
  const maxWordsPerCue = Math.max(1, wpl * ml);

  type TimedToken = {
    word: string;
    start: number;
    end: number;
    sourceCue: Cue;
  };

  const flatTokens: TimedToken[] = [];
  for (const cue of existingCues) {
    const wTimings = getWordTimings(cue);
    for (const wt of wTimings) {
      if (wt.text.trim()) {
        flatTokens.push({
          word: wt.text.trim(),
          start: Number(wt.start.toFixed(3)),
          end: Number(wt.end.toFixed(3)),
          sourceCue: cue,
        });
      }
    }
  }

  const chunks: TimedToken[][] = [];
  let current: TimedToken[] = [];
  for (const tok of flatTokens) {
    if (current.length > 0) {
      const pause = tok.start - current[current.length - 1].end;
      const prevWord = current[current.length - 1].word;
      const endsSentence = /[.!?؟،]$/.test(prevWord);
      if (
        current.length >= maxWordsPerCue ||
        pause > 0.45 ||
        (endsSentence && current.length >= Math.min(2, maxWordsPerCue))
      ) {
        chunks.push(current);
        current = [];
      }
    }
    current.push(tok);
  }
  if (current.length > 0) chunks.push(current);

  return chunks.map((chunk) => {
    const first = chunk[0];
    const last = chunk[chunk.length - 1];
    const wordsArr = chunk.map((t, idx) => {
      const nextStart = idx < chunk.length - 1 ? chunk[idx + 1].start : last.end;
      const gap = nextStart - t.end;
      return {
        word: t.word,
        start: Number(t.start.toFixed(3)),
        end: Number((gap > 0 && gap <= 0.25 ? nextStart : Math.max(t.start + 0.05, t.end)).toFixed(3)),
      };
    });
    return {
      start: wordsArr[0].start,
      end: Math.max(wordsArr[0].start + 0.15, wordsArr[wordsArr.length - 1].end),
      text: formatClientCueLines(
        wordsArr.map((w) => w.word),
        wpl,
        ml,
      ),
      words: wordsArr,
      visual_plan: first.sourceCue.visual_plan
        ? { ...first.sourceCue.visual_plan }
        : undefined,
      broll_clip_path: first.sourceCue.broll_clip_path,
      broll_preview_url: first.sourceCue.broll_preview_url,
    };
  });
};
type Snapshot = { style: Style; cues: Cue[] };
function parseSrt(text: string): Cue[] {
  const seconds = (v: string) => {
    const [h, m, s] = v.replace(",", ".").split(":").map(Number);
    return h * 3600 + m * 60 + s;
  };
  return text
    .replace(/\r/g, "")
    .trim()
    .split(/\n\s*\n/)
    .flatMap((block) => {
      const lines = block.split("\n");
      const index = lines.findIndex((line) => line.includes("-->"));
      if (index < 0) return [];
      const [a, b] = lines[index].split("-->").map((s) => s.trim().split(" ")[0]);
      const start = seconds(a),
        end = seconds(b);
      const content = lines
        .slice(index + 1)
        .join(" ")
        .replace(/<[^>]*>/g, "");
      return Number.isFinite(start) && end > start && content
        ? [{ start, end, text: content }]
        : [];
    })
    .sort((a, b) => a.start - b.start);
}
function Slider({
  label,
  value,
  min,
  max,
  unit = "px",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  onChange: (n: number) => void;
}) {
  return (
    <div className="slider-control">
      <div className="control-label">
        <label>{label}</label>
        <span className="value-box">
          {value}
          <small>{unit}</small>
        </span>
      </div>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        style={{ "--fill": `${((value - min) / (max - min)) * 100}%` } as CSSProperties}
      />
    </div>
  );
}
function ColorControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <div className="color-control">
      <label>{label}</label>
      <div className="color-field">
        <input
          aria-label={`${label} picker`}
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
        />
        <input
          aria-label={`${label} hex`}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toUpperCase());
          }}
          onBlur={() => setDraft(value)}
          maxLength={7}
        />
      </div>
    </div>
  );
}

export default function App() {
  const [cues, setCues] = useState<Cue[]>([]);
  const [style, setStyle] = useState(defaults);
  const [font, setFont] = useState("Cairo");
  const [customFont, setCustomFont] = useState("");
  const [customFontKey, setCustomFontKey] = useState("");
  const [backendOnline, setBackendOnline] = useState(false);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [audioDuration, setAudioDuration] = useState(0);
  const [voiceClipRange, setVoiceClipRange] = useState<{ start: number; end: number }>({
    start: 0,
    end: 0,
  });
  const [selectedTrackLayer, setSelectedTrackLayer] = useState<string>("trk_v_subtitle");
  // Premiere-style multi-track sequence (add / delete / rename / resize / lock / hide / mute / solo)
  const [tracks, setTracks] = useState<SequenceTrack[]>(makeDefaultTracks);
  const [voiceTrackId, setVoiceTrackId] = useState<string>("trk_a_voice");
  const [trackMenu, setTrackMenu] = useState<{
    x: number;
    y: number;
    trackId: string | null;
  } | null>(null);
  const [renamingTrackId, setRenamingTrackId] = useState<string | null>(null);
  const [dropTargetTrackId, setDropTargetTrackId] = useState<string | null>(null);
  const [openMotionGalleryCue, setOpenMotionGalleryCue] = useState<number | null>(null);
  const [captionScale, setCaptionScale] = useState(1);
  const [srtName, setSrtName] = useState("");
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState<"export" | "help" | null>(null);
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [exportStatus, setExportStatus] = useState<"ready" | "complete" | "error">("ready");
  const [zoom, setZoom] = useState(100);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const [shuttleRate, setShuttleRate] = useState(1);
  const [inPoint, setInPoint] = useState<number | null>(null);
  const [outPoint, setOutPoint] = useState<number | null>(null);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [selectedCue, setSelectedCue] = useState(0);
  const [selectedCues, setSelectedCues] = useState<number[]>([]);
  const [marqueeBox, setMarqueeBox] = useState<{ leftPct: number; widthPct: number } | null>(null);
  const [draggingCue, setDraggingCue] = useState<number | null>(null);
  const [dragLockDuration, setDragLockDuration] = useState<number | null>(null);
  const [customSeqDuration, setCustomSeqDuration] = useState<number>(15);
  const [draggingCanvasCaption, setDraggingCanvasCaption] = useState(false);
  const [timelineHeight, setTimelineHeight] = useState<number>(340);
  const [headerW, setHeaderW] = useState<number>(150);
  TRACK_HEADER_W = headerW;
  const [secH, setSecH] = useState<Record<string, number>>({});
  const secStyle = (k: string): React.CSSProperties =>
    secH[k] ? { height: secH[k], flex: "none", minHeight: 0, overflowY: "auto" } : {};
  const startSecResize = (e: React.PointerEvent, k: string) => {
    e.preventDefault();
    e.stopPropagation();
    const sec = (e.currentTarget as HTMLElement).previousElementSibling as HTMLElement | null;
    if (!sec) return;
    const y0 = e.clientY;
    const h0 = sec.getBoundingClientRect().height;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "ns-resize";
    const mv = (ev: PointerEvent) =>
      setSecH((m) => ({ ...m, [k]: Math.max(60, Math.min(1400, Math.round(h0 + ev.clientY - y0))) }));
    const up = () => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  };
  const secHandle = (k: string) => (
    <div
      className="section-resizer"
      title="Drag to resize this section · double-click to reset"
      onPointerDown={(e) => startSecResize(e, k)}
      onDoubleClick={() =>
        setSecH((m) => {
          const { [k]: _gone, ...rest } = m;
          return rest;
        })
      }
    >
      <i />
    </div>
  );
  const [leftPanelWidth, setLeftPanelWidth] = useState<number>(300);
  const [rightPanelWidth, setRightPanelWidth] = useState<number>(340);
  // Phase 2 & Phase 3 AI Studio state
  const [aiSettings, setAiSettings] = useState<AISettingsConfig>(defaultAISettings);
  const [transcribing, setTranscribing] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [fetchingBroll, setFetchingBroll] = useState(false);
  const [brollZipUrl, setBrollZipUrl] = useState("");
  const [lastJobDownloads, setLastJobDownloads] = useState<{
    videoUrl?: string;
    sfxUrl?: string;
    srtUrl?: string;
    brollZipUrl?: string;
  } | null>(null);
  const [aiEngineInfo, setAiEngineInfo] = useState<{
    groq?: boolean;
    gemini?: boolean;
    unsplash?: boolean;
    pixabay?: boolean;
    brollProviders?: string[];
    lastEngineUsed?: string;
  }>({});
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const srtInput = useRef<HTMLInputElement>(null);
  const fontInput = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);
  const wordSpanRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const prevCueIndexRef = useRef<number>(-1);
  const [highlightBoxRect, setHighlightBoxRect] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
    animate: boolean;
  } | null>(null);
  const tracksRef = useRef<HTMLDivElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const cueTextRefs = useRef<(HTMLTextAreaElement | null)[]>([]);
  const cancelRender = useRef(false);

  // Project & Desktop View state
  const [currentView, setCurrentView] = useState<"welcome" | "editor">("welcome");
  const [currentProject, setCurrentProject] = useState<MedSubProject | null>(null);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [recentProjects, setRecentProjects] = useState<RecentProjectItem[]>(() => {
    try {
      const stored = localStorage.getItem("medsub_recent_projects");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const projectFileInputRef = useRef<HTMLInputElement>(null);

  const saveToRecentProjects = (proj: MedSubProject) => {
    const item: RecentProjectItem = {
      id: proj.id,
      name: proj.name,
      preset: proj.preset,
      updatedAt: new Date().toISOString(),
      cueCount: proj.cues.length,
      previewText: proj.cues[0]?.text || "",
      filePath: proj.filePath,
      data: proj,
    };
    setRecentProjects((prev) => {
      const filtered = prev.filter((p) => p.id !== proj.id);
      const updated = [item, ...filtered].slice(0, 20);
      try {
        localStorage.setItem("medsub_recent_projects", JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  const loadProjectData = (data: MedSubProject, filePath?: string) => {
    const loaded: MedSubProject = {
      ...data,
      filePath: filePath || data.filePath,
      updatedAt: new Date().toISOString(),
    };
    setCurrentProject(loaded);
    setCues(Array.isArray(loaded.cues) ? loaded.cues : []);
    if (loaded.style) {
      setStyle(loaded.style);
    }
    if (loaded.font) {
      setFont(loaded.font);
    }
    if (loaded.customFont) setCustomFont(loaded.customFont);
    if (loaded.customFontKey) setCustomFontKey(loaded.customFontKey);
    if (loaded.aiSettings) setAiSettings({ ...defaultAISettings, ...loaded.aiSettings });
    const loadedTracks =
      Array.isArray(loaded.tracks) && loaded.tracks.length > 0
        ? loaded.tracks
        : makeDefaultTracks();
    setTracks(loadedTracks);
    setVoiceTrackId(loadedTracks.find((t) => t.kind === "voice")?.id || "");
    setSelectedTrackLayer(loadedTracks.find((t) => t.kind === "subtitle")?.id || "");
    setTime(0);
    setSelectedCue(0);
    setSelectedCues(loaded.cues?.length ? [0] : []);
    setCurrentView("editor");
    setHasUnsavedChanges(false);
    saveToRecentProjects(loaded);
    notify(`Opened project "${loaded.name}"`);
  };

  const handleCreateNewProject = (config: {
    name: string;
    preset: AspectRatio;
    audioFile?: File;
    srtFile?: File;
  }) => {
    let initialProjCues: Cue[] = [];

    if (config.srtFile) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        if (text) {
          const parsed = parseSrt(text);
          if (parsed.length) initialProjCues = parsed;
        }
        finishCreation(initialProjCues);
      };
      reader.readAsText(config.srtFile);
      return;
    }

    finishCreation(initialProjCues);

    function finishCreation(resolvedCues: Cue[]) {
      const newProj: MedSubProject = {
        id: `proj_${Date.now()}`,
        name: config.name,
        preset: config.preset,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        cues: resolvedCues,
        style: defaults,
        font: "Cairo",
        audioFileName: config.audioFile?.name,
        aiSettings: defaultAISettings,
      };

      if (config.audioFile) {
        uploadAudio(config.audioFile);
      } else {
        setAudioFile(null);
        setAudioUrl("");
        setAudioDuration(0);
        setVoiceClipRange({ start: 0, end: 0 });
      }

      loadProjectData(newProj);
      setShowNewProjectModal(false);
      notify(`Empty sequence "${config.name}" ready!`);
    }
  };

  const handleOpenProject = async () => {
    if (window.electronAPI) {
      const res = await window.electronAPI.showOpenProjectDialog();
      if (res && res.content) {
        loadProjectData(res.content, res.filePath);
      }
    } else {
      projectFileInputRef.current?.click();
    }
  };

  const handleWebProjectFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        loadProjectData(parsed, file.name);
      } catch {
        notify("Invalid project file format");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleSaveProject = async () => {
    if (!currentProject) return;
    const updated: MedSubProject = {
      ...currentProject,
      cues,
      style,
      font,
      customFont,
      customFontKey,
      aiSettings,
      tracks,
      updatedAt: new Date().toISOString(),
    };

    if (window.electronAPI) {
      let targetPath = updated.filePath;
      if (!targetPath) {
        const chosen = await window.electronAPI.showSaveProjectDialog(updated.name);
        if (!chosen) return;
        targetPath = chosen;
        updated.filePath = chosen;
      }
      const res = await window.electronAPI.saveFile(targetPath, updated);
      if (res.success) {
        setCurrentProject(updated);
        saveToRecentProjects(updated);
        setHasUnsavedChanges(false);
        notify(`Saved "${updated.name}"`);
      } else {
        notify(`Error saving: ${res.error}`);
      }
    } else {
      const blob = new Blob([JSON.stringify(updated, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${updated.name}.medsub`;
      a.click();
      URL.revokeObjectURL(url);
      setCurrentProject(updated);
      saveToRecentProjects(updated);
      setHasUnsavedChanges(false);
      notify(`Saved "${updated.name}"`);
    }
  };

  const handleSaveProjectAs = async () => {
    if (!currentProject) return;
    const updated: MedSubProject = {
      ...currentProject,
      cues,
      style,
      font,
      customFont,
      customFontKey,
      aiSettings,
      tracks,
      updatedAt: new Date().toISOString(),
    };

    if (window.electronAPI) {
      const chosen = await window.electronAPI.showSaveProjectDialog(updated.name);
      if (!chosen) return;
      updated.filePath = chosen;
      const res = await window.electronAPI.saveFile(chosen, updated);
      if (res.success) {
        setCurrentProject(updated);
        saveToRecentProjects(updated);
        setHasUnsavedChanges(false);
        notify(`Saved As "${updated.name}"`);
      }
    } else {
      handleSaveProject();
    }
  };

  const handleDeleteRecent = (id: string) => {
    setRecentProjects((prev) => {
      const updated = prev.filter((p) => p.id !== id);
      try {
        localStorage.setItem("medsub_recent_projects", JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  const handleOpenSample = () => {
    const sampleProj: MedSubProject = {
      id: "sample_demo_arabic",
      name: "Arabic_Reel_Template",
      preset: "9:16",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      cues: initialCues,
      style: defaults,
      font: "Cairo",
      aiSettings: defaultAISettings,
    };
    loadProjectData(sampleProj);
  };
  // ------------------------------------------------------------------------
  // Premiere-style track model helpers
  // ------------------------------------------------------------------------
  const isVideoKind = (k: TrackKind) => TRACK_KIND_META[k].video;
  const videoTracks = tracks.filter((t) => isVideoKind(t.kind)); // index 0 = V1 (bottom)
  const audioTracks = tracks.filter((t) => !isVideoKind(t.kind)); // index 0 = A1 (top)
  const trackById = (id?: string | null) => (id ? tracks.find((t) => t.id === id) : undefined);
  const trackTag = (t: SequenceTrack) =>
    isVideoKind(t.kind)
      ? `V${videoTracks.findIndex((x) => x.id === t.id) + 1}`
      : `A${audioTracks.findIndex((x) => x.id === t.id) + 1}`;
  const resolveTrackId = (kind: TrackKind, assigned?: string): string | null => {
    const list = tracks.filter((t) => t.kind === kind);
    if (assigned && list.some((t) => t.id === assigned)) return assigned;
    return list[0]?.id ?? null;
  };
  const anySoloTrack = audioTracks.some((t) => t.solo);
  const isTrackAudible = (t?: SequenceTrack) =>
    !!t && !t.muted && (!anySoloTrack || t.solo);
  const isTrackVisible = (t?: SequenceTrack) => !!t && !t.hidden;
  const cueSubtitleVisible = (c: Cue) =>
    isTrackVisible(trackById(resolveTrackId("subtitle", c.track_id)));
  const cueMotionVisible = (c: Cue) =>
    isTrackVisible(trackById(resolveTrackId("motion", c.visual_plan?.motion_track_id)));
  const cueBrollVisible = (c: Cue) =>
    isTrackVisible(trackById(resolveTrackId("broll", c.visual_plan?.broll_track_id)));
  const cueSfxAudible = (c: Cue) =>
    isTrackAudible(trackById(resolveTrackId("sfx", c.visual_plan?.sfx_track_id)));
  const voiceAudible = isTrackAudible(trackById(voiceTrackId));
  /** Canvas stacking order follows video track order, exactly like Premiere (higher V = on top). */
  const videoLayerZ = (kind: TrackKind, assigned?: string) => {
    const id = resolveTrackId(kind, assigned);
    const idx = videoTracks.findIndex((t) => t.id === id);
    return 4 + Math.max(0, idx) * 3;
  };
  const cueHasBroll = (c: Cue) =>
    Boolean(c.broll_preview_url) || (aiSettings.enableBroll && Boolean(c.visual_plan?.broll_query));
  const clipCountOnTrack = (t: SequenceTrack) => {
    switch (t.kind) {
      case "subtitle":
        return cues.filter((c) => resolveTrackId("subtitle", c.track_id) === t.id).length;
      case "motion":
        return cues.filter(
          (c) =>
            c.visual_plan?.motion_graphic &&
            c.visual_plan.motion_graphic !== "none" &&
            resolveTrackId("motion", c.visual_plan.motion_track_id) === t.id,
        ).length;
      case "sfx":
        return cues.filter(
          (c) =>
            c.visual_plan?.sfx_trigger &&
            c.visual_plan.sfx_trigger !== "none" &&
            resolveTrackId("sfx", c.visual_plan.sfx_track_id) === t.id,
        ).length;
      case "broll":
        return cues.filter(
          (c) => cueHasBroll(c) && resolveTrackId("broll", c.visual_plan?.broll_track_id) === t.id,
        ).length;
      case "voice":
        return audioFile && voiceTrackId === t.id ? 1 : 0;
    }
  };
  const updateTrack = (id: string, patch: Partial<SequenceTrack>) => {
    setTracks((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    setHasUnsavedChanges(true);
  };
  /** Click toggles one track; Shift+Click toggles every track of the same family (Premiere behaviour). */
  const toggleTrackFlag = (
    e: React.MouseEvent,
    id: string,
    flag: "locked" | "hidden" | "muted" | "solo",
  ) => {
    e.stopPropagation();
    const t = trackById(id);
    if (!t) return;
    const next = !t[flag];
    if (e.shiftKey) {
      setTracks((ts) =>
        ts.map((x) => {
          const applies =
            flag === "locked" ? true : flag === "hidden" ? isVideoKind(x.kind) : !isVideoKind(x.kind);
          return applies ? { ...x, [flag]: next } : x;
        }),
      );
    } else {
      updateTrack(id, { [flag]: next } as Partial<SequenceTrack>);
    }
    setHasUnsavedChanges(true);
  };
  const addTrack = (
    kind: TrackKind,
    refId?: string | null,
    position: "above" | "below" = "above",
  ): string => {
    const sameKindCount = tracks.filter((t) => t.kind === kind).length;
    const nt = makeTrack(
      kind,
      sameKindCount > 0 ? `${TRACK_KIND_META[kind].label} ${sameKindCount + 1}` : undefined,
    );
    setTracks((ts) => {
      const isVid = isVideoKind(kind);
      const refIdx = refId ? ts.findIndex((t) => t.id === refId) : -1;
      let idx: number;
      if (refIdx >= 0 && isVideoKind(ts[refIdx].kind) === isVid) {
        // Video tracks are displayed reversed (V1 at the bottom), audio top-down.
        idx = isVid
          ? position === "above"
            ? refIdx + 1
            : refIdx
          : position === "above"
            ? refIdx
            : refIdx + 1;
      } else if (isVid) {
        const lastVideo = ts.reduce((acc, t, i) => (isVideoKind(t.kind) ? i : acc), -1);
        idx = lastVideo + 1;
      } else {
        idx = ts.length;
      }
      const copy = [...ts];
      copy.splice(idx, 0, nt);
      return copy;
    });
    if (kind === "voice" && !tracks.some((t) => t.id === voiceTrackId)) setVoiceTrackId(nt.id);
    setSelectedTrackLayer(nt.id);
    setHasUnsavedChanges(true);
    notify(`Added ${isVideoKind(kind) ? "video" : "audio"} track "${nt.name}"`);
    return nt.id;
  };
  /** Returns an existing track id for the kind, creating a new track if none exists. */
  const ensureTrack = (kind: TrackKind, preferred?: string | null) => {
    const pref = trackById(preferred);
    if (pref && pref.kind === kind) return pref.id;
    return resolveTrackId(kind) ?? addTrack(kind);
  };
  const deleteTrack = (id: string) => {
    const t = trackById(id);
    if (!t) return;
    const count = clipCountOnTrack(t);
    if (
      count > 0 &&
      !window.confirm(
        `Delete track ${trackTag(t)} "${t.name}" and its ${count} clip${count > 1 ? "s" : ""}?`,
      )
    )
      return;
    recordSnapshot();
    if (count > 0) {
      if (t.kind === "voice") {
        removeAudioFromSequence();
      } else if (t.kind === "subtitle") {
        setCues((cs) => cs.filter((c) => resolveTrackId("subtitle", c.track_id) !== id));
      } else {
        setCues((cs) =>
          cs.map((c) => {
            const vp = c.visual_plan;
            if (!vp) return c;
            if (t.kind === "motion" && resolveTrackId("motion", vp.motion_track_id) === id)
              return { ...c, visual_plan: { ...vp, motion_graphic: "none" } };
            if (t.kind === "sfx" && resolveTrackId("sfx", vp.sfx_track_id) === id)
              return { ...c, visual_plan: { ...vp, sfx_trigger: "none" } };
            if (t.kind === "broll" && resolveTrackId("broll", vp.broll_track_id) === id)
              return {
                ...c,
                broll_preview_url: undefined,
                broll_clip_path: undefined,
                visual_plan: { ...vp, broll_query: "" },
              };
            return c;
          }),
        );
      }
    }
    setTracks((ts) => ts.filter((x) => x.id !== id));
    if (voiceTrackId === id) {
      setVoiceTrackId(tracks.find((x) => x.kind === "voice" && x.id !== id)?.id || "");
    }
    setHasUnsavedChanges(true);
    notify(`Deleted track ${trackTag(t)} "${t.name}"`);
  };
  const deleteEmptyTracks = () => {
    const empty = tracks.filter((t) => clipCountOnTrack(t) === 0);
    if (!empty.length) return notify("No empty tracks to delete.");
    const emptyIds = new Set(empty.map((t) => t.id));
    setTracks((ts) => ts.filter((t) => !emptyIds.has(t.id)));
    if (emptyIds.has(voiceTrackId)) setVoiceTrackId("");
    setHasUnsavedChanges(true);
    notify(`Deleted ${empty.length} empty track${empty.length > 1 ? "s" : ""}`);
  };
  const resizeTracks = (filter: (t: SequenceTrack) => boolean, delta: number) => {
    setTracks((ts) =>
      ts.map((t) =>
        filter(t)
          ? { ...t, height: Math.max(TRACK_MIN_H, Math.min(TRACK_MAX_H, t.height + delta)) }
          : t,
      ),
    );
  };
  const startTrackHeightDrag = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const t = trackById(id);
    if (!t) return;
    const startY = e.clientY;
    const initH = t.height;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "ns-resize";
    const onMove = (ev: PointerEvent) => {
      const h = Math.max(TRACK_MIN_H, Math.min(TRACK_MAX_H, initH + (ev.clientY - startY)));
      setTracks((ts) => ts.map((x) => (x.id === id ? { ...x, height: Math.round(h) } : x)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setHasUnsavedChanges(true);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  /** Drag a track header grip onto another track of the same family (video/audio) to reorder. */
  const startTrackReorder = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const src = trackById(id);
    if (!src) return;
    document.body.style.cursor = "grabbing";
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      const row = document
        .elementFromPoint(ev.clientX, ev.clientY)
        ?.closest("[data-row-track-id]") as HTMLElement | null;
      const dropId = row?.dataset.rowTrackId;
      if (!dropId || dropId === id) return;
      setTracks((ts) => {
        const from = ts.findIndex((t) => t.id === id);
        const to = ts.findIndex((t) => t.id === dropId);
        if (from < 0 || to < 0) return ts;
        if (isVideoKind(ts[from].kind) !== isVideoKind(ts[to].kind)) return ts;
        const next = [...ts];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
      setHasUnsavedChanges(true);
    };
    window.addEventListener("pointerup", onUp);
  };
  /** Finds an unlocked track of `kind` under the pointer (for dragging clips across tracks). */
  const findDropTrack = (clientX: number, clientY: number, kind: TrackKind): string | null => {
    const el = document
      .elementFromPoint(clientX, clientY)
      ?.closest("[data-track-id]") as HTMLElement | null;
    if (!el || el.dataset.trackKind !== kind) return null;
    const t = tracks.find((x) => x.id === el.dataset.trackId);
    return t && !t.locked ? t.id : null;
  };
  const contentDuration = Math.max(...cues.map((c) => c.end), audioDuration, 1);
  const duration =
    dragLockDuration ??
    Math.max(contentDuration + (audioDuration > 0 ? 1.5 : 5), customSeqDuration, 10);
  const cueIndex = cues.findIndex(
    (c) => time >= c.start && time < c.end && cueSubtitleVisible(c),
  );
  const targetCueIndex = cueIndex >= 0 ? cueIndex : Math.min(selectedCue, cues.length - 1);
  const currentCue = cues[cueIndex];
  const words = currentCue?.text.trim().split(/\s+/).filter(Boolean) || [];
  const activeWord = getProportionalActiveWord(currentCue, time);
  const captionLines: { word: string; globalIndex: number }[][] = (() => {
    if (!currentCue || !words.length) return [];
    const wpl = Math.max(1, aiSettings.wordsPerLine || 4);
    const ml = Math.max(1, aiSettings.maxLines || 1);
    if (currentCue.text.includes("\n")) {
      const rawRows = currentCue.text
        .split(/\r?\n/)
        .map((r) => r.trim().split(/\s+/).filter(Boolean))
        .filter((r) => r.length > 0);
      if (rawRows.length > 0) {
        let gIdx = 0;
        return rawRows.map((row) =>
          row.map((word) => ({ word, globalIndex: gIdx++ })),
        );
      }
    }
    if (ml > 1 && words.length > wpl) {
      const rows: { word: string; globalIndex: number }[][] = [];
      for (let i = 0; i < words.length; i += wpl) {
        rows.push(
          words.slice(i, i + wpl).map((word, offset) => ({
            word,
            globalIndex: i + offset,
          })),
        );
      }
      if (rows.length > ml) {
        return [
          ...rows.slice(0, ml - 1),
          rows.slice(ml - 1).flat(),
        ];
      }
      return rows;
    }
    return [words.map((word, idx) => ({ word, globalIndex: idx }))];
  })();
  useEffect(() => {
    if (cueIndex >= 0) setSelectedCue(cueIndex);
  }, [cueIndex]);
  useEffect(() => {
    let active = true;
    fetch(`${API_BASE}/api/health`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(
        (info: {
          ai?: {
            transcription?: string;
            alignment?: string;
            director?: string;
            broll_providers?: string[];
          };
          ai_engines?: {
            groq?: boolean;
            gemini?: boolean;
            unsplash?: boolean;
            pixabay?: boolean;
            broll_providers?: string[];
          };
        }) => {
          if (!active) return;
          setBackendOnline(true);
          if (info.ai_engines) {
            setAiEngineInfo({
              groq: info.ai_engines.groq,
              gemini: info.ai_engines.gemini,
              unsplash: info.ai_engines.unsplash,
              pixabay: info.ai_engines.pixabay,
              brollProviders: info.ai_engines.broll_providers,
            });
          } else if (info.ai) {
            const providers = info.ai.broll_providers || [];
            setAiEngineInfo({
              groq: Boolean(info.ai.transcription?.startsWith("groq:")),
              gemini: Boolean(info.ai.alignment?.startsWith("gemini:")),
              unsplash: providers.includes("unsplash"),
              pixabay: providers.includes("pixabay"),
              brollProviders: providers,
            });
          }
        },
      )
      .catch(() => {});
    fetch(`${API_BASE}/api/fonts`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { custom?: { key: string; display_name: string }[] }) => {
        if (!active) return;
        setBackendOnline(true);
        if (data.custom?.length && !customFontKey) {
          setCustomFont(data.custom[0].display_name);
          setCustomFontKey(data.custom[0].key);
        }
      })
      .catch(() => {
        if (active) setBackendOnline(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useLayoutEffect(() => {
    const line = captionRef.current;
    const preview = previewRef.current;
    if (!line || !preview) return;
    const fit = () => setCaptionScale(Math.min(1, (preview.clientWidth - 28) / Math.max(1, line.scrollWidth)));
    const observer = new ResizeObserver(fit);
    observer.observe(line);
    observer.observe(preview);
    fit();
    void document.fonts.ready.then(fit);
    return () => observer.disconnect();
  }, [currentCue?.text, style, font]);

  useLayoutEffect(() => {
    const lineEl = captionRef.current;
    const previewEl = previewRef.current;
    const wordEl = wordSpanRefs.current[activeWord];
    if (!lineEl || !previewEl || !wordEl || cueIndex < 0 || !words.length) {
      setHighlightBoxRect(null);
      prevCueIndexRef.current = cueIndex;
      return;
    }
    const updateBox = () => {
      const targetWordEl = wordSpanRefs.current[activeWord];
      if (!targetWordEl || !previewRef.current) return;
      const scalePx = previewRef.current.clientWidth / 1080;
      const padXPx = style.padX * scalePx;
      const padYPx = style.padY * scalePx * 0.45;
      const sameCue = prevCueIndexRef.current === cueIndex;
      prevCueIndexRef.current = cueIndex;
      setHighlightBoxRect({
        x: targetWordEl.offsetLeft - padXPx,
        y: targetWordEl.offsetTop - padYPx,
        w: targetWordEl.offsetWidth + padXPx * 2,
        h: targetWordEl.offsetHeight + padYPx * 2,
        animate: sameCue,
      });
    };
    updateBox();
    void document.fonts.ready.then(updateBox);
  }, [
    cueIndex,
    activeWord,
    currentCue?.text,
    words.length,
    style.padX,
    style.padY,
    style.size,
    font,
    captionScale,
    zoom,
  ]);
  const notify = (message: string) => setToast(message);
  const recordSnapshot = () => {
    setHistory((h) => [
      ...h.slice(-49),
      { style: { ...style }, cues: cues.map((c) => ({ ...c })) },
    ]);
    setFuture([]);
  };
  const update = <K extends keyof Style>(key: K, value: Style[K]) => {
    recordSnapshot();
    setStyle((s) => ({ ...s, [key]: value }));
  };
  const seek = (value: number) => {
    const next = Math.min(duration, Math.max(0, Number(value.toFixed(4))));
    setTime(next);
    if (audioRef.current) {
      try {
        audioRef.current.currentTime = next;
      } catch {}
    }
  };
  const snapTime = (
    rawTime: number,
    ignoreIndex = -1,
    bypassSnap = false,
    activeDur = duration,
  ): number => {
    const clamped = Math.max(0, rawTime);
    if (!snapEnabled || bypassSnap) return Number(clamped.toFixed(3));
    const trackWidth = tracksRef.current?.getBoundingClientRect().width || 800;
    // 7 pixels of magnetic snap radius
    const threshold = (7 / trackWidth) * activeDur;
    const candidates = [0, time];
    if (audioDuration > 0) candidates.push(audioDuration);
    if (inPoint !== null) candidates.push(inPoint);
    if (outPoint !== null) candidates.push(outPoint);
    cues.forEach((c, idx) => {
      if (idx !== ignoreIndex) candidates.push(c.start, c.end);
    });
    let best = clamped;
    let bestDist = threshold;
    for (const pt of candidates) {
      const d = Math.abs(clamped - pt);
      if (d < bestDist) {
        bestDist = d;
        best = pt;
      }
    }
    return Number(best.toFixed(3));
  };
  const splitCueAtPlayhead = () => {
    const idx = cueIndex;
    if (idx < 0) return notify("Move playhead inside a subtitle cue to split (Ctrl+K).");
    const cue = cues[idx];
    if (time - cue.start < 0.1 || cue.end - time < 0.1)
      return notify("Playhead is too close to the cue edge to split.");
    const timings = getWordTimings(cue);
    let splitWordIdx = timings.findIndex((w) => time < (w.start + w.end) / 2);
    if (splitWordIdx <= 0) splitWordIdx = 1;
    if (splitWordIdx >= timings.length) splitWordIdx = timings.length - 1;
    const list = cue.text.trim().split(/\s+/).filter(Boolean);
    const firstText = list.slice(0, splitWordIdx).join(" ") || cue.text;
    const secondText = list.slice(splitWordIdx).join(" ") || cue.text;
    const cut = Number(time.toFixed(2));
    recordSnapshot();
    setCues((cs) => [
      ...cs.slice(0, idx),
      { start: cue.start, end: cut, text: firstText },
      { start: cut, end: cue.end, text: secondText },
      ...cs.slice(idx + 1),
    ]);
    setSelectedCue(idx + 1);
    notify(`Split cue #${idx + 1} at ${stamp(cut)}`);
  };
  const insertCueAtPlayhead = () => {
    const start = Number(time.toFixed(2));
    const nextCue = cues.find((c) => c.start > start + 0.05);
    const maxEnd = nextCue ? Math.max(start + 0.3, nextCue.start) : start + 1.8;
    const end = Number(Math.min(start + 1.5, maxEnd).toFixed(2));
    recordSnapshot();
    const nextList = [...cues, { start, end, text: "عنوان جديد" }].sort((a, b) => a.start - b.start);
    const newIdx = nextList.findIndex((c) => c.start === start && c.end === end);
    setCues(nextList);
    if (newIdx >= 0) {
      setSelectedCue(newIdx);
      setTimeout(() => cueTextRefs.current[newIdx]?.focus(), 30);
    }
    notify(`Inserted new cue at ${stamp(start)}`);
  };
  const selectAllCues = () => {
    if (!cues.length) return notify("No subtitle cues to select.");
    const all = cues.map((_, i) => i);
    setSelectedCues(all);
    setSelectedCue(0);
    notify(`Selected all ${cues.length} subtitle cues (press Del to remove all)`);
  };
  const clearAllCues = () => {
    if (!cues.length) return notify("Subtitles are already empty.");
    const count = cues.length;
    recordSnapshot();
    setCues([]);
    setSelectedCues([]);
    setSelectedCue(0);
    setHasUnsavedChanges(true);
    notify(`Cleared all ${count} subtitle cues (Ctrl+Z to undo).`);
  };
  const deleteSelectedCue = (ripple: boolean) => {
    if (!cues.length) return notify("No subtitle cues to delete.");
    const targets =
      selectedCues.length > 0
        ? Array.from(new Set(selectedCues)).filter((i) => i >= 0 && i < cues.length)
        : targetCueIndex >= 0 && targetCueIndex < cues.length
          ? [targetCueIndex]
          : [];
    if (!targets.length) return notify("Select one or more subtitle cues to delete.");

    const targetSet = new Set(targets);
    recordSnapshot();

    if (targets.length === 1) {
      const idx = targets[0];
      const target = cues[idx];
      const span = target ? target.end - target.start : 0;
      const nextList = cues
        .filter((_, i) => i !== idx)
        .map((c, i) =>
          ripple && i >= idx
            ? {
                ...c,
                start: Number(Math.max(0, c.start - span).toFixed(2)),
                end: Number(Math.max(0.1, c.end - span).toFixed(2)),
              }
            : c,
        );
      setCues(nextList);
      const nextSel = nextList.length ? Math.max(0, Math.min(idx, nextList.length - 1)) : 0;
      setSelectedCue(nextSel);
      setSelectedCues(nextList.length ? [nextSel] : []);
      setHasUnsavedChanges(true);
      notify(
        nextList.length === 0
          ? "Deleted last cue — timeline is now empty (press N or + Cue to add)"
          : ripple
            ? `Ripple deleted cue #${idx + 1}`
            : `Deleted cue #${idx + 1}`,
      );
      return;
    }

    // Multi-cue deletion (or all cues deleted)
    const remaining = cues.filter((_, i) => !targetSet.has(i));
    setCues(remaining);
    const nextSel = remaining.length ? 0 : 0;
    setSelectedCue(nextSel);
    setSelectedCues(remaining.length ? [0] : []);
    setHasUnsavedChanges(true);
    notify(
      remaining.length === 0
        ? `Removed all ${targets.length} subtitle cues (Ctrl+Z to undo)`
        : `Deleted ${targets.length} selected subtitle cues`,
    );
  };
  const extendCueToPlayhead = () => {
    const idx = targetCueIndex;
    const cue = cues[idx];
    if (!cue) return;
    recordSnapshot();
    setCues((cs) =>
      cs.map((c, i) => {
        if (i !== idx) return c;
        if (time < c.start) return { ...c, start: Number(time.toFixed(2)) };
        if (time > c.end) return { ...c, end: Number(time.toFixed(2)) };
        const distStart = Math.abs(time - c.start);
        const distEnd = Math.abs(c.end - time);
        return distStart < distEnd
          ? { ...c, start: Number(Math.min(c.end - 0.15, time).toFixed(2)) }
          : { ...c, end: Number(Math.max(c.start + 0.15, time).toFixed(2)) };
      }),
    );
    notify(`Extended cue #${idx + 1} to playhead`);
  };
  const mergeWithNextCue = () => {
    const idx = targetCueIndex;
    if (idx < 0 || idx >= cues.length - 1) return notify("Select a cue that has a following cue to merge.");
    recordSnapshot();
    setCues((cs) => [
      ...cs.slice(0, idx),
      {
        start: cs[idx].start,
        end: cs[idx + 1].end,
        text: `${cs[idx].text.trim()} ${cs[idx + 1].text.trim()}`.trim(),
      },
      ...cs.slice(idx + 2),
    ]);
    notify(`Merged cue #${idx + 1} & #${idx + 2}`);
  };
  const nudgeSelectedCue = (delta: number, trimOut = false) => {
    const activeTargets =
      selectedCues.length > 0 ? new Set(selectedCues) : new Set([targetCueIndex]);
    if (!cues.some((_, i) => activeTargets.has(i))) return;
    recordSnapshot();
    setCues((cs) =>
      cs.map((c, i) => {
        if (!activeTargets.has(i)) return c;
        if (trimOut) {
          return { ...c, end: Number(Math.max(c.start + 0.15, c.end + delta).toFixed(2)) };
        }
        const len = c.end - c.start;
        const nextStart = Math.max(0, c.start + delta);
        return {
          ...c,
          start: Number(nextStart.toFixed(2)),
          end: Number((nextStart + len).toFixed(2)),
        };
      }),
    );
  };
  const jumpEditPoint = (dir: -1 | 1) => {
    const eps = 0.015;
    const points = Array.from(new Set([0, ...cues.flatMap((c) => [c.start, c.end]), duration])).sort(
      (a, b) => a - b,
    );
    if (dir > 0) {
      const next = points.find((p) => p > time + eps) ?? duration;
      seek(next);
    } else {
      const prev = [...points].reverse().find((p) => p < time - eps) ?? 0;
      seek(prev);
    }
  };
  const stepWord = (dir: -1 | 1) => {
    const cue = currentCue || cues[targetCueIndex];
    if (!cue) return;
    const timings = getWordTimings(cue);
    if (!timings.length) return;
    const currentIdx = getProportionalActiveWord(cue, time);
    const nextIdx = Math.max(0, Math.min(timings.length - 1, currentIdx + dir));
    seek(timings[nextIdx].start + 0.005);
  };
  const exportSrtFile = () => {
    const blob = new Blob([cuesToSrt(cues)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = srtName || "medsub-captions.srt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    notify("Exported edited .srt subtitle file.");
  };
  useEffect(() => {
    if (toast) {
      const id = setTimeout(() => setToast(""), 4000);
      return () => clearTimeout(id);
    }
  }, [toast]);
  useEffect(() => {
    if (!audioFile) return;
    const url = URL.createObjectURL(audioFile);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [audioFile]);
  useEffect(() => {
    if (!playing) {
      audioRef.current?.pause();
      return;
    }
    if (audioRef.current) {
      if (shuttleRate > 0) {
        audioRef.current.playbackRate = Math.min(4, Math.max(0.25, shuttleRate));
        audioRef.current.play().catch(() => notify("Audio could not play. Check the uploaded file."));
      } else {
        audioRef.current.pause();
      }
    }
    let previous = performance.now();
    let rafId = 0;
    const tick = (now: number) => {
      const delta = ((now - previous) / 1000) * shuttleRate;
      previous = now;
      setTime((t) => {
        const audioEl = audioRef.current;
        const useAudioClock =
          Boolean(audioUrl) &&
          audioEl &&
          !audioEl.paused &&
          shuttleRate > 0 &&
          Number.isFinite(audioEl.currentTime);
        const next = useAudioClock ? audioEl!.currentTime : t + delta;
        const loopStart =
          inPoint !== null && outPoint !== null && outPoint > inPoint
            ? inPoint
            : loopEnabled && cues[targetCueIndex]
              ? cues[targetCueIndex].start
              : 0;
        const loopEnd =
          inPoint !== null && outPoint !== null && outPoint > inPoint
            ? outPoint
            : loopEnabled && cues[targetCueIndex]
              ? cues[targetCueIndex].end
              : duration;
        if (loopEnabled && shuttleRate > 0 && next >= loopEnd) {
          if (audioRef.current) audioRef.current.currentTime = loopStart;
          return loopStart;
        }
        if (next >= duration) {
          if (loopEnabled) {
            if (audioRef.current) audioRef.current.currentTime = loopStart;
            return loopStart;
          }
          setPlaying(false);
          setShuttleRate(1);
          return duration;
        }
        if (next <= 0) {
          setPlaying(false);
          setShuttleRate(1);
          return 0;
        }
        return next;
      });
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [playing, shuttleRate, duration, audioUrl, loopEnabled, inPoint, outPoint, targetCueIndex]);
  useEffect(() => {
    const scroller = timelineScrollRef.current;
    if (!scroller || timelineZoom <= 1) return;
    const playheadX = (time / duration) * scroller.scrollWidth;
    const viewLeft = scroller.scrollLeft;
    const viewRight = viewLeft + scroller.clientWidth;
    if (playheadX < viewLeft + 40 || playheadX > viewRight - 40) {
      scroller.scrollLeft = Math.max(0, playheadX - scroller.clientWidth * 0.35);
    }
  }, [time, duration, timelineZoom]);
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inField = target.matches("input, textarea, select, [contenteditable]");
      if (e.key === "Escape") {
        if (inField) {
          target.blur();
          return;
        }
        if (modal && !rendering) {
          setModal(null);
          return;
        }
      }
      const mod = e.ctrlKey || e.metaKey;
      // Global Ctrl/Cmd shortcuts that work even when not inside text fields
      if (!inField && mod) {
        const k = e.key.toLowerCase();
        if (k === "a") {
          e.preventDefault();
          selectAllCues();
          return;
        }
        if (k === "s") {
          e.preventDefault();
          if (e.shiftKey) handleSaveProjectAs();
          else handleSaveProject();
          return;
        }
        if (k === "o") {
          e.preventDefault();
          handleOpenProject();
          return;
        }
        if (k === "n") {
          e.preventDefault();
          setShowNewProjectModal(true);
          return;
        }
        if (k === "z" && !e.shiftKey) {
          e.preventDefault();
          undo();
          return;
        }
        if ((k === "z" && e.shiftKey) || k === "y") {
          e.preventDefault();
          redo();
          return;
        }
        if (k === "k") {
          e.preventDefault();
          splitCueAtPlayhead();
          return;
        }
        if (k === "j") {
          e.preventDefault();
          mergeWithNextCue();
          return;
        }
        if (k === "l") {
          e.preventDefault();
          setLoopEnabled((v) => {
            notify(!v ? "Loop playback enabled (Ctrl+L)" : "Loop playback disabled");
            return !v;
          });
          return;
        }
        if (k === "x" && e.shiftKey) {
          e.preventDefault();
          setInPoint(null);
          setOutPoint(null);
          notify("Cleared In & Out points");
          return;
        }
        if (k === "i") {
          e.preventDefault();
          srtInput.current?.click();
          return;
        }
        if (k === "s" && e.shiftKey) {
          e.preventDefault();
          exportSrtFile();
          return;
        }
        if (k === "m") {
          e.preventDefault();
          if (!rendering) setModal("export");
          return;
        }
        if (e.key === "/") {
          e.preventDefault();
          setModal((m) => (m === "help" ? null : "help"));
          return;
        }
      }
      if (inField || modal) return;

      // Alt + Arrow: Nudge cue timing (or Ctrl+Alt+Arrow to trim Out point)
      if (e.altKey && (e.code === "ArrowLeft" || e.code === "ArrowRight")) {
        e.preventDefault();
        const dir = e.code === "ArrowRight" ? 1 : -1;
        const step = e.shiftKey ? 0.25 : 0.05;
        nudgeSelectedCue(dir * step, mod);
        return;
      }

      // Transport & J-K-L Shuttle
      if (e.code === "Space") {
        e.preventDefault();
        setShuttleRate(1);
        if (time >= duration) seek(0);
        setPlaying((p) => !p);
        return;
      }
      if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        if (e.shiftKey) {
          seek(Math.max(0, time - 2));
          setShuttleRate(1);
          setPlaying(true);
          notify("Play around playhead (-2s)");
        } else {
          setPlaying(false);
          setShuttleRate(1);
        }
        return;
      }
      if (e.key === "l" || e.key === "L") {
        e.preventDefault();
        if (e.shiftKey) {
          setShuttleRate(0.5);
          setPlaying(true);
        } else if (!playing || shuttleRate < 0) {
          setShuttleRate(1);
          if (time >= duration) seek(0);
          setPlaying(true);
        } else {
          const speeds = [1, 1.5, 2, 4];
          const nextIdx = Math.min(speeds.length - 1, speeds.indexOf(shuttleRate) + 1);
          setShuttleRate(speeds[nextIdx] ?? 2);
        }
        return;
      }
      if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        if (!playing || shuttleRate > 0) {
          setShuttleRate(-1);
          setPlaying(true);
        } else {
          const speeds = [-1, -2, -4];
          const nextIdx = Math.min(speeds.length - 1, speeds.indexOf(shuttleRate) + 1);
          setShuttleRate(speeds[nextIdx] ?? -2);
        }
        return;
      }
      if (e.code === "Home") {
        e.preventDefault();
        seek(0);
        return;
      }
      if (e.code === "End") {
        e.preventDefault();
        seek(duration);
        return;
      }

      // Frame & Edit-Point Navigation
      if (e.code === "ArrowLeft") {
        e.preventDefault();
        setPlaying(false);
        seek(time - (e.shiftKey ? 5 / 60 : 1 / 60));
        return;
      }
      if (e.code === "ArrowRight") {
        e.preventDefault();
        setPlaying(false);
        seek(time + (e.shiftKey ? 5 / 60 : 1 / 60));
        return;
      }
      if (e.code === "ArrowUp") {
        e.preventDefault();
        jumpEditPoint(-1);
        return;
      }
      if (e.code === "ArrowDown") {
        e.preventDefault();
        jumpEditPoint(1);
        return;
      }
      if (e.key === "[" || e.key === ";") {
        e.preventDefault();
        stepWord(-1);
        return;
      }
      if (e.key === "]" || e.key === "'") {
        e.preventDefault();
        stepWord(1);
        return;
      }

      // Sequence Editing (Razor, Insert, Delete, Ripple Delete, Extend)
      if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        splitCueAtPlayhead();
        return;
      }
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        insertCueAtPlayhead();
        return;
      }
      if (e.code === "Delete" || e.code === "Backspace") {
        e.preventDefault();
        deleteSelectedCue(e.shiftKey);
        return;
      }
      if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        extendCueToPlayhead();
        return;
      }

      // In / Out Points, Snap & Timeline Zoom / Track Resizing (Premiere Pro shortcuts)
      if (e.key === "i" || e.key === "I") {
        e.preventDefault();
        const pt = Number(time.toFixed(2));
        setInPoint(pt);
        if (outPoint !== null && outPoint <= pt) setOutPoint(null);
        notify(`Marked In point at ${stamp(pt)}`);
        return;
      }
      if (e.key === "o" || e.key === "O") {
        e.preventDefault();
        const pt = Number(time.toFixed(2));
        setOutPoint(pt);
        if (inPoint !== null && inPoint >= pt) setInPoint(null);
        notify(`Marked Out point at ${stamp(pt)}`);
        return;
      }
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        setSnapEnabled((v) => {
          notify(!v ? "Timeline snapping ON (S)" : "Timeline snapping OFF");
          return !v;
        });
        return;
      }
      // Track Height Expansion / Collapse (Premiere Pro Shift/Ctrl/Alt + Plus/Minus)
      if (e.shiftKey && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        resizeTracks(() => true, 12);
        notify("Expanded all tracks height (Shift+=)");
        return;
      }
      if (e.shiftKey && (e.key === "-" || e.key === "_")) {
        e.preventDefault();
        resizeTracks(() => true, -12);
        notify("Collapsed all tracks height (Shift+-)");
        return;
      }
      if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        resizeTracks((t) => isVideoKind(t.kind), 12);
        notify("Expanded video tracks height (Ctrl+=)");
        return;
      }
      if (mod && (e.key === "-" || e.key === "_")) {
        e.preventDefault();
        resizeTracks((t) => isVideoKind(t.kind), -12);
        notify("Collapsed video tracks height (Ctrl+-)");
        return;
      }
      if (e.altKey && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        resizeTracks((t) => !isVideoKind(t.kind), 12);
        notify("Expanded audio tracks height (Alt+=)");
        return;
      }
      if (e.altKey && (e.key === "-" || e.key === "_")) {
        e.preventDefault();
        resizeTracks((t) => !isVideoKind(t.kind), -12);
        notify("Collapsed audio tracks height (Alt+-)");
        return;
      }
      // Horizontal Timeline Zoom
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        setTimelineZoom((z) => Math.min(8, Number((z * 1.4).toFixed(2))));
        return;
      }
      if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        setTimelineZoom((z) => Math.max(1, Number((z / 1.4).toFixed(2))));
        return;
      }
      if (e.key === "\\") {
        e.preventDefault();
        setTimelineZoom(1);
        notify("Timeline zoom fit to sequence (\\)");
        return;
      }

      // Monitor, Transcript & Help
      if (e.key === "`" || e.key === "~") {
        e.preventDefault();
        if (document.fullscreenElement) void document.exitFullscreen();
        else void previewRef.current?.requestFullscreen().catch(() => {});
        return;
      }
      if (e.key === "t" || e.key === "T" || e.code === "Enter") {
        e.preventDefault();
        const el = cueTextRefs.current[targetCueIndex];
        if (el) {
          el.focus();
          el.select();
        }
        return;
      }
      if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        setMuted((v) => !v);
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        setModal("help");
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });
  const updateAISetting = <K extends keyof AISettingsConfig>(
    key: K,
    value: AISettingsConfig[K],
  ) => {
    setAiSettings((prev) => ({ ...prev, [key]: value }));
    setHasUnsavedChanges(true);
  };
  const updateCaptionLayout = (nextWordsPerLine: number, nextMaxLines: number) => {
    const wpl = Math.max(1, Math.min(6, nextWordsPerLine));
    const ml = Math.max(1, Math.min(2, nextMaxLines));
    setAiSettings((prev) => ({
      ...prev,
      wordsPerLine: wpl,
      maxLines: ml,
    }));
    if (cues.length > 0) {
      recordSnapshot();
      const rechunked = rechunkCuesByLayout(cues, wpl, ml);
      setCues(rechunked);
      setSelectedCue((prev) => Math.max(0, Math.min(prev, Math.max(0, rechunked.length - 1))));
      setSelectedCues([0]);
      notify(
        `Layout updated: ${wpl} word${wpl > 1 ? "s" : ""}/line × ${ml} line${ml > 1 ? "s" : ""} (${rechunked.length} cues)`,
      );
    }
    setHasUnsavedChanges(true);
  };
  /** Box color scope: "selected" edits only chosen captions, "all" edits every caption. */
  const [boxScope, setBoxScope] = useState<"selected" | "all">("selected");
  const boxTargets = (): number[] =>
    selectedCues.length
      ? selectedCues
      : [selectedCue >= 0 && selectedCue < cues.length ? selectedCue : Math.max(0, cueIndex)];
  const applyBoxColor = (hex: string | null) => {
    recordSnapshot();
    if (boxScope === "all") {
      if (hex) update("box", hex);
      setCues((prev) =>
        prev.map((c) => {
          if (!c.visual_plan?.highlight_color_override) return c;
          const { highlight_color_override: _drop, ...rest } = c.visual_plan;
          return { ...c, visual_plan: rest as VisualCuePlan };
        }),
      );
    } else {
      const targets = new Set(boxTargets());
      setCues((prev) =>
        prev.map((c, idx) => {
          if (!targets.has(idx)) return c;
          const plan: VisualCuePlan = c.visual_plan || {
            cue_index: idx,
            emphasis_type: "normal",
            emoji_or_icon: "",
            broll_query: "",
            motion_graphic: "none",
            graphic_text: "",
            sfx_trigger: "none",
          };
          const next = { ...plan };
          if (hex) next.highlight_color_override = hex;
          else delete next.highlight_color_override;
          return { ...c, visual_plan: next };
        }),
      );
    }
    setHasUnsavedChanges(true);
  };
  const boxShownColor = (): string => {
    if (boxScope === "all") return style.box;
    return cues[boxTargets()[0]]?.visual_plan?.highlight_color_override || style.box;
  };
  const updateCueVisualPlan = (    cueIdx: number,
    patch: Partial<VisualCuePlan>,
  ) => {
    recordSnapshot();
    setCues((prev) =>
      prev.map((c, idx) => {
        if (idx !== cueIdx) return c;
        const currentPlan: VisualCuePlan = c.visual_plan || {
          cue_index: idx,
          emphasis_type: "normal",
          emoji_or_icon: "🔥",
          broll_query: "",
          motion_graphic: "none",
          graphic_text: "",
          sfx_trigger: "none",
        };
        return {
          ...c,
          visual_plan: { ...currentPlan, ...patch },
        };
      }),
    );
    setHasUnsavedChanges(true);
  };
  const autoTranscribeAudio = async (
    customFile?: File,
    customLang?: TargetLanguage,
  ) => {
    const targetFile = customFile || audioFile;
    const lang = customLang || aiSettings.targetLanguage;
    const wpl = aiSettings.wordsPerLine || 4;
    const ml = aiSettings.maxLines || 1;
    if (!targetFile) {
      notify("Upload an audio file (.wav/.mp3/.m4a) first, or click Upload Audio.");
      audioInput.current?.click();
      return;
    }
    setTranscribing(true);
    notify(`✨ AI Transcribing & Directing (${wpl} words/line × ${ml} line${ml > 1 ? "s" : ""})...`);
    try {
      const form = new FormData();
      form.append("audio_file", targetFile);
      form.append("target_language", lang);
      form.append("words_per_line", String(wpl));
      form.append("max_lines", String(ml));
      form.append("generate_visual_plan", "true");
      const resp = await fetch(`${API_BASE}/api/transcribe-and-direct`, {
        method: "POST",
        body: form,
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.detail || `Transcription failed (${resp.status})`);
      }
      const data = (await resp.json()) as {
        cues: Cue[];
        srt_text?: string;
        target_language: TargetLanguage;
        engine_used?: string;
      };
      if (data.cues && data.cues.length > 0) {
        recordSnapshot();
        setCues(data.cues);
        setSrtName(`${targetFile.name.replace(/\.[^.]+$/, "")}_${lang}.srt`);
        setSelectedCue(0);
        seek(data.cues[0].start);
        setAiEngineInfo((prev) => ({ ...prev, lastEngineUsed: data.engine_used }));
        setHasUnsavedChanges(true);
        notify(
          `✨ Generated ${data.cues.length} cues + AI visual plan (${data.engine_used || "hybrid"})!`,
        );
      } else {
        notify("No spoken words detected in audio.");
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : "AI Transcription failed.");
    } finally {
      setTranscribing(false);
    }
  };
  const translateAllCues = async (customLang?: TargetLanguage) => {
    const lang = customLang || aiSettings.targetLanguage;
    const wpl = aiSettings.wordsPerLine || 4;
    const ml = aiSettings.maxLines || 1;
    if (!cues.length) return notify("No cues to translate.");
    setTranslating(true);
    notify(`🌐 Translating ${cues.length} cues to ${lang}...`);
    try {
      const resp = await fetch(`${API_BASE}/api/translate-cues`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cues,
          target_language: lang,
          words_per_line: wpl,
          max_lines: ml,
          direct_visuals: true,
        }),
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.detail || `Translation failed (${resp.status})`);
      }
      const data = (await resp.json()) as {
        cues: Cue[];
        target_language: TargetLanguage;
      };
      if (data.cues && data.cues.length > 0) {
        recordSnapshot();
        setCues(data.cues);
        setHasUnsavedChanges(true);
        notify(`🌐 Translated ${data.cues.length} cues while preserving exact timings!`);
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : "Cue translation failed.");
    } finally {
      setTranslating(false);
    }
  };
  const fetchBrollPack = async () => {
    if (!cues.length) return notify("No subtitle cues available for B-Roll.");
    setFetchingBroll(true);
    notify("🎬 Fetching 9:16 portrait B-Roll from Unsplash / Pixabay / Stock engines...");
    try {
      const resp = await fetch(`${API_BASE}/api/fetch-broll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cues }),
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.detail || `B-Roll fetch failed (${resp.status})`);
      }
      const data = (await resp.json()) as {
        clips: BrollClipInfo[];
        zip_download_url?: string;
        cues: Cue[];
      };
      if (data.cues && data.cues.length > 0) {
        recordSnapshot();
        setCues(data.cues);
      }
      if (data.zip_download_url) {
        setBrollZipUrl(`${API_BASE}${data.zip_download_url}`);
      }
      setAiSettings((prev) => ({ ...prev, enableBroll: true }));
      const providers = Array.from(
        new Set((data.clips || []).map((c) => c.provider).filter(Boolean)),
      ).join(", ");
      notify(
        `🎬 Ready! ${data.clips?.length || 0} portrait B-Roll clips fetched (${providers || "Multi-Stock"}).`,
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to fetch B-Roll pack.");
    } finally {
      setFetchingBroll(false);
    }
  };
  const uploadAudio = (file?: File) => {
    if (!file) return;
    if (!/\.(wav|mp3|m4a|ogg)$/i.test(file.name))
      return notify("Please choose a WAV, MP3, M4A, or OGG audio file.");
    setPlaying(false);
    setAudioDuration(0);
    setAudioFile(file);
    setVoiceClipRange({ start: 0, end: 15 });
    notify("Audio loaded onto Track A1! Click '✨ Auto-Transcribe & Direct' to generate captions.");
  };
  const removeAudioFromSequence = () => {
    setPlaying(false);
    setAudioFile(null);
    setAudioUrl("");
    setAudioDuration(0);
    setVoiceClipRange({ start: 0, end: 0 });
    if (audioInput.current) audioInput.current.value = "";
    notify("Removed Voice / Audio track from sequence.");
  };
  const addMotionAtPlayhead = () => {
    const idx = cueIndex >= 0 ? cueIndex : targetCueIndex;
    const motionTrackId = ensureTrack("motion", selectedTrackLayer);
    const mTag = trackById(motionTrackId) ? trackTag(trackById(motionTrackId)!) : "new track";
    if (cues[idx]) {
      const suggestions = getCaptionMotionSuggestions(cues[idx].text, idx);
      const best = suggestions[0];
      updateCueVisualPlan(idx, {
        motion_graphic: best.type,
        graphic_text: best.text,
        motion_start: cues[idx].start,
        motion_end: cues[idx].end,
        motion_track_id: motionTrackId,
      });
      setAiSettings((prev) => ({ ...prev, enableMotionGraphics: true }));
      setSelectedCue(idx);
      setSelectedTrackLayer(motionTrackId);
      setOpenMotionGalleryCue(idx);
      notify(`Added Motion "${best.text}" on Track ${mTag}`);
      return;
    }
    // If no cues exist yet, create a cue + motion at playhead
    const start = Number(time.toFixed(2));
    const end = Number((start + 2.0).toFixed(2));
    recordSnapshot();
    const newCue: Cue = {
      start,
      end,
      text: "عنوان جديد",
      visual_plan: {
        emphasis_type: "pop",
        emoji_or_icon: "🚀",
        broll_query: "",
        motion_graphic: "spotlight",
        graphic_text: "MVP 🚀",
        motion_start: start,
        motion_end: end,
        motion_track_id: motionTrackId,
        sfx_trigger: "none",
      },
    };
    setCues([newCue]);
    setAiSettings((prev) => ({ ...prev, enableMotionGraphics: true }));
    setSelectedCue(0);
    setSelectedTrackLayer(motionTrackId);
    setOpenMotionGalleryCue(0);
    notify(`Added Motion clip on Track ${mTag}`);
  };
  const addSfxAtPlayhead = (defaultSfx: SfxTriggerType = "whoosh") => {
    const idx = cueIndex >= 0 ? cueIndex : targetCueIndex;
    const sfxTrackId = ensureTrack("sfx", selectedTrackLayer);
    const sTag = trackById(sfxTrackId) ? trackTag(trackById(sfxTrackId)!) : "new track";
    if (cues[idx]) {
      const sStart = Number(cues[idx].start.toFixed(2));
      const sEnd = Number(Math.min(cues[idx].end, sStart + 0.65).toFixed(2));
      updateCueVisualPlan(idx, {
        sfx_trigger: defaultSfx,
        sfx_start: sStart,
        sfx_end: Math.max(sStart + 0.25, sEnd),
        sfx_track_id: sfxTrackId,
      });
      setAiSettings((prev) => ({ ...prev, enableSfx: true }));
      setSelectedCue(idx);
      setSelectedTrackLayer(sfxTrackId);
      playSfxPreview(defaultSfx, aiSettings.sfxVolumeDb);
      notify(`Added SFX "${defaultSfx.toUpperCase()}" on Track ${sTag}`);
      return;
    }
    const start = Number(time.toFixed(2));
    const end = Number((start + 1.5).toFixed(2));
    recordSnapshot();
    const newCue: Cue = {
      start,
      end,
      text: "عنوان جديد",
      visual_plan: {
        emphasis_type: "pop",
        emoji_or_icon: "🔊",
        broll_query: "",
        motion_graphic: "none",
        graphic_text: "",
        sfx_trigger: defaultSfx,
        sfx_start: start,
        sfx_end: Number((start + 0.65).toFixed(2)),
      },
    };
    setCues([newCue]);
    setAiSettings((prev) => ({ ...prev, enableSfx: true }));
    setSelectedCue(0);
    setSelectedTrackLayer(sfxTrackId);
    playSfxPreview(defaultSfx, aiSettings.sfxVolumeDb);
    notify(`Added SFX "${defaultSfx.toUpperCase()}" on Track ${sTag}`);
  };
  const startSubTrackClipDrag = (
    e: React.PointerEvent,
    index: number,
    kind: "motion" | "sfx",
    mode: "move" | "trim-start" | "trim-end",
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const trackEl = tracksRef.current;
    if (!trackEl || !cues[index]) return;
    const cue = cues[index];
    const vp = cue.visual_plan || {
      emphasis_type: "normal" as EmphasisType,
      emoji_or_icon: "",
      broll_query: "",
      motion_graphic: "none" as MotionGraphicType,
      graphic_text: "",
      sfx_trigger: "none" as SfxTriggerType,
    };
    const originTrackId = resolveTrackId(
      kind,
      kind === "motion" ? vp.motion_track_id : vp.sfx_track_id,
    );
    if (trackById(originTrackId)?.locked) return notify("Track is locked 🔒");
    recordSnapshot();
    setSelectedCue(index);
    setSelectedCues([index]);
    if (originTrackId) setSelectedTrackLayer(originTrackId);
    if (kind === "motion") setOpenMotionGalleryCue(index);

    const rect = trackEl.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const lockedDur = duration;
    const initStart =
      kind === "motion"
        ? (vp.motion_start ?? cue.start)
        : (vp.sfx_start ?? cue.start);
    const initEnd =
      kind === "motion"
        ? (vp.motion_end ?? cue.end)
        : (vp.sfx_end ?? Math.max(initStart + 0.35, Math.min(cue.end, initStart + 0.65)));
    const clipLen = Math.max(0.2, initEnd - initStart);
    let dropTrack: string | null = null;

    document.body.style.userSelect = "none";
    document.body.style.cursor = mode === "move" ? "grabbing" : "ew-resize";

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dt = (dx / Math.max(1, rect.width - TRACK_HEADER_W)) * lockedDur;
      let nextS = initStart;
      let nextE = initEnd;
      if (mode === "move") {
        nextS = Math.max(0, Number((initStart + dt).toFixed(2)));
        nextE = Number((nextS + clipLen).toFixed(2));
        if (Math.abs(ev.clientY - startY) > 6) {
          const target = findDropTrack(ev.clientX, ev.clientY, kind);
          dropTrack = target && target !== originTrackId ? target : null;
          setDropTargetTrackId(dropTrack);
        }
      } else if (mode === "trim-start") {
        nextS = Math.max(0, Math.min(initEnd - 0.18, Number((initStart + dt).toFixed(2))));
      } else {
        nextE = Math.max(initStart + 0.18, Number((initEnd + dt).toFixed(2)));
      }
      setCues((prev) =>
        prev.map((c, idx) => {
          if (idx !== index) return c;
          const curVp = c.visual_plan || vp;
          return {
            ...c,
            visual_plan:
              kind === "motion"
                ? { ...curVp, motion_start: nextS, motion_end: nextE }
                : { ...curVp, sfx_start: nextS, sfx_end: nextE },
          };
        }),
      );
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setDropTargetTrackId(null);
      if (dropTrack) {
        const target = dropTrack;
        setCues((prev) =>
          prev.map((c, idx) => {
            if (idx !== index || !c.visual_plan) return c;
            return {
              ...c,
              visual_plan:
                kind === "motion"
                  ? { ...c.visual_plan, motion_track_id: target }
                  : { ...c.visual_plan, sfx_track_id: target },
            };
          }),
        );
        setSelectedTrackLayer(target);
        const tt = trackById(target);
        if (tt) notify(`Moved clip to Track ${trackTag(tt)} · ${tt.name}`);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const startVoiceClipDrag = (
    e: React.PointerEvent,
    mode: "move" | "trim-start" | "trim-end",
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const trackEl = tracksRef.current;
    if (!trackEl) return;
    if (trackById(voiceTrackId)?.locked) return notify("Track is locked 🔒");
    setSelectedTrackLayer(voiceTrackId);
    const rect = trackEl.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const lockedDur = duration;
    const initStart = voiceClipRange.start;
    const initEnd = voiceClipRange.end > voiceClipRange.start ? voiceClipRange.end : Math.max(audioDuration, 5);
    const clipLen = Math.max(0.5, initEnd - initStart);
    let dropTrack: string | null = null;
    document.body.style.userSelect = "none";
    document.body.style.cursor = mode === "move" ? "grabbing" : "ew-resize";

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dt = (dx / Math.max(1, rect.width - TRACK_HEADER_W)) * lockedDur;
      if (mode === "move") {
        const s = Math.max(0, Number((initStart + dt).toFixed(2)));
        setVoiceClipRange({ start: s, end: Number((s + clipLen).toFixed(2)) });
        if (Math.abs(ev.clientY - startY) > 6) {
          const target = findDropTrack(ev.clientX, ev.clientY, "voice");
          dropTrack = target && target !== voiceTrackId ? target : null;
          setDropTargetTrackId(dropTrack);
        }
      } else if (mode === "trim-start") {
        const s = Math.max(0, Math.min(initEnd - 0.5, Number((initStart + dt).toFixed(2))));
        setVoiceClipRange({ start: s, end: initEnd });
      } else {
        const eEnd = Math.max(initStart + 0.5, Number((initEnd + dt).toFixed(2)));
        setVoiceClipRange({ start: initStart, end: eEnd });
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setDropTargetTrackId(null);
      if (dropTrack) {
        setVoiceTrackId(dropTrack);
        setSelectedTrackLayer(dropTrack);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const startMotionCanvasDrag = (
    e: React.PointerEvent,
    cueIdx: number,
    mode: "move" | "resize",
  ) => {
    if (e.button !== 0 || cueIdx < 0 || !cues[cueIdx]) return;
    e.stopPropagation();
    e.preventDefault();
    const previewEl = previewRef.current;
    if (!previewEl) return;
    recordSnapshot();
    const rect = previewEl.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const vp = cues[cueIdx].visual_plan;
    const initX = vp?.motion_x ?? 50;
    const initY = vp?.motion_y ?? 14;
    const initScale = vp?.motion_scale ?? 1;
    document.body.style.userSelect = "none";

    const onMove = (ev: PointerEvent) => {
      if (mode === "move") {
        const dxPct = ((ev.clientX - startX) / Math.max(1, rect.width)) * 100;
        const dyPct = ((ev.clientY - startY) / Math.max(1, rect.height)) * 100;
        updateCueVisualPlan(cueIdx, {
          motion_x: Math.round(Math.max(12, Math.min(88, initX + dxPct))),
          motion_y: Math.round(Math.max(8, Math.min(86, initY + dyPct))),
        });
      } else {
        const delta = (ev.clientX - startX + (ev.clientY - startY)) * 0.005;
        const nextScale = Number(Math.max(0.6, Math.min(1.8, initScale + delta)).toFixed(2));
        updateCueVisualPlan(cueIdx, { motion_scale: nextScale });
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const uploadSrt = async (file?: File) => {
    if (!file) return;
    const parsed = parseSrt(await file.text());
    if (!parsed.length)
      return notify("No valid subtitle cues found. Please upload a valid .srt file.");
    setCues(parsed);
    setSrtName(file.name);
    setTime(parsed[0].start);
    if (audioRef.current) audioRef.current.currentTime = parsed[0].start;
    notify(`${parsed.length} subtitle cues imported.`);
  };
  const uploadFont = async (file?: File) => {
    if (!file) return;
    if (!/\.(ttf|otf)$/i.test(file.name)) return notify("Please choose a .ttf or .otf font.");
    try {
      const face = new FontFace("CustomArabic", await file.arrayBuffer());
      document.fonts.add(await face.load());
      setCustomFont(file.name.replace(/\.[^.]+$/, ""));
      setCustomFontKey(file.name);
      setFont("CustomArabic");
      const form = new FormData();
      form.append("font_file", file);
      fetch(`${API_BASE}/api/upload-font`, { method: "POST", body: form })
        .then((r) => (r.ok ? r.json() : null))
        .then((info: { key?: string } | null) => {
          if (info?.key) {
            setCustomFontKey(info.key);
            setBackendOnline(true);
          }
        })
        .catch(() => {});
      notify("Custom font loaded.");
    } catch {
      notify("This font could not be loaded. Try another font file.");
    }
  };
  const undo = () => {
    if (!history.length) return;
    const prev = history[history.length - 1];
    setFuture((f) => [...f, { style: { ...style }, cues: cues.map((c) => ({ ...c })) }]);
    setStyle(prev.style);
    setCues(prev.cues);
    setHistory((h) => h.slice(0, -1));
  };
  const redo = () => {
    if (!future.length) return;
    const next = future[future.length - 1];
    setHistory((h) => [...h, { style: { ...style }, cues: cues.map((c) => ({ ...c })) }]);
    setStyle(next.style);
    setCues(next.cues);
    setFuture((f) => f.slice(0, -1));
  };
  const startCuePointerDrag = (
    e: React.PointerEvent,
    index: number,
    initialMode: "move" | "trim-start" | "trim-end",
    trackKind: "subtitle" | "broll" = "subtitle",
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const trackEl = tracksRef.current;
    if (!trackEl) return;
    const originTrackId =
      trackKind === "subtitle"
        ? resolveTrackId("subtitle", cues[index]?.track_id)
        : resolveTrackId("broll", cues[index]?.visual_plan?.broll_track_id);
    if (trackById(originTrackId)?.locked) return notify("Track is locked 🔒");
    if (originTrackId) setSelectedTrackLayer(originTrackId);
    const subTrackOf = (c?: Cue) => resolveTrackId("subtitle", c?.track_id);
    const originSubTrack = subTrackOf(cues[index]);

    // Handle Ctrl/Cmd toggle or Shift range multi-selection
    if (e.ctrlKey || e.metaKey) {
      setSelectedCue(index);
      setSelectedCues((prev) =>
        prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index],
      );
      return;
    }
    if (e.shiftKey) {
      const a = Math.min(selectedCue, index);
      const b = Math.max(selectedCue, index);
      const range = Array.from({ length: b - a + 1 }, (_, k) => a + k);
      setSelectedCue(index);
      setSelectedCues(range);
      return;
    }

    let mode = initialMode;
    if (mode === "move") {
      const blockEl = e.currentTarget as HTMLElement;
      const blockRect = blockEl.getBoundingClientRect();
      if (blockRect.width >= 28) {
        const offsetX = e.clientX - blockRect.left;
        if (offsetX <= 12) mode = "trim-start";
        else if (blockRect.width - offsetX <= 12) mode = "trim-end";
      }
    }

    const activeMulti =
      mode === "move" && selectedCues.includes(index) && selectedCues.length > 1
        ? [...selectedCues]
        : [index];
    setSelectedCue(index);
    setSelectedCues(activeMulti);

    const lockedDur = duration;
    setDragLockDuration(lockedDur);
    setDraggingCue(index);
    recordSnapshot();
    const rect = trackEl.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const initialCuesSnapshot = cues.map((c) => ({ ...c }));
    const initialCue = { ...cues[index] };
    const cueLen = Math.max(0.15, initialCue.end - initialCue.start);
    let moved = false;
    let maxReachedEnd = lockedDur;
    let dropTrack: string | null = null;

    document.body.style.userSelect = "none";
    document.body.style.cursor = mode === "move" ? "grabbing" : "ew-resize";

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (Math.abs(dx) > 2) moved = true;
      const dt = (dx / Math.max(1, rect.width - TRACK_HEADER_W)) * lockedDur;
      const bypassSnap = ev.altKey;
      if (mode === "move" && Math.abs(ev.clientY - startY) > 6) {
        moved = true;
        const target = findDropTrack(ev.clientX, ev.clientY, trackKind);
        dropTrack = target && target !== originTrackId ? target : null;
        setDropTargetTrackId(dropTrack);
      }

      setCues(() => {
        const nextCues = initialCuesSnapshot.map((c) => ({ ...c }));
        const target = nextCues[index];
        if (!target) return nextCues;

        if (mode === "move") {
          if (activeMulti.length > 1) {
            // Move all selected cues together in lockstep
            const minStart = Math.min(...activeMulti.map((idx) => initialCuesSnapshot[idx]?.start ?? 0));
            const clampedDt = Math.max(-minStart, dt);
            for (const idx of activeMulti) {
              const orig = initialCuesSnapshot[idx];
              if (!orig || !nextCues[idx]) continue;
              const len = Math.max(0.15, orig.end - orig.start);
              const s = Number((orig.start + clampedDt).toFixed(2));
              const eEnd = Number((s + len).toFixed(2));
              nextCues[idx].start = s;
              nextCues[idx].end = eEnd;
              if (eEnd + 3 > maxReachedEnd) maxReachedEnd = eEnd + 3;
            }
            return nextCues;
          }

          let nextStart = Math.max(0, initialCue.start + dt);
          const snappedStart = snapTime(nextStart, index, bypassSnap, lockedDur);
          const snappedEnd = snapTime(nextStart + cueLen, index, bypassSnap, lockedDur);
          if (Math.abs(snappedStart - nextStart) <= Math.abs(snappedEnd - (nextStart + cueLen))) {
            nextStart = snappedStart;
          } else {
            nextStart = Math.max(0, snappedEnd - cueLen);
          }
          const finalStart = Number(nextStart.toFixed(2));
          const finalEnd = Number((nextStart + cueLen).toFixed(2));
          target.start = finalStart;
          target.end = finalEnd;
          if (finalEnd + 3 > maxReachedEnd) maxReachedEnd = finalEnd + 3;
          return nextCues;
        }

        if (mode === "trim-start") {
          const rawStart = Math.max(0, Math.min(initialCue.end - 0.15, initialCue.start + dt));
          const nextStart = Math.min(
            initialCue.end - 0.15,
            snapTime(rawStart, index, bypassSnap, lockedDur),
          );
          target.start = Number(nextStart.toFixed(2));
          // If trimming start leftwards overlaps previous cue on the SAME track, gently trim it
          if (
            index > 0 &&
            subTrackOf(nextCues[index - 1]) === originSubTrack &&
            nextCues[index - 1].end > target.start
          ) {
            nextCues[index - 1].end = Math.max(
              nextCues[index - 1].start + 0.15,
              target.start,
            );
          }
          return nextCues;
        }

        // mode === "trim-end"
        const rawEnd = Math.max(initialCue.start + 0.15, initialCue.end + dt);
        const nextEnd = Math.max(
          initialCue.start + 0.15,
          snapTime(rawEnd, index, bypassSnap, lockedDur),
        );
        target.end = Number(nextEnd.toFixed(2));
        if (target.end + 3 > maxReachedEnd) maxReachedEnd = target.end + 3;

        // If extending end rightwards pushes into the next cue, push subsequent cues cleanly
        if (index < nextCues.length - 1 && nextCues[index + 1].start < target.end) {
          let pushEdge = target.end;
          for (let j = index + 1; j < nextCues.length; j++) {
            if (subTrackOf(nextCues[j]) !== originSubTrack) continue;
            const cLen = Math.max(0.15, nextCues[j].end - nextCues[j].start);
            if (nextCues[j].start < pushEdge) {
              nextCues[j].start = Number(pushEdge.toFixed(2));
              nextCues[j].end = Number((pushEdge + cLen).toFixed(2));
              pushEdge = nextCues[j].end;
            } else {
              break;
            }
          }
        }
        return nextCues;
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setDraggingCue(null);
      setDragLockDuration(null);
      setDropTargetTrackId(null);
      if (dropTrack) {
        const target = dropTrack;
        const movers = new Set(activeMulti);
        setCues((prev) =>
          prev.map((c, i) => {
            if (!movers.has(i)) return c;
            if (trackKind === "subtitle") return { ...c, track_id: target };
            return c.visual_plan
              ? { ...c, visual_plan: { ...c.visual_plan, broll_track_id: target } }
              : c;
          }),
        );
        setSelectedTrackLayer(target);
        const tt = trackById(target);
        if (tt)
          notify(
            `Moved ${movers.size} clip${movers.size > 1 ? "s" : ""} to Track ${trackTag(tt)} · ${tt.name}`,
          );
      }
      if (maxReachedEnd > customSeqDuration) {
        setCustomSeqDuration(Math.ceil(maxReachedEnd));
      }
      if (!moved) {
        if (activeMulti.length > 1) {
          setSelectedCues([index]);
        }
        seek(initialCue.start + 0.02);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const startWordTrackMarqueeDrag = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const trackEl = tracksRef.current;
    if (!trackEl) return;
    const rect = trackEl.getBoundingClientRect();
    const laneLeft = rect.left + 112;
    const laneWidth = Math.max(1, rect.width - 112);
    const startX = e.clientX;
    const startRatio = Math.max(0, Math.min(1, (startX - laneLeft) / laneWidth));
    let dragged = false;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "crosshair";

    const onMove = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - startX) > 3) dragged = true;
      if (!dragged) return;
      const curRatio = Math.max(0, Math.min(1, (ev.clientX - laneLeft) / laneWidth));
      const minR = Math.min(startRatio, curRatio);
      const maxR = Math.max(startRatio, curRatio);
      setMarqueeBox({
        leftPct: minR * 100,
        widthPct: Math.max(0.2, (maxR - minR) * 100),
      });
      const minTime = minR * duration;
      const maxTime = maxR * duration;
      const hits: number[] = [];
      cues.forEach((c, idx) => {
        if (c.end >= minTime && c.start <= maxTime) {
          hits.push(idx);
        }
      });
      setSelectedCues(hits);
      if (hits.length > 0) {
        setSelectedCue(hits[0]);
      }
    };

    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setMarqueeBox(null);
      if (!dragged) {
        const clickRatio = Math.max(
          0,
          Math.min(1, (ev.clientX - laneLeft) / laneWidth),
        );
        seek(clickRatio * duration);
        setSelectedCues([]);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const startCaptionCanvasDrag = (
    e: React.PointerEvent,
    mode: "move" | "resize",
    direction: "nw" | "ne" | "sw" | "se" = "se",
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const previewEl = previewRef.current;
    if (!previewEl) return;
    recordSnapshot();
    setDraggingCanvasCaption(true);
    const rect = previewEl.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const initialY = style.y;
    const initialSize = style.size;
    document.body.style.userSelect = "none";

    const onMove = (ev: PointerEvent) => {
      if (mode === "move") {
        const dy = ev.clientY - startY;
        const deltaPct = (dy / Math.max(1, rect.height)) * 100;
        const nextY = Math.round(Math.max(10, Math.min(90, initialY + deltaPct)));
        setStyle((s) => ({ ...s, y: nextY }));
      } else {
        const signX = direction === "nw" || direction === "sw" ? -1 : 1;
        const signY = direction === "nw" || direction === "ne" ? -1 : 1;
        const dx = (ev.clientX - startX) * signX;
        const dy = (ev.clientY - startY) * signY;
        const delta = (dx + dy * 0.6) * 0.45;
        const nextSize = Math.round(Math.max(40, Math.min(140, initialSize + delta)));
        setStyle((s) => ({ ...s, size: nextSize }));
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      setDraggingCanvasCaption(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const startPanelResize = (
    e: React.PointerEvent,
    panel: "left" | "right" | "timeline",
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const initLeft = leftPanelWidth;
    const initRight = rightPanelWidth;
    const initTimeline = timelineHeight;
    document.body.style.userSelect = "none";
    document.body.style.cursor = panel === "timeline" ? "ns-resize" : "col-resize";

    const onMove = (ev: PointerEvent) => {
      if (panel === "left") {
        setLeftPanelWidth(Math.max(180, Math.min(720, initLeft + (ev.clientX - startX))));
      } else if (panel === "right") {
        setRightPanelWidth(Math.max(200, Math.min(760, initRight - (ev.clientX - startX))));
      } else {
        const maxH = Math.max(500, Math.floor(window.innerHeight * 0.78));
        setTimelineHeight(Math.max(180, Math.min(maxH, initTimeline - (ev.clientY - startY))));
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const startScrubDrag = (e: React.PointerEvent) => {
    const trackEl = tracksRef.current;
    if (!trackEl) return;
    const updateFromClientX = (clientX: number) => {
      const rect = trackEl.getBoundingClientRect();
      const laneLeft = rect.left + 112;
      const laneWidth = Math.max(1, rect.width - 112);
      const ratio = Math.max(0, Math.min(1, (clientX - laneLeft) / laneWidth));
      seek(ratio * duration);
    };
    updateFromClientX(e.clientX);
    const onMove = (ev: PointerEvent) => updateFromClientX(ev.clientX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const renderVideo = async () => {
    const isTransparent = style.bg === "transparent";
    setPlaying(false);
    setRendering(true);
    setModal(null);
    setExportStatus("ready");
    setProgress(0);
    cancelRender.current = false;

    // 1. Prefer the FastAPI 60fps OpenCV + FFmpeg backend rendering pipeline
    try {
      const healthResp = await fetch(`${API_BASE}/api/health`);
      if (healthResp.ok) {
        setBackendOnline(true);
        const resolvedFont =
          font === "CustomArabic" && customFontKey
            ? customFontKey
            : BACKEND_FONT_MAP[font] || "Cairo-Bold";
        const renderConfig = {
          box_color_hex: style.box,
          text_color_hex: style.text,
          active_text_color_hex: style.active,
          stroke_color_hex: style.stroke,
          green_screen_hex: isTransparent ? "#00FF00" : style.bg,
          transparent_bg: isTransparent,
          font_choice: resolvedFont,
          font_size: style.size,
          stroke_width: style.width,
          box_radius: style.radius,
          box_padding_x: style.padX,
          box_padding_y: style.padY,
          y_position: Math.round((1920 * style.y) / 100),
          fps: 60,
          width: 1080,
          height: 1920,
          words_per_line: aiSettings.wordsPerLine || 4,
          max_lines: aiSettings.maxLines || 1,
          target_language: aiSettings.targetLanguage,
          enable_kinetic_text: aiSettings.enableKineticText,
          enable_emojis: aiSettings.enableEmojis,
          enable_motion_graphics: aiSettings.enableMotionGraphics,
          enable_sfx: aiSettings.enableSfx,
          enable_broll: aiSettings.enableBroll,
          sfx_volume_db: aiSettings.sfxVolumeDb,
        };
        const srtBlob = new File([cuesToSrt(cues)], srtName || "captions.srt", {
          type: "text/plain",
        });
        const audioPayload = audioFile || createSilentWavFile(contentDuration);
        const form = new FormData();
        form.append("audio_file", audioPayload);
        form.append("srt_file", srtBlob);
        form.append("cues", JSON.stringify(cues));
        form.append("config", JSON.stringify(renderConfig));

        const startResp = await fetch(`${API_BASE}/api/render`, { method: "POST", body: form });
        if (!startResp.ok) {
          throw new Error(`Render start failed (${startResp.status})`);
        }
        const initialJob = (await startResp.json()) as {
          job_id: string;
          state: string;
          progress: number;
          download_url?: string;
          sfx_download_url?: string;
          srt_download_url?: string;
          broll_zip_url?: string;
          output_filename?: string;
          error?: string;
        };
        let job = initialJob;
        while (job.state !== "completed" && job.state !== "failed") {
          if (cancelRender.current) {
            setRendering(false);
            notify("Render cancelled.");
            return;
          }
          await new Promise((r) => setTimeout(r, 250));
          const pollResp = await fetch(`${API_BASE}/api/jobs/${job.job_id}`);
          if (!pollResp.ok) throw new Error("Failed to poll render status");
          job = await pollResp.json();
          setProgress(Math.min(99, Math.round((job.progress || 0) * 100)));
        }
        if (job.state === "failed" || !job.download_url) {
          throw new Error(job.error || "Backend render failed");
        }
        setProgress(100);
        setLastJobDownloads({
          videoUrl: `${API_BASE}${job.download_url}`,
          sfxUrl: job.sfx_download_url ? `${API_BASE}${job.sfx_download_url}` : undefined,
          srtUrl: job.srt_download_url ? `${API_BASE}${job.srt_download_url}` : undefined,
          brollZipUrl: job.broll_zip_url ? `${API_BASE}${job.broll_zip_url}` : brollZipUrl || undefined,
        });
        const link = document.createElement("a");
        link.href = `${API_BASE}${job.download_url}`;
        link.download =
          job.output_filename ||
          (isTransparent ? "medsub-transparent.mov" : "medsub-captions.mp4");
        document.body.appendChild(link);
        link.click();
        link.remove();
        setExportStatus("complete");
        notify(
          isTransparent
            ? "Your 60fps transparent Alpha MOV + AI FX has been rendered & exported."
            : "Your 60fps video + AI FX has been rendered & exported.",
        );
        setRendering(false);
        return;
      }
    } catch (err) {
      if (backendOnline) {
        setExportStatus("error");
        setRendering(false);
        notify(err instanceof Error ? err.message : "Backend export failed.");
        return;
      }
    }

    // 2. Fallback to in-browser MediaRecorder if backend is not running
    if (isTransparent) {
      setRendering(false);
      return notify("Start the FastAPI backend to export transparent Alpha (.mov) video.");
    }
    if (!window.MediaRecorder) {
      setRendering(false);
      return notify("Video export is not supported in this browser.");
    }
    const mime = [
      "video/mp4;codecs=avc1.42E01E",
      "video/mp4",
      "video/webm;codecs=vp9",
      "video/webm",
    ].find((t) => MediaRecorder.isTypeSupported(t));
    if (!mime) {
      setRendering(false);
      return notify("No supported video encoder found in this browser.");
    }
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    let exportAudio: HTMLAudioElement | undefined;
    let captionLayout: HTMLDivElement | undefined;
    try {
      await document.fonts.ready;
      // Browser text layout preserves the visual order of Arabic and Latin runs.
      captionLayout = document.createElement("div");
      captionLayout.dir = "auto";
      Object.assign(captionLayout.style, {
        position: "fixed",
        left: "-20000px",
        top: "0",
        width: "max-content",
        whiteSpace: "nowrap",
        font: `${fontWeight(font)} ${style.size}px "${font}", sans-serif`,
        lineHeight: "1.5",
        visibility: "hidden",
      });
      document.body.append(captionLayout);
      let layoutKey = "";
      let positions: {
        text: string;
        x: number;
        boxX: number;
        boxY: number;
        boxWidth: number;
        boxHeight: number;
      }[] = [];
      let lineWidth = 0;
      let baselineY = 0;
      const canvas = document.createElement("canvas");
      canvas.width = 1080;
      canvas.height = 1920;
      const ctx = canvas.getContext("2d")!;
      stream = canvas.captureStream(60);
      if (audioUrl) {
        exportAudio = new Audio(audioUrl);
        context = new AudioContext();
        const destination = context.createMediaStreamDestination();
        context.createMediaElementSource(exportAudio).connect(destination);
        destination.stream.getAudioTracks().forEach((track) => stream!.addTrack(track));
        await context.resume();
      }
      const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      const stopped = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });
      const draw = (t: number) => {
        ctx.fillStyle = style.bg;
        ctx.fillRect(0, 0, 1080, 1920);
        const cue = cues.find((c) => t >= c.start && t < c.end);
        if (!cue) return;
        const list = cue.text.split(/\s+/),
          active = Math.min(
            list.length - 1,
            Math.floor(((t - cue.start) / (cue.end - cue.start)) * list.length),
          );
        ctx.font = `${fontWeight(font)} ${style.size}px "${font}", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        const key = `${cue.start}:${cue.text}:${active}`;
        if (key !== layoutKey) {
          layoutKey = key;
          captionLayout!.replaceChildren();
          const spans = list.map((word, i) => {
            if (i) captionLayout!.append(document.createTextNode(" "));
            const span = document.createElement("span");
            span.textContent = word;
            if (i === active) span.style.padding = `${style.padY}px ${style.padX}px`;
            captionLayout!.append(span);
            return span;
          });
          const baseline = document.createElement("span");
          Object.assign(baseline.style, { display: "inline-block", width: "0", height: "0" });
          captionLayout!.append(baseline);
          const line = captionLayout!.getBoundingClientRect();
          lineWidth = line.width;
          baselineY = baseline.getBoundingClientRect().top - line.top - line.height / 2;
          positions = spans.map((span, i) => {
            const box = span.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(span);
            const text = range.getBoundingClientRect();
            return {
              text: list[i],
              x: text.left - line.left + text.width / 2 - lineWidth / 2,
              boxX: box.left - line.left - lineWidth / 2,
              boxY: box.top - line.top - line.height / 2,
              boxWidth: box.width,
              boxHeight: box.height,
            };
          });
        }
        const scale = Math.min(1, 1000 / lineWidth);
        ctx.save();
        ctx.translate(540, (1920 * style.y) / 100);
        ctx.scale(scale, scale);
        positions.forEach((word, i) => {
          if (i === active) {
            ctx.fillStyle = cue.visual_plan?.highlight_color_override || style.box;
            ctx.beginPath();
            ctx.roundRect(word.boxX, word.boxY, word.boxWidth, word.boxHeight, style.radius);
            ctx.fill();
          }
          ctx.strokeStyle = style.stroke;
          ctx.direction = textDirection(word.text);
          ctx.lineWidth = style.width;
          ctx.lineJoin = "round";
          if (style.width) ctx.strokeText(word.text, word.x, baselineY);
          ctx.fillStyle = i === active ? style.active : style.text;
          ctx.fillText(word.text, word.x, baselineY);
        });
        ctx.restore();
      };
      draw(0);
      recorder.start();
      await exportAudio?.play();
      const start = performance.now();
      await new Promise<void>((resolve) => {
        const frame = () => {
          const elapsed = (performance.now() - start) / 1000;
          draw(Math.min(elapsed, contentDuration));
          setProgress(Math.min(100, (elapsed / contentDuration) * 100));
          if (elapsed >= contentDuration || cancelRender.current) resolve();
          else requestAnimationFrame(frame);
        };
        frame();
      });
      recorder.stop();
      exportAudio?.pause();
      await stopped;
      if (!cancelRender.current) {
        const url = URL.createObjectURL(new Blob(chunks, { type: mime }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `medsub-captions.${mime.includes("mp4") ? "mp4" : "webm"}`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        setModal(null);
        setExportStatus("complete");
        notify("Your caption video has been exported.");
      }
    } catch {
      setExportStatus("error");
      notify("Export failed. Try a different browser or a shorter audio track.");
    } finally {
      captionLayout?.remove();
      stream?.getTracks().forEach((t) => t.stop());
      exportAudio?.pause();
      await context?.close();
      setRendering(false);
    }
  };

  return (
    <div className="app-shell">
      <DesktopTitleBar
        currentProject={currentProject}
        hasUnsavedChanges={hasUnsavedChanges}
        onNewProject={() => setShowNewProjectModal(true)}
        onOpenProject={handleOpenProject}
        onSaveProject={handleSaveProject}
        onSaveProjectAs={handleSaveProjectAs}
        onCloseProject={() => setCurrentView("welcome")}
        onUndo={undo}
        onRedo={redo}
        onSelectAll={selectAllCues}
        onSplitCue={splitCueAtPlayhead}
        onSetInPoint={() => {
          setInPoint(time);
          notify(`In Point set at ${stamp(time)} (I)`);
        }}
        onSetOutPoint={() => {
          setOutPoint(time);
          notify(`Out Point set at ${stamp(time)} (O)`);
        }}
        onClearInOut={() => {
          setInPoint(null);
          setOutPoint(null);
          notify("Cleared In & Out points (X)");
        }}
        onToggleSnapping={() => {
          setSnapEnabled(!snapEnabled);
          notify(!snapEnabled ? "Snapping enabled (S)" : "Snapping disabled (S)");
        }}
        onExportVideo={() => setModal("export")}
        onExportSrt={exportSrtFile}
        onShowShortcuts={() => setModal("help")}
      />

      <input
        ref={projectFileInputRef}
        type="file"
        accept=".medsub,.json"
        style={{ display: "none" }}
        onChange={handleWebProjectFileSelected}
      />

      <NewProjectModal
        isOpen={showNewProjectModal}
        onClose={() => setShowNewProjectModal(false)}
        onCreate={handleCreateNewProject}
      />

      {currentView === "welcome" ? (
        <WelcomeScreen
          recentProjects={recentProjects}
          backendOnline={backendOnline}
          onNewProject={() => setShowNewProjectModal(true)}
          onOpenProject={handleOpenProject}
          onSelectRecent={(item) => loadProjectData(item.data, item.filePath)}
          onDeleteRecent={handleDeleteRecent}
          onOpenSample={handleOpenSample}
        />
      ) : (
        <>
          <header className="topbar">
            <a
              href="#"
              className="brand"
              aria-label="MedSub Studio home"
              onClick={(e) => {
                e.preventDefault();
                setCurrentView("welcome");
              }}
            >
              <img className="brand-icon" src={LOGO_URL} alt="" width="42" height="42" />
              <span className="brand-wordmark">
                <span>
                  Med<span className="brand-accent">Sub</span>
                </span>
                <span className="brand-studio">STUDIO</span>
              </span>
            </a>
            <div className="project-breadcrumb">
              <span className="breadcrumb-line" />
              <button
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#9ca3af",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: 0,
                  fontSize: 12,
                }}
                title="Return to Welcome Screen"
                onClick={() => setCurrentView("welcome")}
              >
                <Icon name="folder" size={15} />
                <span>Home</span>
              </button>
              <span className="slash">/</span>
              <strong>{currentProject?.name || "Untitled project"}</strong>
              <span className="saved-dot" />
              <span className="saved-text">
                {hasUnsavedChanges ? "Unsaved changes" : "All changes saved"}
              </span>
            </div>
        <div className="top-actions">
          <button
            className="icon-button help-button"
            aria-label="Help and shortcuts"
            onClick={() => setModal("help")}
          >
            <Icon name="help" />
          </button>
          <span className="top-divider" />
          <span className="workspace-mode">
            <Icon name="screen" size={14} />
            Caption workspace
          </span>
          <div className="avatar" title="Local workspace">
            AK
          </div>
        </div>
      </header>

      <main
        className="workspace"
        style={
          {
            "--left-panel-w": `${leftPanelWidth}px`,
            "--right-panel-w": `${rightPanelWidth}px`,
          } as React.CSSProperties
        }
      >
        <aside className="assets-panel">
          <div
            className="panel-resizer-v right-edge"
            title="Drag to resize left panel"
            onPointerDown={(e) => startPanelResize(e, "left")}
          />
          <div className="panel-heading">
            <h2>Project assets</h2>
            <span className="small-tag">AI + NLE</span>
          </div>
          <section className="input-section" style={secStyle("s1")}>
            <label className="eyebrow">SOURCE AUDIO & AI TRANSCRIBER</label>
            <button
              className={`upload-card ${audioFile ? "loaded" : ""}`}
              onClick={() => audioInput.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                uploadAudio(e.dataTransfer.files[0]);
              }}
            >
              <span className="file-icon purple">
                <Icon name="wave" size={21} />
              </span>
              <span className="upload-copy">
                <strong>{audioFile?.name || "Upload audio"}</strong>
                <small>
                  {audioFile
                    ? `${(audioFile.size / 1024 / 1024).toFixed(1)} MB · Click to replace`
                    : "Drop .wav, .mp3, or .m4a here"}
                </small>
              </span>
              <span className={`upload-status ${audioFile ? "ready" : ""}`}>
                {audioFile ? <Icon name="check" size={12} /> : ".WAV / .MP3"}
              </span>
            </button>

            <div className="ai-transcribe-card">
              <div className="ai-lang-row">
                <label className="ai-lang-label">Target Language</label>
                <select
                  aria-label="Target subtitle language"
                  className="ai-lang-select"
                  value={aiSettings.targetLanguage}
                  onChange={(e) =>
                    updateAISetting("targetLanguage", e.target.value as TargetLanguage)
                  }
                >
                  <option value="darija_mixed">🇩🇿 Darija + Tech (Mixed)</option>
                  <option value="ar_fusha">🇸🇦 Arabic (Fusha)</option>
                  <option value="fr">🇫🇷 Français</option>
                  <option value="en">🇬🇧 English</option>
                </select>
              </div>
              <div className="ai-layout-row">
                <div className="ai-layout-col">
                  <label className="ai-lang-label">Words / Line</label>
                  <select
                    aria-label="Words per line"
                    className="ai-lang-select"
                    value={aiSettings.wordsPerLine ?? 4}
                    onChange={(e) =>
                      updateCaptionLayout(Number(e.target.value), aiSettings.maxLines ?? 1)
                    }
                  >
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <option key={n} value={n}>
                        {n} {n === 1 ? "Word" : "Words"} / Line
                      </option>
                    ))}
                  </select>
                </div>
                <div className="ai-layout-col">
                  <label className="ai-lang-label">Max Lines</label>
                  <select
                    aria-label="Lines per caption"
                    className="ai-lang-select"
                    value={aiSettings.maxLines ?? 1}
                    onChange={(e) =>
                      updateCaptionLayout(aiSettings.wordsPerLine ?? 4, Number(e.target.value))
                    }
                  >
                    <option value={1}>1 Line (Punchy)</option>
                    <option value={2}>2 Lines (Stacked)</option>
                  </select>
                </div>
              </div>
              <div className="ai-action-row">
                <button
                  type="button"
                  className="ai-primary-btn"
                  disabled={transcribing}
                  onClick={() => void autoTranscribeAudio()}
                  title="Auto-transcribe audio with Groq Whisper + Gemini Darija alignment & AI Director"
                >
                  <Icon name="spark" size={14} />
                  {transcribing ? "Transcribing..." : "Auto-Transcribe & Direct"}
                </button>
                <button
                  type="button"
                  className="ai-secondary-btn"
                  disabled={translating || !cues.length}
                  onClick={() => void translateAllCues()}
                  title="Translate existing cues to selected language while keeping exact word timestamps"
                >
                  {translating ? "..." : "🌐 Translate"}
                </button>
              </div>
            </div>

            <button
              className="upload-card"
              onClick={() => srtInput.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void uploadSrt(e.dataTransfer.files[0]);
              }}
            >
              <span className="file-icon yellow">
                <Icon name="file" size={21} />
              </span>
              <span className="upload-copy">
                <strong>{srtName || "Optional: Upload .SRT"}</strong>
                <small>
                  {srtName
                    ? `${cues.length} cues · Click to replace`
                    : "Or use AI Auto-Transcribe above"}
                </small>
              </span>
              <span className="upload-status">{srtName ? `${cues.length} cues` : ".SRT"}</span>
            </button>
            <div className="file-note">
              <Icon name="check" size={12} />
              Groq Whisper + Gemini Darija & Multi-Stock B-Roll ready.
            </div>
            <input
              ref={audioInput}
              type="file"
              accept=".wav,.mp3,.m4a,.ogg"
              hidden
              onChange={(e) => uploadAudio(e.target.files?.[0])}
            />
            <input
              ref={srtInput}
              type="file"
              accept=".srt"
              hidden
              onChange={(e) => void uploadSrt(e.target.files?.[0])}
            />
          </section>
          {secHandle("s1")}
          <section className="font-section" style={secStyle("s2")}>
            <div className="section-title">
              <h3>Font manager</h3>
              <span className="arabic-tag">عربي</span>
            </div>
            <div className="font-select">
              <span className="font-symbol">Aa</span>
              <select
                aria-label="Arabic font"
                value={font}
                onChange={(e) => setFont(e.target.value)}
              >
                <option value="Cairo">Cairo Bold</option>
                <option value="Tajawal">Tajawal Bold</option>
                <option value="Almarai">Almarai ExtraBold</option>
                <option value="Changa">Changa Bold</option>
                {customFont && <option value="CustomArabic">{customFont}</option>}
              </select>
              <Icon name="chevron" size={16} />
            </div>
            <button
              className="custom-font"
              onClick={() => fontInput.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void uploadFont(e.dataTransfer.files[0]);
              }}
            >
              <Icon name="plus" size={15} />
              Upload custom font<span>.TTF / .OTF</span>
            </button>
            <input
              ref={fontInput}
              type="file"
              accept=".ttf,.otf"
              hidden
              onChange={(e) => void uploadFont(e.target.files?.[0])}
            />
          </section>
          {secHandle("s2")}
          <section className="transcript-section" style={secStyle("s3")}>
            <div className="section-title">
              <h3>
                Live transcript <span className="live-dot" />
              </h3>
              <div className="transcript-header-actions">
                <span className="small-tag">
                  {selectedCues.length > 1
                    ? `${selectedCues.length}/${cues.length} selected`
                    : `${cues.length} cues`}
                </span>
                {cues.length > 0 && (
                  <>
                    <button
                      type="button"
                      className="transcript-mini-btn"
                      onClick={selectAllCues}
                      title="Select all subtitles (Ctrl+A)"
                    >
                      All
                    </button>
                    <button
                      type="button"
                      className="transcript-mini-btn danger"
                      onClick={clearAllCues}
                      title="Remove all subtitles"
                    >
                      Clear
                    </button>
                  </>
                )}
              </div>
            </div>
            <p className="section-hint">
              Click a cue to jump · Hold left-click on timeline to box-select.
            </p>
            <div className="cue-list">
              {cues.length === 0 && (
                <div className="empty-cues-box">
                  <p>No subtitles in timeline.</p>
                  <button
                    type="button"
                    className="ai-secondary-btn"
                    onClick={insertCueAtPlayhead}
                  >
                    + Add Subtitle Cue
                  </button>
                </div>
              )}
              {cues.map((cue, i) => {
                const isSelected =
                  cueIndex === i || selectedCue === i || selectedCues.includes(i);
                const vp = cue.visual_plan;
                return (
                  <div
                    key={i}
                    className={`cue-card ${isSelected ? "selected" : ""}`}
                    onClick={(e) => {
                      if (e.ctrlKey || e.metaKey) {
                        setSelectedCue(i);
                        setSelectedCues((prev) =>
                          prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i],
                        );
                        return;
                      }
                      if (e.shiftKey) {
                        const a = Math.min(selectedCue, i);
                        const b = Math.max(selectedCue, i);
                        setSelectedCue(i);
                        setSelectedCues(Array.from({ length: b - a + 1 }, (_, k) => a + k));
                        return;
                      }
                      setSelectedCue(i);
                      setSelectedCues([i]);
                      seek(cue.start + 0.05);
                    }}
                  >
                    <div className="cue-meta">
                      <span className="cue-number">{String(i + 1).padStart(2, "0")}</span>
                      <span>
                        {stamp(cue.start)} <span className="time-arrow">→</span> {stamp(cue.end)}
                      </span>
                      {vp && (
                        <span className="cue-ai-badges">
                          {vp.emoji_or_icon && (
                            <span className="cue-mini-badge emoji" title="3D Emoji">
                              {vp.emoji_or_icon}
                            </span>
                          )}
                          {vp.emphasis_type && vp.emphasis_type !== "normal" && (
                            <span className={`cue-mini-badge emp-${vp.emphasis_type}`}>
                              {vp.emphasis_type === "shake_red" ? "SHAKE" : vp.emphasis_type.toUpperCase()}
                            </span>
                          )}
                          {vp.motion_graphic && vp.motion_graphic !== "none" && (
                            <span className="cue-mini-badge mg">
                              ✨ {vp.motion_graphic.replace("_", " ").toUpperCase()}
                            </span>
                          )}
                          {vp.sfx_trigger && vp.sfx_trigger !== "none" && (
                            <span
                              className="cue-mini-badge sfx"
                              title="Click to preview SFX"
                              onClick={(e) => {
                                e.stopPropagation();
                                playSfxPreview(vp.sfx_trigger, aiSettings.sfxVolumeDb);
                              }}
                            >
                              🔊 {vp.sfx_trigger}
                            </span>
                          )}
                          {cue.broll_preview_url && (
                            <span className="cue-mini-badge broll" title="9:16 B-Roll Ready">
                              🎬 B-Roll
                            </span>
                          )}
                        </span>
                      )}
                      {cueIndex === i && (
                        <span className="cue-playing">
                          <i />
                          <i />
                          <i />
                        </span>
                      )}
                    </div>
                    <textarea
                      ref={(el) => {
                        cueTextRefs.current[i] = el;
                      }}
                      aria-label={`Subtitle cue ${i + 1}`}
                      dir="auto"
                      rows={cue.text.includes("\n") ? 2 : 1}
                      value={cue.text}
                      onClick={(e) => e.stopPropagation()}
                      onFocus={() => {
                        setSelectedCue(i);
                        recordSnapshot();
                        if (cueIndex !== i) seek(cue.start + 0.05);
                      }}
                      onChange={(e) =>
                        setCues((cs) =>
                          cs.map((c, j) => (i === j ? { ...c, text: e.target.value } : c)),
                        )
                      }
                    />
                    {selectedCue === i && (
                      <div
                        className="cue-director-inline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="cue-director-row">
                          <input
                            type="text"
                            className="cue-emoji-input"
                            title="Floating 3D Emoji"
                            placeholder="🔥"
                            value={vp?.emoji_or_icon ?? ""}
                            onChange={(e) =>
                              updateCueVisualPlan(i, { emoji_or_icon: e.target.value })
                            }
                          />
                          <select
                            className="cue-select-mini"
                            title="Kinetic Emphasis Style"
                            value={vp?.emphasis_type ?? "normal"}
                            onChange={(e) =>
                              updateCueVisualPlan(i, {
                                emphasis_type: e.target.value as EmphasisType,
                              })
                            }
                          >
                            <option value="normal">Normal</option>
                            <option value="pop">⚡ Pop</option>
                            <option value="shake_red">🚨 Red Shake</option>
                            <option value="bounce">🏀 Bounce</option>
                          </select>
                          <select
                            className="cue-select-mini"
                            title="Motion Graphic Card"
                            value={vp?.motion_graphic ?? "none"}
                            onChange={(e) => {
                              const nextType = e.target.value as MotionGraphicType;
                              if (nextType !== "none") {
                                updateAISetting("enableMotionGraphics", true);
                                const sug = getCaptionMotionSuggestions(cue.text, i).find(
                                  (s) => s.type === nextType,
                                );
                                updateCueVisualPlan(i, {
                                  motion_graphic: nextType,
                                  graphic_text:
                                    vp?.graphic_text || sug?.graphic_text || cue.text.slice(0, 26),
                                  graphic_subtext: vp?.graphic_subtext ?? sug?.graphic_subtext ?? "",
                                  motion_start: vp?.motion_start ?? cue.start,
                                  motion_end: vp?.motion_end ?? cue.end,
                                });
                              } else {
                                updateCueVisualPlan(i, { motion_graphic: "none" });
                              }
                            }}
                          >
                            <option value="none">No Motion Card</option>
                            <option value="spotlight">🎯 Word Spotlight</option>
                            <option value="stat_badge">📊 Stat / Metric</option>
                            <option value="mistake_stamp">❌ Mistake Stamp</option>
                            <option value="solution_stamp">✅ Solution Stamp</option>
                            <option value="step_badge">🔢 Step / Rule</option>
                            <option value="notification_toast">🔔 Viral Alert</option>
                            <option value="neon_tape">⚡ Neon Tape</option>
                            <option value="cta_bio">🔗 CTA Bio</option>
                            <option value="cta_follow">🚀 CTA Follow</option>
                          </select>
                          <select
                            className="cue-select-mini"
                            title="SFX Audio Trigger"
                            value={vp?.sfx_trigger ?? "none"}
                            onChange={(e) => {
                              const nextSfx = e.target.value as SfxTriggerType;
                              updateCueVisualPlan(i, {
                                sfx_trigger: nextSfx,
                                sfx_start: vp?.sfx_start ?? cue.start,
                                sfx_end:
                                  vp?.sfx_end ??
                                  Number(
                                    Math.min(
                                      duration,
                                      Math.max(cue.start + 0.35, Math.min(cue.end, cue.start + 0.65)),
                                    ).toFixed(2),
                                  ),
                              });
                              if (nextSfx !== "none") {
                                updateAISetting("enableSfx", true);
                                playSfxPreview(nextSfx, aiSettings.sfxVolumeDb);
                              }
                            }}
                          >
                            <option value="none">🔇 No SFX</option>
                            <option value="whoosh">💨 Whoosh</option>
                            <option value="pop">🫧 Pop</option>
                            <option value="cash">💰 Cash</option>
                            <option value="error">❌ Error</option>
                            <option value="click">🖱️ Click</option>
                          </select>
                        </div>
                        <div className="cue-motion-gallery-bar">
                          <button
                            type="button"
                            className={`cue-motion-suggest-btn ${openMotionGalleryCue === i ? "active" : ""}`}
                            onClick={() =>
                              setOpenMotionGalleryCue((prev) => (prev === i ? null : i))
                            }
                          >
                            ✨ {openMotionGalleryCue === i ? "Hide Motion Ideas" : "Motion FX Ideas for this Caption"}
                          </button>
                          {vp?.motion_graphic && vp.motion_graphic !== "none" && (
                            <button
                              type="button"
                              className="cue-motion-remove-btn"
                              onClick={() => updateCueVisualPlan(i, { motion_graphic: "none" })}
                            >
                              × Remove Motion
                            </button>
                          )}
                        </div>
                        {openMotionGalleryCue === i && (
                          <div className="motion-suggestions-grid">
                            {getCaptionMotionSuggestions(cue.text, i).map((sug) => {
                              const isActiveType = vp?.motion_graphic === sug.type;
                              return (
                                <button
                                  key={sug.type}
                                  type="button"
                                  className={`motion-suggestion-card ${isActiveType ? "selected" : ""} ${sug.recommended ? "recommended" : ""}`}
                                  onClick={() => {
                                    recordSnapshot();
                                    updateAISetting("enableMotionGraphics", true);
                                    updateCueVisualPlan(i, {
                                      motion_graphic: sug.type,
                                      graphic_text: sug.graphic_text,
                                      graphic_subtext: sug.graphic_subtext,
                                      motion_start: vp?.motion_start ?? cue.start,
                                      motion_end: vp?.motion_end ?? cue.end,
                                    });
                                    notify(`Applied ${sug.label} to Cue #${i + 1}`);
                                  }}
                                >
                                  <div className="ms-card-top">
                                    <span className="ms-icon">{sug.icon}</span>
                                    <span className="ms-title">{sug.label}</span>
                                    {sug.recommended && <span className="ms-rec-pill">Best Match</span>}
                                  </div>
                                  <div className="ms-preview-text" dir="auto">
                                    {sug.graphic_text}
                                  </div>
                                  <div className="ms-reason">{sug.reason}</div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                        {vp?.motion_graphic && vp.motion_graphic !== "none" && (
                          <div className="cue-motion-inputs">
                            <input
                              type="text"
                              className="cue-text-mini"
                              placeholder="Motion headline (e.g. 90% Stat Alert 🔥)"
                              value={vp.graphic_text || ""}
                              onChange={(e) =>
                                updateCueVisualPlan(i, { graphic_text: e.target.value })
                              }
                            />
                            <input
                              type="text"
                              className="cue-text-mini"
                              placeholder="Subtext / badge label (e.g. KEY TAKEAWAY)"
                              value={vp.graphic_subtext || ""}
                              onChange={(e) =>
                                updateCueVisualPlan(i, { graphic_subtext: e.target.value })
                              }
                            />
                          </div>
                        )}
                        <input
                          type="text"
                          className="cue-text-mini"
                          placeholder="B-Roll search query (e.g. developer coding laptop)"
                          value={vp?.broll_query ?? ""}
                          onChange={(e) =>
                            updateCueVisualPlan(i, { broll_query: e.target.value })
                          }
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
          {secHandle("s3")}
          <div className="sidebar-bottom">
            <span className="ai-badge">
              <Icon name="spark" size={13} />
            </span>
            <span>Big words. Bigger impact.</span>
            <span className="version">v2.0 AI</span>
          </div>
        </aside>

        <section className="editor-panel">
          <div className="editor-toolbar">
            <div>
              <h1>
                Caption studio <span className="project-type">DARIJA + AI FX</span>
              </h1>
              <p>Hybrid Darija Whisper + Gemini Director · Kinetic Text, 3D Emojis & B-Roll.</p>
            </div>
            <div className="editor-export-info">
              <span className="resolution">
                <span />
                1080 × 1920 <b>·</b> 60 FPS
              </span>
              <span
                className={`export-status ${rendering ? "is-rendering" : exportStatus}`}
                role="status"
              >
                <i />
                {rendering
                  ? `Rendering · ${Math.floor(progress)}%`
                  : exportStatus === "complete"
                    ? "Export complete"
                    : exportStatus === "error"
                      ? "Export failed · Try again"
                      : "Ready to export"}
              </span>
            </div>
          </div>
          <div className="preview-workspace">
            <div className="preview-top">
              <span className="preview-label">
                <span />
                LIVE PREVIEW
              </span>
              <div className="preview-tools">
                <button
                  className="icon-button"
                  disabled={!history.length}
                  aria-label="Undo style change"
                  onClick={undo}
                >
                  <Icon name="undo" size={15} />
                </button>
                <button
                  className="icon-button"
                  disabled={!future.length}
                  aria-label="Redo style change"
                  onClick={redo}
                >
                  <Icon name="redo" size={15} />
                </button>
                <span />
                <button
                  className="aspect-button"
                  onClick={() => notify("Portrait canvas · 1080 × 1920 pixels")}
                >
                  <Icon name="screen" size={13} />
                  9:16
                </button>
              </div>
            </div>
            <div className="canvas-area">
              <div className="canvas-wrap" style={{ transform: `scale(${zoom / 100})` }}>
                <div
                  ref={previewRef}
                  className={`phone-canvas ${style.bg === "transparent" ? "checkerboard" : ""}`}
                  style={{ backgroundColor: style.bg }}
                >
                  {aiSettings.enableBroll &&
                    currentCue?.broll_preview_url &&
                    cueBrollVisible(currentCue) && (
                      <video
                        key={currentCue.broll_preview_url}
                        className="canvas-broll-video"
                        style={{
                          zIndex: videoLayerZ("broll", currentCue.visual_plan?.broll_track_id),
                        }}
                        src={`${API_BASE}${currentCue.broll_preview_url}`}
                        autoPlay
                        loop
                        muted
                        playsInline
                      />
                    )}
                  <div className="canvas-safe-area" />
                  {(() => {
                    if (!aiSettings.enableMotionGraphics) return null;
                    const activeMotionCueIdx = cues.findIndex((c) => {
                      const vp = c.visual_plan;
                      if (!vp || !vp.motion_graphic || vp.motion_graphic === "none") return false;
                      const ms = vp.motion_start ?? c.start;
                      const me = vp.motion_end ?? c.end;
                      return time >= ms && time <= me;
                    });
                    if (activeMotionCueIdx < 0) return null;
                    const mCue = cues[activeMotionCueIdx];
                    const vp = mCue?.visual_plan;
                    if (!mCue || !vp || !vp.motion_graphic || vp.motion_graphic === "none")
                      return null;
                    if (!cueMotionVisible(mCue)) return null;
                    const mgType = vp.motion_graphic;
                    const mx = vp.motion_x ?? 50;
                    const my = vp.motion_y ?? 14;
                    const mScale = vp.motion_scale ?? 1;
                    const headline =
                      vp.graphic_text ||
                      (mgType === "stat_badge"
                        ? "90% Stat Alert 🔥"
                        : mgType === "cta_bio"
                          ? "Full System in Bio 🔗"
                          : mgType === "cta_follow"
                            ? "Follow for Part 2 🚀"
                            : mgType === "mistake_stamp"
                              ? "BIG MISTAKE ❌"
                              : mgType === "solution_stamp"
                                ? "PROVEN FIX ✅"
                                : mCue.text.slice(0, 26));
                    const subline =
                      vp.graphic_subtext ||
                      (mgType === "spotlight"
                        ? "KEY TAKEAWAY"
                        : mgType === "stat_badge"
                          ? "PROVEN METRIC"
                          : mgType === "mistake_stamp"
                            ? "STOP DOING THIS"
                            : mgType === "solution_stamp"
                              ? "DO THIS INSTEAD"
                              : mgType === "step_badge"
                                ? `STEP #${activeMotionCueIdx + 1}`
                                : mgType === "notification_toast"
                                  ? "NOW · VIRAL INSIGHT"
                                  : "");
                    return (
                      <div
                        className={`canvas-motion-card card-${mgType}`}
                        dir="auto"
                        style={{
                          left: `${mx}%`,
                          top: `${my}%`,
                          transform: `translate(-50%, -50%) scale(${mScale})`,
                          zIndex: videoLayerZ("motion", vp.motion_track_id) + 2,
                        }}
                        title="Drag to move Motion Graphic on canvas · Drag corner to resize · Click × to remove"
                        onPointerDown={(e) => startMotionCanvasDrag(e, activeMotionCueIdx, "move")}
                      >
                        <span className="motion-card-dot" />
                        <div className="motion-card-body">
                          {subline && <span className="motion-card-sub">{subline}</span>}
                          <span className="motion-card-text">{headline}</span>
                        </div>
                        <button
                          type="button"
                          className="motion-card-close"
                          title="Remove motion graphic from this caption"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            recordSnapshot();
                            updateCueVisualPlan(activeMotionCueIdx, { motion_graphic: "none" });
                          }}
                        >
                          ×
                        </button>
                        <span
                          className="motion-card-resize"
                          title="Drag to resize Motion Graphic"
                          onPointerDown={(e) =>
                            startMotionCanvasDrag(e, activeMotionCueIdx, "resize")
                          }
                        />
                      </div>
                    );
                  })()}
                  {currentCue && cueSubtitleVisible(currentCue) && (
                    <div
                      className={`caption-position ${draggingCanvasCaption ? "is-dragging" : ""}`}
                      style={{
                        top: `${style.y}%`,
                        zIndex: videoLayerZ("subtitle", currentCue.track_id) + 1,
                      }}
                      title="Drag up/down to move subtitle · Drag corner handles to resize"
                      onPointerDown={(e) => startCaptionCanvasDrag(e, "move")}
                    >
                    <div className="caption-box-interactive">
                      <span
                        className="caption-resize-handle nw"
                        title="Drag to resize font size"
                        onPointerDown={(e) => startCaptionCanvasDrag(e, "resize", "nw")}
                      />
                      <span
                        className="caption-resize-handle ne"
                        title="Drag to resize font size"
                        onPointerDown={(e) => startCaptionCanvasDrag(e, "resize", "ne")}
                      />
                      <span
                        className="caption-resize-handle sw"
                        title="Drag to resize font size"
                        onPointerDown={(e) => startCaptionCanvasDrag(e, "resize", "sw")}
                      />
                      <span
                        className="caption-resize-handle se"
                        title="Drag to resize font size"
                        onPointerDown={(e) => startCaptionCanvasDrag(e, "resize", "se")}
                      />
                      <div
                        ref={captionRef}
                        className={`caption-line ${captionLines.length > 1 ? "multiline-caption" : ""}`}
                        dir="auto"
                        style={{
                          fontFamily: `"${font}", sans-serif`,
                          fontSize: `${style.size / 10.8}cqw`,
                          fontWeight: fontWeight(font),
                          transform: `scale(${captionScale})`,
                        }}
                      >
                        {highlightBoxRect && cueIndex >= 0 && (
                          <span
                            aria-hidden="true"
                            className={`sliding-highlight-box ${
                              highlightBoxRect.animate ? "glide-active" : ""
                            }`}
                            style={{
                              transform: `translate3d(${highlightBoxRect.x}px, ${highlightBoxRect.y}px, 0)`,
                              width: `${highlightBoxRect.w}px`,
                              height: `${highlightBoxRect.h}px`,
                              backgroundColor:
                                currentCue?.visual_plan?.highlight_color_override ||
                                (aiSettings.enableKineticText &&
                                currentCue?.visual_plan?.emphasis_type === "shake_red"
                                  ? "#FF2A2A"
                                  : style.box),
                              borderRadius: `${style.radius / 10.8}cqw`,
                            }}
                          />
                        )}
                        {captionLines.map((lineWords, lineIdx) => (
                          <Fragment key={`line-${lineIdx}`}>
                            {lineIdx > 0 && <br />}
                            {lineWords.map(({ word, globalIndex }, wordIdxInLine) => {
                              const isActive = globalIndex === activeWord;
                              const empType = aiSettings.enableKineticText
                                ? currentCue?.visual_plan?.emphasis_type || "normal"
                                : "normal";
                              const emojiIcon =
                                aiSettings.enableEmojis &&
                                currentCue?.visual_plan?.emoji_or_icon
                                  ? currentCue.visual_plan.emoji_or_icon
                                  : "";
                              return (
                                <Fragment key={globalIndex}>
                                  {wordIdxInLine > 0 && " "}
                                  <span
                                    ref={(el) => {
                                      wordSpanRefs.current[globalIndex] = el;
                                    }}
                                    className={`caption-word-token ${
                                      isActive
                                        ? `highlight-word kinetic-${empType}`
                                        : ""
                                    }`}
                                    style={{
                                      color: isActive ? style.active : style.text,
                                      WebkitTextStroke: `${style.width / 10.8}cqw ${style.stroke}`,
                                    }}
                                  >
                                    {isActive && emojiIcon && (
                                      <span
                                        key={`${cueIndex}-${activeWord}-${emojiIcon}`}
                                        className="floating-emoji-badge"
                                      >
                                        {emojiIcon}
                                      </span>
                                    )}
                                    {word}
                                  </span>
                                </Fragment>
                              );
                            })}
                          </Fragment>
                        ))}
                      </div>
                    </div>
                  </div>
                  )}
                  <span className="canvas-corner top-left" />
                  <span className="canvas-corner top-right" />
                  <span className="canvas-corner bottom-left" />
                  <span className="canvas-corner bottom-right" />
                </div>
                <div className="canvas-dimensions">
                  1080 × 1920 <span>•</span> PORTRAIT
                </div>
              </div>
            </div>
            <div className="preview-bottom">
              <div className="chroma-status">
                <span style={{ backgroundColor: style.bg === "transparent" ? "#eee" : style.bg }} />
                {style.bg === "transparent" ? "Alpha preview" : "Chroma key ready"}
              </div>
              <div className="zoom-controls">
                <button onClick={() => setZoom((z) => Math.max(60, z - 10))} aria-label="Zoom out">
                  −
                </button>
                <span>{zoom}%</span>
                <button onClick={() => setZoom((z) => Math.min(110, z + 10))} aria-label="Zoom in">
                  +
                </button>
                <span className="zoom-divider" />
                <button
                  aria-label="Full screen preview"
                  onClick={() => {
                    if (document.fullscreenElement) void document.exitFullscreen();
                    else
                      void previewRef.current
                        ?.requestFullscreen()
                        .catch(() => notify("Fullscreen is unavailable in this preview."));
                  }}
                >
                  <Icon name="expand" size={14} />
                </button>
              </div>
            </div>
          </div>
          <section
            className="timeline-panel"
            style={{ "--timeline-h": `${timelineHeight}px` } as React.CSSProperties}
          >
            <div
              className="timeline-resizer-h"
              title="Drag to resize timeline height"
              onPointerDown={(e) => startPanelResize(e, "timeline")}
            />
            <div className="playback-bar">
              <div className="transport">
                <button
                  className="icon-button"
                  aria-label="Previous edit point (Up Arrow)"
                  title="Previous edit point (↑)"
                  onClick={() => jumpEditPoint(-1)}
                >
                  <Icon name="back" size={16} />
                </button>
                <button
                  className="play-button"
                  aria-label={playing ? "Pause (Space / K)" : "Play (Space / L)"}
                  title="Play / Pause (Space, J-K-L shuttle)"
                  onClick={() => {
                    setShuttleRate(1);
                    if (time >= duration) seek(0);
                    setPlaying(!playing);
                  }}
                >
                  <Icon name={playing ? "pause" : "play"} size={17} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Next edit point (Down Arrow)"
                  title="Next edit point (↓)"
                  onClick={() => jumpEditPoint(1)}
                >
                  <Icon name="forward" size={16} />
                </button>
                <div className="timecode">
                  {stamp(time)}
                  <span>/ {stamp(duration)}</span>
                </div>
                <div className="premiere-tools">
                  <span className="tool-divider" />
                  <button
                    className="tool-pill shuttle-pill"
                    title="Shuttle speed (J reverse · K stop · L forward · Shift+L 0.5x)"
                    onClick={() => {
                      const rates = [0.5, 1, 1.5, 2, 4];
                      const next = rates[(rates.indexOf(shuttleRate) + 1) % rates.length] ?? 1;
                      setShuttleRate(next);
                    }}
                  >
                    {shuttleRate > 0 ? `${shuttleRate}x` : `${shuttleRate}x ◀`}
                  </button>
                  <button
                    className="tool-pill"
                    title="Razor / Split cue at playhead (Ctrl+K or C)"
                    onClick={splitCueAtPlayhead}
                  >
                    ✂ Split
                  </button>
                  <button
                    className="tool-pill"
                    title="Insert new cue at playhead (N)"
                    onClick={insertCueAtPlayhead}
                  >
                    + Cue
                  </button>
                  <button
                    className="tool-pill motion-pill"
                    title="Add or Suggest Motion Graphic for caption at playhead"
                    onClick={addMotionAtPlayhead}
                  >
                    ✨ + Motion
                  </button>
                  <button
                    className="tool-pill sfx-pill"
                    title="Add Sound Effect (SFX) clip at playhead"
                    onClick={() => addSfxAtPlayhead("whoosh")}
                  >
                    🔊 + SFX
                  </button>
                  <div className="track-add-dropdown-wrap">
                    <button
                      type="button"
                      className="tool-pill track-add-pill"
                      title="Add a new Video or Audio track to the sequence"
                      onClick={(e) => {
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setTrackMenu((prev) =>
                          prev ? null : { x: rect.left, y: rect.bottom + 4, trackId: null },
                        );
                      }}
                    >
                      + Track ▾
                    </button>
                  </div>
                  <button
                    className="tool-pill"
                    title="Expand height of all tracks (Shift+=) · Alt+Scroll over header"
                    onClick={() => {
                      resizeTracks(() => true, 12);
                      notify("Expanded track heights (+)");
                    }}
                  >
                    ↕ Expand
                  </button>
                  <button
                    className="tool-pill"
                    title="Collapse height of all tracks (Shift+-)"
                    onClick={() => {
                      resizeTracks(() => true, -12);
                      notify("Collapsed track heights (-)");
                    }}
                  >
                    ≡ Small
                  </button>
                  <button
                    className="tool-pill"
                    title="Merge selected cue with next (Ctrl+J)"
                    onClick={mergeWithNextCue}
                  >
                    Merge
                  </button>
                  <button
                    className="tool-pill"
                    title="Select all subtitle cues (Ctrl+A) · Or hold left-click on caption track to box-select"
                    onClick={selectAllCues}
                  >
                    Select All
                  </button>
                  <button
                    className="tool-pill"
                    title="Delete selected cue(s) (Del) · Hold Shift for Ripple Delete (Shift+Del)"
                    onClick={(e) => deleteSelectedCue(e.shiftKey)}
                  >
                    {selectedCues.length > 1 ? `Del (${selectedCues.length})` : "Del"}
                  </button>
                  {cues.length > 0 && (
                    <button
                      className="tool-pill danger-pill"
                      title="Remove all subtitle cues from timeline (Ctrl+Z to undo)"
                      onClick={clearAllCues}
                    >
                      Clear All
                    </button>
                  )}
                  <span className="tool-divider" />
                  <button
                    className={`tool-pill ${snapEnabled ? "active" : ""}`}
                    title="Toggle timeline magnetic snapping (S)"
                    onClick={() => setSnapEnabled((v) => !v)}
                  >
                    Snap
                  </button>
                  <button
                    className={`tool-pill ${loopEnabled ? "active" : ""}`}
                    title="Toggle loop playback (Ctrl+L)"
                    onClick={() => setLoopEnabled((v) => !v)}
                  >
                    Loop
                  </button>
                  <button
                    className={`tool-pill ${inPoint !== null ? "active" : ""}`}
                    title="Mark In point at playhead (I)"
                    onClick={() => setInPoint(Number(time.toFixed(2)))}
                  >
                    {inPoint !== null ? `I:${stamp(inPoint)}` : "In [I]"}
                  </button>
                  <button
                    className={`tool-pill ${outPoint !== null ? "active" : ""}`}
                    title="Mark Out point at playhead (O)"
                    onClick={() => setOutPoint(Number(time.toFixed(2)))}
                  >
                    {outPoint !== null ? `O:${stamp(outPoint)}` : "Out [O]"}
                  </button>
                  {(inPoint !== null || outPoint !== null) && (
                    <button
                      className="tool-pill"
                      title="Clear In & Out points (Ctrl+Shift+X)"
                      onClick={() => {
                        setInPoint(null);
                        setOutPoint(null);
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
              <div className="playback-right">
                <button
                  className="tool-pill"
                  title="Zoom timeline out (-)"
                  onClick={() => setTimelineZoom((z) => Math.max(1, Number((z / 1.4).toFixed(2))))}
                >
                  −
                </button>
                <button
                  className="tool-pill"
                  title="Fit timeline to sequence (\)"
                  onClick={() => setTimelineZoom(1)}
                >
                  {Math.round(timelineZoom * 100)}%
                </button>
                <button
                  className="tool-pill"
                  title="Zoom timeline in (=)"
                  onClick={() => setTimelineZoom((z) => Math.min(8, Number((z * 1.4).toFixed(2))))}
                >
                  +
                </button>
                <span className="space-key" title="J-K-L shuttle · Space play/pause">
                  J K L
                </span>
                <button
                  className={`icon-button ${muted ? "muted" : ""}`}
                  aria-label={muted ? "Unmute audio (M)" : "Mute audio (M)"}
                  title="Mute / Unmute (M)"
                  onClick={() => setMuted(!muted)}
                >
                  <Icon name="volume" size={17} />
                  {muted && <span className="mute-slash" />}
                </button>
              </div>
            </div>
            <div
              ref={timelineScrollRef}
              className="timeline-scroll"
              onWheel={(e) => {
                if (e.altKey || e.ctrlKey) {
                  e.preventDefault();
                  setTimelineZoom((z) =>
                    e.deltaY < 0
                      ? Math.min(8, Number((z * 1.25).toFixed(2)))
                      : Math.max(1, Number((z / 1.25).toFixed(2))),
                  );
                }
              }}
            >
              <div className="timeline-inner" style={{ width: `${timelineZoom * 100}%` }}>
                <div
                  className="timeline-ruler"
                  onPointerDown={startScrubDrag}
                  title="Click or drag to scrub playhead"
                >
                  <span className="ruler-track-spacer" style={{ width: TRACK_HEADER_W, position: "relative" }}>
<i className="header-w-resizer" title="Drag to resize track header width" onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); const x0 = e.clientX; const w0 = headerW; const mv = (ev: PointerEvent) => setHeaderW(Math.max(110, Math.min(360, w0 + ev.clientX - x0))); const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); }; window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up); }} />
                    PREMIERE NLE
                  </span>
                  <div className="ruler-ticks">
                    {(() => {
                      const ticks = Math.max(2, Math.min(16, Math.round(8 * timelineZoom)));
                      return Array.from({ length: ticks }, (_, i) => (
                        <span key={i}>{stamp((duration * i) / (ticks - 1)).slice(0, 5)}</span>
                      ));
                    })()}
                  </div>
                </div>
                <div
                  ref={tracksRef}
                  className="tracks nle-multitrack"
                  onPointerDown={(e) => {
                    if (e.shiftKey) startWordTrackMarqueeDrag(e);
                    else startScrubDrag(e);
                  }}
                  onContextMenu={(e) => {
                    if ((e.target as HTMLElement).closest(".nle-track-header")) return;
                    e.preventDefault();
                    setTrackMenu({ x: e.clientX, y: e.clientY, trackId: null });
                  }}
                >
                  {(inPoint !== null || outPoint !== null) && (
                    <div
                      className="inout-range"
                      style={{
                        left: `calc(${TRACK_HEADER_W}px + (100% - ${TRACK_HEADER_W}px) * ${(inPoint ?? 0) / duration})`,
                        width: `calc((100% - ${TRACK_HEADER_W}px) * ${Math.max(0.05, (outPoint ?? duration) - (inPoint ?? 0)) / duration})`,
                      }}
                    >
                      {inPoint !== null && <span className="inout-badge in">I</span>}
                      {outPoint !== null && <span className="inout-badge out">O</span>}
                    </div>
                  )}

                  {/* VIDEO TRACKS (Higher V numbers on top, exactly like Adobe Premiere Pro) */}
                  {videoTracks
                    .slice()
                    .reverse()
                    .map((track) => {
                      const tag = trackTag(track);
                      const isSel = selectedTrackLayer === track.id;
                      const isCompact = track.height < 30;
                      return (
                        <div
                          key={track.id}
                          data-row-track-id={track.id} className={`nle-track-row track-video track-${track.kind} ${isSel ? "track-selected" : ""} ${track.locked ? "is-locked" : ""} ${track.hidden ? "is-hidden" : ""}`}
                          style={{ height: track.height }}
                          onClick={() => setSelectedTrackLayer(track.id)}
                        >
                          <div
                            className="nle-track-header"
                            style={{ width: TRACK_HEADER_W }}
                            title="Double-click to expand/collapse · Alt+Scroll to resize height"
                            onPointerDown={(e) => e.stopPropagation()}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              updateTrack(track.id, { height: track.height > 55 ? 26 : 110 });
                            }}
                            onWheel={(e) => {
                              if (e.altKey) {
                                e.preventDefault();
                                e.stopPropagation();
                                updateTrack(track.id, {
                                  height: Math.max(
                                    TRACK_MIN_H,
                                    Math.min(TRACK_MAX_H, track.height + (e.deltaY < 0 ? 14 : -14)),
                                  ),
                                });
                              }
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setTrackMenu({ x: e.clientX, y: e.clientY, trackId: track.id });
                            }}
                          >
                            <span className="nle-track-grip" title="Drag to reorder track" onPointerDown={(e) => startTrackReorder(e, track.id)}>?</span>`n                            <span className={`nle-track-tag ${track.kind}`}>{tag}</span>
                            <div className="nle-track-title-wrap">
                              {renamingTrackId === track.id ? (
                                <input
                                  autoFocus
                                  className="nle-track-rename-input"
                                  defaultValue={track.name}
                                  onBlur={(e) => {
                                    updateTrack(track.id, {
                                      name: e.target.value.trim() || track.name,
                                    });
                                    setRenamingTrackId(null);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === "Escape") {
                                      (e.target as HTMLInputElement).blur();
                                    }
                                  }}
                                />
                              ) : (
                                <span
                                  className="nle-track-name"
                                  title="Double-click to rename"
                                  onDoubleClick={() => setRenamingTrackId(track.id)}
                                >
                                  {track.name}
                                </span>
                              )}
                            </div>
                            <div className="nle-track-ctrl-group">
                              <button
                                type="button"
                                className={`nle-hdr-btn lock-btn ${track.locked ? "active" : ""}`}
                                title={
                                  track.locked
                                    ? "Unlock Track (Shift+Click all)"
                                    : "Lock Track (Shift+Click all)"
                                }
                                onClick={(e) => toggleTrackFlag(e, track.id, "locked")}
                              >
                                {track.locked ? "🔒" : "🔓"}
                              </button>
                              <button
                                type="button"
                                className={`nle-hdr-btn eye-btn ${track.hidden ? "active-off" : ""}`}
                                title={
                                  track.hidden
                                    ? "Show Track Output (Shift+Click all)"
                                    : "Hide Track Output (Shift+Click all)"
                                }
                                onClick={(e) => toggleTrackFlag(e, track.id, "hidden")}
                              >
                                {track.hidden ? "🚫" : "👁️"}
                              </button>
                              <button
                                type="button"
                                className="nle-hdr-btn menu-btn"
                                title="Track options..."
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const r = (
                                    e.currentTarget as HTMLElement
                                  ).getBoundingClientRect();
                                  setTrackMenu({
                                    x: r.right + 4,
                                    y: r.top,
                                    trackId: track.id,
                                  });
                                }}
                              >
                                ⋮
                              </button>
                            </div>
                            <div
                              className="nle-track-height-resizer"
                              title="Drag up/down to make track smaller or taller (Alt+Scroll)"
                              onPointerDown={(e) => startTrackHeightDrag(e, track.id)}
                            />
                          </div>
                          <div
                            className={`nle-track-lane lane-${track.kind} ${track.locked ? "lane-locked" : ""} ${track.hidden ? "lane-hidden" : ""} ${dropTargetTrackId === track.id ? "lane-drop-target" : ""}`}
                            data-track-id={track.id}
                            data-track-kind={track.kind}
                            onPointerDown={(e) => {
                              if (track.kind === "subtitle") startWordTrackMarqueeDrag(e);
                              else startScrubDrag(e);
                            }}
                          >
                            {track.kind === "subtitle" && marqueeBox && (
                              <div
                                className="marquee-selection-box"
                                style={{
                                  left: `${marqueeBox.leftPct}%`,
                                  width: `${marqueeBox.widthPct}%`,
                                }}
                              />
                            )}

                            {/* Subtitle Cue blocks on this track */}
                            {track.kind === "subtitle" &&
                              cues.map((cue, i) => {
                                if (resolveTrackId("subtitle", cue.track_id) !== track.id)
                                  return null;
                                const isBlockSelected =
                                  cueIndex === i || selectedCue === i || selectedCues.includes(i);
                                return (
                                  <div
                                    key={`sub-${i}`}
                                    className={`word-block ${isBlockSelected ? "active-block" : ""} ${selectedCues.includes(i) && selectedCues.length > 1 ? "multi-selected" : ""} ${draggingCue === i ? "dragging" : ""}`}
                                    dir="auto"
                                    style={{
                                      left: `${(cue.start / duration) * 100}%`,
                                      width: `${((cue.end - cue.start) / duration) * 100}%`,
                                      height: Math.max(18, track.height - 6),
                                    }}
                                    title={`${cue.text} (${stamp(cue.start)} → ${stamp(cue.end)}) · Drag to move, edges to trim, drag up/down between tracks`}
                                    onPointerDown={(e) =>
                                      startCuePointerDrag(e, i, "move", "subtitle")
                                    }
                                    onDoubleClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedCue(i);
                                      setSelectedCues([i]);
                                      cueTextRefs.current[i]?.focus();
                                      cueTextRefs.current[i]?.select();
                                    }}
                                  >
                                    <span
                                      className="trim-handle start"
                                      title="Trim In point"
                                      onPointerDown={(e) =>
                                        startCuePointerDrag(e, i, "trim-start", "subtitle")
                                      }
                                    />
                                    <span className="word-block-text">{cue.text}</span>
                                    {!isCompact && (
                                      <span className="word-block-duration">
                                        {(cue.end - cue.start).toFixed(1)}s
                                      </span>
                                    )}
                                    <span
                                      className="trim-handle end"
                                      title="Trim Out point"
                                      onPointerDown={(e) =>
                                        startCuePointerDrag(e, i, "trim-end", "subtitle")
                                      }
                                    />
                                  </div>
                                );
                              })}

                            {/* Motion FX clips on this track */}
                            {track.kind === "motion" &&
                              cues.map((cue, i) => {
                                const vp = cue.visual_plan;
                                if (!vp || !vp.motion_graphic || vp.motion_graphic === "none")
                                  return null;
                                if (resolveTrackId("motion", vp.motion_track_id) !== track.id)
                                  return null;
                                const mStart = vp.motion_start ?? cue.start;
                                const mEnd = vp.motion_end ?? cue.end;
                                const isSel = selectedCue === i && selectedTrackLayer === track.id;
                                return (
                                  <div
                                    key={`motion-${i}`}
                                    className={`nle-clip-block motion-clip ${isSel ? "active-clip" : ""} ${!aiSettings.enableMotionGraphics ? "muted-clip" : ""}`}
                                    style={{
                                      left: `${(mStart / duration) * 100}%`,
                                      width: `${(Math.max(0.15, mEnd - mStart) / duration) * 100}%`,
                                      height: Math.max(18, track.height - 6),
                                    }}
                                    title={`Motion FX: ${vp.graphic_text || vp.motion_graphic} (${stamp(mStart)} → ${stamp(mEnd)}) · Drag to move, edges to trim`}
                                    onPointerDown={(e) =>
                                      startSubTrackClipDrag(e, i, "motion", "move")
                                    }
                                    onDoubleClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedCue(i);
                                      setOpenMotionGalleryCue(i);
                                    }}
                                  >
                                    <span
                                      className="trim-handle start"
                                      title="Trim Motion In point"
                                      onPointerDown={(e) =>
                                        startSubTrackClipDrag(e, i, "motion", "trim-start")
                                      }
                                    />
                                    <span className="nle-clip-label">
                                      ✨ {vp.graphic_text || vp.motion_graphic.replace("_", " ")}
                                    </span>
                                    <button
                                      type="button"
                                      className="nle-clip-del"
                                      title="Remove Motion Graphic from sequence"
                                      onPointerDown={(e) => e.stopPropagation()}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        recordSnapshot();
                                        updateCueVisualPlan(i, { motion_graphic: "none" });
                                        notify(`Removed Motion Graphic from Cue #${i + 1}`);
                                      }}
                                    >
                                      ×
                                    </button>
                                    <span
                                      className="trim-handle end"
                                      title="Trim Motion Out point"
                                      onPointerDown={(e) =>
                                        startSubTrackClipDrag(e, i, "motion", "trim-end")
                                      }
                                    />
                                  </div>
                                );
                              })}

                            {/* B-Roll clips on this track */}
                            {track.kind === "broll" &&
                              cues.map((cue, i) => {
                                if (!cueHasBroll(cue)) return null;
                                if (
                                  resolveTrackId("broll", cue.visual_plan?.broll_track_id) !==
                                  track.id
                                )
                                  return null;
                                const isSel = selectedCue === i && selectedTrackLayer === track.id;
                                return (
                                  <div
                                    key={`broll-${i}`}
                                    className={`nle-clip-block broll-clip ${isSel ? "active-clip" : ""}`}
                                    style={{
                                      left: `${(cue.start / duration) * 100}%`,
                                      width: `${((cue.end - cue.start) / duration) * 100}%`,
                                      height: Math.max(18, track.height - 6),
                                    }}
                                    title={`B-Roll: ${cue.visual_plan?.broll_query || "Stock Clip"} (${stamp(cue.start)} → ${stamp(cue.end)})`}
                                    onPointerDown={(e) => {
                                      setSelectedTrackLayer(track.id);
                                      startCuePointerDrag(e, i, "move", "broll");
                                    }}
                                  >
                                    <span
                                      className="trim-handle start"
                                      onPointerDown={(e) =>
                                        startCuePointerDrag(e, i, "trim-start", "broll")
                                      }
                                    />
                                    <span className="nle-clip-label">
                                      🎬 {cue.visual_plan?.broll_query || `B-Roll #${i + 1}`}
                                    </span>
                                    <button
                                      type="button"
                                      className="nle-clip-del"
                                      title="Remove B-Roll"
                                      onPointerDown={(e) => e.stopPropagation()}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        recordSnapshot();
                                        setCues((cs) =>
                                          cs.map((c, j) =>
                                            j === i
                                              ? {
                                                  ...c,
                                                  broll_preview_url: undefined,
                                                  visual_plan: c.visual_plan
                                                    ? { ...c.visual_plan, broll_query: "" }
                                                    : undefined,
                                                }
                                              : c,
                                          ),
                                        );
                                      }}
                                    >
                                      ×
                                    </button>
                                    <span
                                      className="trim-handle end"
                                      onPointerDown={(e) =>
                                        startCuePointerDrag(e, i, "trim-end", "broll")
                                      }
                                    />
                                  </div>
                                );
                              })}
                          </div>
                        </div>
                      );
                    })}

                  {/* PREMIERE PRO AUDIO / VIDEO SPLIT BAR */}
                  <div className="nle-tracks-split-divider">
                    <div
                      className="nle-split-spacer"
                      style={{ width: TRACK_HEADER_W }}
                    >
                      <span>A / V SPLIT</span>
                      <div className="nle-split-actions">
                        <button
                          type="button"
                          className="nle-split-add-btn"
                          title="Add Video Track"
                          onClick={() => addTrack("subtitle")}
                        >
                          +V
                        </button>
                        <button
                          type="button"
                          className="nle-split-add-btn"
                          title="Add Audio Track"
                          onClick={() => addTrack("sfx")}
                        >
                          +A
                        </button>
                      </div>
                    </div>
                    <div className="nle-split-bar" />
                  </div>

                  {/* AUDIO TRACKS (A1, A2, A3... ordered top-to-bottom) */}
                  {audioTracks.map((track) => {
                    const tag = trackTag(track);
                    const isSel = selectedTrackLayer === track.id;
                    return (
                      <div
                        key={track.id}
                        data-row-track-id={track.id} className={`nle-track-row track-audio track-${track.kind} ${isSel ? "track-selected" : ""} ${track.locked ? "is-locked" : ""} ${track.muted ? "is-muted" : ""} ${track.solo ? "is-solo" : ""}`}
                        style={{ height: track.height }}
                        onClick={() => setSelectedTrackLayer(track.id)}
                      >
                        <div
                          className="nle-track-header"
                          style={{ width: TRACK_HEADER_W }}
                          onPointerDown={(e) => e.stopPropagation()}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setTrackMenu({ x: e.clientX, y: e.clientY, trackId: track.id });
                          }}
                        >
                          <span className="nle-track-grip" title="Drag to reorder track" onPointerDown={(e) => startTrackReorder(e, track.id)}>?</span>`n                          <span className={`nle-track-tag ${track.kind}`}>{tag}</span>
                          <div className="nle-track-title-wrap">
                            {renamingTrackId === track.id ? (
                              <input
                                autoFocus
                                className="nle-track-rename-input"
                                defaultValue={track.name}
                                onBlur={(e) => {
                                  updateTrack(track.id, {
                                    name: e.target.value.trim() || track.name,
                                  });
                                  setRenamingTrackId(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === "Escape") {
                                    (e.target as HTMLInputElement).blur();
                                  }
                                }}
                              />
                            ) : (
                              <span
                                className="nle-track-name"
                                title="Double-click to rename"
                                onDoubleClick={() => setRenamingTrackId(track.id)}
                              >
                                {track.name}
                              </span>
                            )}
                          </div>
                          <div className="nle-track-ctrl-group">
                            <button
                              type="button"
                              className={`nle-hdr-btn lock-btn ${track.locked ? "active" : ""}`}
                              title={
                                track.locked
                                  ? "Unlock Track (Shift+Click all)"
                                  : "Lock Track (Shift+Click all)"
                              }
                              onClick={(e) => toggleTrackFlag(e, track.id, "locked")}
                            >
                              {track.locked ? "🔒" : "🔓"}
                            </button>
                            <button
                              type="button"
                              className={`nle-hdr-btn mute-btn ${track.muted ? "active" : ""}`}
                              title="Mute Track (Shift+Click all)"
                              onClick={(e) => toggleTrackFlag(e, track.id, "muted")}
                            >
                              M
                            </button>
                            <button
                              type="button"
                              className={`nle-hdr-btn solo-btn ${track.solo ? "active" : ""}`}
                              title="Solo Track (Shift+Click all)"
                              onClick={(e) => toggleTrackFlag(e, track.id, "solo")}
                            >
                              S
                            </button>
                            <button
                              type="button"
                              className="nle-hdr-btn menu-btn"
                              title="Track options..."
                              onClick={(e) => {
                                e.stopPropagation();
                                const r = (
                                  e.currentTarget as HTMLElement
                                ).getBoundingClientRect();
                                setTrackMenu({
                                  x: r.right + 4,
                                  y: r.top,
                                  trackId: track.id,
                                });
                              }}
                            >
                              ⋮
                            </button>
                          </div>
                          <div
                            className="nle-track-height-resizer"
                            title="Drag up/down to resize track height (Alt+Scroll)"
                            onPointerDown={(e) => startTrackHeightDrag(e, track.id)}
                          />
                        </div>
                        <div
                          className={`nle-track-lane lane-${track.kind} ${track.locked ? "lane-locked" : ""} ${track.muted ? "lane-muted" : ""} ${dropTargetTrackId === track.id ? "lane-drop-target" : ""}`}
                          data-track-id={track.id}
                          data-track-kind={track.kind}
                          onPointerDown={startScrubDrag}
                        >
                          {/* Voice Track Clips */}
                          {track.kind === "voice" &&
                            (!audioFile || voiceTrackId !== track.id ? (
                              <button
                                type="button"
                                className="nle-empty-voice-btn"
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={() => {
                                  setVoiceTrackId(track.id);
                                  audioInput.current?.click();
                                }}
                              >
                                Empty Voice Track · Click to Add Voice Audio (.MP3 / .WAV)
                              </button>
                            ) : (
                              (() => {
                                const vStart = voiceClipRange?.start ?? 0;
                                const vEnd = voiceClipRange?.end ?? duration;
                                return (
                                  <div
                                    className={`nle-clip-block voice-clip ${isSel ? "active-clip" : ""}`}
                                    style={{
                                      left: `${(vStart / duration) * 100}%`,
                                      width: `${(Math.max(0.2, vEnd - vStart) / duration) * 100}%`,
                                      height: Math.max(18, track.height - 6),
                                    }}
                                    title={`Voice: ${audioFile.name} (${stamp(vStart)} → ${stamp(vEnd)}) · Drag to move, edges to trim`}
                                    onPointerDown={(e) => startVoiceClipDrag(e, "move")}
                                  >
                                    <span
                                      className="trim-handle start"
                                      title="Trim Voice Start"
                                      onPointerDown={(e) => startVoiceClipDrag(e, "trim-start")}
                                    />
                                    <div className="voice-clip-waveform">
                                      {Array.from({ length: 90 }, (_, k) => (
                                        <i
                                          key={k}
                                          style={{
                                            height: `${Math.max(4, Math.min(track.height - 10, 6 + Math.abs(Math.sin(k * 1.7) * Math.cos(k * 0.34)) * 18))}px`,
                                            opacity:
                                              vStart + (k / 90) * (vEnd - vStart) <= time
                                                ? 1
                                                : 0.42,
                                          }}
                                        />
                                      ))}
                                    </div>
                                    <span className="voice-clip-title">🎙️ {audioFile.name}</span>
                                    <button
                                      type="button"
                                      className="nle-clip-del"
                                      title="Remove Voice from sequence"
                                      onPointerDown={(e) => e.stopPropagation()}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        removeAudioFromSequence();
                                      }}
                                    >
                                      ×
                                    </button>
                                    <span
                                      className="trim-handle end"
                                      title="Trim Voice End"
                                      onPointerDown={(e) => startVoiceClipDrag(e, "trim-end")}
                                    />
                                  </div>
                                );
                              })()
                            ))}

                          {/* SFX Clips on this track */}
                          {track.kind === "sfx" &&
                            cues.map((cue, i) => {
                              const vp = cue.visual_plan;
                              if (!vp || !vp.sfx_trigger || vp.sfx_trigger === "none") return null;
                              if (resolveTrackId("sfx", vp.sfx_track_id) !== track.id) return null;
                              const sStart = vp.sfx_start ?? cue.start;
                              const sEnd =
                                vp.sfx_end ??
                                Math.min(
                                  duration,
                                  Math.max(sStart + 0.35, Math.min(cue.end, sStart + 0.65)),
                                );
                              const isCueSel =
                                selectedCue === i && selectedTrackLayer === track.id;
                              return (
                                <div
                                  key={`sfx-${i}`}
                                  className={`nle-clip-block sfx-clip sfx-${vp.sfx_trigger} ${isCueSel ? "active-clip" : ""} ${!aiSettings.enableSfx ? "muted-clip" : ""}`}
                                  style={{
                                    left: `${(sStart / duration) * 100}%`,
                                    width: `${(Math.max(0.18, sEnd - sStart) / duration) * 100}%`,
                                    height: Math.max(18, track.height - 6),
                                  }}
                                  title={`SFX: ${vp.sfx_trigger.toUpperCase()} (${stamp(sStart)} → ${stamp(sEnd)}) · Click to preview, drag to move/trim`}
                                  onPointerDown={(e) => {
                                    playSfxPreview(vp.sfx_trigger, aiSettings.sfxVolumeDb);
                                    startSubTrackClipDrag(e, i, "sfx", "move");
                                  }}
                                  onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    const order: SfxTriggerType[] = [
                                      "whoosh",
                                      "pop",
                                      "cash",
                                      "error",
                                      "click",
                                    ];
                                    const nextSfx =
                                      order[(order.indexOf(vp.sfx_trigger) + 1) % order.length] ||
                                      "whoosh";
                                    recordSnapshot();
                                    updateCueVisualPlan(i, { sfx_trigger: nextSfx });
                                    playSfxPreview(nextSfx, aiSettings.sfxVolumeDb);
                                    notify(
                                      `Changed SFX on Cue #${i + 1} to ${nextSfx.toUpperCase()}`,
                                    );
                                  }}
                                >
                                  <span
                                    className="trim-handle start"
                                    title="Trim SFX In point"
                                    onPointerDown={(e) =>
                                      startSubTrackClipDrag(e, i, "sfx", "trim-start")
                                    }
                                  />
                                  <span className="nle-clip-label">
                                    🔊 {vp.sfx_trigger.toUpperCase()}
                                  </span>
                                  <button
                                    type="button"
                                    className="nle-clip-del"
                                    title="Remove SFX from sequence"
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      recordSnapshot();
                                      updateCueVisualPlan(i, { sfx_trigger: "none" });
                                      notify(`Removed SFX from Cue #${i + 1}`);
                                    }}
                                  >
                                    ×
                                  </button>
                                  <span
                                    className="trim-handle end"
                                    title="Trim SFX Out point"
                                    onPointerDown={(e) =>
                                      startSubTrackClipDrag(e, i, "sfx", "trim-end")
                                    }
                                  />
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    );
                  })}

                  <div
                    className="playhead"
                    style={{
                      left: `calc(${TRACK_HEADER_W}px + (100% - ${TRACK_HEADER_W}px) * ${time / duration})`,
                    }}
                  >
                    <span />
                  </div>
                </div>
              </div>
            </div>

            {/* PREMIERE PRO TRACK CONTEXT MENU POPUP */}
            {trackMenu && (
              <>
                <div
                  className="nle-context-menu-backdrop"
                  onClick={() => setTrackMenu(null)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setTrackMenu(null);
                  }}
                />
                <div
                  className="nle-track-context-menu"
                  style={{ left: trackMenu.x, top: trackMenu.y }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="nle-cm-header">
                    {trackMenu.trackId ? (
                      <>
                        Track{" "}
                        <b>
                          {trackTag(trackById(trackMenu.trackId)!)} ·{" "}
                          {trackById(trackMenu.trackId)?.name}
                        </b>
                      </>
                    ) : (
                      "Sequence Track Options"
                    )}
                  </div>
                  <button
                    type="button"
                    className="nle-cm-item"
                    onClick={() => {
                      addTrack("subtitle", trackMenu.trackId, "above");
                      setTrackMenu(null);
                    }}
                  >
                    + Add Video Track (Above)
                  </button>
                  <button
                    type="button"
                    className="nle-cm-item"
                    onClick={() => {
                      addTrack("motion", trackMenu.trackId, "above");
                      setTrackMenu(null);
                    }}
                  >
                    ✨ Add Motion FX Track
                  </button>
                  <button
                    type="button"
                    className="nle-cm-item"
                    onClick={() => {
                      addTrack("broll", trackMenu.trackId, "above");
                      setTrackMenu(null);
                    }}
                  >
                    🎬 Add B-Roll Track
                  </button>
                  <div className="nle-cm-divider" />
                  <button
                    type="button"
                    className="nle-cm-item"
                    onClick={() => {
                      addTrack("voice", trackMenu.trackId, "below");
                      setTrackMenu(null);
                    }}
                  >
                    🎙️ Add Voice Audio Track
                  </button>
                  <button
                    type="button"
                    className="nle-cm-item"
                    onClick={() => {
                      addTrack("sfx", trackMenu.trackId, "below");
                      setTrackMenu(null);
                    }}
                  >
                    🔊 Add Sound FX Track
                  </button>
                  <div className="nle-cm-divider" />
                  {trackMenu.trackId && (
                    <>
                      <button
                        type="button"
                        className="nle-cm-item"
                        onClick={() => {
                          setRenamingTrackId(trackMenu.trackId);
                          setTrackMenu(null);
                        }}
                      >
                        ✏️ Rename Track
                      </button>
                      <button
                        type="button"
                        className="nle-cm-item"
                        onClick={() => {
                          resizeTracks((t) => t.id === trackMenu.trackId, 16);
                          setTrackMenu(null);
                        }}
                      >
                        ↕ Make Track Taller (+16px)
                      </button>
                      <button
                        type="button"
                        className="nle-cm-item"
                        onClick={() => {
                          resizeTracks((t) => t.id === trackMenu.trackId, -16);
                          setTrackMenu(null);
                        }}
                      >
                        ↕ Make Track Smaller (-16px)
                      </button>
                      <button
                        type="button"
                        className="nle-cm-item"
                        onClick={() => {
                          const t = trackById(trackMenu.trackId);
                          if (t) updateTrack(t.id, { height: TRACK_KIND_META[t.kind].defaultH });
                          setTrackMenu(null);
                        }}
                      >
                        ↺ Reset Track Height
                      </button>
                      <button
                        type="button"
                        className="nle-cm-item danger"
                        onClick={() => {
                          deleteTrack(trackMenu.trackId!);
                          setTrackMenu(null);
                        }}
                      >
                        🗑️ Delete Track
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="nle-cm-item"
                    onClick={() => {
                      deleteEmptyTracks();
                      setTrackMenu(null);
                    }}
                  >
                    🧹 Delete All Empty Tracks
                  </button>
                </div>
              </>
            )}

            <div className="timeline-footer">
              <span>
                <span className="track-dot" />
                Premiere Pro Multi-Track Sequence · {videoTracks.length} Video Tracks (V
                {videoTracks.length}..V1) · {audioTracks.length} Audio Tracks (A1..A
                {audioTracks.length})
              </span>
              <span>
                Active:{" "}
                <b>
                  {trackById(selectedTrackLayer)
                    ? `${trackTag(trackById(selectedTrackLayer)!)} · ${trackById(selectedTrackLayer)!.name}`
                    : selectedTrackLayer}
                </b>{" "}
                · Alt+Scroll to resize height
                <Icon name="check" size={12} />
              </span>
            </div>
          </section>
        </section>

        <aside className="inspector-panel">
          <div
            className="panel-resizer-v left-edge"
            title="Drag to resize right panel"
            onPointerDown={(e) => startPanelResize(e, "right")}
          />
          <div className="panel-heading">
            <h2>Studio inspector</h2>
            <button
              className="reset-button"
              onClick={() => {
                recordSnapshot();
                setStyle(defaults);
                setAiSettings(defaultAISettings);
              }}
            >
              Reset
            </button>
          </div>
          <div className="inspector-content">
            <section className="inspector-section ai-director-section" style={{ ...secStyle("s4"), display: SHOW_AI_DIRECTOR ? undefined : "none" }}>
              <div className="inspector-title">
                <span className="section-icon purple">
                  <Icon name="spark" size={16} />
                </span>
                <h3>AI Director & Studio FX</h3>
                <span className="ai-phase-tag">PHASE 2 + 3</span>
              </div>

              <div className="ai-engines-status">
                <span
                  className={`engine-pill ${aiEngineInfo.groq ? "active" : ""}`}
                  title="Groq Whisper-Large-v3 Word Timestamps"
                >
                  <i /> Groq Whisper
                </span>
                <span
                  className={`engine-pill ${aiEngineInfo.gemini ? "active" : ""}`}
                  title="Gemini 2.5 Flash Darija & Director"
                >
                  <i /> Gemini AI
                </span>
                <span
                  className={`engine-pill ${aiEngineInfo.unsplash ? "active" : ""}`}
                  title="Unsplash 9:16 Ken Burns Stock"
                >
                  <i /> Unsplash
                </span>
                <span
                  className={`engine-pill ${aiEngineInfo.pixabay ? "active" : ""}`}
                  title="Pixabay HD Video Stock"
                >
                  <i /> Pixabay
                </span>
              </div>

              <div className="ai-toggles-list">
                <label className="ai-toggle-row">
                  <span>
                    <strong>⚡ Kinetic Word FX</strong>
                    <small>8-frame Pop, Red Shake & Bounce</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={aiSettings.enableKineticText}
                    onChange={(e) => updateAISetting("enableKineticText", e.target.checked)}
                  />
                </label>

                <label className="ai-toggle-row">
                  <span>
                    <strong>🔥 Floating 3D Emojis</strong>
                    <small>Dynamic emoji badge above active word</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={aiSettings.enableEmojis}
                    onChange={(e) => updateAISetting("enableEmojis", e.target.checked)}
                  />
                </label>

                <label className="ai-toggle-row">
                  <span>
                    <strong>📊 Motion Graphic Cards (Optional)</strong>
                    <small>Select per caption · Drag & resize on canvas</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={aiSettings.enableMotionGraphics}
                    onChange={(e) => updateAISetting("enableMotionGraphics", e.target.checked)}
                  />
                </label>

                {(() => {
                  const targetIdx =
                    selectedCue >= 0 && selectedCue < cues.length
                      ? selectedCue
                      : cueIndex >= 0
                        ? cueIndex
                        : 0;
                  const targetCue = cues[targetIdx];
                  if (!targetCue) return null;
                  const vp = targetCue.visual_plan;
                  const suggestions = getCaptionMotionSuggestions(targetCue.text, targetIdx);
                  return (
                    <div className="inspector-motion-studio">
                      <div className="ims-header">
                        <span>
                          ✨ Motion FX for Cue #{targetIdx + 1}:{" "}
                          <b dir="auto">{targetCue.text.slice(0, 22)}</b>
                        </span>
                        {vp?.motion_graphic && vp.motion_graphic !== "none" && (
                          <button
                            type="button"
                            className="ims-clear-btn"
                            onClick={() =>
                              updateCueVisualPlan(targetIdx, { motion_graphic: "none" })
                            }
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      <div className="motion-suggestions-grid compact">
                        {suggestions.map((sug) => {
                          const isSelected = vp?.motion_graphic === sug.type;
                          return (
                            <button
                              key={sug.type}
                              type="button"
                              className={`motion-suggestion-card ${isSelected ? "selected" : ""} ${sug.recommended ? "recommended" : ""}`}
                              onClick={() => {
                                recordSnapshot();
                                updateAISetting("enableMotionGraphics", true);
                                updateCueVisualPlan(targetIdx, {
                                  motion_graphic: sug.type,
                                  graphic_text: sug.graphic_text,
                                  graphic_subtext: sug.graphic_subtext,
                                  motion_start: vp?.motion_start ?? targetCue.start,
                                  motion_end: vp?.motion_end ?? targetCue.end,
                                });
                                seek(targetCue.start + 0.05);
                                notify(`Added ${sug.label} to V3 Motion Track`);
                              }}
                            >
                              <div className="ms-card-top">
                                <span className="ms-icon">{sug.icon}</span>
                                <span className="ms-title">{sug.label}</span>
                                {sug.recommended && <span className="ms-rec-pill">Suggested</span>}
                              </div>
                              <div className="ms-preview-text" dir="auto">
                                {sug.graphic_text}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                <label className="ai-toggle-row">
                  <span>
                    <strong>🔊 Auto-SFX Audio Mixer</strong>
                    <small>Whoosh, Pop, Cash, Error & Click on Track A2</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={aiSettings.enableSfx}
                    onChange={(e) => updateAISetting("enableSfx", e.target.checked)}
                  />
                </label>

                <label className="ai-toggle-row">
                  <span>
                    <strong>🎬 Multi-Stock B-Roll BG</strong>
                    <small>Composite 9:16 stock behind captions (Track V1)</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={aiSettings.enableBroll}
                    onChange={(e) => updateAISetting("enableBroll", e.target.checked)}
                  />
                </label>
              </div>

              <div className="broll-actions-box">
                <button
                  type="button"
                  className="broll-fetch-btn"
                  disabled={fetchingBroll}
                  onClick={() => void fetchBrollPack()}
                >
                  <Icon name="download" size={14} />
                  {fetchingBroll
                    ? "Fetching 9:16 B-Roll..."
                    : "🎬 Fetch Multi-Stock B-Roll Pack"}
                </button>
                {brollZipUrl && (
                  <a
                    href={brollZipUrl}
                    download="broll_pack.zip"
                    className="broll-zip-link"
                  >
                    📦 Download B-Roll Pack (.zip)
                  </a>
                )}
              </div>
            </section>
            {SHOW_AI_DIRECTOR && secHandle("s4")}

            <section className="inspector-section" style={secStyle("s5")}>
              <div className="inspector-title">
                <span className="section-icon yellow">
                  <Icon name="box" size={16} />
                </span>
                <h3>Highlight box</h3>
                <Icon name="chevron" size={15} />
              </div>
              <div className="box-scope-row">
                <button
                  type="button"
                  className={`box-scope-btn ${boxScope === "selected" ? "active" : ""}`}
                  title="Change the box color only for the selected caption(s)"
                  onClick={() => setBoxScope("selected")}
                >
                  Selected ({boxTargets().length})
                </button>
                <button
                  type="button"
                  className={`box-scope-btn ${boxScope === "all" ? "active" : ""}`}
                  title="Change the box color for every caption"
                  onClick={() => setBoxScope("all")}
                >
                  All captions
                </button>
                <button
                  type="button"
                  className="box-scope-btn"
                  title="Select every caption"
                  onClick={() => {
                    setSelectedCues(cues.map((_, i) => i));
                    setBoxScope("selected");
                  }}
                >
                  Select all
                </button>
              </div>
              <ColorControl
                label="Box color"
                value={boxShownColor()}
                onChange={(v) => applyBoxColor(v)}
              />
              <div className="color-swatches">
                {["#FFEB00", "#A3E635", "#22D3EE", "#A78BFA", "#FB7185", "#FFFFFF"].map((c) => (
                  <button
                    key={c}
                    aria-label={`Highlight ${c}`}
                    className={boxShownColor().toLowerCase() === c.toLowerCase() ? "selected-swatch" : ""}
                    style={{ backgroundColor: c }}
                    onClick={() => applyBoxColor(c)}
                  >
                    {boxShownColor().toLowerCase() === c.toLowerCase() && <Icon name="check" size={12} />}
                  </button>
                ))}
              </div>
              {boxScope === "selected" && (
                <button
                  type="button"
                  className="box-scope-btn box-reset-btn"
                  title="Remove the custom color from the selected caption(s)"
                  onClick={() => applyBoxColor(null)}
                >
                  Reset to default color
                </button>
              )}              <Slider
                label="Corner radius"
                value={style.radius}
                min={0}
                max={50}
                onChange={(v) => update("radius", v)}
              />
              <div className="padding-grid">
                <Slider
                  label="Horizontal padding"
                  value={style.padX}
                  min={5}
                  max={50}
                  onChange={(v) => update("padX", v)}
                />
                <Slider
                  label="Vertical padding"
                  value={style.padY}
                  min={5}
                  max={50}
                  onChange={(v) => update("padY", v)}
                />
              </div>
            </section>
            {secHandle("s5")}
            <section className="inspector-section" style={secStyle("s6")}>
              <div className="inspector-title">
                <span className="section-icon purple">
                  <Icon name="type" size={17} />
                </span>
                <h3>Typography & layout</h3>
                <Icon name="chevron" size={15} />
              </div>
              <div className="caption-layout-box">
                <div className="caption-layout-group">
                  <div className="caption-layout-header">
                    <span>Words per line</span>
                    <strong>{aiSettings.wordsPerLine ?? 4} words</strong>
                  </div>
                  <div className="caption-pill-grid">
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <button
                        key={n}
                        type="button"
                        className={`caption-layout-pill ${(aiSettings.wordsPerLine ?? 4) === n ? "active" : ""}`}
                        onClick={() => updateCaptionLayout(n, aiSettings.maxLines ?? 1)}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="caption-layout-group">
                  <div className="caption-layout-header">
                    <span>Lines per caption</span>
                    <strong>{(aiSettings.maxLines ?? 1) === 2 ? "2 Lines (Stacked)" : "1 Line (Punchy)"}</strong>
                  </div>
                  <div className="caption-pill-grid two-cols">
                    <button
                      type="button"
                      className={`caption-layout-pill ${(aiSettings.maxLines ?? 1) === 1 ? "active" : ""}`}
                      onClick={() => updateCaptionLayout(aiSettings.wordsPerLine ?? 4, 1)}
                    >
                      1 Line
                    </button>
                    <button
                      type="button"
                      className={`caption-layout-pill ${(aiSettings.maxLines ?? 1) === 2 ? "active" : ""}`}
                      onClick={() => updateCaptionLayout(aiSettings.wordsPerLine ?? 4, 2)}
                    >
                      2 Lines
                    </button>
                  </div>
                </div>
              </div>
              <Slider
                label="Font size"
                value={style.size}
                min={40}
                max={140}
                onChange={(v) => update("size", v)}
              />
              <ColorControl
                label="Text color"
                value={style.text}
                onChange={(v) => update("text", v)}
              />
              <ColorControl
                label="Active word color"
                value={style.active}
                onChange={(v) => update("active", v)}
              />
              <ColorControl
                label="Stroke color"
                value={style.stroke}
                onChange={(v) => update("stroke", v)}
              />
              <Slider
                label="Stroke width"
                value={style.width}
                min={0}
                max={15}
                onChange={(v) => update("width", v)}
              />
            </section>
            {secHandle("s6")}
            <section className="inspector-section chroma-section" style={secStyle("s7")}>
              <div className="inspector-title">
                <span className="section-icon green">
                  <Icon name="screen" size={16} />
                </span>
                <h3>Chroma key background</h3>
                <Icon name="chevron" size={15} />
              </div>
              <ColorControl
                label="Background color"
                value={style.bg === "transparent" ? "#00FF00" : style.bg}
                onChange={(v) => update("bg", v)}
              />
              <div className="background-options">
                {[
                  { color: "#00FF00", name: "Green" },
                  { color: "#0000FF", name: "Blue" },
                  { color: "transparent", name: "Alpha" },
                ].map(({ color, name }) => (
                  <button
                    key={color}
                    className={style.bg === color ? "selected-bg" : ""}
                    onClick={() => update("bg", color)}
                  >
                    <span
                      className={color === "transparent" ? "checkerboard" : ""}
                      style={{ backgroundColor: color }}
                    />
                    {name}
                    {style.bg === color && (
                      <span className="bg-check">
                        <Icon name="check" size={10} />
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <Slider
                label="Vertical position"
                value={style.y}
                min={10}
                max={90}
                unit="%"
                onChange={(v) => update("y", v)}
              />
              <div className="inspector-tip">
                <Icon name="spark" size={15} />
                <p>
                  Built for your next viral video.
                  <br />
                  <span>Export, key out, and make it yours.</span>
                </p>
              </div>
            </section>
            {secHandle("s7")}
          </div>
          <div className="render-footer">
            {rendering && (
              <div className="footer-render-state" aria-live="polite">
                <span>Rendering your captions & AI FX</span>
                <strong>{Math.floor(progress)}%</strong>
              </div>
            )}
            {rendering && (
              <div
                className="render-progress"
                role="progressbar"
                aria-label="Video render progress"
                aria-valuenow={Math.floor(progress)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <span style={{ width: `${progress}%` }} />
              </div>
            )}
            {lastJobDownloads && !rendering && (
              <div className="render-downloads-bar">
                {lastJobDownloads.videoUrl && (
                  <a href={lastJobDownloads.videoUrl} download className="dl-pill">
                    🎬 Video
                  </a>
                )}
                {lastJobDownloads.sfxUrl && (
                  <a href={lastJobDownloads.sfxUrl} download="sfx_track.wav" className="dl-pill">
                    🔊 SFX (.wav)
                  </a>
                )}
                {lastJobDownloads.srtUrl && (
                  <a href={lastJobDownloads.srtUrl} download="captions.srt" className="dl-pill">
                    📝 .SRT
                  </a>
                )}
                {lastJobDownloads.brollZipUrl && (
                  <a href={lastJobDownloads.brollZipUrl} download="broll.zip" className="dl-pill">
                    📦 B-Roll (.zip)
                  </a>
                )}
              </div>
            )}
            <button
              className={`export-button inspector-export ${rendering ? "render-cancel" : ""}`}
              onClick={() => {
                if (rendering) cancelRender.current = true;
                else setModal("export");
              }}
            >
              <Icon name={rendering ? "close" : "download"} size={16} />
              {rendering
                ? "Cancel render"
                : style.bg === "transparent"
                  ? "Render Transparent Video (.mov)"
                  : "Render Green Screen Video (.mp4)"}
            </button>
            <p>
              {style.bg === "transparent"
                ? "1080 × 1920 · 60 FPS · Transparent Alpha (.mov)"
                : "1080 × 1920 · 60 FPS · Chroma Key (.mp4)"}
            </p>
          </div>
        </aside>
      </main>
      <footer className="statusbar">
        <span>
          <span className="status-indicator" />
          All systems ready<span className="status-separator">|</span>Local processing
        </span>
        <span>
          Made for the words that matter.<span className="footer-arabic">كلماتك، أقوى.</span>
        </span>
        <button onClick={() => setModal("help")}>
          Keyboard shortcuts<kbd>?</kbd>
        </button>
      </footer>
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          muted={muted || !voiceAudible}
          onLoadedMetadata={() => {
            if (audioRef.current) {
              const dur = Number.isFinite(audioRef.current.duration)
                ? audioRef.current.duration
                : 0;
              setAudioDuration(dur);
              if (dur > 0) {
                setVoiceClipRange({ start: 0, end: Number(dur.toFixed(2)) });
              }
              audioRef.current.currentTime = time;
            }
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <Icon name="check" size={16} />
          {toast}
          <button aria-label="Dismiss notification" onClick={() => setToast("")}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!rendering) setModal(null);
          }}
        >
          <div
            className={`modal ${modal === "help" ? "shortcuts-modal" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={modal === "help" ? "Premiere Pro Keyboard Shortcuts" : "Export video"}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="Close dialog"
              onClick={() => {
                if (rendering) cancelRender.current = true;
                else setModal(null);
              }}
            >
              <Icon name="close" />
            </button>
            {modal === "help" ? (
              <>
                <h2>Premiere Pro Keyboard Shortcuts</h2>
                <p>
                  Full NLE sequence control for splitting, trimming, J-K-L shuttling, and word-level timing.
                </p>
                <div className="shortcuts-grid">
                  <div className="shortcut-group">
                    <h4>J-K-L & Transport</h4>
                    <div className="shortcut-row">
                      <span>Play / Pause</span>
                      <span className="shortcut-keys"><kbd>Space</kbd></span>
                    </div>
                    <div className="shortcut-row">
                      <span>Stop / Pause</span>
                      <span className="shortcut-keys"><kbd>K</kbd></span>
                    </div>
                    <div className="shortcut-row">
                      <span>Shuttle forward (1x → 1.5x → 2x → 4x)</span>
                      <span className="shortcut-keys"><kbd>L</kbd></span>
                    </div>
                    <div className="shortcut-row">
                      <span>Shuttle reverse (-1x → -2x → -4x)</span>
                      <span className="shortcut-keys"><kbd>J</kbd></span>
                    </div>
                    <div className="shortcut-row">
                      <span>Slow-motion forward (0.5x)</span>
                      <span className="shortcut-keys"><kbd>Shift</kbd><kbd>L</kbd></span>
                    </div>
                    <div className="shortcut-row">
                      <span>Play around playhead (-2s)</span>
                      <span className="shortcut-keys"><kbd>Shift</kbd><kbd>K</kbd></span>
                    </div>
                    <div className="shortcut-row">
                      <span>Start / End of sequence</span>
                      <span className="shortcut-keys"><kbd>Home</kbd><kbd>End</kbd></span>
                    </div>
                  </div>
                  <div className="shortcut-group">
                    <h4>Frame & Edit Navigation</h4>
                    <div className="shortcut-row">
                      <span>Step 1 frame (1/60s)</span>
                      <span className="shortcut-keys"><kbd>←</kbd><kbd>→</kbd></span>
                    </div>
                    <div className="shortcut-row">
                      <span>Step 5 frames</span>
                      <span className="shortcut-keys"><kbd>Shift</kbd><kbd>← / →</kbd></span>
                    </div>
                    <div className="shortcut-row">
                      <span>Previous / Next cue edit point</span>
                      <span className="shortcut-keys"><kbd>↑</kbd><kbd>↓</kbd></span>
                    </div>
                    <div className="shortcut-row">
                      <span>Previous / Next word in cue</span>
                      <span className="shortcut-keys"><kbd>[</kbd><kbd>]</kbd></span>
                    </div>
                    <div className="shortcut-row">
                      <span>Edit active cue text</span>
                      <span className="shortcut-keys"><kbd>T</kbd> / <kbd>Enter</kbd></span>
                    </div>
                    <div className="shortcut-row">
                      <span>Exit text field to timeline</span>
                      <span className="shortcut-keys"><kbd>Esc</kbd></span>
                    </div>
                  </div>
                  <div className="shortcut-group">
                    <h4>Cue Splitting, Trimming & Nudge</h4>
                    <div className="shortcut-row">
                      <span>Razor / Split cue at playhead</span>
                      <span className="shortcut-keys"><kbd>Ctrl</kbd><kbd>K</kbd> / <kbd>C</kbd></span>
                    </div>
                    <div className="shortcut-row">
                      <span>Insert new cue at playhead</span>
                      <span className="shortcut-keys"><kbd>N</kbd></span>
                    </div>
                    <div className="shortcut-row">
                      <span>Delete cue (Lift)</span>
                      <span className="shortcut-keys"><kbd>Del</kbd></span>
                    </div>
                    <div className="shortcut-row">
                      <span>Ripple Delete cue (close gap)</span>
                      <span className="shortcut-keys"><kbd>Shift</kbd><kbd>Del</kbd></span>
                    </div>
                    <div className="shortcut-row">
                      <span>Extend cue edge to playhead</span>
                      <span className="shortcut-keys"><kbd>E</kbd></span>
                    </div>
                    <div className="shortcut-row">
                      <span>Merge cue with next cue</span>
                      <span className="shortcut-keys"><kbd>Ctrl</kbd><kbd>J</kbd></span>
                    </div>
                    <div className="shortcut-row">
                      <span>Nudge cue ±0.05s (±0.25s w/ Shift)</span>
                      <span className="shortcut-keys"><kbd>Alt</kbd><kbd>← / →</kbd></span>
                    </div>
                    <div className="shortcut-row">
                      <span>Trim cue Out point ±0.05s</span>
                      <span className="shortcut-keys"><kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>← / →</kbd></span>
                    </div>
                  </div>
                  <div className="shortcut-group">
                    <h4>In/Out, Zoom & Project</h4>
                    <div className="shortcut-row">
                      <span>Mark In / Out point</span>
                      <span className="shortcut-keys"><kbd>I</kbd><kbd>O</kbd></span>
                    </div>
                    <div className="shortcut-row">
                      <span>Clear In & Out points</span>
                      <span className="shortcut-keys"><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>X</kbd></span>
                    </div>
                    <div className="shortcut-row">
                      <span>Toggle Loop playback</span>
                      <span className="shortcut-keys"><kbd>Ctrl</kbd><kbd>L</kbd></span>
                    </div>
                    <div className="shortcut-row">
                      <span>Toggle Magnetic Snapping</span>
                      <span className="shortcut-keys"><kbd>S</kbd></span>
                    </div>
                    <div className="shortcut-row">
                      <span>Timeline Zoom In / Out / Fit</span>
                      <span className="shortcut-keys"><kbd>=</kbd><kbd>-</kbd><kbd>\</kbd></span>
                    </div>
                    <div className="shortcut-row">
                      <span>Undo / Redo (style + timeline)</span>
                      <span className="shortcut-keys"><kbd>Ctrl+Z</kbd><kbd>Ctrl+Shift+Z</kbd></span>
                    </div>
                    <div className="shortcut-row">
                      <span>Export edited .SRT / Export MP4</span>
                      <span className="shortcut-keys"><kbd>Ctrl+Shift+S</kbd><kbd>Ctrl+M</kbd></span>
                    </div>
                    <div className="shortcut-row">
                      <span>Fullscreen Monitor / Mute</span>
                      <span className="shortcut-keys"><kbd>~</kbd><kbd>M</kbd></span>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <span className="modal-icon">
                  <Icon name="download" size={25} />
                </span>
                <h2>Ready for the spotlight?</h2>
                <p>
                  Choose between a solid Chroma Key <strong>.mp4</strong> or a true transparent Alpha{" "}
                  <strong>.mov</strong> ready for Adobe Premiere Pro.
                </p>
                <div className="background-options" style={{ marginTop: "16px", marginBottom: "4px" }}>
                  {[
                    { color: "#00FF00", name: "Green (.mp4)" },
                    { color: "#0000FF", name: "Blue (.mp4)" },
                    { color: "transparent", name: "Transparent (.mov)" },
                  ].map(({ color, name }) => (
                    <button
                      key={color}
                      className={style.bg === color ? "selected-bg" : ""}
                      onClick={() => update("bg", color)}
                    >
                      <span
                        className={color === "transparent" ? "checkerboard" : ""}
                        style={{ backgroundColor: color }}
                      />
                      {name}
                      {style.bg === color && (
                        <span className="bg-check">
                          <Icon name="check" size={10} />
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <div className="export-summary">
                  <span>
                    Format
                    <strong>
                      {style.bg === "transparent" ? "MOV · RGBA Alpha" : "MP4 · H.264"}
                    </strong>
                  </span>
                  <span>
                    Resolution<strong>1080 × 1920 · 60fps</strong>
                  </span>
                  <span>
                    Duration<strong>{stamp(duration)}</strong>
                  </span>
                </div>
                <p className="export-note">
                  {style.bg === "transparent"
                    ? "Exports a lossless RGBA QuickTime (.mov) with transparent background and soft alpha drop shadows — drop directly onto Track V2 in Premiere Pro without Ultra Key."
                    : "Exports a broadcast BT.709 H.264 (.mp4) with a solid chroma-key background."}
                </p>
                <button
                  className="export-button modal-export"
                  onClick={() => void renderVideo()}
                >
                  <Icon name="download" size={17} />
                  {style.bg === "transparent"
                    ? "Render & download Transparent (.mov)"
                    : "Render & download Chroma Key (.mp4)"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}


