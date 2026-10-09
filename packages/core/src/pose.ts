import type { Value } from "./format/schema";
import { getEasing } from "./easing";
import { interpolateValue, sampleTrack } from "./keyframes";
import {
  type Mat,
  type Vec2,
  DEG,
  angleOf,
  apply,
  applyLinear,
  clamp,
  invert,
  lerp,
  matAngle,
  multiply,
  noise1,
  seededRandom,
  sub,
  wrapAngle,
  dist,
  hashString,
} from "./math";
import { type ChannelRef, type Rig, type RigTrack, boneLocalMatrix, composeWorld, visemeVariant } from "./rig";

/** Mutable per-frame state of all character channels. */
export interface PoseState {
  bx: Float64Array;
  by: Float64Array;
  brot: Float64Array;
  bsx: Float64Array;
  bsy: Float64Array;
  bsq: Float64Array;
  /** Multiplier of each bone's rotation offset and aim (1 = normal, 0 = held straight). */
  brotMix: Float64Array;
  variant: (string | undefined)[];
  opacity: Float64Array;
  morph: Record<string, number>[];
  ikX: Float64Array;
  ikY: Float64Array;
  ikMix: Float64Array;
  controls: Record<string, Value | undefined>;
  behaviorMix: Float64Array;
  physicsMix: Float64Array;
}

export function createPoseState(rig: Rig): PoseState {
  const nb = rig.bones.length;
  const np = rig.parts.length;
  return {
    bx: new Float64Array(nb),
    by: new Float64Array(nb),
    brot: new Float64Array(nb),
    bsx: new Float64Array(nb).fill(1),
    bsy: new Float64Array(nb).fill(1),
    bsq: new Float64Array(nb),
    brotMix: new Float64Array(nb).fill(1),
    variant: new Array(np).fill(undefined),
    opacity: new Float64Array(np).fill(1),
    morph: Array.from({ length: np }, () => ({})),
    ikX: new Float64Array(rig.ik.length),
    ikY: new Float64Array(rig.ik.length),
    ikMix: Float64Array.from(rig.ik.map((k) => k.mix)),
    controls: {},
    behaviorMix: new Float64Array(rig.behaviors.length).fill(1),
    physicsMix: Float64Array.from(rig.physics.map((p) => p.mix)),
  };
}

export type BlendMode = "override" | "additive";

function blendNumber(cur: number, v: number, w: number, mode: BlendMode, multiplicative: boolean): number {
  if (mode === "override") return lerp(cur, v, w);
  return multiplicative ? cur * lerp(1, v, w) : cur + v * w;
}

/** Writes a value into a channel, blended with weight `w`. */
export function applyChannel(state: PoseState, ref: ChannelRef, value: Value | undefined, w: number, mode: BlendMode = "override"): void {
  if (value === undefined || w <= 0) return;
  switch (ref.kind) {
    case "bone": {
      if (typeof value !== "number") return;
      const i = ref.index;
      switch (ref.prop) {
        case "x":
          state.bx[i] = blendNumber(state.bx[i], value, w, mode, false);
          break;
        case "y":
          state.by[i] = blendNumber(state.by[i], value, w, mode, false);
          break;
        case "rotation":
          state.brot[i] = blendNumber(state.brot[i], value, w, mode, false);
          break;
        case "scaleX":
          state.bsx[i] = blendNumber(state.bsx[i], value, w, mode, true);
          break;
        case "scaleY":
          state.bsy[i] = blendNumber(state.bsy[i], value, w, mode, true);
          break;
        case "squash":
          state.bsq[i] = blendNumber(state.bsq[i], value, w, mode, false);
          break;
        case "rotationMix":
          state.brotMix[i] = blendNumber(state.brotMix[i], value, w, mode, false);
          break;
      }
      return;
    }
    case "part":
      if (ref.prop === "variant") {
        if (typeof value === "string" && w >= 0.5) state.variant[ref.index] = value;
      } else if (typeof value === "number") {
        state.opacity[ref.index] = blendNumber(state.opacity[ref.index], value, w, mode, true);
      }
      return;
    case "morph": {
      if (typeof value !== "number") return;
      const m = state.morph[ref.index];
      m[ref.shape] = blendNumber(m[ref.shape] ?? 0, value, w, mode, false);
      return;
    }
    case "ik": {
      if (typeof value !== "number") return;
      const arr = ref.prop === "x" ? state.ikX : ref.prop === "y" ? state.ikY : state.ikMix;
      arr[ref.index] = blendNumber(arr[ref.index], value, w, mode, false);
      return;
    }
    case "control": {
      const cur = state.controls[ref.name];
      if (w >= 1 || cur === undefined || cur === null || value === null) {
        if (w >= 0.5 || cur === undefined) state.controls[ref.name] = value;
        return;
      }
      state.controls[ref.name] = interpolateValue(cur, value, w);
      return;
    }
    case "behavior":
      if (typeof value === "number") state.behaviorMix[ref.index] = blendNumber(state.behaviorMix[ref.index], value, w, mode, false);
      return;
    case "physics":
      if (typeof value === "number") state.physicsMix[ref.index] = blendNumber(state.physicsMix[ref.index], value, w, mode, false);
      return;
  }
}

// ---------------------------------------------------------------------------
// Clip instances (the mixer)
// ---------------------------------------------------------------------------

export interface ClipInstance {
  clip: string;
  start: number;
  /** End time (Infinity = forever). */
  end: number;
  speed: number;
  loop: boolean;
  fadeIn: number;
  fadeOut: number;
  layer: number;
  blend: BlendMode;
  weight: number;
}

const smooth = getEasing("sineInOut");

export function clipInstanceWeight(inst: ClipInstance, t: number): number {
  if (t < inst.start || t > inst.end) return 0;
  const fi = inst.fadeIn > 0 ? clamp((t - inst.start) / inst.fadeIn, 0, 1) : 1;
  const fo = inst.fadeOut > 0 && Number.isFinite(inst.end) ? clamp((inst.end - t) / inst.fadeOut, 0, 1) : 1;
  return inst.weight * smooth(Math.min(fi, fo));
}

export function clipLocalTime(inst: ClipInstance, duration: number, t: number): number {
  const local = Math.max(0, (t - inst.start) * inst.speed);
  if (inst.loop) return local % duration;
  return Math.min(local, duration);
}

// ---------------------------------------------------------------------------
// World transforms
// ---------------------------------------------------------------------------

/**
 * Computes world matrices (character space).
 *
 * Squash & stretch is local: it deforms the bone's own art and moves where its children are
 * attached, but children are never scaled or sheared by it (a squashing body must not distort
 * the head). Regular `scaleX` / `scaleY` still inherit normally.
 */
export function computeWorld(rig: Rig, s: PoseState, out: Mat[] = []): Mat[] {
  const basis: Mat[] = [];
  for (const b of rig.bones) {
    const i = b.index;
    const local = boneLocalMatrix(b, s.bx[i], s.by[i], s.brot[i], s.bsx[i], s.bsy[i], 0);
    const parentWorld = b.parent >= 0 ? out[b.parent] : undefined;
    const parentBasis = b.parent >= 0 ? basis[b.parent] : undefined;
    let m = composeWorld(b, parentBasis, local, b.rotation + s.brot[i]);
    if (parentWorld && parentWorld !== parentBasis) {
      const p = apply(parentWorld, [local[4], local[5]]);
      m = [m[0], m[1], m[2], m[3], p[0], p[1]];
    }
    basis[i] = m;
    const sq = 1 + Math.max(-0.9, s.bsq[i]);
    out[i] = sq === 1 ? m : multiply(m, [sq, 0, 0, 1 / sq, 0, 0]);
  }
  return out;
}

/** Rotates bone `i` so that its world rotation changes by `deltaDeg`. */
function rotateWorld(rig: Rig, s: PoseState, world: Mat[], i: number, deltaDeg: number): void {
  const p = rig.bones[i].parent;
  const flip = p >= 0 && world[p][0] * world[p][3] - world[p][1] * world[p][2] < 0 ? -1 : 1;
  s.brot[i] += deltaDeg * flip;
}

const origin = (m: Mat): Vec2 => [m[4], m[5]];
const tip = (rig: Rig, world: Mat[], i: number): Vec2 => apply(world[i], [rig.bones[i].length, 0]);

// ---------------------------------------------------------------------------
// IK
// ---------------------------------------------------------------------------

function solveTwoBone(rig: Rig, s: PoseState, world: Mat[], a: number, b: number, target: Vec2, bend: 1 | -1, mix: number): void {
  const pa = origin(world[a]);
  const pb = origin(world[b]);
  const pt = tip(rig, world, b);
  const l1 = dist(pa, pb);
  const l2 = dist(pb, pt);
  if (l1 < 1e-6 || l2 < 1e-6) return;
  const d = clamp(dist(pa, target), Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
  const base = angleOf(sub(target, pa));
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const a1 = base - bend * (Math.acos(cosA) / DEG);
  const delta1 = wrapAngle(a1 - angleOf(sub(pb, pa))) * mix;
  rotateWorld(rig, s, world, a, delta1);
  computeWorld(rig, s, world);
  const pb2 = origin(world[b]);
  const delta2 = wrapAngle(angleOf(sub(target, pb2)) - angleOf(sub(tip(rig, world, b), pb2))) * mix;
  rotateWorld(rig, s, world, b, delta2);
  computeWorld(rig, s, world);
}

function solveFabrik(rig: Rig, s: PoseState, world: Mat[], chain: number[], target: Vec2, mix: number): void {
  const n = chain.length;
  const pts: Vec2[] = chain.map((i) => origin(world[i]));
  pts.push(tip(rig, world, chain[n - 1]));
  const lens = pts.slice(1).map((p, k) => dist(p, pts[k]));
  const total = lens.reduce((x, y) => x + y, 0);
  const root = pts[0];
  if (dist(root, target) >= total) {
    for (let k = 0; k < n; k++) {
      const dir = sub(target, pts[k]);
      const l = Math.hypot(dir[0], dir[1]) || 1;
      pts[k + 1] = [pts[k][0] + (dir[0] / l) * lens[k], pts[k][1] + (dir[1] / l) * lens[k]];
    }
  } else {
    for (let iter = 0; iter < 12; iter++) {
      pts[n] = target;
      for (let k = n - 1; k >= 0; k--) {
        const dir = sub(pts[k], pts[k + 1]);
        const l = Math.hypot(dir[0], dir[1]) || 1;
        pts[k] = [pts[k + 1][0] + (dir[0] / l) * lens[k], pts[k + 1][1] + (dir[1] / l) * lens[k]];
      }
      pts[0] = root;
      for (let k = 0; k < n; k++) {
        const dir = sub(pts[k + 1], pts[k]);
        const l = Math.hypot(dir[0], dir[1]) || 1;
        pts[k + 1] = [pts[k][0] + (dir[0] / l) * lens[k], pts[k][1] + (dir[1] / l) * lens[k]];
      }
      if (dist(pts[n], target) < 0.01) break;
    }
  }
  for (let k = 0; k < n; k++) {
    const i = chain[k];
    const from = origin(world[i]);
    const next = k < n - 1 ? origin(world[chain[k + 1]]) : tip(rig, world, i);
    const delta = wrapAngle(angleOf(sub(pts[k + 1], from)) - angleOf(sub(next, from))) * mix;
    rotateWorld(rig, s, world, i, delta);
    computeWorld(rig, s, world);
  }
}

// ---------------------------------------------------------------------------
// Behaviors
// ---------------------------------------------------------------------------

/** Is a blink happening at time t? Blinks are scheduled from a seeded random sequence. */
export function isBlinking(seed: number, interval: [number, number], duration: number, t: number): boolean {
  const rand = seededRandom(seed);
  let at = lerp(interval[0], interval[1], rand()) * 0.5;
  while (at <= t) {
    if (t < at + duration) return true;
    at += duration + lerp(interval[0], interval[1], rand());
  }
  return false;
}

/** Channels that direct tracks add on top of clips (offsets) instead of overriding. */
export function isLayeredChannel(ref: ChannelRef): boolean {
  return (
    ref.kind === "bone" ||
    ref.kind === "morph" ||
    (ref.kind === "ik" && ref.prop !== "mix") ||
    (ref.kind === "part" && ref.prop === "opacity")
  );
}

// ---------------------------------------------------------------------------
// Full evaluation
// ---------------------------------------------------------------------------

export interface CharacterInput {
  time: number;
  clips?: ClipInstance[];
  /** Direct tracks (absolute time). */
  tracks?: RigTrack[];
  seed?: number | string;
  /**
   * Resolved aim targets per aim control (character space), overriding the control channel.
   * `weight` fades the aim in/out for smooth target changes.
   */
  aim?: Record<string, { point: Vec2; weight: number } | null>;
  /** Extra IK target offsets (character space), e.g. feet planted on sloped ground. */
  ikOffset?: Record<string, Vec2>;
}

export interface EvaluatedPose {
  state: PoseState;
  world: Mat[];
}

/**
 * Evaluates steps 1–7 of the pipeline (everything except baked physics).
 * `resolveAim` converts non-point aim values (e.g. actor ids) into character-space points.
 */
export function evaluatePose(
  rig: Rig,
  input: CharacterInput,
  resolveAim?: (value: Value) => Vec2 | null,
): EvaluatedPose {
  const s = createPoseState(rig);
  const t = input.time;
  const seed = typeof input.seed === "string" ? hashString(input.seed) : (input.seed ?? 0);

  // 2. Clip layers.
  const active = (input.clips ?? [])
    .map((inst, order) => ({ inst, order, w: clipInstanceWeight(inst, t) }))
    .filter((e) => e.w > 0 && rig.clips[e.inst.clip])
    .sort((a, b) => a.inst.layer - b.inst.layer || a.inst.start - b.inst.start || a.order - b.order);
  for (const { inst, w } of active) {
    const clip = rig.clips[inst.clip];
    const lt = clipLocalTime(inst, clip.duration, t);
    for (const tr of clip.tracks) applyChannel(s, tr.ref, sampleTrack(tr.track, lt), w, inst.blend);
  }

  // 3. Direct tracks.
  // Numeric offset channels layer additively on top of clips; everything else overrides.
  for (const tr of input.tracks ?? []) applyChannel(s, tr.ref, sampleTrack(tr.track, t), 1, isLayeredChannel(tr.ref) ? "additive" : "override");

  // 4. Pose and viseme controls.
  for (const control of Object.values(rig.controls)) {
    const value = s.controls[control.name];
    if (value === undefined || value === null) continue;
    if (control.type === "pose") {
      const weights: Record<string, number> =
        typeof value === "string" ? { [value]: 1 } : typeof value === "object" && !Array.isArray(value) ? value : {};
      let best: Record<string, number> = {};
      for (const [name, w] of Object.entries(weights)) {
        const entries = control.poses[name];
        if (!entries || w <= 0) continue;
        for (const { ref, value: v } of entries) {
          if (typeof v === "number") applyChannel(s, ref, v, w, "additive");
          else if (ref.kind === "part" && typeof v === "string") {
            const key = String(ref.index);
            if ((best[key] ?? 0) < w && w >= 0.5) {
              best[key] = w;
              s.variant[ref.index] = v;
            }
          } else applyChannel(s, ref, v, w, "override");
        }
      }
    } else if (control.type === "viseme") {
      // A viseme letter, or a weight blend such as { C: 0.3, D: 0.7 } (smooth transitions).
      const weights: Record<string, number> =
        typeof value === "string" ? { [value]: 1 } : typeof value === "object" && !Array.isArray(value) ? value : {};
      for (const index of control.parts) {
        const part = rig.parts[index];
        if (part.type === "switch") {
          let best = "";
          let bw = 0;
          for (const [v, w] of Object.entries(weights)) if (w > bw) [best, bw] = [v, w];
          const variant = best ? visemeVariant(control, part, best) : undefined;
          if (variant !== undefined) s.variant[index] = variant;
        } else if (part.type === "morph") {
          const m = s.morph[index];
          for (const [v, w] of Object.entries(weights)) {
            const shape = visemeVariant(control, part, v);
            if (shape !== undefined && w > 0) m[shape] = (m[shape] ?? 0) + w;
          }
        }
      }
    }
  }

  // 5. Behaviors.
  rig.behaviors.forEach((b, k) => {
    const mix = s.behaviorMix[k];
    if (mix <= 0) return;
    const bseed = (seed ^ hashString(b.id)) >>> 0;
    if (b.type === "blink") {
      const part = rig.parts[b.part];
      const current = s.variant[b.part] ?? (part.type === "switch" ? part.default : undefined);
      if (current === b.open && mix >= 0.5 && isBlinking(bseed, b.interval, b.duration, t)) s.variant[b.part] = b.closed;
    } else if (b.type === "breathe") {
      s.bsq[b.bone] += b.amount * Math.sin((2 * Math.PI * t) / b.period) * mix;
    } else if (b.type === "sway") {
      const phase = (bseed % 1000) / 1000;
      s.brot[b.bone] += b.angle * mix * (0.7 * Math.sin(2 * Math.PI * (t / b.period + phase)) + 0.3 * noise1(bseed, t / b.period * 2));
    }
  });

  // 6. Rotation mix (e.g. a head kept straight in a front view), limits + FK.
  for (const b of rig.bones) {
    if (s.brotMix[b.index] !== 1) s.brot[b.index] *= clamp(s.brotMix[b.index], 0, 1);
    if (b.limits) s.brot[b.index] = clamp(s.brot[b.index], b.limits[0], b.limits[1]);
  }
  const world = computeWorld(rig, s);

  // 7. IK.
  rig.ik.forEach((k, i) => {
    const mix = clamp(s.ikMix[i], 0, 1);
    if (mix <= 0) return;
    const extra = input.ikOffset?.[k.id];
    const target: Vec2 = [k.restTarget[0] + s.ikX[i] + (extra?.[0] ?? 0), k.restTarget[1] + s.ikY[i] + (extra?.[1] ?? 0)];
    if (k.bones.length === 2) solveTwoBone(rig, s, world, k.bones[0], k.bones[1], target, k.bend, mix);
    else solveFabrik(rig, s, world, k.bones, target, mix);
  });

  // 7b. Aim controls.
  for (const control of Object.values(rig.controls)) {
    if (control.type !== "aim") continue;
    let target: Vec2 | null = null;
    let aimWeight = 1;
    const override = input.aim?.[control.name];
    if (override !== undefined) {
      if (override === null) continue;
      target = override.point;
      aimWeight = override.weight;
    } else {
      const raw = s.controls[control.name];
      if (raw === undefined || raw === null) continue;
      target = Array.isArray(raw) ? (raw as Vec2) : resolveAim ? resolveAim(raw) : null;
    }
    if (!target || aimWeight <= 0) continue;
    for (const tg of control.targets) {
      const m = world[tg.bone];
      const pivot = origin(m);
      if (tg.mode === "rotate") {
        const current = matAngle(m) + tg.forward;
        let delta = wrapAngle(angleOf(sub(target, pivot)) - current);
        delta = clamp(delta, -tg.maxAngle, tg.maxAngle) * tg.weight * aimWeight * clamp(s.brotMix[tg.bone], 0, 1);
        rotateWorld(rig, s, world, tg.bone, delta);
      } else {
        const dir = sub(target, pivot);
        const l = Math.hypot(dir[0], dir[1]);
        if (l < 1e-6) continue;
        const r = Math.min(tg.radius, l) * tg.weight * aimWeight;
        const worldOffset: Vec2 = [(dir[0] / l) * r, (dir[1] / l) * r];
        const p = rig.bones[tg.bone].parent;
        const local = p >= 0 ? applyLinear(invert(world[p]), worldOffset) : worldOffset;
        s.bx[tg.bone] += local[0];
        s.by[tg.bone] += local[1];
      }
      computeWorld(rig, s, world);
    }
  }

  return { state: s, world };
}

// ---------------------------------------------------------------------------
// Physics application (step 8)
// ---------------------------------------------------------------------------

/** Per-sample physics output, applied in order on top of the evaluated pose. */
export interface PhysicsSample {
  /** For each physics entry: spring → rotation deltas per chain bone; jiggle → [dx, dy, squash]. */
  values: number[][];
}

export function applyPhysicsSample(rig: Rig, pose: EvaluatedPose, sample: PhysicsSample | undefined): void {
  if (!sample) return;
  const { state: s, world } = pose;
  rig.physics.forEach((p, k) => {
    const v = sample.values[k];
    const mix = clamp(s.physicsMix[k], 0, 1);
    if (!v || mix <= 0) return;
    if (p.type === "spring") {
      p.bones.forEach((bi, j) => {
        s.brot[bi] += v[j] * mix;
        computeWorld(rig, s, world);
      });
    } else {
      s.bx[p.bone] += v[0] * mix;
      s.by[p.bone] += v[1] * mix;
      s.bsq[p.bone] += v[2] * mix;
      computeWorld(rig, s, world);
    }
  });
}

/** Current variant shown by a switch part. */
export function currentVariant(rig: Rig, s: PoseState, partIndex: number): string | undefined {
  const part = rig.parts[partIndex];
  if (part.type !== "switch") return undefined;
  return s.variant[partIndex] ?? part.default;
}
