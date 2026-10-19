/**
 * Building blocks for storybook cartoon characters (profile view, facing right, feet at y = 0).
 *
 * Characters built with the kit share bone names — root, ground, hips, body, head, pupils,
 * armF1/armF2/handF (near arm), armB1/armB2/handB (far arm), legF1/legF2/footF and
 * legB1/legB2/footB — so one set of gesture clips (`characterClips`), emotion poses and the
 * director's staging work for every character. Colours use palette tokens; `palette(ink)` is the
 * outline colour.
 */

import { makeTrack, parsePath, pathPoints, pathToString, sampleTrack, withPoints } from "@animestudio/core";

export type P = [number, number];
export type Tracks = Record<string, (number | string)[][]>;
export const r = (n: number) => Math.round(n * 100) / 100;

// ------------------------------------------------------------------ shared pieces

/**
 * Mouth as one closed path (morph-compatible): corners L/R, top and bottom lips. By default the far
 * corner (R) lifts more in a smile (a profile); `symmetric` lifts both alike (a face seen from the
 * front); `lift` scales how high the corners go.
 */
export interface MouthStyle { symmetric?: boolean; lift?: number }
export function mouthPath(L: P, R: P, open: number, smile: number, round: number, o: MouthStyle = {}): string {
  const w = R[0] - L[0];
  const k = o.lift ?? 1;
  const l: P = [L[0] + w * round * 0.22, L[1] - smile * (o.symmetric ? 5 : 4) * k];
  const rr: P = [R[0] - w * round * 0.22, R[1] - smile * (o.symmetric ? 5 : 6) * k];
  const mx = (l[0] + rr[0]) / 2;
  const topY = (l[1] + rr[1]) / 2 + smile * 3 * k - open * 0.15;
  const botY = (l[1] + rr[1]) / 2 + smile * 4 * k + open;
  return `M${r(l[0])} ${r(l[1])} Q${r(mx)} ${r(topY)} ${r(rr[0])} ${r(rr[1])} Q${r(mx)} ${r(botY + open * 0.4)} ${r(l[0])} ${r(l[1])} Z`;
}

/** Viseme mouths + expression shapes for a mouth with corners L/R. */
export function mouthShapes(L: P, R: P, scale = 1, style: MouthStyle = {}) {
  const m = (o: number, s: number, rd: number) => mouthPath(L, R, o * scale, s, rd, style);
  return {
    base: m(1.5, 0.7, 0),
    shapes: {
      A: m(0.8, 0.4, 0.05),
      B: m(6, 0.6, 0.05),
      C: m(12, 0.5, 0.1),
      D: m(18, 0.4, 0),
      E: m(13, 0.2, 0.45),
      F: m(7, 0, 0.75),
      G: m(4, 0.5, 0.1),
      H: m(10, 0.4, 0.15),
      smile: m(4, 2.2, 0),
      frown: m(1.5, -1.4, 0.1),
      grin: m(14, 2.4, 0),
    },
  };
}

/** A round storybook eye (white + outline). */
export const eyeWhite = (c: P, rad: number, extra = "") =>
  `<circle cx="${c[0]}" cy="${c[1]}" r="${rad}" fill="#fff" stroke="palette(ink)" stroke-width="3"/>${extra}`;
export const eyeArc = (c: P, rad: number, up: boolean) =>
  `<path d="M${c[0] - rad} ${c[1]} Q${c[0]} ${c[1] + (up ? -rad * 1.1 : rad * 0.9)} ${c[0] + rad} ${c[1]}" fill="none" stroke="palette(ink)" stroke-width="3.6" stroke-linecap="round"/>`;
/** Eye with the top covered by a lid of the skin colour (half-closed / sleepy). */
export const eyeLid = (c: P, rad: number, k: number, skin: string, id: string) => {
  const y = c[1] - rad + 2 * rad * k;
  return (
    `<clipPath id="${id}"><circle cx="${c[0]}" cy="${c[1]}" r="${rad}"/></clipPath>` +
    `<rect x="${c[0] - rad - 2}" y="${c[1] - rad - 2}" width="${rad * 2 + 4}" height="${r(y - c[1] + rad + 2)}" fill="${skin}" clip-path="url(#${id})"/>` +
    `<path d="M${c[0] - rad + 1} ${r(y)} H${c[0] + rad - 1}" stroke="palette(ink)" stroke-width="3" stroke-linecap="round"/>` +
    `<circle cx="${c[0]}" cy="${c[1]}" r="${rad}" fill="none" stroke="palette(ink)" stroke-width="3"/>`
  );
};

export interface EyeSpec {
  eyes: [P, P];
  rad: number;
  skin: string;
  /** Pupil radius. */
  pupil: number;
  /** Always draw a resting lid at this height (0..1), e.g. sleepy or elderly characters. */
  restLid?: number;
}

export function eyeArt(e: EyeSpec) {
  const both = (fn: (c: P, i: number) => string) => e.eyes.map(fn).join("");
  const rest = (c: P, i: number) => (e.restLid ? eyeLid(c, e.rad, e.restLid, e.skin, `lid${i}`) : "");
  return {
    open: both((c, i) => eyeWhite(c, e.rad)),
    wide: both((c) => eyeWhite(c, e.rad + 2.5)),
    closed: both((c) => eyeArc(c, e.rad * 0.85, false)),
    happy: both((c) => eyeArc(c, e.rad * 0.85, true)),
    half: both((c, i) => eyeWhite(c, e.rad)),
    lids: both(rest),
    halfLids: both((c, i) => eyeLid(c, e.rad, Math.max(0.45, e.restLid ?? 0), e.skin, `hl${i}`)),
    pupils: both(
      (c) =>
        `<circle cx="${r(c[0] + e.rad * 0.3)}" cy="${r(c[1] + 1)}" r="${e.pupil}" fill="palette(ink)"/><circle cx="${r(c[0] + e.rad * 0.3 + e.pupil * 0.35)}" cy="${r(c[1] - e.pupil * 0.4)}" r="${r(Math.max(1.5, e.pupil * 0.3))}" fill="#fff"/>`,
    ),
  };
}

/** Brows as one morph path (two strokes), with raised / sad / cross / smug shapes. */
export function browShapes(eyes: [P, P], rad: number, lift = 10) {
  const brow = (c: P, dy: number, tiltIn: number) => {
    const y = c[1] - rad - lift + dy;
    return `M${r(c[0] - rad * 0.7)} ${r(y + tiltIn)} Q${r(c[0])} ${r(y - 4)} ${r(c[0] + rad * 0.7)} ${r(y - tiltIn)}`;
  };
  const both = (dy: number, tilt: number) => brow(eyes[0], dy, tilt) + " " + brow(eyes[1], dy, tilt);
  return { base: both(0, 0), shapes: { up: both(-8, 0), sad: both(-2, -5), cross: both(3, 5), smug: brow(eyes[0], 2, 2) + " " + brow(eyes[1], -6, -2) } };
}

/** Bones every cast member has (near/far arm and leg chains, feet that stay flat). */
export function limbBones(o: {
  shoulderF: P; elbowF: P; handF: P;
  shoulderB: P; elbowB: P; handB: P;
  hipF: P; kneeF: P; footF: P; toeF: number;
  hipB: P; kneeB: P; footB: P; toeB: number;
}) {
  return [
    { id: "armB1", parent: "body", from: o.shoulderB, to: o.elbowB, mass: 0.5 },
    { id: "armB2", parent: "armB1", from: o.elbowB, to: o.handB, mass: 0.4 },
    { id: "handB", parent: "armB2", from: o.handB },
    { id: "armF1", parent: "body", from: o.shoulderF, to: o.elbowF, mass: 0.5 },
    { id: "armF2", parent: "armF1", from: o.elbowF, to: o.handF, mass: 0.4 },
    { id: "handF", parent: "armF2", from: o.handF },
    { id: "legB1", parent: "hips", from: o.hipB, to: o.kneeB, mass: 0.6 },
    { id: "legB2", parent: "legB1", from: o.kneeB, to: o.footB, mass: 0.5 },
    { id: "footB", parent: "legB2", from: o.footB, to: [o.footB[0] + o.toeB, o.footB[1]], inheritRotation: false },
    { id: "legF1", parent: "hips", from: o.hipF, to: o.kneeF, mass: 0.6 },
    { id: "legF2", parent: "legF1", from: o.kneeF, to: o.footF, mass: 0.5 },
    { id: "footF", parent: "legF2", from: o.footF, to: [o.footF[0] + o.toeF, o.footF[1]], inheritRotation: false },
  ];
}

export const limbIk = [
  // Knees bend forward, in the walking direction (like the rest pose).
  { id: "footF", bones: ["legF1", "legF2"], bend: 1 },
  { id: "footB", bones: ["legB1", "legB2"], bend: 1 },
  // Off by default; `hold_hands` turns them on and aims the hand at the partner's hand.
  { id: "handF", bones: ["armF1", "armF2"], bend: 1, mix: 0 },
  { id: "handB", bones: ["armB1", "armB2"], bend: 1, mix: 0 },
];

// ------------------------------------------------------------------ clips

export interface Gait {
  /** Half step amplitude (px): the foot travels ±a while planted. */
  a: number;
  /** How high the swinging foot rises (px; in a run, the ankle's height at the knee drive before `knee`). */
  lift: number;
  /** One cycle — two steps — in seconds. */
  dur: number;
  /** Up-and-down of the hips (px, half the range). */
  bob: number;
  /** Forward lean of the torso (degrees). */
  lean: number;
  /** Arm swing (degrees). */
  armSwing: number;
  /**
   * Extra knee lift (0..1): the swinging foot rises up to a quarter of the leg higher, ahead of the
   * hips (a march, a sneak). In a run, the knee drive: the thigh driven forward and up before the
   * foot reaches out (1: the thigh about level, a sprint's knee pump).
   */
  knee?: number;
  /** Hips lowered by this fraction of the leg length (0..0.3): knees bent all through the cycle. */
  crouch?: number;
  /** Heels up: the feet planted on the balls of the feet, the foot turned toe down (walk cycle). */
  tiptoe?: boolean;
  /** Side sway of the hips (degrees, `spread`): the hip over the planted foot rises, the torso stays upright. */
  sway?: number;
  /** The head's bob comes this fraction of the cycle late (overlapping action, 0..0.25). */
  headLag?: number;
  /**
   * Arms: `swing` (counter-swing, default), `pump` (bent at the elbow, pumping), `hang` (limp), `up`
   * (flailing overhead), `run` (a runner's arms: elbows near a right angle, each arm against its own
   * leg, the hand from beside the hip behind to in front of the chest — short of the body's middle,
   * never up at the face — the elbow out and the forearm turned in as it comes forward, so the bent
   * elbow shows from the front too; late on the legs by `armLag`, the far arm a little less) or
   * `reach` (panic: both arms flung up and out ahead, each to its own side, elbows low and bent
   * 56–76°, the forearms rising to open hands about shoulder height, fluttering up and down twice a
   * cycle out of step with each other — never overhead, never across the chest, the crotch or the
   * face) or `sneak` (the cartoon sneak's: elbows out, the hands raised in front of the chest ahead
   * of the shoulders, below the chin, the wrists bent down — "tiptoe fingers" — creeping up and down
   * a little each step). `run`, `reach` and `sneak` are designed in 3D (see `flat`), so they read in
   * every view: seen from the front each hand stays on its own side of the body (the panic hands out
   * past the shoulders).
   */
  armStyle?: "swing" | "pump" | "hang" | "up" | "run" | "reach" | "sneak";
  /** How late the `run` and `reach` arms come on the legs (fraction of the cycle, default 0.05: a frame or so). */
  armLag?: number;
  /**
   * The rig is 2D (no `rig3d`): the `run`, `reach` and `sneak` arms are keyed as they look from the side
   * (`rotation` only). On a 2.5D rig (the default) they also get the upper arm's `spread` and the
   * forearm's `turn`, which carry them out of the side plane as designed.
   */
  flat?: boolean;
  /** Torso bent forward (degrees; negative: chest out, leaning back); the head mostly follows. */
  slump?: number;
  /** Feet dragged (0..1): lower lift, the swinging foot trailing low with the toe scuffing (walk cycle). */
  drag?: number;
  /** Two bobs per step (four per cycle): the bouncy cartoon walk (walk cycle). */
  doubleBounce?: boolean;
  /** Leg length (px, hip to ankle) for `crouch`, `knee` and `heel`; default 7 × `a`. */
  leg?: number;
  /** Foot length (px, ankle to toe) for `tiptoe`, the creep's roll and the run's push-off; default 0.9 × `a`. */
  foot?: number;
  /**
   * The run (0..0.6): the fraction of the cycle with both feet off the ground (a run about 0.3, a
   * sprint 0.45). Each foot is then planted for (1 − flight)/2 of the cycle. Setting it, `heel` or
   * `paw` makes the cycle a run's: the hips lowest at mid-stance (the down) and highest in mid-air,
   * both feet lifted between the steps, the swinging foot kicked up behind (`heel`), driven through
   * by the knee (`knee`), reaching past its landing point and pawing back into it (`paw`), the foot
   * landing heel first, flat while planted and rolling onto its ball to push off (`toeOff`).
   */
  flight?: number;
  /** Run: how high the swinging heel kicks up behind, as a fraction of the leg (0..0.85, default 0.4; 0.7: heel to the buttocks). */
  heel?: number;
  /** Run: the swinging foot reaches this fraction of `a` past its landing point, then paws back into it (default 0.15). */
  paw?: number;
  /** Run: how far the foot rolls onto its ball to push off (degrees, default 35): the ankle rises as the heel does, the ball stays put. */
  toeOff?: number;
  /**
   * The creep (a cartoon sneak's cycle; `crouch`, `knee`, `toeOff` shape it): each foot planted for
   * `CREEP_PLANT` of the cycle (both feet down a moment as the weight moves over), set down toe
   * first and rolled flat about the ball, flat, then rolled onto the ball to lift; the swing peels
   * the foot up behind, raises the knee high and holds it there a moment, then reaches out and sets
   * it down ahead. The hips rise as the knee does and settle as the foot lands.
   */
  creep?: boolean;
}

/** Rounds a key time (four decimals: eighths of a short cycle stay exact enough). */
const rt = (t: number) => Math.round(t * 1e4) / 1e4;

/**
 * A smooth loop: `base` at phase `shift` (fraction of the cycle) and `peak` half a period later,
 * `n` periods per cycle — keys at the extremes, wrapped round the loop, plus keys at both ends with
 * the same value (seamless).
 */
function osc(d: number, base: number, peak: number, n: number, shift = 0): (number | string)[][] {
  const mid = (base + peak) / 2;
  const at = (p: number) => r(mid + (base - mid) * Math.cos(2 * Math.PI * n * (p - shift)));
  const keys = new Map<number, number>();
  for (let k = 0; k < 2 * n; k++) {
    const p = (((shift + k / (2 * n)) % 1) + 1) % 1;
    keys.set(rt(p * d), r(k % 2 ? peak : base));
  }
  const ends = keys.get(0) ?? at(0);
  keys.set(0, ends);
  keys.set(rt(d), ends);
  return [...keys].sort((x, y) => x[0] - y[0]).map(([t, v]) => [t, v]);
}

const wrap1 = (p: number) => ((p % 1) + 1) % 1;

/**
 * A loop through values at phases (fractions of the cycle, wrapped round it): keys at those phases
 * plus equal keys at 0 and `d`, the value at the seam taken from the loop's own spline (tangents
 * across the seam, as a looping clip plays it) when no phase falls on it.
 */
function loopKeys(d: number, pts: [number, number][]): (number | string)[][] {
  const ks = new Map<number, number>();
  // (A phase that rounds to the end of the cycle is its start.)
  for (const [p, v] of pts) {
    const t = rt(wrap1(p) * d);
    ks.set(t >= rt(d) ? 0 : t, r(v));
  }
  const sorted = [...ks].sort((x, y) => x[0] - y[0]);
  if (!ks.has(0)) {
    // The spline of the loop starting at its first key; the seam is `d − t0` into it.
    const t0 = sorted[0][0];
    const tr = makeTrack([...sorted.map(([t, v]) => ({ t: t - t0, v })), { t: d, v: sorted[0][1] }], { loop: { duration: d } });
    const v = r(sampleTrack(tr, d - t0) as number);
    sorted.unshift([0, v]);
  }
  sorted.push([rt(d), sorted[0][1]]);
  return sorted.map(([t, v]) => [t, v]);
}

/** Distance the feet travel while planted in a cycle (the `linear` key segments of their x tracks). */
function plantedTravel(...xs: (number | string)[][][]): number {
  let s = 0;
  for (const keys of xs) for (let i = 0; i + 1 < keys.length; i++) if (keys[i + 1][2] === "linear") s += Math.abs((keys[i][1] as number) - (keys[i + 1][1] as number));
  return s;
}

/**
 * Locomotion cycle: feet glide linearly while planted (no sliding), body bobs twice per cycle.
 * In the walk cycle the near foot is planted for the first half (its x from +a to −a), the far foot
 * for the second, and the hips are lowest as a foot lands. With `flight` (or `heel`, `paw`) it is
 * a run's cycle instead: each foot planted for (1 − flight)/2 of it with both feet in the air
 * between the steps, the hips lowest at mid-stance and highest in mid-air, the swinging foot kicked
 * up behind, driven through by the knee and reaching out (see `Gait`). `stride` is the body's travel
 * per cycle — the planted foot's speed × the cycle (2a ÷ the planted fraction; the planted travel
 * itself when a foot is planted half the cycle) — what a `walkTo` and the director match the actor's
 * speed to, so the planted feet stay put. The optional fields make personality walks (a sneak, a
 * strut, a tired shuffle, a march, a scared run) from the same cycle.
 */
export function gait(g: Gait, arms = true): { duration: number; loop: boolean; stride: number; tracks: Tracks } {
  if (g.creep) return creepGait(g, arms);
  if (g.flight !== undefined || g.heel !== undefined || g.paw !== undefined) return runGait(g, arms);
  const d = g.dur;
  const q = d / 4;
  const knee = g.knee ?? 0, drag = g.drag ?? 0, slump = g.slump ?? 0, lag = g.headLag ?? 0;
  const n = g.doubleBounce ? 4 : 2;
  // Bobs: the original quarter keys, or `osc` (doubled, or delayed).
  const wav = (base: number, peak: number, shift = 0) =>
    n === 2 && !shift ? [[0, base], [q, peak], [2 * q, base], [3 * q, peak], [d, base]] : osc(d, base, peak, n, shift);
  // On tiptoe the foot turns toe down about the ball of the foot (0.7 of its length): the ankle
  // rises and comes forward by a constant amount, so a planted foot still does not slide.
  const toe = g.tiptoe ? 40 : 0;
  const ball = 0.7 * (g.foot ?? g.a * 0.9);
  const h = g.tiptoe ? -r(ball * Math.sin((toe * Math.PI) / 180)) : 0;
  const dx = g.tiptoe ? r(ball * (1 - Math.cos((toe * Math.PI) / 180))) : 0;
  // The swing: higher with `knee` (and the foot ahead at the top), lower and trailing with `drag`.
  const leg = g.leg ?? g.a * 7;
  const lift = (g.lift + knee * 0.25 * leg) * (1 - 0.75 * drag);
  const px = g.a * (0.45 * knee - 0.5 * drag);
  const crouch = (g.crouch ?? 0) * leg;
  const t: Tracks = {
    "ik.footF.x": [[0, g.a + dx], [2 * q, -g.a + dx, "linear"], [3 * q, px + dx], [d, g.a + dx]],
    "ik.footF.y": [[0, h], [2 * q, h, "linear"], [3 * q, h - lift], [d, h]],
    "ik.footB.x": [[0, -g.a + dx], [q, px + dx], [2 * q, g.a + dx], [d, -g.a + dx, "linear"]],
    "ik.footB.y": [[0, h], [q, h - lift], [2 * q, h], [d, h, "linear"]],
    "bones.hips.y": wav(g.bob + crouch, -g.bob + crouch),
    "bones.body.rotation": wav(g.lean + slump, g.lean + slump + 1.5),
    // The head looks ahead through a lean, less so through a slump (it hangs with the torso).
    "bones.head.rotation": wav(-g.lean * 0.6 - slump * 0.35, -g.lean * 0.6 - slump * 0.35 + 2, lag),
  };
  if (toe || drag || knee) {
    // Feet toe down on tiptoe; the toe trails (drag) or points (a high knee) in the swing.
    const sw = r(toe + 18 * drag + 12 * knee);
    t["bones.footF.rotation"] = [[0, toe], [2 * q, toe, "linear"], [3 * q, sw], [d, toe]];
    t["bones.footB.rotation"] = [[0, toe], [q, sw], [2 * q, toe], [d, toe, "linear"]];
  }
  if (g.sway) {
    // The hip over the planted foot rises (`spread`, a roll about the forward axis: seen from the
    // front or three-quarters on a 2.5D rig); the torso rolls back to stay upright.
    const s = g.sway;
    t["bones.hips.spread"] = [[0, 0], [q, s], [2 * q, 0], [3 * q, -s], [d, 0]];
    t["bones.body.spread"] = [[0, 0], [q, -s], [2 * q, 0], [3 * q, s], [d, 0]];
  }
  if (arms) Object.assign(t, gaitArms(g, 0.5));
  return { duration: d, loop: true, stride: plantedTravel(t["ik.footF.x"], t["ik.footB.x"]), tracks: t };
}

/**
 * The run's cycle (`gait` with `flight`, `heel` or `paw`). Key poses of the near foot, as phases
 * of the cycle (the far foot is the same half a cycle later): contact at 0 (heel first, the toe up,
 * the foot ahead by `a`), flat at once, planted back to −a at β = (1 − flight)/2 — the last part
 * rolling onto the ball, the ankle rising and coming forward as the heel does so the ball stays put
 * (no toe dug into the ground) — then the swing: trailing up behind in mid-air, the heel at its
 * highest (`heel`), the knee drive under and ahead of the hips (`knee`), the reach past the landing
 * point in the other step's mid-air (`paw`), and pawing back into the contact. The hips are lowest
 * at mid-stance and highest in mid-air, crouched so the planted leg never locks straight.
 */
function runGait(g: Gait, arms: boolean): { duration: number; loop: boolean; stride: number; tracks: Tracks } {
  const d = g.dur, a = g.a;
  const flight = Math.min(0.6, Math.max(0, g.flight ?? 0));
  const beta = (1 - flight) / 2;
  const leg = g.leg ?? a * 7, knee = g.knee ?? 0, slump = g.slump ?? 0, lag = g.headLag ?? 0;
  const heel = Math.min(0.85, Math.max(0, g.heel ?? 0.4)) * leg;
  const paw = g.paw ?? 0.15, toeOff = g.toeOff ?? 35;
  const ball = 0.7 * (g.foot ?? a * 0.9);
  const lift = g.lift + knee * 0.25 * leg;
  const crouch = (g.crouch ?? 0) * leg;
  const strike = Math.min(12, toeOff * 0.3);
  const rad = Math.PI / 180;
  // Phases on the keys' time grid (a key's value is the one at its rounded time).
  const on = (p: number) => rt(p * d) / d;
  // Planted: the flat foot's ankle goes from +a to −a at the ground's speed.
  const ground = (p: number) => a - (2 * a * p) / beta;
  // (`turn`: a key of the foot's turn only — the heel coming down flat.)
  type K = { p: number; x: number; y: number; rot: number; planted?: boolean; turn?: boolean };
  const keys: K[] = [{ p: 0, x: a, y: 0, rot: -strike }];
  const flat = on(Math.min(0.2 * beta, 0.06)), roll = on(0.55 * beta);
  keys.push({ p: flat, x: 0, y: 0, rot: 0, turn: true }, { p: roll, x: ground(roll), y: 0, rot: 0, planted: true });
  for (const u of [1 / 3, 2 / 3, 1]) {
    const p = on(roll + u * (beta - roll)), th = toeOff * u ** 1.5;
    keys.push({ p, x: ground(p) + ball * (1 - Math.cos(th * rad)), y: -ball * Math.sin(th * rad), rot: th, planted: true });
  }
  // The swing, at fractions of the swing time.
  const at = (s: number) => on(beta + s * (1 - beta));
  const trail = { x: -a - (0.12 + 0.25 * (heel / leg)) * leg, y: -0.7 * heel };
  const drive = { x: a * (1.2 * knee - 0.2), y: -lift };
  keys.push(
    { p: at(0.14), x: trail.x, y: trail.y, rot: toeOff + 12 },
    { p: at(0.43), x: trail.x + 0.3 * (drive.x - trail.x), y: -heel, rot: 20 + 60 * (heel / leg) },
    { p: at(0.69), x: drive.x, y: drive.y, rot: -4 },
    { p: at(0.86), x: a * (1 + paw), y: -0.55 * lift, rot: -strike },
    { p: 1, x: a, y: 0, rot: -strike },
  );
  // Tracks of the near foot; the far foot's are the same shifted by half a cycle, so both need a
  // key at the half (the far foot's seam): taken from the near foot's own spline.
  const near = (f: (k: K) => number, pose: boolean) =>
    keys.filter((k) => pose || !k.turn).map((k) => (!pose && k.planted ? [k.p, r(f(k)), "linear"] : [k.p, r(f(k))]));
  const half = (ks: (number | string)[][]) => {
    const mid = on(0.5);
    if (ks.some((k) => Math.abs((k[0] as number) - mid) < 1e-9)) return ks;
    const tr = makeTrack(ks.map((k) => ({ t: k[0] as number, v: k[1] as number, ease: k[2] as never })), { loop: { duration: 1 } });
    return [...ks, [mid, r(sampleTrack(tr, mid) as number)]].sort((x, y) => (x[0] as number) - (y[0] as number));
  };
  const xs = half(near((k) => k.x, false)), ys = half(near((k) => k.y, true)), rots = half(near((k) => k.rot, true));
  const timed = (ks: (number | string)[][], shift: number) => {
    const out = ks.filter((k) => (k[0] as number) < 1 - 1e-9).map((k) => {
      const p = wrap1((k[0] as number) + shift);
      return k.length > 2 ? [p, k[1], k[2]] : [p, k[1]];
    });
    out.sort((x, y) => (x[0] as number) - (y[0] as number));
    out.push([1, out[0][1]]);
    return out.map((k) => [rt((k[0] as number) * d), ...k.slice(1)]);
  };
  const t: Tracks = {
    "ik.footF.x": timed(xs, 0),
    "ik.footF.y": timed(ys, 0),
    "ik.footB.x": timed(xs, 0.5),
    "ik.footB.y": timed(ys, 0.5),
    "bones.footF.rotation": timed(rots, 0),
    "bones.footB.rotation": timed(rots, 0.5),
    // Lowest at mid-stance (the down), highest in mid-air.
    "bones.hips.y": osc(d, crouch + g.bob, crouch - g.bob, 2, beta / 2),
    // Leaning in a little more in the down; the head counter-turned to keep the eyes on the way ahead.
    "bones.body.rotation": osc(d, g.lean + slump + 2, g.lean + slump - 1, 2, beta / 2),
    "bones.head.rotation": osc(d, -0.85 * (g.lean + 2) - 0.35 * slump, -0.85 * (g.lean - 1) - 0.35 * slump, 2, beta / 2 + lag),
  };
  if (g.sway) {
    t["bones.hips.spread"] = osc(d, g.sway, -g.sway, 1, beta / 2);
    t["bones.body.spread"] = osc(d, -g.sway, g.sway, 1, beta / 2);
  }
  if (arms) Object.assign(t, gaitArms(g, beta));
  // The body's travel a cycle: the planted foot's speed (its flat stretch, as keyed) × the cycle —
  // 2a ÷ the planted fraction, to the keys' rounding.
  const [k0, k1] = t["ik.footF.x"] as number[][];
  return { duration: d, loop: true, stride: ((k0[1] - k1[1]) / k1[0]) * d, tracks: t };
}

/** The part of the creep's cycle each foot is planted (over half: both feet down as the weight moves over). */
const CREEP_PLANT = 0.55;

/**
 * The creep (`gait` with `creep`): a cartoon sneak, after the animators' key poses. Key poses of the
 * near foot, as phases of the cycle (the far foot the same half a cycle later): contact at 0, ahead
 * by `a`, toe first (turned 18° toe down, on the ball); rolled flat about the ball by 0.06 (the ball
 * stays put: the ankle comes down and back as the heel does); flat to 0.46; rolled onto the ball to
 * lift by `CREEP_PLANT` (`toeOff`, default 35°). The swing: the foot peeled up behind, toe down; the
 * knee raised high (`knee`: the ankle `lift` + up to a quarter of the leg up) just ahead of the
 * hips and held there (two keys close in value: an ease at the top of the step); the foot reaching
 * out ahead, toe down, and set down. The hips (crouched) lowest as the weight comes over the front
 * foot and highest as the knee comes up; the torso leaning in more at the low point, the head
 * counter-turned to keep the eyes ahead. Flat-footed the planted ankle glides linearly (`linear`
 * keys) at the body's speed — 2a ÷ (`CREEP_PLANT` × the cycle) — which `stride` is.
 */
function creepGait(g: Gait, arms: boolean): { duration: number; loop: boolean; stride: number; tracks: Tracks } {
  const d = g.dur, a = g.a, beta = CREEP_PLANT;
  const leg = g.leg ?? a * 7, knee = g.knee ?? 0, slump = g.slump ?? 0, lag = g.headLag ?? 0;
  const ball = 0.7 * (g.foot ?? a * 0.9), toeOff = g.toeOff ?? 35, contact = 18;
  const lift = g.lift + knee * 0.25 * leg, crouch = (g.crouch ?? 0) * leg;
  const rad = Math.PI / 180;
  const on = (p: number) => rt(p * d) / d;
  const ground = (p: number) => a - (2 * a * p) / beta;
  // The ankle of a foot turned `th` toe down about its ball, the ball on the flat foot's.
  const tip = (x: number, th: number) => ({ x: x + ball * (1 - Math.cos(th * rad)), y: -ball * Math.sin(th * rad), rot: th });
  // (`lin`: the x key ends a stretch planted flat or rolling onto the ball — linear, the body's speed.)
  type K = { p: number; x: number; y: number; rot: number; lin?: boolean };
  const flat = on(0.06), lift0 = on(0.46);
  const keys: K[] = [{ p: 0, ...tip(a, contact) }];
  // Toe first, rolled flat (eased onto the heel; the ankle's spline through these keys, sub-pixel).
  for (const u of [1 / 3, 2 / 3]) {
    const p = on(u * flat);
    keys.push({ p, ...tip(ground(p), contact * (1 - u) ** 1.5) });
  }
  keys.push({ p: flat, ...tip(ground(flat), 0) }, { p: lift0, ...tip(ground(lift0), 0), lin: true });
  // (One key at half the cycle: the far foot's seam.)
  for (const u of [(0.5 - lift0) / (beta - lift0), 0.75, 1]) {
    const p = on(lift0 + u * (beta - lift0));
    keys.push({ p, ...tip(ground(p), toeOff * u ** 1.5), lin: true });
  }
  // The swing, at fractions of the swing time.
  const at = (s: number) => on(beta + s * (1 - beta));
  const reach = tip(a * 1.08, contact + 6);
  keys.push(
    { p: at(0.2), x: -a * 0.85, y: -0.4 * lift, rot: toeOff + 20 },
    { p: at(0.45), x: a * 0.15, y: -lift, rot: 34 },
    { p: at(0.65), x: a * 0.5, y: -0.96 * lift, rot: 32 },
    { p: at(0.86), x: reach.x, y: reach.y - 0.28 * lift, rot: reach.rot },
    { p: 1, ...tip(a, contact) },
  );
  // A foot's track, `shift` of the cycle on. The far foot's starts rolling onto its ball: that first
  // stretch is eased (not `linear`), so each foot's first linear stretch is the flat one (its speed
  // is the body's); the stretch into the seam stays linear.
  const track = (f: (k: K) => number, shift: number, flags: boolean) => {
    const out = keys.filter((k) => k.p < 1 - 1e-9).map((k) => [rt(wrap1(k.p + shift) * d), r(f(k)), flags && !!k.lin] as [number, number, boolean]);
    out.sort((x, y) => x[0] - y[0]);
    const end: [number, number, boolean] = [rt(d), out[0][1], out[0][2]];
    out[0][2] = false;
    for (let i = 1; i < out.length && out[i][2]; i++) out[i][2] = false;
    return [...out, end].map(([tt, v, lin]) => (lin ? [tt, v, "linear"] : [tt, v]));
  };
  const t: Tracks = {
    "ik.footF.x": track((k) => k.x, 0, true),
    "ik.footF.y": track((k) => k.y, 0, false),
    "ik.footB.x": track((k) => k.x, 0.5, true),
    "ik.footB.y": track((k) => k.y, 0.5, false),
    "bones.footF.rotation": track((k) => k.rot, 0, false),
    "bones.footB.rotation": track((k) => k.rot, 0.5, false),
    // Lowest as the weight comes over the front foot, highest as the knee comes up.
    "bones.hips.y": osc(d, crouch + g.bob, crouch - g.bob, 2, 0.06),
    "bones.body.rotation": osc(d, g.lean + slump + 2, g.lean + slump - 1, 2, 0.06),
    "bones.head.rotation": osc(d, -0.8 * (g.lean + 2) - 0.35 * slump, -0.8 * (g.lean - 1) - 0.35 * slump, 2, 0.06 + lag),
  };
  if (arms) Object.assign(t, gaitArms(g, beta));
  // The body's travel a cycle: the flat foot's speed × the cycle.
  const xs = t["ik.footF.x"] as number[][], i = xs.findIndex((k) => (k[2] as unknown) === "linear");
  return { duration: d, loop: true, stride: ((xs[i - 1][1] - xs[i][1]) / (xs[i][0] - xs[i - 1][0])) * d, tracks: t };
}

type V3 = [number, number, number];
const wrapDeg = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
/** An arm's pose: its upper bone's and its lower bone's directions (see `armAim`). */
type ArmPose = [V3, V3];

/**
 * The channel values (degrees) pointing an arm's upper bone along `u` and its lower bone along `f`:
 * `[upper rotation, upper spread, lower rotation, lower turn]`. Directions are in the torso's frame,
 * x away from the body's middle, y down, z forward; the bones hang along +y at rest. A 2.5D rig
 * composes a bone as turn · spread · rotation (about the vertical, forward and sideways axes), so:
 * the upper bone's rotation swings it forward or back (within ±90°: the one solution continuous
 * through every pose but straight ahead or behind, so the keys' in-betweens never swing the arm
 * through the front of the body) and its spread raises it out to the side; the lower bone's
 * rotation bends the elbow by the angle between the bones and its turn, about the upper arm's own
 * axis, carries the forearm out of the upper arm's swing plane (a hand brought in front of the
 * chest). `far`: the arm on the +x side (the spread and turn mirrored). `flat`: a 2D rig, which has
 * the rotations only — the arm as seen from the side (no spread or turn).
 */
function armAim(u: V3, f: V3, far: boolean, flat: boolean): [number, number, number, number] {
  const D = 180 / Math.PI, m = far ? 1 : -1;
  if (flat) {
    const su = Math.atan2(-u[2], u[1]), sf = Math.atan2(-f[2], f[1]);
    return [r(su * D), 0, r(wrapDeg((sf - su) * D)), 0];
  }
  // Engine axes: the near arm's outside is −x.
  const [ux, uy, uz] = [m * u[0], u[1], u[2]], [fx, fy, fz] = [m * f[0], f[1], f[2]];
  // Upper: (−sin s · cos r, cos s · cos r, −sin r) = u.
  const r1 = Math.asin(Math.max(-1, Math.min(1, -uz)));
  const c = Math.cos(r1), s1 = Math.abs(c) < 1e-9 ? 0 : Math.atan2(-ux / c, uy / c);
  // Lower, in the upper bone's frame (Rᵀ f, R = rz(s1) · rx(r1)): (−sin r2 · sin t2, cos r2, −sin r2 · cos t2).
  const cs = Math.cos(s1), ss = Math.sin(s1), cr = Math.cos(r1), sr = Math.sin(r1);
  const a = cs * fx + ss * fy, b = -ss * fx + cs * fy;
  const lx = a, ly = cr * b - sr * fz, lz = sr * b + cr * fz;
  const r2 = -Math.acos(Math.max(-1, Math.min(1, ly)));
  const t2 = Math.abs(Math.sin(r2)) < 1e-6 ? 0 : Math.atan2(lx, lz);
  return [r(r1 * D), r(s1 * D), r(r2 * D), r(t2 * D)];
}

/**
 * A direction in the torso's frame (see `armAim`) from its angle as seen from the side (degrees:
 * 0 hanging, negative forward, −90 straight ahead) tilted `out` degrees away from the body's middle.
 */
function sideDir(side: number, out: number): V3 {
  const a = (side * Math.PI) / 180, o = (out * Math.PI) / 180;
  return [Math.sin(o), Math.cos(o) * Math.cos(a), -Math.cos(o) * Math.sin(a)];
}

/** The sneak's arms (degrees; see `gaitArms`): upper arm forward of hanging and out, elbow bend, forearm in, wrist bent. */
const SNEAK_ARM = { fwd: 40, out: 22, elbow: 100, in: -30, wrist: -70 };

/** Keys of the `run` and `reach` arms: eight poses a cycle, solved from the design (see `gaitArms`). */
const ARM_KEYS = 8;

/**
 * The arms of a gait whose feet are each planted for `beta` of the cycle (0.5: a walk). The
 * walk-made styles (`swing`, `pump`, `hang`, `up`) keep their quarter-cycle keys. `run` and `reach`
 * are designed in 3D as the directions of the upper arm and the forearm through the cycle — smooth
 * pendulums of the arm's phase — and keyed at `ARM_KEYS` phases of it, each solved to the rig's
 * channels (`armAim`): the keys' in-betweens then stay on the designed path (four poses keyed per
 * channel drift off it: a hand swinging in across the body between them). The near arm reaches its
 * forward extreme in mid-air after the near foot pushed off (against its own leg), `armLag` late;
 * the far arm half a cycle on and a little later, a little less (uneven, never mirrored).
 */
function gaitArms(g: Gait, beta: number): Tracks {
  const d = g.dur, q = d / 4, s = g.armSwing, slump = g.slump ?? 0;
  const style = g.armStyle ?? "swing";
  const t: Tracks = {};
  if (style === "swing") {
    t["bones.armF1.rotation"] = [[0, s], [2 * q, -s], [d, s]];
    t["bones.armF2.rotation"] = [[0, -6], [2 * q, -s * 0.8], [d, -6]];
    t["bones.armB1.rotation"] = [[0, -s], [2 * q, s], [d, -s]];
    t["bones.armB2.rotation"] = [[0, -s * 0.8], [2 * q, -6], [d, -s * 0.8]];
  } else if (style === "pump") {
    // Elbows bent near a right angle, the arms driven forward and back (fists).
    t["bones.armF1.rotation"] = [[0, r(s * 0.9)], [2 * q, r(-s * 1.1)], [d, r(s * 0.9)]];
    t["bones.armF2.rotation"] = [[0, -75], [2 * q, -105], [d, -75]];
    t["bones.armB1.rotation"] = [[0, r(-s * 1.1)], [2 * q, r(s * 0.9)], [d, r(-s * 1.1)]];
    t["bones.armB2.rotation"] = [[0, -105], [2 * q, -75], [d, -105]];
  } else if (style === "hang") {
    // Limp: hanging plumb whatever the torso does, a small swing dragged behind the legs.
    const plumb = -(g.lean + slump) * 0.9;
    t["bones.armF1.rotation"] = osc(d, r(plumb + s), r(plumb - s), 1, 0.12);
    t["bones.armF2.rotation"] = osc(d, -3, -10, 1, 0.2);
    t["bones.armB1.rotation"] = osc(d, r(plumb - s), r(plumb + s), 1, 0.12);
    t["bones.armB2.rotation"] = osc(d, -10, -3, 1, 0.2);
  } else if (style === "up") {
    // Up: both arms flailing overhead in turn (nearly straight, clear of the face).
    const f = r(Math.min(28, s * 0.5));
    t["bones.armF1.rotation"] = [[0, -168 + f], [2 * q, -168 - f], [d, -168 + f]];
    t["bones.armF2.rotation"] = [[0, -12], [2 * q, 12], [d, -12]];
    t["bones.armB1.rotation"] = [[0, 168 - f], [2 * q, 168 + f], [d, 168 - f]];
    t["bones.armB2.rotation"] = [[0, 12], [2 * q, -12], [d, 12]];
  } else {
    const lag = g.armLag ?? 0.05;
    const pf = (beta + 0.5) / 2 + lag;
    const cos = (w: number) => Math.cos(2 * Math.PI * w);
    const sin = (w: number) => Math.sin(2 * Math.PI * w);
    // One arm's pose at `w`, the phase of its own cycle (0: its forward extreme).
    let pose: (w: number, k: number, far: boolean) => ArmPose;
    let farShift: number;
    if (style === "run") {
      // A runner's arms. The upper arm swings s forward and 0.9 s back, its elbow out (more as it
      // comes forward); the elbow near a right angle, closing as the arm comes forward (the hand
      // goes round an oval); the forearm turned in at the front — the hand in front of the chest,
      // short of its middle, the bent elbow showing from the front (not a straight arm bowed out)
      // — and a little out at the back, the hand beside the hip (never over the crotch).
      pose = (w, k) => {
        const c = cos(w), side = -s * k * (0.05 + 0.95 * c), elbow = 83 + 8 * c - 11.5 * sin(w);
        return [sideDir(side, 17 + 7 * c), sideDir(side - elbow, -12 - 20 * c)];
      };
      farShift = 0.5 + lag * 0.8;
    } else if (style === "sneak") {
      // The sneak's hands, raised in front of the chest: each upper arm ~SNEAK_ARM.out° out to its
      // own side (the elbows up and out) and forward of hanging in the picture (the torso's lean
      // added back), the elbow bent sharply, the forearm rising forward and in to the hand at about
      // chest height, ahead of the shoulder — short of the body's middle, below the chin — the
      // wrist bent down (the "tiptoe fingers"). The hands creep up and down a little twice a cycle
      // (a step's beat), the far one a quarter of a cycle (half a step) apart, a little lower.
      const lean = g.lean + slump;
      pose = (w, k, far) => {
        const c2 = cos(2 * w), up = SNEAK_ARM.fwd - (far ? 4 : 0) + k * s * 0.5 * c2, elbow = SNEAK_ARM.elbow - k * 4 * c2;
        return [sideDir(-lean - up, SNEAK_ARM.out), sideDir(-lean - up - elbow, SNEAK_ARM.in)];
      };
      farShift = 0.25 + lag * 0.8;
    } else {
      // Panic, flung up and out ahead: each upper arm out to its own side ~46° from straight ahead
      // and ~35° forward of hanging in the picture (the torso's lean added back), the elbow low and
      // bent 56–76°, the forearm about level or rising to an open hand about shoulder height — below
      // the chin, so from no side is a hand drawn over the head (a hand up beside the head would
      // be, seen straight along the arm from some angle). From the front and the back both arms
      // open out on their own sides, elbows bent (a W); from three-quarters the near hand is out
      // beside the shoulder, outside the chest, the far one out ahead; from the side both reach
      // ahead, hands up. A forearm never lies across the chest, the crotch or the face. They
      // flutter up and down twice a cycle (a step's beat), the elbow opening a little late as the
      // arm rises, and pump a little with the legs once a cycle; the far arm a quarter of a cycle
      // (half a step) apart, lower and a little less.
      const lean = g.lean + slump;
      pose = (w, k, far) => {
        const c1 = cos(w), f2 = cos(2 * w), up = 34 - (far ? 5 : 0) + k * (8 * f2 + 4 * c1), elbow = 66 - 10 * cos(2 * (w - 0.04));
        // (A torso leaning in carries its hanging arm back: the picture's angle plus the lean.)
        return [sideDir(-lean - up, 46 + 4 * c1), sideDir(-lean - up - elbow, 52 + 4 * c1)];
      };
      farShift = 0.25 + lag * 0.8;
    }
    const keysOf = (sh: number, k: number, far: boolean) => {
      const aim = Array.from({ length: ARM_KEYS }, (_, i) => armAim(...pose(i / ARM_KEYS, k, far), far, !!g.flat));
      return [0, 1, 2, 3].map((j) => loopKeys(d, aim.map((v, i) => [sh + i / ARM_KEYS, v[j]] as [number, number])));
    };
    for (const [side, keys] of [["F", keysOf(pf, 1, false)], ["B", keysOf(pf + farShift, 0.9, true)]] as const) {
      t[`bones.arm${side}1.rotation`] = keys[0];
      t[`bones.arm${side}2.rotation`] = keys[2];
      if (g.flat) continue;
      t[`bones.arm${side}1.spread`] = keys[1];
      t[`bones.arm${side}2.turn`] = keys[3];
    }
    // The sneak's wrists bent down (its fingers hanging from the raised hands).
    if (style === "sneak") for (const side of ["F", "B"]) t[`bones.hand${side}.rotation`] = osc(d, SNEAK_ARM.wrist, SNEAK_ARM.wrist - 8, 2, pf);
  }
  return t;
}

export interface ClipOptions {
  walk: Gait;
  run: Gait;
  /** The far hand is busy (e.g. holding a walking stick): gestures leave it alone. */
  busyFarHand?: boolean;
  /** Scale of gesture energy (< 1 for calmer characters). */
  energy?: number;
  jump: number;
  /** How far the forearm swings up in gestures (< 1 keeps a held object away from the face). */
  forearmLift?: number;
  /**
   * The hands are switch parts `handF` / `handB` with the variants of `handShapes` (open, fist,
   * point, grip): gestures then shape them (a fist to punch, a finger to point).
   */
  hands?: boolean;
  /** Leg length (px, hip to ankle): how low the personality walks crouch. Default 7 × `walk.a`. */
  leg?: number;
  /** Foot length (px, ankle to toe): how high a tiptoe lifts the ankle, where a foot rolls onto its ball. Default 0.9 × `walk.a`. */
  foot?: number;
  /** The legs are in a skirt (`short`: to the knees; `long`: to the ankles): the runs are cut to it (`skirtRun`). */
  skirt?: "short" | "long";
}

/**
 * A run cut to a skirt. A skirt is one cloth spanning the legs (at the thighs, the knees and, long,
 * the hem): a run's knee drive, heel kick and long flight would stretch it into a sack between them.
 * To the knees, the shins are free (the heel still kicks up behind) but the thighs part less: half
 * the knee drive, shorter steps, a little less flight. To the ankles, a shuffle: short steps under
 * the body, the shins near plumb (a small heel kick, no knee drive), a short hop of flight, a smaller
 * bob. Not a run (no `flight`, `heel` or `paw`): unchanged.
 */
export function skirtRun(g: Gait, skirt: "short" | "long" | undefined): Gait {
  if (!skirt || (g.flight === undefined && g.heel === undefined && g.paw === undefined)) return g;
  const heel = g.heel ?? 0.4, knee = g.knee ?? 0, flight = g.flight ?? 0;
  if (skirt === "short") return { ...g, a: r(g.a * 0.85), flight: r(flight * 0.75), heel: Math.min(heel, 0.5), knee: r(knee * 0.5), crouch: Math.min(g.crouch ?? 0, 0.1) };
  return {
    ...g, a: r(g.a * 0.55), lift: r(g.lift * 0.5), bob: r(g.bob * 0.6), flight: Math.min(flight, 0.14), heel: Math.min(heel, 0.16), knee: 0,
    paw: Math.min(g.paw ?? 0.15, 0.08), crouch: Math.min(g.crouch ?? 0, 0.05),
  };
}

/**
 * Personality walks built from a character's walk and run (looping, with their own `stride`, so the
 * director's stride matching keeps the feet planted): `sneak` (a classic cartoon creep, `creep`:
 * crouched and leaning in, big slow steps set down toe first and rolled flat, the knee held high at
 * the top of each step, the hands raised in front of the chest with the wrists bent: `sneak` arms), `strut` (chest out, hips swaying, bouncing twice a step, fists pumping), `tired` (slumped,
 * feet dragging, arms hanging), `march` (knees high, upright, fists pumping) and `scaredRun` (a panic
 * sprint: its own run cycle, not the run's — leaning hard in, crouched deep, the heels kicked high
 * behind and the knees pumping, long flights at a faster cadence (never under 0.3 s a cycle:
 * nine frames at 30 fps), the arms flung up and out ahead with bent elbows and open hands, fluttering out
 * of step: `reach`). With `skirt`, cut to it (`skirtRun`).
 */
export function personalityGaits(walk: Gait, run: Gait, o: { leg?: number; foot?: number; skirt?: "short" | "long" } = {}): Record<"sneak" | "strut" | "tired" | "march" | "scaredRun", Gait> {
  const leg = o.leg ?? walk.a * 7, foot = o.foot ?? walk.a * 0.9;
  const w = (k: number, dur: number, extra: Partial<Gait>): Gait => ({ ...walk, a: r(walk.a * k), dur, leg, foot, ...extra });
  return {
    // (In a long skirt — one cloth to the ankles — shorter steps, half the knee lift, a shallower crouch.)
    sneak: w(o.skirt === "long" ? 1.2 : 1.9, 2, {
      lift: r(walk.lift * 0.8), bob: r(walk.bob * 0.6), lean: walk.lean + 26, armSwing: r(walk.armSwing * 0.25), crouch: o.skirt === "long" ? 0.1 : 0.18, knee: o.skirt === "long" ? 0.5 : 1,
      creep: true, armStyle: "sneak", headLag: 0.08, ...(run.flat ? { flat: true } : {}),
    }),
    strut: w(1.1, 0.6, { bob: r(walk.bob * 0.8), armSwing: r(walk.armSwing * 1.2), slump: -4, sway: 6, armStyle: "pump", doubleBounce: true, headLag: 0.12 }),
    tired: w(0.8, 0.95, { bob: 1, armSwing: r(walk.armSwing * 0.4), slump: 12, drag: 0.7, armStyle: "hang", headLag: 0.2 }),
    march: w(1, 0.5, { lean: 0, armSwing: r(walk.armSwing * 1.6), knee: 1, sway: 0, armStyle: "pump" }),
    scaredRun: skirtRun({
      ...run, a: r(run.a * 1.3), dur: Math.max(0.3, r(run.dur * 0.68)), bob: r(run.bob * 1.5), lean: 24, crouch: 0.12, leg, foot,
      flight: 0.44, heel: 0.62, knee: 1, paw: 0.2, toeOff: 40, armStyle: "reach", headLag: 0.1,
    }, o.skirt),
  };
}

/**
 * Hand shapes drawn in setup space around the wrist position `at`: `open`, `fist`, `point` (index
 * finger out) and `grip` (curled around something), as switch variants for a `handF` / `handB`
 * part. The fingers follow the forearm (`dir`, degrees in setup space: 90 = down, a hanging arm),
 * so a pointing finger points wherever the arm points. `r` is the palm radius, `fill` its colour.
 */
export function handShapes(at: P, o: { r: number; fill: string; ink?: string; stroke?: number; dir?: number }) {
  const [x, y] = at, R = o.r, ink = o.ink ?? "palette(ink)", w = o.stroke ?? 4;
  const st = `stroke="${ink}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
  const palm = `<circle cx="${x}" cy="${y}" r="${R}" fill="${o.fill}" ${st}/>`;
  const finger = (dx: number, dy: number, len: number, ang: number) => {
    const a = (ang * Math.PI) / 180;
    return `<path d="M${r(x + dx)} ${r(y + dy)} l${r(Math.cos(a) * len)} ${r(Math.sin(a) * len)}" stroke="${ink}" stroke-width="${r(R * 0.62 + w)}" stroke-linecap="round"/>` +
      `<path d="M${r(x + dx)} ${r(y + dy)} l${r(Math.cos(a) * len)} ${r(Math.sin(a) * len)}" stroke="${o.fill}" stroke-width="${r(R * 0.62 - w * 0.4)}" stroke-linecap="round"/>`;
  };
  const knuckles = `<path d="M${r(x + R * 0.2)} ${r(y - R * 0.55)} v${r(R * 1.1)} M${r(x + R * 0.55)} ${r(y - R * 0.45)} v${r(R * 0.9)}" fill="none" stroke="${ink}" stroke-width="${r(w * 0.6)}"/>`;
  const turn = (art: string) => `<g transform="rotate(${o.dir ?? 90} ${x} ${y})">${art}</g>`;
  return {
    open: turn(finger(R * 0.3, -R * 0.5, R * 1.2, -25) + finger(R * 0.5, 0, R * 1.3, 0) + finger(R * 0.3, R * 0.5, R * 1.1, 25) + finger(-R * 0.3, -R * 0.6, R * 0.9, -80) + palm),
    fist: turn(`<rect x="${r(x - R * 0.9)}" y="${r(y - R * 0.95)}" width="${r(R * 1.9)}" height="${r(R * 1.9)}" rx="${r(R * 0.7)}" fill="${o.fill}" ${st}/>` + knuckles),
    point: turn(finger(R * 0.4, -R * 0.35, R * 1.5, -8) + `<rect x="${r(x - R * 0.9)}" y="${r(y - R * 0.8)}" width="${r(R * 1.8)}" height="${r(R * 1.7)}" rx="${r(R * 0.7)}" fill="${o.fill}" ${st}/>`),
    grip: turn(palm + `<path d="M${r(x + R * 0.2)} ${r(y - R)} q${r(R * 1.2)} ${r(R * 0.2)} ${r(R * 0.6)} ${r(R * 1.6)}" fill="none" ${st}/>`),
  };
}

export function characterClips(o: ClipOptions) {
  const e = o.energy ?? 1;
  const k = (v: number) => r(v * e);
  const B = !o.busyFarHand; // far arm free?
  const fl = (v: number) => r(v * (o.forearmLift ?? 1));
  const farArm = (t: Tracks) => (B ? t : {});
  // Hand shapes over a clip (only for characters with switch hands).
  const hand = (v: string, dur: number, both = false): Tracks =>
    o.hands ? { "parts.handF.variant": [[0, v], [dur, v]], ...(both && B ? { "parts.handB.variant": [[0, v], [dur, v]] } : {}) } : {};
  const clips: Record<string, unknown> = {
    // A quick turn (profile ↔ front/back): squeezed for a few frames around the switch, hiding the
    // change of drawing (played centred on the moment the view changes).
    turn: {
      duration: 0.24,
      tracks: { "bones.root.scaleX": [[0, 1], [0.1, 0.62, "easeIn"], [0.14, 0.62], [0.24, 1, "easeOut"]], "bones.root.scaleY": [[0, 1], [0.12, 1.04], [0.24, 1]] },
    },
    idle: {
      duration: 3.2,
      clear: true,
      loop: true,
      tracks: {
        "bones.body.rotation": [[0, 0], [1.6, 1.2], [3.2, 0]],
        "bones.head.rotation": [[0, 0], [1.1, -2.5], [2.2, 1.5], [3.2, 0]],
        "bones.armF1.rotation": [[0, 0], [1.6, -3], [3.2, 0]],
        ...farArm({ "bones.armB1.rotation": [[0, 0], [1.6, 2.5], [3.2, 0]] }),
      },
    },
    // Locomotion is `clear`: its arms are kept off the face in the picture (2.5D rigs) like a pose's.
    walk: { ...gait(o.walk), clear: true },
    // The run: loose fists; the leg and foot lengths for its crouch, heel kick and push-off.
    run: (() => {
      const c = gait(skirtRun({ leg: o.leg, foot: o.foot, ...o.run }, o.skirt));
      return { ...c, clear: true, tracks: { ...c.tracks, ...hand("fist", c.duration, true) } };
    })(),
    // Personality walks (sneak, strut, tired, march, scaredRun) with their hands.
    ...Object.fromEntries(
      Object.entries(personalityGaits(o.walk, o.run, o)).map(([name, g]) => {
        const c = gait(g);
        if (!B) for (const k of Object.keys(c.tracks)) if (/^bones\.(armB|handB)/.test(k)) delete c.tracks[k];
        const shape = name === "strut" || name === "march" ? "fist" : "open";
        return [name, { ...c, clear: true, tracks: { ...c.tracks, ...hand(shape, c.duration, true) } }];
      }),
    ),
    // Talking gesture: the near hand opens out on stressed beats, head nods.
    talk: {
      duration: 1.6,
      clear: true,
      loop: true,
      tracks: {
        "bones.head.rotation": [[0, 0], [0.3, -4], [0.6, 2], [0.95, -3], [1.3, 1], [1.6, 0]],
        "bones.body.rotation": [[0, 0], [0.8, -1.5], [1.6, 0]],
        "bones.armF1.rotation": [[0, k(-18)], [0.4, k(-38)], [0.8, k(-24)], [1.2, k(-42)], [1.6, k(-18)]],
        "bones.armF2.rotation": [[0, fl(-30)], [0.4, fl(-55)], [0.8, fl(-35)], [1.2, fl(-60)], [1.6, fl(-30)]],
      },
    },
    wave: {
      duration: 1.2,
      clear: true,
      loop: true,
      tracks: {
        ...hand("open", 1.2),
        "bones.armF1.rotation": [[0, k(-92)], [0.6, k(-98)], [1.2, k(-92)]],
        "bones.armF2.rotation": [[0, fl(-18)], [0.3, fl(-58)], [0.6, fl(-14)], [0.9, fl(-58)], [1.2, fl(-18)]],
        "bones.armF1.squash": [[0, 0.2], [1.2, 0.2]],
        "bones.armF2.squash": [[0, 0.25], [1.2, 0.25]],
        "bones.head.rotation": [[0, -3], [0.6, -6], [1.2, -3]],
        "bones.body.rotation": [[0, -1], [0.6, -3], [1.2, -1]],
      },
    },
    point: {
      duration: 1,
      clear: true,
      loop: true,
      tracks: {
        ...hand("point", 1),
        "bones.armF1.rotation": [[0, -88], [0.5, -92], [1, -88]],
        "bones.armF2.rotation": [[0, -4], [1, -4]],
        "bones.body.rotation": [[0, 3], [1, 3]],
        "bones.head.rotation": [[0, -2], [1, -2]],
      },
    },
    present: {
      duration: 1.4,
      clear: true,
      loop: true,
      tracks: {
        ...hand("open", 1.4),
        "bones.armF1.rotation": [[0, -70], [0.7, -78], [1.4, -70]],
        "bones.armF2.rotation": [[0, -40], [0.7, -48], [1.4, -40]],
        "bones.head.rotation": [[0, -4], [1.4, -4]],
      },
    },
    clap: {
      duration: 0.5,
      clear: true,
      loop: true,
      tracks: {
        ...hand("open", 0.5, true),
        "bones.armF1.rotation": [[0, -55], [0.25, -62], [0.5, -55]],
        "bones.armF2.rotation": [[0, -70], [0.25, -40, "easeIn"], [0.5, -70]],
        ...farArm({
          "bones.armB1.rotation": [[0, -70], [0.25, -66], [0.5, -70]],
          "bones.armB2.rotation": [[0, -10], [0.25, -48, "easeIn"], [0.5, -10]],
        }),
        "bones.head.rotation": [[0, -4], [0.25, -6], [0.5, -4]],
        "bones.hips.y": [[0, 0], [0.25, 2], [0.5, 0]],
      },
    },
    cheer: {
      duration: 0.8,
      clear: true,
      loop: true,
      tracks: {
        ...hand("fist", 0.8, true),
        "bones.armF1.rotation": [[0, k(-155)], [0.4, k(-165)], [0.8, k(-155)]],
        "bones.armF2.rotation": [[0, -10], [0.4, 10], [0.8, -10]],
        ...farArm({ "bones.armB1.rotation": [[0, k(155)], [0.4, k(165)], [0.8, k(155)]], "bones.armB2.rotation": [[0, 10], [0.4, -10], [0.8, 10]] }),
        "bones.root.y": [[0, 0], [0.12, 0], [0.4, -o.jump * 0.5, "sineOut"], [0.68, 0, "sineIn"], [0.8, 0]],
        "bones.head.rotation": [[0, -8], [0.8, -8]],
      },
    },
    dance: {
      duration: 1.2,
      clear: true,
      loop: true,
      tracks: {
        "bones.body.rotation": [[0, -6], [0.6, 6], [1.2, -6]],
        "bones.head.rotation": [[0, 6], [0.6, -6], [1.2, 6]],
        "bones.hips.y": [[0, 0], [0.3, 5], [0.6, 0], [0.9, 5], [1.2, 0]],
        "bones.armF1.rotation": [[0, k(-120)], [0.6, k(-40)], [1.2, k(-120)]],
        "bones.armF2.rotation": [[0, -30], [0.6, -60], [1.2, -30]],
        ...farArm({ "bones.armB1.rotation": [[0, k(40)], [0.6, k(120)], [1.2, k(40)]], "bones.armB2.rotation": [[0, -60], [0.6, -30], [1.2, -60]] }),
        "ik.footF.y": [[0, 0], [0.3, -10], [0.6, 0], [1.2, 0]],
        "ik.footB.y": [[0, 0], [0.6, 0], [0.9, -10], [1.2, 0]],
      },
    },
    sing: {
      duration: 2,
      clear: true,
      loop: true,
      tracks: {
        "bones.body.rotation": [[0, -3], [1, 3], [2, -3]],
        "bones.head.rotation": [[0, -6], [1, -2], [2, -6]],
        "bones.armF1.rotation": [[0, k(-60)], [1, k(-80)], [2, k(-60)]],
        "bones.armF2.rotation": [[0, -50], [1, -30], [2, -50]],
      },
    },
    // Drinking: the near hand (a glass, a bottle) up to the mouth, the head tips back, a long sip.
    drink: {
      duration: 2.2,
      tracks: {
        "bones.armF1.rotation": [[0, 0], [0.4, -62, "easeOut"], [1.7, -66], [2.2, 0]],
        "bones.armF2.rotation": [[0, 0], [0.4, -112, "easeOut"], [1.7, -118], [2.2, 0]],
        // The wrist tips what is held (a bottle, a glass) towards the mouth.
        "bones.handF.rotation": [[0, 0], [0.4, 50, "easeOut"], [1.7, 48], [2.2, 0]],
        "bones.head.rotation": [[0, 0], [0.45, -16], [1.7, -20], [2.2, 0]],
        "bones.body.rotation": [[0, 0], [0.45, -5], [1.7, -6], [2.2, 0]],
      },
    },
    // Smoking: the near hand (a cigarette) to the mouth for a puff and back.
    smoke: {
      duration: 1.8,
      tracks: {
        "bones.armF1.rotation": [[0, 0], [0.35, -48, "easeOut"], [1.1, -50], [1.5, -8], [1.8, 0]],
        "bones.armF2.rotation": [[0, 0], [0.35, -128, "easeOut"], [1.1, -130], [1.5, -30], [1.8, 0]],
        "bones.head.rotation": [[0, 0], [0.4, -4], [1.1, -6], [1.4, -10], [1.8, 0]],
      },
    },
    // On the phone: the near hand holds it at the ear (looped while talking).
    phone: {
      duration: 2.4,
      loop: true,
      tracks: {
        // The elbow up and forward, the hand back at the ear.
        "bones.armF1.rotation": [[0, -42], [1.2, -44], [2.4, -42]],
        "bones.armF2.rotation": [[0, -150], [1.2, -148], [2.4, -150]],
        // The wrist turns the phone along the jaw: the top at the ear, the bottom by the mouth.
        "bones.handF.rotation": [[0, 165], [2.4, 165]],
        "bones.head.rotation": [[0, 6], [1.2, 8], [2.4, 6]],
      },
    },
    think: {
      duration: 2.4,
      loop: true,
      tracks: {
        "bones.armF1.rotation": [[0, -30], [2.4, -30]],
        "bones.armF2.rotation": [[0, -128], [1.2, -122], [2.4, -128]],
        "bones.head.rotation": [[0, -8], [1.2, -11], [2.4, -8]],
        "bones.body.rotation": [[0, -2], [2.4, -2]],
      },
    },
    shrug: {
      duration: 1.2,
      clear: true,
      tracks: {
        ...hand("open", 1.2, true),
        "bones.armF1.rotation": [[0, 0], [0.3, -40, "backOut"], [0.9, -40], [1.2, 0]],
        "bones.armF2.rotation": [[0, 0], [0.3, -80, "backOut"], [0.9, -80], [1.2, 0]],
        ...farArm({ "bones.armB1.rotation": [[0, 0], [0.3, 30, "backOut"], [0.9, 30], [1.2, 0]], "bones.armB2.rotation": [[0, 0], [0.3, -70, "backOut"], [0.9, -70], [1.2, 0]] }),
        "bones.head.rotation": [[0, 0], [0.3, 10], [0.9, 10], [1.2, 0]],
        "bones.hips.y": [[0, 0], [0.3, -3], [0.9, -3], [1.2, 0]],
      },
    },
    laugh: {
      duration: 0.6,
      clear: true,
      loop: true,
      tracks: {
        "bones.head.rotation": [[0, -12], [0.15, -6], [0.3, -13], [0.45, -6], [0.6, -12]],
        "bones.body.rotation": [[0, -3], [0.3, -1], [0.6, -3]],
        "bones.hips.y": [[0, 0], [0.15, 2], [0.3, 0], [0.45, 2], [0.6, 0]],
        "bones.armF1.rotation": [[0, -30], [0.6, -30]],
        "bones.armF2.rotation": [[0, -90], [0.3, -95], [0.6, -90]],
      },
    },
    cry: {
      duration: 0.8,
      loop: true,
      tracks: {
        "bones.head.rotation": [[0, 14], [0.2, 11], [0.4, 14], [0.6, 11], [0.8, 14]],
        "bones.body.rotation": [[0, 4], [0.8, 4]],
        "bones.armF1.rotation": [[0, -40], [0.8, -40]],
        "bones.armF2.rotation": [[0, -110], [0.4, -115], [0.8, -110]],
        "bones.hips.y": [[0, 1], [0.2, 3], [0.4, 1], [0.6, 3], [0.8, 1]],
      },
    },
    scared: {
      duration: 0.24,
      clear: true,
      loop: true,
      tracks: {
        ...hand("open", 0.24, true),
        "bones.body.rotation": [[0, -3], [0.06, -5], [0.12, -3], [0.18, -5], [0.24, -3]],
        "bones.root.x": [[0, -1.5], [0.06, 1.5], [0.12, -1.5], [0.18, 1.5], [0.24, -1.5]],
        "bones.armF1.rotation": [[0, -60], [0.24, -60]],
        "bones.armF2.rotation": [[0, -90], [0.24, -90]],
        "bones.hips.y": [[0, 3], [0.24, 3]],
      },
    },
    jump: {
      duration: 0.8,
      clear: true,
      tracks: {
        "bones.root.y": [[0, 0], [0.14, 0], [0.4, -o.jump, "sineOut"], [0.66, 0, "sineIn"], [0.8, 0]],
        "ik.footF.y": [[0, 0], [0.14, 0], [0.4, -12], [0.66, 0], [0.8, 0]],
        "ik.footB.y": [[0, 0], [0.14, 0], [0.4, -16], [0.66, 0], [0.8, 0]],
        "bones.hips.y": [[0, 0], [0.12, 8, "easeOut"], [0.24, -3], [0.62, 0], [0.7, 7, "easeOut"], [0.8, 0, "backOut"]],
        "bones.body.squash": [[0, 0], [0.12, -0.08, "easeOut"], [0.26, 0.08], [0.55, 0], [0.7, -0.07, "easeOut"], [0.8, 0, "backOut"]],
        "bones.armF1.rotation": [[0, 0], [0.12, 20], [0.34, k(-150)], [0.66, k(-60)], [0.8, 0]],
        ...farArm({ "bones.armB1.rotation": [[0, 0], [0.12, -20], [0.34, k(150)], [0.66, k(60)], [0.8, 0]] }),
      },
    },
    // Bouncing a ball with the near hand (the scene animates the ball in sync, period 0.6 s).
    dribble: {
      duration: 0.6,
      clear: true,
      loop: true,
      tracks: {
        // The hand meets the ball at the top (t = 0), rides it down, lets go, rises and waits.
        "bones.armF1.rotation": [[0, -62], [0.12, -40, "easeOut"], [0.45, -64], [0.6, -62]],
        "bones.armF2.rotation": [[0, -40], [0.12, -22, "easeOut"], [0.45, -42], [0.6, -40]],
        "bones.body.rotation": [[0, 3], [0.3, 5], [0.6, 3]],
        "bones.head.rotation": [[0, 6], [0.3, 9], [0.6, 6]],
        "bones.hips.y": [[0, 0], [0.3, 2], [0.6, 0]],
      },
    },
    // Throwing something up high with both hands.
    toss: {
      duration: 0.9,
      clear: true,
      tracks: {
        "bones.hips.y": [[0, 0], [0.2, 6, "easeOut"], [0.4, -4, "backOut"], [0.9, 0]],
        "bones.armF1.rotation": [[0, -30], [0.2, -10], [0.4, -160, "backOut"], [0.9, -40]],
        ...farArm({ "bones.armB1.rotation": [[0, 20], [0.2, 10], [0.4, 160, "backOut"], [0.9, 40]] }),
        "bones.head.rotation": [[0, 0], [0.4, -14], [0.9, -10]],
      },
    },
    // Stopping right at the kerb: leaning forward, arms windmilling.
    teeter: {
      duration: 1.1,
      clear: true,
      tracks: {
        "bones.body.rotation": [[0, 0], [0.15, 12, "easeOut"], [0.55, 8], [1.1, 0, "backOut"]],
        "bones.armF1.rotation": [[0, 0], [0.15, -150], [0.35, -60], [0.55, -150], [0.75, -60], [1.1, 0]],
        ...farArm({ "bones.armB1.rotation": [[0, 0], [0.15, 150], [0.35, 60], [0.55, 150], [0.75, 60], [1.1, 0]] }),
        "bones.hips.y": [[0, 0], [0.15, 3], [1.1, 0]],
      },
    },
    // Pointing up and forward (at a traffic light across the road).
    pointUp: {
      duration: 1.2,
      clear: true,
      loop: true,
      tracks: {
        ...hand("point", 1.2),
        "bones.armF1.rotation": [[0, -104], [0.6, -108], [1.2, -104]],
        "bones.armF2.rotation": [[0, -20], [1.2, -20]],
        "bones.head.rotation": [[0, -10], [1.2, -10]],
      },
    },
    // Flapping both arms (wings) fast: arriving in a hurry, excitement, a bird taking off.
    flap: {
      duration: 0.28,
      clear: true,
      loop: true,
      tracks: {
        "bones.armF1.rotation": [[0, k(-40)], [0.14, k(-120), "easeOut"], [0.28, k(-40), "easeIn"]],
        "bones.armF2.rotation": [[0, -10], [0.14, 20], [0.28, -10]],
        ...farArm({ "bones.armB1.rotation": [[0, k(40)], [0.14, k(120), "easeOut"], [0.28, k(40), "easeIn"]], "bones.armB2.rotation": [[0, 10], [0.14, -20], [0.28, 10]] }),
        "bones.hips.y": [[0, 0], [0.14, -3], [0.28, 0]],
        "bones.head.rotation": [[0, -4], [0.28, -4]],
      },
    },
    // Fighting stance: knees bent, fists up.
    stance: {
      duration: 1.6,
      clear: true,
      loop: true,
      tracks: {
        ...hand("fist", 1.6, true),
        "bones.hips.y": [[0, 6], [0.8, 9], [1.6, 6]],
        "bones.body.rotation": [[0, 6], [0.8, 8], [1.6, 6]],
        "bones.armF1.rotation": [[0, -70], [0.8, -66], [1.6, -70]],
        "bones.armF2.rotation": [[0, -110], [1.6, -110]],
        ...farArm({ "bones.armB1.rotation": [[0, -40], [1.6, -40]], "bones.armB2.rotation": [[0, -120], [1.6, -120]] }),
      },
    },
    // Powering up, eyes closed: arms down and back, fists clenched, chin down.
    power: {
      duration: 1.2,
      clear: true,
      loop: true,
      tracks: {
        ...hand("fist", 1.2, true),
        "bones.hips.y": [[0, 5], [0.6, 7], [1.2, 5]],
        "bones.head.rotation": [[0, 8], [1.2, 8]],
        "bones.armF1.rotation": [[0, 22], [0.6, 24], [1.2, 22]],
        "bones.armF2.rotation": [[0, -30], [1.2, -30]],
        ...farArm({ "bones.armB1.rotation": [[0, 26], [1.2, 26]], "bones.armB2.rotation": [[0, -30], [1.2, -30]] }),
      },
    },
    // A straight punch: wind-up, thrust (fast), hold, recover — the fist lands at 0.28 s.
    punch: {
      duration: 0.9,
      clear: true,
      tracks: {
        ...hand("fist", 0.9, true),
        "bones.body.rotation": [[0, 0], [0.18, -10, "easeOut"], [0.28, 16, "easeIn"], [0.6, 14], [0.9, 0]],
        "bones.hips.y": [[0, 0], [0.18, 6], [0.28, 3], [0.9, 0]],
        "bones.armF1.rotation": [[0, 0], [0.18, 50, "easeOut"], [0.28, -84, "easeIn"], [0.6, -82], [0.9, 0]],
        "bones.armF2.rotation": [[0, 0], [0.18, -120, "easeOut"], [0.28, -4, "easeIn"], [0.6, -4], [0.9, 0]],
        ...farArm({ "bones.armB1.rotation": [[0, 0], [0.28, 40], [0.9, 0]], "bones.armB2.rotation": [[0, 0], [0.28, -100], [0.9, 0]] }),
      },
    },
    // Knocked down: `knocked` in the air, `down` lying (the scene's `fall` action plays them).
    ...knockDownClips(o),
    // Riding (a bicycle…): hands and feet are held on the vehicle by the scene (`reach`); the
    // torso leans into the ride, the head stays up, a small bob with each pedal stroke.
    ride: {
      duration: 1,
      loop: true,
      tracks: {
        "bones.body.rotation": [[0, 15], [0.5, 17], [1, 15]],
        "bones.head.rotation": [[0, -14], [0.5, -15], [1, -14]],
        "bones.hips.y": [[0, 0], [0.25, 1.5], [0.5, 0], [0.75, 1.5], [1, 0]],
      },
    },
    // Hand in hand (the IK target is set by the scene); a gentle sway.
    hold: {
      duration: 2,
      loop: true,
      tracks: {
        ...hand("grip", 2),
        "bones.body.rotation": [[0, 0], [1, 1.5], [2, 0]],
        "bones.head.rotation": [[0, -3], [1, -5], [2, -3]],
      },
    },
  };
  return clips;
}

/**
 * The knock-down clips, timed for the scene's `fall` action (which moves and turns the whole body —
 * thrown back, the hips landing first, the shoulders slapping down — these only pose the limbs):
 *
 * - `knocked` (0.85 s, from the hit to the hips touching down; the fall plays it at the speed that
 *   lands it with the body, its end pose held): no anticipation — a hit is a surprise. The head
 *   whips back first, the chest a few frames later (whiplash), then the body folds at the hips
 *   (a jackknife: thighs forward and up, knees bent) as it flies; the arms lag behind the torso
 *   snapping back, so they fling forward and up with soft elbows, opening out (`turn`) so they
 *   never cross the face from the front; the far arm and leg a few frames behind the near ones.
 *   The foot IK lets go at once (planted feet would hold the body up) and the feet flex, toes up.
 * - `down` (from the hips touching down, played once and held: the K.O. lying pose): the shoulders
 *   slap down, the legs keep rising for two frames and drop back with gravity — the near one
 *   straight, a bounce of the heel, then the far one into a knee up (staggered) — the far arm
 *   flops overhead and out along the floor, the near one out to the side, the head rolls towards
 *   the camera; then a slow breath and a twitch of the foot. Posed in 3D for the body lying on its
 *   back: the arms go out along the floor (`spread`), never across the face or into the floor, in
 *   every view (the far arm overhead is behind the head from the side).
 */
export function knockDownClips(o: { busyFarHand?: boolean; hands?: boolean } = {}) {
  const B = !o.busyFarHand;
  const farArm = (t: Tracks) => (B ? t : {});
  const hand = (v: string, dur: number): Tracks =>
    o.hands ? { "parts.handF.variant": [[0, v], [dur, v]], ...(B ? { "parts.handB.variant": [[0, v], [dur, v]] } : {}) } : {};
  const hold = (v: number, d: number) => [[0, v], [d, v]];
  // Into a contact (a limb or the back landing): faster and faster, like a fall; out of it: slowing.
  const IN = "sineIn", OUT = "sineOut";
  const F = 0.85, D = 3.6, R = 1.2;
  return {
    knocked: {
      duration: F,
      tracks: {
        ...hand("open", F),
        "ik.footF.mix": [[0, 1], [0.1, 0], [F, 0]],
        "ik.footB.mix": [[0, 1], [0.12, 0], [F, 0]],
        "bones.hips.y": hold(0, F),
        // Whiplash: the head snaps back first, the chest arches after it, then the body folds.
        "bones.head.rotation": [[0, 0], [0.05, -28, OUT], [0.13, -40], [0.3, -18], [0.5, -6], [0.7, 3], [F, 6]],
        "bones.body.rotation": [[0, 0], [0.06, -6], [0.16, -20, OUT], [0.32, -6], [0.52, 6], [F, 8]],
        // The arms lag the torso thrown back: forward and up relative to it (towards the hitter),
        // elbows bent and limp, opening out — never over the face, from any side.
        "bones.armF1.rotation": [[0, 0], [0.06, -10], [0.16, -36], [0.32, -60], [0.52, -68], [F, -70]],
        "bones.armF1.turn": [[0, 0], [0.12, -10], [0.4, -15], [F, -15]],
        "bones.armF1.spread": [[0, 0], [0.14, 10], [F, 12]],
        // (Soft but nearly straight: lying, the neck tucks the chin towards the chest, and a bent
        // forearm would fold the hand over the face.)
        "bones.armF2.rotation": [[0, 0], [0.06, -10], [0.16, -18], [0.34, -16], [F, -12]],
        ...farArm({
          "bones.armB1.rotation": [[0, 0], [0.1, -8], [0.2, -40], [0.36, -84], [0.56, -98], [F, -100]],
          "bones.armB1.turn": [[0, 0], [0.2, 8], [0.44, 26], [F, 30]],
          "bones.armB1.spread": [[0, 0], [0.3, 20], [F, 35]],
          "bones.armB2.rotation": [[0, 0], [0.1, -14], [0.2, -36], [0.4, -32], [0.6, -34], [F, -30]],
        }),
        // The jackknife: the near thigh leads, the far one a few frames behind; knees bent, feet flexed.
        "bones.legF1.rotation": [[0, 0], [0.06, -4], [0.16, -24], [0.32, -60], [0.52, -86], [0.7, -98], [F, -104]],
        "bones.legF2.rotation": [[0, 0], [0.06, 12], [0.16, 30], [0.32, 56], [0.52, 60], [F, 50]],
        "bones.legB1.rotation": [[0, 0], [0.1, 0], [0.2, -14], [0.38, -50], [0.58, -78], [F, -92]],
        "bones.legB2.rotation": [[0, 0], [0.1, 6], [0.2, 22], [0.38, 50], [0.6, 64], [F, 58]],
        "bones.footF.rotation": [[0, 0], [0.16, -12], [F, -15]],
        "bones.footB.rotation": [[0, 0], [0.2, -10], [F, -14]],
      },
    },
    down: {
      duration: D,
      tracks: {
        ...hand("open", D),
        "ik.footF.mix": hold(0, D),
        "ik.footB.mix": hold(0, D),
        "bones.hips.y": hold(0, D),
        // The shoulders slap down (the fall turns the body flat), a little rebound, then a slow breath.
        "bones.body.rotation": [[0, 8], [0.07, -2, IN], [0.18, 1], [0.32, 0], [1.9, -1.2], [D, 0]],
        "bones.head.rotation": [[0, 6], [0.1, -6, IN], [0.2, 1], [0.34, -3], [0.6, -4], [D, -4]],
        "bones.head.turn": [[0, 0], [0.35, 0], [0.9, -26], [D, -26]],
        // The near arm flops down along the body (closing in at once: from three quarters or the front
        // its side is the floor's), the far one over the head and out (clear of it), nearly
        // straight: an elbow bent with the arm overhead folds the forearm behind the head.
        // The far arm opens wide (`spread`) as it goes overhead: lying, the neck tucks the head
        // towards the chest, and a big cartoon head would otherwise meet the arm going past it.
        // (Lying turns a drawn view onto its back: from the side the floor is behind the body, from
        // the front it is the near side, so only moves along the body or towards its front — the
        // sky, or the camera — stay off the floor in every view.)
        "bones.armF1.rotation": [[0, -70], [0.08, -72], [0.32, -2, IN], [0.4, -14, OUT], [0.5, -6], [0.66, -8], [D, -8]],
        "bones.armF1.turn": [[0, -15], [0.12, 0], [D, 0]],
        "bones.armF1.spread": [[0, 12], [0.12, 0], [D, 0]],
        "bones.armF2.rotation": [[0, -12], [0.32, -6], [0.42, -22], [0.6, -12], [D, -12]],
        ...farArm({
          "bones.armB1.rotation": [[0, -100], [0.12, -130], [0.3, -166, IN], [0.38, -154], [0.5, -160], [D, -160]],
          "bones.armB1.turn": [[0, 30], [0.3, 10], [D, 10]],
          "bones.armB1.spread": [[0, 35], [0.1, 50], [0.3, 70], [D, 70]],
          "bones.armB2.rotation": [[0, -30], [0.3, -4], [0.38, -14], [0.5, -6], [D, -6]],
        }),
        // The legs keep rising for two frames, then drop: the near one straight (its heel bounces),
        // the far one a few frames later into a knee up, the foot flat.
        "bones.legF1.rotation": [[0, -104], [0.07, -112], [0.3, -6, IN], [0.38, -14, OUT], [0.46, -5, IN], [0.62, -8], [D, -8]],
        "bones.legF2.rotation": [[0, 50], [0.07, 42], [0.3, 6], [0.38, 14], [0.46, 5], [D, 7]],
        "bones.legB1.rotation": [[0, -92], [0.1, -104], [0.4, -54, IN], [0.48, -64, OUT], [0.58, -58], [0.72, -62], [D, -62]],
        "bones.legB2.rotation": [[0, 58], [0.1, 54], [0.4, 100], [0.48, 108], [0.58, 103], [D, 105]],
        "bones.footF.rotation": [[0, -15], [0.3, -4], [0.6, 0], [2.4, 0], [2.48, -16], [2.58, 5], [2.72, 0], [D, 0]],
        "bones.footB.rotation": [[0, -14], [0.4, 6], [0.7, 10], [D, 10]],
      },
    },
    rise: {
      duration: R,
      tracks: {
        // Timed for the scene's `getUp` (played over it): the first half sits up — the scene turns
        // the body up about the hips and lowers them, so it ends upright in a deep crouch —
        // the second half stands, the hips rising over the feet. (The planned crouch lowers the
        // hips; the foot IK takes the feet early, so they stay on the floor.) The head leads (chin in), the
        // legs fold in (the feet find the floor and the IK takes them), the near hand reaches for
        // the knees (clear of the floor as the body crouches), the far arm comes down from overhead,
        // then both swing forward for the momentum and back down; the torso folds
        // forward over the knees and straightens past upright.
        "ik.footF.mix": [[0, 0], [0.06 * R, 0], [0.24 * R, 1], [R, 1]],
        "ik.footB.mix": [[0, 0], [0.1 * R, 0], [0.28 * R, 1], [R, 1]],
        "bones.body.rotation": [[0, 0], [0.12 * R, -4], [0.42 * R, 24], [0.6 * R, 30], [0.84 * R, 8], [0.95 * R, -3], [R, 0]],
        "bones.head.rotation": [[0, -4], [0.12 * R, 16], [0.45 * R, 10], [0.72 * R, -6], [0.92 * R, 2], [R, 0]],
        "bones.head.turn": [[0, -26], [0.4 * R, 0], [R, 0]],
        "bones.armF1.rotation": [[0, -8], [0.12 * R, -10], [0.3 * R, -34], [0.45 * R, -22], [0.6 * R, -14], [0.8 * R, -42], [0.97 * R, -6], [R, 0]],
        "bones.armF2.rotation": [[0, -12], [0.4 * R, -8], [0.8 * R, -36], [R, 0]],
        ...farArm({
          "bones.armB1.rotation": [[0, -160], [0.18 * R, -120], [0.42 * R, 16], [0.62 * R, -4], [0.82 * R, -36], [R, 0]],
          "bones.armB1.turn": [[0, 10], [0.4 * R, 0], [R, 0]],
          "bones.armB1.spread": [[0, 70], [0.4 * R, 36], [0.7 * R, 8], [R, 0]],
          "bones.armB2.rotation": [[0, -6], [0.4 * R, -12], [0.82 * R, -36], [R, 0]],
        }),
        // (A leg's rotations add to its IK's: they let go as the IK takes it.)
        "bones.legF1.rotation": [[0, -8], [0.24 * R, 0], [R, 0]],
        "bones.legF2.rotation": [[0, 7], [0.24 * R, 0], [R, 0]],
        "bones.legB1.rotation": [[0, -62], [0.28 * R, 0], [R, 0]],
        "bones.legB2.rotation": [[0, 105], [0.28 * R, 0], [R, 0]],
        "bones.footF.rotation": [[0, 0], [0.3 * R, 0], [R, 0]],
        "bones.footB.rotation": [[0, 10], [0.3 * R, 0], [R, 0]],
      },
    },
  };
}

export const blinkAndBreathe = (period = 3.2) => [
  { type: "blink", id: "blink", part: "eyes", open: "open", closed: "closed", interval: [2, 4.6], duration: 0.14 },
  { type: "breathe", id: "breathe", bone: "body", amount: 0.012, period },
];

/** Emotion poses shared by the cast (mouth/brow morph weights, eye variants, head tilt). */
export const emotions = (extra: Record<string, Record<string, unknown>> = {}) => ({
  type: "pose" as const,
  poses: {
    neutral: { "parts.eyes.variant": "open" },
    sleep: { "parts.eyes.variant": "closed", "parts.mouth.morph.smile": 0.3, "bones.head.rotation": 6 },
    happy: { "parts.eyes.variant": "open", "parts.mouth.morph.smile": 0.9, "parts.brows.morph.up": 0.35, "bones.head.rotation": -3 },
    joy: { "parts.eyes.variant": "happy", "parts.mouth.morph.grin": 0.8, "parts.brows.morph.up": 0.5, "bones.head.rotation": -6 },
    surprised: { "parts.eyes.variant": "wide", "parts.mouth.morph.E": 0.5, "parts.brows.morph.up": 1, "bones.head.rotation": -5 },
    sad: { "parts.eyes.variant": "open", "parts.mouth.morph.frown": 1, "parts.brows.morph.sad": 1, "bones.head.rotation": 8 },
    smug: { "parts.eyes.variant": "half", "parts.mouth.morph.smile": 0.7, "parts.brows.morph.smug": 1, "bones.head.rotation": -4 },
    scared: { "parts.eyes.variant": "wide", "parts.mouth.morph.frown": 0.7, "parts.brows.morph.sad": 1 },
    angry: { "parts.eyes.variant": "open", "parts.mouth.morph.frown": 0.9, "parts.brows.morph.cross": 1, "bones.head.rotation": 4 },
    ...extra,
  },
});

export const eyeSwitch = (bone: string) => ({
  id: "eyes",
  type: "switch",
  bone,
  variants: { open: "eyeOpen", wide: "eyeWide", closed: "eyeClosed", happy: "eyeHappy", half: "eyeOpen" },
  default: "open",
});


/**
 * Hand-drawn timing for gesture clips (traditional animation): **anticipation** — a small move the
 * other way before a big one — and **overshoot** — past the pose, then settling back. Applied to
 * bone rotations that change by at least `min` degrees; loops (walk, run, idle, talk…), the
 * `turn` squeeze and the knock-down clips (`knockDownClips`: a hit is a surprise, and their motion is
 * timed by the fall's physics, not acted) are left alone. The splines through the keys keep
 * everything smooth.
 */
export function fluid<T extends Record<string, unknown>>(clips: T, o: { anticipation?: number; overshoot?: number; min?: number } = {}): T {
  const A = o.anticipation ?? 0.15, O = o.overshoot ?? 0.12, min = o.min ?? 20;
  const out: Record<string, unknown> = {};
  for (const [name, c] of Object.entries(clips)) {
    const clip = c as { duration: number; loop?: boolean; tracks: Tracks };
    if (!clip?.tracks || clip.loop || name === "turn" || name === "knocked" || name === "down" || name === "rise") {
      out[name] = c;
      continue;
    }
    const tracks: Tracks = {};
    for (const [ch, keys] of Object.entries(clip.tracks)) {
      if (!/^bones\.[^.]+\.rotation$/.test(ch) || keys.length < 2 || keys.some((k) => typeof k[1] !== "number")) {
        tracks[ch] = keys;
        continue;
      }
      const ks = [...keys].sort((a, b) => (a[0] as number) - (b[0] as number));
      const v = (i: number) => ks[i][1] as number, t = (i: number) => ks[i][0] as number;
      const res: (number | string)[][] = [ks[0]];
      let settled = -Infinity; // time of the last settle key added
      for (let i = 0; i + 1 < ks.length; i++) {
        const d = v(i + 1) - v(i), dt = t(i + 1) - t(i);
        const big = Math.abs(d) >= min && dt >= 0.12;
        const before = i > 0 ? v(i) - v(i - 1) : 0;
        const after = i + 2 < ks.length ? v(i + 2) - v(i + 1) : 0;
        const fromRest = Math.abs(before) < min * 0.3 || Math.sign(before) !== Math.sign(d);
        const toRest = Math.abs(after) < min * 0.3 || Math.sign(after) !== Math.sign(d);
        const at = t(i) + dt * 0.3;
        if (big && fromRest && at > settled + 0.02) res.push([r(at), r(v(i) - d * A)]);
        const room = (i + 2 < ks.length ? t(i + 2) : clip.duration) - t(i + 1);
        if (big && toRest && room >= 0.16) {
          const end = [...ks[i + 1]];
          end[1] = r(v(i + 1) + d * O);
          settled = r(t(i + 1) + Math.min(0.14, room * 0.45));
          res.push(end, [settled, v(i + 1)]);
        } else res.push(ks[i + 1]);
      }
      tracks[ch] = res;
    }
    out[name] = { ...clip, tracks };
  }
  return out as T;
}

/**
 * Inside of a `mouthShapes` mouth, with the same shape names (they morph together): the upper
 * `teeth` (a white band under the top lip) and the `tongue` (at the bottom). Hidden when closed.
 */
export function mouthInside(L: P, R: P, scale = 1, style: MouthStyle = {}) {
  const table = mouthTable();
  const shape = (kind: "teeth" | "tongue", open: number, smile: number, round: number) => {
    const o = open * scale;
    const w = R[0] - L[0];
    const k = style.lift ?? 1;
    // Closed: nothing inside shows (collapsed in the middle of the mouth, same commands).
    if (open < 3) {
      const c = `${r((L[0] + R[0]) / 2)} ${r((L[1] + R[1]) / 2)}`;
      return `M${c} Q${c} ${c} Q${c} ${c} Z`;
    }
    const l: P = [L[0] + w * round * 0.22, L[1] - smile * (style.symmetric ? 5 : 4) * k];
    const rr: P = [R[0] - w * round * 0.22, R[1] - smile * (style.symmetric ? 5 : 6) * k];
    const mx = (l[0] + rr[0]) / 2;
    const topY = (l[1] + rr[1]) / 2 + smile * 3 * k - o * 0.15;
    const botY = (l[1] + rr[1]) / 2 + smile * 4 * k + o;
    if (kind === "teeth") {
      // Along the top lip, as deep as a third of the opening (at most a tooth's height).
      const t = Math.min(o * 0.34, 7 * scale);
      const a: P = [l[0] + w * 0.08, l[1] + 1], b: P = [rr[0] - w * 0.08, rr[1] + 1];
      return `M${r(a[0])} ${r(a[1])} Q${r(mx)} ${r(topY + 1)} ${r(b[0])} ${r(b[1])} Q${r(mx)} ${r(topY + 1 + t * 1.6)} ${r(a[0])} ${r(a[1])} Z`;
    }
    // The tongue: a mound on the bottom lip, two thirds of the mouth wide.
    const h = Math.min(o * 0.45, 9 * scale);
    const a: P = [l[0] + w * 0.2, (l[1] + botY) / 2 + o * 0.25], b: P = [rr[0] - w * 0.2, (rr[1] + botY) / 2 + o * 0.25];
    return `M${r(a[0])} ${r(a[1])} Q${r(mx)} ${r(botY + o * 0.4 - h * 2)} ${r(b[0])} ${r(b[1])} Q${r(mx)} ${r(botY + o * 0.4)} ${r(a[0])} ${r(a[1])} Z`;
  };
  const make = (kind: "teeth" | "tongue") => ({
    base: shape(kind, ...table.base),
    shapes: Object.fromEntries(Object.entries(table.shapes).map(([k, v]) => [k, shape(kind, ...v)])),
  });
  return { teeth: make("teeth"), tongue: make("tongue") };
}

/**
 * A cartoon **gape** (a jaw dropped to swallow something whole, a scream, a big yawn) as the three
 * paths of a mouth wide open, in the same commands as `mouthShapes`/`mouthInside` (two curves: they
 * morph with them): the `mouth` from corner `l` over the top lip (its middle at height `top`) to
 * corner `rr`, back under a round lower edge (its lowest point at `bottom`, bulging `out` past the
 * corners); the upper `teeth`, a row along the top lip (`teeth` deep in the middle); the `tongue`
 * low, a mound on the bottom. Draw the inside dark (the mouth's fill); the lower teeth stay hidden.
 */
export function gapeMouth(l: P, rr: P, top: number, bottom: number, o: { out?: number; teeth?: number } = {}) {
  const w = rr[0] - l[0], mx = (l[0] + rr[0]) / 2, out = o.out ?? w * 0.12, h = bottom - top;
  // A cubic whose controls sit at one height passes through `y` in its middle: c = (8y − y0 − y1) / 6.
  const ctl = (y: number, a: P, b: P) => (8 * y - a[1] - b[1]) / 6;
  const C = (...q: number[]) => q.map(r).join(" ");
  const cT = ctl(top, l, rr), cB = ctl(bottom, rr, l);
  const mouth = `M${C(...l)} C${C(l[0] + w * 0.22, cT, rr[0] - w * 0.22, cT)} ${C(...rr)} C${C(rr[0] + out, cB, l[0] - out, cB)} ${C(...l)} Z`;
  // The teeth: the top lip again, and under it the same curve lowered (clipped by the mouth).
  const t = (o.teeth ?? h * 0.14) / 0.75;
  const ta: P = [l[0] + w * 0.03, l[1] + 1], tb: P = [rr[0] - w * 0.03, rr[1] + 1], tT = ctl(top + 1, ta, tb);
  const teeth = `M${C(...ta)} C${C(ta[0] + w * 0.2, tT - 3, tb[0] - w * 0.2, tT - 3)} ${C(...tb)} C${C(tb[0] - w * 0.2, tT + t, ta[0] + w * 0.2, tT + t)} ${C(...ta)} Z`;
  // The tongue: a mound across the bottom, two thirds of the mouth wide, down past the lower edge.
  const ga: P = [mx - w * 0.36, bottom - h * 0.2], gb: P = [mx + w * 0.36, bottom - h * 0.2];
  const gT = ctl(bottom - h * 0.36, ga, gb), gB = ctl(bottom + h * 0.25, gb, ga);
  const tongue = `M${C(...ga)} C${C(ga[0] + w * 0.08, gT, gb[0] - w * 0.08, gT)} ${C(...gb)} C${C(gb[0], gB, ga[0], gB)} ${C(...ga)} Z`;
  return { mouth, teeth, tongue };
}

/**
 * A morph shape that reaches `target` at weight `at` (default 2) from `base` — a morph is linear
 * (`base + w·(shape − base)`), so the shape is the point `1/at` of the way: weight 1 is a gape,
 * weight 2 the unhinged jaw, every weight in between a shape between them. Both paths must have the
 * same segments once made cubic (the same commands, or `Q` against `C`).
 */
export function morphTowards(base: string, target: string, at = 2): string {
  const b = parsePath(base), bp = pathPoints(b), tp = pathPoints(parsePath(target));
  if (bp.length !== tp.length) throw new Error(`morphTowards: ${bp.length} points against ${tp.length}`);
  return pathToString(withPoints(b, bp.map((p, i): [number, number] => [r(p[0] + (tp[i][0] - p[0]) / at), r(p[1] + (tp[i][1] - p[1]) / at)])));
}

/** Open / smile / round of each `mouthShapes` shape. */
function mouthTable() {
  return {
    base: [1.5, 0.7, 0] as [number, number, number],
    shapes: {
      A: [0.8, 0.4, 0.05], B: [6, 0.6, 0.05], C: [12, 0.5, 0.1], D: [18, 0.4, 0], E: [13, 0.2, 0.45], F: [7, 0, 0.75],
      G: [4, 0.5, 0.1], H: [10, 0.4, 0.15], smile: [4, 2.2, 0], frown: [1.5, -1.4, 0.1], grin: [14, 2.4, 0],
    } as Record<string, [number, number, number]>,
  };
}

/**
 * Cartoon hands with fingers (four fingers and a thumb, drawn around the wrist `at`), as switch
 * variants `open`, `fist`, `point` and `grip` — the same names as `handShapes`. `dir` is the
 * direction of the fingers in setup space (90 = down, a hanging arm); `line` the outline colour.
 */
export function cartoonHands(at: P, o: { r: number; fill: string; line?: string; stroke?: number; dir?: number; shade?: string; detail?: number }) {
  // (`detail`: the knuckle lines' weight, thinner than the outline unless a style draws every line alike.)
  const [x, y] = at, R = o.r, ink = o.line ?? "palette(ink)", w = o.stroke ?? 2.6, wd = o.detail ?? w * 0.7;
  const st = `stroke="${ink}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
  // Drawn with the fingers along +x, then turned.
  const P_ = (dx: number, dy: number) => `${r(x + dx * R)} ${r(y + dy * R)}`;
  const finger = (y0: number, len: number, bend = 0) =>
    `<path d="M${P_(0.35, y0 - 0.15)} L${P_(0.35 + len, y0 - 0.15 + bend)} Q${P_(0.55 + len, y0 + bend)} ${P_(0.35 + len, y0 + 0.15 + bend)} L${P_(0.35, y0 + 0.15)} Z" fill="${o.fill}" ${st}/>`;
  const palm = `<path d="M${P_(-0.55, -0.5)} Q${P_(-0.6, 0)} ${P_(-0.55, 0.5)} L${P_(0.45, 0.58)} Q${P_(0.62, 0)} ${P_(0.45, -0.58)} Z" fill="${o.fill}" ${st}/>`;
  const thumb = (a: number) => `<g transform="rotate(${a} ${P_(-0.2, -0.45).replace(" ", " ")})"><path d="M${P_(-0.3, -0.62)} L${P_(0.25, -0.62)} Q${P_(0.45, -0.48)} ${P_(0.25, -0.34)} L${P_(-0.3, -0.34)} Z" fill="${o.fill}" ${st}/></g>`;
  const curled = `<path d="M${P_(0.3, -0.55)} Q${P_(0.85, -0.6)} ${P_(0.85, 0)} Q${P_(0.85, 0.6)} ${P_(0.3, 0.55)}" fill="${o.fill}" ${st}/>` +
    `<path d="M${P_(0.55, -0.18)} H${P_(0.84, -0.18).split(" ")[0]} M${P_(0.55, 0.18)} H${P_(0.84, 0.18).split(" ")[0]}" stroke="${ink}" stroke-width="${r(wd)}" stroke-linecap="round"/>`;
  const turn = (art: string) => `<g transform="rotate(${o.dir ?? 90} ${x} ${y})">${art}</g>`;
  return {
    open: turn(finger(0.38, 0.62, 0.06) + finger(0.12, 0.78) + finger(-0.14, 0.82) + finger(-0.4, 0.7, -0.04) + palm + thumb(-35)),
    fist: turn(palm + curled + thumb(0)),
    point: turn(finger(-0.36, 0.95) + palm + curled + thumb(10)),
    grip: turn(palm + `<path d="M${P_(0.3, -0.55)} Q${P_(1.05, -0.5)} ${P_(0.95, 0.15)} Q${P_(0.8, 0.6)} ${P_(0.3, 0.55)}" fill="${o.fill}" ${st}/>` + thumb(-15)),
  };
}
