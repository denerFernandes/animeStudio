import type { MouthCue, Viseme } from "./format/schema";

/**
 * Pure lip sync helpers producing Rhubarb-style mouth cues (Preston Blair visemes).
 * These are heuristics designed to look natural in cartoon animation; for the best accuracy
 * on recorded audio use Rhubarb (see `@animestudio/lipsync/node`).
 */

const DIGRAPHS: Record<string, Viseme> = {
  th: "B",
  sh: "B",
  ch: "B",
  ph: "G",
  oo: "F",
  ee: "B",
  qu: "F",
  lh: "H",
  nh: "B",
  rr: "B",
  ou: "E",
  ow: "E",
  wh: "F",
};

const VOWELS: Record<string, Viseme> = { a: "D", e: "C", i: "B", y: "B", o: "E", u: "F" };

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export interface GraphemeUnit {
  viseme: Viseme | null;
  /** Relative duration weight. */
  weight: number;
  /** Number of source characters consumed. */
  length: number;
  pause: boolean;
}

/** Splits text into viseme units (handles common English and Portuguese digraphs). */
export function textToUnits(text: string): GraphemeUnit[] {
  const s = stripAccents(text.toLowerCase());
  const out: GraphemeUnit[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    const pair = s.slice(i, i + 2);
    if (DIGRAPHS[pair]) {
      const v = DIGRAPHS[pair];
      out.push({ viseme: v, weight: v === "F" || v === "E" ? 1 : 0.7, length: 2, pause: false });
      i += 2;
      continue;
    }
    if (ch in VOWELS) out.push({ viseme: VOWELS[ch], weight: 1, length: 1, pause: false });
    else if ("mbp".includes(ch)) out.push({ viseme: "A", weight: 0.6, length: 1, pause: false });
    else if ("fv".includes(ch)) out.push({ viseme: "G", weight: 0.6, length: 1, pause: false });
    else if (ch === "l") out.push({ viseme: "H", weight: 0.55, length: 1, pause: false });
    else if (ch === "w") out.push({ viseme: "F", weight: 0.7, length: 1, pause: false });
    else if (/[a-z]/.test(ch)) out.push({ viseme: "B", weight: 0.5, length: 1, pause: false });
    else if (/[0-9]/.test(ch)) out.push({ viseme: "C", weight: 1.2, length: 1, pause: false });
    else if (".!?;:".includes(ch)) out.push({ viseme: "X", weight: 3.5, length: 1, pause: true });
    else if (",".includes(ch)) out.push({ viseme: "X", weight: 2, length: 1, pause: true });
    else out.push({ viseme: null, weight: 0.15, length: 1, pause: false }); // spaces, symbols
    i += 1;
  }
  return out;
}

/** Merges consecutive equal visemes and drops cues shorter than `minDuration`. */
export function mergeCues(cues: MouthCue[], minDuration = 1 / 30): MouthCue[] {
  const merged: MouthCue[] = [];
  for (const c of cues) {
    const last = merged[merged.length - 1];
    if (last && last.value === c.value) last.end = c.end;
    else merged.push({ ...c });
  }
  // Absorb very short cues into their predecessor to avoid flicker.
  const out: MouthCue[] = [];
  for (const c of merged) {
    const last = out[out.length - 1];
    if (last && c.end - c.start < minDuration) last.end = c.end;
    else if (last && last.value === c.value) last.end = c.end;
    else out.push(c);
  }
  return out;
}

export interface TextCueOptions {
  /** Start time in seconds (default 0). */
  start?: number;
  /** Total speech duration; default estimates ~13 characters per second. */
  duration?: number;
}

/** Generates mouth cues from text spread over a duration (TTS without timestamps, quick drafts). */
export function cuesFromText(text: string, opts: TextCueOptions = {}): MouthCue[] {
  const start = opts.start ?? 0;
  const units = textToUnits(text.trim());
  const duration = opts.duration ?? Math.max(0.3, text.trim().length / 13);
  const total = units.reduce((a, u) => a + u.weight, 0) || 1;
  const cues: MouthCue[] = [];
  let t = start;
  let prev: Viseme = "X";
  for (const u of units) {
    const d = (u.weight / total) * duration;
    const v = u.viseme ?? prev;
    cues.push({ start: t, end: t + d, value: v });
    if (u.viseme) prev = u.viseme;
    t += d;
  }
  cues.push({ start: t, end: t + 0.1, value: "X" });
  return mergeCues(cues);
}

/** ElevenLabs-style character alignment. */
export interface CharacterAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/** Generates mouth cues from TTS character timestamps (e.g. ElevenLabs `with-timestamps`). */
export function cuesFromAlignment(alignment: CharacterAlignment, offset = 0): MouthCue[] {
  const chars = alignment.characters;
  const cues: MouthCue[] = [{ start: offset, end: offset + (alignment.character_start_times_seconds[0] ?? 0), value: "X" }];
  let i = 0;
  let prev: Viseme = "X";
  while (i < chars.length) {
    const [unit] = textToUnits(chars.slice(i, i + 2).join(""));
    const len = Math.max(1, Math.min(unit?.length ?? 1, chars.length - i));
    const start = offset + alignment.character_start_times_seconds[i];
    const end = offset + alignment.character_end_times_seconds[i + len - 1];
    let v: Viseme = unit?.viseme ?? prev;
    if (unit?.pause && end - start < 0.12) v = prev; // short punctuation: keep the mouth moving
    cues.push({ start, end, value: v });
    if (unit?.viseme && !unit.pause) prev = unit.viseme;
    i += len;
  }
  const last = cues[cues.length - 1];
  cues.push({ start: last.end, end: last.end + 0.1, value: "X" });
  return mergeCues(cues.filter((c) => c.end > c.start));
}

export interface AmplitudeCueOptions {
  /** Analysis window in seconds (default 1/30). */
  window?: number;
  /** Normalized RMS below which the mouth rests (default 0.06). */
  silence?: number;
  offset?: number;
}

/** The least a loudness-driven mouth shape is held (two frames at 30 fps): no flicker. */
const AMPLITUDE_HOLD = 2 / 30;

/**
 * Generates mouth cues from raw mono PCM samples by loudness — a dependency-free fallback
 * when neither Rhubarb nor timestamps are available. Loudness is measured per `window`; a mouth
 * shape is chosen per hold of whole windows at least `AMPLITUDE_HOLD` long (from the hold's mean
 * level, varied hold by hold), so the variety survives the merge of short cues.
 */
export function cuesFromAmplitude(samples: Float32Array, sampleRate: number, opts: AmplitudeCueOptions = {}): MouthCue[] {
  const win = Math.max(1, Math.round((opts.window ?? 1 / 30) * sampleRate));
  const silence = opts.silence ?? 0.06;
  const offset = opts.offset ?? 0;
  const rms: number[] = [];
  let peak = 1e-9;
  for (let i = 0; i < samples.length; i += win) {
    let sum = 0;
    const end = Math.min(samples.length, i + win);
    for (let j = i; j < end; j++) sum += samples[j] * samples[j];
    const r = Math.sqrt(sum / Math.max(1, end - i));
    rms.push(r);
    if (r > peak) peak = r;
  }
  // Light smoothing so the mouth doesn't chatter.
  const level = rms.map((_, i) => ((rms[i - 1] ?? rms[i]) + 2 * rms[i] + (rms[i + 1] ?? rms[i])) / 4 / peak);
  const dt = win / sampleRate;
  const hold = Math.max(1, Math.ceil(AMPLITUDE_HOLD / dt - 1e-9));
  const cues: MouthCue[] = [];
  for (let i = 0, g = 0; i < level.length; i += hold, g++) {
    const end = Math.min(level.length, i + hold);
    let l = 0;
    for (let j = i; j < end; j++) l += level[j];
    l /= end - i;
    let v: Viseme;
    if (l < silence) v = "X";
    else if (l < 0.22) v = g % 3 === 0 ? "A" : "B";
    else if (l < 0.45) v = g % 4 === 1 ? "E" : "C";
    else v = g % 5 === 2 ? "E" : "D";
    cues.push({ start: offset + i * dt, end: offset + end * dt, value: v });
  }
  // (Only a trailing remainder is shorter than a hold: it joins the cue before it.)
  return mergeCues(cues, (hold - 0.5) * dt);
}
