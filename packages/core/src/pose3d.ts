/**
 * 2.5D rigs (`rig3d`): the bones listed there are posed in 3D and projected for the current view.
 *
 * A bone's 2D `rotation` channel is a rotation about the body's sideways axis (the plane of a side
 * view: what a clip authored in profile means — an arm swinging forward, a knee bending), `turn`
 * a rotation about the vertical axis and `spread` one about the forward axis. Each frame, before
 * IK, the posed 3D skeleton is projected with the view's yaw (the `view` control → `rig3d.views`)
 * and the rig's pitch, and the 2D bones are set to match: their place, their direction and their
 * foreshortening (a squash). Leg IK (feet planted while walking) is solved in the side plane before
 * projecting, so walks foreshorten correctly from the front (which chains are legs: `sideIk`).
 * A two-bone chain of 3D bones held on a target (`ikTarget`: a scene `reach`) is solved in 3D too,
 * on the plane through its root parallel to the picture, so the drawn limb (a solid posed on the 3D
 * bones) and its 2D bones agree. After that, every arm (a `chains` entry that is not a leg) is kept
 * out of the head (`keepOut`): the face clearance. Limbs nearer or farther than the body are drawn in
 * front of or behind it (`chains`).
 */
import type { Mat, Vec2 } from "./math";
import { DEG, angleOf, apply, applyLinear, clamp, invert, matAngle, multiply, wrapAngle } from "./math";
import type { PoseState } from "./pose";
import type { Rig, RigIk, RigPart } from "./rig";
import { boneLocalMatrix, composeWorld } from "./rig";
import { occluderDepthAt } from "./solid";

export type V3 = [number, number, number];
type M3 = number[]; // row-major 3×3

export interface CompiledRig3d {
  /** 3D bones in rig order: index, nearest 3D ancestor (−1), rest joint and tip. */
  bones: { index: number; parent: number; from: V3; to: V3 }[];
  byIndex: Map<number, number>;
  views: Record<string, number>;
  pitch: number;
  /** `limb: false`: the bones only rank the parts (no foreshortening, no face clearance). */
  chains: { bones: number[]; parts: number[]; tip?: boolean; margin?: number; behind?: number; limb?: false }[];
  front?: number;
  back?: number;
  body: number[];
  /** IK chains (indices into `rig.ik`) solved in the side plane before projecting: the legs. */
  sideIk: number[];
  /** `keepOut` ellipsoids on 3D bones: the bone (rig index), the centre (offset from the bone's rest joint, body space at rest) and the radii. */
  keepOut: { bone: number; at: V3; radii: V3 }[];
  /**
   * The face clearance (`applyRig3d`): each arm — a `chains` entry whose last bone and that bone's
   * 3D parent make a two-bone limb, not a leg (`sideIk`) — with the keep-outs (indices into
   * `keepOut`) its hand and forearm are kept out of: those on bones that are neither an ancestor
   * of the limb's root (the torso's, on `body`, which the shoulder hangs from) nor in the limb itself.
   */
  clear: { upper: number; lower: number; keepOut: number[] }[];
  /** The torso as drawn (`rig3d.torso`: ellipsoids on 3D bones) and an arm's half width (`torsoGap`), for the torso clearance. */
  torso: { bone: number; at: V3; radii: V3 }[];
  torsoGap?: number;
}

/**
 * The IK chains a 2.5D rig solves in the side plane (`CompiledRig3d.sideIk`): a two-bone chain
 * of 3D bones that hangs — mostly vertical at rest, pointing down — and ends at the bottom of the
 * 3D skeleton (its rest tip within a tenth of the skeleton's height of the lowest 3D point): a leg
 * standing on the ground. Arms hang too but end at the hips; a tail ends behind.
 */
function sidePlaneChains(ik: RigIk[], bones: CompiledRig3d["bones"], byIndex: Map<number, number>): number[] {
  let minY = Infinity, maxY = -Infinity;
  for (const b of bones) for (const p of [b.from, b.to]) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  const floor = maxY - 0.1 * (maxY - minY);
  const out: number[] = [];
  ik.forEach((k, c) => {
    if (k.bones.length !== 2) return;
    const ia = byIndex.get(k.bones[0]), ib = byIndex.get(k.bones[1]);
    if (ia === undefined || ib === undefined) return;
    const d = sub3(bones[ib].to, bones[ia].from);
    const hangs = d[1] > 0 && d[1] >= Math.abs(d[0]) && d[1] >= Math.abs(d[2]);
    if (hangs && bones[ib].to[1] >= floor) out.push(c);
  });
  return out;
}

export function compileRig3d(rig: Pick<Rig, "bones" | "boneIndex" | "partIndex"> & { ik?: RigIk[] }, def: { bones: Record<string, { from: V3; to: V3 }>; views: Record<string, number>; pitch?: number; chains?: { bones: string[]; parts: string[]; tip?: boolean; margin?: number; behind?: string; limb?: boolean }[]; front?: string; back?: string; body?: string[]; keepOut?: { bone: string; at: V3; radii: V3 }[]; torso?: { bone: string; at: V3; radii: V3 }[]; torsoGap?: number }): CompiledRig3d {
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
  const sideIk = sidePlaneChains(rig.ik ?? [], bones, byIndex);
  const keepOut = (def.keepOut ?? []).flatMap((k) => {
    const b = bi(k.bone);
    return b !== undefined && byIndex.has(b) ? [{ bone: b, at: k.at, radii: k.radii }] : [];
  });
  // The arms' face clearance: the chain's last bone and its 3D parent, unless a leg's.
  const ancestorOrSelf = (a: number, of: number) => {
    for (let p = of; p >= 0; p = rig.bones[p].parent) if (p === a) return true;
    return false;
  };
  const legBones = new Set(sideIk.flatMap((c) => rig.ik![c].bones));
  const clear: CompiledRig3d["clear"] = [];
  for (const c of def.chains ?? []) {
    if (c.limb === false) continue;
    const lower = bi(c.bones[c.bones.length - 1] ?? "");
    const li = lower !== undefined ? byIndex.get(lower) : undefined;
    if (lower === undefined || li === undefined) continue;
    const upper = bones[li].parent;
    if (upper < 0 || legBones.has(lower) || legBones.has(upper) || clear.some((x) => x.lower === lower)) continue;
    const ks = keepOut.flatMap((k, i) => (ancestorOrSelf(k.bone, upper) || ancestorOrSelf(upper, k.bone) ? [] : [i]));
    if (ks.length) clear.push({ upper, lower, keepOut: ks });
  }
  const torso = (def.torso ?? []).flatMap((k) => {
    const b = bi(k.bone);
    return b !== undefined && byIndex.has(b) ? [{ bone: b, at: k.at, radii: k.radii }] : [];
  });
  return {
    bones,
    byIndex,
    views: def.views,
    pitch: def.pitch ?? 0,
    chains: (def.chains ?? []).map((c) => ({ bones: c.bones.map(bi).filter((x): x is number => x !== undefined), parts: c.parts.map((p) => rig.partIndex.get(p)).filter((x): x is number => x !== undefined), ...(c.tip ? { tip: true } : {}), ...(c.margin !== undefined ? { margin: c.margin } : {}), ...(c.behind && rig.partIndex.get(c.behind) !== undefined ? { behind: rig.partIndex.get(c.behind) } : {}), ...(c.limb === false ? { limb: false as const } : {}) })),
    front: def.front ? rig.partIndex.get(def.front) : undefined,
    back: def.back ? rig.partIndex.get(def.back) : undefined,
    body: (def.body ?? ["body", "neck"]).map(bi).filter((x): x is number => x !== undefined),
    sideIk,
    keepOut,
    clear,
    torso,
    ...(def.torsoGap ? { torsoGap: def.torsoGap } : {}),
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
/** About the forward axis (z): + swings a hanging limb towards −x (to the viewer's left in the front view). */
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
  /** Depth (view space) of each 3D bone: the middle of it, and its tip. */
  depth: Map<number, number>;
  tipDepth: Map<number, number>;
  /** Each 3D bone's tip in the picture (character space) and its depth. */
  tipView: Map<number, V3>;
  /** Posed 3D bones (in `CompiledRig3d.bones` order): joint position and rotation (row-major 3×3), body space. */
  pos: V3[];
  rot: number[][];
  /** The view (radians) and the screen offset of the projection (view x, y + `off` = character space). */
  yaw: number;
  pitch: number;
  off: Vec2;
  /** The IK chains (indices into `rig.ik`) placed in the side plane this frame: the 2D IK pass skips them. */
  sideIk: number[];
  /** The IK chains held on a target (`ikTarget`) that were solved in 3D this frame: the 2D IK pass skips them too. */
  ik3d: number[];
}

/** An absolute IK target (character space), as `evaluatePose` gets it (`CharacterInput.ikTarget`). */
export interface IkHold {
  point: Vec2;
  weight: number;
  /** Where the forearm comes from at the grip (a unit vector in character space). */
  from?: Vec2;
}

/**
 * The face clearance: a hand or forearm nearer a keep-out's centre than this normalised distance
 * (1: its surface) is inside it — one resting on the surface (a hand on the face, the kit's
 * `touch` gestures) is left alone — and is pushed out to `FACE_SHELL` (a hair past it, so that
 * the solved arm is out despite rounding: a step of 0.002 of the radius as a point crosses it).
 */
const FACE_CLEARANCE = 0.98;
const FACE_SHELL = 0.982;

/**
 * Poses the 3D bones and writes the matching 2D state (offsets, rotations, squash) so that
 * `computeWorld` reproduces the projection. `world` is the current world (for the hips' place).
 * Leg chains (`r3.sideIk`) with IK on and no absolute target are solved in the side plane first
 * and listed in the frame's `sideIk` for the 2D pass to skip; their mix is left as it is (springs
 * on a placed leg give way). `ikOffset` (the ground under a foot) counts by its vertical part.
 *
 * A two-bone chain of 3D bones held on a target (`ikTargets`, not a leg) is solved in 3D and listed
 * in the frame's `ik3d` for the 2D pass to skip: the target (character space) is put on the plane
 * through the chain's root parallel to the picture, the limb reaches it (`solveLimb3d`) bending
 * towards the grip's `from` (else the way the elbow bends in the pose, else down and back), and the
 * four channel values are blended with the pose's by the hold's weight. Then the face clearance:
 * each arm (`r3.clear`) whose hand (the last bone's tip) or forearm (its middle) is inside a
 * keep-out (normalised distance below `FACE_CLEARANCE`) has its hand target moved out along the
 * ellipsoid's normal and the limb solved again, the elbow kept the way it bends. And in the
 * picture (`clearPicture`): an arm whose forearm or hand covers the head's outline is moved off it,
 * scaled by 1 − `faceExempt[i]` (per `r3.clear` entry: the weight of a playing clip that moves that
 * arm and is not marked `clear` — authored motion is left as authored), then kept out of the head
 * in 3D again.
 */
export function applyRig3d(rig: Rig, r3: CompiledRig3d, s: PoseState, world: Mat[], ikTargets: Record<string, IkHold> | undefined, ikOffset?: Record<string, Vec2>, faceExempt?: number[]): Rig3dFrame {
  // The view control holds a name or (while blending) weights per name: the heaviest wins.
  const vc = s.controls.view as unknown;
  const view = typeof vc === "string" ? vc : vc && typeof vc === "object" && !Array.isArray(vc) ? Object.entries(vc as Record<string, number>).sort((x, y) => y[1] - x[1])[0]?.[0] ?? "profile" : "profile";
  const yaw = ((r3.views[view] ?? r3.views.profile ?? 0) * Math.PI) / 180;
  const pitch = (r3.pitch * Math.PI) / 180;
  // Leg IK in the side plane (forward = the 2D target's x, down = its y).
  const sideIk: number[] = [];
  for (const c of r3.sideIk) {
    const k = rig.ik[c];
    if (s.ikMix[c] <= 0 || ikTargets?.[k.id]) continue;
    const [a, b] = k.bones;
    const A = r3.bones[r3.byIndex.get(a)!], B = r3.bones[r3.byIndex.get(b)!];
    const end: V3 = B.to;
    // Plane coordinates (z forward, y down), relative to the hip joint. The ground under the foot
    // (`ikOffset`: a slope) is a height, which the plane shares with the picture.
    const l1 = Math.hypot(B.from[1] - A.from[1], B.from[2] - A.from[2]), l2 = Math.hypot(end[1] - B.from[1], end[2] - B.from[2]);
    // The target is in character space like a 2D chain's (rest tip + offsets): the hip joint moving
    // (a crouch, the bob of a walk: `bones.hips.y`) does not carry the planted foot with it.
    const hipDy = world[a][5] - rig.bones[a].setupWorld[5];
    const tz = end[2] - A.from[2] + s.ikX[c], ty = end[1] - A.from[1] + s.ikY[c] + (ikOffset?.[k.id]?.[1] ?? 0) - hipDy;
    const d = clamp(Math.hypot(tz, ty), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
    const base = Math.atan2(ty, tz);
    const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
    // The knee bends forward (towards +z) with the chain's `bend`, or the other way when the
    // `ik.<id>.bend` channel says so: the thigh turns from the line to the target towards +z.
    const bend = s.ikBend[c] < 0 ? -k.bend : k.bend;
    const thigh = base - bend * Math.acos(cosA);
    const knee: [number, number] = [Math.cos(thigh) * l1, Math.sin(thigh) * l1];
    const shin = Math.atan2(ty - knee[1], tz - knee[0]);
    const restThigh = Math.atan2(B.from[1] - A.from[1], B.from[2] - A.from[2]), restShin = Math.atan2(end[1] - B.from[1], end[2] - B.from[2]);
    const m = clamp(s.ikMix[c], 0, 1);
    // In the side plane a rotation + swings the limb backwards: the plane angle grows with it.
    s.brot[a] += wrapAngle((thigh - restThigh) / DEG) * m;
    s.brot[b] += wrapAngle((shin - thigh - (restShin - restThigh)) / DEG) * m;
    sideIk.push(c);
  }
  // 3D FK.
  const n = r3.bones.length;
  const rot: M3[] = new Array(n), pos: V3[] = new Array(n);
  const fk = () => {
    for (let i = 0; i < n; i++) {
      const B = r3.bones[i];
      const local = mul(mul(ry(s.bturn[B.index] * DEG), rz(s.bspread[B.index] * DEG)), rx(s.brot[B.index] * DEG));
      if (B.parent < 0) {
        rot[i] = local;
        pos[i] = B.from;
      } else {
        const P = r3.byIndex.get(B.parent)!;
        // A bone that does not inherit its parent's rotation (a foot staying level) turns with the
        // body (the first 3D bone) only.
        rot[i] = mul(rig.bones[B.index].inheritRotation ? rot[P] : rot[0], local);
        pos[i] = add3(pos[P], mv(rot[P], sub3(B.from, r3.bones[P].from)));
      }
    }
  };
  fk();
  // Projection, anchored on the first 3D bone's current 2D place (the hips). (The first bone sits
  // at its rest joint whatever the pose: the reaches below do not move the anchor.)
  const first = r3.bones[0];
  const anchor: Vec2 = [world[first.index][4], world[first.index][5]];
  const p0 = viewPoint(pos[0], yaw, pitch);
  const off: Vec2 = [anchor[0] - p0[0], anchor[1] - p0[1]];
  const tipOf = (i: number): V3 => add3(pos[i], mv(rot[i], sub3(r3.bones[i].to, r3.bones[i].from)));
  const set = (ia: number, ib: number, v: [number, number, number, number]) => {
    const U = r3.bones[ia].index, L = r3.bones[ib].index;
    s.brot[U] = v[0];
    s.bspread[U] = v[1];
    s.brot[L] = v[2];
    s.bturn[L] = v[3];
  };
  // 3D reaches: a held limb of 3D bones (not a leg: those keep the 2D pass on an absolute target).
  const ik3d: number[] = [];
  let moved = false;
  rig.ik.forEach((k, c) => {
    const held = ikTargets?.[k.id];
    if (!held || k.bones.length !== 2 || r3.sideIk.includes(c)) return;
    const ia = r3.byIndex.get(k.bones[0]), ib = r3.byIndex.get(k.bones[1]);
    if (ia === undefined || ib === undefined || r3.bones[ib].parent !== k.bones[0]) return;
    ik3d.push(c);
    // As in the 2D pass: the chain's mix is raised to the hold's weight, the aimed-at point is its own
    // target pulled towards the held one by the weight (the held point itself when the mix is off).
    const w = clamp(held.weight, 0, 1), mix = Math.max(clamp(s.ikMix[c], 0, 1), w);
    if (mix <= 0) return;
    const extra = ikOffset?.[k.id];
    const own: Vec2 = [k.restTarget[0] + s.ikX[c] + (extra?.[0] ?? 0), k.restTarget[1] + s.ikY[c] + (extra?.[1] ?? 0)];
    const u = w / mix;
    const aim: Vec2 = [own[0] + (held.point[0] - own[0]) * u, own[1] + (held.point[1] - own[1]) * u];
    // On the plane through the root joint parallel to the picture.
    const depth = viewPoint(pos[ia], yaw, pitch)[2];
    const target = fromView([aim[0] - off[0], aim[1] - off[1]], depth, yaw, pitch);
    // The elbow: towards where the forearm comes from at a grip, else the way it bends in the pose.
    const pole = held.from ? fromView(held.from, 0, yaw, pitch) : elbowPole(r3, rot, pos, ia, ib, 0.1);
    const v = solveLimb3d(rig, r3, s, rot, pos, ia, ib, target, pole);
    if (!v) return;
    const U = r3.bones[ia].index, L = r3.bones[ib].index;
    const cur = [s.brot[U], s.bspread[U], s.brot[L], s.bturn[L]];
    set(ia, ib, v.map((x, j) => cur[j] + (x - cur[j]) * mix) as [number, number, number, number]);
    moved = true;
  });
  if (moved) fk();
  // The face clearance, in 3D: an arm's hand and forearm out of the head (the keep-outs it is kept
  // out of).
  const clear3d = (cl: CompiledRig3d["clear"][number]) => {
    const ia = r3.byIndex.get(cl.upper)!, ib = r3.byIndex.get(cl.lower)!;
    // (The keep-outs are on bones the arm does not move.)
    const ks = cl.keepOut.map((i) => {
      const k = r3.keepOut[i], j = r3.byIndex.get(k.bone)!;
      return { c: add3(pos[j], mv(rot[j], k.at)), r: rot[j], radii: k.radii };
    });
    for (let pass = 0; pass < 6; pass++) {
      const hand = tipOf(ib), mid = lerp3(pos[ib], hand, 0.5);
      const dh = pushOut(hand, ks), dm = pushOut(mid, ks);
      const amount = Math.hypot(...dh) + Math.hypot(...dm);
      if (amount < 1e-9) break;
      // The hand moves out by its own push and by the forearm's, scaled as a turn of the whole arm
      // about the shoulder would carry it (the hand is farther out than the forearm's middle), and
      // stays as far from the shoulder as it was: the arm swings out of the head keeping its bend
      // (pushed straight out, it would straighten against the head). The elbow keeps the way it
      // bends — its pole leaning towards down and back only as much as the push, so a small push is
      // a small change.
      const S = pos[ia], reach = Math.hypot(...sub3(hand, S)), k = reach / (Math.hypot(...sub3(mid, S)) || 1);
      const out = sub3(add3(hand, add3(dh, [k * dm[0], k * dm[1], k * dm[2]])), S), ol = Math.hypot(...out) || 1;
      const target = add3(S, [(out[0] * reach) / ol, (out[1] * reach) / ol, (out[2] * reach) / ol]);
      const l1 = Math.hypot(...sub3(r3.bones[ib].from, r3.bones[ia].from));
      const v = solveLimb3d(rig, r3, s, rot, pos, ia, ib, target, elbowPole(r3, rot, pos, ia, ib, 0.02 * Math.min(1, amount / (0.05 * l1 || 1))));
      if (!v) break;
      set(ia, ib, v);
      fk();
    }
  };
  // Then in the picture: a forearm or a hand between the camera and the face hides it (the drawing
  // has no depth), so the arm is moved off the face's outline — unless a clip not marked `clear`
  // moves it (`faceExempt`: the correction is scaled by 1 − that clip's weight) — and checked in 3D
  // again.
  r3.clear.forEach((cl, ci) => {
    clear3d(cl);
    const strength = 1 - clamp(faceExempt?.[ci] ?? 0, 0, 1);
    if (strength > 0 && clearPicture(rig, r3, s, rot, pos, cl, yaw, pitch, strength)) {
      fk();
      clear3d(cl);
    }
  });
  // The torso clearance, in the picture: a far arm never lies along the torso's drawn outline (half
  // of it peeking out as a crescent, a stump of forearm cut off at the waist): it swings out or in,
  // the least that shows it clear of the torso or tucks it behind, wherever it is along it.
  // (An arm held on a target — a reach, a grip — goes where it is held.)
  const held = new Set(rig.ik.flatMap((k, c) => (ik3d.includes(c) || ikTargets?.[k.id] ? k.bones : [])));
  if (r3.torso.length && r3.torsoGap) for (const cl of r3.clear) if (!held.has(cl.lower) && clearTorso(rig, r3, s, rot, pos, cl, yaw, pitch)) fk();
  const depth = new Map<number, number>(), tipDepth = new Map<number, number>(), tipView = new Map<number, V3>();
  const limbs = new Set(r3.chains.flatMap((c) => (c.limb === false ? [] : c.bones)));
  // Desired world (unsquashed basis + squash) of each 3D bone, set into the 2D state in rig order.
  const basis = new Map<number, Mat>(), full = new Map<number, Mat>();
  for (let i = 0; i < n; i++) {
    const B = r3.bones[i], bone = rig.bones[B.index];
    const tip = tipOf(i);
    const a = viewPoint(pos[i], yaw, pitch), t = viewPoint(tip, yaw, pitch);
    // Depth for the draw order: towards the camera horizontally (the pitch would rank by height).
    const hz = (q: V3) => -q[0] * Math.sin(yaw) + q[2] * Math.cos(yaw);
    depth.set(B.index, (hz(pos[i]) + hz(tip)) / 2);
    tipDepth.set(B.index, hz(tip));
    tipView.set(B.index, [t[0] + off[0], t[1] + off[1], t[2]]);
    const o: Vec2 = [a[0] + off[0], a[1] + off[1]];
    const dx = t[0] - a[0], dy = t[1] - a[1];
    const len = Math.hypot(dx, dy);
    const rest = bone.length || Math.hypot(...sub3(B.to, B.from));
    const ang = len > 1e-6 ? Math.atan2(dy, dx) / DEG : matAngle(world[B.index]);
    // The 2D parent's world: a 3D bone's (as set here) or the current one — its unsquashed basis
    // and its full matrix, scale included: the offsets are set so that `computeWorld`, composing
    // the bone the way it always does (rest scale, scale channels, the parent's scale and squash),
    // puts the joint on `o` pointing along `ang`.
    const p = bone.parent;
    const pw = p >= 0 ? (full.get(p) ?? world[p]) : undefined;
    const pb = p >= 0 ? (basis.get(p) ?? world[p]) : undefined;
    if (pw && pb) {
      const lp = apply(invert(pw), o);
      s.bx[B.index] = lp[0] - bone.x;
      s.by[B.index] = lp[1] - bone.y;
      if (bone.inheritRotation && bone.inheritScale) {
        // Inside a parent scaled unevenly a local direction is sheared: the local angle is the one
        // whose image under the parent's linear part points along `ang` (a mirrored bone — its own
        // x scale negative — points its x axis the other way).
        const flip = bone.scaleX * s.bsx[B.index] < 0 ? -1 : 1;
        const ld = applyLinear(invert(pb), [flip * Math.cos(ang * DEG), flip * Math.sin(ang * DEG)]);
        s.brot[B.index] = wrapAngle(angleOf(ld) - bone.rotation);
      } else s.brot[B.index] = wrapAngle(ang - (bone.inheritRotation ? matAngle(pb) : 0) - bone.rotation);
    } else {
      s.bx[B.index] = o[0] - bone.x;
      s.by[B.index] = o[1] - bone.y;
      s.brot[B.index] = wrapAngle(ang - bone.rotation);
    }
    // The bone's unsquashed basis as `computeWorld` composes it (its joint lands on `o` by construction).
    const local = boneLocalMatrix(bone, s.bx[B.index], s.by[B.index], s.brot[B.index], s.bsx[B.index], s.bsy[B.index], 0);
    const cw = composeWorld(bone, pb, local, bone.rotation + s.brot[B.index]);
    const bm: Mat = [cw[0], cw[1], cw[2], cw[3], o[0], o[1]];
    // Only limbs (the chains' bones) foreshorten: a torso or a head is a drawing of a volume, the
    // same seen tilted (squashed, it would bare the scalp's edges under the hair). The squash is
    // what brings the tip — the bone's length, stretched by its world scale along itself — to the
    // projected length.
    // (Bounded only against degenerate values: a limb seen end-on squashes to a tenth, a limb drawn
    // inside a strongly squashed parent may need to stretch many times to reach its projected length.)
    const stretch = Math.hypot(bm[0], bm[1]) || 1;
    const sq = rest > 1e-6 && limbs.has(B.index) ? clamp(len / (rest * stretch), 0.1, 20) : 1;
    s.bsq[B.index] = sq - 1;
    basis.set(B.index, bm);
    full.set(B.index, sq === 1 ? bm : multiply(bm, [sq, 0, 0, 1 / sq, 0, 0]));
  }
  return { depth, tipDepth, tipView, pos, rot, yaw, pitch, off, sideIk, ik3d };
}

/** Body space of a view-space point (`viewPoint` inverted): screen x, y (without the offset) and depth. */
function fromView(q: Vec2, depth: number, yaw: number, pitch: number): V3 {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const Z = q[1] * sp + depth * cp;
  return [q[0] * cy - Z * sy, q[1] * cp - depth * sp, q[0] * sy + Z * cy];
}

const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * The way a limb's middle joint bends in the pose (body space): the elbow's offset from the line
 * shoulder → hand, plus `lean` × the upper bone's length towards down, back and out to the limb's
 * side in its parent's frame — the bend of a limb held straight (the offset is then nothing).
 */
function elbowPole(r3: CompiledRig3d, rot: M3[], pos: V3[], ia: number, ib: number, lean: number): V3 {
  const U = r3.bones[ia], L = r3.bones[ib];
  const S = pos[ia], E = pos[ib], H = add3(pos[ib], mv(rot[ib], sub3(L.to, L.from)));
  const d = sub3(H, S), dl = Math.hypot(...d) || 1, dh: V3 = [d[0] / dl, d[1] / dl, d[2] / dl];
  const e = sub3(E, S), k = dot3(e, dh);
  const perp: V3 = [e[0] - dh[0] * k, e[1] - dh[1] * k, e[2] - dh[2] * k];
  const side = Math.sign(U.from[0] - r3.bones[0].from[0]);
  const P = U.parent >= 0 ? rot[r3.byIndex.get(U.parent)!] : I3;
  const fall = mv(P, norm3([side * 0.4, 1, -0.6]));
  const l1 = Math.hypot(...sub3(L.from, U.from));
  return add3(perp, [fall[0] * lean * l1, fall[1] * lean * l1, fall[2] * lean * l1]);
}

/**
 * The displacement taking a body-space point out of keep-out ellipsoids (centre `c`, rotation `r`,
 * `radii`) inside `FACE_CLEARANCE` to the shell at `FACE_SHELL`, along each ellipsoid's normal there
 * (the gradient of the normalised distance: the least move, continuous everywhere but the centre).
 * Nothing for a point outside. Overlapping ellipsoids are passed over again (a few times at most).
 */
function pushOut(p: V3, ks: { c: V3; r: M3; radii: V3 }[]): V3 {
  let q = p;
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const k of ks) {
      const l = mv(T3(k.r), sub3(q, k.c));
      const D: V3 = [l[0] / k.radii[0], l[1] / k.radii[1], l[2] / k.radii[2]];
      const qq = Math.hypot(...D);
      if (qq >= FACE_CLEARANCE) continue;
      const nrm = qq < 1e-9 ? ([0, 0, 1] as V3) : norm3([D[0] / k.radii[0], D[1] / k.radii[1], D[2] / k.radii[2]]);
      const Dn: V3 = [nrm[0] / k.radii[0], nrm[1] / k.radii[1], nrm[2] / k.radii[2]];
      // |D + t·Dn| = FACE_SHELL, the positive root.
      const a = dot3(Dn, Dn), b = dot3(D, Dn), c = dot3(D, D) - FACE_SHELL * FACE_SHELL;
      const t = (-b + Math.sqrt(Math.max(0, b * b - a * c))) / a;
      q = add3(k.c, mv(k.r, [l[0] + nrm[0] * t, l[1] + nrm[1] * t, l[2] + nrm[2] * t]));
      moved = true;
    }
    if (!moved) break;
  }
  return sub3(q, p);
}

/** Normalised distance (1: the outline) under which a forearm or a hand covers the head in the picture. */
const FACE_SCREEN = 1.02;
/** How far the picture-space clearance turns an arm, at most, per channel (degrees), and its search step. */
const FACE_TURN = 30;
const FACE_STEP = 2;

/**
 * The picture-space face clearance of one arm (`r3.clear` entry `cl`): the head's keep-outs are
 * projected to the picture (each ellipsoid's outline: the ellipse whose shape matrix is the sum of
 * its projected axes' outer products), and the forearm (elbow → hand segment, the hand included)
 * must stay outside them by `FACE_SCREEN`. If it does not, the upper bone is turned by the smallest
 * amount that clears it: in views facing the camera (|sin yaw| < 0.7) its `spread` outward (the
 * hand away from the body's middle) first, up to `FACE_TURN`, then its `rotation`; in views from
 * the side its `rotation` only — up towards overhead when the hand is above the middle of the
 * head's outline, down towards hanging when below. The amount is searched in `FACE_STEP` steps and
 * refined by bisection to the outline (a continuous function of the pose and the view; where the
 * hand crosses the middle of the head the side switches, a jump). The change is scaled by
 * `strength` and written into the pose. Returns whether the arm was moved.
 */
/** The most an arm swings out or in to clear the torso's outline (degrees of `spread`), and the step. */
const TORSO_TURN = 20;
const TORSO_STEP = 0.5;
/** Degrees over which the turn blends between out and in when both are about as near. */
const TORSO_BLEND = 4;

/**
 * The torso clearance for one arm (`rig3d.torso`, `torsoGap` = r): its centre line sampled — the middle
 * of the upper arm, the elbow, the middle of the forearm, the wrist — against the torso's drawn
 * outlines in the picture. A sample is clear when it is outside every outline grown by r (the arm's
 * edge outside the torso), covered when it is inside one shrunk by r (the arm wholly behind it there),
 * and on the outline otherwise. An arm behind the torso (its upper arm farther than the torso's
 * middle: the far arm) hanging down (the wrist well below the elbow), not held on a target, with a
 * sample on the outline has its upper bone's `spread` turned by the least
 * (in `TORSO_STEP`s, either way, at most `TORSO_TURN`; outward on a tie) that leaves none on it.
 */
function clearTorso(rig: Rig, r3: CompiledRig3d, s: PoseState, rot: M3[], pos: V3[], cl: CompiledRig3d["clear"][number], yaw: number, pitch: number): boolean {
  const ia = r3.byIndex.get(cl.upper)!, ib = r3.byIndex.get(cl.lower)!;
  const Ub = r3.bones[ia], Lb = r3.bones[ib], gap = r3.torsoGap!;
  const outline = (R: number[], at: V3, j: number, rad: V3) => {
    const c = viewPoint(add3(pos[j], mv(R, at)), yaw, pitch);
    let A = 0, B = 0, C = 0;
    for (let m = 0; m < 3; m++) {
      const a = viewPoint([R[m] * rad[m], R[3 + m] * rad[m], R[6 + m] * rad[m]], yaw, pitch);
      A += a[0] * a[0]; B += a[0] * a[1]; C += a[1] * a[1];
    }
    const det = A * C - B * B || 1e-9;
    const n11 = C / det, n12 = -B / det, n22 = A / det, w11 = Math.sqrt(n11), w12 = n12 / w11, w22 = Math.sqrt(Math.max(1e-12, n22 - n12 * w12));
    return { c, w11, w12, w22 };
  };
  const shapes = r3.torso.map((k) => {
    const j = r3.byIndex.get(k.bone)!, R = rot[j];
    return {
      grown: outline(R, k.at, j, [k.radii[0] + gap, k.radii[1] + gap, k.radii[2] + gap]),
      shrunk: outline(R, k.at, j, [Math.max(1, k.radii[0] - gap), Math.max(1, k.radii[1] - gap), Math.max(1, k.radii[2] - gap)]),
    };
  });
  const norm = (o: ReturnType<typeof outline>, v: V3) => {
    const x = v[0] - o.c[0], y = v[1] - o.c[1];
    return Math.hypot(o.w11 * x + o.w12 * y, o.w22 * y);
  };
  const onOutline = (p: V3) => {
    const v = viewPoint(p, yaw, pitch);
    const clear = shapes.every((sh) => norm(sh.grown, v) >= 1), covered = shapes.some((sh) => norm(sh.shrunk, v) <= 1);
    return !clear && !covered;
  };
  const P = Ub.parent < 0 ? I3 : rig.bones[Ub.index].inheritRotation ? rot[r3.byIndex.get(Ub.parent)!] : rot[0];
  const r0 = s.brot[Ub.index], sp0 = s.bspread[Ub.index], t0 = s.bturn[Ub.index] * DEG;
  const local2 = mul(mul(ry(s.bturn[Lb.index] * DEG), rz(s.bspread[Lb.index] * DEG)), rx(s.brot[Lb.index] * DEG));
  const e1 = sub3(Lb.from, Ub.from), e2 = sub3(Lb.to, Lb.from), S = pos[ia];
  const samples = (sp: number): V3[] => {
    const R1 = mul(P, mul(ry(t0), mul(rz(sp * DEG), rx(r0 * DEG))));
    const E = add3(S, mv(R1, e1));
    const H = add3(E, mv(mul(rig.bones[Lb.index].inheritRotation ? R1 : rot[0], local2), e2));
    return [lerp3(S, E, 0.5), E, lerp3(E, H, 0.5), lerp3(E, H, 0.9)];
  };
  const pts = samples(sp0);
  // (Only an arm hanging down — the wrist below the elbow, y down: a hand at the face, raised or
  // brought up to the chest is left as it is.)
  if (!(pts[3][1] > pts[1][1] + 0.25 * Math.hypot(...e2))) return false;
  const middle = shapes.reduce((a, sh) => a + sh.grown.c[2], 0) / shapes.length;
  // (Clearly behind: an arm level with the torso — at its side, seen from the front — is not.)
  if (!(viewPoint(pts[0], yaw, pitch)[2] < middle - 2 * gap)) return false;
  if (!pts.some(onOutline)) return false;
  // The least turn either way that leaves no sample on the outline: out (the arm shown clear of the
  // torso) and in (tucked behind it).
  const free = (sp: number) => !samples(sp).some(onOutline);
  const cx = shapes.reduce((a, sh) => a + sh.grown.c[0], 0) / shapes.length;
  const away = (sp: number) => Math.abs(viewPoint(samples(sp)[3], yaw, pitch)[0] - cx);
  const outDir = away(sp0 + 1) >= away(sp0 - 1) ? 1 : -1;
  const least = (dir: number) => {
    let lo = 0;
    for (let t = TORSO_STEP; t <= TORSO_TURN + 1e-9; t += TORSO_STEP) {
      if (!free(sp0 + dir * t)) { lo = t; continue; }
      let hi = t;
      for (let k = 0; k < 10; k++) {
        const m = (lo + hi) / 2;
        if (free(sp0 + dir * m)) hi = m;
        else lo = m;
      }
      return hi;
    }
    return Infinity;
  };
  const tOut = least(outDir), tIn = least(-outDir);
  if (!Number.isFinite(tOut) && !Number.isFinite(tIn)) return false;
  // The nearer way wins; where both are about as near the two are blended (the arm crosses the
  // outline in between), so the turn never jumps from one way to the other between frames.
  const a = Number.isFinite(tOut) ? tOut : TORSO_TURN * 2, b = Number.isFinite(tIn) ? tIn : TORSO_TURN * 2;
  const u = clamp((b - a) / TORSO_BLEND + 0.5, 0, 1), w = u * u * (3 - 2 * u);
  s.bspread[Ub.index] = sp0 + outDir * (w * a - (1 - w) * b);
  return true;
}

function clearPicture(rig: Rig, r3: CompiledRig3d, s: PoseState, rot: M3[], pos: V3[], cl: CompiledRig3d["clear"][number], yaw: number, pitch: number, strength: number): boolean {
  const ia = r3.byIndex.get(cl.upper)!, ib = r3.byIndex.get(cl.lower)!;
  const Ub = r3.bones[ia], Lb = r3.bones[ib];
  const vp = (p: V3): Vec2 => {
    const v = viewPoint(p, yaw, pitch);
    return [v[0], v[1]];
  };
  // The head's outlines: centre and the whitening W (|W·(x − c)| = normalised distance).
  const ells = cl.keepOut.map((i) => {
    const k = r3.keepOut[i], j = r3.byIndex.get(k.bone)!, R = rot[j];
    const c = vp(add3(pos[j], mv(R, k.at)));
    let A = 0, B = 0, C = 0;
    for (let m = 0; m < 3; m++) {
      const a = vp([R[m] * k.radii[m], R[3 + m] * k.radii[m], R[6 + m] * k.radii[m]]);
      A += a[0] * a[0];
      B += a[0] * a[1];
      C += a[1] * a[1];
    }
    const det = A * C - B * B || 1e-9;
    const n11 = C / det, n12 = -B / det, n22 = A / det, w11 = Math.sqrt(n11), w12 = n12 / w11, w22 = Math.sqrt(Math.max(1e-12, n22 - n12 * w12));
    return { c, w11, w12, w22, top: c[1] - Math.sqrt(C), bottom: c[1] + Math.sqrt(C) };
  });
  if (!ells.length) return false;
  // The arm for upper-bone values (degrees): elbow and hand in the picture, hand in body space.
  const P = Ub.parent < 0 ? I3 : rig.bones[Ub.index].inheritRotation ? rot[r3.byIndex.get(Ub.parent)!] : rot[0];
  const t0 = s.bturn[Ub.index] * DEG;
  const local2 = mul(mul(ry(s.bturn[Lb.index] * DEG), rz(s.bspread[Lb.index] * DEG)), rx(s.brot[Lb.index] * DEG));
  const e1 = sub3(Lb.from, Ub.from), e2 = sub3(Lb.to, Lb.from);
  const arm = (r: number, sp: number) => {
    const R1 = mul(P, mul(ry(t0), mul(rz(sp * DEG), rx(r * DEG))));
    const E = add3(pos[ia], mv(R1, e1));
    const H = add3(E, mv(mul(rig.bones[Lb.index].inheritRotation ? R1 : rot[0], local2), e2));
    return { E, H };
  };
  // The least normalised distance of the forearm segment from the outlines.
  const clearance = (r: number, sp: number) => {
    const { E, H } = arm(r, sp);
    const e = vp(E), h = vp(H);
    let q = Infinity;
    for (const o of ells) {
      const ax = e[0] - o.c[0], ay = e[1] - o.c[1], bx = h[0] - o.c[0], by = h[1] - o.c[1];
      const p: Vec2 = [o.w11 * ax + o.w12 * ay, o.w22 * ay], d: Vec2 = [o.w11 * (bx - ax) + o.w12 * (by - ay), o.w22 * (by - ay)];
      const dd = d[0] * d[0] + d[1] * d[1];
      const u = dd > 1e-12 ? clamp(-(p[0] * d[0] + p[1] * d[1]) / dd, 0, 1) : 0;
      q = Math.min(q, Math.hypot(p[0] + d[0] * u, p[1] + d[1] * u));
    }
    return q;
  };
  const r0 = s.brot[Ub.index], sp0 = s.bspread[Ub.index];
  if (clearance(r0, sp0) >= FACE_SCREEN) return false;
  // The policy: which way the arm turns.
  const hand = arm(r0, sp0).H;
  const middle = (Math.min(...ells.map((o) => o.top)) + Math.max(...ells.map((o) => o.bottom))) / 2;
  const above = vp(hand)[1] < middle;
  const rw = wrapAngle(r0);
  const rotDir = above === (rw <= 0) ? -1 : 1;
  // (The spread goes outward — the hand away from the body's middle — unless that covers more of
  // the face in this view at once; the rotation up or down by where the hand is.)
  const side = Math.sign(Ub.from[0] - r3.bones[0].from[0]) || -1;
  const q0 = clearance(r0, sp0);
  let spreadDir = (arm(r0, sp0 + 1).H[0] - arm(r0, sp0 - 1).H[0]) * side >= 0 ? 1 : -1;
  if (clearance(r0, sp0 + spreadDir) < q0 && clearance(r0, sp0 - spreadDir) > q0) spreadDir = -spreadDir;
  const spreadFirst = Math.abs(Math.sin(yaw)) < 0.5;
  const tmax = spreadFirst ? 2 * FACE_TURN : FACE_TURN;
  const path = (dir: number) => (t: number): [number, number] =>
    !spreadFirst ? [r0 + dir * t, sp0] : t <= FACE_TURN ? [r0, sp0 + spreadDir * t] : [r0 + dir * (t - FACE_TURN), sp0 + spreadDir * FACE_TURN];
  // The smallest amount along a path that clears the outline: in steps, then bisected to it.
  const search = (at: (t: number) => [number, number]): number | undefined => {
    const ok = (t: number) => clearance(...at(t)) >= FACE_SCREEN;
    let lo = 0;
    for (let t = FACE_STEP; t <= tmax + 1e-9; t += FACE_STEP) {
      if (!ok(t)) {
        lo = t;
        continue;
      }
      let hi = t;
      for (let k = 0; k < 16; k++) {
        const m = (lo + hi) / 2;
        if (ok(m)) hi = m;
        else lo = m;
      }
      return hi;
    }
    return undefined;
  };
  // The way the hand's place says, else the other way (a hand a little above the middle of a big
  // head is lowered under the chin while raising it 30° would not clear the head), else as far as
  // the first way goes.
  let at = path(rotDir), found = search(at);
  if (found === undefined) {
    const other = path(-rotDir), t = search(other);
    if (t !== undefined) [at, found] = [other, t];
  }
  const [r, sp] = at(found ?? tmax);
  s.brot[Ub.index] = r0 + (r - r0) * strength;
  s.bspread[Ub.index] = sp0 + (sp - sp0) * strength;
  return true;
}

/** `a` plus the whole turns bringing it nearest `ref` (radians). */
const nearTurn = (a: number, ref: number) => a + 2 * Math.PI * Math.round((ref - a) / (2 * Math.PI));

/** The solutions `r` of A·cos r + B·sin r = C (the nearest value when there is none); `r0` when A, B vanish. */
function trig(A: number, B: number, C: number, r0: number): number[] {
  const R = Math.hypot(A, B);
  if (R < 1e-9) return [r0];
  const phi = Math.atan2(B, A), a = Math.acos(clamp(C / R, -1, 1));
  return [phi + a, phi - a];
}

/**
 * Two-bone reach of a 2.5D rig's limb in 3D (3D bones `ia` → `ib`, the second a child of the first):
 * the channel values (degrees) `[upper rotation, upper spread, lower rotation, lower turn]` putting
 * the lower bone's tip on `target` (body space) with the middle joint bent towards `pole` — the
 * upper bone's `turn` and the lower one's `spread` kept as posed. Of the two solutions of each bone,
 * the one nearest the current values (no jump to an equivalent turn). Out of reach the limb points
 * straight at the target. Undefined for a degenerate limb.
 */
function solveLimb3d(rig: Rig, r3: CompiledRig3d, s: PoseState, rot: number[][], pos: V3[], ia: number, ib: number, target: V3, pole: V3): [number, number, number, number] | undefined {
  const U = r3.bones[ia], L = r3.bones[ib];
  const e1 = sub3(L.from, U.from), e2 = sub3(L.to, L.from);
  const l1 = Math.hypot(...e1), l2 = Math.hypot(...e2);
  if (l1 < 1e-6 || l2 < 1e-6) return undefined;
  const parentOf = (i: number, own?: M3): M3 => {
    const B = r3.bones[i];
    if (B.parent < 0) return I3;
    return rig.bones[B.index].inheritRotation ? (own ?? rot[r3.byIndex.get(B.parent)!]) : rot[0];
  };
  const S = pos[ia];
  const D = sub3(target, S), dl = Math.hypot(...D);
  const dh = dl > 1e-6 ? ([D[0] / dl, D[1] / dl, D[2] / dl] as V3) : norm3(sub3(add3(pos[ib], mv(rot[ib], e2)), S));
  const d = clamp(dl, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  // The bend plane: the pole without its part along the reach (any perpendicular if it has none).
  const pd = dot3(pole, dh);
  let ph: V3 = [pole[0] - dh[0] * pd, pole[1] - dh[1] * pd, pole[2] - dh[2] * pd];
  if (Math.hypot(...ph) < 1e-9) ph = Math.abs(dh[0]) < 0.9 ? [0, -dh[2], dh[1]] : [dh[2], 0, -dh[0]];
  ph = norm3(ph);
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  const E = add3(S, [l1 * (cosA * dh[0] + sinA * ph[0]), l1 * (cosA * dh[1] + sinA * ph[1]), l1 * (cosA * dh[2] + sinA * ph[2])]);
  const T = add3(S, [dh[0] * d, dh[1] * d, dh[2] * d]);
  // Upper: ry(turn)·rz(spread)·rx(rotation) turns its rest direction onto the elbow's, in its parent's frame.
  const ui = U.index, li = L.index;
  const t0 = s.bturn[ui] * DEG, r0 = s.brot[ui] * DEG, s0 = s.bspread[ui] * DEG;
  const Rp = parentOf(ia);
  const u = mv(ry(-t0), mv(T3(Rp), norm3(sub3(E, S))));
  const v1 = norm3(e1);
  let best1: [number, number] = [r0, s0], cost = Infinity;
  // rx keeps x; rz keeps z: the z of rx(r)·v1 is u's.
  for (const rr of trig(v1[2], -v1[1], u[2], r0)) {
    const w = mv(rx(rr), v1);
    const sr = Math.hypot(w[0], w[1]) < 1e-9 || Math.hypot(u[0], u[1]) < 1e-9 ? s0 : Math.atan2(u[1], u[0]) - Math.atan2(w[1], w[0]);
    const a = nearTurn(rr, r0), b = nearTurn(sr, s0), e = (a - r0) ** 2 + (b - s0) ** 2;
    if (e < cost) [best1, cost] = [[a, b], e];
  }
  const R1 = mul(Rp, mul(ry(t0), mul(rz(best1[1]), rx(best1[0]))));
  // Lower: ry(turn)·rz(spread)·rx(rotation) turns its rest direction onto the forearm's.
  const sp = s.bspread[li] * DEG, r20 = s.brot[li] * DEG, t20 = s.bturn[li] * DEG;
  const f = mv(T3(parentOf(ib, R1)), norm3(sub3(T, E)));
  const v2 = norm3(e2), c = Math.cos(sp), sn = Math.sin(sp);
  let best2: [number, number] = [r20, t20];
  cost = Infinity;
  // ry keeps y: the y of rz(spread)·rx(r)·v2 is f's.
  for (const rr of trig(c * v2[1], c * v2[2], f[1] - sn * v2[0], r20)) {
    const p = mv(rz(sp), mv(rx(rr), v2));
    const tr = Math.hypot(p[0], p[2]) < 1e-9 || Math.hypot(f[0], f[2]) < 1e-9 ? t20 : Math.atan2(-f[2], f[0]) - Math.atan2(-p[2], p[0]);
    const a = nearTurn(rr, r20), b = nearTurn(tr, t20), e = (a - r20) ** 2 + (b - t20) ** 2;
    if (e < cost) [best2, cost] = [[a, b], e];
  }
  return [best1[0] / DEG, best1[1] / DEG, best2[0] / DEG, best2[1] / DEG];
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
    // (A hand goes by where it is: the tip of its forearm.)
    const ds = ch.bones.map((b) => (ch.tip ? frame.tipDepth : frame.depth).get(b)).filter((d): d is number => d !== undefined);
    if (!ds.length) continue;
    const d = Math.max(...ds) - bd;
    const margin = ch.margin ?? 25;
    // (A hand hidden by the body — its wrist behind the solid's occluders there — goes behind it.)
    const cover = ch.behind !== undefined ? rig.parts[ch.behind] : undefined;
    const last = ch.bones[ch.bones.length - 1], tv = frame.tipView.get(last);
    if (cover?.type === "solid" && tv && occluderDepthAt(cover.bodies, r3, frame, tv[0], tv[1]) > tv[2] + 2) {
      if (backKey !== undefined) moves.push({ parts: ch.parts, slot: backKey, depth: -1e6 });
      continue;
    }
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

// ------------------------------------------------------------------ posing a 3D skeleton (authoring)

/** Channel values of 3D bones (degrees), as a clip or the director would set them. */
export type Rig3dValues = Record<string, { rotation?: number; turn?: number; spread?: number }>;

interface Rig3dDocLike {
  skeleton: { id: string; parent?: string; inheritRotation?: boolean }[];
  rig3d?: { bones: Record<string, { from: V3; to: V3 }>; points?: Record<string, { bone: string; at: V3 }>; keepOut?: { bone: string; at: V3; radii: V3 }[] };
}

/** Where a named point of a document's `rig3d` (`points`) is in a pose (body space), or undefined. */
export function rig3dPoint(doc: Rig3dDocLike, values: Rig3dValues, name: string): V3 | undefined {
  const pt = doc.rig3d?.points?.[name];
  if (!pt) return undefined;
  const b = rig3dPose(doc, values)[pt.bone];
  return b ? add3(b.from, mv(b.rot, pt.at)) : undefined;
}

/**
 * Forward kinematics of a document's `rig3d` for channel values (body space, the hips at rest):
 * each 3D bone's joint, tip and rotation. The same posing as `applyRig3d` (before projection).
 */
export function rig3dPose(doc: Rig3dDocLike, values: Rig3dValues): Record<string, { from: V3; to: V3; rot: number[] }> {
  const def = doc.rig3d?.bones ?? {};
  const parentOf = new Map(doc.skeleton.map((b) => [b.id, b.parent]));
  const inherit = new Map(doc.skeleton.map((b) => [b.id, b.inheritRotation !== false]));
  const out: Record<string, { from: V3; to: V3; rot: number[] }> = {};
  let first: string | undefined;
  for (const b of doc.skeleton) {
    const d = def[b.id];
    if (!d) continue;
    let p = parentOf.get(b.id);
    while (p && !def[p]) p = parentOf.get(p);
    const v = values[b.id] ?? {};
    const local = mul(mul(ry((v.turn ?? 0) * DEG), rz((v.spread ?? 0) * DEG)), rx((v.rotation ?? 0) * DEG));
    let rot: M3, pos: V3;
    if (!p || !out[p]) {
      rot = local;
      pos = d.from;
      first ??= b.id;
    } else {
      const P = out[p];
      rot = mul(inherit.get(b.id) ? P.rot : out[first!].rot, local);
      pos = add3(P.from, mv(P.rot, sub3(d.from, def[p].from)));
    }
    out[b.id] = { from: pos, to: add3(pos, mv(rot, sub3(d.to, d.from))), rot };
  }
  return out;
}

/** The two angles (degrees) of `make(a, b)` turning `v` onto `w`, by a coarse-to-fine search. */
function fit2(make: (a: number, b: number) => M3, v: V3, w: V3, a0 = 0, b0 = 0, first = 64): [number, number, number] {
  const err = (a: number, b: number) => {
    const q = mv(make(a * DEG, b * DEG), v);
    return (q[0] - w[0]) ** 2 + (q[1] - w[1]) ** 2 + (q[2] - w[2]) ** 2;
  };
  let a = a0, b = b0, e = err(a, b);
  for (let step = first; step > 0.01; step /= 2) {
    let moved = true;
    while (moved) {
      moved = false;
      for (const [da, db] of [[step, 0], [-step, 0], [0, step], [0, -step], [step, step], [-step, -step], [step, -step], [-step, step]]) {
        const e2 = err(a + da, b + db);
        if (e2 < e - 1e-12) {
          a += da; b += db; e = e2; moved = true;
        }
      }
    }
  }
  return [a, b, e];
}

/** `fit2` staying near a guess (the pose before: no jump to an equivalent turn), else from scratch. */
function fitNear(make: (a: number, b: number) => M3, v: V3, w: V3, near?: [number, number]): [number, number] {
  if (near) {
    const [a, b, e] = fit2(make, v, w, near[0], near[1], 12);
    if (e < 1e-5) return [a, b];
  }
  const [a, b] = fit2(make, v, w);
  if (!near) return [wrapAngle(a), wrapAngle(b)];
  // Unwrapped to the turn nearest the guess.
  return [a + 360 * Math.round((near[0] - a) / 360), b + 360 * Math.round((near[1] - b) / 360)];
}

const norm3 = (v: V3): V3 => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const T3 = (m: M3): M3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

/**
 * Two-bone reach in 3D for a 2.5D rig (an arm onto a knee, around the shins): the channel values
 * of `upper` (`rotation`, `spread`) and `lower` (`rotation`, `turn`) putting the tip of `lower` on
 * `target` (body space), the middle joint bent towards `pole` (a direction: elbows back and out).
 * `values` holds the rest of the pose (the body's lean, the legs). Out of reach, the limb points
 * straight at the target.
 */
export function reach3d(doc: Rig3dDocLike, upper: string, lower: string, target: V3, values: Rig3dValues, pole: V3, near?: Rig3dValues): Rig3dValues {
  const def = doc.rig3d!.bones;
  const posed = rig3dPose(doc, { ...values, [upper]: {}, [lower]: {} });
  // A hand never goes into the body: a target inside a keep-out volume (an ellipsoid on a bone, as
  // posed) is moved out to its surface, straight out from its middle.
  for (const k of doc.rig3d!.keepOut ?? []) {
    const b = rig3dPose(doc, values)[k.bone];
    if (!b) continue;
    const c = add3(b.from, mv(b.rot, k.at));
    const local = mv(T3(b.rot), sub3(target, c));
    const q = Math.hypot(local[0] / k.radii[0], local[1] / k.radii[1], local[2] / k.radii[2]);
    if (q >= 1) continue;
    const dir = q < 1e-6 ? ([0, 0, 1] as V3) : local;
    const s = 1 / (Math.hypot(dir[0] / k.radii[0], dir[1] / k.radii[1], dir[2] / k.radii[2]) || 1);
    target = add3(c, mv(b.rot, [dir[0] * s, dir[1] * s, dir[2] * s]));
  }
  const U = posed[upper];
  // The upper bone's parent frame (its rotation with no channel of its own).
  const Rp = U.rot;
  const S = U.from;
  const l1 = Math.hypot(...sub3(def[upper].to, def[upper].from)), l2 = Math.hypot(...sub3(def[lower].to, def[lower].from));
  const D = sub3(target, S);
  const d = clamp(Math.hypot(...D), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  const dh = norm3(D);
  // The bend plane: the pole without its part along the reach.
  const pd = pole[0] * dh[0] + pole[1] * dh[1] + pole[2] * dh[2];
  const ph = norm3([pole[0] - dh[0] * pd, pole[1] - dh[1] * pd, pole[2] - dh[2] * pd]);
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  const E = add3(S, [l1 * (cosA * dh[0] + sinA * ph[0]), l1 * (cosA * dh[1] + sinA * ph[1]), l1 * (cosA * dh[2] + sinA * ph[2])]);
  const T = add3(S, [dh[0] * d, dh[1] * d, dh[2] * d]);
  const u = mv(T3(Rp), norm3(sub3(E, S)));
  const restU = norm3(sub3(def[upper].to, def[upper].from));
  const n1 = near?.[upper], n2 = near?.[lower];
  const [r1, s1] = fitNear((a, b) => mul(rz(b), rx(a)), restU, u, n1 ? [n1.rotation ?? 0, n1.spread ?? 0] : undefined);
  const R1 = mul(Rp, mul(rz(s1 * DEG), rx(r1 * DEG)));
  const f = mv(T3(R1), norm3(sub3(T, E)));
  const restL = norm3(sub3(def[lower].to, def[lower].from));
  const [r2, t2] = fitNear((a, b) => mul(ry(b), rx(a)), restL, f, n2 ? [n2.rotation ?? 0, n2.turn ?? 0] : undefined);
  const k = (n: number) => Math.round(n * 100) / 100;
  return { [upper]: { rotation: k(r1), spread: k(s1), turn: 0 }, [lower]: { rotation: k(r2), turn: k(t2), spread: 0 } };
}
