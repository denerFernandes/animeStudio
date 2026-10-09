import { type MouthCue, cuesFromText, mergeCues } from "@animestudio/core";

export interface AlignOptions {
  /** Analysis window in seconds (default 0.02). */
  window?: number;
  /** RMS threshold relative to the peak below which audio counts as silence (default 0.05). */
  threshold?: number;
  /** Silences shorter than this are bridged (default 0.12 s). */
  minGap?: number;
}

/** Detects voiced [start, end] segments (seconds) in mono PCM audio. */
export function voicedSegments(samples: Float32Array, sampleRate: number, opts: AlignOptions = {}): [number, number][] {
  const win = Math.max(1, Math.round((opts.window ?? 0.02) * sampleRate));
  const rms: number[] = [];
  for (let i = 0; i < samples.length; i += win) {
    let s = 0;
    const end = Math.min(samples.length, i + win);
    for (let j = i; j < end; j++) s += samples[j] * samples[j];
    rms.push(Math.sqrt(s / Math.max(1, end - i)));
  }
  const peak = Math.max(1e-9, ...rms);
  const thr = (opts.threshold ?? 0.05) * peak;
  const dt = win / sampleRate;
  const segs: [number, number][] = [];
  rms.forEach((v, i) => {
    if (v < thr) return;
    const last = segs[segs.length - 1];
    if (last && i * dt - last[1] <= (opts.minGap ?? 0.12)) last[1] = (i + 1) * dt;
    else segs.push([i * dt, (i + 1) * dt]);
  });
  return segs;
}

/**
 * Aligns known text to recorded/TTS audio without external tools: words are distributed over
 * the voiced segments of the audio (proportionally to their length) and the mouth rests during
 * silences. A good default when Rhubarb is not installed and the provider gives no timestamps.
 */
export function alignTextToAudio(text: string, samples: Float32Array, sampleRate: number, opts: AlignOptions = {}): MouthCue[] {
  const total = samples.length / sampleRate;
  const segs = voicedSegments(samples, sampleRate, opts);
  if (!segs.length) return [{ start: 0, end: total, value: "X" }];

  const words = text.split(/\s+/).filter(Boolean);
  const weights = words.map((w) => w.replace(/[^\p{L}\p{N}]/gu, "").length + 1);
  const totalW = weights.reduce((a, b) => a + b, 0);
  const lengths = segs.map(([a, b]) => b - a);
  const totalT = lengths.reduce((a, b) => a + b, 0);

  // Each word goes to the voiced segment containing its proportional midpoint.
  const groups: string[][] = segs.map(() => []);
  let acc = 0;
  words.forEach((w, i) => {
    let t = ((acc + weights[i] / 2) / totalW) * totalT;
    acc += weights[i];
    let k = 0;
    while (k < segs.length - 1 && t > lengths[k]) t -= lengths[k++];
    groups[k].push(w);
  });

  const cues: MouthCue[] = [];
  let cursor = 0;
  segs.forEach(([s0, s1], k) => {
    if (s0 > cursor) cues.push({ start: cursor, end: s0, value: "X" });
    if (groups[k].length) {
      // Clip to the voiced segment (drops the trailing rest cue, keeps cues contiguous).
      const sub = cuesFromText(groups[k].join(" "), { start: s0, duration: s1 - s0 }).filter((c) => c.start < s1 - 1e-9);
      if (sub.length) sub[sub.length - 1].end = s1;
      cues.push(...sub);
    } else {
      cues.push({ start: s0, end: s1, value: "B" });
    }
    cursor = s1;
  });
  cues.push({ start: cursor, end: Math.max(total, cursor + 0.1), value: "X" });
  return mergeCues(cues.filter((c) => c.end > c.start));
}
