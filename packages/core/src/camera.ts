import { type Ease, getEasing } from "./easing";
import { type Mat, type Vec2, apply, clamp, formatNumber as f, lerp, noise1 } from "./math";
import { sampleCenterline } from "./paths";
import type { Rig } from "./rig";

/**
 * Advanced camera: smoothed follows (dead zone, look-ahead), automatic framing, curved paths,
 * punch-in zooms, handheld drift, dolly ("vertigo") zoom, scene bounds, depth of field and motion
 * blur. Everything is deterministic: stateful smoothing is baked at a fixed rate and cached.
 */

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
  rotation: number;
  /** Background scale relative to the subject (parallax depth): > 0 = vertigo "dolly out". */
  dolly: number;
  /** Depth (parallax) in focus. */
  focus: number;
  /** Max depth-of-field blur in screen px (0 = off). */
  blur: number;
  /** Depth distance at which blur reaches `blur`. */
  focusRange: number;
  /** Motion blur shutter (0 = off, 1 = full frame). */
  motionBlur: number;
}

export interface CameraFollow {
  actor: string;
  start: number;
  end: number;
  offset: Vec2;
  lag: number;
  axes: "x" | "xy";
  /** Half size (scene px) of the zone the actor can move in without moving the camera. */
  deadZone: Vec2;
  /** Seconds of velocity to lead by (frames the space the actor moves into). */
  lookAhead: number;
  blend: number;
  /** Lazily baked camera positions at 60 Hz. */
  samples?: Float64Array;
}

export interface CameraFrame {
  targets: string[];
  start: number;
  end: number;
  padding: number;
  blend: number;
  minZoom: number;
  maxZoom: number;
  /** Smoothing lag (s): framing eases towards its target instead of popping (e.g. on a flip). */
  lag: number;
  /** Frame whole bodies (default) or just the faces. */
  on?: "body" | "face";
  /** Fixed vertical extent [top, bottom] of the framed box (horizontal framing only). */
  band?: [number, number];
  /** Lazily baked smoothed framing [x, y, zoom] at 60 Hz. */
  samples?: Float64Array;
}

/** Bakes a frame rig's smoothed target (x, y, log-zoom exponential smoothing). */
export function bakeFrame(frame: CameraFrame, duration: number, fitAt: (t: number) => { x: number; y: number; zoom: number } | null): Float64Array {
  const n = Math.max(1, Math.ceil((duration - frame.start) * FOLLOW_RATE) + 1);
  const out = new Float64Array(n * 3);
  const dt = 1 / FOLLOW_RATE;
  const k = frame.lag > 0 ? 1 - Math.exp(-dt / frame.lag) : 1;
  let cur: { x: number; y: number; z: number } | null = null;
  for (let i = 0; i < n; i++) {
    const fit = fitAt(frame.start + i * dt);
    if (fit) {
      const target = { x: fit.x, y: fit.y, z: Math.log(fit.zoom) };
      if (!cur) cur = target;
      else cur = { x: cur.x + (target.x - cur.x) * k, y: cur.y + (target.y - cur.y) * k, z: cur.z + (target.z - cur.z) * k };
    }
    out[i * 3] = cur?.x ?? NaN;
    out[i * 3 + 1] = cur?.y ?? NaN;
    out[i * 3 + 2] = cur ? Math.exp(cur.z) : NaN;
  }
  return out;
}

export function sampleFrame(samples: Float64Array, start: number, t: number): { x: number; y: number; zoom: number } | null {
  const n = samples.length / 3;
  const u = clamp((t - start) * FOLLOW_RATE, 0, n - 1);
  const i = Math.floor(u);
  const j = Math.min(n - 1, i + 1);
  const fr = u - i;
  const x = lerp(samples[i * 3], samples[j * 3], fr);
  if (Number.isNaN(x)) return null;
  return { x, y: lerp(samples[i * 3 + 1], samples[j * 3 + 1], fr), zoom: lerp(samples[i * 3 + 2], samples[j * 3 + 2], fr) };
}

export interface CameraPath {
  start: number;
  duration: number;
  ease: Ease;
  /** Points including the starting position. */
  points: Vec2[];
}

export interface CameraPunch {
  start: number;
  duration: number;
  amount: number;
}

export interface CameraBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const FOLLOW_RATE = 60;

/** Bakes a follow's smoothed camera position (dead zone, look-ahead, exponential lag). */
export function bakeFollow(
  follow: CameraFollow,
  duration: number,
  actorPosition: (t: number) => Vec2,
): Float64Array {
  const end = Math.min(duration, Number.isFinite(follow.end) ? follow.end + follow.blend : duration);
  const n = Math.max(1, Math.ceil((end - follow.start) * FOLLOW_RATE) + 1);
  const out = new Float64Array(n * 2);
  const dt = 1 / FOLLOW_RATE;
  const desired = (t: number): Vec2 => {
    const p = actorPosition(t);
    const q = actorPosition(Math.max(0, t - dt));
    const vx = (p[0] - q[0]) / dt;
    const vy = (p[1] - q[1]) / dt;
    return [p[0] + follow.offset[0] + vx * follow.lookAhead, p[1] + follow.offset[1] + vy * follow.lookAhead];
  };
  let cam = desired(follow.start);
  const k = follow.lag > 0 ? 1 - Math.exp(-dt / follow.lag) : 1;
  for (let i = 0; i < n; i++) {
    const t = follow.start + i * dt;
    const d = desired(t);
    const goal: Vec2 = [cam[0], cam[1]];
    for (const axis of [0, 1] as const) {
      const delta = d[axis] - cam[axis];
      const zone = follow.deadZone[axis];
      if (Math.abs(delta) > zone) goal[axis] = d[axis] - Math.sign(delta) * zone;
    }
    cam = [cam[0] + (goal[0] - cam[0]) * k, cam[1] + (goal[1] - cam[1]) * k];
    out[i * 2] = cam[0];
    out[i * 2 + 1] = cam[1];
  }
  return out;
}

export function sampleFollow(samples: Float64Array, start: number, t: number): Vec2 {
  const n = samples.length / 2;
  const u = clamp((t - start) * FOLLOW_RATE, 0, n - 1);
  const i = Math.floor(u);
  const j = Math.min(n - 1, i + 1);
  const fr = u - i;
  return [lerp(samples[i * 2], samples[j * 2], fr), lerp(samples[i * 2 + 1], samples[j * 2 + 1], fr)];
}

/** Weight of a timed camera rig (ramps in after `start`, out after `end`). */
export function rigWeight(start: number, end: number, blend: number, t: number): number {
  if (t < start) return 0;
  const wIn = blend > 0 ? clamp((t - start) / blend, 0, 1) : 1;
  const wOut = Number.isFinite(end) ? (blend > 0 ? 1 - clamp((t - end) / blend, 0, 1) : t < end ? 1 : 0) : 1;
  return getEasing("sineInOut")(Math.min(wIn, wOut));
}

/** Bounding box of a character in setup space (bones + margin), cached per rig. */
const bboxCache = new WeakMap<Rig, [number, number, number, number]>();
export function rigBounds(rig: Rig): [number, number, number, number] {
  let b = bboxCache.get(rig);
  if (!b) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const bone of rig.bones) {
      for (const p of [apply(bone.setupWorld, [0, 0]), apply(bone.setupWorld, [bone.length, 0])]) {
        minX = Math.min(minX, p[0]);
        minY = Math.min(minY, p[1]);
        maxX = Math.max(maxX, p[0]);
        maxY = Math.max(maxY, p[1]);
      }
    }
    const m = 30;
    b = [minX - m, Math.min(minY - m, -m), maxX + m, Math.max(maxY, 0) + m / 3];
    bboxCache.set(rig, b);
  }
  return b;
}

/** Camera center/zoom that fits a scene-space box with padding. */
export function fitBox(box: [number, number, number, number], width: number, height: number, padding: number, minZoom: number, maxZoom: number) {
  const w = Math.max(1, box[2] - box[0] + padding * 2);
  const h = Math.max(1, box[3] - box[1] + padding * 2);
  const zoom = clamp(Math.min(width / w, height / h), minZoom, maxZoom);
  return { x: (box[0] + box[2]) / 2, y: (box[1] + box[3]) / 2, zoom };
}

/** Point along a smooth path through `points` at normalized progress u. */
export function pathPoint(points: Vec2[], u: number): Vec2 {
  if (points.length === 1) return points[0];
  const per = 24;
  const pts = sampleCenterline(points, 1, per);
  // Arc-length parameterization so speed follows the easing, not the point spacing.
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const target = clamp(u, 0, 1) * lens[lens.length - 1];
  let i = 1;
  while (i < lens.length - 1 && lens[i] < target) i++;
  const seg = lens[i] - lens[i - 1] || 1;
  const fr = (target - lens[i - 1]) / seg;
  return [lerp(pts[i - 1][0], pts[i][0], fr), lerp(pts[i - 1][1], pts[i][1], fr)];
}

/** Zoom multiplier of a punch-in: fast attack, springy settle. */
export function punchFactor(p: CameraPunch, t: number): number {
  const u = (t - p.start) / p.duration;
  if (u < 0 || u > 1) return 1;
  const attack = 0.18;
  const env = u < attack ? getEasing("easeOut")(u / attack) : Math.exp(-(u - attack) * 5) * Math.cos((u - attack) * 9);
  return 1 + p.amount * env;
}

/** Continuous handheld drift (deterministic noise), `amount` in screen px. */
export function handheldOffset(amount: number, t: number, seed = 7): { x: number; y: number; rotation: number } {
  if (amount <= 0) return { x: 0, y: 0, rotation: 0 };
  const n = (s: number, freq: number) => noise1(seed + s, t * freq) * 0.7 + noise1(seed + s + 101, t * freq * 2.3) * 0.3;
  return { x: n(1, 0.6) * amount, y: n(2, 0.5) * amount * 0.7, rotation: n(3, 0.4) * amount * 0.04 };
}

export function clampToBounds(state: CameraState, b: CameraBounds | undefined, width: number, height: number): void {
  if (!b) return;
  const hw = width / 2 / state.zoom;
  const hh = height / 2 / state.zoom;
  state.x = b.maxX - b.minX < hw * 2 ? (b.minX + b.maxX) / 2 : clamp(state.x, b.minX + hw, b.maxX - hw);
  state.y = b.maxY - b.minY < hh * 2 ? (b.minY + b.maxY) / 2 : clamp(state.y, b.minY + hh, b.maxY - hh);
}

/** Depth-of-field blur (screen px) for an item at parallax depth `depth`. */
export function depthBlur(cam: CameraState, depth: number): number {
  if (cam.blur <= 0) return 0;
  return cam.blur * clamp(Math.abs(depth - cam.focus) / Math.max(1e-3, cam.focusRange), 0, 1);
}

/**
 * Blur (depth of field + motion blur) as a CSS `filter: blur(px)` value in screen pixels.
 * SVG `filter="url(#…)"` references proved unreliable in frame-by-frame capture: when an element's
 * filter reference changed between frames (motion blur crossing its threshold, depth blur levels),
 * Chrome sometimes skipped painting it, so elements flickered. A numeric CSS blur updates cleanly.
 * Motion blur is approximated isotropically (direction-independent).
 */
export function cssBlur(screenX: number, screenY: number): string | undefined {
  const amount = Math.round(Math.hypot(screenX, screenY) * Math.SQRT1_2 * 4) / 4;
  return amount < 0.25 ? undefined : `blur(${Math.min(20, amount)}px)`;
}

/** Screen scale of a matrix (average of axes). */
export const matScale = (m: Mat): number => (Math.hypot(m[0], m[1]) + Math.hypot(m[2], m[3])) / 2;

/** Position part of the camera that segments animate. */
export interface CameraPose {
  x: number;
  y: number;
  zoom: number;
  rotation: number;
}

/**
 * Director model: every camera action starts a segment that begins from wherever the camera
 * actually is at that moment (no stale positions when switching between moves and rigs).
 */
export type CameraSegment =
  | { kind: "move"; start: number; duration: number; ease: Ease; x?: number; y?: number; zoom?: number; rotation?: number; from?: CameraPose }
  | { kind: "path"; start: number; duration: number; ease: Ease; points: Vec2[]; zoom?: number; from?: CameraPose }
  | { kind: "follow"; start: number; follow: CameraFollow; zoom?: number }
  | { kind: "frame"; start: number; frame: CameraFrame }
  | { kind: "hold"; start: number; from?: CameraPose };
