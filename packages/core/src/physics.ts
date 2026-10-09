import {
  type Mat,
  type Vec2,
  angleOf,
  apply,
  applyLinear,
  clamp,
  invert,
  lerp,
  sub,
  wrapAngle,
} from "./math";
import { type EvaluatedPose, type PhysicsSample, computeWorld } from "./pose";
import type { Rig } from "./rig";

/**
 * Baked secondary physics: one sample per fixed step.
 * Physics is simulated in scene space so that actor motion (walking, jumping) produces
 * follow-through, then converted back into bone deltas in character space.
 */
export interface PhysicsBake {
  rate: number;
  samples: PhysicsSample[];
  /** Sample indices where the simulation restarted (actor flipped): never interpolated across. */
  resets?: number[];
}

export interface BakeOptions {
  duration: number;
  /** Simulation rate in Hz (default 120). */
  rate?: number;
  /** Pre-physics pose at time t. Must be deterministic. */
  poseAt: (t: number) => EvaluatedPose;
  /** Character → scene matrix at time t. */
  placementAt: (t: number) => Mat;
}

interface Particle {
  p: Vec2;
  v: Vec2;
}

const TWO_PI = Math.PI * 2;

/** Integrates one damped spring particle towards `target`. */
function stepParticle(pt: Particle, target: Vec2, omega: number, zeta: number, gravity: Vec2, dt: number): void {
  for (let k = 0; k < 2; k++) {
    const acc = omega * omega * (target[k] - pt.p[k]) - 2 * zeta * omega * pt.v[k] + gravity[k];
    pt.v[k] += acc * dt;
    pt.p[k] += pt.v[k] * dt;
  }
}

const origin = (m: Mat): Vec2 => [m[4], m[5]];

export function bakePhysics(rig: Rig, opts: BakeOptions): PhysicsBake {
  const rate = opts.rate ?? 120;
  const dt = 1 / rate;
  const count = Math.ceil(opts.duration * rate) + 1;
  const samples: PhysicsSample[] = [];
  const resets: number[] = [];
  if (rig.physics.length === 0) return { rate, samples };

  // Particle state per physics entry (springs: one per chain joint after the root; jiggle: one).
  const state: (Particle[] | null)[] = rig.physics.map(() => null);

  let prevFlip = 0;
  for (let n = 0; n < count; n++) {
    const t = n * dt;
    const pose = opts.poseAt(t);
    const A = opts.placementAt(t);
    const Ainv = invert(A);
    // An instant turn (flip) is a cartoon cut, not a physical motion: restart the simulation at
    // rest instead of whipping tails and ears across the screen.
    const flip = Math.sign(A[0] * A[3] - A[1] * A[2]);
    if (prevFlip !== 0 && flip !== prevFlip) {
      state.fill(null);
      resets.push(n);
    }
    prevFlip = flip;
    const { state: s, world } = pose;
    const values: number[][] = [];

    rig.physics.forEach((def, k) => {
      // Stiffness maps to natural frequency 0.5–5 Hz (quadratic for finer control of loose parts).
      const omegaBase = TWO_PI * lerp(0.5, 5, def.stiffness * def.stiffness);
      const zeta = lerp(0.04, 1, def.damping);

      if (def.type === "spring") {
        const chain = def.bones;
        const targets: Vec2[] = chain.map((b, j) =>
          j < chain.length - 1 ? apply(A, origin(world[chain[j + 1]])) : apply(A, apply(world[b], [rig.bones[b].length, 0])),
        );
        const anchor = apply(A, origin(world[chain[0]]));
        let parts = state[k];
        if (!parts) {
          parts = targets.map((p) => ({ p: [p[0], p[1]] as Vec2, v: [0, 0] as Vec2 }));
          state[k] = parts;
        }
        const prev = parts.map((pt) => [pt.p[0], pt.p[1]] as Vec2);
        parts.forEach((pt, j) => {
          const omega = omegaBase / Math.sqrt(rig.bones[chain[j]].mass);
          stepParticle(pt, targets[j], omega, zeta, def.gravity, dt);
          pt.p = [lerp(targets[j][0], pt.p[0], def.inertia), lerp(targets[j][1], pt.p[1], def.inertia)];
        });
        // Keep bone lengths.
        let base = anchor;
        parts.forEach((pt, j) => {
          const restFrom = j === 0 ? anchor : targets[j - 1];
          const len = Math.hypot(targets[j][0] - restFrom[0], targets[j][1] - restFrom[1]);
          const d = sub(pt.p, base);
          const l = Math.hypot(d[0], d[1]) || 1;
          pt.p = [base[0] + (d[0] / l) * len, base[1] + (d[1] / l) * len];
          pt.v = [(pt.p[0] - prev[j][0]) / dt, (pt.p[1] - prev[j][1]) / dt];
          base = pt.p;
        });
        // Convert to rotation deltas, applied root → tip.
        const deltas: number[] = [];
        chain.forEach((b, j) => {
          const from = origin(world[b]);
          const next = j < chain.length - 1 ? origin(world[chain[j + 1]]) : apply(world[b], [rig.bones[b].length, 0]);
          const desired = apply(Ainv, parts![j].p);
          const p = rig.bones[b].parent;
          const flip = p >= 0 && world[p][0] * world[p][3] - world[p][1] * world[p][2] < 0 ? -1 : 1;
          const delta = wrapAngle(angleOf(sub(desired, from)) - angleOf(sub(next, from))) * flip;
          s.brot[b] += delta;
          computeWorld(rig, s, world);
          deltas.push(delta);
        });
        values.push(deltas);
      } else {
        const target = apply(A, origin(world[def.bone]));
        let parts = state[k];
        if (!parts) {
          parts = [{ p: [target[0], target[1]], v: [0, 0] }];
          state[k] = parts;
        }
        const pt = parts[0];
        const omega = omegaBase / Math.sqrt(rig.bones[def.bone].mass);
        stepParticle(pt, target, omega, zeta, [0, 0], dt);
        const offScene = sub(pt.p, target);
        const offChar = applyLinear(Ainv, offScene);
        const parent = rig.bones[def.bone].parent;
        const local = parent >= 0 ? applyLinear(invert(world[parent]), offChar) : offChar;
        const dx = local[0] * def.translate;
        const dy = local[1] * def.translate;
        // Squash only from lag along the bone's own axis: sideways motion never deforms.
        const axis = world[def.bone];
        const axisLen = Math.hypot(axis[0], axis[1]) || 1;
        const along = (offChar[0] * axis[0] + offChar[1] * axis[1]) / axisLen;
        const sq = clamp(along / 40, -0.6, 0.6) * def.squash;
        s.bx[def.bone] += dx;
        s.by[def.bone] += dy;
        s.bsq[def.bone] += sq;
        computeWorld(rig, s, world);
        values.push([dx, dy, sq]);
      }
    });
    samples.push({ values });
  }
  return { rate, samples, resets };
}

/** Samples a bake at time t (linear interpolation between steps, but never across a restart). */
export function samplePhysics(bake: PhysicsBake | undefined, t: number): PhysicsSample | undefined {
  if (!bake || bake.samples.length === 0) return undefined;
  const u = clamp(t * bake.rate, 0, bake.samples.length - 1);
  const i = Math.floor(u);
  const f = u - i;
  const a = bake.samples[i];
  const b = bake.samples[Math.min(i + 1, bake.samples.length - 1)];
  if (f === 0 || a === b) return a;
  // Across a restart the two samples belong to different (mirrored) states: pick the nearest.
  if (bake.resets?.includes(i + 1)) return f < 0.5 ? a : b;
  return { values: a.values.map((row, k) => row.map((v, j) => lerp(v, b.values[k][j], f))) };
}
