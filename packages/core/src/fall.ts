/**
 * Falls: the geometry of a body lying flat on the ground (`lyingPose`), the parts that are its shadow
 * on the floor (`groundParts`), and the timing of a cartoon knock-down — thrown back through the air
 * or tripping in place, the hips landing first, the shoulders and the head slapping down after them,
 * one small bounce and a settle — and of getting back up. The `fall` / `getUp` script actions
 * compile to it; the director lays its fallen and sleeping characters down with the same geometry.
 *
 * Everything here moves the whole actor (its placement: x, y, rotation, scale), never a bone of the
 * skeleton: a 2.5D rig re-projects its 3D bones every frame and cancels a rotation of their 2D
 * parents (`applyRig3d`), so only the actor's own rotation lays every kind of rig down alike. The
 * actor turns about its origin (between the feet); the planner places that origin so the point of
 * the body that touches the floor is where the timing wants it.
 */
import { type Key, makeTrack, sampleTrack } from "./keyframes";
import { type Vec2, DEG, apply, clamp } from "./math";
import { viewPoint } from "./pose3d";
import type { Rig } from "./rig";

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const turn = (deg: number, v: Vec2): Vec2 => {
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c];
};

export interface LyingOptions {
  /** Facing: 1 = towards +x (the rig as drawn), −1 = flipped. Default 1. */
  dir?: 1 | -1;
  /** `"back"` (default): face up, resting on the back; `"front"`: face down, on the belly. */
  side?: "back" | "front";
  /** The actor's scale (a number or `[x, y]`, positive): `offset` is in scene px with it. Default 1. */
  scale?: number | [number, number];
  /**
   * The hip joint, character space. Default: the rig's `hip` anchor, else the middle of the legs'
   * hip joints (the first bones of the IK chains that stand on the ground: `rig3d`'s side-plane
   * legs, or chains whose rest tip is on the floor), else 40% of the skeleton's height up.
   */
  hip?: Vec2;
  /** The top of the spine, character space. Default: the `head` anchor, else 85% of the skeleton's height up. */
  head?: Vec2;
  /**
   * Half thickness of the body on `side` (character px): how high the spine lies above the floor.
   * Default, on a 2.5D rig: its upper body as drawn in `view` — the `rig3d.torso` ellipsoids' reach
   * behind (or in front of) the spine in the picture, and the arms hanging at rest (`rig3d.clear`,
   * an arm's half width `torsoGap` round them, twice that at the shoulder); the body then lies on
   * them, its head end raised (`tilt`) where they would sink at the shoulders. Else 70% of the
   * smaller of 34 px and 12% of the skeleton's height, the spine flat.
   */
  depth?: number;
  /**
   * The `rig3d` view (a pose of the `view` control) the body is drawn in: the torso depth and the
   * head are measured as drawn in it (default `"profile"`, else the side view), and a 2.5D neck's
   * bend is split by its yaw into `rotation` and `spread` (without a view it is all `rotation`).
   */
  view?: string;
  /**
   * The bone that bends so the head lines up with the spine (a hunched character's head sits far in
   * front of its hips) and lifts a big head off the floor (`skull`): default the `neck` bone, else
   * the `head` anchor's bone, else `head`; `null` for none. The bend is limited to ±60° and to the
   * bone's own rotation limits.
   */
  neck?: string | null;
  /**
   * How far the head reaches out of the back (or, face down, of the belly) past the `head` point
   * (px). A head reaching farther than the torso would sink into the floor: the neck lifts it first
   * (the chin tucks towards the chest, as far as the neck bends), then the head end of the whole
   * body is raised (`tilt`) so it lies on the line touching the torso and the skull. Default: the
   * `rig3d.keepOut` ellipsoids on the head's bone as drawn in `view` (none without them); `false`
   * to lie the spine flat whatever the head.
   */
  skull?: number | false;
}

/** Where and how a body lies flat on the ground (see `lyingPose`). */
export interface LyingPose {
  /** The actor rotation (degrees) that lays the spine (hip joint → head) flat, raised by `tilt` at the head end. */
  rotation: number;
  /** The point of the body that rests on the ground, character space: `depth` out of the back (or the belly) at the hip joint. */
  contact: Vec2;
  /** The outward normal of the back, character space (the belly's is its opposite). */
  normal: Vec2;
  /** Where `contact` lands relative to the actor's origin once rotated and scaled (scene px): lying, the actor's `y` is the floor's minus `offset[1]`. */
  offset: Vec2;
  /** The top of the spine once the neck is bent. */
  head: Vec2;
  /** The hip joint and the depth used. */
  hip: Vec2;
  depth: number;
  /**
   * How much the head end is raised (degrees, ≥ 0, included in `rotation`) so the upper body as
   * drawn (a measured `depth`) and the skull (`skull`) rest on the floor instead of sinking into it.
   */
  tilt: number;
  /**
   * The neck bend that lines the head up with the spine and lifts a big head off the floor (`skull`),
   * when more than 1°: the bone's `rotation` channel — on a 2.5D neck, split into `rotation` and
   * `spread` by the view's yaw, so the head turns by the same angle in the picture from any side.
   */
  neck?: { bone: string; rotation: number; spread?: number };
}

/** Height of the skeleton at rest: the highest joint or bone tip above the origin (px, positive). */
function skeletonHeight(rig: Rig): number {
  let top = 0;
  for (const b of rig.bones) {
    const m = b.setupWorld;
    top = Math.min(top, m[5], apply(m, [b.length, 0])[1]);
  }
  return -top || 200;
}

/**
 * The hip joint of a rig at rest (character space): its `hip` anchor, else the middle of the legs'
 * hip joints (the first bones of the IK chains standing on the ground), else 40% of the height up.
 */
function rigHip(rig: Rig, height: number): Vec2 {
  const anchor = rig.anchors.hip;
  if (anchor) return [anchor.at[0], anchor.at[1]];
  const legs = rig.rig3d
    ? rig.rig3d.sideIk.map((c) => rig.ik[c])
    : rig.ik.filter((k) => k.bones.length >= 2 && Math.abs(k.restTarget[1]) <= 0.1 * height);
  if (!legs.length) return [0, -Math.round(height * 0.4)];
  let x = 0, y = 0;
  for (const k of legs) {
    const m = rig.bones[k.bones[0]].setupWorld;
    x += m[4];
    y += m[5];
  }
  return [x / legs.length, y / legs.length];
}

/** A point turned by the neck bend (`rot` degrees about `pivot`); unchanged without one. */
function about(bend: { pivot: Vec2; rot: number } | undefined, p: Vec2): Vec2 {
  if (!bend) return p;
  const q = turn(bend.rot, [p[0] - bend.pivot[0], p[1] - bend.pivot[1]]);
  return [bend.pivot[0] + q[0], bend.pivot[1] + q[1]];
}

/** An ellipse of a volume as drawn (character space): its centre and half sizes across and along the picture. */
interface Drawn {
  centre: Vec2;
  hx: number;
  hy: number;
}

/**
 * A 2.5D rig's volumes at rest as drawn in a view, in character space: a 3D point (body space)
 * projected the way the rig projects its bones (`applyRig3d`: anchored at the first 3D bone's
 * joint), and an ellipsoid on a 3D bone (`rig3d.torso`, `keepOut`) as the ellipse it draws.
 */
function drawnIn(rig: Rig, view: string | undefined) {
  const r = rig.rig3d!;
  const yaw = (r.views[view ?? "profile"] ?? r.views.profile ?? 90) * DEG, pitch = r.pitch * DEG;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const first = r.bones[0];
  const p0 = viewPoint(first.from, yaw, pitch), m0 = rig.bones[first.index].setupWorld;
  const point = (p: [number, number, number]): Vec2 => {
    const q = viewPoint(p, yaw, pitch);
    return [m0[4] + q[0] - p0[0], m0[5] + q[1] - p0[1]];
  };
  const ellipsoid = (bone: number, at: [number, number, number], radii: [number, number, number]): Drawn | undefined => {
    const i = r.byIndex.get(bone);
    if (i === undefined) return undefined;
    const j = r.bones[i].from;
    return { centre: point([j[0] + at[0], j[1] + at[1], j[2] + at[2]]), hx: Math.hypot(radii[0] * c, radii[2] * s), hy: radii[1] };
  };
  return { point, ellipsoid, c, s };
}

/** The point of a drawn ellipse farthest along `out` (unit), the ellipse turned by `rot` degrees. */
function support(e: Drawn, out: Vec2, rot = 0): Vec2 {
  const o = turn(-rot, out);
  const reach = Math.hypot(o[0] * e.hx, o[1] * e.hy);
  const d = reach > 0 ? turn(rot, [(o[0] * e.hx * e.hx) / reach, (o[1] * e.hy * e.hy) / reach]) : [0, 0];
  return [e.centre[0] + d[0], e.centre[1] + d[1]];
}

/**
 * The upper body as drawn in a view, on one side (`out`: out of the back, or of the belly): the
 * points of it farthest that way — each `rig3d.torso` ellipsoid's, and the 2.5D arms hanging at rest
 * (`rig3d.clear`: shoulder, elbow, wrist, an arm's half width `torsoGap` out from them — twice that at
 * the shoulder, drawn rounder with its cap or a sleeve; lying turns
 * the drawn view onto its back, so from three quarters or the front the near arm lies along the body
 * on the floor's side) — and its half thickness there: how far the farthest reaches from the spine
 * (seen from the side the chest's depth; from three quarters the shoulders' width shows too).
 */
function upperBody(rig: Rig, side: "back" | "front", view: string | undefined, out: Vec2): { depth: number; points: Vec2[] } | undefined {
  const r = rig.rig3d;
  if (!r?.torso.length) return undefined;
  const d = drawnIn(rig, view);
  const k = side === "back" ? -1 : 1;
  // Across the picture a body point's x is x·cos(yaw) + z·sin(yaw) (`viewPoint`), the spine at 0.
  const reach = (x: number, z: number) => k * (x * d.c + z * d.s);
  let depth = 0;
  const points: Vec2[] = [];
  for (const t of r.torso) {
    const e = d.ellipsoid(t.bone, t.at, t.radii);
    const i = r.byIndex.get(t.bone);
    if (!e || i === undefined) continue;
    const j = r.bones[i].from;
    depth = Math.max(depth, reach(j[0] + t.at[0], j[2] + t.at[2]) + Math.hypot(t.radii[0] * d.c, t.radii[2] * d.s));
    points.push(support(e, out));
  }
  const gap = r.torsoGap ?? 0;
  for (const cl of r.clear) {
    const u = r.byIndex.get(cl.upper), l = r.byIndex.get(cl.lower);
    if (u === undefined || l === undefined) continue;
    // (The shoulder is drawn rounder than the arm — its cap, a sleeve: twice the half width.)
    for (const [p, g] of [[r.bones[u].from, 2 * gap], [r.bones[l].from, gap], [r.bones[l].to, gap]] as const) {
      depth = Math.max(depth, reach(p[0], p[2]) + g);
      const q = d.point(p);
      points.push([q[0] + out[0] * g, q[1] + out[1] * g]);
    }
  }
  return depth > 0 ? { depth, points } : undefined;
}

/**
 * The point of the head farthest along `out` (character space, at rest, as drawn in `view`): the
 * `rig3d.keepOut` ellipsoids on the head's bone (the `head` anchor's, else `head`) — the cranium
 * with its hair and the face, as the arms keep out of them — turned by the neck bend.
 */
function headReach(rig: Rig, view: string | undefined, out: Vec2, bend: { pivot: Vec2; rot: number } | undefined): Vec2 | undefined {
  const r = rig.rig3d;
  const hb = rig.anchors.head?.bone ?? rig.boneIndex.get("head");
  if (!r || hb === undefined || !r.bones.length) return undefined;
  const d = drawnIn(rig, view);
  let best: Vec2 | undefined, bestD = -Infinity;
  for (const k of r.keepOut) {
    if (k.bone !== hb) continue;
    const e = d.ellipsoid(k.bone, k.at, k.radii);
    if (!e) continue;
    const p = support({ ...e, centre: about(bend, e.centre) }, out, bend?.rot ?? 0);
    const reach = out[0] * p[0] + out[1] * p[1];
    if (reach > bestD) [bestD, best] = [reach, p];
  }
  return best;
}

/**
 * Lying flat: the spine (hip joint → head) horizontal whatever the posture, face up (`side:
 * "back"`, the head towards the back) or face down (`"front"`). Returns the actor rotation, the
 * point of the back (or the belly) that rests on the ground — `depth` out from the spine at the hip
 * joint — the back's outward normal, where that point lands relative to the actor's origin (scene
 * px, rotated, scaled and facing `dir`), and the neck bend that lines the head up with the spine.
 * The actor rotates about its origin (between the feet); its `y` lying is the floor's minus
 * `offset[1]`, so nothing sinks into the ground.
 */
export function lyingPose(rig: Rig, o: LyingOptions = {}): LyingPose {
  const dir = o.dir ?? 1;
  const [sx, sy] = Array.isArray(o.scale) ? o.scale : [o.scale ?? 1, o.scale ?? 1];
  const height = skeletonHeight(rig);
  const hip = o.hip ?? rigHip(rig, height);
  const head0: Vec2 = o.head ?? (rig.anchors.head ? [rig.anchors.head.at[0], rig.anchors.head.at[1]] : [0, -height * 0.85]);
  const lean = (h: Vec2) => (Math.atan2(h[0] - hip[0], -(h[1] - hip[1])) * 180) / Math.PI;
  // The neck bends back so the head lines up with the spine: the legs stay flat and the head
  // reaches the floor (or the pillow).
  const neckIndex = o.neck === null ? undefined : o.neck !== undefined ? rig.boneIndex.get(o.neck) : (rig.boneIndex.get("neck") ?? rig.anchors.head?.bone ?? rig.boneIndex.get("head"));
  const neckBone = neckIndex === undefined ? undefined : rig.bones[neckIndex];
  const lim: [number, number] = neckBone?.limits ? [Math.max(-60, neckBone.limits[0]), Math.min(60, neckBone.limits[1])] : [-60, 60];
  const pivot: Vec2 | undefined = neckBone && [neckBone.setupWorld[4], neckBone.setupWorld[5]];
  const bendBy = (rot: number) => (pivot ? { pivot, rot } : undefined);
  const base = pivot ? clamp(-lean(head0), lim[0], lim[1]) : 0;
  const head = about(bendBy(base), head0);
  const rest = lean(head);
  const v = [head[0] - hip[0], head[1] - hip[1]];
  const len = Math.hypot(v[0], v[1]) || 1;
  const normal: Vec2 = [v[1] / len, -v[0] / len]; // out of the back
  const back = (o.side ?? "back") === "back";
  const side = back ? "back" : "front";
  const out: Vec2 = back ? normal : [-normal[0], -normal[1]];
  const body = o.depth === undefined ? upperBody(rig, side, o.view, out) : undefined;
  const depth = o.depth ?? body?.depth ?? Math.min(34, height * 0.12) * 0.7;
  const contact: Vec2 = [hip[0] + out[0] * depth, hip[1] + out[1] * depth];
  // The floor under the body: the line through `contact` turned `tilt` degrees from the spine,
  // the head end up. How far a point sticks out of it, and the tilt that just takes it in.
  const along = (p: Vec2) => (v[0] * (p[0] - hip[0]) + v[1] * (p[1] - hip[1])) / len;
  const beyond = (p: Vec2, t: number) => out[0] * (p[0] - contact[0]) + out[1] * (p[1] - contact[1]) - along(p) * Math.tan(t * DEG);
  const needs = (p: Vec2) => (Math.atan2(out[0] * (p[0] - contact[0]) + out[1] * (p[1] - contact[1]), along(p)) * 180) / Math.PI;
  // Measured from its volumes, the body lies on its back as drawn, not on the line from the hips to
  // the head: an upright back under a head held forward would sink at the shoulders. Whatever of
  // the upper body sticks out of the floor raises the head end (never lowered: the volumes are
  // only a model of the drawing, and resting on the hips is the safe side).
  let tilt = 0;
  const upper = (body?.points ?? []).filter((p) => along(p) > 0.25 * len);
  if (upper.length) tilt = clamp(Math.max(...upper.map(needs)), 0, 30);
  // A big cartoon head reaches farther out of the back (or, face down, of the belly) than the
  // torso. First the neck lifts it — the chin tucks towards the chest (face down: the head tips
  // back), as far as the neck bends — then whatever still sticks out raises the head end of the
  // whole body more: it lies on the line touching the torso and the skull, so the back of the
  // skull (the face) rests on the floor instead of sinking into it.
  let bend = base;
  if (o.skull !== false) {
    const reach = (rot: number): Vec2 | undefined => {
      if (typeof o.skull !== "number") return headReach(rig, o.view, out, bendBy(rot));
      const h = about(bendBy(rot), head0);
      return [h[0] + out[0] * o.skull, h[1] + out[1] * o.skull];
    };
    const over = (rot: number) => {
      const p = reach(rot);
      return p ? beyond(p, tilt) : 0;
    };
    if (pivot && over(base) > 0) {
      // (Bisection between the straight neck and its limit on the side that lifts the head.)
      const way = over(base + 1) < over(base) ? 1 : -1;
      const far = way > 0 ? lim[1] : lim[0];
      if (way * (far - base) > 0) {
        if (over(far) > 0) bend = far;
        else {
          let lo = base, hi = far;
          for (let i = 0; i < 30; i++) {
            const mid = (lo + hi) / 2;
            if (over(mid) > 0) lo = mid;
            else hi = mid;
          }
          bend = hi;
        }
      }
    }
    const p = reach(bend);
    if (p && over(bend) > 0.5 && along(p) > 0) tilt = Math.min(45, Math.max(tilt, needs(p)));
  }
  let neck: LyingPose["neck"];
  if (neckBone && Math.abs(bend) > 1) {
    // In a given view a 2.5D neck turns in the picture by `bend` as `rotation` (about the sideways
    // axis, what shows from the side) plus `spread` (about the forward axis, what shows from the
    // front), split by the view's yaw. Without a view the bend is all `rotation`.
    const r = rig.rig3d, yaw = o.view !== undefined && r?.byIndex.has(neckBone.index) && r.views[o.view] !== undefined ? r.views[o.view] * DEG : undefined;
    neck = yaw === undefined ? { bone: neckBone.id, rotation: r3(bend) } : { bone: neckBone.id, rotation: r3(bend * Math.sin(yaw)), ...(Math.abs(bend * Math.cos(yaw)) > 0.5 ? { spread: r3(bend * Math.cos(yaw)) } : {}) };
  }
  const rotation = r3(back ? -dir * (90 + rest - tilt) : dir * (90 - rest - tilt));
  const offset = turn(rotation, [contact[0] * dir * sx, contact[1] * sy]);
  return { rotation, contact, normal, offset, head, hip, depth, tilt: r3(tilt), ...(neck ? { neck } : {}) };
}

/**
 * Ids of the parts drawn only on the bone named `ground` — by convention the character's shadow on
 * the floor, a top-level bone that the body's moves leave on the ground. The actor's own rotation
 * turns it with the body, so a fall hides these parts while the body is off its feet.
 */
export function groundParts(rig: Rig): string[] {
  const g = rig.boneIndex.get("ground");
  if (g === undefined) return [];
  return rig.parts
    .filter((p) => {
      const bones =
        p.type === "rigid" || p.type === "switch" || p.type === "morph" ? [p.bone]
        : p.type === "hose" ? p.bones
        : p.type === "skinned" ? p.influences
        : p.type === "hull" ? p.points.map((q) => q.bone)
        : [];
      return bones.length > 0 && bones.every((b) => b === g);
    })
    .map((p) => p.id);
}

// ------------------------------------------------------------------ timing (used by the scene compiler)

/** Height of a rig's skeleton (px at scale 1): what a fall's default distance, hop and bounce scale with. */
export const fallHeight = skeletonHeight;

/** Placement keys of a fall or a getting up (scene space), in time order. */
export interface FallKeys {
  x: Key[];
  y: Key[];
  rotation: Key[];
  /** Only while the landing squashes (pairs; the last key steps back to the actor's own scale). */
  scale: Key[];
}

export interface FallPlanInput {
  at: number;
  /** Where the actor stands when it falls: its origin, rotation and scale (positive pair). */
  x: number;
  y: number;
  rotation: number;
  scale: [number, number];
  /** The floor (scene y) the body lands on: where its feet were. */
  floor: number;
  dir: 1 | -1;
  /** The way the body travels along x (+1 / −1). */
  away: 1 | -1;
  /** `lyingPose` of the rig (its `contact` and `rotation`). */
  pose: LyingPose;
  /** Seconds to the ground (the hips touching down). */
  duration: number;
  /** Extra travel of the hips (scene px) on top of a plain fall's, along `away`. */
  distance: number;
  /** How high the hips rise over their standing height before falling (scene px). */
  hop: number;
  /** The standing height (scene px): the bounce and a trip's backward travel scale with it. */
  height: number;
  /** A full turn in the air before landing. */
  spin: boolean;
  /**
   * The actor's speed along x when it falls (scene px/s; a walk under way): the body carries it on,
   * slowing, until it has skidded to a stop.
   */
  velocity?: number;
  /** Landing squash and stretch. */
  squash: boolean;
  /**
   * Hips first: the body lands with the spine 15° off the floor and the shoulders and the head
   * slap down two frames later (the legs must be folded up by then: a flight clip). Off, the whole
   * back lands at once.
   */
  staged: boolean;
}

/** The fall's moments: the hips touching down, the back flat on the floor, everything settled. */
export interface FallPlan extends FallKeys {
  land: number;
  flat: number;
  end: number;
}

/** Monotone spline through (u, value) points, sampled at u. */
function curve(points: [number, number][]): (u: number) => number {
  const track = makeTrack(points.map(([t, v]) => ({ t, v })));
  return (u: number) => sampleTrack(track, clamp(u, 0, 1)) as number;
}
// The body's turn over the flight (share of the turn by share of the time). Thrown: snapped back
// after a 2-frame impact, fastest early, slowing into the landing (Hsiao & Robinovitch's falls,
// fighting-game knock-downs). Tripping: slow to tip, then faster and faster (a body toppling).
const THROWN_TURN = curve([[0, 0], [0.094, 0.067], [0.235, 0.33], [0.53, 0.73], [0.82, 0.93], [1, 1]]);
const TRIP_TURN = curve([[0, 0], [0.25, 0.06], [0.5, 0.25], [0.75, 0.6], [1, 1]]);
/** Share of the lying turn reached when the hips touch down (75° of 90°): the shoulders are still up. */
const HIPS_FIRST = 0.83;
const SLAP = 0.07;
const SAMPLE = 1 / 60;

function times(a: number, b: number, marks: number[]): number[] {
  const out: number[] = [];
  for (let t = a; t < b - 1e-9; t += SAMPLE) out.push(t);
  out.push(b, ...marks.filter((m) => m > a && m < b));
  return [...new Set(out.map((t) => Math.round(t * 1e6) / 1e6))].sort((p, q) => p - q);
}

/**
 * Plans a knock-down as placement keys (60 a second, linear in between): the point of the back that
 * will rest on the floor (`pose.contact`) flies on a ballistic arc — up `hop` and hanging at the top,
 * then down faster and faster — while sliding `away` (fastest right after the hit, still sliding a
 * little when it lands); the body turns towards lying (the hips land first at 75°, the shoulders and
 * head slap down 2 frames later), squashes flat, bounces once (6% of the height thrown, 3.5%
 * tripping), rocks back 6° and settles. The origin is placed every sample so that contact point is
 * exactly where the arc says: the back lands on the floor, never into it, at any scale and facing.
 */
export function planFall(p: FallPlanInput): FallPlan {
  const { at, dir, away, pose: g } = p;
  const [sx, sy] = p.scale;
  const D = p.duration;
  const c = g.contact;
  const rel = (th: number, kx = 1, ky = 1) => turn(th, [c[0] * dir * sx * kx, c[1] * sy * ky]);
  const r0 = p.rotation, thL = g.rotation;
  const thrown = p.distance > 0 || p.hop > 0;
  const thHip = p.staged ? r0 + (thL - r0) * HIPS_FIRST : thL;
  const P0: Vec2 = [p.x + rel(r0)[0], p.y + rel(r0)[1]];
  // Along x (displacement `away`): the hips sit back (half the hip height: a trip) plus the throw;
  // fastest right after the hit, decaying, still sliding when they land, then a skid easing out.
  const h0 = Math.max(0, p.floor - P0[1]);
  const K = 2, skidT = 0.15;
  const endSpeed = (K * Math.exp(-K)) / (1 - Math.exp(-K));
  const travel = 0.5 * h0 + p.distance;
  const flightTravel = travel / (1 + (endSpeed * skidT) / (2 * D));
  const skid = travel - flightTravel;
  const slide = (t: number) => {
    if (t <= at + D) return flightTravel * ((1 - Math.exp((-K * (t - at)) / D)) / (1 - Math.exp(-K)));
    const w = clamp((t - at - D) / skidT, 0, 1);
    return flightTravel + skid * (1 - (1 - w) * (1 - w));
  };
  // The momentum it had (a walk): carried on, dying away over the flight and the skid.
  const v = p.velocity ?? 0, T = D / 2, vL = v * Math.exp(-D / T);
  const carry = (t: number) => {
    if (t <= at + D) return v * T * (1 - Math.exp(-(t - at) / T));
    const w = clamp((t - at - D) / skidT, 0, 1);
    return v * T * (1 - Math.exp(-D / T)) + ((vL * skidT) / 2) * (1 - (1 - w) * (1 - w));
  };
  const along = (t: number) => away * slide(t) + carry(t);
  const turnCurve = thrown ? THROWN_TURN : TRIP_TURN;
  const sgn = Math.sign(thL - r0) || -1;
  // The turn: a full spin in the air (thrown), taken off again the instant the hips land.
  const spinAt = (u: number) => (p.spin ? sgn * 360 * (1 - (1 - u) * (1 - u)) : 0);
  const turnAt = (tau: number) => r0 + (thHip - r0) * turnCurve(tau / D);
  // Thrown, the body first snaps back about its feet, which slide on the floor (a fifth of the way:
  // the front foot kicks up as the hips go back); then it leaves the ground and the point that will
  // land flies a ballistic arc — up to `hop` over its standing height, a hang at the top, faster and
  // faster down — touching the floor at D. Tripping, that point just drops, faster and faster.
  const tOff = p.hop > 0 ? 0.2 * D : 0;
  const qOff = rel(turnAt(tOff)), q0 = rel(r0);
  const lift = tOff > 0 ? qOff[0] - q0[0] : 0;
  const hOff = tOff > 0 ? Math.max(0, p.floor - (p.y + qOff[1])) : h0, S = D - tOff;
  let v0 = 0, grav = 0;
  if (p.hop > 0) {
    const rise = Math.max(1e-6, h0 + p.hop - hOff);
    const ta = S / (1 + Math.sqrt(1 + hOff / rise));
    grav = (2 * rise) / (ta * ta);
    v0 = grav * ta;
  } else grav = (2 * hOff) / (S * S);
  /** The landing point (scene) during the flight, or null while the body still turns about its feet. */
  const flight = (t: number): Vec2 | null => {
    const tau = t - at;
    if (tau < tOff) return null;
    const s = tau - tOff;
    return [P0[0] + along(t) + lift, p.floor - Math.max(0, hOff + v0 * s - (grav * s * s) / 2)];
  };
  const L = at + D, Ls = L + (p.staged ? SLAP : 0);
  const B1 = Ls + 0.05, T1 = thrown ? 0.26 : 0.2, B1e = B1 + T1, T2 = 0.1, B2e = B1e + T2;
  const hb1 = p.height * (thrown ? 0.06 : 0.035), hb2 = hb1 * 0.25;
  const rock1 = thrown ? 6 : 4, rock2 = 1.5;
  const end = B2e + 0.15;
  const k = curve([[0, 0], [(Ls + 0.035 - L) / (end - L), 1], [(B1 + 0.02 - L) / (end - L), 0.5], [(B1 + T1 / 2 - L) / (end - L), -0.3], [(B1e - L) / (end - L), 0], [(B1e + 0.035 - L) / (end - L), 0.35], [1, 0]]);
  const keys: FallKeys = { x: [], y: [], rotation: [], scale: [] };
  for (const t of times(at, end, [L, Ls, B1, B1e, B2e])) {
    let th: number, sq = 0, P: Vec2 | null;
    if (t <= L) {
      const u = (t - at) / D;
      th = turnAt(t - at) + spinAt(u);
      P = flight(t);
      if (!P) {
        // About the feet, sliding on the floor.
        const q = rel(th);
        P = [p.x + along(t) + q[0], p.y + q[1]];
      }
    } else {
      if (t <= Ls) th = thHip + (thL - thHip) * ((t - L) / SLAP) ** 2;
      else if (t > B1 && t <= B1e) th = thL - Math.sign(thL) * rock1 * Math.sin((Math.PI * (t - B1)) / T1);
      else if (t > B1e && t <= B2e) th = thL - Math.sign(thL) * rock2 * Math.sin((Math.PI * (t - B1e)) / T2);
      else th = thL;
      const h = t > B1 && t < B1e ? 4 * hb1 * ((t - B1) / T1) * (1 - (t - B1) / T1) : t > B1e && t < B2e ? 4 * hb2 * ((t - B1e) / T2) * (1 - (t - B1e) / T2) : 0;
      if (p.squash) sq = k((t - L) / (end - L));
      P = [P0[0] + along(t) + lift, p.floor - h];
    }
    const kx = 1 - 0.12 * sq, ky = 1 + 0.12 * sq;
    const q = rel(th, kx, ky);
    keys.x.push({ t, v: P[0] - q[0], ease: "linear" });
    keys.y.push({ t, v: P[1] - q[1], ease: "linear" });
    keys.rotation.push({ t, v: th, ease: "linear" });
    // (The spin is taken off the instant the hips land: the same drawing, a turn less.)
    if (p.spin && t === L) keys.rotation.push({ t: L + 1e-6, v: thHip, ease: "step" });
    if (p.squash && t >= L) keys.scale.push({ t, v: [sx * kx, sy * ky], ease: "linear" });
  }
  return { ...keys, land: L, flat: Ls, end };
}

export interface GetUpPlanInput {
  at: number;
  duration: number;
  /** Where the actor lies: its origin and rotation (scene space). */
  x: number;
  y: number;
  rotation: number;
  floor: number;
  scale: [number, number];
  dir: 1 | -1;
  pose: LyingPose;
  /**
   * The bone the legs hang from (`hipBone`): lowered (its `y` channel) so the body sits on the floor
   * with the knees up before it stands. Without one the body turns back up about its feet.
   */
  hipBone?: string;
}

/** Placement keys of getting up, and the hip bone's lowering (character px, a `y` offset) over it. */
export interface GetUpPlan extends FallKeys {
  hipsY: Key[];
  /** The moment the body sits upright on the floor, knees up, about to stand. */
  seated: number;
}

/**
 * The bone the legs hang from: the parent of the first bones of the leg IK chains (as `lyingPose`
 * finds them: `rig3d`'s side-plane legs, or chains whose rest tip is on the floor) when they share
 * one, else none.
 */
export function hipBone(rig: Rig): string | undefined {
  const height = skeletonHeight(rig);
  const legs = rig.rig3d
    ? rig.rig3d.sideIk.map((c) => rig.ik[c])
    : rig.ik.filter((k) => k.bones.length >= 2 && Math.abs(k.restTarget[1]) <= 0.1 * height);
  const parents = new Set(legs.map((k) => rig.bones[k.bones[0]].parent));
  if (parents.size !== 1) return undefined;
  const p = [...parents][0];
  return p === undefined || p < 0 ? undefined : rig.bones[p].id;
}

// Getting up. Sitting up: slow to leave the floor, then the torso swings up about the hips (the
// heaviest part rises last). Turning about the feet instead (no hip bone): a beat gathering, up
// through upright to a few degrees past it, and back.
const SIT_UP = curve([[0, 0], [0.2, 0.06], [0.6, 0.62], [0.85, 0.94], [1, 1]]);
const STAND = curve([[0, 0], [0.15, 0.04], [0.55, 0.62], [0.82, 1.04], [1, 1]]);
const RISE = curve([[0, 0], [0.18, 0.03], [0.5, 0.45], [0.74, 1.06], [1, 1]]);
/** Share of getting up spent sitting up into a crouch (the rest is standing up from it). */
const SIT_SHARE = 0.5;

/**
 * Plans getting back up. With a hip bone: the body first sits up — it turns about the hip joint,
 * the back leaving the floor, and the hips then rise as the weight rolls forward onto the feet —
 * while the hip bone is lowered just enough that the feet never go into the floor (they slide in
 * under the body as it comes up, the knees folding), so it ends upright in a deep crouch over its
 * feet; then it stands, the hips rising over the planted feet with a little overshoot. Without one, the body turns about its feet back to upright
 * (and a little past it, then back), the origin rising so the lying back never goes into the floor.
 */
export function planGetUp(p: GetUpPlanInput): GetUpPlan {
  const [sx, sy] = p.scale;
  const keys: GetUpPlan = { x: [], y: [], rotation: [], scale: [], hipsY: [], seated: p.at };
  const end = p.at + p.duration;
  if (!p.hipBone) {
    const c = p.pose.contact;
    for (const t of times(p.at, end, [])) {
      const th = p.rotation * (1 - RISE((t - p.at) / p.duration));
      const q = turn(th, [c[0] * p.dir * sx, c[1] * sy]);
      keys.rotation.push({ t, v: th, ease: "linear" });
      keys.y.push({ t, v: p.floor - Math.max(0, q[1]), ease: "linear" });
      keys.x.push({ t, v: p.x, ease: "linear" });
    }
    return keys;
  }
  const [hx, hy] = p.pose.hip;
  // The hip joint where it lies (scene): the pivot of sitting up.
  const H0 = turn(p.rotation, [hx * p.dir * sx, hy * sy]);
  const Hx = p.x + H0[0], Hy0 = p.y + H0[1];
  // How deep the hips sink at most (character px): a deep crouch, half the hip height.
  const most = Math.max(0, -hy * 0.5);
  // Upright in that crouch, the hip joint is over the feet on the floor: it rises there over the
  // second part of sitting up (the weight rolling forward onto the feet).
  const HyA = p.floor + (hy + most) * sy;
  const A = p.at + p.duration * SIT_SHARE;
  const hipY = (u: number) => Hy0 + (HyA - Hy0) * Math.min(1, Math.max(0, (u - 0.2) / 0.8)) ** 1.5;
  /** The origin for a rotation, a hip joint height and a lowering of the hips: the hip joint stays at (Hx, Hy). */
  const origin = (th: number, Hy: number, h: number): Vec2 => {
    const q = turn(th, [hx * p.dir * sx, (hy + h) * sy]);
    return [Hx - q[0], Hy - q[1]];
  };
  /**
   * Just enough lowering that the feet (the origin) are not below the floor, within the crouch —
   * kept a little over it while the body is still tilted (a foot turned with it would dig its toe
   * or heel in), coming down flat as it gets upright.
   */
  const above = (th: number) => p.floor - 0.12 * -hy * sy * Math.abs(Math.sin(th * DEG));
  const lower = (th: number, Hy: number) => {
    const below = origin(th, Hy, 0)[1] - above(th);
    const c = Math.cos(th * DEG) * sy;
    return below > 0 && c > 1e-6 ? Math.min(most, below / c) : 0;
  };
  const hA = lower(0, HyA);
  const seat = origin(0, HyA, hA);
  for (const t of times(p.at, end, [A])) {
    let th: number, h: number, o: Vec2;
    if (t <= A) {
      const u = (t - p.at) / (A - p.at);
      th = p.rotation * (1 - SIT_UP(u));
      // (Crouched as deep as the legs go and the feet still under the floor: the hips rise sooner.)
      let Hy = hipY(u);
      h = lower(th, Hy);
      Hy -= Math.max(0, origin(th, Hy, h)[1] - above(th));
      o = origin(th, Hy, h);
    } else {
      th = 0;
      h = hA * (1 - STAND((t - A) / (end - A)));
      o = seat;
    }
    keys.rotation.push({ t, v: th, ease: "linear" });
    keys.x.push({ t, v: o[0], ease: "linear" });
    keys.y.push({ t, v: o[1], ease: "linear" });
    keys.hipsY.push({ t, v: r3(h), ease: "linear" });
  }
  keys.hipsY.push({ t: end + 1e-3, v: 0, ease: "step" });
  keys.seated = A;
  return keys;
}
