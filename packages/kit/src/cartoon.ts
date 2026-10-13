/**
 * TV-cartoon characters from a short description (`CartoonLook`): the look of a family TV
 * cartoon — long thin limbs, big sneakers, large expressive faces with oval eyes and small dark
 * pupils, thick brows, a wide mouth — on the kit skeleton, so every kit clip, emotion and director
 * feature works with them.
 *
 * The main view is a three-quarter view facing right (the usual TV-cartoon angle: two people talking
 * face each other and the audience); the generated `front` and `back` views share the skeleton.
 * Heads, hair and torsos are modelled as volumes (`volume.ts`) and drawn from each angle, so the
 * three views always match. Measure with `cartoonInfo(doc)`.
 */
import { type ToonDoc, normalizeTrack, parsePath, pathPoints, pathToString, reach3d, rig3dPoint, rig3dPose, sampleTrack, withPoints } from "@animestudio/core";
import { humanClips } from "./human";
import { type P, cartoonHands, characterClips, emotions, fluid, gapeMouth, limbBones, limbIk, morphTowards, mouthInside, mouthShapes } from "./rig";
import { type RigInfo, rigInfo } from "./info";
import { type ViewSpec, withViews } from "./views";
import { aimForward, longHex, mix, shade } from "./util";
import {
  type Box3, type Cast, type Grid, type P2, type Sdf, type V3, type View, type ViewLike, toCam,
  above, blend, box, bumpy, capsule, cast, contours, curvePath, depthOf, ellipsoid, fieldPath, grow, gridFor, intersect, normal, onSurface, project, surfaceZ,
  smoothstep, sphere, taper, union,
} from "./volume";

export type CartoonBuild = "baby" | "child" | "kid" | "teen" | "woman" | "man" | "big" | "elder";
export type CartoonHair =
  | "bowl" | "sidePart" | "afro" | "puffs" | "ponytail" | "long" | "perm" | "mullet"
  | "buzz" | "bald" | "bun" | "braids" | "rollers" | "tuft" | "receding" | "slick" | "bob" | "curtains" | "spiky";
export type CartoonHat = "cap" | "capBack" | "flatCap" | "top" | "bowler" | "cowboy";
export type CartoonNose = "button" | "round" | "long" | "wide";
export type CartoonJaw = "round" | "square" | "pointy" | "chubby";
export type CartoonTop =
  | "tee" | "stripes" | "polo" | "shirt" | "tank" | "jersey" | "blouse" | "dress" | "overalls" | "jacket" | "cardigan" | "blazer";
export type CartoonBottom = "pants" | "shorts" | "bermuda" | "skirt" | "longSkirt";
/** A print on the top: horizontal stripes, thin vertical stripes (a dress shirt), checks. */
export type CartoonPattern = "stripes" | "pinstripes" | "checks" | "polka";
export type CartoonShoes = "sneakers" | "studded" | "canvas" | "flipflops" | "dress" | "heels" | "sandals";

export interface CartoonLook {
  name: string;
  build: CartoonBuild;
  /** Belly (0..1). */
  heavy?: number;
  /** Arm and leg thickness: `thin` (default), `normal`, `thick`. */
  limbs?: "thin" | "normal" | "thick";
  /** Height multiplier (legs and torso). */
  tall?: number;
  /** Narrow waist, wider hips, lashes. */
  female?: boolean;
  skin: string;
  hair: CartoonHair;
  hairColor: string;
  jaw?: CartoonJaw;
  nose?: CartoonNose;
  top: CartoonTop;
  topColor: string;
  /** Stripes, collar, jacket, overalls bib… */
  top2?: string;
  bottom: CartoonBottom;
  bottomColor: string;
  shoes: CartoonShoes;
  shoeColor?: string;
  socks?: string;
  /** Hair ties, beads, rollers, earrings. */
  accent?: string;
  apron?: string;
  /** Glasses (`"sun"`: dark lenses). */
  glasses?: boolean | "sun";
  /** A cap (peak in front or turned back) or a flat cap, in `hatColor`. */
  hat?: CartoonHat;
  hatColor?: string;
  /** A tie (with a shirt or a blazer). */
  tie?: string;
  /** A sweater thrown over the shoulders, the sleeves knotted on the chest. */
  sweater?: string;
  necklace?: { kind: "pearls" | "chain"; color?: string };
  suspenders?: string;
  /** A wristwatch on the near arm. */
  watch?: string;
  moustache?: boolean;
  goatee?: boolean;
  freckles?: boolean;
  earrings?: boolean;
  wrinkles?: boolean;
  lipstick?: string;
  /** A shaved line on the side of a buzz cut. */
  hairLine?: boolean;
  /** Print on the top (colour `stripe`, default `top2`). */
  pattern?: CartoonPattern;
  stripe?: string;
  /** Height of each band of a `stripes` print or top, as a fraction of the torso (default 0.13; a football hoop ≈ 0.25). */
  stripeWidth?: number;
  /** Something in the shirt pocket, sticking out (a small box: a pack of cards, cigarettes…): its colour and top band. */
  pocketItem?: { color: string; band?: string };
  /** Something resting behind the ear: a pencil or a cigarette. */
  earItem?: "pencil" | "cigarette";
  /** Rosy nose and cheeks (a cold, the sun, a drink). */
  flushed?: boolean;
  /** A shadow of beard on the jaw and upper lip. */
  stubble?: boolean;
  /** A bridal veil over the hair, down the back (its colour). */
  veil?: string;
  /** A flower in the jacket's lapel (its colour). */
  boutonniere?: string;
  /** A cape from the shoulders down the back to the knees (its colour). */
  cape?: string;
}

interface Build {
  /** Hip height, torso length, neck length, head radius (cranium half width). */
  L: number; T: number; n: number; u: number;
  /** Shoulder, waist and hip half widths, body half depth. */
  S: number; W: number; H: number; D: number;
  arm: [number, number]; leg: [number, number]; hand: number; shoe: number; eye: number;
}

const BUILDS: Record<CartoonBuild, Build> = {
  // A baby: a big head on a small round body, short limbs.
  baby: { L: 50, T: 54, n: 3, u: 38, S: 22, W: 24, H: 22, D: 19, arm: [9, 8], leg: [12, 10], hand: 6.5, shoe: 0.5, eye: 1.2 },
  child: { L: 150, T: 96, n: 16, u: 58, S: 34, W: 30, H: 28, D: 22, arm: [13, 11], leg: [17, 14], hand: 10, shoe: 0.9, eye: 1.12 },
  kid: { L: 192, T: 110, n: 24, u: 56, S: 38, W: 31, H: 30, D: 22, arm: [14, 12], leg: [18, 15], hand: 10.5, shoe: 1, eye: 1.06 },
  teen: { L: 236, T: 134, n: 26, u: 51, S: 44, W: 34, H: 36, D: 25, arm: [15, 13], leg: [20, 17], hand: 11, shoe: 1.06, eye: 1 },
  woman: { L: 250, T: 148, n: 26, u: 46, S: 44, W: 33, H: 44, D: 26, arm: [15, 13], leg: [20, 17], hand: 11, shoe: 1.02, eye: 0.94 },
  man: { L: 254, T: 168, n: 22, u: 48, S: 58, W: 50, H: 46, D: 34, arm: [19, 16], leg: [24, 20], hand: 13, shoe: 1.16, eye: 0.88 },
  big: { L: 250, T: 196, n: 18, u: 47, S: 80, W: 66, H: 54, D: 46, arm: [30, 24], leg: [30, 26], hand: 16, shoe: 1.26, eye: 0.86 },
  elder: { L: 214, T: 150, n: 18, u: 48, S: 50, W: 48, H: 46, D: 32, arm: [17, 14], leg: [21, 18], hand: 12, shoe: 1.04, eye: 0.84 },
};

const INK = "#2a201e";
const SW = 2.8;
/**
 * The line weights of the drawing being built: the painted style's own (`SW` for outlines, thinner
 * for seams and lips), or one weight for every line (`CartoonStyle.line`), set for a build.
 */
const WEIGHT = { w: SW, uniform: false };
/** A line weight as the style draws it (one weight for everything when uniform). */
const lw = (w: number) => (WEIGHT.uniform ? WEIGHT.w : w);
/** The three-quarter angle of the main view. */
const Q = (36 * Math.PI) / 180;
const deg = (d: number) => (d * Math.PI) / 180;
/** How much of the camera's pitch the head is drawn with. */
const HEAD_PITCH = 0.3;
/**
 * The view the head is drawn in at a camera pitch: nearly level (`HEAD_PITCH` of the pitch — seen
 * from above, the nose would come down over the mouth) and put back where the camera's pitch puts
 * the top of the neck. Everything placed on the head (its points, anchors, the ponytail's pivot,
 * the measurements) is projected with it.
 */
const headAngle = (m: Model, yaw: number, pitch: number): View => ({ yaw, pitch: pitch * HEAD_PITCH, dy: m.y.neckTop * (Math.cos(pitch) - Math.cos(pitch * HEAD_PITCH)) });
/** Drawn angles, in turning order (the in-betweens make turns fluid). */
const VIEWS = {
  front: 0, half: deg(12), q24: deg(24), profile: Q, q50: deg(50), q64: deg(64), q77: deg(77), side: deg(90),
  q112: deg(112), away: deg(135), q158: deg(158), back: Math.PI,
} as const;
type ViewKey = keyof typeof VIEWS;
const SUFFIX: Record<ViewKey, string> = { front: "F", half: "H", q24: "T", profile: "", q50: "U", q64: "V", q77: "W", side: "S", q112: "X", away: "A", q158: "Y", back: "K" };

const r = (n: number) => Math.round(n * 100) / 100;
const st = (w = SW) => `stroke="palette(ink)" stroke-width="${lw(w)}" stroke-linejoin="round" stroke-linecap="round"`;
/** Outline in a dark tone of a palette colour (`<key>Line`). */
const stc = (key: string, w = SW) => `stroke="palette(${key}Line)" stroke-width="${lw(w)}" stroke-linejoin="round" stroke-linecap="round"`;
/** The line colour that goes with a fill (`palette(x)` → `palette(xLine)`). */
const LINE = (fill: string) => fill.replace(/palette\(([^)]+)\)/, (_, k: string) => `palette(${k.replace(/Shade$|Dark$/, "")}Line)`);
const pts = (p: P2[]) => p.map((q) => `${r(q[0])} ${r(q[1])}`).join(" L");

// ------------------------------------------------------------------ anatomy

/**
 * A character's anatomy: every measure the drawings, the 3D skeleton, the director and the physics
 * are made from — one document, kept with the character (`meta.anatomy`), editable, and checked by
 * rules (`checkAnatomy`) before anything is drawn. `cartoonAnatomy(look)` derives it from a look.
 */
export interface CartoonAnatomy {
  /**
   * Body (character units): hip height, torso length, neck length, head radius (`head`: the face's
   * unit); half widths of the shoulders, waist and hips, half depth of the body — before the look's
   * shaping (`female`: narrower waist, wider hips; `heavy`: a belly).
   */
  body: { hip: number; torso: number; neck: number; head: number; shoulders: number; waist: number; hips: number; depth: number };
  /**
   * Arm diameters at the shoulder and the wrist; leg thickness at the knee and the ankle (the shin's
   * diameters there; the thigh is drawn `THIGH_R` × the knee value in radius at the hip, 1.6 ×
   * across); hand radius; shoe scale; the calf's swell (× the shin's width below the knee).
   */
  limbs: { arm: [number, number]; leg: [number, number]; hand: number; shoe: number; calf: number };
  /**
   * Face, in head radii from the head's centre (down is +): eye height, eye centre's distance from
   * the middle, eye half width and half height, pupil radius; gap between eye and brow; nose height,
   * nose half sizes (width, height, depth) and how far it stands out of the face; mouth height and
   * half width (the widest it gets), how squarely a mouth corner must face the camera to be drawn
   * (0..1: higher keeps it off the face's edge in a three-quarter view); ear height; chin bottom.
   */
  face: {
    eyeY: number; eyeX: number; eye: [number, number]; pupil: number; brow: number;
    noseY: number; nose: [number, number, number]; noseOut: number;
    mouthY: number; mouthW: number; mouthMargin: number; earY: number; chinY: number;
  };
  /** Secondary motion: [stiffness, damping] (0..1) of the body's jiggle, forearms, head, ponytail, big hair. */
  physics: { body: [number, number]; forearms: [number, number]; head: [number, number]; tail: [number, number]; hair: [number, number] };
}

const NOSES: Record<CartoonNose, { size: [number, number, number]; out: number }> = {
  button: { size: [0.16, 0.13, 0.2], out: 0.08 },
  round: { size: [0.22, 0.15, 0.22], out: 0.09 },
  wide: { size: [0.24, 0.14, 0.17], out: 0.04 },
  long: { size: [0.13, 0.11, 0.15], out: 0.12 },
};
const CHINS: Record<CartoonJaw, number> = { round: 1.14, chubby: 1.14, pointy: 1.14, square: 1.16 };
/** Thigh radius at the hip, as a fraction of `limbs.leg[0]` (the legs are drawn and checked with it). */
export const THIGH_R = 0.8;

/** The anatomy of a look (the defaults of its build, limbs, height, nose and jaw). */
export function cartoonAnatomy(look: CartoonLook): CartoonAnatomy {
  const base = BUILDS[look.build];
  const k = look.tall ?? 1;
  // Limb thickness: thin (the default, long thin limbs), normal or thick.
  const lk = look.limbs === "thick" ? 1.6 : look.limbs === "normal" ? 1.32 : 1;
  const nose = NOSES[look.nose ?? "button"];
  // A smaller nose on a female face.
  const nk = look.female ? 0.85 : 1;
  return {
    body: { hip: r(base.L * k), torso: r(base.T * k), neck: base.n, head: base.u, shoulders: base.S, waist: base.W, hips: base.H, depth: base.D },
    limbs: { arm: [r(base.arm[0] * lk), r(base.arm[1] * lk)], leg: [r(base.leg[0] * lk), r(base.leg[1] * lk)], hand: r(base.hand * (1 + (lk - 1) * 0.5)), shoe: base.shoe, calf: look.female ? 1.22 : 1.12 },
    face: {
      eyeY: 0.12, eyeX: 0.3, eye: [r(0.185 * base.eye), r(0.235 * base.eye)], pupil: r(0.075 * base.eye), brow: 0.13,
      noseY: 0.38, nose: [r(nose.size[0] * nk), r(nose.size[1] * nk), r(nose.size[2] * nk)], noseOut: r(nose.out * nk),
      mouthY: 0.74, mouthW: 0.28, mouthMargin: 0.45, earY: 0.3, chinY: CHINS[look.jaw ?? "round"],
    },
    physics: { body: [0.75, 0.6], forearms: [0.55, 0.45], head: [0.7, 0.55], tail: [0.32, 0.25], hair: [0.45, 0.35] },
  };
}

/** A broken rule of an anatomy: `error` (it would draw wrong) or `warning`. */
export interface AnatomyIssue { severity: "error" | "warning"; rule: string; message: string }

/**
 * The rules an anatomy must follow: features that do not touch (the mouth below the nose with room
 * for a smile, the nose below the eyes, the eyes apart and inside the face), a chin under the mouth,
 * limbs that fit the body, hands that reach the lap seated, physics in range.
 */
export function checkAnatomy(a: CartoonAnatomy): AnatomyIssue[] {
  const out: AnatomyIssue[] = [];
  const f = a.face, B = a.body, Lm = a.limbs;
  const err = (rule: string, message: string) => out.push({ severity: "error", rule, message });
  const warn = (rule: string, message: string) => out.push({ severity: "warning", rule, message });
  // A smile lifts the corners about 0.1 head radius; the lips need 0.06 more below the nose.
  const noseBottom = f.noseY + f.nose[1];
  if (f.mouthY - 0.1 - noseBottom < 0.06) err("mouth-nose", `the mouth (at ${f.mouthY}) touches the nose (its bottom at ${r(noseBottom)}): keep mouthY ≥ ${r(noseBottom + 0.16)}`);
  if (f.chinY - f.mouthY < 0.3) err("chin", `no chin under the mouth (mouth at ${f.mouthY}, chin at ${f.chinY}): an open mouth needs 0.3 head radius`);
  if (f.noseY - f.nose[1] < f.eyeY) warn("nose-eyes", "the nose starts above the eyes' centre: it will cover them in a three-quarter view");
  if (f.eyeX - f.eye[0] < 0.04) err("eyes-apart", "the eyes touch each other");
  if (f.eyeX + f.eye[0] > 0.8) err("eyes-inside", "the eyes go past the side of the face");
  if (f.eyeY - f.eye[1] - f.brow < -0.95) err("brows", "the brows are above the top of the head");
  if (f.mouthW < 0.15 || f.mouthW > 0.45) err("mouth-width", `mouthW ${f.mouthW} out of 0.15..0.45 head radii`);
  if (f.mouthMargin < 0 || f.mouthMargin > 0.9) err("mouth-margin", "mouthMargin out of 0..0.9");
  if (f.pupil > f.eye[0] * 0.8) err("pupil", "the pupil is bigger than the eye");
  if (Lm.leg[0] * THIGH_R > B.hips) err("legs-fit", `the thighs (${r(Lm.leg[0] * THIGH_R)} radius at the hip) are wider than the hips (${B.hips})`);
  if (Lm.calf < 1 || Lm.calf > 1.6) err("calf", "limbs.calf out of 1..1.6");
  if (Lm.arm[0] / 2 > B.shoulders * 0.6) warn("arms-fit", "the arms are very thick for the shoulders");
  // Seated, a hand reaches the middle of the thigh: from the shoulder, down the torso, forward half a thigh.
  const arm = B.torso * 0.9 + B.hip * 0.34, need = Math.hypot(B.torso * 0.82, B.hip * 0.28);
  if (arm < need) warn("reach", `the arms (${r(arm)}) are too short for the hands to rest in the lap seated (${r(need)})`);
  if (B.head > (B.hip + B.torso) * 0.5) warn("head", "the head is wider than half the body's height: it will hide the shoulders when it turns");
  for (const [k, v] of Object.entries(a.physics)) if (v.some((x) => x <= 0 || x > 1)) err("physics", `physics.${k} must be in (0, 1]`);
  return out;
}

// ------------------------------------------------------------------ the model

interface Model {
  b: Build;
  /** Key heights. */
  y: { hip: number; waist: number; shoulder: number; torsoTop: number; neckTop: number; head: number; eye: number; brow: number; nose: number; mouth: number; ear: number; top: number };
  head: Sdf;
  /** The ellipsoids the head (cranium and face) is blended from: [centre, radii] — its occluder. */
  headParts: [V3, V3][];
  ears: Sdf;
  hair: Sdf;
  /** The hair as styled, before a hat, a veil or something behind an ear: its bulk round the head. */
  bulk: Sdf;
  hairColor: (p: V3) => string;
  /** A ponytail on its own spring bone: the volume, where it is tied and where it ends. */
  tail?: { sdf: Sdf; color: (p: V3) => string; pivot: V3; end: V3 };
  /** Big hair that bounces (perm, afro, puffs, long hair). */
  bouncy: boolean;
  /** A veil hangs from the head (drawn on a taller grid). */
  veil?: boolean;
  /** The nose volume (part of `head`), to outline it where it stands out. */
  nose?: Sdf;
  headColor: (p: V3) => string;
  /** Something in the shirt pocket (part of the torso). */
  torsoItem?: Sdf;
  neck: Sdf;
  neckR: number;
  torso: Sdf;
  torsoColor: (p: V3) => string;
  skirt?: Sdf;
  skirtColor?: (p: V3) => string;
  eye: { x: number; rx: number; ry: number };
  mouthW: number;
  /** How squarely a mouth corner must face the camera to be drawn. */
  mouthMargin: number;
  /** Pupil radius (head radii). */
  pupil: number;
  /** Room between the mouth and the bottom of the chin (an open mouth stays inside the face). */
  chinRoom: number;
  /** Cel shadows drawn on the volumes (false: flat colours). */
  shade: boolean;
  /** Radius of the shoulder caps (the torso's capsule across the shoulders). */
  sh: number;
  /** The style it is drawn in. */
  style: Required<CartoonStyle>;
}

/** Half width of the part of a face that looks at the camera at a height (a mouth must fit in it). */
function frontHalf(head: Sdf, y: number, u: number) {
  let x = 0;
  for (; x < u * 1.2; x += u * 0.02) {
    const z = surfaceZ(head, x, y);
    if (z === undefined || normal(head, [x, y, z])[2] < 0.6) break;
  }
  return x;
}

/** The lowest point of the chin under the middle of the mouth. */
function chinBottom(head: Sdf, from: number, u: number) {
  let y = from;
  while (y < from + u * 1.5 && surfaceZ(head, 0, y + u * 0.02) !== undefined) y += u * 0.02;
  return y;
}

/** Eye half height (as drawn). */
const m_ry = (u: number) => u * 0.235;

/**
 * `mirror`: the body's own left and right swapped for the asymmetric details (a breast pocket, a
 * side part, something behind an ear) — drawn for a character facing left (the rig is mirrored, so
 * the details land back on the same side of the body).
 */
/** The style's settings from `CartoonOptions.style`. */
function styleOf(style: CartoonOptions["style"]): Required<CartoonStyle> {
  const base: Required<CartoonStyle> = { ink: "", shade: true, line: undefined as unknown as number, limbs: "tapered", hands: "fist", eyes: "oval", posture: "upright", proportions: "normal" };
  if (style === "flat") return { ink: "#1b1b1b", shade: false, line: 2.4, limbs: "tube", hands: "open", eyes: "wide", posture: "slouch", proportions: "bigHead" };
  if (!style || style === "painted") return base;
  return { ...base, ...style };
}

/** A look's anatomy as a style draws it: wide eyes closer together with dot pupils, a bigger head. */
export function styledAnatomy(a: CartoonAnatomy, style: CartoonOptions["style"], look?: CartoonLook): CartoonAnatomy {
  const st = styleOf(style);
  const out: CartoonAnatomy = { ...a, body: { ...a.body }, face: { ...a.face } };
  if (st.eyes === "wide") {
    out.face.eye = [r(a.face.eye[0] * 1.25), r(a.face.eye[1] * 1.2)];
    out.face.eyeX = r(Math.max(a.face.eyeX * 0.93, out.face.eye[0] + 0.045));
    out.face.pupil = r(a.face.pupil * 0.6);
  }
  if (st.proportions === "bigHead") out.body.head = r(a.body.head * (["baby", "child", "kid"].includes(look?.build ?? "") ? 1.12 : 1.06));
  return out;
}

function model(look: CartoonLook, mirror = false, a: CartoonAnatomy = cartoonAnatomy(look), style: Required<CartoonStyle> = styleOf(undefined)): Model {
  const shade = style.shade;
  const M = mirror ? -1 : 1;
  const A = a.body, F = a.face;
  const b: Build = { L: A.hip, T: A.torso, n: A.neck, u: A.head, S: A.shoulders, W: A.waist, H: A.hips, D: A.depth, arm: a.limbs.arm, leg: a.limbs.leg, hand: a.limbs.hand, shoe: a.limbs.shoe, eye: F.eye[1] / 0.235 };
  const heavy = look.heavy ?? 0;
  const u = b.u;
  const L = b.L, T = b.T;
  const W = b.W * (look.female ? 0.86 : 1) + heavy * b.W * 0.35;
  const H = b.H * (look.female ? 1.04 : 1) + heavy * b.H * 0.2;
  const hip = -L, waist = -L - T * 0.1, torsoTop = -L - T, shoulder = torsoTop + T * 0.1;
  const neckTop = torsoTop - b.n;
  const hy = neckTop - u * 0.92;
  const eye = { x: u * F.eyeX, rx: u * F.eye[0], ry: u * F.eye[1] };
  const ey = hy + u * F.eyeY;
  const y = {
    hip, waist, shoulder, torsoTop, neckTop, head: hy, eye: ey, brow: ey - eye.ry - u * F.brow,
    nose: hy + u * F.noseY, mouth: hy + u * F.mouthY, ear: hy + u * F.earY, top: hy - u * 1.14,
  };

  // Head: a cranium and a face (jaw), blended (its ellipsoids kept: the head's occluder).
  const headParts: [V3, V3][] = [];
  const hell = (c: V3, rad: V3) => (headParts.push([c, rad]), ellipsoid(c, rad));
  const cranium = hell([0, hy - u * 0.12, -u * 0.08], [u, u * 1.02, u]);
  const jaw = look.jaw ?? "round";
  const face =
    jaw === "square" ? blend(u * 0.18, hell([0, hy + u * 0.42, u * 0.1], [u * 0.86, u * 0.7, u * 0.8]), hell([-u * 0.46, hy + u * 0.74, u * 0.02], [u * 0.36, u * 0.32, u * 0.5]), hell([u * 0.46, hy + u * 0.74, u * 0.02], [u * 0.36, u * 0.32, u * 0.5]), hell([0, hy + u * 0.92, u * 0.32], [u * 0.36, u * 0.24, u * 0.36]))
      : jaw === "pointy" ? blend(u * 0.2, hell([0, hy + u * 0.42, u * 0.1], [u * 0.74, u * 0.7, u * 0.76]), hell([0, hy + u * 0.9, u * 0.3], [u * 0.24, u * 0.24, u * 0.3]))
        : jaw === "chubby" ? hell([0, hy + u * 0.42, u * 0.1], [u * 0.94, u * 0.72, u * 0.86])
          : hell([0, hy + u * 0.42, u * 0.1], [u * 0.8, u * 0.72, u * 0.8]);
  const skullFace = blend(u * 0.3, cranium, face);
  // A nose with volume (it catches the light and casts a shadow), on the face.
  const zn = surfaceZ(skullFace, 0, y.nose) ?? u * 0.8;
  const noseKind = look.nose ?? "button";
  // (A long nose has a bridge up from its tip.)
  const ns: V3 = [u * F.nose[0], u * F.nose[1], u * F.nose[2]];
  const tip = ellipsoid([0, y.nose, zn + u * F.noseOut], ns);
  const nose = noseKind === "long" ? blend(u * 0.06, ellipsoid([0, y.nose - u * 0.16, zn], [ns[0] * 0.78, u * 0.26, ns[2]]), tip) : tip;
  const head = blend(u * 0.05, skullFace, nose);
  const ears = union(ellipsoid([-u * 0.98, y.ear, -u * 0.06], [u * 0.17, u * 0.3, u * 0.23]), ellipsoid([u * 0.98, y.ear, -u * 0.06], [u * 0.17, u * 0.3, u * 0.23]));

  // Hair.
  const skull = skullFace;
  const shell = (g: number) => grow(skull, g);
  /** Hairline: `front` at the middle of the forehead, lower by `temple` at the sides, `back` at the nape. */
  const line = (front: number, temple: number, back: number) => (x: number, z: number) => {
    const f = front + temple * Math.min(1, (x / u) ** 2);
    const s = smoothstep(u * 0.35, -u * 0.45, z);
    return f * (1 - s) + back * s;
  };
  const accent = (inside: Sdf) => (p: V3) => (inside(p[0], p[1], p[2]) < 0 ? "accent" : "hair");
  let hair: Sdf;
  let hairColor: (p: V3) => string = () => "hair";
  let tail: Model["tail"];
  switch (look.hair) {
    case "bowl": {
      // A bowl cut: a round cap cut straight at the brows, a little lower at the back.
      const cap = blend(u * 0.2, shell(u * 0.12), ellipsoid([0, hy - u * 0.5, -u * 0.05], [u * 1.16, u * 0.78, u * 1.14]));
      hair = above(cap, (x, z) => y.brow - u * 0.1 + u * 0.85 * smoothstep(u * 0.45, -u * 0.5, z));
      break;
    }
    case "sidePart": {
      const quiff = ellipsoid([-M * u * 0.22, hy - u * 0.92, u * 0.22], [u * 0.8, u * 0.34, u * 0.74]);
      hair = above(blend(u * 0.15, shell(u * 0.1), quiff), line(hy - u * 0.56, u * 0.4, hy + u * 0.45));
      break;
    }
    case "afro":
      hair = above(union(shell(u * 0.06), bumpy(sphere([0, hy - u * 0.4, -u * 0.15], u * 1.42), u * 0.05, u * 0.34)), line(hy - u * 0.52, u * 0.55, hy + u * 0.55));
      break;
    case "puffs": {
      const puff = (s: number) => bumpy(sphere([s * u * 0.82, hy - u * 0.92, -u * 0.12], u * 0.5), u * 0.04, u * 0.25);
      const ties = union(ellipsoid([-u * 0.6, hy - u * 0.62, -u * 0.05], [u * 0.2, u * 0.12, u * 0.22]), ellipsoid([u * 0.6, hy - u * 0.62, -u * 0.05], [u * 0.2, u * 0.12, u * 0.22]));
      hair = union(above(shell(u * 0.07), line(hy - u * 0.56, u * 0.4, hy + u * 0.42)), puff(-1), puff(1), ties);
      hairColor = accent(ties);
      break;
    }
    case "ponytail": {
      const fringe = above(intersect(ellipsoid([u * 0.1, hy - u * 0.62, u * 0.5], [u * 0.88, u * 0.4, u * 0.56]), shell(u * 0.14)), () => y.brow + u * 0.04);
      const fall = blend(u * 0.2, capsule([0, hy - u * 0.62, -u * 1.02], [0, hy + u * 0.2, -u * 1.5], u * 0.3, u * 0.24), capsule([0, hy + u * 0.2, -u * 1.5], [0, hy + u * 1.35, -u * 1.38], u * 0.24, u * 0.08));
      const tie = ellipsoid([0, hy - u * 0.62, -u * 1.0], [u * 0.3, u * 0.18, u * 0.3]);
      hair = union(above(shell(u * 0.08), line(hy - u * 0.56, u * 0.42, hy + u * 0.45)), fringe);
      tail = { sdf: union(fall, tie), color: accent(tie), pivot: [0, hy - u * 0.62, -u * 1.0], end: [0, hy + u * 1.35, -u * 1.38] };
      break;
    }
    case "long": {
      const fall = intersect(taper(hy - u * 0.4, hy + u * 2.1, [u * 1.1, u * 1.05], [u * 1.04, u * 0.6], -u * 0.32), (x, yy, z) => z - u * 0.3);
      const fringe = above(intersect(ellipsoid([0, hy - u * 0.62, u * 0.5], [u * 0.9, u * 0.4, u * 0.56]), shell(u * 0.14)), () => y.brow + u * 0.02);
      hair = union(above(shell(u * 0.1), line(hy - u * 0.56, u * 0.4, hy + u * 0.6)), fall, fringe);
      break;
    }
    case "perm":
      hair = above(bumpy(ellipsoid([0, hy - u * 0.22, -u * 0.12], [u * 1.48, u * 1.36, u * 1.36]), u * 0.07, u * 0.3), line(hy - u * 0.55, u * 1.15, hy + u * 1.0));
      break;
    case "mullet": {
      const back = ellipsoid([0, hy + u * 0.7, -u * 0.72], [u * 0.78, u * 1.0, u * 0.42]);
      hair = union(above(shell(u * 0.11), line(hy - u * 0.6, u * 0.4, hy + u * 0.5)), back);
      break;
    }
    case "buzz":
      hair = above(shell(u * 0.045), line(hy - u * 0.62, u * 0.32, hy + u * 0.5));
      if (look.hairLine) hairColor = (p) => (M * p[0] < -u * 0.5 && Math.abs(p[1] - (hy - u * 0.42 + (p[2] / u) * u * 0.12)) < u * 0.035 ? "skin" : "hair");
      break;
    case "receding": {
      // Receding at the temples (an M-shaped hairline), a little tuft left in front.
      const tuft = ellipsoid([u * 0.05, hy - u * 0.82, u * 0.55], [u * 0.22, u * 0.14, u * 0.2]);
      hair = union(above(shell(u * 0.07), (x, z) => {
        const f = hy - u * 0.5 - u * 0.32 * Math.min(1, (x / (u * 0.55)) ** 2) * smoothstep(-u * 0.1, u * 0.5, z);
        const s = smoothstep(u * 0.2, -u * 0.5, z);
        return f * (1 - s) + (hy + u * 0.45) * s;
      }), intersect(tuft, shell(u * 0.12)));
      break;
    }
    case "slick":
      // Combed straight back with gel: smooth, a little volume on top.
      hair = above(blend(u * 0.2, shell(u * 0.08), intersect(ellipsoid([0, hy - u * 0.72, -u * 0.12], [u * 1.04, u * 0.5, u * 1.08]), shell(u * 0.2))), line(hy - u * 0.62, u * 0.32, hy + u * 0.45));
      break;
    case "bob": {
      // A bob: straight to the jaw, a straight fringe.
      const fall = intersect(taper(hy - u * 0.4, hy + u * 0.92, [u * 1.12, u * 1.08], [u * 1.06, u * 0.86], -u * 0.2), (x, yy, z) => z - u * 0.32);
      const fringe = above(intersect(ellipsoid([0, hy - u * 0.62, u * 0.5], [u * 0.92, u * 0.42, u * 0.58]), shell(u * 0.15)), () => y.brow + u * 0.03);
      hair = union(above(blend(u * 0.2, shell(u * 0.12), ellipsoid([0, hy - u * 0.62, -u * 0.05], [u * 1.2, u * 0.7, u * 1.18])), line(hy - u * 0.56, u * 0.4, hy + u * 0.8)), fall, fringe);
      break;
    }
    case "curtains": {
      // Parted in the middle, two curtains over the forehead (a curtained haircut).
      const curtain = (s: number) => intersect(ellipsoid([s * u * 0.46, hy - u * 0.5, u * 0.55], [u * 0.5, u * 0.44, u * 0.42]), shell(u * 0.14), (x, yy) => yy - (y.eye - m_ry(u)), (x) => -s * x + u * 0.03);
      hair = union(above(blend(u * 0.2, shell(u * 0.1), ellipsoid([0, hy - u * 0.6, -u * 0.1], [u * 1.12, u * 0.6, u * 1.12])), line(hy - u * 0.62, u * 0.3, hy + u * 0.62)), curtain(-1), curtain(1));
      break;
    }
    case "spiky": {
      // Spiked up with gel.
      const spikes: Sdf[] = [];
      for (let i = 0; i < 9; i++) {
        const a = ((-70 + (i * 140) / 8) * Math.PI) / 180, b2 = i % 3;
        const base: V3 = [Math.sin(a) * u * 0.62, hy - u * 0.82, (b2 - 1) * u * 0.38];
        spikes.push(capsule(base, [base[0] * 1.35, hy - u * (1.42 + (i % 2) * 0.1), base[2] * 1.3 + u * 0.05], u * 0.17, u * 0.02));
      }
      hair = blend(u * 0.04, above(shell(u * 0.08), line(hy - u * 0.62, u * 0.35, hy + u * 0.45)), ...spikes);
      break;
    }
    case "bald":
      hair = intersect(shell(u * 0.08), (x, yy, z) => hy - u * 0.32 - yy, (x, yy) => yy - (hy + u * 0.42), (x, yy, z) => z - u * 0.05);
      break;
    case "bun": {
      const bun = sphere([0, hy - u * 0.98, -u * 0.55], u * 0.42);
      hair = union(above(shell(u * 0.06), line(hy - u * 0.6, u * 0.4, hy + u * 0.42)), bun);
      break;
    }
    case "braids": {
      const braids: Sdf[] = [];
      for (let i = 0; i < 9; i++) {
        const a = ((70 + (i * 220) / 8) * Math.PI) / 180;
        braids.push(capsule([Math.sin(a) * u * 0.92, hy - u * 0.32, Math.cos(a) * u * 0.92], [Math.sin(a) * u * 1.08, hy + u * 1.55, Math.cos(a) * u * 0.62 - u * 0.25], u * 0.09));
      }
      hair = union(above(shell(u * 0.06), line(hy - u * 0.58, u * 0.42, hy + u * 0.42)), ...braids);
      hairColor = (p) => (p[1] > hy + u * 1.3 ? "accent" : "hair");
      break;
    }
    case "rollers": {
      const rollers = [-0.5, 0, 0.5].map((x) => capsule([x * u - u * 0.18, hy - u * 1.12, -u * 0.15], [x * u + u * 0.18, hy - u * 1.12, -u * 0.15], u * 0.17));
      const sides = [-1, 1].map((s) => capsule([s * u * 0.92, hy - u * 0.62, -u * 0.25], [s * u * 0.92, hy - u * 0.62, u * 0.15], u * 0.15));
      const all = union(...rollers, ...sides);
      hair = union(above(shell(u * 0.06), line(hy - u * 0.58, u * 0.45, hy + u * 0.45)), all);
      hairColor = accent(grow(all, 0.5));
      break;
    }
    case "tuft": {
      const tufts = [-0.35, 0, 0.32].map((x, i) => capsule([x * u, hy - u * 0.95, u * 0.2], [x * u * 1.4 + u * 0.08, hy - u * (1.48 + (i % 2) * 0.1), u * 0.38], u * 0.16, u * 0.03));
      hair = blend(u * 0.05, above(shell(u * 0.07), line(hy - u * 0.6, u * 0.4, hy + u * 0.45)), ...tufts);
      break;
    }
  }

  // Below the brows, hair stays beside and behind the face (a perm frames it, never covers an eye).
  const styled = hair;
  hair = (x, yy, z) => Math.max(styled(x, yy, z), yy > y.brow ? z - u * 0.3 : -Infinity);
  const bulk = hair;
  if (look.hat) {
    // Hats sit on the hair: the crown over the skull, a peak (cap) or a short brim (flat cap).
    // Hats with a brim all round (top hat, bowler, cowboy): a crown on the skull, the brim a disc.
    // Each is made for the head as drawn (all in head radii): its bottom never below the forehead
    // line — just above the brows, wherever the face puts them (big eyes put them higher: the hat
    // sits higher on the head, the crown cut there) — the peak on the crown's front where it is cut.
    const brimmed = look.hat === "top" || look.hat === "bowler" || look.hat === "cowboy";
    const forehead = y.brow - u * 0.05;
    // Each hat's lowest edge for the default face (the crown's, the brim's) and how far the
    // forehead line lifts the hat.
    const bottom0 = hy - u * (look.hat === "flatCap" ? 0.26 : brimmed ? 0.55 : 0.32);
    const dy = Math.min(0, forehead - bottom0);
    const crownTop = hy - u * (look.hat === "top" ? 2.0 : look.hat === "cowboy" ? 1.55 : 1.35) + dy;
    const crown = look.hat === "flatCap"
      ? ellipsoid([0, hy - u * 0.72 + dy, u * 0.05], [u * 1.16, u * 0.46, u * 1.22])
      : look.hat === "top"
        ? box([0, (crownTop + hy - u * 0.62 + dy) / 2, -u * 0.02], [u * 0.78, (hy - u * 0.62 - crownTop + dy) / 2, u * 0.78], u * 0.12)
        : look.hat === "bowler"
          ? intersect(ellipsoid([0, hy - u * 0.75 + dy, -u * 0.02], [u * 1.02, u * 0.62, u * 1.02]), (x, yy) => yy - (hy - u * 0.58 + dy))
          : look.hat === "cowboy"
            ? intersect(ellipsoid([0, hy - u * 0.9 + dy, -u * 0.02], [u * 0.92, u * 0.7, u * 0.86]), (x, yy) => yy - (hy - u * 0.6 + dy))
            : intersect(grow(skull, u * 0.16), (x, yy) => yy - (hy - u * 0.32 + dy));
    const back = look.hat === "capBack" ? -1 : 1;
    const brimR = look.hat === "cowboy" ? u * 1.75 : look.hat === "top" ? u * 1.25 : u * 1.2;
    // How far the crown's front (back, for a cap turned back) stands out at a height, from the
    // default cap's at its peak: the peak moves with it.
    const standOut = (f: Sdf, yy: number) => back * (surfaceZ((x, y2, z) => f(x, y2, back * z), 0, yy) ?? u);
    const peakY = hy - u * 0.4 - (back < 0 ? u * 0.08 : 0) + dy;
    const out = look.hat === "cap" || look.hat === "capBack" ? standOut(crown, peakY) - standOut(intersect(grow(skull, u * 0.16), (x, yy) => yy - (hy - u * 0.32)), peakY - dy) : 0;
    const peak = brimmed
      ? (x: number, yy: number, z: number) => {
          // A cowboy brim curls up at the sides.
          const rr = Math.hypot(x, z + u * 0.02), curl = look.hat === "cowboy" ? Math.max(0, Math.abs(x) - u * 0.9) * 0.45 : 0;
          return Math.max(rr - brimR, Math.abs(yy - (hy - u * 0.6 + dy - curl)) - u * 0.05);
        }
      : look.hat === "flatCap"
        ? intersect(ellipsoid([0, hy - u * 0.5 + dy, u * 0.78], [u * 0.75, u * 0.08, u * 0.42]), (x, yy, z) => u * 0.6 - z)
        // (The peak cut where it would enter the head: in front of it, or behind it turned back.)
        : intersect(ellipsoid([0, peakY, back * u * 0.95 + out], [u * 0.66, u * 0.065, u * 0.62]), (x, yy, z) => u * 0.55 + back * out - back * z);
    const hat = union(crown, peak);
    const under = hair, prevColor = hairColor;
    hair = union(intersect(under, (x, yy, z) => -crown(x, yy, z) + 0.5), hat);
    hairColor = (p) => (hat(p[0], p[1], p[2]) < 0.6 ? (peak(p[0], p[1], p[2]) < 0.6 ? "hatDark" : "hat") : prevColor(p));
  }
  if (look.veil) {
    // A veil: a thin sheet from the top of the head, round the back, down past the shoulders.
    // Over the head it is a dome round the cranium as drawn (its section at each height, over the
    // hair), below its widest it flares out down the back.
    const [cc, cr] = headParts[0];
    const veilShell = (x: number, yy: number, z: number) => {
      const top = hy - u * 0.95, bottom = shoulder + T * 0.35, crown = cr[1] + u * 0.12;
      if (yy < cc[1] - crown || yy > bottom) return 1;
      const t = Math.max(0, (yy - top) / (bottom - top));
      const dome = (yy < cc[1] ? cr[0] * Math.sqrt(Math.max(0, 1 - ((yy - cc[1]) / crown) ** 2)) : cr[0] + (yy - cc[1]) * 0.6) + u * 0.12;
      const rad = Math.min(dome, u * (1.08 + t * 0.55)), cz = -u * (0.1 + t * 0.35);
      const d = Math.hypot(x, z - cz) - rad;
      return Math.max(Math.abs(d) - u * 0.03, z - (u * 0.35 - t * u * 0.6));
    };
    const under = hair, prev = hairColor;
    hair = union(under, veilShell);
    hairColor = (p) => (veilShell(p[0], p[1], p[2]) < 0.8 ? "veil" : prev(p));
  }
  if (look.earItem) {
    // Resting in the fold above the near ear; its tip (a filter, a sharpened point) towards the face.
    const pencil = look.earItem === "pencil";
    const a: V3 = [-M * u * 1.04, y.ear - u * 0.26, -u * 0.48], c: V3 = [-M * u * 1.0, y.ear - u * 0.38, u * (pencil ? 0.42 : 0.32)];
    const item = capsule(a, c, u * (pencil ? 0.055 : 0.05), u * (pencil ? 0.02 : 0.05));
    const styled2 = hair, prev = hairColor;
    hair = union(styled2, item);
    hairColor = (p) => (item(p[0], p[1], p[2]) < 0.6 ? (p[2] > u * (pencil ? 0.28 : 0.12) ? "earTip" : "earItem") : prev(p));
  }

  // Neck and torso (the pelvis is part of it: the trousers' top).
  const neckR = u * (look.build === "big" ? 0.5 : look.build === "man" ? 0.36 : 0.26) * (1 + heavy * 0.2) * (style.proportions === "bigHead" ? 0.85 : 1);
  const neck = capsule([0, torsoTop + 10, -b.D * 0.15], [0, hy + u * 0.55, -u * 0.12], neckR);
  // The shoulders: round caps the arms come out of (a blouse's puffed), or, with tube arms, flush
  // with the arm — no ball shoulders.
  const sh = style.limbs === "tube" ? b.arm[0] * 0.5 : look.top === "blouse" ? b.arm[0] * 1.05 : b.arm[0] * 0.75;
  const torso = blend(
    T * 0.12,
    ellipsoid([0, -L - T * 0.68, 0], [b.S, T * 0.36, b.D]),
    ellipsoid([0, -L - T * 0.32, heavy * b.D * 0.55], [W, T * 0.38, b.D * (1 + heavy * 0.6)]),
    ellipsoid([0, -L + T * 0.02, 0], [Math.max(W * 0.98, H * 0.95), T * 0.2, b.D * 0.92]),
    capsule([-b.S + sh * 0.6, shoulder, 0], [b.S - sh * 0.6, shoulder, 0], sh),
  );
  // Flat at the hip joints: the legs come out of it (no rounded "diaper" under the trousers).
  const body = torso;
  const torsoCut: Sdf = (x, yy, z) => Math.max(body(x, yy, z), yy - (-L + 5));
  const topKey = (p: V3): string => {
    const [x, yy, z] = p;
    const nearNeck = Math.hypot(x, z + b.D * 0.15) < neckR + 6 && yy < torsoTop + T * 0.14;
    switch (look.top) {
      case "stripes":
        if (nearNeck) return "topDark";
        return Math.floor((yy - torsoTop) / (T * (look.stripeWidth ?? 0.13))) % 2 ? "top2" : "top";
      case "jersey":
        if (nearNeck || (z > 0 && Math.abs(x) < (torsoTop + T * 0.24 - yy) * 0.5)) return "top2";
        return Math.floor((x + b.S * 2) / (b.S * 0.32)) % 2 ? "top2" : "top";
      case "polo":
        if (z > 0 && Math.abs(x) < neckR * 1.9 && yy < torsoTop + T * 0.16) return "top2";
        return "top";
      case "shirt":
        if (z > 0 && Math.abs(x) < neckR * 1.8 && yy < torsoTop + T * 0.14) return "top2";
        // The breast pocket is on the wearer's left.
        if (z > 0 && M * x > b.S * 0.22 && M * x < b.S * 0.62 && yy > -L - T * 0.76 && yy < -L - T * 0.56) return "pocket";
        return "top";
      case "tank":
        if (Math.abs(x) > b.S * 0.56 && yy < shoulder + T * 0.24) return "skin";
        if (Math.abs(x) < b.S * 0.3 && yy < torsoTop + T * 0.22 && z > 0) return "skin";
        return "top";
      case "overalls":
        if (yy > -L - T * 0.5 && (z > 0 ? Math.abs(x) < b.S * 0.56 : Math.abs(x) < b.S * 0.6)) return "bottom";
        if (Math.abs(Math.abs(x) - b.S * 0.42) < b.S * 0.1) return "bottom";
        return nearNeck ? "topDark" : "top";
      case "blazer": {
        // A closed suit jacket: a V opening showing the shirt, lapels along it.
        const v = (yy - torsoTop) * 0.34 + neckR * 0.6;
        if (z > 0 && yy < torsoTop + T * 0.55 && Math.abs(x) < v) return "top";
        if (z > 0 && yy < torsoTop + T * 0.6 && Math.abs(x) < v + b.S * 0.16) return "lapel";
        return "top2";
      }
      case "jacket":
      case "cardigan":
        return z > 0 && Math.abs(x) < b.S * 0.28 ? (nearNeck ? "topDark" : "top") : "top2";
      default:
        return nearNeck ? "topDark" : "top";
    }
  };
  const period = b.S * 0.17;
  const printed = (p: V3, k: string) => {
    if (k !== "top" || !look.pattern) return k;
    const [x, yy] = p;
    // Vertical stripes follow the cloth around the body (the angle around it), not straight x.
    const around = Math.atan2(x, p[2] + b.D * 0.2) * b.S * 0.9 + b.S * 4;
    if (look.pattern === "pinstripes") return Math.abs((around % period) - period / 2) < period * 0.13 ? "stripe" : k;
    if (look.pattern === "stripes") return Math.floor((yy - torsoTop) / (T * (look.stripeWidth ?? 0.13))) % 2 ? "stripe" : k;
    if (look.pattern === "polka") {
      // Dots on a grid around the body (every other row shifted).
      const row = Math.floor((yy - torsoTop) / (period * 1.6)), ax = around + (row % 2) * period * 0.8;
      const cx = (Math.floor(ax / (period * 1.6)) + 0.5) * period * 1.6, cy = torsoTop + (row + 0.5) * period * 1.6;
      return Math.hypot(ax - cx, yy - cy) < period * 0.42 ? "stripe" : k;
    }
    return (Math.floor(around / period) + Math.floor((yy - torsoTop) / period)) % 2 ? "stripe" : k;
  };
  // Something in the pocket: the part inside is covered by the pocket.
  const pocketTop = -L - T * 0.76, pocketX = M * b.S * 0.42;
  const pz = look.pocketItem ? (surfaceZ(torso, pocketX, pocketTop + T * 0.06) ?? b.D) : 0;
  const item = look.pocketItem ? box([pocketX, pocketTop + T * 0.035, pz + b.S * 0.03], [b.S * 0.15, T * 0.085, b.S * 0.045], 1.5) : undefined;
  // A sweater over the shoulders: around the back, the sleeves knotted on the chest.
  const sweater = look.sweater
    ? union(
        capsule([-b.S * 0.95, shoulder - T * 0.02, -b.D * 0.35], [b.S * 0.95, shoulder - T * 0.02, -b.D * 0.35], T * 0.1),
        capsule([-b.S * 0.85, shoulder, b.D * 0.2], [-b.S * 0.1, torsoTop + T * 0.32, b.D * 1.05], T * 0.065),
        capsule([b.S * 0.85, shoulder, b.D * 0.2], [b.S * 0.1, torsoTop + T * 0.32, b.D * 1.05], T * 0.065),
        sphere([0, torsoTop + T * 0.33, b.D * 1.08], T * 0.075),
      )
    : undefined;
  const extras = (p: V3, k: string): string => {
    const [x, yy, z] = p;
    if (sweater && sweater(x, yy, z) < 0.8) return "sweater";
    if (look.tie && z > 0 && yy > torsoTop + T * 0.06 && yy < -L - T * 0.12) {
      const w = yy < torsoTop + T * 0.13 ? b.S * 0.07 : b.S * (0.06 + 0.06 * Math.min(1, (yy - torsoTop) / T));
      if (Math.abs(x) < w && k !== "top2" && k !== "lapel") return "tie";
    }
    if (look.necklace) {
      const d = Math.hypot(x, (z + b.D * 0.15) * 0.9);
      if (yy < torsoTop + T * 0.2 && d > neckR + 2 && d < neckR + 7 && z > -b.D * 0.3) {
        if (look.necklace.kind === "chain") return "jewel";
        return Math.floor(Math.atan2(x, z + b.D) * 14 + 100) % 2 ? "jewel" : k;
      }
    }
    if (look.suspenders && yy > torsoTop + T * 0.04 && Math.abs(Math.abs(x) - b.S * 0.42 - (yy - torsoTop) * 0.06) < b.S * 0.075) return "strap";
    return k;
  };
  // A flower in the lapel (the wearer's left, over the heart).
  const flower = (p: V3) => look.boutonniere && p[2] > 0 && Math.hypot(M * p[0] - b.S * 0.48, p[1] - (-L - T * 0.8)) < b.S * 0.11;
  const torsoColor = (p: V3): string => (flower(p) ? "flower" : extras(p, torsoBase(p)));
  const torsoBase = (p: V3): string => {
    if (item && item(p[0], p[1], p[2]) < 0.8) return p[1] > pocketTop ? "pocket" : p[1] < pocketTop - T * 0.032 ? "band" : "item";
    if (look.apron && p[2] > 0 && Math.abs(p[0]) < b.S * 0.72 && p[1] > torsoTop + T * 0.28) return "apron";
    if (look.top !== "dress" && p[1] > waist + heavy * T * 0.16) return "bottom";
    return printed(p, topKey(p));
  };

  // Skirts and dresses (on the hips).
  let skirt: Sdf | undefined, skirtColor: ((p: V3) => string) | undefined;
  const hem = look.bottom === "longSkirt" ? -L * 0.16 : -L * 0.5;
  if (look.bottom === "skirt" || look.bottom === "longSkirt") {
    skirt = taper(waist - 4, hem, [Math.max(W, H) * 1.08, b.D * 1.06], [H * 1.5 + 10, b.D * 1.5], heavy * b.D * 0.3);
    skirtColor = () => (look.top === "dress" ? "top" : "bottom");
  }
  if (look.apron) {
    const panel = intersect(taper(waist - 2, -L * 0.42, [W * 1.08, b.D * 1.06 + heavy * 6], [H * 1.2, b.D * 1.1], heavy * b.D * 0.4), (x, yy, z) => -z + 2);
    skirt = skirt ? union(skirt, panel) : panel;
    const prev = skirtColor;
    skirtColor = (p) => (p[2] > 4 ? "apron" : prev ? prev(p) : "bottom");
  }
  // Face colours: a rosy nose and cheeks, a shadow of beard.
  const headColor = (p: V3): string => {
    const [x, yy, z] = p;
    if (look.flushed && (nose(x, yy, z) < u * 0.02 || (z > 0 && Math.hypot(Math.abs(x) - u * 0.48, yy - (y.eye + u * 0.42)) < u * 0.17))) return "flush";
    // Stubble: the chin and jaw below the mouth and the upper lip — not the cheeks.
    if (look.stubble && z > -u * 0.1 && nose(x, yy, z) > u * 0.02 && (yy > y.mouth + u * 0.1 || (yy > y.nose + u * 0.16 && yy < y.mouth - u * 0.06 && Math.abs(x) < u * 0.34))) return "stubble";
    return "skin";
  };
  return { shade, sh, style, b, y, head, headParts, headColor, ears, nose, hair, bulk, hairColor, tail, torsoItem: item, bouncy: ["perm", "afro", "puffs", "long", "braids"].includes(look.hair), veil: !!look.veil, neck, neckR, torso: union(torsoCut, ...(item ? [item] : []), ...(sweater ? [sweater] : [])), torsoColor, skirt, skirtColor, eye, mouthW: Math.min(u * F.mouthW, frontHalf(head, y.mouth, u) * 0.82), mouthMargin: F.mouthMargin, pupil: F.pupil, chinRoom: chinBottom(head, y.mouth, u) - y.mouth - u * 0.1 };
}

/**
 * The torso as a hand keeps out of it (body space, at rest): an ellipsoid over the trunk from the
 * chest to the hips, as wide and deep as the torso is drawn below the shoulders (a belly, wide hips,
 * a sweater, something in the pocket), grown by `margin`.
 */
function torsoKeepOut(m: Model, margin: number): [V3, V3] {
  const { b } = m;
  const top = m.y.torsoTop + b.T * 0.2, bottom = m.y.hip;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const sx = b.S / 30, sz = b.D / 20;
  for (let yy = top; yy <= bottom; yy += b.T / 16)
    for (let x = -b.S * 2.5; x <= b.S * 2.5; x += sx)
      for (let z = -b.D * 3; z <= b.D * 3; z += sz)
        if (m.torso(x, yy, z) < 0) (x0 = Math.min(x0, x), x1 = Math.max(x1, x), z0 = Math.min(z0, z), z1 = Math.max(z1, z));
  return [[(x0 + x1) / 2, m.y.hip - b.T * 0.48, (z0 + z1) / 2], [(x1 - x0) / 2 + margin, b.T * 0.56, (z1 - z0) / 2 + margin]];
}

/**
 * The head as a hand keeps out of it (body space, at rest): the cranium with the hair's bulk round it
 * — one ellipsoid fitted to both (the hair above the jaw: a fall down the back does not count), a
 * little bigger where the box's corners leave hair out (at most 5 %) — then the face's own
 * ellipsoids (jaw, chin), each grown by `margin` (a hand's half thickness). Built from the model, so
 * it is the head as drawn for any anatomy (a big head, a perm, a bun).
 */
function headKeepOut(m: Model, margin: number): [V3, V3][] {
  const u = m.b.u;
  const [[cc, cr], ...face] = m.headParts;
  const limit = cc[1] + cr[1] * 0.5;
  let x0 = cc[0] - cr[0], x1 = cc[0] + cr[0], y0 = cc[1] - cr[1], z0 = cc[2] - cr[2], z1 = cc[2] + cr[2];
  const y1 = cc[1] + cr[1];
  const hair: V3[] = [];
  const step = u / 10;
  for (let yy = cc[1] - u * 2.6; yy <= limit; yy += step)
    for (let x = -u * 2.2; x <= u * 2.2; x += step)
      for (let z = -u * 2.2; z <= u * 2.2; z += step) {
        if (m.bulk(x, yy, z) >= 0) continue;
        hair.push([x, yy, z]);
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, yy); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
      }
  const c: V3 = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], rad: V3 = [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2];
  let k = 1;
  for (const p of hair) k = Math.max(k, Math.hypot((p[0] - c[0]) / rad[0], (p[1] - c[1]) / rad[1], (p[2] - c[2]) / rad[2]));
  k = Math.min(k, 1.05);
  const grown = (r3: V3, s = 1): V3 => [r3[0] * s + margin, r3[1] * s + margin, r3[2] * s + margin];
  return [[c, grown(rad, k)], ...face.map(([fc, fr]): [V3, V3] => [fc, grown(fr)])];
}

// ------------------------------------------------------------------ drawing a view


/** Light from the upper left, in front (view space). */
const LIGHT: V3 = (() => {
  const v: V3 = [-0.5, -0.62, 0.6];
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
})();
/** Cel shading: surfaces turned away from the light more than this are in shadow. */
const SHADE_AT = -0.02;

export interface PieceOpts {
  sdf: Sdf;
  theta: ViewLike;
  /** Colour region of a surface point (palette key), else `base`. */
  color?: (p: V3) => string;
  base: string;
  /** Regions outlined with a thin line (collars, pockets…). */
  edges?: string[];
  /** Silhouette field to use instead of the cast's (a piece seen only where it is in front). */
  field?: ArrayLike<number>;
  /** Extra shadow on a cell (cast shadows: under the hair, under the chin). */
  shadow?: (cell: number) => boolean;
  /** Draw the outline only where this holds (cells). */
  keep?: (i: number, j: number) => boolean;
  /** Palette key of the outline (default: `base`). */
  line?: string;
  /** Scale of the shading: normals averaged over this distance (curls shade as one mass). */
  smooth?: number;
  /** Cel shadows drawn (default true; false: flat colour). */
  shade?: boolean;
}

/**
 * A volume drawn flat, the way a cartoon is painted: the fill, its colour regions, cel shading
 * (the side turned away from the light, cast shadows) and an outline in a dark tone of its colour.
 */
export function piece(c: Cast, g: Grid, o: PieceOpts): string {
  const field = o.field ?? c.val;
  const outline = fieldPath(field, g);
  if (!outline) return "";
  const n = g.w * g.h;
  const key: string[] = new Array(n);
  const light = new Float32Array(n).fill(1);
  const keys = new Set<string>([o.base]);
  for (let i = 0; i < n; i++) {
    if (field[i] > 0 || Number.isNaN(c.hit[i * 3])) continue;
    const p: V3 = [c.hit[i * 3], c.hit[i * 3 + 1], c.hit[i * 3 + 2]];
    key[i] = o.color ? o.color(p) : o.base;
    keys.add(key[i]);
    const nm = normal(o.sdf, p, o.smooth);
    const [nx, ny, nz] = toCam(nm, o.theta);
    light[i] = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2] - SHADE_AT;
    if (o.shadow?.(i)) light[i] = Math.min(light[i], -0.3);
  }
  let out = `<path d="${outline}" fill="palette(${o.base})" fill-rule="evenodd"/>`;
  for (const k of keys) {
    if (k === o.base) continue;
    const mask = new Float32Array(n);
    for (let i = 0; i < n; i++) mask[i] = key[i] === k ? -1 : 1;
    const d = fieldPath(mask, g, 4);
    if (d) out += `<path d="${d}" fill="palette(${k})" fill-rule="evenodd"${o.edges?.includes(k) ? ` ${stc(k, 1.8)}` : ""}/>`;
  }
  // Shadows, region by region (a smooth terminator: the lighting is a continuous field).
  for (const k of o.shade === false ? [] : keys) {
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++) f[i] = key[i] === k ? light[i] * 20 : 1;
    const d = fieldPath(f, g, 6);
    if (d) out += `<path d="${d}" fill="palette(${k.endsWith("Shade") ? k : `${k}Shade`})" fill-rule="evenodd"/>`;
  }
  const line = o.line ?? o.base;
  if (o.keep) {
    const d = strokeWhere(field, g, o.keep);
    return out + (d ? `<path d="${d}" fill="none" ${stc(line)}/>` : "");
  }
  return out + `<path d="${outline}" fill="none" fill-rule="evenodd" ${stc(line)}/>`;
}

/** Open outline pieces of a field, keeping only points where `keep` holds. */
function strokeWhere(val: ArrayLike<number>, g: Grid, keep: (i: number, j: number) => boolean): string {
  let d = "";
  for (const loop of contours(val, g.w, g.h)) {
    const n = loop.length;
    const ok = loop.map(([i, j]) => keep(Math.round(i), Math.round(j)));
    if (ok.every(Boolean)) {
      d += " " + curvePath(loop.map(([i, j]) => [g.x0 + i * g.step, g.y0 + j * g.step] as P2), g.step, true);
      continue;
    }
    const start = ok.indexOf(false);
    let run: P2[] = [];
    const flush = () => {
      if (run.length > 3) d += " " + curvePath(run, g.step, false);
      run = [];
    };
    for (let s = 1; s <= n; s++) {
      const i = (start + s) % n;
      if (ok[i]) run.push([g.x0 + loop[i][0] * g.step, g.y0 + loop[i][1] * g.step]);
      else flush();
    }
    flush();
  }
  return d.trim();
}

interface HeadView {
  hairBack: string;
  earsBack: string;
  head: string;
  earsFront: string;
  hairFront: string;
  /** A ponytail behind the head (most views) or in front of it (seen from behind). */
  tailBack: string;
  tailFront: string;
  /** The nose again, drawn over the mouth: in a three-quarter view it hides the mouth's far corner. */
  noseOver: string;
  /** Screen bounds of everything drawn (for the measurements). */
  bounds: [number, number, number, number];
}

function headView(m: Model, vw: View): HeadView {
  const theta = vw.yaw;
  const u = m.b.u;
  const box: Box3 = { x: [-u * 2, u * 2], y: [m.y.top - u * 0.9, m.y.head + u * (m.veil ? 3.6 : 2.4)], z: [-u * 1.9, u * 1.6] };
  const g = gridFor([box], vw, u / 26);
  const head = cast(m.head, g, vw), hair = cast(m.hair, g, vw), ears = cast(m.ears, g, vw);
  const n = g.w * g.h;
  // In front of the head: hair nearer than the face (spilling a little past its outline, so the
  // head's outline does not show through), and ears that stick out of the face (3/4 view).
  const front = new Float32Array(n), earF = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // Head and ears together: what the hair can be in front of.
    const hv = Math.min(head.val[i], ears.val[i]), hd = Math.max(head.depth[i], ears.depth[i]);
    const both = hv < 0 && hair.val[i] < 0;
    front[i] = Math.max(hair.val[i], hv - 3.2, both ? hd - hair.depth[i] : -Infinity);
    // (Depths only where the rays hit: a miss is −Infinity, and a difference with it would be
    // ±Infinity — not a field value the outline can be traced through.)
    earF[i] = ears.val[i] < 0 ? Math.max(ears.val[i], head.val[i] < 0 ? head.depth[i] - ears.depth[i] : 1, hair.val[i] < 0 ? hair.depth[i] - ears.depth[i] : -Infinity) : ears.val[i];
  }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let j = 0; j < g.h; j++)
    for (let i = 0; i < g.w; i++) {
      const k = j * g.w + i;
      if (head.val[k] < 0 || hair.val[k] < 0 || ears.val[k] < 0) {
        const X = g.x0 + i * g.step, Y = g.y0 + j * g.step;
        x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
      }
    }
  const at = (arr: ArrayLike<number>, i: number, j: number) => arr[Math.max(0, Math.min(g.h - 1, j)) * g.w + Math.max(0, Math.min(g.w - 1, i))];
  // Cast shadows on the face: under the front hair (the light comes from above, a little left).
  const drop = Math.round((u * 0.12) / g.step), side = Math.round((u * 0.04) / g.step);
  const underHair = (k: number) => {
    const i = k % g.w, j = Math.floor(k / g.w);
    for (let d = 1; d <= drop; d++) if (at(front, i - Math.round((side * d) / drop), j - d) < 0) return true;
    return false;
  };
  // A jump in depth: where the nose stands out of the face (outlined there, like a drawn nose).
  const jump = (i: number, j: number) => {
    let d = 0;
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0]]) d = Math.max(d, Math.abs(at(head.depth, i + a, j + b) - at(head.depth, i, j)));
    return d > g.step * 2;
  };
  // The nose as its own layer over the mouth (filled and shaded like the face, outlined only where
  // it stands out), so the far corner of a mouth seen from three-quarters goes behind it.
  const noseVal = new Float32Array(n).fill(1);
  if (m.nose && theta < 1.6)
    for (let i = 0; i < n; i++) if (head.val[i] < 0 && !Number.isNaN(head.hit[i * 3])) noseVal[i] = m.nose(head.hit[i * 3], head.hit[i * 3 + 1], head.hit[i * 3 + 2]) - u * 0.015;
  // (Over the hair too: hair at the side of the face never hides the nose.)
  const noseOver = m.nose && theta < 1.6 ? piece(head, g, { shade: m.shade, sdf: m.head, theta: vw, color: m.headColor, base: "skin", field: noseVal, keep: (i, j) => jump(i, j) && at(noseVal, i, j) < u * 0.02 }) : "";
  const tailArt = m.tail ? piece(cast(m.tail.sdf, g, vw), g, { shade: m.shade, sdf: m.tail.sdf, theta: vw, color: m.tail.color, base: "hair", edges: ["accent"] }) : "";
  const tailInFront = !!m.tail && depthOf(m.tail.pivot, vw) > depthOf([0, m.y.head, 0], vw) + u * 0.2;
  // The front hair's outline is drawn against the face only, not where it meets the hair behind.
  const keepHair = (i: number, j: number) => !(at(hair.val, i, j) < -2 && at(head.val, i, j) > -1.5) && !(at(hair.val, i + 1, j) < -2 && at(hair.val, i - 1, j) < -2 && at(hair.val, i, j + 1) < -2 && at(hair.val, i, j - 1) < -2 && at(head.val, i, j) > -4);
  return {
    hairBack: piece(hair, g, { shade: m.shade, sdf: m.hair, theta: vw, color: m.hairColor, base: "hair", edges: ["accent", "earItem", "earTip", "hat", "hatDark"], smooth: u * 0.18 }),
    earsBack: piece(ears, g, { shade: m.shade, sdf: m.ears, theta: vw, base: "skin" }),
    head: piece(head, g, { shade: m.shade, sdf: m.head, theta: vw, color: m.headColor, base: "skin", shadow: underHair }),
    noseOver,
    earsFront: theta > 0.2 && theta < 2 ? piece(ears, g, { shade: m.shade, sdf: m.ears, theta: vw, base: "skin", field: earF }) : "",
    hairFront: piece(hair, g, { shade: m.shade, sdf: m.hair, theta: vw, color: m.hairColor, base: "hair", edges: ["accent", "earItem", "earTip", "hat", "hatDark"], field: front, keep: keepHair, smooth: u * 0.18 }),
    tailBack: tailArt && !tailInFront ? tailArt : "",
    tailFront: tailArt && tailInFront ? tailArt : "",
    bounds: [x0, y0, x1, y1],
  };
}

function bodyView(m: Model, look: CartoonLook, vw: View) {
  const theta = vw.yaw;
  void theta;
  const { b } = m;
  const box: Box3 = { x: [-b.S - 30, b.S + 30], y: [m.y.torsoTop - 12, m.y.hip + b.T * 0.3], z: [-b.D * 1.2, b.D * 2.2] };
  const g = gridFor([box], vw, 2);
  const edges = ["pocket", "apron", "item", "band", "sweater", "lapel", "tie", "strap", ...(["polo", "shirt", "jacket", "cardigan"].includes(look.top) ? ["top2"] : []), ...(look.top === "overalls" ? ["bottom"] : [])];
  const tc = cast(m.torso, g, vw);
  // The head and neck shade the top of the chest.
  const neckShadow = (k: number) => {
    const i = k % g.w, j = Math.floor(k / g.w);
    const X = g.x0 + i * g.step, Y = g.y0 + j * g.step;
    return ((X - 2) / (m.neckR * 1.7)) ** 2 + ((Y - m.y.torsoTop) / (b.T * 0.13)) ** 2 < 1;
  };
  // No line along the torso's bottom (its cut at the hips): the legs, the trousers or a skirt carry
  // on from it (a dress is one piece).
  const cut = m.y.hip + 5;
  const atCut = (i: number, j: number) => {
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const k = (j + dj) * g.w + (i + di);
      if (k >= 0 && k < g.w * g.h && tc.val[k] < 0 && tc.hit[k * 3 + 1] > cut - 4) return true;
    }
    return false;
  };
  const torso = piece(tc, g, { shade: m.shade, sdf: m.torso, theta: vw, color: m.torsoColor, base: "top", edges, shadow: neckShadow, keep: (i, j) => !atCut(i, j) });
  const nb: Box3 = { x: [-m.neckR - 4, m.neckR + 4], y: [m.y.torsoTop - 4, m.y.head + m.b.u * 0.7], z: [-m.b.u, m.b.u * 0.5] };
  const ng = gridFor([nb], vw, 1.5);
  // The neck is in the head's shadow.
  const neck = piece(cast(m.neck, ng, vw), ng, { shade: m.shade, sdf: m.neck, theta: vw, base: m.shade ? "skinShade" : "skin", line: "skin" });
  let skirt = "";
  if (m.skirt) {
    const sb: Box3 = { x: [-b.H * 2 - 20, b.H * 2 + 20], y: [m.y.waist - 8, 0], z: [-b.D * 2, b.D * 2.4] };
    const sg = gridFor([sb], vw, 2);
    skirt = piece(cast(m.skirt, sg, vw), sg, { shade: m.shade, sdf: m.skirt, theta: vw, color: m.skirtColor, base: m.skirtColor?.([0, m.y.hip, 0]) ?? "bottom", edges: ["apron"] });
  }
  return { torso, neck, skirt };
}

/** Face features of a view: eye variants, pupils, lids, mouth and brow shapes, nose, extras. */
function faceView(m: Model, look: CartoonLook, vw: View) {
  const theta = vw.yaw;
  const u = m.b.u;
  const s = onSurface(m.head, vw);
  const { x: ex, rx, ry } = m.eye;
  const ey = m.y.eye;
  const ring = (cx: number, cy: number, ax: number, ay: number, lift = 0, n = 28) =>
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return s.point(cx + Math.cos(a) * ax, cy + Math.sin(a) * ay, lift);
    });
  const curve = (p: P2[]) => `M${r(p[0][0])} ${r(p[0][1])}` + p.slice(1).map((q) => ` L${r(q[0])} ${r(q[1])}`).join("");
  const eyes = [-1, 1].map((side) => side * ex);
  // An eye turned well away is left out (the classic near-profile: one eye), not drawn as a sliver
  // on the face's edge.
  const vis = eyes.map((x) => s.visible(x, ey, 0.4));
  const each = (fn: (x: number, i: number) => string) => eyes.map((x, i) => (vis[i] ? fn(x, i) : "")).join("");
  const white = (k: number) =>
    each((x) => {
      const ring_ = ring(x, ey, rx * k, ry * k);
      const lid = Array.from({ length: 11 }, (_, i) => {
        const a = Math.PI + (i / 10) * Math.PI;
        return s.point(x + Math.cos(a) * rx * k * 1.04, ey + Math.sin(a) * ry * k * 1.04);
      });
      const lashes = look.female
        ? (() => {
            const o = Math.sign(x) || 1;
            const a = s.point(x + o * rx * k * 0.95, ey - ry * k * 0.35), b = s.point(x + o * rx * k * 1.35, ey - ry * k * 0.7);
            const c = s.point(x + o * rx * k * 0.75, ey - ry * k * 0.75), d = s.point(x + o * rx * k * 1.05, ey - ry * k * 1.12);
            return `<path d="M${r(a[0])} ${r(a[1])} L${r(b[0])} ${r(b[1])} M${r(c[0])} ${r(c[1])} L${r(d[0])} ${r(d[1])}" ${st(2.4)}/>`;
          })()
        : "";
      return `<path d="M${pts(ring_)} Z" fill="#fff" ${st(2.4)}/><path d="${curve(lid)}" fill="none" ${st(3.6)}/>` + lashes;
    });
  const arc = (dy: number, bend: number) =>
    each((x) => {
      const p = Array.from({ length: 9 }, (_, i) => {
        const t = -1 + (i / 8) * 2;
        return s.point(x + t * rx, ey + dy * ry + bend * ry * (1 - t * t));
      });
      return `<path d="${curve(p)}" fill="none" ${st(3.6)}/>`;
    });
  const pupilR = u * m.pupil;
  const pupil = (k = 1) =>
    each((x) => {
      const c = s.point(x, ey + ry * 0.08);
      // (A dot pupil has no glint.)
      if (m.style.eyes === "wide") return `<circle cx="${r(c[0])}" cy="${r(c[1])}" r="${r(pupilR * k)}" fill="palette(ink)"/>`;
      return `<circle cx="${r(c[0])}" cy="${r(c[1])}" r="${r(pupilR * k)}" fill="palette(ink)"/><circle cx="${r(c[0] - pupilR * 0.35 * k)}" cy="${r(c[1] - pupilR * 0.4 * k)}" r="${r(pupilR * 0.32 * k)}" fill="#fff"/>`;
    });
  const lids = each((x) => {
    const up = Array.from({ length: 13 }, (_, i) => {
      const a = Math.PI + (i / 12) * Math.PI;
      return s.point(x + Math.cos(a) * rx * 1.08, ey + Math.min(Math.sin(a) * ry * 1.08, -ry * 0.05));
    });
    const cut = [s.point(x + rx * 1.08, ey - ry * 0.05), s.point(x - rx * 1.08, ey - ry * 0.05)];
    return `<path d="M${pts([...up, ...cut])} Z" fill="palette(skin)"/><path d="${curve([cut[1], cut[0]])}" fill="none" ${st(3.2)}/>`;
  });
  const dead = each((x) => {
    const a = s.point(x - rx * 0.6, ey - ry * 0.5), b = s.point(x + rx * 0.6, ey + ry * 0.5), c = s.point(x + rx * 0.6, ey - ry * 0.5), d = s.point(x - rx * 0.6, ey + ry * 0.5);
    return `<path d="M${r(a[0])} ${r(a[1])} L${r(b[0])} ${r(b[1])} M${r(c[0])} ${r(c[1])} L${r(d[0])} ${r(d[1])}" ${st(3.6)}/>`;
  });
  const eyeVariants = {
    open: white(1),
    wide: white(1.16),
    half: white(1),
    closed: arc(0.1, 0.22),
    happy: arc(0.2, -0.42),
    dead,
    shine: white(1.16) + pupil(1.6),
  };

  // Brows (one morph path: two strokes).
  const by = m.y.brow;
  const thick = u * 0.085;
  const brow = (dy: number, inner: number, outer: number) =>
    eyes
      .map((x, i) => {
        // The brow of an eye turned away is collapsed onto the other one (same path commands).
        const shown = vis[i] || !vis[1 - i];
        const xx = shown ? x : eyes[1 - i];
        const o = Math.sign(xx);
        // A filled, tapered stroke: thick at the inner end, thin at the outer one.
        const a = s.point(xx - o * rx * 0.95, by + dy + inner), c = s.point(xx, by + dy - u * 0.08), e = s.point(xx + o * rx * 1.1, by + dy + outer + u * 0.02);
        const a2 = s.point(xx - o * rx * 0.95, by + dy + inner + thick), c2 = s.point(xx, by + dy - u * 0.08 + thick * 0.75), e2 = s.point(xx + o * rx * 1.1, by + dy + outer + u * 0.02 + thick * 0.25);
        const q = shown ? [a, c, e, e2, c2, a2] : [a, a, a, a, a, a];
        return `M${r(q[0][0])} ${r(q[0][1])} Q${r(q[1][0])} ${r(q[1][1])} ${r(q[2][0])} ${r(q[2][1])} L${r(q[3][0])} ${r(q[3][1])} Q${r(q[4][0])} ${r(q[4][1])} ${r(q[5][0])} ${r(q[5][1])} Z`;
      })
      .join(" ");
  const k = u * 0.1;
  const brows = { base: brow(0, 0, 0), shapes: { up: brow(-k * 1.2, 0, 0), sad: brow(-k * 0.4, -k * 0.9, k * 0.6), cross: brow(k * 0.4, k * 1.1, -k * 0.5), smug: brow(-k * 0.3, k * 0.5, -k * 0.4) } };

  // Mouth.
  // Each corner stays on the part of the face turned to the camera (turned away, a mouth seen from
  // the side is short: its far corner goes round the face, out of sight).
  const corner = (side: number, my: number, k: number) => {
    let x = side * m.mouthW * k;
    for (let i = 0; i < 20 && !s.visible(x, my, m.mouthMargin); i++) x *= 0.88;
    return s.point(x, my);
  };
  // The rules: every mouth shape (expressions and the visemes of speech) stays on the face, inside its
  // outline, and never touches the nose — from every angle. The nose as drawn here (where the face's
  // surface is the nose's) with a gap around it; the face where a ray goes well into the head.
  const ng = gridFor([{ x: [-u * 1.2, u * 1.2], y: [m.y.nose - u * 0.4, m.y.mouth + u * 0.7], z: [-u * 1.2, u * 1.6] }], vw, u / 40);
  const hc = cast(m.head, ng, vw);
  const noseCells: P2[] = [];
  if (m.nose)
    for (let j = 0; j < ng.h; j++)
      for (let i = 0; i < ng.w; i++) {
        const c = j * ng.w + i;
        if (hc.val[c] < 0 && !Number.isNaN(hc.hit[c * 3]) && m.nose(hc.hit[c * 3], hc.hit[c * 3 + 1], hc.hit[c * 3 + 2]) < u * 0.015) noseCells.push([ng.x0 + i * ng.step, ng.y0 + j * ng.step]);
      }
  // A visible gap between the nose and the upper lip.
  const gap = u * 0.08 + 2;
  // Near profile the mouth is on the face's edge: the lips may stand a little out of it.
  const edge = theta > 1.1 ? u * 0.1 : 0;
  const onFace = (p: P2) => {
    const i = Math.round((p[0] - ng.x0) / ng.step), j = Math.round((p[1] - ng.y0) / ng.step);
    return i >= 0 && j >= 0 && i < ng.w && j < ng.h && hc.val[j * ng.w + i] < edge;
  };
  let my = m.y.mouth, kL = 1, kR = 1, lift = Math.max(0.6, Math.min(1, m.mouthW / (u * 0.3)));
  let mid = s.point(0, my)[0];
  const check = (shapes: { base: string; shapes: Record<string, string> }) => {
    // Every shape, and every expression with every viseme on top (smiling while talking: the
    // morphs add up).
    const base = pathPoints(parsePath(shapes.base));
    const of = (k: string) => pathPoints(parsePath(shapes.shapes[k]));
    const exprs = ["smile", "grin", "frown"].filter((k) => shapes.shapes[k]), visemes = Object.keys(shapes.shapes).filter((k) => !exprs.includes(k));
    const combos = exprs.flatMap((e) => visemes.map((v) => {
      const E = of(e), V = of(v);
      return base.map((b, i): [number, number] => [b[0] + (E[i][0] - b[0]) + (V[i][0] - b[0]), b[1] + (E[i][1] - b[1]) + (V[i][1] - b[1])]);
    }));
    const pts = [shapes.base, ...Object.values(shapes.shapes)].flatMap((d) => pathPoints(parsePath(d))).concat(combos.flat());
    const v = { noseL: 0, noseR: 0, sideL: 0, sideR: 0, below: 0 };
    for (const p of pts) {
      if (noseCells.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < gap)) p[0] < mid ? v.noseL++ : v.noseR++;
      if (!onFace(p)) {
        if (p[1] > s.point(0, my)[1] + u * 0.12) v.below++;
        else p[0] < mid ? v.sideL++ : v.sideR++;
      }
    }
    return v;
  };
  const open0 = Math.min((u / 50) * 1.0, m.chinRoom / 27);
  let open = open0;
  const build = () => {
    const style = { symmetric: theta < 0.35 || theta > 2.8, lift };
    mid = s.point(0, my)[0];
    const L = corner(-1, my, kL), R = corner(1, my, kR);
    return { L, R, style, shapes: mouthShapes(L as P, R as P, open, style) };
  };
  let made = build(), clear = false;
  // Fix what breaks, cheapest change first: shorten the corner that touches (the nose's side or the
  // face's edge), flatten the smile, open less, then lower the mouth (never into the chin).
  for (let i = 0; i < 60; i++) {
    const v = check(made.shapes);
    if (!v.noseL && !v.noseR && !v.sideL && !v.sideR && !v.below) { clear = true; break; }
    // Facing the camera the nose is above the middle of the mouth: shortening the corners does not
    // clear it — flatten the smile and lower the mouth first.
    const frontal = theta < 0.35 || theta > 2.8;
    if (frontal && (v.noseL || v.noseR) && lift > 0.3) lift *= 0.85;
    else if (frontal && (v.noseL || v.noseR) && my - m.y.mouth < m.chinRoom * 0.4) {
      my += u * 0.015;
      open = Math.min(open, (m.chinRoom - (my - m.y.mouth)) / 27);
    } else if ((v.noseR || v.sideR) && v.noseR + v.sideR >= v.noseL + v.sideL && kR > 0.5) kR *= 0.92;
    else if ((v.noseL || v.sideL) && kL > 0.5) kL *= 0.92;
    else if ((v.noseL || v.noseR) && lift > 0.3) lift *= 0.85;
    else if (v.below && open > open0 * 0.45) open *= 0.9;
    else if ((v.noseL || v.noseR) && my - m.y.mouth < m.chinRoom * 0.4) {
      my += u * 0.015;
      open = Math.min(open, (m.chinRoom - (my - m.y.mouth)) / 27);
    } else if (v.below && my > m.y.mouth - u * 0.06) my -= u * 0.01;
    else break;
    made = build();
  }
  const { L, R, style } = made;
  const mouth = made.shapes;
  const inside = mouthInside(L as P, R as P, open, style);
  const gape = gapeView(m, vw, { mid: s.point(0, my), nose: s.point(0, m.y.nose)[1], mouth: mouth.base, teeth: inside.teeth.base, tongue: inside.tongue.base }, (p) => noseCells.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < gap));
  (mouth.shapes as Record<string, string>).gape = gape.mouth;
  inside.teeth.shapes.gape = gape.teeth;
  inside.tongue.shapes.gape = gape.tongue;

  // Nostrils (the nose itself is a volume of the head).
  const ny = m.y.nose;
  let nose = "";
  if (theta < 1.6) {
    const w = look.nose === "wide" ? u * 0.11 : look.nose === "round" ? u * 0.09 : u * 0.065;
    for (const sx of [-1, 1]) {
      const x = sx * w, yy = ny + u * 0.07;
      if (!s.visible(x, yy)) continue;
      const c = s.point(x, yy, 0.5);
      nose += `<ellipse cx="${r(c[0])}" cy="${r(c[1])}" rx="${r(u * 0.035 * Math.max(0.45, Math.cos(theta)))}" ry="${r(u * 0.022)}" fill="palette(skinLine)" opacity="0.85"/>`;
    }
  }

  // Extras on the face.
  let extras = "";
  if (theta < 1.6) {
    if (look.freckles)
      for (const sx of [-1, 1])
        for (const [dx, dy] of [[0, 0], [0.09, 0.05], [-0.07, 0.07], [0.02, 0.12]]) {
          const x = sx * u * (0.42 + dx), yy = ey + u * (0.32 + dy);
          if (!s.visible(x, yy)) continue;
          const p = s.point(x, yy);
          extras += `<circle cx="${r(p[0])}" cy="${r(p[1])}" r="${r(u * 0.025)}" fill="palette(skinDark)"/>`;
        }
    if (look.wrinkles)
      for (const sx of [-1, 1]) {
        if (!s.visible(sx * ex, ey + ry * 1.3)) continue;
        const a = s.point(sx * (ex - rx * 0.6), ey + ry * 1.25), c = s.point(sx * ex, ey + ry * 1.45), e = s.point(sx * (ex + rx * 0.6), ey + ry * 1.25);
        const f0 = s.point(sx * u * 0.28, ny + u * 0.02), f1 = s.point(sx * u * 0.44, m.y.mouth - u * 0.02);
        extras += `<path d="M${r(a[0])} ${r(a[1])} Q${r(c[0])} ${r(c[1])} ${r(e[0])} ${r(e[1])} M${r(f0[0])} ${r(f0[1])} L${r(f1[0])} ${r(f1[1])}" fill="none" ${st(2)}/>`;
      }
  }
  let over = "";
  if (theta < 1.6) {
    if (look.moustache) {
      const my = m.y.mouth;
      const shape: P2[] = [[-0.46, -0.02], [-0.38, -0.14], [-0.2, -0.22], [0, -0.24], [0.2, -0.22], [0.38, -0.14], [0.46, -0.02], [0.3, -0.08], [0.12, -0.08], [0, -0.1], [-0.12, -0.08], [-0.3, -0.08]];
      over += `<path d="M${pts(shape.map(([x, yy]) => s.point(x * u, my + yy * u, u * 0.05)))} Z" fill="palette(hairDark)" ${st(2.6)}/>`;
    }
    if (look.goatee) {
      const cy = m.y.mouth + u * 0.24;
      over += `<path d="M${pts(ring(0, cy, u * 0.14, u * 0.11, u * 0.03, 16))} Z" fill="palette(hairDark)" ${st(2.4)}/>`;
    }
    if (look.glasses) {
      // A frame in front of the face, made from the face as drawn: each lens round its eye, as wide
      // as the eye allows — never past the middle (a bridge between the lenses) nor round the side
      // of the face — the frame a little out of the face at the eyes' depth and curving back with
      // it, rigid (a turned face foreshortens the far lens instead of wrapping it round the cheek),
      // its arm back to the ear.
      const zAt = (x: number) => surfaceZ(m.head, x, ey) ?? u * 0.8;
      const bridge = u * 0.06;
      const w = Math.max(rx * 0.9, Math.min(rx * 1.35, ex - bridge, Math.max(rx * 1.05, frontHalf(m.head, ey, u) - ex)));
      const h = ry * 1.05;
      // The frame's depth: through the face between the eyes and at the eyes, curving back, a little out.
      const zc = zAt(0), ze = zAt(ex), bend = Math.max(0, zc - ze) / (ex * ex);
      const at = (x: number, yy: number): P2 => project([x, yy, zc - bend * x * x + u * 0.1], vw);
      const lens = (x: number) => Array.from({ length: 24 }, (_, i) => {
        const a = (i / 24) * Math.PI * 2;
        const c = Math.cos(a), sn = Math.sin(a);
        // A rounded square.
        const kx = Math.sign(c) * Math.abs(c) ** 0.6, ky = Math.sign(sn) * Math.abs(sn) ** 0.6;
        return at(x + kx * w, ey + ky * h);
      });
      const bridgeA = at(-ex + w, ey - ry * 0.2), bridgeM = at(0, ey - ry * 0.25), bridgeB = at(ex - w, ey - ry * 0.2);
      const tint = look.glasses === "sun" ? `fill="#1e2228" fill-opacity="0.9"` : `fill="#cfe8f5" fill-opacity="0.28"`;
      over += eyes.map((x, i) => (vis[i] ? `<path d="M${pts(lens(x))} Z" ${tint} ${st(3)}/>` : "")).join("") + `<path d="M${pts([bridgeA, bridgeM, bridgeB])}" fill="none" ${st(3)}/>`;
      if (theta > 0.2) {
        // (To the near ear, over its top.)
        const a = at(-ex - w, ey - ry * 0.2), e = project([-u * 0.92, Math.min(ey - ry * 0.1, m.y.ear - u * 0.2), -u * 0.02], vw);
        over += `<path d="M${r(a[0])} ${r(a[1])} L${r(e[0])} ${r(e[1])}" ${st(3)}/>`;
      }
    }
  }
  if (look.earrings) {
    for (const sx of [-1, 1]) {
      const p3: V3 = [sx * u * 1.0, m.y.ear + u * 0.3, -u * 0.06];
      if (theta > 0.2 && theta < 2 && sx > 0) continue; // the far ear is hidden
      const p = project(p3, vw);
      extras += `<circle cx="${r(p[0])}" cy="${r(p[1])}" r="${r(u * 0.07)}" fill="palette(accent)" ${st(2)}/>`;
    }
  }
  const visible = theta < 1.6;
  return { eyeVariants, pupils: pupil(), lids, brows, mouth, teeth: inside.teeth, tongue: inside.tongue, jaw: gape.jaw, jawShade: gape.jawShade, jawLine: gape.jawLine, nose, extras, over, visible, mouthClear: clear && gape.clear, mouthAt: s.point(0, my, u * 0.04) };
}

/** Weight of the `gape` morph that draws the jaw fully unhinged (weight 1: a big cartoon gape). */
export const GAPE_FULL = 2;
/** Degrees the 3D `jaw` bone turns a weight of gape (its occluder follows the drawn jaw down). */
export const JAW_TURN = 36;
/**
 * How much of the upper arm (from the shoulder) is drawn under the head whatever its depth (the
 * cartoon convention of a head drawn over its shoulders); the rest of the arm keeps its true depth.
 */
export const SHOULDER_UNDER = 0.5;
/** How far past the torso's volume (rig units) an arm behind it stays hidden: the torso as drawn, outline included. */
export const TORSO_MARGIN = 8;

/**
 * The jaw's occluder: cones from the cheeks and the middle of the face (on the head) to the chin (on
 * the jaw bone), each thinned until it is inside the head's occluder at rest (the head's volume grown
 * by `grow`) — they only reach out of it as the jaw drops.
 */
function jawCones(m: Model, to: V3, grow: number) {
  const u = m.b.u, nt = m.y.neckTop;
  // (Deep in the head and wide there, narrower at the chin: what counts is how much of the picture
  // they cover once the chin has dropped.)
  const cones = [
    ...[-1, 0, 1].map((sx) => ({
      a: [sx * u * 0.45, m.y.mouth - u * 0.22, sx ? -u * 0.05 : u * 0.1] as V3,
      b: [sx * u * 0.4, -u * 0.12, sx ? -u * 0.25 : -u * 0.12] as V3,
      r: [u * 0.45, u * 0.3] as [number, number],
    })),
    // (The cheeks round out to the head's width.)
    ...[-1, 1].map((sx) => ({ a: [sx * u * 0.6, m.y.nose, -u * 0.35] as V3, b: [sx * u * 0.55, -u * 0.3, -u * 0.6] as V3, r: [u * 0.42, u * 0.3] as [number, number] })),
  ];
  return cones.map(({ a, b, r: r0 }) => {
    const tip: V3 = [to[0] + b[0], to[1] + b[1], to[2] + b[2]];
    let k = 1;
    // (Points all round spheres along the cone: a golden-angle spiral.)
    const inside = () => {
      for (let h = 0; h <= 1; h += 0.125) for (let i = 0; i < 40; i++) {
        const c: V3 = [a[0] + (tip[0] - a[0]) * h, a[1] + (tip[1] - a[1]) * h, a[2] + (tip[2] - a[2]) * h];
        const rad = (r0[0] + (r0[1] - r0[0]) * h) * k;
        const z = 1 - ((i + 0.5) / 40) * 2, q = Math.sqrt(1 - z * z), t = i * 2.39996;
        if (m.head(c[0] + Math.cos(t) * q * rad, c[1] + Math.sin(t) * q * rad, c[2] + z * rad) > grow * 0.5) return false;
      }
      return true;
    };
    for (let i = 0; i < 30 && !inside(); i++) k *= 0.92;
    return { from: { bone: "head", at: [r(a[0]), r(a[1] - nt), r(a[2])] }, to: { bone: "jaw", t: 1, at: b.map(r) }, r: [r(r0[0] * k), r(r0[1] * k)] };
  });
}

/**
 * The gape of a view: the mouth opened to swallow something whole, with the lower head following it.
 * Everything is drawn for the jaw **unhinged** (weight `GAPE_FULL`) and the `gape` shapes are made
 * half way there (`morphTowards`): the morph is linear, so weight 1 is a big gape (the mouth ≈ 2.2×
 * viseme D tall, the chin ≈ 0.45 head radius lower) and weight 2 the unhinged jaw — the mouth as
 * wide as the head, the chin ≈ 0.9 head radius below its rest — every weight between them (and a
 * close from 2 to 0) a valid shape.
 *
 * The jaw is morph parts over the head's drawing, made from the head's outline in this view (rays
 * from the middle of the face, between the nose and the mouth, to the outline below): `jawLine`,
 * the lower outline (at rest exactly on the drawn chin), `jaw`, the skin between that outline and a
 * band inside the rest chin (no area at rest), and for cel-shaded looks `jawShade`, its side away
 * from the light. Opening, the lower head stretches down and its cheeks round out to the head's full
 * width, the old chin covered by the skin.
 *
 * The mouth's top lip stays clear of the nose (`touchesNose`, the face's rule: lowered until it
 * is); below, the mouth goes past the rest chin by design — the jaw drops with it.
 */
function gapeView(m: Model, vw: View, at: { mid: P2; nose: number; mouth: string; teeth: string; tongue: string }, touchesNose: (p: P2) => boolean) {
  const u = m.b.u;
  const g = gridFor([{ x: [-u * 1.7, u * 1.7], y: [m.y.top - u * 0.1, m.y.head + u * 1.5], z: [-u * 1.7, u * 1.7] }], vw, u / 30);
  const hc = cast(m.head, g, vw);
  // The head's field between grid points (negative inside its outline).
  const field = (X: number, Y: number) => {
    const fi = (X - g.x0) / g.step, fj = (Y - g.y0) / g.step;
    const i = Math.floor(fi), j = Math.floor(fj);
    if (i < 0 || j < 0 || i >= g.w - 1 || j >= g.h - 1) return 1;
    const a = fi - i, b = fj - j, v = (ii: number, jj: number) => hc.val[jj * g.w + ii];
    return (v(i, j) * (1 - a) + v(i + 1, j) * a) * (1 - b) + (v(i, j + 1) * (1 - a) + v(i + 1, j + 1) * a) * b;
  };
  // The head's widest reach on each side.
  let xmin = Infinity, xmax = -Infinity;
  for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) if (hc.val[j * g.w + i] < 0) {
    xmin = Math.min(xmin, g.x0 + i * g.step);
    xmax = Math.max(xmax, g.x0 + i * g.step);
  }
  // The jaw hinges between the nose and the mouth; rays from there to the outline below.
  const Yj = (at.nose + at.mid[1]) / 2;
  const cx = Math.max(xmin + u * 0.35, Math.min(xmax - u * 0.35, at.mid[0]));
  const ray = (phi: number): P2 => {
    const dx = Math.cos(phi), dy = Math.sin(phi);
    let t0 = 0, t1 = 0;
    for (let t = 0; t < u * 3; t += u / 60) {
      if (field(cx + dx * t, Yj + dy * t) > 0) { t1 = t; break; }
      t0 = t;
    }
    for (let k = 0; k < 14; k++) {
      const t = (t0 + t1) / 2;
      if (field(cx + dx * t, Yj + dy * t) > 0) t1 = t;
      else t0 = t;
    }
    const t = (t0 + t1) / 2;
    return [cx + dx * t, Yj + dy * t];
  };
  const N = 16;
  const phis = Array.from({ length: N + 1 }, (_, i) => (i / N) * Math.PI);
  const B = phis.map(ray);
  // Unhinged: the lower head stretched down by `drop`, its cheeks out to the head's widest (and a
  // little past it: they round out), from the hinge — where it meets the head's outline — down.
  const drop = u * 0.9;
  const b = Math.max(...B.map((q) => q[1])) - Yj + drop;
  const a0 = [B[0][0] - cx, cx - B[N][0]], a1 = [(xmax - cx) * 1.08, (cx - xmin) * 1.08];
  const jawAt = (phi: number): P2 => {
    const sn = Math.sin(phi), c = Math.cos(phi), k = c >= 0 ? 0 : 1;
    const a = a0[k] + (a1[k] - a0[k]) * (1 - (1 - Math.min(1, sn * 1.4)) ** 3);
    return [cx + a * c, Yj + b * sn];
  };
  const U = phis.map(jawAt);
  // Catmull-Rom through points, as cubic segments.
  const segs = (p: P2[]) => p.slice(0, -1).map((q, i) => {
    const p0 = p[Math.max(0, i - 1)], p2 = p[i + 1], p3 = p[Math.min(p.length - 1, i + 2)];
    return `C${r(q[0] + (p2[0] - p0[0]) / 6)} ${r(q[1] + (p2[1] - p0[1]) / 6)} ${r(p2[0] - (p3[0] - q[0]) / 6)} ${r(p2[1] - (p3[1] - q[1]) / 6)} ${r(p2[0])} ${r(p2[1])}`;
  }).join(" ");
  const line = (p: P2[]) => `M${r(p[0][0])} ${r(p[0][1])} ${segs(p)}`;
  // The jaw's skin: from its outline up to a band inside the rest chin (covering the drawn chin's
  // line from the smallest gape on, keeping the head's own drawing and shading above it).
  const Bin = B.map((q): P2 => {
    const d = Math.hypot(q[0] - cx, q[1] - Yj) || 1, k = Math.min(u * 0.3, d * 0.6) / d;
    return [q[0] + (cx - q[0]) * k, q[1] + (Yj - q[1]) * k];
  });
  const jawLine = { base: line(B), shapes: { gape: morphTowards(line(B), line(U), GAPE_FULL) } };
  const jawBase = `${line(B)} ${segs([...B].reverse())} Z`, jawOpen = `${line(U)} ${segs([...Bin].reverse())} Z`;
  const jaw = { base: jawBase, shapes: { gape: morphTowards(jawBase, jawOpen, GAPE_FULL) } };
  // Cel shaded looks: the side of the dropped jaw turned away from the light (lower right) in
  // shadow, up to the rest chin (whose drawing is shaded there too) — none at rest.
  const inner = U.map((q, i): P2 => {
    const a = U[Math.max(0, i - 1)], c = U[Math.min(N, i + 1)];
    const tx = c[0] - a[0], ty = c[1] - a[1], l = Math.hypot(tx, ty) || 1;
    // (The outward normal: the curve runs right → bottom → left, the outside on its right.)
    const nx = ty / l, ny = -tx / l;
    const f = smoothstep(0.05, 0.45, -(nx * LIGHT[0] + ny * LIGHT[1]));
    return [q[0] + (Bin[i][0] - q[0]) * f, q[1] + (Bin[i][1] - q[1]) * f];
  });
  const shadeBase = `${line(B)} ${segs([...B].reverse())} Z`, shadeOpen = `${line(U)} ${segs([...inner].reverse())} Z`;
  const jawShade = m.shade ? { base: shadeBase, shapes: { gape: morphTowards(shadeBase, shadeOpen, GAPE_FULL) } } : undefined;
  // The mouth unhinged: its corners on the jaw's sides a third of the way down (pulled down and out
  // to the head's width), the top lip under the nose, the round lower edge a chin's thickness above
  // the dropped chin.
  const margin = u * 0.06, sc = 0.3;
  const cr = jawAt(Math.asin(sc)), cl = jawAt(Math.PI - Math.asin(sc));
  const l: P = [cl[0] + margin, cl[1]], rr: P = [cr[0] - margin, cr[1]];
  const bottom = Yj + b - u * 0.16;
  const sample = (d: string) => parsePath(d).flatMap((sp) => {
    const out: P2[] = [];
    let p0 = sp.start;
    for (const [c1, c2, e] of sp.segments) {
      for (let k = 0; k <= 8; k++) {
        const t = k / 8, mt = 1 - t;
        out.push([mt ** 3 * p0[0] + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t ** 3 * e[0], mt ** 3 * p0[1] + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t ** 3 * e[1]]);
      }
      p0 = e;
    }
    return out;
  });
  let top = at.mid[1] - u * 0.06, made = gapeMouth(l, rr, top, bottom, { out: (rr[0] - l[0]) * 0.07, teeth: u * 0.13 }), clear = false;
  for (let i = 0; i < 30; i++) {
    const half = morphTowards(at.mouth, made.mouth, GAPE_FULL);
    if (![...sample(made.mouth), ...sample(half)].some(touchesNose)) { clear = true; break; }
    top += u * 0.015;
    made = gapeMouth(l, rr, top, bottom, { out: (rr[0] - l[0]) * 0.07, teeth: u * 0.13 });
  }
  return {
    mouth: morphTowards(at.mouth, made.mouth, GAPE_FULL),
    teeth: morphTowards(at.teeth, made.teeth, GAPE_FULL),
    tongue: morphTowards(at.tongue, made.tongue, GAPE_FULL),
    jaw, jawShade, jawLine, clear,
  };
}

// ------------------------------------------------------------------ shoes, sleeves, shorts

// ------------------------------------------------------------------ the builder

/**
 * Options of `cartoonCharacter`: `pitch` (degrees) — how far above the camera sees the character
 * (a room camera's pitch, `viewAt`): every drawing is made at that angle.
 */
/**
 * The torso as an occluder of a solid: the same ellipsoids as its drawing (`model`), a hair smaller,
 * its hips ending at the drawing's cut — so a limb behind it is hidden right to the drawing's edge.
 */
function torsoOccluder(m: Model, look: CartoonLook, margin = 0): Record<string, unknown> {
  const { b } = m;
  const heavy = look.heavy ?? 0;
  const T = b.T, L = b.L, k = 0.98;
  const W = b.W * (look.female ? 0.86 : 1) + heavy * b.W * 0.35, H = b.H * (look.female ? 1.04 : 1) + heavy * b.H * 0.2;
  const sh = m.sh;
  const at = (y: number, z = 0) => ({ bone: "body", at: [0, r(y + L), r(z)] });
  const ell = (y: number, z: number, rad: V3) => ({ from: at(y, z), ellipsoid: rad.map((v) => r(v * k)) });
  const hipR = T * 0.2;
  return {
    blend: r(T * 0.12),
    ...(margin ? { margin: r(margin) } : {}),
    shapes: [
      ell(-L - T * 0.68, 0, [b.S, T * 0.36, b.D]),
      ell(-L - T * 0.32, heavy * b.D * 0.55, [W, T * 0.38, b.D * (1 + heavy * 0.6)]),
      ell(-L + 5 - hipR, 0, [Math.max(W * 0.98, H * 0.95), hipR, b.D * 0.92]),
      { from: { bone: "body", at: [r(-b.S + sh * 0.6), r(m.y.shoulder + L), 0] }, to: { bone: "body", at: [r(b.S - sh * 0.6), r(m.y.shoulder + L), 0] }, r: r(sh * k) },
    ],
  };
}

/**
 * The legs, the hips and the skirt as a solid on the 3D skeleton: each leg a thigh and a shin cone
 * (a round knee between them), shorts or socks over them, the hips between the hip joints, a skirt
 * draped over the lap. The torso is an occluder (the torso's drawing is under the solid).
 */
function legsSolid(m: Model, look: CartoonLook, j: Record<string, P>, calf = 1.12): Record<string, unknown> {
  void j;
  const { b } = m;
  const heavy = look.heavy ?? 0;
  const bare = look.bottom !== "pants";
  const shorts = look.bottom === "shorts" || look.bottom === "bermuda";
  const skirted = look.bottom === "skirt" || look.bottom === "longSkirt";
  const shortsTo = look.bottom === "bermuda" ? 0.9 : 0.45;
  const thigh: [number, number] = [r(b.leg[0] * THIGH_R * (1 + heavy * 0.35)), r(b.leg[0] * 0.6)];
  const shin: [number, number] = [r(b.leg[0] * 0.52), r(b.leg[1] * 0.5)];
  const pt = (bone: string, t = 0, at?: V3) => ({ bone, ...(t ? { t } : {}), ...(at ? { at: at.map(r) } : {}) });
  const paint = (key: string) => ({ fill: `palette(${key})`, ...(m.shade ? { shade: `palette(${key}Shade)` } : {}), stroke: `palette(${key}Line)`, strokeWidth: lw(SW) });
  const bodies: Record<string, unknown>[] = [];
  const T = b.T, D = b.D * (1 + heavy * 0.6);
  bodies.push(torsoOccluder(m, look));
  // The hips: between the hip joints, a little back (the seat).
  const hipsKey = look.top === "dress" ? "top" : bare && !shorts && !skirted ? "skin" : "bottom";
  // (Under a skirt the cloth is the hips; otherwise no line where they come out of the torso.)
  if (!skirted) bodies.push({ ...paint(hipsKey), blend: 6, seamless: true, shapes: [{ from: pt("legF1", 0, [0, -4, -6]), to: pt("legB1", 0, [0, -4, -6]), r: r(b.H * 0.5 * (1 + heavy * 0.15)) }] });
  for (const side of ["B", "F"] as const) {
    const legKey = bare ? "skin" : "bottom";
    bodies.push({ ...paint(legKey), blend: 5, shapes: [
      { from: pt(`leg${side}1`), to: pt(`leg${side}1`, 1), r: thigh },
      { from: pt(`leg${side}2`), to: pt(`leg${side}2`, 0.97), r: shin },
      // The calf: a swell at the back of the shin, below the knee.
      { from: pt(`leg${side}2`, 0.18, [0, 0, -shin[0] * 0.25]), to: pt(`leg${side}2`, 0.5, [0, 0, -shin[0] * 0.12]), r: [r(shin[0] * calf), r(shin[0] * (calf - 0.12))] },
    ] });
    if (shorts) bodies.push({ ...paint("bottom"), shapes: [{ from: pt(`leg${side}1`, -0.04), to: pt(`leg${side}1`, shortsTo), r: [thigh[0] + 3, r(thigh[0] + (thigh[1] - thigh[0]) * shortsTo + 3)] }] });
    if (look.socks) bodies.push({ ...paint("socks"), strokeWidth: 2.4, shapes: [{ from: pt(`leg${side}2`, 0.8), to: pt(`leg${side}2`, 0.97), r: [r(shin[1] + 1.5), r(shin[1] + 2)] }] });
  }
  // Shoes: an upper from the heel to the toe on a sole, flat on the floor standing.
  // (Never thinner than the ankle: thick limbs get bigger shoes.)
  const k = Math.max(b.shoe, shin[1] / 9.5);
  const v = (x: number, y: number, z: number): V3 => [r(x * k), r(y * k), r(z * k)];
  for (const side of ["B", "F"] as const) {
    const foot = `foot${side}`;
    const sole = (key: string, h = 2.5, at = v(0, 10, 13)) => ({ ...paint(key), strokeWidth: 2.4, shapes: [{ from: pt(foot, 0, at), box: v(10, h, 25), round: r(Math.min(h, 2.5) * k) }] });
    if (look.shoes === "flipflops" || look.shoes === "sandals") {
      bodies.push(sole("shoes", 1.6, v(0, 10.5, 13)));
      bodies.push({ ...paint("skin"), strokeWidth: 2.4, blend: 3, shapes: [{ from: pt(foot, 0, v(0, 2, -5)), to: pt(foot, 0, v(0, 4.5, 30)), r: [r(8 * k), r(6.5 * k)] }] });
      bodies.push({ ...paint("shoes"), strokeWidth: 2, shapes: look.shoes === "flipflops"
        ? [{ from: pt(foot, 0, v(-7, 2, 14)), to: pt(foot, 0, v(0, -1, 20)), r: r(2.6 * k) }, { from: pt(foot, 0, v(7, 2, 14)), to: pt(foot, 0, v(0, -1, 20)), r: r(2.6 * k) }]
        : [-2, 12, 24].map((z) => ({ from: pt(foot, 0, v(-8, 2, z)), to: pt(foot, 0, v(8, 2, z)), r: r(3 * k) })) });
    } else if (look.shoes === "heels") {
      bodies.push({ ...paint("shoes"), strokeWidth: 2.4, blend: 3, shapes: [
        { from: pt(foot, 0, v(0, -1, -5)), to: pt(foot, 0, v(0, 6, 30)), r: [r(9.5 * k), r(7 * k)] },
        { from: pt(foot, 0, v(0, 6, -5)), box: v(3, 6, 3), round: r(1.5 * k) },
      ] });
    } else {
      bodies.push(sole(look.shoes === "dress" ? "shoes" : "sole"));
      bodies.push({ ...paint("shoes"), strokeWidth: 2.4, blend: 4, shapes: [{ from: pt(foot, 0, v(0, 1, -7)), to: pt(foot, 0, v(0, 3.5, 32)), r: [r(10.5 * k), r(9 * k)] }] });
    }
  }
  if (look.cape) {
    // A cape from the shoulders down the back to the knees, wider at the hem: on the torso's bone,
    // hanging behind it.
    // (Thin: a sheet of cloth a little behind the back, wider than the shoulders.)
    const top = -b.T * 0.9, bottom = b.L * 0.55, t = b.D * 0.12;
    bodies.push({ ...paint("cape"), blend: 4, shapes: [
      { from: pt("body", 0, [0, r((top + bottom) / 2), r(-b.D * (1 + heavy * 0.6) - t * 1.4)]), box: [r(b.S * 1.12), r((bottom - top) / 2), r(t)], round: r(t * 0.9) },
    ] });
  }
  if (skirted) {
    // Cloth from the hips over both thighs (the torso drawing has its top), wider at the hem: an
    // A-line standing, over the lap seated.
    const long = look.bottom === "longSkirt";
    // The cloth hugs the thighs (a valley between the knees) and ends just above them: seated,
    // the knees show under the hem.
    // The top: the torso's own cross-section (wide, not as deep), just under its drawing, so the
    // cloth comes out of it with no step at the waist; then an A-line over the thighs.
    const kneeR = long ? thigh[1] + b.H * 0.16 : thigh[1] + b.H * 0.14;
    const hipHalf = Math.max(b.W * 0.98, b.H * 0.95) * (look.female ? 0.9 : 1) + heavy * b.W * 0.3;
    bodies.push({ ...paint(look.top === "dress" ? "top" : "bottom"), blend: r(b.H * 0.3), seamless: true, shapes: [
      { from: pt("hips", 0, [0, r(b.H * 0.1), heavy * b.D * 0.3]), box: [r(hipHalf * 0.88), r(b.H * 0.12), r(D * 0.78)], round: r(D * 0.4) },
      ...(["F", "B"] as const).flatMap((side) => [
        { from: pt(`leg${side}1`, 0.05), to: pt(`leg${side}1`, long ? 1 : 0.9), r: [r(thigh[0] + 5), r(kneeR)] },
        ...(long ? [{ from: pt(`leg${side}2`), to: pt(`leg${side}2`, 0.72), r: [r(kneeR), r(kneeR + b.H * 0.3)] }] : []),
      ]),
    ] });
  }
  return { id: "legs", type: "solid", step: 2, bodies };
}

/**
 * How the drawing is inked and painted. The default is a painted cartoon: lines in a dark tone of
 * each colour, cel shadows on the side away from the light. `flat` is a flat TV cartoon — one ink
 * for every line, flat colours with no cel shadow (the lighting's shading, if any, is the scene's).
 */
export interface CartoonStyle {
  /** One ink for every line (e.g. `#1b1b1b`); default: a dark tone of each colour. */
  ink?: string;
  /** Cel shadows drawn (default true). */
  shade?: boolean;
  /** One line weight for every line (outlines, seams, lips, hands); default: the painted weights (2.8 outlines, thinner seams). */
  line?: number;
  /**
   * `tapered` (default): arms thicker at the shoulder than the wrist, a round elbow, puffed short
   * sleeves, round shoulder caps. `tube`: noodle arms of one width, the sleeve flush with the arm
   * (just a hem line), no shoulder caps — a flat TV cartoon's.
   */
  limbs?: "tapered" | "tube";
  /** The hands' resting shape (default `fist`; a flat TV cartoon's hang `open`). */
  hands?: "fist" | "open";
  /**
   * `oval` (default): the eyes of the look's anatomy, a glint in the pupil. `wide`: a flat TV
   * cartoon's — bigger and closer together, a dot pupil with no glint. (No lower-lid line: under a
   * nose this close to the eyes, two of them read as a moustache.)
   */
  eyes?: "oval" | "wide";
  /** `upright` (default): the arms hang straight. `slouch`: shoulders a little lower, the elbows bent, the hands forward. */
  posture?: "upright" | "slouch";
  /** `normal` (default). `bigHead`: a bigger head (more on children) on a thinner neck. */
  proportions?: "normal" | "bigHead";
}

export interface CartoonOptions {
  pitch?: number;
  /** Inking and painting (default painted; `"flat"`: one near-black ink and one line weight, no cel shadow, tube arms, open hands). */
  style?: "painted" | "flat" | CartoonStyle;
  /** The character's anatomy (default `cartoonAnatomy(look)`): an edited one changes its body, face and physics. */
  anatomy?: CartoonAnatomy;
}

export function cartoonCharacter(look: CartoonLook, opts: CartoonOptions = {}): ToonDoc {
  // Lipstick colours the lips (a thicker outline); the inside of the mouth stays dark.
  const style = styleOf(opts.style);
  WEIGHT.w = style.line ?? SW;
  WEIGHT.uniform = style.line !== undefined;
  try {
    return buildCartoon(look, opts, style);
  } finally {
    WEIGHT.w = SW;
    WEIGHT.uniform = false;
  }
}

function buildCartoon(look: CartoonLook, opts: CartoonOptions, style: Required<CartoonStyle>): ToonDoc {
  const [LIPS, LIPS_W] = look.lipstick ? ["palette(lips)", lw(3.6)] : ["palette(mouthLine)", lw(2.4)];
  const anatomy = opts.anatomy ?? styledAnatomy(cartoonAnatomy(look), style, look);
  const broken = checkAnatomy(anatomy).filter((x) => x.severity === "error");
  if (broken.length) throw new Error(`${look.name}: anatomy breaks ${broken.length} rule(s): ${broken.map((x) => `${x.rule} — ${x.message}`).join("; ")}`);
  const m = model(look, false, anatomy, style);
  const { b } = m;
  const u = b.u;
  const pitch = deg(opts.pitch ?? 0);
  /** A drawn angle seen from the camera's pitch. */
  const vw = (v: ViewKey): View => ({ yaw: VIEWS[v], pitch });
  /** A drawn angle of the head (nearly level, put back on the neck). */
  const vh = (v: ViewKey): View => headAngle(m, VIEWS[v], pitch);
  // Joints in body space (the front view), and where the main view (three-quarter) draws them.
  const j3: Record<string, V3> = {};
  const at = (x: number, y: number, z = 0): P => {
    const p = project([x, y, z], vw("profile"));
    return [r(p[0]), r(p[1])];
  };
  const joint = (name: string, x: number, y: number, z = 0): P => ((j3[name] = [x, y, z]), at(x, y, z));

  // Joints (front-view model) → the three-quarter skeleton.
  const sx = b.S - b.arm[0] * 0.35, hx = b.H * 0.5;
  const armLen = b.T * 0.9 + b.L * 0.34;
  // A slouch: the shoulders a little lower, the elbows bent back, the hands forward.
  const slouch = style.posture === "slouch";
  const shY = m.y.shoulder + 4 + (slouch ? b.T * 0.04 : 0);
  const belly = (look.heavy ?? 0) * b.W * 0.35;
  const waistX = b.W * (look.female ? 0.86 : 1) + (look.heavy ?? 0) * b.W * 0.35 - belly;
  const hipX = Math.max(waistX * 0.98, (b.H * (look.female ? 1.04 : 1) + (look.heavy ?? 0) * b.H * 0.2) * 0.95) - belly;
  const ankle = 12 * b.shoe;
  const j = {
    // Arms at rest hang relaxed: the elbow a little bent, the hand a little forward, out past a belly.
    // (Outside the torso's sides — waist and hips — so a hanging arm is beside the body from any angle.)
    shoulderF: joint("shoulderF", -sx, shY), elbowF: joint("elbowF", -Math.max(sx + 3, waistX + b.arm[0] * 0.55) - belly * 0.5, shY + armLen * 0.5, slouch ? -9 : -2), handF: joint("handF", -Math.max(sx + 4, hipX + b.arm[1] * 0.6) - belly, shY + armLen * (slouch ? 0.93 : 0.98), slouch ? 28 : 16),
    shoulderB: joint("shoulderB", sx, shY), elbowB: joint("elbowB", Math.max(sx + 3, waistX + b.arm[0] * 0.55) + belly * 0.5, shY + armLen * 0.5, slouch ? -9 : -2), handB: joint("handB", Math.max(sx + 4, hipX + b.arm[1] * 0.6) + belly, shY + armLen * (slouch ? 0.93 : 0.98), slouch ? 28 : 16),
    hipF: joint("hipF", -hx, m.y.hip), kneeF: joint("kneeF", -hx, m.y.hip / 2, 6), footF: joint("footF", -hx, -ankle),
    hipB: joint("hipB", hx, m.y.hip), kneeB: joint("kneeB", hx, m.y.hip / 2, 6), footB: joint("footB", hx, -ankle),
  };
  const eyeMid = project([0, m.y.eye, u * 0.9], vh("profile"));

  const views = Object.fromEntries((Object.keys(VIEWS) as ViewKey[]).map((v) => [v, { head: headView(m, vh(v)), body: bodyView(m, look, vw(v)), face: faceView(m, look, vh(v)) }])) as Record<ViewKey, { head: HeadView; body: ReturnType<typeof bodyView>; face: ReturnType<typeof faceView> }>;

  const longSleeves = ["jacket", "cardigan", "blazer"].includes(look.top);
  const shortSleeves = !longSleeves && !["tank", "overalls", "dress"].includes(look.top) || look.top === "overalls";
  const bareLegs = look.bottom !== "pants";
  const shorts = look.bottom === "shorts" || look.bottom === "bermuda";
  const skirted = look.bottom === "skirt" || look.bottom === "longSkirt";
  const shortsTo = look.bottom === "bermuda" ? 0.9 : 0.45;

  // Points of the head for props fitted to the body (a phone at the ear, a cigarette at the mouth),
  // where each drawn angle puts them: the near ear, the middle of the mouth, between the eyes, the top.
  const headPoints = Object.fromEntries((Object.keys(VIEWS) as ViewKey[]).map((v) => {
    const th = vh(v), sp = onSurface(m.head, th);
    return [v, {
      // The ear canal: on the near ear, between the height of the eyes and of the nose.
      ear: project([-u * 0.97, m.y.head + u * 0.22, -u * 0.02], th),
      // The other ear (the far hand's, when someone turned round keeps holding the phone).
      earB: project([u * 0.97, m.y.head + u * 0.22, -u * 0.02], th),
      // (Where the face's rules put the mouth in this angle.)
      mouth: views[v].face.mouthAt,
      eye: sp.point(0, m.y.eye, u * 0.04),
      top: project([0, m.y.top, 0], th),
    }];
  })) as Record<ViewKey, Record<"ear" | "earB" | "mouth" | "eye" | "top", P2>>;
  const art: Record<string, string> = {
    ...Object.fromEntries(Object.entries(cartoonHands(j.handF, { r: b.hand * 1.2, fill: "palette(skin)", line: "palette(skinLine)", stroke: lw(2.2), detail: lw(2.2 * 0.7) })).map(([k, v]) => [`handF_${k}`, v])),
    ...Object.fromEntries(Object.entries(cartoonHands(j.handB, { r: b.hand * 1.16, fill: m.shade ? "palette(skinShade)" : "palette(skin)", line: "palette(skinLine)", stroke: lw(2.2), detail: lw(2.2 * 0.7) })).map(([k, v]) => [`handB_${k}`, v])),
  };
  // Asymmetric details: a second drawing of the hair and the torso, mirrored on the body, shown when
  // the character faces left (`side` control).
  const asym = look.top === "shirt" || !!look.pocketItem || !!look.earItem || look.hair === "sidePart" || !!look.hairLine || !!look.boutonniere;
  if (asym) {
    const mm = model(look, true, anatomy, style);
    for (const v of Object.keys(VIEWS) as ViewKey[]) {
      const s = SUFFIX[v], H = headView(mm, vh(v)), B = bodyView(mm, look, vw(v));
      art[`hairBack${s}M`] = H.hairBack;
      art[`hairFront${s}M`] = H.hairFront;
      art[`torso${s}M`] = B.torso;
    }
  }
  for (const v of Object.keys(VIEWS) as ViewKey[]) {
    const s = SUFFIX[v], V = views[v];
    art[`hairBack${s}`] = V.head.hairBack;
    art[`earsBack${s}`] = V.head.earsBack;
    art[`head${s}`] = V.head.head;
    art[`earsFront${s}`] = V.head.earsFront;
    art[`hairFront${s}`] = V.head.hairFront;
    art[`tailBack${s}`] = V.head.tailBack;
    art[`tailFront${s}`] = V.head.tailFront;
    art[`neck${s}`] = V.body.neck;
    art[`torso${s}`] = V.body.torso;
    art[`skirt${s}`] = V.body.skirt;
    art[`nose${s}`] = V.face.extras;
    // Over the mouth: the nose (with its nostrils), then a moustache, glasses.
    art[`over${s}`] = V.head.noseOver + V.face.nose + V.face.over;
  }
  const F = views.profile.face;
  for (const [k, v] of Object.entries(F.eyeVariants)) art[`eye_${k}`] = v;
  art.pupils = F.pupils;
  art.lids = F.lids;

  // The arms as solids on the 3D skeleton: the upper arm, the forearm (a round elbow between them),
  // a short sleeve over the upper arm, a watch — each drawn where it is nearest (a forearm bent
  // towards the camera in front of the upper arm, from any angle), cel shaded like the legs.
  const armBodies = (side: "F" | "B"): Record<string, unknown>[] => {
    const pt = (bone: string, t = 0) => ({ bone, ...(t ? { t } : {}) });
    const key = (k: string) => ({ fill: `palette(${k})`, ...(m.shade ? { shade: `palette(${k}Shade)` } : {}), stroke: `palette(${k}Line)`, strokeWidth: lw(SW) });
    const up = `arm${side}1`, lo = `arm${side}2`;
    // Tube arms: one width from the shoulder to the wrist, the sleeve flush with it (a hem line).
    const tube = style.limbs === "tube";
    const elbow = tube ? r((b.arm[0] + b.arm[1]) * 0.25) : r((b.arm[0] + b.arm[1]) * 0.25);
    const [rs, rw] = tube ? [elbow, elbow] : [r(b.arm[0] * 0.5), r(b.arm[1] * 0.5)];
    // The head is drawn over the shoulder (`under`), not over the whole upper arm: the elbow's half
    // keeps its depth, so an elbow raised in front of the chest (a hand bringing something to the
    // mouth, under a dropped jaw) is drawn over the chin, not hidden behind it.
    const mid = r((rs + elbow) / 2);
    const bodies: Record<string, unknown>[] = [
      { ...key(longSleeves ? "top2" : "skin"), blend: 3, shapes: [
        { from: pt(up), to: pt(up, SHOULDER_UNDER), r: [rs, mid], under: true },
        { from: pt(up, SHOULDER_UNDER), to: pt(up, 1), r: [mid, elbow] },
        { from: pt(lo), to: pt(lo, 0.96), r: [elbow, rw] },
      ] },
    ];
    if (shortSleeves) bodies.push({ ...key("top"), shapes: [{ from: pt(up, -0.04), to: pt(up, 0.42), r: tube ? [r(elbow + 0.8), r(elbow + 0.8)] : [r(b.arm[0] * 0.5 + 5), r(b.arm[0] * 0.5 + 6)], under: true }] });
    return bodies;
  };
  /** A body as an occluder: its shapes hide what is behind them, drawing nothing. */
  const occluder = (x: Record<string, unknown>) => ({ shapes: x.shapes, ...(x.blend ? { blend: x.blend } : {}) });
  // Both arms in one solid, the torso an occluder: each bit of an arm shows only where it is nearest
  // (a forearm in front of the chest hidden from behind, one arm over the other).
  // The head hides them as drawn: its cranium and its face down to the chin (a big head's jaw comes
  // down past the shoulders), a hair smaller — and, as a cartoon head is drawn over its shoulders,
  // it is drawn over the shoulder's half of the upper arms and the sleeves (`under`,
  // `SHOULDER_UNDER`) whatever their depth: a shoulder turned towards the camera never covers the
  // jaw. The elbow's half and the forearm keep their depth (a phone at the ear, a glass at the mouth,
  // an elbow raised in front of the chest under a dropped jaw).
  // It covers the head as drawn, outline included: the drawing is seen nearly level and put back on
  // the neck (`headAngle`), its chin a little lower than the volume's at the room's pitch — so the
  // volume grows by the outline and by that difference (the face's depth × the pitch left out).
  const grow = SW + u * 0.9 * Math.abs(Math.sin(pitch) - Math.sin(pitch * HEAD_PITCH)) + u * 0.02;
  const headOccluder = { blend: r(u * 0.2), over: r(u * 4), shapes: m.headParts.map(([c, rad]) => ({ from: { bone: "head", at: [r(c[0]), r(c[1] - m.y.neckTop), r(c[2])] }, ellipsoid: rad.map((v) => r(v + grow)) })) };
  // The jaw a gape drops: a 3D bone from a hinge at the back of the head (at the mouth's height) to
  // the chin, nothing drawn on it (the dropped jaw is a morph of the face: `gapeView`). Turned by the
  // `jaw` control and the `gape` emotion (`JAW_TURN`° a weight), it takes this occluder down with
  // the drawn jaw — the cheeks to the chin, as cones from the head to the jaw — so the upper arms
  // stay behind a dropped chin. At rest it is inside the head's (it changes nothing).
  const jawFrom: V3 = [0, m.y.mouth, -u * 0.5], jawTo: V3 = [0, m.y.head + u * anatomy.face.chinY - u * 0.2, u * 0.55];
  const jawOccluder = { over: r(u * 4), shapes: jawCones(m, jawTo, grow) };
  // The legs, the hips and a skirt hide the arms too (a hand behind the skirt).
  const legOccluders = ((legsSolid(m, look, j, anatomy.limbs.calf).bodies as Record<string, unknown>[]) ?? []).filter((x) => x.fill).map(occluder);
  // The torso hides an arm behind it up to its drawn outline (its volume is a little inside the drawing).
  const armsSolid = { id: "arms", type: "solid", step: 2, bodies: [torsoOccluder(m, look, TORSO_MARGIN), headOccluder, jawOccluder, ...legOccluders, ...armBodies("B"), ...armBodies("F")] };
  // A wristwatch: a band round a forearm, its own solid behind the same occluders as the arms (and
  // the arms themselves), one per wrist. The wearer keeps it on the same wrist whichever way they
  // face: the near arm facing right, the far arm facing left (the rig mirrored) — `sideSwitch`
  // (set by the `side` control from the actor's facing) picks the wrist.
  const watchSolids = look.watch
    ? (["F", "B"] as const).map((side) => ({
        id: `watch${side}`, type: "solid", step: 2,
        visibleWhen: { part: "sideSwitch", variant: side === "F" ? "r" : "l" },
        bodies: [
          torsoOccluder(m, look), headOccluder, jawOccluder, ...legOccluders, ...armBodies("B").map(occluder), ...armBodies("F").map(occluder),
          { fill: "palette(watch)", ...(m.shade ? { shade: "palette(watchShade)" } : {}), stroke: "palette(watchLine)", strokeWidth: lw(2.2), shapes: [{ from: { bone: `arm${side}2`, t: 0.8 }, to: { bone: `arm${side}2`, t: 0.88 }, r: r(b.arm[1] * 0.5 + 2.5) }] },
        ],
      }))
    : [];
  // (The ponytail's bone where the head's drawing puts it.)
  const tail = m.tail ? [project(m.tail.pivot, vh("profile")), project(m.tail.end, vh("profile"))] : undefined;
  const parts: Record<string, unknown>[] = [
    // Which side of the body faces the camera (set by the `side` control): picks the watch's wrist.
    { id: "sideSwitch", type: "switch", bone: "root", variants: { r: "", l: "" }, default: "r" },
    { id: "shadow", type: "rigid", bone: "ground", art: `<ellipse cx="4" cy="2" rx="${r(b.H * 1.6 + 20)}" ry="${r(8 + b.H * 0.08)}" fill="#000" opacity="0.18"/>` },
    ...(tail ? [{ id: "tailBack", type: "rigid", bone: "tail", art: "tailBack" }] : []),
    { id: "hairBack", type: "rigid", bone: "hair", art: "hairBack" },
    { id: "neck", type: "rigid", bone: "neck", art: "neck" },
    { id: "torso", type: "rigid", bone: "body", art: "torso" },
    // The legs, the hips and a skirt: volumes on the 3D skeleton, drawn from the view every frame
    // (cel shaded, a knee over its shin, one thigh over the other), over the torso only where they
    // are nearer than it.
    legsSolid(m, look, j, anatomy.limbs.calf),
    { id: "earsBack", type: "rigid", bone: "head", art: "earsBack" },
    { id: "head", type: "rigid", bone: "head", art: "head" },
    // The jaw that drops with a gape (`gapeView`): skin over the rest chin, its new lower outline.
    ...jawParts(F, ""),
    { id: "nose", type: "rigid", bone: "head", art: "nose" },
    { id: "eyes", type: "switch", bone: "head", variants: Object.fromEntries(Object.keys(F.eyeVariants).map((k) => [k, `eye_${k}`])), default: "open" },
    { id: "pupils", type: "rigid", bone: "pupils", art: "pupils", visibleWhen: { part: "eyes", variant: ["open", "wide", "half"] } },
    { id: "lids", type: "rigid", bone: "head", art: "lids", visibleWhen: { part: "eyes", variant: "half" } },
    { id: "mouth", type: "morph", bone: "head", fill: "palette(mouth)", stroke: LIPS, strokeWidth: LIPS_W, attrs: { "stroke-linejoin": "round" }, base: F.mouth.base, shapes: F.mouth.shapes },
    // Inside the mouth: clipped by its shape (never past the lips).
    { id: "tongue", type: "morph", bone: "head", fill: "palette(tongue)", base: F.tongue.base, shapes: F.tongue.shapes, clip: "mouth" },
    { id: "teeth", type: "morph", bone: "head", fill: "#ffffff", base: F.teeth.base, shapes: F.teeth.shapes, clip: "mouth" },
    { id: "hairFront", type: "rigid", bone: "hair", art: "hairFront" },
    ...(tail ? [{ id: "tailFront", type: "rigid", bone: "tail", art: "tailFront" }] : []),
    { id: "earsFront", type: "rigid", bone: "head", art: "earsFront" },
    // The nose, a moustache, glasses: over the mouth and over the hair at the sides of the face.
    { id: "over", type: "rigid", bone: "head", art: "over" },
    { id: "brows", type: "morph", bone: "head", fill: "palette(brow)", base: F.brows.base, shapes: F.brows.shapes },
    armsSolid,
    ...watchSolids,
    { id: "handB", type: "switch", bone: "handB", variants: { open: "handB_open", fist: "handB_fist", point: "handB_point", grip: "handB_grip" }, default: style.hands },
    { id: "handF", type: "switch", bone: "handF", variants: { open: "handF_open", fist: "handF_fist", point: "handF_point", grip: "handF_grip" }, default: style.hands },
  ];

  // Secondary motion, as in hand-drawn animation: the body jiggles, forearms and the head drag a
  // little behind and settle (follow-through), a ponytail swings, big hair bounces.
  const physics: Record<string, unknown>[] = [
    { type: "jiggle", bone: "body", stiffness: anatomy.physics.body[0], damping: anatomy.physics.body[1], translate: 0.04, squash: 0.03 },
    { type: "spring", bones: ["armF2"], stiffness: anatomy.physics.forearms[0], damping: anatomy.physics.forearms[1], gravity: [0, 0], inertia: 0.35 },
    { type: "spring", bones: ["armB2"], stiffness: anatomy.physics.forearms[0], damping: anatomy.physics.forearms[1], gravity: [0, 0], inertia: 0.35 },
    { type: "spring", bones: ["head"], stiffness: anatomy.physics.head[0], damping: anatomy.physics.head[1], gravity: [0, 0], inertia: 0.15 },
    ...(tail ? [{ type: "spring", bones: ["tail"], stiffness: anatomy.physics.tail[0], damping: anatomy.physics.tail[1], gravity: [0, 260], inertia: 0.7 }] : []),
    ...(m.bouncy ? [{ type: "jiggle", bone: "hair", stiffness: anatomy.physics.hair[0], damping: anatomy.physics.hair[1], translate: 0.05, squash: 0.06 }] : []),
  ];

  const skeleton = [
    { id: "root" },
    { id: "ground" },
    { id: "hips", parent: "root", from: [0, r(m.y.hip)], to: [0, r(m.y.hip - 10)], mass: 2 },
    { id: "body", parent: "hips", from: [0, r(m.y.hip)], to: [0, r(m.y.torsoTop)], mass: 2 },
    { id: "neck", parent: "body", from: [0, r(m.y.torsoTop)], to: [0, r(m.y.neckTop)], mass: 1, limits: { rotation: [-25, 25] } },
    { id: "head", parent: "neck", from: [0, r(m.y.neckTop)], to: [0, r(m.y.top)], mass: 1.4, limits: { rotation: [-40, 40] } },
    { id: "hair", parent: "head", from: [0, r(m.y.head)], to: [0, r(m.y.top - u * 0.2)], mass: 0.6 },
    // (The jaw: a 3D bone, nothing drawn on it — see `jawOccluder`.)
    { id: "jaw", parent: "head", from: project(jawFrom, vh("profile")).map(r), to: project(jawTo, vh("profile")).map(r), mass: 0.2 },
    ...(tail ? [{ id: "tail", parent: "head", from: [r(tail[0][0]), r(tail[0][1])], to: [r(tail[1][0]), r(tail[1][1])], mass: 0.4 }] : []),
    // (The pupils' pivot on the drawn eye.)
    { id: "pupils", parent: "head", from: [r(eyeMid[0]), r(eyeMid[1])] },
    ...(["ear", "earB", "mouth", "eye", "top"] as const).map((k) => ({ id: `${k}Pt`, parent: "head", from: [r(headPoints.profile[k][0]), r(headPoints.profile[k][1])] })),
    ...limbBones({ ...j, toeF: 30 * b.shoe, toeB: 30 * b.shoe }),
  ] as { id: string; from?: P; to?: P; parent?: string }[];
  const top2 = look.top2 ?? shade(look.topColor, 0.75);
  const doc = {
    format: "toon",
    version: 1,
    name: look.name,
    // Seated facing the camera: half the thigh shows; skirts sit with the knees together.
    // The anatomy it was made from travels with it (edit it and rebuild with `opts.anatomy`).
    meta: {
      description: `${look.name}: TV-cartoon human (three-quarter view facing right; front, half, side, away and back views)`,
      anatomy,
      // Rules checked on the drawings (the mouth clear of the nose in every drawn angle).
      anatomyIssues: [
        ...checkAnatomy(anatomy).filter((x) => x.severity === "warning"),
        ...(Object.keys(VIEWS) as ViewKey[]).filter((v) => views[v].face.visible && !views[v].face.mouthClear).map((v) => ({ severity: "error", rule: "mouth-nose-view", message: `in the ${v} view a mouth shape still touches the nose or leaves the face` })),
      ],
    },
    palette: {
      ink: INK,
      skin: look.skin,
      skinDark: shade(look.skin, 0.86),
      hair: look.hairColor,
      hairDark: shade(look.hairColor, 0.72),
      top: look.topColor,
      topDark: shade(look.topColor, 0.8),
      top2,
      top2Dark: shade(top2, 0.8),
      pocket: shade(look.topColor, 0.92),
      bottom: look.bottomColor,
      bottomDark: shade(look.bottomColor, 0.8),
      shoes: look.shoeColor ?? (look.shoes === "studded" ? "#232323" : look.shoes === "canvas" ? "#2f6fc0" : look.shoes === "dress" ? "#4a2f22" : "#e84a3c"),
      sole: "#f4f1ea",
      socks: look.socks ?? "#ffffff",
      accent: look.accent ?? "#ff6fa8",
      apron: look.apron ?? "#ffffff",
      // The inside of the mouth is always dark; lipstick colours the lips (the mouth's outline).
      mouth: "#5a1c26",
      lips: look.lipstick ?? "#5a1c26",
      tongue: "#d8606a",
      stripe: look.stripe ?? top2,
      flush: mix(look.skin, "#e0584f", 0.32),
      stubble: mix(look.skin, "#5b6577", 0.2),
      item: look.pocketItem?.color ?? "#f4f1ea",
      band: look.pocketItem?.band ?? "#c8282e",
      earItem: look.earItem === "pencil" ? "#f2c230" : "#f7f5ee",
      hat: look.hatColor ?? "#2f6fc0",
      hatDark: shade(look.hatColor ?? "#2f6fc0", 0.82),
      lapel: shade(top2, 0.88),
      tie: look.tie ?? "#8a1f2b",
      sweater: look.sweater ?? "#f2c230",
      jewel: look.necklace?.color ?? (look.necklace?.kind === "chain" ? "#e2b84a" : "#f7f3ea"),
      strap: look.suspenders ?? "#4a3426",
      watch: look.watch ?? "#d4af37",
      earTip: look.earItem === "pencil" ? "#e8d2a8" : "#d9894a",
      brow: shade(look.hairColor, look.hairColor === "#d8d4cc" ? 0.8 : 0.6),
      veil: look.veil ?? "#ffffff",
      flower: look.boutonniere ?? "#e23d5a",
      cape: look.cape ?? "#c8282e",
    },
    art,
    skeleton,
    parts,
    // (Points on the head are projected the way its drawing is: nearly level, put back on the neck.)
    anchors: {
      head: { bone: "head", at: project([0, m.y.eye - u * 0.1, u * 0.45], vh("profile")).map(r) },
      // Where props fit on the head, in every view (the points move with the drawing).
      ...Object.fromEntries((["ear", "earB", "mouth", "eye", "top"] as const).map((k) => [k, { bone: `${k}Pt`, at: [r(headPoints.profile[k][0]), r(headPoints.profile[k][1])] }])),
      face: { bone: "head", at: project([0, m.y.eye + u * 0.2, u * 0.9], vh("profile")).map(r) },
      // Held props turn with the hand (a phone at the ear, a bottle tipped to the mouth).
      hand: { bone: "handF", at: j.handF, turn: 1 },
      handB: { bone: "handB", at: j.handB, turn: 1 },
      fist: { bone: "handF", at: [r(j.handF[0] + b.hand * 0.8), j.handF[1]], turn: 1 },
    },
    ik: limbIk,
    // 2.5D: the limbs, the torso and the head posed in 3D and projected for every drawn angle, so a
    // pose (sitting, a step towards the camera) reads from any side.
    rig3d: {
      bones: {
        hips: { from: [0, r(m.y.hip), 0], to: [0, r(m.y.hip - 10), 0] },
        body: { from: [0, r(m.y.hip), 0], to: [0, r(m.y.torsoTop), 0] },
        neck: { from: [0, r(m.y.torsoTop), 0], to: [0, r(m.y.neckTop), 0] },
        head: { from: [0, r(m.y.neckTop), 0], to: [0, r(m.y.top), 0] },
        jaw: { from: jawFrom.map(r), to: jawTo.map(r) },
        armF1: { from: j3.shoulderF, to: j3.elbowF }, armF2: { from: j3.elbowF, to: j3.handF },
        armB1: { from: j3.shoulderB, to: j3.elbowB }, armB2: { from: j3.elbowB, to: j3.handB },
        legF1: { from: j3.hipF, to: j3.kneeF }, legF2: { from: j3.kneeF, to: j3.footF },
        legB1: { from: j3.hipB, to: j3.kneeB }, legB2: { from: j3.kneeB, to: j3.footB },
        // The feet point forward (level: they turn with the body, not the shin).
        footF: { from: j3.footF, to: [j3.footF[0], j3.footF[1], r(34 * b.shoe)] },
        footB: { from: j3.footB, to: [j3.footB[0], j3.footB[1], r(34 * b.shoe)] },
      },
      views: Object.fromEntries((Object.keys(VIEWS) as ViewKey[]).map((v) => [v, r((VIEWS[v] * 180) / Math.PI)])),
      pitch: opts.pitch ?? 0,
      chains: [
        // The hands (drawings) by the depth of their forearm.
        { bones: ["armF2"], parts: ["handF"], tip: true, margin: 6, behind: "arms" },
        { bones: ["armB2"], parts: ["handB"], tip: true, margin: 6, behind: "arms" },
      ].map((c) => ({ ...c, parts: c.parts.filter((id) => parts.some((p) => p.id === id)) })),
      front: "handB",
      back: "shadow",
      // Where a reached hand never goes: into the torso or the head, as drawn (a hand's half thickness
      // out of them).
      keepOut: [
        ...[torsoKeepOut(m, b.hand * 0.6)].map(([c, rad]) => ({ bone: "body", at: [r(c[0]), r(c[1] - m.y.hip), r(c[2])], radii: rad.map(r) })),
        // The head as drawn: the cranium with its hair, the face (a hand rests on its surface — on
        // the cheek, at the mouth — never inside it).
        ...headKeepOut(m, b.hand * 0.6).map(([c, rad]) => ({ bone: "head", at: [r(c[0]), r(c[1] - m.y.neckTop), r(c[2])], radii: rad.map(r) })),
      ],
      // Where the director's 3D reaches go: the mouth, the near ear, in front of the chest (a held
      // thing, a little to the near side).
      points: {
        mouth: { bone: "head", at: [0, r(m.y.mouth - m.y.neckTop), r(u * 0.92)] },
        eye: { bone: "head", at: [0, r(m.y.eye - m.y.neckTop), r(u * 0.88)] },
        ear: { bone: "head", at: [r(-u * 0.97), r(m.y.ear - m.y.neckTop), 0] },
        earB: { bone: "head", at: [r(u * 0.97), r(m.y.ear - m.y.neckTop), 0] },
        chest: { bone: "body", at: [r(-b.S * 0.3), r(-b.T * 0.42), r(b.D * (1 + (look.heavy ?? 0) * 0.6) + b.T * 0.32)] },
      },
    },
    physics,
    controls: {
      mouth: { type: "viseme", part: "mouth" },
      // The face looks along +x: `forward` turns the head bone's rest direction (up the neck) there.
      look: { type: "aim", targets: [{ bone: "head", forward: aimForward(skeleton, "head"), maxAngle: 14, weight: 0.35 }, { bone: "pupils", mode: "translate", radius: r(u * 0.06) }] },
      emotion: emotions({
        dead: { "parts.eyes.variant": "dead", "parts.mouth.morph.D": 0.6, "bones.head.rotation": 10 },
        determined: { "parts.eyes.variant": "half", "parts.mouth.morph.frown": 0.4, "parts.brows.morph.cross": 1 },
        calm: { "parts.eyes.variant": "closed", "parts.brows.morph.cross": 0.3 },
        excited: { "parts.eyes.variant": "shine", "parts.mouth.morph.grin": 0.9, "parts.brows.morph.up": 0.8, "bones.head.rotation": -6 },
        annoyed: { "parts.eyes.variant": "half", "parts.mouth.morph.frown": 0.5, "parts.brows.morph.cross": 0.6, "bones.head.rotation": 3 },
        // The cartoon gape (swallow whole, scream, a big yawn): the jaw dropped, eyes wide, brows up.
        // Weighted past 1 (`{ gape: 2 }`) the jaw unhinges.
        gape: { "parts.eyes.variant": "wide", "parts.mouth.morph.gape": 1, "bones.jaw.rotation": JAW_TURN, "parts.brows.morph.up": 1, "bones.head.rotation": -4 },
      }),
      // The jaw on its own: `gape` (weighted: `{ gape: 2 }` unhinges it) or `shut`.
      jaw: { type: "pose", poses: { shut: {}, gape: { "parts.mouth.morph.gape": 1, "bones.jaw.rotation": JAW_TURN } } },
    },
    behaviors: [
      { type: "blink", id: "blink", part: "eyes", open: "open", closed: "closed", interval: [2.2, 4.8], duration: 0.12 },
      { type: "breathe", id: "breathe", bone: "body", amount: 0.012, period: 3.4 },
    ],
    // Gestures with anticipation and overshoot.
    clips: fluid({
      ...characterClips({
        walk: { a: r(26 * (b.L / 200)), lift: r(16 * (b.L / 200)), dur: 0.62, bob: 4, lean: 2, armSwing: 24 },
        run: { a: r(46 * (b.L / 200)), lift: r(28 * (b.L / 200)), dur: 0.42, bob: 8, lean: 8, armSwing: 56 },
        jump: 80,
        hands: true,
        leg: r(Math.abs(j.footF[1] - j.hipF[1])),
        foot: r(30 * b.shoe),
      }),
      ...humanClips(),
    }),
  };
  (doc as { palette: Record<string, string> }).palette = withTones(doc.palette, style.ink ? { ink: style.ink } : {});
  gestures3d(doc as never, { u, top: m.y.top, head: m.y.head, sh: j3.shoulderF[1], sx: -j3.shoulderF[0], T: b.T, W: b.W, hip: m.y.hip, D: b.D, arm: armLen });
  return withTurnaround(doc, views, sx, hx, !!tail, headPoints);
}

/**
 * Gestures in 3D: the clips that bring a hand somewhere (the ear, the mouth, the chin, the eyes, up
 * by the head, in front of the chest) get their arm tracks from 3D reaches to body points for this
 * rig's own proportions — a hand to the ear bends the elbow up beside the head, from any angle, where
 * a 2D arm swing (made for a profile) would go round the front in 3D. Keys are hand targets at
 * fractions of the clip; `null` is the arm at rest.
 *
 * The arm never goes through the head as drawn (`rig3d.keepOut`: the cranium with its hair, the
 * face — for any anatomy, a big head as much as a small one). Every key and in-between is placed in
 * the clip's own pose at that moment (the body's lean, the head's nod: its tracks), the targets on
 * the head (`head`) moving with it; a target is pushed out of the head to its surface (`touch`: a
 * hand resting on the face — on the eyes, under the chin) or a little past it; and where the arm
 * would still cross the head (a hand out of reach above a big head, a forearm across the face) the
 * nearest place where the hand, the elbow and the middle of the forearm are all clear of it is used.
 */
function gestures3d(doc: Record<string, any>, o: { u: number; top: number; head: number; sh: number; sx: number; T: number; W: number; hip: number; D: number; arm: number }) {
  const { u, top, head, sh, sx, T, W, hip, D, arm } = o;
  const P = (n: string): V3 => rig3dPoint(doc as never, {}, n) ?? [0, 0, 0];
  const add = (p: V3, d: V3): V3 => [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
  const sub = (p: V3, d: V3): V3 => [p[0] - d[0], p[1] - d[1], p[2] - d[2]];
  const len = (p: V3) => Math.hypot(p[0], p[1], p[2]);
  const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const mouth = P("mouth"), ear = P("ear"), chest = P("chest"), eye = P("eye");
  type Key = [number, V3 | null];
  const hold = (p: V3): Key[] => [[0, p], [1, p]];
  const visit = (p: V3, a = 0.3, b = 0.7): Key[] => [[0, null], [a, p], [b, p], [1, null]];
  const earHold = add(lerp3(ear, mouth, 0.45), [0, u * 0.3, 0]);
  // Beside the head, a little above its middle and forward (pushed out of the head as drawn).
  const up: V3 = [-(sx + u * 0.35), head - u * 0.2, u * 0.35];
  // `head`: the targets are on the head (they move with its nod); `touch`: the hand rests on it.
  const G: Record<string, { F?: Key[]; B?: Key[]; pole?: (side: number) => V3; body?: [number, number][]; hips?: [number, number][]; duration?: number; head?: boolean; touch?: boolean }> = {
    // Holding a game controller in both hands, thumbs busy (in front of the belly, elbows in).
    gamepad: { duration: 1, F: [[0, [-sx * 0.12, sh + T * 0.55, T * 0.5]], [0.5, [-sx * 0.12, sh + T * 0.55 - 3, T * 0.52]], [1, [-sx * 0.12, sh + T * 0.55, T * 0.5]]], B: [[0, [sx * 0.12, sh + T * 0.55, T * 0.5]], [0.5, [sx * 0.12, sh + T * 0.56, T * 0.48]], [1, [sx * 0.12, sh + T * 0.55, T * 0.5]]], pole: (sd) => [sd * 0.7, 1, -0.3] },
    // Leaning over a pool table: the near hand far forward (the bridge), the far one back by the hip
    // pushing the cue (strokes).
    cue: { duration: 1.6, body: [[0, 28], [1, 28]], F: hold([-sx * 0.25, sh + T * 0.75, arm * 0.95]), B: [[0, [sx * 0.55, sh + T * 0.9, -T * 0.05]], [0.45, [sx * 0.45, sh + T * 0.85, T * 0.3]], [0.6, [sx * 0.45, sh + T * 0.85, T * 0.3]], [1, [sx * 0.55, sh + T * 0.9, -T * 0.05]]], pole: (sd) => [sd * 0.6, 0.6, -0.6] },
    // Dancing: hips swaying with a bounce, the hands up in front swinging in turn.
    groove: { duration: 0.9, body: [[0, -6], [0.5, 6], [1, -6]], hips: [[0, 0], [0.25, 6], [0.5, 0], [0.75, 6], [1, 0]], F: [[0, [-sx * 0.9, sh + T * 0.35, T * 0.45]], [0.5, [-sx * 0.7, sh + T * 0.05, T * 0.5]], [1, [-sx * 0.9, sh + T * 0.35, T * 0.45]]], B: [[0, [sx * 0.7, sh + T * 0.05, T * 0.5]], [0.5, [sx * 0.9, sh + T * 0.35, T * 0.45]], [1, [sx * 0.7, sh + T * 0.05, T * 0.5]]], pole: (sd) => [sd, 0.8, -0.3] },
    phone: { head: true, F: hold(earHold), pole: (sd) => [sd * 0.5, 1, 0.2] },
    smoke: { head: true, F: [[0, null], [0.3, add(mouth, [0, u * 0.1, u * 0.35])], [0.55, add(mouth, [0, u * 0.1, u * 0.35])], [0.85, [-sx * 1.1, sh + T * 0.45, T * 0.35]], [1, null]], pole: (sd) => [sd * 0.5, 1, 0.2] },
    drink: { head: true, F: visit(add(mouth, [0, u * 0.3, u * 0.4]), 0.25, 0.75), pole: (sd) => [sd * 0.5, 1, 0.2] },
    think: { head: true, touch: true, F: hold(add(mouth, [0, u * 0.35, u * 0.2])), pole: (sd) => [sd * 0.4, 1, 0.3] },
    facepalm: { head: true, touch: true, F: visit(add(eye, [0, 0, u * 0.25])), pole: (sd) => [sd * 0.5, 1, 0.2] },
    cry: { head: true, touch: true, F: [[0, add(eye, [-u * 0.25, 0, u * 0.3])], [0.5, add(eye, [-u * 0.25, u * 0.06, u * 0.3])], [1, add(eye, [-u * 0.25, 0, u * 0.3])]], B: [[0, add(eye, [u * 0.25, 0, u * 0.3])], [0.5, add(eye, [u * 0.25, u * 0.06, u * 0.3])], [1, add(eye, [u * 0.25, 0, u * 0.3])]], pole: (sd) => [sd * 0.6, 1, 0.2] },
    wave: { head: true, F: [[0, up], [0.5, add(up, [-u * 0.3, 0, 0])], [1, up]], pole: (sd) => [sd, 0.4, -0.2] },
    scared: { head: true, F: hold(add(mouth, [-u * 0.6, u * 0.5, u * 0.5])), B: hold(add(mouth, [u * 0.6, u * 0.5, u * 0.5])), pole: (sd) => [sd * 0.6, 1, 0.1] },
    clap: { F: [[0, add(chest, [-sx * 0.2, 0, T * 0.15])], [0.5, add(chest, [sx * 0.25 - 4, 0, T * 0.2])], [1, add(chest, [-sx * 0.2, 0, T * 0.15])]], B: [[0, [sx * 0.45, chest[1], chest[2] + T * 0.15]], [0.5, [sx * 0.25 + 4, chest[1], chest[2] + T * 0.2]], [1, [sx * 0.45, chest[1], chest[2] + T * 0.15]]], pole: (sd) => [sd * 0.6, 1, -0.2] },
    cheer: { head: true, F: [[0, [-sx * 1.1, top - u * 0.3, u * 0.2]], [0.5, [-sx * 1.15, top - u * 0.1, u * 0.2]], [1, [-sx * 1.1, top - u * 0.3, u * 0.2]]], B: [[0, [sx * 1.1, top - u * 0.3, u * 0.2]], [0.5, [sx * 1.15, top - u * 0.1, u * 0.2]], [1, [sx * 1.1, top - u * 0.3, u * 0.2]]], pole: (sd) => [sd, 0.3, -0.2] },
    pointUp: { head: true, F: hold([-sx * 0.7, top - u * 0.6, u * 0.25]), pole: (sd) => [sd, 0.3, -0.2] },
    shrug: { F: visit([-(sx + u * 0.6), sh + T * 0.55, T * 0.45], 0.35, 0.7), B: visit([sx + u * 0.6, sh + T * 0.55, T * 0.45], 0.35, 0.7), pole: (sd) => [sd * 0.4, 1, -0.4] },
    point: { F: hold([-sx, sh + T * 0.1, arm * 0.9]), pole: (sd) => [sd * 0.3, 1, -0.2] },
    present: { F: hold([-(sx + arm * 0.5), sh + T * 0.3, arm * 0.6]), pole: (sd) => [sd * 0.3, 1, -0.3] },
    talk: { F: [[0, add(chest, [-sx * 0.3, T * 0.15, T * 0.1])], [0.5, add(chest, [-sx * 0.6, T * 0.05, T * 0.18])], [1, add(chest, [-sx * 0.3, T * 0.15, T * 0.1])]], pole: (sd) => [sd * 0.5, 1, -0.4] },
    sing: { F: [[0, [-sx * 0.9, sh + T * 0.25, T * 0.5]], [0.5, [-sx * 1.2, sh + T * 0.1, T * 0.6]], [1, [-sx * 0.9, sh + T * 0.25, T * 0.5]]], pole: (sd) => [sd * 0.5, 1, -0.4] },
    read: { F: hold([-sx * 0.35, sh + T * 0.4, T * 0.55]), B: hold([sx * 0.35, sh + T * 0.4, T * 0.55]), pole: (sd) => [sd * 0.5, 1, -0.3] },
    laugh: { F: hold([-W * 0.5, hip - T * 0.3, D + T * 0.1]), B: hold([W * 0.5, hip - T * 0.3, D + T * 0.1]), pole: (sd) => [sd * 0.6, 1, -0.4] },
  };

  // The head's keep-outs as posed, and how far out of them a point is (1: on the surface).
  type Posed = ReturnType<typeof rig3dPose>;
  const mv = (m: number[], v: V3): V3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
  const mvT = (m: number[], v: V3): V3 => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
  const keepOut = ((doc.rig3d.keepOut ?? []) as { bone: string; at: V3; radii: V3 }[]).filter((k) => k.bone === "head");
  const frames = (pose: Posed) => keepOut.flatMap((k) => (pose[k.bone] ? [{ c: add(pose[k.bone].from, mv(pose[k.bone].rot, k.at)), rot: pose[k.bone].rot, rad: k.radii }] : []));
  const norm = (l: V3, rad: V3) => Math.hypot(l[0] / rad[0], l[1] / rad[1], l[2] / rad[2]);
  const clearance = (pose: Posed, p: V3) => Math.min(Infinity, ...frames(pose).map((f) => norm(mvT(f.rot, sub(p, f.c)), f.rad)));
  const pushOut = (pose: Posed, p: V3, min: number): V3 => {
    for (let i = 0; i < 6; i++) {
      let moved = false;
      for (const f of frames(pose)) {
        const l = mvT(f.rot, sub(p, f.c)), q = norm(l, f.rad);
        if (q >= min) continue;
        const dir: V3 = q < 1e-6 ? [0, 0, 1] : l, k = min / (norm(dir, f.rad) || 1);
        p = add(f.c, mv(f.rot, [dir[0] * k, dir[1] * k, dir[2] * k]));
        moved = true;
      }
      if (!moved) break;
    }
    return p;
  };
  const rest = rig3dPose(doc as never, {});
  /** A point on the head at rest, where the head is in a pose. */
  const onHead = (pose: Posed, p: V3): V3 => (pose.head && rest.head ? add(pose.head.from, mv(pose.head.rot, sub(p, rest.head.from))) : p);

  for (const [name, g] of Object.entries(G)) {
    // (New gestures are made here; the others take their arm tracks from here.)
    const clip = doc.clips?.[name] ?? (g.duration ? (doc.clips[name] = { duration: g.duration, loop: true, tracks: {} }) : undefined);
    if (!clip) continue;
    if (g.body) clip.tracks["bones.body.rotation"] = g.body.map(([f, v]) => [r(f * clip.duration), v, "sineInOut"]);
    if (g.hips) clip.tracks["bones.hips.y"] = g.hips.map(([f, v]) => [r(f * clip.duration), v, "sineInOut"]);
    const tracks: Record<string, unknown> = Object.fromEntries(Object.entries(clip.tracks as Record<string, unknown>).filter(([k]) => !/^bones\.arm[FB][12]\./.test(k)));
    // The clip's pose of the body and head at a fraction of it (its own tracks: a lean, a nod).
    const own = Object.entries(tracks).flatMap(([k, keys]) => {
      const m = /^bones\.([^.]+)\.(rotation|turn|spread)$/.exec(k);
      return m && doc.rig3d.bones[m[1]] ? [{ bone: m[1], ch: m[2] as "rotation", track: normalizeTrack(keys as never, clip.loop ? { loop: { duration: clip.duration } } : {}) }] : [];
    });
    const poseAt = (f: number) => {
      const v: Record<string, Record<string, number>> = {};
      for (const { bone, ch, track } of own) {
        const x = sampleTrack(track, f * clip.duration);
        if (typeof x === "number") (v[bone] ??= {})[ch] = x;
      }
      return v;
    };
    const min = g.touch ? 1 : 1.03;
    for (const side of ["F", "B"] as const) {
      const keys = g[side];
      if (!keys) continue;
      const sd = side === "F" ? -1 : 1;
      const pole = g.pole?.(sd) ?? [sd * 0.5, 1, -0.3];
      const upper = `arm${side}1`, lower = `arm${side}2`;
      const reach = len(sub(doc.rig3d.bones[upper].to, doc.rig3d.bones[upper].from)) + len(sub(doc.rig3d.bones[lower].to, doc.rig3d.bones[lower].from));
      const restHand = (doc.rig3d.bones[lower].to as V3);
      const ch: Record<string, [number, number, string?][]> = {};
      const last: Record<string, number> = {};
      const put = (f: number, v: Record<string, Record<string, number>>, ease = "linear") => {
        for (const [b, vals] of Object.entries(v)) for (const [k, x0] of Object.entries(vals)) {
          const key = `bones.${b}.${k}`;
          // The short way round from the previous key.
          const x = last[key] === undefined ? x0 : x0 + 360 * Math.round((last[key] - x0) / 360);
          last[key] = x;
          (ch[key] ??= []).push([r(f * clip.duration), r(x), ease]);
        }
      };
      let guess: Record<string, Record<string, number>> | undefined;
      const solveIn = (p: V3, values: Record<string, Record<string, number>>, pl: V3 = pole) => reach3d(doc as never, upper, lower, p, values, pl, guess) as Record<string, Record<string, number>>;
      // The elbow's other ways (out to the side: up by a big head, the forearm stands beside it).
      const poles: V3[] = [pole, [sd, 0.5, 0], [sd, 0.15, -0.1], [sd * 0.7, 1, 0.4]];
      // Where the hand goes for a target in a pose, and the elbow's way: out of the head, the whole
      // arm clear of it — the target itself, else the nearest clear place (the reach turned out to
      // the arm's side, up or down, shorter).
      const place = (p: V3, values: Record<string, Record<string, number>>): { at: V3; pole: V3 } => {
        const pose = rig3dPose(doc as never, values);
        const t0 = pushOut(pose, p, min);
        if (!keepOut.length) return { at: t0, pole };
        const clear = (t: V3, pl: V3) => {
          const arm3 = rig3dPose(doc as never, { ...values, ...solveIn(t, values, pl) })[lower];
          const mid = lerp3(arm3.from, arm3.to, 0.5);
          return len(sub(arm3.to, t)) < 2 && clearance(pose, arm3.to) >= min - 1e-3 && clearance(pose, mid) >= min && clearance(pose, arm3.from) >= min;
        };
        const S = pose[upper].from, d0 = sub(t0, S), l0 = len(d0) || 1;
        const dir: V3 = [d0[0] / l0, d0[1] / l0, d0[2] / l0], rho = Math.min(l0, reach * 0.96);
        const tries: { c: V3; e: number }[] = [{ c: t0, e: 0 }];
        for (const k of [0.15, 0.3, 0.5, 0.75, 1, 1.5, 2.5])
          for (const j of [0, -0.25, 0.25, -0.5])
            for (const s of [1, 0.85, 0.7]) {
              const d = add(dir, [sd * k, j, 0]), dl = len(d);
              const c = pushOut(pose, add(S, [(d[0] / dl) * rho * s, (d[1] / dl) * rho * s, (d[2] / dl) * rho * s]), min);
              if (len(sub(c, S)) <= reach * 0.98) tries.push({ c, e: len(sub(c, t0)) });
            }
        tries.sort((x, y) => x.e - y.e);
        for (const { c } of tries) for (const pl of poles) if (clear(c, pl)) return { at: c, pole: pl };
        return { at: t0, pole };
      };
      const zero = { [upper]: { rotation: 0, spread: 0, turn: 0 }, [lower]: { rotation: 0, turn: 0, spread: 0 } };
      const placed = keys.map(([f, p]) => {
        if (!p) return null;
        const values = poseAt(f);
        return place(g.head ? onHead(rig3dPose(doc as never, values), p) : p, values);
      });
      // The hand travels between the keys along an arc in front of the body (the arm swings round
      // the front, never through the chest or the head), every in-between placed and solved again.
      keys.forEach(([f], i) => {
        if (i > 0) {
          const [f0] = keys[i - 1];
          const a = placed[i - 1]?.at ?? restHand, b = placed[i]?.at ?? restHand;
          const dist = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
          if (dist > 8) for (const k of [0.25, 0.5, 0.75]) {
            const bulge = Math.sin(k * Math.PI) * dist * 0.25, fk = f0 + (f - f0) * k, values = poseAt(fk);
            const q = place([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k + bulge], values);
            put(fk, (guess = solveIn(q.at, values, q.pole)));
          }
        }
        const q = placed[i];
        put(f, q ? (guess = solveIn(q.at, poseAt(f), q.pole)) : (guess = zero), "sineInOut");
      });
      Object.assign(tracks, ch);
    }
    doc.clips[name] = { ...clip, tracks };
  }
}

/**
 * Every colour gets a shadow tone (`<key>Shade`, darker and a little cooler) and a line tone
 * (`<key>Line`, darker than its shadow: coloured lines instead of black ones).
 */
export function withTones(palette: Record<string, string>, o: { ink?: string } = {}): Record<string, string> {
  // Short hex colours (#abc) written out (#aabbcc).
  palette = Object.fromEntries(Object.entries(palette).map(([k, v]) => [k, longHex(v)]));
  const out = { ...palette };
  // One ink for every line (a flat TV cartoon): the `ink` key and every `<key>Line`.
  if (o.ink) out.ink = longHex(o.ink);
  // A painter's shadow layer: the colour multiplied by a dusty rose (warm shadows, never grey);
  // lines multiplied further, a dark tone of the same colour.
  const multiply = (hex: string, m: [number, number, number]) => {
    const n = parseInt(hex.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v, i) => Math.round(v * m[i]));
    return `#${((c[0] << 16) | (c[1] << 8) | c[2]).toString(16).padStart(6, "0")}`;
  };
  for (const [k, v] of Object.entries(palette)) {
    if (!/^#[0-9a-f]{6}$/i.test(v)) continue;
    out[`${k}Shade`] = multiply(v, [0.86, 0.77, 0.8]);
    out[`${k}Line`] = o.ink ? out.ink : multiply(v, [0.46, 0.34, 0.36]);
    // A shadow tone drawn as a base colour (a neck in the head's shadow) is outlined like its colour.
    out[`${k}ShadeLine`] = out[`${k}Line`];
  }
  return out;
}

/** The jaw's parts of a view (`gapeView`): the skin of the dropped lower head, then its outline. */
function jawParts(F: ReturnType<typeof faceView>, s: string): Record<string, unknown>[] {
  return [
    { id: `jaw${s}`, type: "morph", bone: "head", fill: "palette(skin)", base: F.jaw.base, shapes: F.jaw.shapes },
    ...(F.jawShade ? [{ id: `jawShade${s}`, type: "morph", bone: "head", fill: "palette(skinShade)", base: F.jawShade.base, shapes: F.jawShade.shapes }] : []),
    { id: `jawLine${s}`, type: "morph", bone: "head", fill: "none", stroke: "palette(skinLine)", strokeWidth: lw(SW), attrs: { "stroke-linejoin": "round", "stroke-linecap": "round" }, base: F.jawLine.base, shapes: F.jawLine.shapes },
  ];
}

/**
 * The other drawn angles as views (front, half, side, away, back), in turning order: arms and legs
 * move to where each angle puts them, the face parts of each angle follow the same emotions,
 * blinks and lip sync.
 */
function withTurnaround(doc: Record<string, any>, views: Record<ViewKey, { face: ReturnType<typeof faceView> }>, sx: number, hx: number, tail: boolean, headPoints: Record<ViewKey, Record<"ear" | "earB" | "mouth" | "eye" | "top", P2>>): ToonDoc {
  const { stroke: LIPS, strokeWidth: LIPS_W } = doc.parts.find((p: { id: string }) => p.id === "mouth");
  const cq = Math.cos(Q);
  const others = (Object.keys(VIEWS) as ViewKey[]).filter((v) => v !== "profile");
  const viewParts = (v: ViewKey) => {
    const s = SUFFIX[v];
    const before = (id: string, part: Record<string, unknown>) => ({ before: id, part });
    const list = [
      ...(tail ? [before("neck", { id: `tailBack${s}`, type: "rigid", bone: "tail", art: `tailBack${s}` })] : []),
      before("neck", { id: `hairBack${s}`, type: "rigid", bone: "hair", art: `hairBack${s}` }),
      // The torso under the legs' solid (it is drawn over the torso where the legs are nearer).
      before("legs", { id: `neck${s}`, type: "rigid", bone: "neck", art: `neck${s}` }),
      before("legs", { id: `torso${s}`, type: "rigid", bone: "body", art: `torso${s}` }),
      before("arms", { id: `earsBack${s}`, type: "rigid", bone: "head", art: `earsBack${s}` }),
      before("arms", { id: `head${s}`, type: "rigid", bone: "head", art: `head${s}` }),
      ...(views[v].face.visible ? jawParts(views[v].face, s).map((p) => before("arms", p)) : []),
      before("arms", { id: `nose${s}`, type: "rigid", bone: "head", art: `nose${s}` }),
    ];
    const F = views[v].face;
    if (F.visible) {
      for (const [k, art] of Object.entries(F.eyeVariants)) {
        doc.art[`eye${s}_${k}`] = art;
        // (Each angle's eyes follow the main eyes' variant: blinks, emotions.)
        list.push(before("arms", { id: `eye${s}_${k}`, type: "rigid", bone: "head", art: `eye${s}_${k}`, visibleWhen: { part: "eyes", variant: k } }));
      }
      doc.art[`pupils${s}`] = F.pupils;
      doc.art[`lids${s}`] = F.lids;
      list.push(
        before("arms", { id: `pupils${s}`, type: "rigid", bone: "pupils", art: `pupils${s}`, visibleWhen: { part: "eyes", variant: ["open", "wide", "half"] } }),
        before("arms", { id: `lids${s}`, type: "rigid", bone: "head", art: `lids${s}`, visibleWhen: { part: "eyes", variant: "half" } }),
        before("arms", { id: `mouth${s}`, type: "morph", bone: "head", fill: "palette(mouth)", stroke: LIPS, strokeWidth: LIPS_W, attrs: { "stroke-linejoin": "round" }, base: F.mouth.base, shapes: F.mouth.shapes }),
        before("arms", { id: `tongue${s}`, type: "morph", bone: "head", fill: "palette(tongue)", base: F.tongue.base, shapes: F.tongue.shapes, clip: `mouth${s}` }),
        before("arms", { id: `teeth${s}`, type: "morph", bone: "head", fill: "#ffffff", base: F.teeth.base, shapes: F.teeth.shapes, clip: `mouth${s}` }),
      );
    }
    list.push(
      before("arms", { id: `hairFront${s}`, type: "rigid", bone: "hair", art: `hairFront${s}` }),
      ...(tail ? [before("arms", { id: `tailFront${s}`, type: "rigid", bone: "tail", art: `tailFront${s}` })] : []),
      before("arms", { id: `earsFront${s}`, type: "rigid", bone: "head", art: `earsFront${s}` }),
      before("arms", { id: `over${s}`, type: "rigid", bone: "head", art: `over${s}` }),
    );
    if (F.visible) list.push(before("arms", { id: `brows${s}`, type: "morph", bone: "head", fill: "palette(brow)", base: F.brows.base, shapes: F.brows.shapes }));
    return list;
  };
  const face = ["eyes", "pupils", "lids", "mouth", "teeth", "tongue", "jaw", "jawShade", "jawLine", "brows"].filter((id) => doc.parts.some((p: { id: string }) => p.id === id));
  // Where an angle puts the shoulders and hips (relative to the three-quarter skeleton).
  const move = (theta: number, v: ViewKey) => {
    const c = Math.cos(theta);
    const pts = Object.fromEntries((["ear", "earB", "mouth", "eye", "top"] as const).map((k) => [`${k}Pt`, [r(headPoints[v][k][0] - headPoints.profile[k][0]), r(headPoints[v][k][1] - headPoints.profile[k][1])] as P]));
    return { armF1: [r(sx * (cq - c)), 0] as P, armB1: [r(sx * (c - cq)), 0] as P, legF1: [r(hx * (cq - c)), 0] as P, legB1: [r(hx * (c - cq)), 0] as P, ...pts };
  };
  const jaws = ["jaw", "jawShade", "jawLine"].filter((id) => doc.parts.some((p: { id: string }) => p.id === id));
  const spec: ViewSpec = {
    eyes: { center: [0, 0], parts: [] },
    mouth: { center: [0, 0], parts: [] },
    profileOnly: ["hairBack", "neck", "torso", "earsBack", "head", "earsFront", "nose", "over", "hairFront", ...(tail ? ["tailBack", "tailFront"] : [])],
    hide: Object.fromEntries(others.map((v) => [v, face])),
    parts: Object.fromEntries(others.map((v) => [v, viewParts(v)])),
    move: Object.fromEntries(others.map((v) => [v, move(VIEWS[v], v)])),
    // (The jaw's parts have only the `gape` shape: the visemes leave them at rest.)
    mouths: ["teeth", "tongue", ...jaws, ...others.filter((v) => views[v].face.visible).flatMap((v) => ["mouth", "teeth", "tongue", ...jaws].map((k) => `${k}${SUFFIX[v]}`))],
    order: Object.keys(VIEWS),
    // (Running across the frame: three-quarters side-on — fully side-on, a big round head hides the eye.)
    travel: "q64",
  };
  const out = withViews(doc as unknown as ToonDoc, spec) as unknown as Record<string, any>;
  // The mouth control takes the gape as a shape too (`"gape"`, `{ gape: 2 }`: every view's mouth,
  // teeth, tongue and jaw), and `"shut"` (the rest viseme).
  out.controls.mouth.map = { shut: "X" };
  // The limbs are placed by the 3D projection (rig3d): the views' 2D limb moves and foot targets
  // would push the 3D legs and arms off.
  for (const pose of Object.values(out.controls.view.poses as Record<string, Record<string, unknown>>)) {
    for (const k of Object.keys(pose)) if (/^(ik\.foot[FB]\.[xy]|bones\.(arm|leg)[FB]1\.[xy])$/.test(k)) delete pose[k];
  }

  // Facing left (the rig mirrored): the mirrored drawings of the asymmetric details (`side`, set by
  // the scene from the actor's facing).
  const sideLeft: Record<string, unknown> = {};
  for (const p of out.parts) {
    if (p.type !== "rigid" || !/^(hairBack|hairFront|torso)[A-Z]?$/.test(p.id) || typeof p.art !== "string" || !out.art[`${p.art}M`]) continue;
    const key = p.art;
    delete p.art;
    Object.assign(p, { type: "switch", default: "r", variants: { r: key, l: `${key}M` } });
    sideLeft[`parts.${p.id}.variant`] = "l";
  }
  sideLeft["parts.sideSwitch.variant"] = "l";
  // (The control exists when anything depends on the side: a mirrored drawing, a part shown by
  // `sideSwitch` such as a watch.)
  const sided = out.parts.some((p: { visibleWhen?: { part: string } }) => p.visibleWhen?.part === "sideSwitch");
  if (Object.keys(sideLeft).length > 1 || sided) out.controls.side = { type: "pose", poses: { right: {}, left: sideLeft } };
  const suffixes = others.filter((v) => views[v].face.visible).map((v) => SUFFIX[v]);
  for (const pose of [out.controls.emotion, out.controls.jaw].flatMap((c) => Object.values(c.poses as Record<string, Record<string, unknown>>))) {
    for (const [k, v] of Object.entries({ ...pose })) {
      for (const s of ["", ...suffixes]) {
        // (The gape drops the jaw too.)
        if (k.startsWith("parts.mouth.morph.")) for (const part of ["mouth", "teeth", "tongue", ...(k === "parts.mouth.morph.gape" ? jaws : [])]) if (part !== "mouth" || s) pose[k.replace("parts.mouth.", `parts.${part}${s}.`)] = v;
        if (k.startsWith("parts.brows.morph.") && s) pose[k.replace("parts.brows.", `parts.brows${s}.`)] = v;
      }
    }
  }
  withHeadTurn(out, others);
  return out as unknown as ToonDoc;
}

/** Head parts (per view): the head's own drawings, chosen by `headView`. */
const HEAD_PART = /^(hairBack|tailBack|earsBack|head|jawLine|jawShade|jaw|nose|eyes|eye|pupils|lids|mouth|teeth|tongue|over|hairFront|tailFront|earsFront|brows)([A-Z]?)(?:_(.+))?$/;

/**
 * The head turns on its own (a listener looking at whoever speaks while sitting facing the TV): a
 * hidden `headView` switch picks the head's drawings — any drawn angle, or one mirrored (`~q50`:
 * turned the other way) — the `view` control sets it to the body's view, the `head` control
 * overrides it.
 */
function withHeadTurn(out: Record<string, any>, others: ViewKey[]) {
  const viewOf = (suffix: string): ViewKey => (suffix ? others.find((v) => SUFFIX[v] === suffix)! : "profile");
  const mirrorable = (v: ViewKey) => VIEWS[v] > 0.01 && VIEWS[v] < Math.PI - 0.01;
  const names = Object.keys(VIEWS) as ViewKey[];
  const allHead = [...names, ...names.filter(mirrorable).map((v) => `~${v}`)];
  // Mirroring: rigid art wrapped in a flip about the head's centre line (x = 0); morph paths flipped.
  const flipArt = (key: string) => {
    const k = `${key}~`;
    if (!out.art[k]) out.art[k] = `<g transform="scale(-1 1)">${out.art[key] ?? key}</g>`;
    return k;
  };
  const flipPath = (d: string) => pathToString(withPoints(parsePath(d), pathPoints(parsePath(d)).map(([x, y]) => [-x, y] as [number, number])));
  const added: Record<string, any>[] = [];
  const morphMirrors: Record<string, string> = {};
  const gate = (v: string) => ({ part: "headView", variant: v });
  for (const p of out.parts) {
    const m = HEAD_PART.exec(p.id ?? "");
    if (!m) continue;
    const v = viewOf(m[2]);
    const kind = m[1];
    const eyeVariant = kind === "eye" ? m[3] : undefined;
    // Gate on the head view (eye drawings also on the eyes' variant: blinks, emotions).
    const face = kind === "eye" ? { part: "eyes", variant: eyeVariant! } : kind === "pupils" ? { part: "eyes", variant: ["open", "wide", "half"] } : kind === "lids" ? { part: "eyes", variant: "half" } : undefined;
    p.visibleWhen = face ? { ...face, and: gate(v) } : gate(v);
    if (!mirrorable(v)) continue;
    const id = `${p.id}~`;
    let dup: Record<string, any> | undefined;
    if (p.type === "rigid") dup = { ...p, id, art: flipArt(p.art) };
    else if (p.type === "morph") {
      dup = { ...p, id, base: flipPath(p.base), shapes: Object.fromEntries(Object.entries(p.shapes as Record<string, string>).map(([k, d]) => [k, flipPath(d)])), ...(p.clip ? { clip: `${p.clip}~` } : {}) };
      morphMirrors[p.id] = id;
    } else if (p.type === "switch" && kind === "eyes") {
      // The main eyes switch holds the variant: its mirror is one drawing per variant.
      for (const [k, key] of Object.entries(p.variants as Record<string, string>)) added.push({ after: p.id, part: { id: `eyes~_${k}`, type: "rigid", bone: p.bone, art: flipArt(key), visibleWhen: { part: "eyes", variant: k, and: gate(`~${v}`) } } });
    } else if (p.type === "switch") dup = { ...p, id, variants: Object.fromEntries(Object.entries(p.variants as Record<string, string>).map(([k, key]) => [k, flipArt(key)])) };
    if (!dup) continue;
    dup.visibleWhen = face ? { ...face, and: gate(`~${v}`) } : gate(`~${v}`);
    added.push({ after: p.id, part: dup });
  }
  for (const { after, part } of added) out.parts.splice(out.parts.findIndex((q: { id: string }) => q.id === after) + 1, 0, part);
  out.parts.splice(1, 0, { id: "headView", type: "switch", bone: "root", variants: Object.fromEntries(allHead.map((v) => [v, "viewNone"])), default: "profile" });
  // The face's opacity gating per view is replaced by the head view.
  for (const pose of Object.values(out.controls.view.poses as Record<string, Record<string, unknown>>)) {
    for (const k of Object.keys(pose)) {
      const m = /^parts\.([^.]+)\.opacity$/.exec(k);
      if (m && HEAD_PART.test(m[1])) delete pose[k];
    }
  }
  for (const [v, pose] of Object.entries(out.controls.view.poses as Record<string, Record<string, unknown>>)) pose["parts.headView.variant"] = v;
  // Emotions, visemes and the asymmetric side drive the mirrored parts too.
  for (const pose of [out.controls.emotion, out.controls.jaw].flatMap((c) => Object.values(c.poses as Record<string, Record<string, unknown>>))) {
    for (const [k, val] of Object.entries({ ...pose })) {
      const m = /^parts\.([^.]+)\.(morph\..+)$/.exec(k);
      if (m && morphMirrors[m[1]]) pose[`parts.${morphMirrors[m[1]]}.${m[2]}`] = val;
    }
  }
  const mouths = out.controls.mouth.part as string | string[];
  out.controls.mouth.part = [...(Array.isArray(mouths) ? mouths : [mouths]), ...Object.entries(morphMirrors).filter(([id]) => /^(mouth|teeth|tongue|jaw)/.test(id)).map(([, id]) => id)];
  const side = out.controls.side?.poses?.left as Record<string, unknown> | undefined;
  if (side) for (const [k, val] of Object.entries({ ...side })) {
    const m = /^parts\.([^.]+)\.variant$/.exec(k);
    if (m && out.parts.some((q: { id: string }) => q.id === `${m[1]}~`)) side[`parts.${m[1]}~.variant`] = val;
  }
  // The head's points (where props fit: the mouth, an ear…) go with the head's drawing, not the
  // body's view: the head control sets them (override) for its angle, mirrored ones flipped about the
  // head's middle.
  const pts = (["ear", "earB", "mouth", "eye", "top"] as const).filter((k) => out.skeleton.some((b: { id: string }) => b.id === `${k}Pt`));
  const fromX = (k: string) => (out.skeleton.find((b: { id: string; from?: number[] }) => b.id === `${k}Pt`)?.from?.[0] ?? 0) as number;
  const ptPose = (v: string): Record<string, number> => {
    const mirror = v.startsWith("~"), base = mirror ? v.slice(1) : v;
    const vp = (out.controls.view.poses[base] ?? {}) as Record<string, number>;
    const o: Record<string, number> = {};
    // (Offsets are in the head bone's frame: turned to setup space to mirror them.)
    const hb = out.skeleton.find((b: { id: string }) => b.id === "head") as { from: number[]; to: number[] };
    const th = Math.atan2(hb.to[1] - hb.from[1], hb.to[0] - hb.from[0]), c = Math.cos(th), sn = Math.sin(th);
    for (const k of pts) {
      const dx = vp[`bones.${k}Pt.x`] ?? 0, dy = vp[`bones.${k}Pt.y`] ?? 0;
      if (!mirror) {
        o[`bones.${k}Pt.x`] = r(dx);
        o[`bones.${k}Pt.y`] = r(dy);
        continue;
      }
      const sx = dx * c - dy * sn, sy = dx * sn + dy * c;
      const mx = -2 * fromX(k) - sx, my = sy;
      o[`bones.${k}Pt.x`] = r(mx * c + my * sn);
      o[`bones.${k}Pt.y`] = r(-mx * sn + my * c);
    }
    return o;
  };
  out.controls.head = { type: "pose", override: true, poses: Object.fromEntries(allHead.map((v) => [v, { "parts.headView.variant": v, ...ptPose(v) }])) };
}

/**
 * Director measurements of a cartoon character: the skeleton's (`rigInfo`), its `extent` and
 * `height` measured from the character as drawn at rest in the main view (`drawnBounds`: a big
 * head, hair, a cap's peak, a belly — whatever the anatomy draws; the doc was built at its pitch),
 * the body's half depth from its anatomy.
 */
export function cartoonInfo(doc: ToonDoc, look: CartoonLook, opts: CartoonOptions = {}): RigInfo {
  const a = opts.anatomy ?? (doc.meta as { anatomy?: CartoonAnatomy } | undefined)?.anatomy ?? styledAnatomy(cartoonAnatomy(look), opts.style, look);
  const D = a.body.depth;
  return rigInfo(doc, { depth: { back: D, front: D * (1 + (look.heavy ?? 0) * 0.6) } });
}

