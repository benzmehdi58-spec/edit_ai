export type AspectRatio = "9:16" | "16:9" | "1:1";
export type TargetLanguage = "darija_mixed" | "ar_fusha" | "fr" | "en";
export type EmphasisType = "normal" | "pop" | "shake_red" | "bounce";
export type MotionGraphicType =
  | "none"
  | "spotlight"
  | "stat_badge"
  | "mistake_stamp"
  | "solution_stamp"
  | "step_badge"
  | "notification_toast"
  | "cta_bio"
  | "cta_follow"
  | "neon_tape";
export type SfxTriggerType = "none" | "whoosh" | "pop" | "cash" | "error" | "click";

export interface WordTiming {
  word: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface VisualCuePlan {
  cue_index?: number;
  emphasis_type: EmphasisType;
  emoji_or_icon: string;
  broll_query: string;
  motion_graphic: MotionGraphicType;
  graphic_text: string;
  graphic_subtext?: string;
  motion_start?: number;
  motion_end?: number;
  motion_x?: number;
  motion_y?: number;
  motion_scale?: number;
  sfx_trigger: SfxTriggerType;
  sfx_start?: number;
  sfx_end?: number;
  motion_track_id?: string;
  sfx_track_id?: string;
  broll_track_id?: string;
  highlight_color_override?: string;
}

export type TrackKind = "motion" | "subtitle" | "broll" | "voice" | "sfx";

export interface SequenceTrack {
  id: string;
  kind: TrackKind;
  name: string;
  height: number;
  locked: boolean;
  hidden: boolean;
  muted: boolean;
  solo: boolean;
}

export interface BrollClipInfo {
  cue_index: number;
  query: string;
  provider?: string;
  clip_path: string;
  preview_url: string;
  width: number;
  height: number;
  duration: number;
}

export interface CueItem {
  start: number;
  end: number;
  text: string;
  words?: WordTiming[];
  visual_plan?: VisualCuePlan;
  broll_clip_path?: string;
  broll_preview_url?: string;
  track_id?: string;
}

export interface StyleConfig {
  box: string;
  text: string;
  active: string;
  stroke: string;
  width: number;
  radius: number;
  padX: number;
  padY: number;
  size: number;
  y: number;
  bg: string;
  wordsPerLine?: number;
  maxLines?: number;
}

export interface AISettingsConfig {
  targetLanguage: TargetLanguage;
  wordsPerLine?: number;
  maxLines?: number;
  enableKineticText: boolean;
  enableEmojis: boolean;
  enableMotionGraphics: boolean;
  enableSfx: boolean;
  enableBroll: boolean;
  sfxVolumeDb: number;
}

export interface MedSubProject {
  id: string;
  name: string;
  preset: AspectRatio;
  createdAt: string;
  updatedAt: string;
  cues: CueItem[];
  style: StyleConfig;
  font: string;
  customFont?: string;
  customFontKey?: string;
  audioFileName?: string;
  srtFileName?: string;
  filePath?: string;
  aiSettings?: AISettingsConfig;
  tracks?: SequenceTrack[];
}

export interface RecentProjectItem {
  id: string;
  name: string;
  preset: AspectRatio;
  updatedAt: string;
  cueCount: number;
  previewText: string;
  filePath?: string;
  data: MedSubProject;
}

export interface ElectronAPI {
  isElectron: boolean;
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  showOpenProjectDialog: () => Promise<{ filePath: string; content: MedSubProject } | null>;
  showSaveProjectDialog: (defaultName: string) => Promise<string | null>;
  saveFile: (filePath: string, data: MedSubProject) => Promise<{ success: boolean; error?: string }>;
  readFile: (filePath: string) => Promise<{ success: boolean; content?: MedSubProject; error?: string }>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
