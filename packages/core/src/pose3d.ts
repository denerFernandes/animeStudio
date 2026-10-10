/**
 * 2.5D rigs (`rig3d`): the bones listed there are posed in 3D and projected for the current view.
 *
 * A bone's 2D `rotation` channel is a rotation about the body's sideways axis (the plane of a side
 * view: what a clip authored in profile means — an arm swinging forward, a knee bending), `turn`
 * a rotation about the vertical axis and `spread` one about the forward axis. Each frame, before
 * IK, the posed 3D skeleton is projected with the view's yaw (the `view` control → `rig3d.views`)
 * and the rig's pitch, and the 2D bones are set to match: their place, their direction and their
 * foreshortening (a squash). Leg IK (feet planted while walking) is solved in the side plane before
 * projecting, so walks foreshorten correctly from the front. Limbs nearer or farther than the body
 * are drawn in front of or behind it (`chains`).
 */
import type { Mat, Vec2 } from "./math";
import { DEG, apply, clamp, invert, matAngle, wrapAngle } from "./math";
import type { PoseState } from "./pose";
import type { Rig, RigPart } from "./rig";

export type V3 = [number, number, number];
type M3 = number[]; // row-major 3×3

export interface CompiledRig3d {
  /** 3D bones in rig order: index, nearest 3D ancestor (−1), rest joint and tip. */
  bones: { index: number; parent: number; from: V3; to: V3 }[];
  byIndex: Map<number, number>;
  views: Record<string, number>;
  pitch: number;
  chains: { bones: number[]; parts: number[] }[];
  front?: number;
  back?: number;
  body: number[];
}

export function compileRig3d(rig: Pick<Rig, "bones" | "boneIndex" | "partIndex">, def: { bones: Record<string, { from: V3; to: V3 }>; views: Record<string, number>; pitch?: number; chains?: { bones: string[]; parts: string[] }[]; front?: string; back?: string; body?: string[] }): CompiledRig3d {
  const listed = new Set(Object.keys(def.bones));
  const bones: CompiledRig3d["bones"] = [];
  const byIndex = new Map<number, number>();
  for (const b of rig.bones) {
    if (!listed.has(b.id)) continue;
    let p = b.parent;
    while (p >= 0 && !listed.has(rig.bones[p].id)) p = rig.bones[p].parent;
    byIndex.set(b.index, bones.length);
    bones.push({ index: b.index, parent: p, from: def.bones[b.id].from, to: def.bones[b.id].to });
  }
  const bi = (id: string) => rig.boneIndex.get(id);
  return {
    bones,
    byIndex,
    views: def.views,
    pitch: def.pitch ?? 0,
    chains: (def.chains ?? []).map((c) => ({ bones: c.bones.map(bi).filter((x): x is number => x !== undefined), parts: c.parts.map((p) => rig.partIndex.get(p)).filter((x): x is number => x !== undefined) })),
    front: def.front ? rig.partIndex.get(def.front) : undefined,
    back: def.back ? rig.partIndex.get(def.back) : undefined,
    body: (def.body ?? ["body", "neck"]).map(bi).filter((x): x is number => x !== undefined),
  };
}

// ------------------------------------------------------------------ 3×3 rotations

const mul = (a: M3, b: M3): M3 => [
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
];
const mv = (m: M3, v: V3): V3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const I3: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
/** About the sideways axis (x), with the 2D rotation's sign: + swings a hanging limb backwards. */
const rx = (a: number): M3 => {
  const c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, 0, c, s, 0, -s, c];
};
/** About the vertical axis: + turns the front (+z) towards +x. */
const ry = (a: number): M3 => {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
};
/** About the forward axis: + swings a hanging limb towards +x. */
const rz = (a: number): M3 => {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
};
const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** View space of a body-space point: screen x, screen y, depth (larger = nearer). */
export function viewPoint(p: V3, yaw: number, pitch: number): V3 {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const X = p[0] * cy + p[2] * sy, Z = -p[0] * sy + p[2] * cy;
  return [X, p[1] * cp + Z * sp, -p[1] * sp + Z * cp];
}

// ------------------------------------------------------------------ the projection stage

export interface Rig3dFrame {
  /** Depth (view space) of each 3D bone's joint and tip. */
  depth: Map<number, number>;
}

/**
 * Poses the 3D bones and writes the matching 2D state (offsets, rotations, squash) so that
 * `computeWorld` reproduces the projection. `world` is the current world (for the hips' place).
 * Leg chains with IK on (and no absolute target) are solved in the side plane first; their IK is
 * then switched off for the 2D pass.
 */
export function applyRig3d(rig: Rig, r3: CompiledRig3d, s: PoseState, world: Mat[], ikTargets: Record<string, unknown> | undefined): Rig3dFrame {
  const view = typeof s.controls.view === "string" ? s.controls.view : "profile";
  const yaw = ((r3.views[view] ?? r3.views.profile ?? 0) * Math.PI) / 180;
  const pitch = (r3.pitch * Math.PI) / 180;
  // Leg IK in the side plane (forward = the 2D target's x, down = its y).
  for (let c = 0; c < rig.ik.length; c++) {
    const k = rig.ik[c];
    if (k.bones.length !== 2 || s.ikMix[c] <= 0 || ikTargets?.[k.id]) continue;
    const [a, b] = k.bones;
    const ia = r3.byIndex.get(a), ib = r3.byIndex.get(b);
    if (ia === undefined || ib === undefined || !rig.bones[a].id.startsWith("leg")) continue;
    const A = r3.bones[ia], B = r3.bones[ib];
    const end: V3 = B.to;
    // Plane coordinates (z forward, y down), relative to the hip joint.
    const l1 = Math.hypot(B.from[1] - A.from[1], B.from[2] - A.from[2]), l2 = Math.hypot(end[1] - B.from[1], end[2] - B.from[2]);
    const tz = end[2] - A.from[2] + s.ikX[c], ty = end[1] - A.from[1] + s.ikY[c];
    const d = clamp(Math.hypot(tz, ty), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
    const base = Math.atan2(ty, tz);
    const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
    // The knee bends forward (towards +z): the thigh turns from the line to the target towards +z.
    const thigh = base - (k.bend ?? 1) * Math.acos(cosA);
    const knee: [number, number] = [Math.cos(thigh) * l1, Math.sin(thigh) * l1];
    const shin = Math.atan2(ty - knee[1], tz - knee[0]);
    const restThigh = Math.atan2(B.from[1] - A.from[1], B.from[2] - A.from[2]), restShin = Math.atan2(end[1] - B.from[1], end[2] - B.from[2]);
    const m = clamp(s.ikMix[c], 0, 1);
    // In the side plane a rotation + swings the limb backwards: the plane angle grows with it.
    s.brot[a] += wrapAngle((thigh - restThigh) / DEG) * m;
    s.brot[b] += wrapAngle((shin - thigh - (restShin - restThigh)) / DEG) * m;
    s.ikMix[c] = 0;
  }
  // 3D FK.
  const n = r3.bones.length;
  const rot: M3[] = new Array(n), pos: V3[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const B = r3.bones[i];
    const local = mul(mul(ry(s.bturn[B.index] * DEG), rz(s.bspread[B.index] * DEG)), rx(s.brot[B.index] * DEG));
    if (B.parent < 0) {
      rot[i] = local;
      pos[i] = B.from;
    } else {
      const P = r3.byIndex.get(B.parent)!;
      rot[i] = mul(rot[P], local);
      pos[i] = add3(pos[P], mv(rot[P], sub3(B.from, r3.bones[P].from)));
    }
  }
  // Projection, anchored on the first 3D bone's current 2D place (the hips).
  const first = r3.bones[0];
  const anchor: Vec2 = [world[first.index][4], world[first.index][5]];
  const p0 = viewPoint(pos[0], yaw, pitch);
  const off: Vec2 = [anchor[0] - p0[0], anchor[1] - p0[1]];
  const depth = new Map<number, number>();
  // Desired world (unsquashed basis + squash) of each 3D bone, set into the 2D state in rig order.
  const basis = new Map<number, Mat>(), full = new Map<number, Mat>();
  for (let i = 0; i < n; i++) {
    const B = r3.bones[i], bone = rig.bones[B.index];
    const tip = add3(pos[i], mv(rot[i], sub3(B.to, B.from)));
    const a = viewPoint(pos[i], yaw, pitch), t = viewPoint(tip, yaw, pitch);
    // Depth for the draw order: towards the camera horizontally (the pitch would rank by height).
    const hz = (q: V3) => -q[0] * Math.sin(yaw) + q[2] * Math.cos(yaw);
    depth.set(B.index, (hz(pos[i]) + hz(tip)) / 2);
    const o: Vec2 = [a[0] + off[0], a[1] + off[1]];
    const dx = t[0] - a[0], dy = t[1] - a[1];
    const len = Math.hypot(dx, dy);
    const rest = bone.length || Math.hypot(...sub3(B.to, B.from));
    const sq = rest > 1e-6 ? clamp(len / rest, 0.1, 3) : 1;
    const ang = len > 1e-6 ? Math.atan2(dy, dx) / DEG : matAngle(world[B.index]);
    // The 2D parent's world: a 3D bone's (as set here) or the current one.
    const p = bone.parent;
    const pw = p >= 0 ? (full.get(p) ?? world[p]) : undefined;
    const pb = p >= 0 ? (basis.get(p) ?? world[p]) : undefined;
    if (pw && pb) {
      const lp = apply(invert(pw), o);
      s.bx[B.index] = lp[0] - bone.x;
      s.by[B.index] = lp[1] - bone.y;
      s.brot[B.index] = wrapAngle(ang - matAngle(pb) - bone.rotation);
    } else {
      s.bx[B.index] = o[0] - bone.x;
      s.by[B.index] = o[1] - bone.y;
      s.brot[B.index] = wrapAngle(ang - bone.rotation);
    }
    s.bsq[B.index] = sq - 1;
    const c = Math.cos(ang * DEG), sn = Math.sin(ang * DEG);
    const bm: Mat = [c, sn, -sn, c, o[0], o[1]];
    basis.set(B.index, bm);
    full.set(B.index, [c * sq, sn * sq, -sn / sq, c / sq, o[0], o[1]]);
  }
  return { depth };
}

/**
 * Draw order for a 2.5D rig this frame: limbs (chains) clearly nearer than the body move just before
 * the `front` part, clearly farther ones just after the `back` part; the rest keeps the rig's order.
 */
export function rig3dDrawOrder(rig: Rig, r3: CompiledRig3d, frame: Rig3dFrame): RigPart[] | undefined {
  const bodyDepth = r3.body.map((b) => frame.depth.get(b)).filter((d): d is number => d !== undefined);
  if (!bodyDepth.length || (r3.front === undefined && r3.back === undefined)) return undefined;
  const bd = bodyDepth.reduce((a, b) => a + b, 0) / bodyDepth.length;
  const key = new Map<number, number>();
  rig.drawOrder.forEach((p, i) => key.set(p.index, i));
  const frontKey = r3.front !== undefined ? key.get(r3.front)! - 0.5 : undefined;
  const backKey = r3.back !== undefined ? key.get(r3.back)! + 0.5 : undefined;
  // Chains moving to a slot, the farthest drawn first.
  const moves: { parts: number[]; slot: number; depth: number }[] = [];
  for (const [ci, ch] of r3.chains.entries()) {
    const ds = ch.bones.map((b) => frame.depth.get(b)).filter((d): d is number => d !== undefined);
    if (!ds.length) continue;
    const d = Math.max(...ds) - bd;
    const margin = 25;
    // In front of the body: in the chains' order (legs, then the arms resting on them).
    if (d > margin && frontKey !== undefined) moves.push({ parts: ch.parts, slot: frontKey, depth: 1e6 + ci });
    else if (d < -margin && backKey !== undefined) moves.push({ parts: ch.parts, slot: backKey, depth: d });
  }
  moves.sort((a, b) => a.depth - b.depth);
  moves.forEach((m, rank) => m.parts.forEach((pi, k) => key.set(pi, m.slot + rank * 0.01 + k * 1e-4)));
  const changed = moves.length > 0;
  if (!changed) return undefined;
  return [...rig.drawOrder].sort((a, b) => key.get(a.index)! - key.get(b.index)!);
}
