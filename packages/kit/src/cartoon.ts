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
import type { ToonDoc } from "@animestudio/core";
import { humanClips } from "./human";
import { type P, cartoonHands, characterClips, emotions, fluid, limbBones, limbIk, mouthInside, mouthShapes } from "./rig";
import { type RigInfo, rigInfo } from "./info";
import { type ViewSpec, withViews } from "./views";
import {
  type Box3, type Cast, type Grid, type P2, type Sdf, type V3,
  above, blend, box, bumpy, capsule, cast, contours, depthOf, ellipsoid, fieldPath, grow, gridFor, intersect, normal, onSurface, project, surfaceZ,
  smoothPath, smoothstep, sphere, taper, union,
} from "./volume";

export type CartoonBuild = "child" | "kid" | "teen" | "woman" | "man" | "big" | "elder";
export type CartoonHair =
  | "bowl" | "sidePart" | "afro" | "puffs" | "ponytail" | "long" | "perm" | "mullet"
  | "buzz" | "bald" | "bun" | "braids" | "rollers" | "tuft" | "receding" | "slick" | "bob" | "curtains" | "spiky";
export type CartoonHat = "cap" | "capBack" | "flatCap";
export type CartoonNose = "button" | "round" | "long" | "wide";
export type CartoonJaw = "round" | "square" | "pointy" | "chubby";
export type CartoonTop =
  | "tee" | "stripes" | "polo" | "shirt" | "tank" | "jersey" | "blouse" | "dress" | "overalls" | "jacket" | "cardigan" | "blazer";
export type CartoonBottom = "pants" | "shorts" | "bermuda" | "skirt" | "longSkirt";
/** A print on the top: horizontal stripes, thin vertical stripes (a dress shirt), checks. */
export type CartoonPattern = "stripes" | "pinstripes" | "checks";
export type CartoonShoes = "sneakers" | "studded" | "canvas" | "flipflops" | "dress" | "heels" | "sandals";

export interface CartoonLook {
  name: string;
  build: CartoonBuild;
  /** Belly (0..1). */
  heavy?: number;
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
  /** Something in the shirt pocket, sticking out (a small box: a pack of cards, cigarettes…): its colour and top band. */
  pocketItem?: { color: string; band?: string };
  /** Something resting behind the ear: a pencil or a cigarette. */
  earItem?: "pencil" | "cigarette";
  /** Rosy nose and cheeks (a cold, the sun, a drink). */
  flushed?: boolean;
  /** A shadow of beard on the jaw and upper lip. */
  stubble?: boolean;
}

interface Build {
  /** Hip height, torso length, neck length, head radius (cranium half width). */
  L: number; T: number; n: number; u: number;
  /** Shoulder, waist and hip half widths, body half depth. */
  S: number; W: number; H: number; D: number;
  arm: [number, number]; leg: [number, number]; hand: number; shoe: number; eye: number;
}

const BUILDS: Record<CartoonBuild, Build> = {
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
/** The three-quarter angle of the main view. */
const Q = (36 * Math.PI) / 180;
const deg = (d: number) => (d * Math.PI) / 180;
/** Drawn angles, in turning order (the in-betweens make turns fluid). */
const VIEWS = { front: 0, half: deg(16), profile: Q, side: deg(90), away: deg(135), back: Math.PI } as const;
type ViewKey = keyof typeof VIEWS;
const SUFFIX: Record<ViewKey, string> = { front: "F", half: "H", profile: "", side: "S", away: "A", back: "K" };

const r = (n: number) => Math.round(n * 100) / 100;
const st = (w = SW) => `stroke="palette(ink)" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
/** Outline in a dark tone of a palette colour (`<key>Line`). */
const stc = (key: string, w = SW) => `stroke="palette(${key}Line)" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
const shade = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (s: number) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * k)));
  return `#${((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, "0")}`;
};
/** The line colour that goes with a fill (`palette(x)` → `palette(xLine)`). */
const LINE = (fill: string) => fill.replace(/palette\(([^)]+)\)/, (_, k: string) => `palette(${k.replace(/Shade$|Dark$/, "")}Line)`);
/** Blends two colours. */
const mix = (a: string, b: string, t: number) => {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const c = [16, 8, 0].map((sh) => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t));
  return `#${((c[0] << 16) | (c[1] << 8) | c[2]).toString(16).padStart(6, "0")}`;
};
const pts = (p: P2[]) => p.map((q) => `${r(q[0])} ${r(q[1])}`).join(" L");

// ------------------------------------------------------------------ the model

interface Model {
  b: Build;
  /** Key heights. */
  y: { hip: number; waist: number; shoulder: number; torsoTop: number; neckTop: number; head: number; eye: number; brow: number; nose: number; mouth: number; ear: number; top: number };
  head: Sdf;
  ears: Sdf;
  hair: Sdf;
  hairColor: (p: V3) => string;
  /** A ponytail on its own spring bone: the volume, where it is tied and where it ends. */
  tail?: { sdf: Sdf; color: (p: V3) => string; pivot: V3; end: V3 };
  /** Big hair that bounces (perm, afro, puffs, long hair). */
  bouncy: boolean;
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
}

/** Eye half height (as drawn). */
const m_ry = (u: number) => u * 0.235;

function model(look: CartoonLook): Model {
  const base = BUILDS[look.build];
  const k = look.tall ?? 1;
  const b: Build = { ...base, L: base.L * k, T: base.T * k };
  const heavy = look.heavy ?? 0;
  const u = b.u;
  const L = b.L, T = b.T;
  const W = b.W * (look.female ? 0.86 : 1) + heavy * b.W * 0.35;
  const H = b.H * (look.female ? 1.04 : 1) + heavy * b.H * 0.2;
  const hip = -L, waist = -L - T * 0.1, torsoTop = -L - T, shoulder = torsoTop + T * 0.1;
  const neckTop = torsoTop - b.n;
  const hy = neckTop - u * 0.92;
  const eye = { x: u * 0.3, rx: u * 0.185 * b.eye, ry: u * 0.235 * b.eye };
  const ey = hy + u * 0.12;
  const y = {
    hip, waist, shoulder, torsoTop, neckTop, head: hy, eye: ey, brow: ey - eye.ry - u * 0.13,
    nose: hy + u * 0.5, mouth: hy + u * 0.82, ear: hy + u * 0.3, top: hy - u * 1.14,
  };

  // Head: a cranium and a face (jaw), blended.
  const cranium = ellipsoid([0, hy - u * 0.12, -u * 0.08], [u, u * 1.02, u]);
  const jaw = look.jaw ?? "round";
  const face =
    jaw === "square" ? blend(u * 0.18, ellipsoid([0, hy + u * 0.42, u * 0.1], [u * 0.86, u * 0.7, u * 0.8]), ellipsoid([-u * 0.46, hy + u * 0.74, u * 0.02], [u * 0.36, u * 0.32, u * 0.5]), ellipsoid([u * 0.46, hy + u * 0.74, u * 0.02], [u * 0.36, u * 0.32, u * 0.5]), ellipsoid([0, hy + u * 0.92, u * 0.32], [u * 0.36, u * 0.24, u * 0.36]))
      : jaw === "pointy" ? blend(u * 0.2, ellipsoid([0, hy + u * 0.42, u * 0.1], [u * 0.74, u * 0.7, u * 0.76]), ellipsoid([0, hy + u * 0.9, u * 0.3], [u * 0.24, u * 0.24, u * 0.3]))
        : jaw === "chubby" ? ellipsoid([0, hy + u * 0.42, u * 0.1], [u * 0.94, u * 0.72, u * 0.86])
          : ellipsoid([0, hy + u * 0.42, u * 0.1], [u * 0.8, u * 0.72, u * 0.8]);
  const skullFace = blend(u * 0.3, cranium, face);
  // A nose with volume (it catches the light and casts a shadow), on the face.
  const zn = surfaceZ(skullFace, 0, y.nose) ?? u * 0.8;
  const noseKind = look.nose ?? "button";
  const nose =
    noseKind === "round" ? ellipsoid([0, y.nose, zn + u * 0.09], [u * 0.22, u * 0.18, u * 0.22])
      : noseKind === "long" ? blend(u * 0.06, ellipsoid([0, y.nose - u * 0.14, zn], [u * 0.1, u * 0.26, u * 0.15]), ellipsoid([0, y.nose + u * 0.02, zn + u * 0.12], [u * 0.13, u * 0.11, u * 0.15]))
        : noseKind === "wide" ? ellipsoid([0, y.nose, zn + u * 0.03], [u * 0.24, u * 0.15, u * 0.17])
          : ellipsoid([0, y.nose, zn + u * 0.05], [u * 0.17, u * 0.15, u * 0.19]);
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
      const quiff = ellipsoid([-u * 0.22, hy - u * 0.92, u * 0.22], [u * 0.8, u * 0.34, u * 0.74]);
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
      if (look.hairLine) hairColor = (p) => (p[0] < -u * 0.5 && Math.abs(p[1] - (hy - u * 0.42 + (p[2] / u) * u * 0.12)) < u * 0.035 ? "skin" : "hair");
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
  if (look.hat) {
    // Hats sit on the hair: the crown over the skull, a peak (cap) or a short brim (flat cap).
    const crown = look.hat === "flatCap"
      ? ellipsoid([0, hy - u * 0.72, u * 0.05], [u * 1.16, u * 0.46, u * 1.22])
      : intersect(grow(skull, u * 0.16), (x, yy) => yy - (hy - u * 0.32));
    const back = look.hat === "capBack" ? -1 : 1;
    const peak = look.hat === "flatCap"
      ? intersect(ellipsoid([0, hy - u * 0.5, u * 0.78], [u * 0.75, u * 0.08, u * 0.42]), (x, yy, z) => u * 0.6 - z)
      : intersect(ellipsoid([0, hy - u * 0.4 - (back < 0 ? u * 0.08 : 0), back * u * 0.95], [u * 0.66, u * 0.065, u * 0.62]), (x, yy, z) => back * (u * 0.55 - z));
    const hat = union(crown, peak);
    const under = hair, prevColor = hairColor;
    hair = union(intersect(under, (x, yy, z) => -crown(x, yy, z) + 0.5), hat);
    hairColor = (p) => (hat(p[0], p[1], p[2]) < 0.6 ? (peak(p[0], p[1], p[2]) < 0.6 ? "hatDark" : "hat") : prevColor(p));
  }
  if (look.earItem) {
    // Resting in the fold above the near ear; its tip (a filter, a sharpened point) towards the face.
    const pencil = look.earItem === "pencil";
    const a: V3 = [-u * 1.04, y.ear - u * 0.26, -u * 0.48], c: V3 = [-u * 1.0, y.ear - u * 0.38, u * (pencil ? 0.42 : 0.32)];
    const item = capsule(a, c, u * (pencil ? 0.055 : 0.05), u * (pencil ? 0.02 : 0.05));
    const styled2 = hair, prev = hairColor;
    hair = union(styled2, item);
    hairColor = (p) => (item(p[0], p[1], p[2]) < 0.6 ? (p[2] > u * (pencil ? 0.28 : 0.12) ? "earTip" : "earItem") : prev(p));
  }

  // Neck and torso (the pelvis is part of it: the trousers' top).
  const neckR = u * (look.build === "big" ? 0.5 : look.build === "man" ? 0.36 : 0.26) * (1 + heavy * 0.2);
  const neck = capsule([0, torsoTop + 10, -b.D * 0.15], [0, hy + u * 0.55, -u * 0.12], neckR);
  const sh = look.top === "blouse" ? b.arm[0] * 1.05 : b.arm[0] * 0.75;
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
        return Math.floor((yy - torsoTop) / (T * 0.13)) % 2 ? "top2" : "top";
      case "jersey":
        if (nearNeck || (z > 0 && Math.abs(x) < (torsoTop + T * 0.24 - yy) * 0.5)) return "top2";
        return Math.floor((x + b.S * 2) / (b.S * 0.32)) % 2 ? "top2" : "top";
      case "polo":
        if (z > 0 && Math.abs(x) < neckR * 1.9 && yy < torsoTop + T * 0.16) return "top2";
        return "top";
      case "shirt":
        if (z > 0 && Math.abs(x) < neckR * 1.8 && yy < torsoTop + T * 0.14) return "top2";
        // The breast pocket is on the wearer's left.
        if (z > 0 && x > b.S * 0.22 && x < b.S * 0.62 && yy > -L - T * 0.76 && yy < -L - T * 0.56) return "pocket";
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
    if (look.pattern === "stripes") return Math.floor((yy - torsoTop) / (T * 0.13)) % 2 ? "stripe" : k;
    return (Math.floor(around / period) + Math.floor((yy - torsoTop) / period)) % 2 ? "stripe" : k;
  };
  // Something in the pocket: the part inside is covered by the pocket.
  const pocketTop = -L - T * 0.76, pocketX = b.S * 0.42;
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
  const torsoColor = (p: V3): string => extras(p, torsoBase(p));
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
    if (look.stubble && z > -u * 0.25 && yy > y.nose + u * 0.12 && !(Math.abs(x) < u * 0.42 && Math.abs(yy - y.mouth) < u * 0.07) && nose(x, yy, z) > u * 0.02) return "stubble";
    return "skin";
  };
  return { b, y, head, headColor, ears, nose, hair, hairColor, tail, torsoItem: item, bouncy: ["perm", "afro", "puffs", "long", "braids"].includes(look.hair), neck, neckR, torso: union(torsoCut, ...(item ? [item] : []), ...(sweater ? [sweater] : [])), torsoColor, skirt, skirtColor, eye, mouthW: u * 0.31 };
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

interface PieceOpts {
  sdf: Sdf;
  theta: number;
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
}

/**
 * A volume drawn flat, the way a cartoon is painted: the fill, its colour regions, cel shading
 * (the side turned away from the light, cast shadows) and an outline in a dark tone of its colour.
 */
function piece(c: Cast, g: Grid, o: PieceOpts): string {
  const field = o.field ?? c.val;
  const outline = fieldPath(field, g);
  if (!outline) return "";
  const n = g.w * g.h;
  const ct = Math.cos(o.theta), sn = Math.sin(o.theta);
  const key: string[] = new Array(n);
  const light = new Float32Array(n).fill(1);
  const keys = new Set<string>([o.base]);
  for (let i = 0; i < n; i++) {
    if (field[i] > 0 || Number.isNaN(c.hit[i * 3])) continue;
    const p: V3 = [c.hit[i * 3], c.hit[i * 3 + 1], c.hit[i * 3 + 2]];
    key[i] = o.color ? o.color(p) : o.base;
    keys.add(key[i]);
    const nm = normal(o.sdf, p, o.smooth);
    const nx = nm[0] * ct + nm[2] * sn, nz = -nm[0] * sn + nm[2] * ct;
    light[i] = nx * LIGHT[0] + nm[1] * LIGHT[1] + nz * LIGHT[2] - SHADE_AT;
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
  for (const k of keys) {
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++) f[i] = key[i] === k ? light[i] * 20 : 1;
    const d = fieldPath(f, g, 6);
    if (d) out += `<path d="${d}" fill="palette(${k}Shade)" fill-rule="evenodd"/>`;
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
      d += " " + smoothPath(loop.filter((_, i) => i % 2 === 0).map(([i, j]) => [g.x0 + i * g.step, g.y0 + j * g.step] as P2));
      continue;
    }
    const start = ok.indexOf(false);
    let run: P2[] = [];
    const flush = () => {
      if (run.length > 3) {
        const p = run.filter((_, i) => i % 2 === 0 || i === run.length - 1);
        d += ` M${r(p[0][0])} ${r(p[0][1])}` + p.slice(1).map((q, i) => (i < p.length - 2 ? ` Q${r(q[0])} ${r(q[1])} ${r((q[0] + p[i + 2][0]) / 2)} ${r((q[1] + p[i + 2][1]) / 2)}` : ` L${r(q[0])} ${r(q[1])}`)).join("");
      }
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
  /** Screen bounds of everything drawn (for the measurements). */
  bounds: [number, number, number, number];
}

function headView(m: Model, theta: number): HeadView {
  const u = m.b.u;
  const box: Box3 = { x: [-u * 2, u * 2], y: [m.y.top - u * 0.9, m.y.head + u * 2.4], z: [-u * 1.9, u * 1.6] };
  const g = gridFor([box], theta, u / 26);
  const head = cast(m.head, g, theta), hair = cast(m.hair, g, theta), ears = cast(m.ears, g, theta);
  const n = g.w * g.h;
  // In front of the head: hair nearer than the face (spilling a little past its outline, so the
  // head's outline does not show through), and ears that stick out of the face (3/4 view).
  const front = new Float32Array(n), earF = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // Head and ears together: what the hair can be in front of.
    const hv = Math.min(head.val[i], ears.val[i]), hd = Math.max(head.depth[i], ears.depth[i]);
    const both = hv < 0 && hair.val[i] < 0;
    front[i] = Math.max(hair.val[i], hv - 3.2, both ? hd - hair.depth[i] : -Infinity);
    earF[i] = Math.max(ears.val[i], head.val[i] < 0 ? head.depth[i] - ears.depth[i] : 1, hair.val[i] < 0 ? hair.depth[i] - ears.depth[i] : -Infinity);
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
  // The nose: outlined only where it stands out of the face (a jump in depth), like a drawn nose.
  const noseField = new Float32Array(n).fill(1);
  if (m.nose) for (let i = 0; i < n; i++) if (head.val[i] < 0 && !Number.isNaN(head.hit[i * 3]) && m.nose(head.hit[i * 3], head.hit[i * 3 + 1], head.hit[i * 3 + 2]) < u * 0.02) noseField[i] = -1;
  const jump = (i: number, j: number) => {
    let d = 0;
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0]]) d = Math.max(d, Math.abs(at(head.depth, i + a, j + b) - at(head.depth, i, j)));
    return d > g.step * 2;
  };
  const noseLine = theta < 1.6 ? strokeWhere(noseField, g, (i, j) => jump(i, j) && at(front, i, j) > 0) : "";
  const tailArt = m.tail ? piece(cast(m.tail.sdf, g, theta), g, { sdf: m.tail.sdf, theta, color: m.tail.color, base: "hair", edges: ["accent"] }) : "";
  const tailInFront = !!m.tail && depthOf(m.tail.pivot, theta) > depthOf([0, m.y.head, 0], theta) + u * 0.2;
  // The front hair's outline is drawn against the face only, not where it meets the hair behind.
  const keepHair = (i: number, j: number) => !(at(hair.val, i, j) < -2 && at(head.val, i, j) > -1.5) && !(at(hair.val, i + 1, j) < -2 && at(hair.val, i - 1, j) < -2 && at(hair.val, i, j + 1) < -2 && at(hair.val, i, j - 1) < -2 && at(head.val, i, j) > -4);
  return {
    hairBack: piece(hair, g, { sdf: m.hair, theta, color: m.hairColor, base: "hair", edges: ["accent", "earItem", "earTip", "hat", "hatDark"], smooth: u * 0.18 }),
    earsBack: piece(ears, g, { sdf: m.ears, theta, base: "skin" }),
    head: piece(head, g, { sdf: m.head, theta, color: m.headColor, base: "skin", shadow: underHair }) + (noseLine ? `<path d="${noseLine}" fill="none" ${stc("skin", 2.2)}/>` : ""),
    earsFront: theta > 0.2 && theta < 2 ? piece(ears, g, { sdf: m.ears, theta, base: "skin", field: earF }) : "",
    hairFront: piece(hair, g, { sdf: m.hair, theta, color: m.hairColor, base: "hair", edges: ["accent", "earItem", "earTip", "hat", "hatDark"], field: front, keep: keepHair, smooth: u * 0.18 }),
    tailBack: tailArt && !tailInFront ? tailArt : "",
    tailFront: tailArt && tailInFront ? tailArt : "",
    bounds: [x0, y0, x1, y1],
  };
}

function bodyView(m: Model, look: CartoonLook, theta: number) {
  const { b } = m;
  const box: Box3 = { x: [-b.S - 30, b.S + 30], y: [m.y.torsoTop - 12, m.y.hip + b.T * 0.3], z: [-b.D * 1.2, b.D * 2.2] };
  const g = gridFor([box], theta, 2);
  const edges = ["pocket", "apron", "item", "band", "sweater", "lapel", "tie", "strap", ...(["polo", "shirt", "jacket", "cardigan"].includes(look.top) ? ["top2"] : []), ...(look.top === "overalls" ? ["bottom"] : [])];
  const tc = cast(m.torso, g, theta);
  // The head and neck shade the top of the chest.
  const neckShadow = (k: number) => {
    const i = k % g.w, j = Math.floor(k / g.w);
    const X = g.x0 + i * g.step, Y = g.y0 + j * g.step;
    return ((X - 2) / (m.neckR * 1.7)) ** 2 + ((Y - m.y.torsoTop) / (b.T * 0.13)) ** 2 < 1;
  };
  const torso = piece(tc, g, { sdf: m.torso, theta, color: m.torsoColor, base: "top", edges, shadow: neckShadow });
  const nb: Box3 = { x: [-m.neckR - 4, m.neckR + 4], y: [m.y.torsoTop - 4, m.y.head + m.b.u * 0.7], z: [-m.b.u, m.b.u * 0.5] };
  const ng = gridFor([nb], theta, 1.5);
  // The neck is in the head's shadow.
  const neck = piece(cast(m.neck, ng, theta), ng, { sdf: m.neck, theta, base: "skinShade", line: "skin" });
  let skirt = "";
  if (m.skirt) {
    const sb: Box3 = { x: [-b.H * 2 - 20, b.H * 2 + 20], y: [m.y.waist - 8, 0], z: [-b.D * 2, b.D * 2.4] };
    const sg = gridFor([sb], theta, 2);
    skirt = piece(cast(m.skirt, sg, theta), sg, { sdf: m.skirt, theta, color: m.skirtColor, base: m.skirtColor?.([0, m.y.hip, 0]) ?? "bottom", edges: ["apron"] });
  }
  return { torso, neck, skirt };
}

/** Face features of a view: eye variants, pupils, lids, mouth and brow shapes, nose, extras. */
function faceView(m: Model, look: CartoonLook, theta: number) {
  const u = m.b.u;
  const s = onSurface(m.head, theta);
  const { x: ex, rx, ry } = m.eye;
  const ey = m.y.eye;
  const ring = (cx: number, cy: number, ax: number, ay: number, lift = 0, n = 28) =>
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return s.point(cx + Math.cos(a) * ax, cy + Math.sin(a) * ay, lift);
    });
  const curve = (p: P2[]) => `M${r(p[0][0])} ${r(p[0][1])}` + p.slice(1).map((q) => ` L${r(q[0])} ${r(q[1])}`).join("");
  const eyes = [-1, 1].map((side) => side * ex);
  const vis = eyes.map((x) => s.visible(x, ey));
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
  const pupilR = u * 0.075 * m.b.eye;
  const pupil = (k = 1) =>
    each((x) => {
      const c = s.point(x, ey + ry * 0.08);
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
  const L = s.point(-m.mouthW, m.y.mouth), R = s.point(m.mouthW, m.y.mouth);
  const mouth = mouthShapes(L as P, R as P, (u / 50) * 1.05);
  const inside = mouthInside(L as P, R as P, (u / 50) * 1.05);

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
      const lens = (x: number) => Array.from({ length: 24 }, (_, i) => {
        const a = (i / 24) * Math.PI * 2;
        const c = Math.cos(a), sn = Math.sin(a);
        // A rounded square.
        const kx = Math.sign(c) * Math.abs(c) ** 0.6, ky = Math.sign(sn) * Math.abs(sn) ** 0.6;
        return s.point(x + kx * rx * 1.35, ey + ky * ry * 1.05, u * 0.1);
      });
      const bridgeA = s.point(-ex + rx * 1.35, ey - ry * 0.2, u * 0.1), bridgeB = s.point(ex - rx * 1.35, ey - ry * 0.2, u * 0.1);
      const tint = look.glasses === "sun" ? `fill="#1e2228" fill-opacity="0.9"` : `fill="#cfe8f5" fill-opacity="0.28"`;
      over += eyes.map((x, i) => (vis[i] ? `<path d="M${pts(lens(x))} Z" ${tint} ${st(3)}/>` : "")).join("") + `<path d="M${r(bridgeA[0])} ${r(bridgeA[1])} L${r(bridgeB[0])} ${r(bridgeB[1])}" ${st(3)}/>`;
      if (theta > 0.2) {
        const a = s.point(-ex - rx * 1.35, ey - ry * 0.2, u * 0.1), e = project([-u * 0.92, ey - ry * 0.1, -u * 0.02], theta);
        over += `<path d="M${r(a[0])} ${r(a[1])} L${r(e[0])} ${r(e[1])}" ${st(3)}/>`;
      }
    }
  }
  if (look.earrings) {
    for (const sx of [-1, 1]) {
      const p3: V3 = [sx * u * 1.0, m.y.ear + u * 0.3, -u * 0.06];
      if (theta > 0.2 && theta < 2 && sx > 0) continue; // the far ear is hidden
      const p = project(p3, theta);
      extras += `<circle cx="${r(p[0])}" cy="${r(p[1])}" r="${r(u * 0.07)}" fill="palette(accent)" ${st(2)}/>`;
    }
  }
  const visible = theta < 1.6;
  return { eyeVariants, pupils: pupil(), lids, brows, mouth, teeth: inside.teeth, tongue: inside.tongue, nose, extras, over, visible };
}

// ------------------------------------------------------------------ shoes, sleeves, shorts

function shoeArt(look: CartoonLook, k: number) {
  const s = (d: string) => d.replace(/-?\d+(\.\d+)?/g, (n) => String(r(Number(n) * k)));
  const sole = `<path d="${s("M-20 4 H44")}" stroke="palette(sole)" stroke-width="${r(5 * k)}" stroke-linecap="round"/>`;
  const sneaker = s("M-18 -18 C-10 -26 12 -24 24 -14 C38 -10 48 -4 46 4 L-20 4 C-24 -4 -22 -12 -18 -18 Z");
  switch (look.shoes) {
    case "studded":
      return `<path d="${sneaker}" fill="palette(shoes)" ${stc("shoes", 2.6)}/>${sole}` + [-12, 0, 12, 24, 36].map((x) => `<circle cx="${r(x * k)}" cy="${r(9 * k)}" r="${r(2.6 * k)}" fill="palette(sole)" ${stc("shoes", 1.2)}/>`).join("") + `<path d="${s("M6 -20 L16 -10 M12 -22 L22 -12")}" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>`;
    case "canvas":
      return `<path d="${sneaker}" fill="palette(shoes)" ${stc("shoes", 2.6)}/><path d="${s("M28 -12 C40 -8 48 -2 46 4 L26 4 C28 -2 28 -8 28 -12 Z")}" fill="palette(sole)" ${stc("shoes", 2)}/>${sole}`;
    case "flipflops":
      return `<path d="${s("M-16 -14 C-8 -20 22 -16 36 -8 C44 -4 44 2 38 2 L-16 2 C-20 -4 -20 -10 -16 -14 Z")}" fill="palette(skin)" ${stc("skin", 2.4)}/><path d="${s("M-20 3 H44")}" stroke="palette(shoes)" stroke-width="${r(6 * k)}" stroke-linecap="round"/><path d="${s("M4 -14 L22 0")}" stroke="palette(shoes)" stroke-width="${r(4 * k)}" stroke-linecap="round"/>`;
    case "dress":
      return `<path d="${s("M-16 -16 C-6 -22 16 -18 28 -10 C40 -6 46 0 42 4 L-18 4 C-22 -4 -20 -12 -16 -16 Z")}" fill="palette(shoes)" ${stc("shoes", 2.6)}/><path d="${s("M8 -14 Q16 -10 22 -10")}" fill="none" stroke="#fff" stroke-opacity="0.35" stroke-width="2.4" stroke-linecap="round"/>`;
    case "heels":
      return `<path d="${s("M-14 -12 C-6 -18 18 -12 30 -4 C38 0 40 4 36 6 L4 6 L-2 -2 L-8 14 L-14 14 L-14 -12 Z")}" fill="palette(shoes)" ${stc("shoes", 2.6)}/>`;
    case "sandals":
      return `<path d="${s("M-16 -14 C-8 -20 20 -16 34 -8 C42 -4 42 2 36 2 L-16 2 C-20 -4 -20 -10 -16 -14 Z")}" fill="palette(skin)" ${stc("skin", 2.4)}/><path d="${s("M-20 3 H42")}" stroke="palette(shoes)" stroke-width="${r(6 * k)}" stroke-linecap="round"/><path d="${s("M-6 -16 L-4 0 M10 -14 L14 0 M26 -10 L28 0")}" stroke="palette(shoes)" stroke-width="${r(5 * k)}" stroke-linecap="round"/>`;
    default:
      return `<path d="${sneaker}" fill="palette(shoes)" ${stc("shoes", 2.6)}/>${sole}<path d="${s("M2 -22 L10 -12 M8 -24 L16 -14")}" stroke="palette(sole)" stroke-width="2.4" stroke-linecap="round"/>`;
  }
}

/**
 * A skirt follows the thighs (Spine-style skinning): every path of its art becomes a skinned part
 * weighted between the hips and the thighs — seated sideways it drapes over the thighs, walking it
 * sways. Facing the camera or seen from behind it stays on the hips (it covers the lap).
 */
const SKIRT_BONES: Record<ViewKey, string[]> = {
  profile: ["hips", "legF1", "legB1"], side: ["hips", "legF1", "legB1"],
  // Facing the camera the thighs are foreshortened (squashed): the skirt just covers the lap.
  front: ["hips"], half: ["hips"], away: ["hips"], back: ["hips"],
};
function skinnedArt(id: string, art: string, bones: string[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const [k, m] of [...art.matchAll(/<path ([^>]*?)\/>/g)].entries()) {
    const attrs: Record<string, string> = {};
    for (const a of m[1].matchAll(/([a-z-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    const { d, fill, stroke, "stroke-width": sw, ...rest } = attrs;
    if (!d) continue;
    out.push({ id: `${id}_${k}`, type: "skinned", path: d, bones, ...(fill ? { fill } : {}), ...(stroke ? { stroke } : {}), ...(sw ? { strokeWidth: Number(sw) } : {}), ...(Object.keys(rest).length ? { attrs: rest } : {}) });
  }
  return out;
}

/**
 * A thigh seen end-on in perspective (sitting facing the camera): narrow where it leaves the hip,
 * wider towards the knee (nearer the camera), the knee a round end.
 */
function thigh(a: P, b: P, w0: number, w1: number, fill: string) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
  const p = (t: number, w: number, s: number): P2 => [a[0] + dx * t + nx * w * s, a[1] + dy * t + ny * w * s];
  const knee: P2 = [b[0] + ux * w1 * 1.1, b[1] + uy * w1 * 1.1];
  const q = [p(0, w0, 1), p(0.92, w1, 1), p(0.92, w1, -1), p(0, w0, -1)];
  const top: P2 = [a[0] - ux * w0 * 0.6, a[1] - uy * w0 * 0.6];
  // The sides and the knee are outlined; the top melts into the body (no line across the hips).
  const sides = `M${r(q[0][0])} ${r(q[0][1])} L${r(q[1][0])} ${r(q[1][1])} C${r(q[1][0] + ux * w1 * 1.2)} ${r(q[1][1] + uy * w1 * 1.2)} ${r(knee[0] + nx * w1 * 0.6)} ${r(knee[1] + ny * w1 * 0.6)} ${r(knee[0])} ${r(knee[1])} C${r(knee[0] - nx * w1 * 0.6)} ${r(knee[1] - ny * w1 * 0.6)} ${r(q[2][0] + ux * w1 * 1.2)} ${r(q[2][1] + uy * w1 * 1.2)} ${r(q[2][0])} ${r(q[2][1])} L${r(q[3][0])} ${r(q[3][1])}`;
  return `<path d="${sides} Q${r(top[0])} ${r(top[1])} ${r(q[0][0])} ${r(q[0][1])} Z" fill="${fill}"/><path d="${sides}" fill="none" stroke="${LINE(fill)}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>`;
}

/** A capsule along a bone segment from `a` to `b` (rounded at both ends), half width `w`. */
function pill(a: P, b: P, w: number, fill: string) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
  const p = (t: number, s: number): P2 => [a[0] + dx * t + nx * w * s, a[1] + dy * t + ny * w * s];
  const e0: P2 = [a[0] - ux * w * 1.2, a[1] - uy * w * 1.2], e1: P2 = [b[0] + ux * w * 1.3, b[1] + uy * w * 1.3];
  const q = [p(0, 1), p(1, 1), p(1, -1), p(0, -1)];
  return `<path d="M${r(q[0][0])} ${r(q[0][1])} L${r(q[1][0])} ${r(q[1][1])} Q${r(e1[0] + nx * w)} ${r(e1[1] + ny * w)} ${r(e1[0])} ${r(e1[1])} Q${r(e1[0] - nx * w)} ${r(e1[1] - ny * w)} ${r(q[2][0])} ${r(q[2][1])} L${r(q[3][0])} ${r(q[3][1])} Q${r(e0[0] - nx * w)} ${r(e0[1] - ny * w)} ${r(e0[0])} ${r(e0[1])} Q${r(e0[0] + nx * w)} ${r(e0[1] + ny * w)} ${r(q[0][0])} ${r(q[0][1])} Z" fill="${fill}" stroke="${LINE(fill)}" stroke-width="2.6" stroke-linejoin="round"/>`;
}

/** Shoes seen from the front (pointing at the camera): the toe box, the sole, the laces. */
function shoeFrontArt(look: CartoonLook, k: number) {
  const s = (d: string) => d.replace(/-?\d+(\.\d+)?/g, (n) => String(r(Number(n) * k)));
  const box = s("M-15 -16 C-18 -2 -15 5 0 6 C15 5 18 -2 15 -16 C9 -22 -9 -22 -15 -16 Z");
  switch (look.shoes) {
    case "flipflops":
    case "sandals":
      return `<path d="${s("M-11 -14 C-14 -2 -11 4 0 5 C11 4 14 -2 11 -14 C6 -18 -6 -18 -11 -14 Z")}" fill="palette(skin)" ${stc("skin", 2.4)}/><path d="${s("M-14 6 H14")}" stroke="palette(shoes)" stroke-width="${r(5 * k)}" stroke-linecap="round"/><path d="${s("M-8 -10 L0 -2 L8 -10")}" fill="none" stroke="palette(shoes)" stroke-width="${r(4 * k)}" stroke-linecap="round"/>`;
    case "heels":
    case "dress":
      return `<path d="${s("M-12 -14 C-15 -2 -12 4 0 5 C12 4 15 -2 12 -14 C7 -18 -7 -18 -12 -14 Z")}" fill="palette(shoes)" ${stc("shoes", 2.4)}/>`;
    default:
      return `<path d="${box}" fill="palette(shoes)" ${stc("shoes", 2.6)}/><path d="${s("M-16 5 H16")}" stroke="palette(sole)" stroke-width="${r(5 * k)}" stroke-linecap="round"/>` +
        `<path d="${s("M-5 -15 L5 -11 M-5 -11 L5 -7")}" stroke="palette(sole)" stroke-width="2" stroke-linecap="round"/>`;
  }
}

/** A tube piece around a bone segment from `a` towards `b` (sleeves, shorts legs, socks). */
function cuff(a: P, b: P, from: number, to: number, w0: number, w1: number, fill: string, sw = 3, stripes = 0) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
  const p = (t: number, w: number, s: number): P2 => [a[0] + dx * t + nx * w * s, a[1] + dy * t + ny * w * s];
  const q = [p(from, w0, 1), p(to, w1, 1), p(to, w1, -1), p(from, w0, -1)];
  // A rounded top (the shoulder), straight sides, a straight opening.
  const cap = p(from - (w0 * 1.3) / len, 0, 0);
  return `<path d="M${r(q[0][0])} ${r(q[0][1])} L${r(q[1][0])} ${r(q[1][1])} L${r(q[2][0])} ${r(q[2][1])} L${r(q[3][0])} ${r(q[3][1])} Q${r(cap[0])} ${r(cap[1])} ${r(q[0][0])} ${r(q[0][1])} Z" fill="${fill}" stroke="${LINE(fill)}" stroke-width="${sw}" stroke-linejoin="round"/>` +
    // Thin stripes along the tube (a striped shirt's sleeve).
    Array.from({ length: stripes }, (_, k) => {
      const f = -1 + (2 * (k + 1)) / (stripes + 1);
      const s0 = p(from + 0.06, w0 * f, 1), s1 = p(to - 0.02, w1 * f, 1);
      return `<path d="M${r(s0[0])} ${r(s0[1])} L${r(s1[0])} ${r(s1[1])}" stroke="palette(stripe)" stroke-width="1.8"/>`;
    }).join("");
}

// ------------------------------------------------------------------ the builder

export function cartoonCharacter(look: CartoonLook): ToonDoc {
  const m = model(look);
  const { b } = m;
  const u = b.u;
  const cq = Math.cos(Q), sq = Math.sin(Q);
  const at = (x: number, y: number, z = 0): P => [r(x * cq + z * sq), r(y)];

  // Joints (front-view model) → the three-quarter skeleton.
  const sx = b.S - b.arm[0] * 0.35, hx = b.H * 0.5;
  const armLen = b.T * 0.9 + b.L * 0.34;
  const shY = m.y.shoulder + 4;
  const ankle = 12 * b.shoe;
  const j = {
    shoulderF: at(-sx, shY), elbowF: at(-sx - 3, shY + armLen * 0.5, 4), handF: at(-sx - 4, shY + armLen, 8),
    shoulderB: at(sx, shY), elbowB: at(sx + 3, shY + armLen * 0.5, 4), handB: at(sx + 4, shY + armLen, 8),
    hipF: at(-hx, m.y.hip), kneeF: at(-hx, m.y.hip / 2, 6), footF: at(-hx, -ankle),
    hipB: at(hx, m.y.hip), kneeB: at(hx, m.y.hip / 2, 6), footB: at(hx, -ankle),
  };
  const eyeMid = project([0, m.y.eye, u * 0.9], Q);

  const views = Object.fromEntries((Object.keys(VIEWS) as ViewKey[]).map((v) => [v, { head: headView(m, VIEWS[v]), body: bodyView(m, look, VIEWS[v]), face: faceView(m, look, VIEWS[v]) }])) as Record<ViewKey, { head: HeadView; body: ReturnType<typeof bodyView>; face: ReturnType<typeof faceView> }>;

  const longSleeves = ["jacket", "cardigan", "blazer"].includes(look.top);
  const sleeveColor = longSleeves ? "palette(top2)" : "palette(top)";
  const shortSleeves = !longSleeves && !["tank", "overalls", "dress"].includes(look.top) || look.top === "overalls";
  const bareLegs = look.bottom !== "pants";
  const shorts = look.bottom === "shorts" || look.bottom === "bermuda";
  // Seated facing the camera the thigh shows 60% of its length (seen from a little above) and is
  // widened by 1/0.6 across: at the knee it is a little wider than the shin.
  const skirted = look.bottom === "skirt" || look.bottom === "longSkirt";
  const lapW = (b.leg[0] * 0.74 * 0.5) * (1 + (look.heavy ?? 0) * 0.25) * (skirted ? 1.3 : 1);
  // A skirt over the lap falls past the knees: a drape on each shin (they overlap: one hem).
  const kneeHalf = lapW / 0.5;
  const drape = (knee: P, foot: P) => cuff(knee, foot, -0.04, look.bottom === "longSkirt" ? 0.78 : 0.38, kneeHalf * 1.05, kneeHalf * 1.3, look.top === "dress" ? "palette(top)" : "palette(bottom)", 2.6);
  const shortsTo = look.bottom === "bermuda" ? 0.9 : 0.45;

  const art: Record<string, string> = {
    shoe: shoeArt(look, b.shoe),
    shoeFront: shoeFrontArt(look, b.shoe),
    ...Object.fromEntries(Object.entries(cartoonHands(j.handF, { r: b.hand * 1.45, fill: "palette(skin)", line: "palette(skinLine)", stroke: 2.2 })).map(([k, v]) => [`handF_${k}`, v])),
    ...Object.fromEntries(Object.entries(cartoonHands(j.handB, { r: b.hand * 1.4, fill: "palette(skinShade)", line: "palette(skinLine)", stroke: 2.2 })).map(([k, v]) => [`handB_${k}`, v])),
  };
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
    art[`nose${s}`] = V.face.nose + V.face.extras;
    art[`over${s}`] = V.face.over;
  }
  const F = views.profile.face;
  for (const [k, v] of Object.entries(F.eyeVariants)) art[`eye_${k}`] = v;
  art.pupils = F.pupils;
  art.lids = F.lids;

  const sleeve = (a: P, e: P, fill: string) => cuff(a, e, 0, 0.46, b.arm[0] * 0.5 + 4, b.arm[0] * 0.5 + 9, fill, 3, look.pattern === "pinstripes" ? 3 : 0);
  const tail = m.tail ? [project(m.tail.pivot, Q), project(m.tail.end, Q)] : undefined;
  const parts: Record<string, unknown>[] = [
    { id: "shadow", type: "rigid", bone: "ground", art: `<ellipse cx="4" cy="2" rx="${r(b.H * 1.6 + 20)}" ry="${r(8 + b.H * 0.08)}" fill="#000" opacity="0.18"/>` },
    ...(tail ? [{ id: "tailBack", type: "rigid", bone: "tail", art: "tailBack" }] : []),
    { id: "hairBack", type: "rigid", bone: "hair", art: "hairBack" },
    { id: "legB", type: "hose", bones: ["legB1", "legB2"], width: b.leg, fill: bareLegs ? "palette(skinShade)" : "palette(bottomShade)", stroke: bareLegs ? "palette(skinLine)" : "palette(bottomLine)", strokeWidth: SW },
    ...(look.socks ? [{ id: "sockB", type: "rigid", bone: "legB2", art: cuff(j.kneeB, j.footB, 0.8, 1.02, b.leg[1] * 0.5 + 1.5, b.leg[1] * 0.5 + 2, "palette(socks)", 2.6) }] : []),
    { id: "shoeB", type: "switch", bone: "footB", variants: { side: "shoe", front: "shoeFront" }, default: "side", space: "bone" },
    ...(shorts ? [{ id: "shortsB", type: "rigid", bone: "legB1", art: cuff(j.hipB, j.kneeB, -0.15, shortsTo, b.leg[0] * 0.5 + 5, b.leg[0] * 0.5 + 6, "palette(bottomDark)") }] : []),
    { id: "armB", type: "hose", bones: ["armB1", "armB2"], width: b.arm, fill: longSleeves ? "palette(top2Shade)" : "palette(skinShade)", stroke: longSleeves ? "palette(top2Line)" : "palette(skinLine)", strokeWidth: SW },
    { id: "handB", type: "switch", bone: "handB", variants: { open: "handB_open", fist: "handB_fist", point: "handB_point", grip: "handB_grip" }, default: "fist" },
    ...(shortSleeves ? [{ id: "sleeveB", type: "rigid", bone: "armB1", art: sleeve(j.shoulderB, j.elbowB, "palette(topDark)") }] : []),
    { id: "legF", type: "hose", bones: ["legF1", "legF2"], width: b.leg, fill: bareLegs ? "palette(skin)" : "palette(bottom)", stroke: bareLegs ? "palette(skinLine)" : "palette(bottomLine)", strokeWidth: SW },
    ...(look.socks ? [{ id: "sockF", type: "rigid", bone: "legF2", art: cuff(j.kneeF, j.footF, 0.8, 1.02, b.leg[1] * 0.5 + 1.5, b.leg[1] * 0.5 + 2, "palette(socks)", 2.6) }] : []),
    { id: "shoeF", type: "switch", bone: "footF", variants: { side: "shoe", front: "shoeFront" }, default: "side", space: "bone" },
    ...(shorts ? [{ id: "shortsF", type: "rigid", bone: "legF1", art: cuff(j.hipF, j.kneeF, -0.15, shortsTo, b.leg[0] * 0.5 + 5, b.leg[0] * 0.5 + 6, "palette(bottom)") }] : []),
    // Both thighs together are as wide as the hips (a lap, as in a sitcom sofa shot); drawn in setup
    // space, then widened 2.5× by the thigh's squash.
    // Thighs seen end-on when sitting facing the camera (shown by the director's `sit` with view
    // front): a rounded lap, the knee at its end; the thigh bone's squash makes it short and round.
    ...(["B", "F"] as const).map((side) => {
      const hip = side === "F" ? j.hipF : j.hipB, knee = side === "F" ? j.kneeF : j.kneeB;
      const covered = look.bottom === "pants" || shorts || look.bottom === "skirt" || look.bottom === "longSkirt";
      const fill = covered ? (look.bottom === "skirt" || look.bottom === "longSkirt" ? (look.top === "dress" ? "palette(top)" : "palette(bottom)") : "palette(bottom)") : "palette(skin)";
      return { id: `lap${side}`, type: "switch", bone: `leg${side}1`, default: "off", variants: { off: "", on: thigh([hip[0], hip[1] - (knee[1] - hip[1]) * 0.25], knee, lapW * 0.7, lapW, side === "B" ? fill.replace(")", "Shade)") : fill) } };
    }),
    ...(skirted ? (["B", "F"] as const).map((side) => ({ id: `drape${side}`, type: "switch", bone: `leg${side}2`, default: "off", variants: { off: "", on: drape(side === "F" ? j.kneeF : j.kneeB, side === "F" ? j.footF : j.footB) } })) : []),
    { id: "neck", type: "rigid", bone: "neck", art: "neck" },
    { id: "torso", type: "rigid", bone: "body", art: "torso" },
    ...skinnedArt("skirt", art.skirt, SKIRT_BONES.profile),
    { id: "earsBack", type: "rigid", bone: "head", art: "earsBack" },
    { id: "head", type: "rigid", bone: "head", art: "head" },
    { id: "nose", type: "rigid", bone: "head", art: "nose" },
    { id: "eyes", type: "switch", bone: "head", variants: Object.fromEntries(Object.keys(F.eyeVariants).map((k) => [k, `eye_${k}`])), default: "open" },
    { id: "pupils", type: "rigid", bone: "pupils", art: "pupils", visibleWhen: { part: "eyes", variant: ["open", "wide", "half"] } },
    { id: "lids", type: "rigid", bone: "head", art: "lids", visibleWhen: { part: "eyes", variant: "half" } },
    { id: "mouth", type: "morph", bone: "head", fill: "palette(mouth)", stroke: "palette(mouthLine)", strokeWidth: 2.4, attrs: { "stroke-linejoin": "round" }, base: F.mouth.base, shapes: F.mouth.shapes },
    { id: "tongue", type: "morph", bone: "head", fill: "palette(tongue)", base: F.tongue.base, shapes: F.tongue.shapes },
    { id: "teeth", type: "morph", bone: "head", fill: "#ffffff", base: F.teeth.base, shapes: F.teeth.shapes },
    { id: "over", type: "rigid", bone: "head", art: "over" },
    { id: "hairFront", type: "rigid", bone: "hair", art: "hairFront" },
    ...(tail ? [{ id: "tailFront", type: "rigid", bone: "tail", art: "tailFront" }] : []),
    { id: "earsFront", type: "rigid", bone: "head", art: "earsFront" },
    { id: "brows", type: "morph", bone: "head", fill: "palette(brow)", base: F.brows.base, shapes: F.brows.shapes },
    { id: "armF", type: "hose", bones: ["armF1", "armF2"], width: b.arm, fill: longSleeves ? "palette(top2)" : "palette(skin)", stroke: longSleeves ? "palette(top2Line)" : "palette(skinLine)", strokeWidth: SW },
    ...(look.watch ? [{ id: "watch", type: "rigid", bone: "armF2", art: cuff(j.elbowF, j.handF, 0.8, 0.9, b.arm[1] * 0.5 + 2.5, b.arm[1] * 0.5 + 2.5, "palette(watch)", 2) }] : []),
    { id: "handF", type: "switch", bone: "handF", variants: { open: "handF_open", fist: "handF_fist", point: "handF_point", grip: "handF_grip" }, default: "fist" },
    ...(shortSleeves ? [{ id: "sleeveF", type: "rigid", bone: "armF1", art: sleeve(j.shoulderF, j.elbowF, look.top === "overalls" ? "palette(top)" : sleeveColor) }] : []),
  ];

  // Secondary motion, as in hand-drawn animation: the body jiggles, forearms and the head drag a
  // little behind and settle (follow-through), a ponytail swings, big hair bounces.
  const physics: Record<string, unknown>[] = [
    { type: "jiggle", bone: "body", stiffness: 0.75, damping: 0.6, translate: 0.04, squash: 0.03 },
    { type: "spring", bones: ["armF2"], stiffness: 0.55, damping: 0.45, gravity: [0, 0], inertia: 0.35 },
    { type: "spring", bones: ["armB2"], stiffness: 0.55, damping: 0.45, gravity: [0, 0], inertia: 0.35 },
    { type: "spring", bones: ["head"], stiffness: 0.7, damping: 0.55, gravity: [0, 0], inertia: 0.15 },
    ...(tail ? [{ type: "spring", bones: ["tail"], stiffness: 0.32, damping: 0.25, gravity: [0, 260], inertia: 0.7 }] : []),
    ...(m.bouncy ? [{ type: "jiggle", bone: "hair", stiffness: 0.45, damping: 0.35, translate: 0.05, squash: 0.06 }] : []),
  ];

  const top2 = look.top2 ?? shade(look.topColor, 0.75);
  const doc = {
    format: "toon",
    version: 1,
    name: look.name,
    // Seated facing the camera: half the thigh shows; skirts sit with the knees together.
    meta: { sitFront: { thigh: 0.5, spread: look.bottom === "skirt" || look.bottom === "longSkirt" ? 0.9 : 1.5 }, description: `${look.name}: TV-cartoon human (three-quarter view facing right; front, half, side, away and back views)` },
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
      mouth: look.lipstick ?? "#5a1c26",
      tongue: "#d8606a",
      stripe: look.stripe ?? top2,
      flush: mix(look.skin, "#e0584f", 0.32),
      stubble: mix(look.skin, "#5b6577", 0.28),
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
    },
    art,
    skeleton: [
      { id: "root" },
      { id: "ground" },
      { id: "hips", parent: "root", from: [0, r(m.y.hip)], to: [0, r(m.y.hip - 10)], mass: 2 },
      { id: "body", parent: "hips", from: [0, r(m.y.hip)], to: [0, r(m.y.torsoTop)], mass: 2 },
      { id: "neck", parent: "body", from: [0, r(m.y.torsoTop)], to: [0, r(m.y.neckTop)], mass: 1, limits: { rotation: [-25, 25] } },
      { id: "head", parent: "neck", from: [0, r(m.y.neckTop)], to: [0, r(m.y.top)], mass: 1.4, limits: { rotation: [-40, 40] } },
      { id: "hair", parent: "head", from: [0, r(m.y.head)], to: [0, r(m.y.top - u * 0.2)], mass: 0.6 },
      ...(tail ? [{ id: "tail", parent: "head", from: [r(tail[0][0]), r(tail[0][1])], to: [r(tail[1][0]), r(tail[1][1])], mass: 0.4 }] : []),
      { id: "pupils", parent: "head", from: [r(eyeMid[0]), r(m.y.eye)] },
      ...limbBones({ ...j, toeF: 30 * b.shoe, toeB: 30 * b.shoe }),
    ],
    parts,
    anchors: {
      head: { bone: "head", at: [r(eyeMid[0] * 0.5), r(m.y.eye - u * 0.1)] },
      face: { bone: "head", at: [r(eyeMid[0]), r(m.y.eye + u * 0.2)] },
      // Held props turn with the hand (a phone at the ear, a bottle tipped to the mouth).
      hand: { bone: "handF", at: j.handF, turn: 1 },
      handB: { bone: "handB", at: j.handB, turn: 1 },
      fist: { bone: "handF", at: [r(j.handF[0] + b.hand * 0.8), j.handF[1]], turn: 1 },
    },
    ik: limbIk,
    physics,
    controls: {
      mouth: { type: "viseme", part: "mouth" },
      look: { type: "aim", targets: [{ bone: "head", forward: -80, maxAngle: 14, weight: 0.35 }, { bone: "pupils", mode: "translate", radius: r(u * 0.06) }] },
      emotion: emotions({
        dead: { "parts.eyes.variant": "dead", "parts.mouth.morph.D": 0.6, "bones.head.rotation": 10 },
        determined: { "parts.eyes.variant": "half", "parts.mouth.morph.frown": 0.4, "parts.brows.morph.cross": 1 },
        calm: { "parts.eyes.variant": "closed", "parts.brows.morph.cross": 0.3 },
        excited: { "parts.eyes.variant": "shine", "parts.mouth.morph.grin": 0.9, "parts.brows.morph.up": 0.8, "bones.head.rotation": -6 },
        annoyed: { "parts.eyes.variant": "half", "parts.mouth.morph.frown": 0.5, "parts.brows.morph.cross": 0.6, "bones.head.rotation": 3 },
      }),
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
      }),
      ...humanClips(),
    }),
  };
  (doc as { palette: Record<string, string> }).palette = withTones(doc.palette);
  return withTurnaround(doc, views, sx, hx, !!tail);
}

/**
 * Every colour gets a shadow tone (`<key>Shade`, darker and a little cooler) and a line tone
 * (`<key>Line`, darker than its shadow: coloured lines instead of black ones).
 */
function withTones(palette: Record<string, string>): Record<string, string> {
  const out = { ...palette };
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
    out[`${k}Line`] = multiply(v, [0.46, 0.34, 0.36]);
  }
  out.skinShadeLine = out.skinLine;
  return out;
}

/**
 * The other drawn angles as views (front, half, side, away, back), in turning order: arms and legs
 * move to where each angle puts them, the face parts of each angle follow the same emotions,
 * blinks and lip sync.
 */
function withTurnaround(doc: Record<string, any>, views: Record<ViewKey, { face: ReturnType<typeof faceView> }>, sx: number, hx: number, tail: boolean): ToonDoc {
  const cq = Math.cos(Q);
  const others = (Object.keys(VIEWS) as ViewKey[]).filter((v) => v !== "profile");
  const viewParts = (v: ViewKey) => {
    const s = SUFFIX[v];
    const before = (id: string, part: Record<string, unknown>) => ({ before: id, part });
    const list = [
      ...(tail ? [before("legB", { id: `tailBack${s}`, type: "rigid", bone: "tail", art: `tailBack${s}` })] : []),
      before("legB", { id: `hairBack${s}`, type: "rigid", bone: "hair", art: `hairBack${s}` }),
      before("armF", { id: `neck${s}`, type: "rigid", bone: "neck", art: `neck${s}` }),
      before("armF", { id: `torso${s}`, type: "rigid", bone: "body", art: `torso${s}` }),
      ...skinnedArt(`skirt${s}`, doc.art[`skirt${s}`], SKIRT_BONES[v]).map((part) => before("armF", part)),
      before("armF", { id: `earsBack${s}`, type: "rigid", bone: "head", art: `earsBack${s}` }),
      before("armF", { id: `head${s}`, type: "rigid", bone: "head", art: `head${s}` }),
      before("armF", { id: `nose${s}`, type: "rigid", bone: "head", art: `nose${s}` }),
    ];
    const F = views[v].face;
    if (F.visible) {
      for (const [k, art] of Object.entries(F.eyeVariants)) {
        doc.art[`eye${s}_${k}`] = art;
        list.push(before("armF", { id: `eye${s}_${k}`, type: "rigid", bone: "head", art: `eye${s}_${k}` }));
      }
      doc.art[`pupils${s}`] = F.pupils;
      doc.art[`lids${s}`] = F.lids;
      list.push(
        before("armF", { id: `pupils${s}`, type: "rigid", bone: "pupils", art: `pupils${s}` }),
        before("armF", { id: `lids${s}`, type: "rigid", bone: "head", art: `lids${s}` }),
        before("armF", { id: `mouth${s}`, type: "morph", bone: "head", fill: "palette(mouth)", stroke: "palette(mouthLine)", strokeWidth: 2.4, attrs: { "stroke-linejoin": "round" }, base: F.mouth.base, shapes: F.mouth.shapes }),
        before("armF", { id: `tongue${s}`, type: "morph", bone: "head", fill: "palette(tongue)", base: F.tongue.base, shapes: F.tongue.shapes }),
        before("armF", { id: `teeth${s}`, type: "morph", bone: "head", fill: "#ffffff", base: F.teeth.base, shapes: F.teeth.shapes }),
      );
    }
    list.push(
      before("armF", { id: `over${s}`, type: "rigid", bone: "head", art: `over${s}` }),
      before("armF", { id: `hairFront${s}`, type: "rigid", bone: "hair", art: `hairFront${s}` }),
      ...(tail ? [before("armF", { id: `tailFront${s}`, type: "rigid", bone: "tail", art: `tailFront${s}` })] : []),
      before("armF", { id: `earsFront${s}`, type: "rigid", bone: "head", art: `earsFront${s}` }),
    );
    if (F.visible) list.push(before("armF", { id: `brows${s}`, type: "morph", bone: "head", fill: "palette(brow)", base: F.brows.base, shapes: F.brows.shapes }));
    return list;
  };
  const face = ["eyes", "pupils", "lids", "mouth", "teeth", "tongue", "brows"];
  // Where an angle puts the shoulders and hips (relative to the three-quarter skeleton).
  const move = (theta: number) => {
    const c = Math.cos(theta);
    return { armF1: [r(sx * (cq - c)), 0] as P, armB1: [r(sx * (c - cq)), 0] as P, legF1: [r(hx * (cq - c)), 0] as P, legB1: [r(hx * (c - cq)), 0] as P };
  };
  const spec: ViewSpec = {
    eyes: { center: [0, 0], parts: [] },
    mouth: { center: [0, 0], parts: [] },
    profileOnly: ["hairBack", ...doc.parts.filter((p: { id: string }) => p.id.startsWith("skirt_")).map((p: { id: string }) => p.id), "neck", "torso", "earsBack", "head", "earsFront", "nose", "over", "hairFront", ...(tail ? ["tailBack", "tailFront"] : [])],
    hide: Object.fromEntries(others.map((v) => [v, face])),
    parts: Object.fromEntries(others.map((v) => [v, viewParts(v)])),
    move: Object.fromEntries(others.map((v) => [v, move(VIEWS[v])])),
    // Seen from the front or from behind, the shoes point at (or away from) the camera.
    extra: Object.fromEntries(others.filter((v) => v !== "side").map((v) => [v, { "parts.shoeF.variant": "front", "parts.shoeB.variant": "front" }])),
    mouths: ["teeth", "tongue", ...others.filter((v) => views[v].face.visible).flatMap((v) => ["mouth", "teeth", "tongue"].map((k) => `${k}${SUFFIX[v]}`))],
    order: Object.keys(VIEWS),
  };
  const out = withViews(doc as unknown as ToonDoc, spec) as unknown as Record<string, any>;
  // Sitting facing the camera (`seat: front`, set by the director): the lap shows, a skirt is
  // replaced by the lap in its colour (it covers the thighs down to the knees).
  const skirtParts = out.parts.filter((p: { id: string }) => /^skirt[A-Z]?_\d+$/.test(p.id)).map((p: { id: string }) => p.id);
  out.controls.seat = {
    type: "pose",
    poses: { none: {}, front: { "parts.lapF.variant": "on", "parts.lapB.variant": "on", ...(skirtParts.length ? { "parts.drapeF.variant": "on", "parts.drapeB.variant": "on" } : {}), "parts.handF.variant": "grip", "parts.handB.variant": "grip", ...Object.fromEntries(skirtParts.map((id: string) => [`parts.${id}.opacity`, -1])) } },
  };
  // The lap (sitting facing the camera) comes out from under the torso: drawn just before the
  // torso of every view (the shirt covers where the thighs start), after the legs.
  const laps = ["drapeB", "drapeF", "lapB", "lapF"].map((id) => out.parts.find((p: { id: string }) => p.id === id)).filter(Boolean);
  out.parts = out.parts.filter((p: { id: string }) => !laps.includes(p));
  out.parts.splice(out.parts.findIndex((p: { id: string }) => p.id === "neck"), 0, ...laps);
  // Each angle's eyes follow the main eyes' variant (blinks, emotions) and show only in their view.
  const gated: Record<string, string[]> = {};
  for (const p of out.parts) {
    const m = /^(eye|pupils|lids)([A-Z])(?:_(.+))?$/.exec(p.id ?? "");
    if (!m) continue;
    const view = others.find((v) => SUFFIX[v] === m[2])!;
    (gated[view] ??= []).push(p.id);
    p.visibleWhen = m[1] === "eye" ? { part: "eyes", variant: m[3] } : m[1] === "pupils" ? { part: "eyes", variant: ["open", "wide", "half"] } : { part: "eyes", variant: "half" };
  }
  for (const [view, pose] of Object.entries(out.controls.view.poses as Record<string, Record<string, unknown>>)) {
    for (const [v, ids] of Object.entries(gated)) if (v !== view) for (const id of ids) pose[`parts.${id}.opacity`] = -1;
  }
  const suffixes = others.filter((v) => views[v].face.visible).map((v) => SUFFIX[v]);
  for (const pose of Object.values(out.controls.emotion.poses as Record<string, Record<string, unknown>>)) {
    for (const [k, v] of Object.entries({ ...pose })) {
      for (const s of ["", ...suffixes]) {
        if (k.startsWith("parts.mouth.morph.")) for (const part of ["mouth", "teeth", "tongue"]) if (part !== "mouth" || s) pose[k.replace("parts.mouth.", `parts.${part}${s}.`)] = v;
        if (k.startsWith("parts.brows.morph.") && s) pose[k.replace("parts.brows.", `parts.brows${s}.`)] = v;
      }
    }
  }
  return out as unknown as ToonDoc;
}

/** Director measurements of a cartoon character. */
export function cartoonInfo(doc: ToonDoc, look: CartoonLook): RigInfo {
  const m = model(look);
  const hv = headView(m, Q);
  return rigInfo(doc, {
    extent: { front: r(Math.max(hv.bounds[2], m.b.S)), back: r(Math.max(-hv.bounds[0], m.b.S)) },
    height: r(-hv.bounds[1]),
    depth: { back: m.b.D, front: m.b.D * (1 + (look.heavy ?? 0) * 0.6) },
  });
}

