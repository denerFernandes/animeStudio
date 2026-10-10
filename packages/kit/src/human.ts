/**
 * Human characters from a short description (`HumanLook`): anime-style, on the kit skeleton
 * (profile facing right, feet at y = 0), with a generated front view, switch hands, every kit clip
 * (gestures, walk/run, the fighting set), emotions (plus `dead`, `determined`, `calm`, `excited`)
 * and big-head proportions. Hair locks, headband tails, scarves and capes are spring bones, so they
 * flow with every movement. `rigInfo(doc, { extent: { front: 85, back: 75 }, height: 470, depth: 26 })`
 * measures it for the director.
 */
import type { ToonDoc } from "@animestudio/core";
import { frontView } from "./humanFront";
import { withProportions } from "./proportions";
import { type P, characterClips, emotions, handShapes, limbBones, limbIk, mouthShapes } from "./rig";

const INK = "#1d1a2b";
const SW = 4;
const r = (n: number) => Math.round(n * 100) / 100;
const stroke = (w = SW) => `stroke="palette(ink)" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;

export type HumanHair = "spiky" | "mane" | "messy" | "ponytail" | "cap" | "hood" | "short" | "curly";
export type HumanOutfit = "tee" | "hoodie" | "gi" | "coat" | "armor";

export interface HumanLook {
  name: string;
  skin: string;
  hair: HumanHair;
  hairColor: string;
  hairTip?: string;
  iris: string;
  outfit: HumanOutfit;
  top: string;
  topDark?: string;
  pants: string;
  shoes: string;
  accent?: string;
  glasses?: boolean;
  /** Glowing eyes (villains). */
  glow?: boolean;
  headband?: string;
  scarf?: string;
  cape?: string;
  /** Broader shoulders and chest (villains, adults). */
  bulk?: number;
}

const shade = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (s: number) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * k)));
  return `#${((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, "0")}`;
};

// ------------------------------------------------------------------ face (profile)

const HEAD = "M-24 -404 C-26 -440 2 -456 28 -455 C52 -454 64 -436 62 -416 L69 -399 C70 -396 66 -394 62 -394 C63 -386 61 -376 53 -367 C44 -359 28 -358 15 -364 C2 -370 -22 -378 -24 -404 Z";
const EYE: P = [47, -404];

function eyes(look: HumanLook) {
  const [x, y] = EYE;
  const almond = (k = 1, lid = 0) => {
    const top = y - 13 * k + lid;
    return `<path d="M${x - 10} ${y - 4} Q${x - 2} ${top} ${x + 10} ${y - 6} Q${x + 9} ${y + 8 * k} ${x} ${y + 10 * k} Q${x - 8} ${y + 7 * k} ${x - 10} ${y - 4} Z" fill="#fff" stroke="palette(ink)" stroke-width="2.5"/>` +
      `<path d="M${x - 12} ${y - 4} Q${x - 2} ${top - 3} ${x + 11} ${y - 7}" fill="none" stroke="palette(ink)" stroke-width="5.5" stroke-linecap="round"/>` +
      `<path d="M${x - 11} ${y - 4} L${x - 16} ${y - 9}" stroke="palette(ink)" stroke-width="3" stroke-linecap="round"/>`;
  };
  const arc = (up: boolean) =>
    `<path d="M${x - 11} ${y - 2} Q${x} ${y + (up ? -9 : 7)} ${x + 11} ${y - 3}" fill="none" stroke="palette(ink)" stroke-width="4.5" stroke-linecap="round"/>` +
    (up ? "" : `<path d="M${x - 7} ${y + 3} l-3 5 M${x} ${y + 5} l-1 6 M${x + 6} ${y + 3} l1 5" stroke="palette(ink)" stroke-width="2.2" stroke-linecap="round"/>`);
  const iris = look.glow
    ? `<ellipse cx="${x + 3}" cy="${y + 1}" rx="6" ry="8.5" fill="palette(iris)"/><ellipse cx="${x + 3}" cy="${y + 1}" rx="2.4" ry="6" fill="#fff6c8"/>`
    : `<ellipse cx="${x + 3}" cy="${y + 1}" rx="6" ry="8.5" fill="palette(iris)" stroke="palette(ink)" stroke-width="1.5"/>` +
      `<ellipse cx="${x + 3.5}" cy="${y + 3}" rx="3.6" ry="5.4" fill="palette(irisDark)"/>` +
      `<circle cx="${x + 1}" cy="${y - 3}" r="2.6" fill="#fff"/><circle cx="${x + 6}" cy="${y + 5}" r="1.3" fill="#fff"/>`;
  // Anime "shining eyes": big, a huge iris, star highlights (moved, thrilled).
  const star = (cx: number, cy: number, k: number) => `<path d="M${cx} ${cy - 5 * k} L${cx + 1.5 * k} ${cy - 1.5 * k} L${cx + 5 * k} ${cy} L${cx + 1.5 * k} ${cy + 1.5 * k} L${cx} ${cy + 5 * k} L${cx - 1.5 * k} ${cy + 1.5 * k} L${cx - 5 * k} ${cy} L${cx - 1.5 * k} ${cy - 1.5 * k} Z" fill="#fff"/>`;
  const shine = almond(1.25) +
    `<ellipse cx="${x + 2}" cy="${y + 1}" rx="8" ry="11" fill="palette(iris)" stroke="palette(ink)" stroke-width="1.5"/><ellipse cx="${x + 2.5}" cy="${y + 3}" rx="5" ry="7.5" fill="palette(irisDark)"/>` +
    star(x - 1, y - 3, 1.3) + star(x + 5, y + 6, 0.8) + `<circle cx="${x + 6}" cy="${y - 5}" r="1.6" fill="#fff"/>`;
  return {
    open: almond(),
    wide: almond(1.2),
    shine,
    half: almond(0.9, 7),
    closed: arc(false),
    happy: arc(true),
    dead: `<path d="M${x - 8} ${y - 8} L${x + 8} ${y + 8} M${x + 8} ${y - 8} L${x - 8} ${y + 8}" stroke="palette(ink)" stroke-width="4.5" stroke-linecap="round"/>`,
    iris,
  };
}

function brows() {
  const [x, y] = EYE;
  const b = (dy: number, inner: number, outer: number) => `M${x - 12} ${y - 22 + dy + outer} Q${x - 1} ${y - 28 + dy} ${x + 11} ${y - 22 + dy + inner}`;
  return { base: b(0, 0, 0), shapes: { up: b(-7, 0, 0), sad: b(-3, -5, 4), cross: b(3, 6, -3), smug: b(-2, 3, -2) } };
}

// ------------------------------------------------------------------ hair

interface HairArt {
  back: string;
  /** Covers the skull down to the nape, the hairline passing behind the ear. */
  cap?: string;
  front: string;
  /** Locks on spring bones: bone chain + art in setup space. */
  locks: { id: string; from: P; to: P; d: string }[];
}

const CAP = "M60 -436 C56 -452 40 -460 26 -460 C-2 -460 -28 -444 -30 -410 C-30 -392 -24 -378 -14 -370 C-14 -382 -12 -396 -8 -412 C-2 -428 14 -440 34 -444 C46 -446 54 -444 60 -436 Z";

function hairArt(look: HumanLook): HairArt {
  const h = hairShapes(look);
  return look.hair === "hood" ? h : { ...h, cap: `<path d="${CAP}" fill="palette(hair)" ${stroke()}/><path d="M-20 -420 C-14 -436 0 -446 16 -450" fill="none" stroke="palette(hairShine)" stroke-width="4" stroke-linecap="round" opacity="0.7"/>` };
}

function hairShapes(look: HumanLook): HairArt {
  const fill = `fill="palette(hair)" ${stroke()}`;
  const tip = look.hairTip ? `fill="palette(hairTip)"` : "";
  switch (look.hair) {
    case "spiky":
      return {
        back:
          `<path d="M-26 -392 L-58 -420 L-30 -428 L-62 -458 L-22 -452 L-36 -492 L4 -470 L14 -508 L32 -470 L58 -490 L56 -456 L76 -458 L60 -436 C62 -440 50 -458 30 -458 C4 -458 -22 -446 -26 -416 Z" ${fill}/>` +
          (look.hairTip ? `<path d="M-58 -420 L-44 -418 L-50 -428 Z M-62 -458 L-44 -452 L-48 -464 Z M-36 -492 L-22 -478 L-16 -486 Z M14 -508 L18 -484 L26 -486 Z" ${tip}/>` : ""),
        front: `<path d="M18 -458 C40 -462 62 -452 66 -432 L58 -436 L62 -416 L48 -432 L44 -412 L36 -436 L26 -424 L24 -446 Z" ${fill}/>` +
          (look.hairTip ? `<path d="M62 -416 L56 -428 L60 -430 Z M44 -412 L42 -424 L47 -426 Z" ${tip}/>` : ""),
        locks: [],
      };
    case "mane":
      // A huge white anime mane: spikes up and back, long locks down the back.
      return {
        back:
          `<path d="M-24 -380 L-96 -368 L-56 -396 L-118 -420 L-62 -430 L-112 -478 L-46 -462 L-60 -522 L-10 -486 L2 -544 L28 -488 L66 -528 L62 -474 L96 -478 L66 -444 C64 -448 52 -462 30 -462 C2 -462 -22 -448 -26 -414 Z" ${fill}/>` +
          `<path d="M-70 -412 L-40 -418 M-52 -470 L-24 -460 M2 -520 L10 -484 M58 -500 L44 -474" stroke="palette(hairDark)" stroke-width="3" stroke-linecap="round"/>`,
        front:
          // Bangs stop above the eye (it must stay readable in close-ups).
          `<path d="M14 -462 C42 -470 70 -458 74 -432 L64 -436 L68 -420 L54 -434 L50 -420 L42 -436 L32 -418 L26 -442 Z" ${fill}/>` +
          `<path d="M54 -434 L52 -424 M64 -436 L66 -426" stroke="palette(hairDark)" stroke-width="2.5" stroke-linecap="round"/>`,
        locks: [
          { id: "lockA", from: [-30, -400], to: [-70, -300], d: "M-38 -404 C-60 -380 -74 -340 -78 -296 L-62 -320 L-64 -290 C-54 -330 -40 -366 -22 -396 Z" },
          { id: "lockB", from: [-14, -392], to: [-36, -300], d: "M-22 -394 C-34 -370 -42 -338 -42 -300 L-30 -322 L-26 -296 C-24 -330 -16 -362 -6 -388 Z" },
        ],
      };
    case "messy":
      return {
        back: `<path d="M-26 -398 L-44 -412 L-28 -424 L-40 -446 L-14 -444 L-8 -468 L14 -456 L34 -472 L42 -454 L62 -456 L58 -438 C56 -450 44 -460 28 -460 C2 -460 -20 -448 -26 -420 Z" ${fill}/>`,
        front: `<path d="M20 -460 C42 -464 60 -454 64 -436 L54 -440 L56 -424 L44 -438 L38 -422 L30 -440 Z" ${fill}/>`,
        locks: [],
      };
    case "ponytail":
      return {
        back: `<path d="M-26 -400 C-30 -442 0 -462 30 -462 C54 -462 66 -446 64 -428 L52 -440 C40 -446 8 -444 -2 -424 C-10 -412 -14 -400 -14 -384 Z" ${fill}/>` +
          `<circle cx="-22" cy="-424" r="7" fill="palette(accent)" ${stroke(3)}/>`,
        front: `<path d="M20 -462 C46 -466 66 -452 66 -430 C58 -438 50 -442 44 -440 C42 -430 36 -424 28 -420 C30 -432 28 -444 20 -450 Z" ${fill}/>`,
        locks: [{ id: "tail", from: [-24, -426], to: [-62, -340], d: "M-24 -432 C-58 -430 -78 -396 -72 -350 C-70 -336 -58 -330 -52 -342 C-58 -372 -48 -400 -20 -416 Z" }],
      };
    case "cap":
      return {
        back: `<path d="M-26 -400 C-30 -436 -10 -452 14 -456 L-28 -380 Z" ${fill}/>`,
        // A cap worn backwards: crown over the head, the visor sticking out behind.
        front:
          `<path d="M-22 -420 C-22 -452 6 -470 34 -466 C56 -462 66 -446 64 -428 C40 -436 4 -436 -22 -420 Z" fill="palette(accent)" ${stroke()}/>` +
          `<path d="M-20 -424 C-40 -424 -62 -418 -70 -410 C-56 -404 -36 -406 -18 -412 Z" fill="palette(accentDark)" ${stroke()}/>` +
          `<circle cx="22" cy="-466" r="4" fill="palette(accentDark)" ${stroke(2)}/>` +
          `<path d="M60 -430 L64 -412 L54 -424 Z" ${fill}/>`,
        locks: [],
      };
    case "short":
      // A buzz cut: the cap alone, a small fringe.
      return { back: "", front: `<path d="M24 -458 C44 -460 60 -450 62 -436 L52 -440 L48 -432 L40 -442 L30 -436 Z" ${fill}/>`, locks: [] };
    case "curly":
      // A big round curly top (black power).
      return {
        back: `<path d="${Array.from({ length: 16 }, (_, i) => {
          const a = Math.PI * 0.95 + (i / 15) * Math.PI * 1.15;
          const rr = i % 2 ? 78 : 92;
          return `${i ? "L" : "M"}${r(14 + Math.cos(a) * rr)} ${r(-426 + Math.sin(a) * rr * 0.86)}`;
        }).join(" ")} L60 -420 C40 -440 0 -440 -24 -400 Z" ${fill}/>`,
        front: `<path d="M20 -470 C46 -476 70 -462 72 -440 C62 -446 54 -446 46 -440 C40 -450 30 -452 20 -448 Z" ${fill}/>`,
        locks: [],
      };
    case "hood":
      // A crow hood with a beak-like visor (villains).
      return {
        back: `<path d="M-34 -380 C-48 -430 -24 -478 22 -482 C60 -484 80 -460 78 -430 C78 -414 72 -404 66 -398 L60 -420 C46 -446 4 -446 -8 -410 C-12 -396 -12 -384 -6 -372 Z" fill="palette(top)" ${stroke()}/>` +
          `<path d="M-30 -408 L-62 -400 L-40 -420 L-72 -432 L-38 -440 Z" fill="palette(top)" ${stroke(3)}/>`,
        front: `<path d="M18 -470 C50 -476 80 -458 78 -430 L96 -418 L72 -414 C66 -432 56 -446 40 -450 C30 -452 22 -448 16 -440 Z" fill="palette(topDark)" ${stroke()}/>`,
        locks: [],
      };
  }
}

// ------------------------------------------------------------------ outfits

function outfitArt(look: HumanLook) {
  const b = look.bulk ?? 1;
  const back = r(-34 * b), front = r(40 + 6 * (b - 1) * 4);
  const torso = `M${back} -330 C${r(back - 8)} -292 ${r(back - 6)} -244 ${r(back + 2)} -198 L${r(front - 2)} -196 C${r(front + 8)} -240 ${r(front + 10)} -290 ${front} -330 C${r(front * 0.4)} -342 ${r(back * 0.4)} -342 ${back} -330 Z`;
  const top = `<path d="${torso}" fill="palette(top)" ${stroke()}/>`;
  switch (look.outfit) {
    case "tee":
      return {
        torso: top + `<path d="M-8 -334 Q8 -322 22 -334" fill="none" ${stroke(3)}/><path d="M${r(back + 2)} -214 L${r(front - 3)} -212" stroke="palette(topDark)" stroke-width="5" stroke-linecap="round"/>`,
        sleeveF: `<path d="M8 -330 C26 -336 40 -320 36 -292 C26 -286 14 -288 6 -294 Z" fill="palette(top)" ${stroke()}/>`,
        sleeveB: `<path d="M-14 -332 C2 -336 14 -322 10 -296 C0 -290 -12 -292 -18 -298 Z" fill="palette(topDark)" ${stroke()}/>`,
        longSleeves: false,
      };
    case "hoodie":
      return {
        torso: top + `<path d="M-30 -332 C-44 -350 -40 -372 -24 -380 C-10 -366 -6 -346 -8 -334 Z" fill="palette(topDark)" ${stroke()}/>` +
          `<path d="M2 -268 L28 -268 L26 -232 L4 -232 Z" fill="none" stroke="palette(topDark)" stroke-width="4"/><path d="M8 -332 L10 -300 M18 -332 L20 -302" stroke="palette(accent)" stroke-width="3" stroke-linecap="round"/>`,
        sleeveF: "",
        sleeveB: "",
        longSleeves: true,
      };
    case "gi":
      return {
        torso: top + `<path d="M24 -330 L-2 -262 L10 -260 L34 -318 Z" fill="palette(topDark)" ${stroke(3)}/>` +
          `<path d="M${r(back + 2)} -228 L${r(front - 1)} -226 L${r(front - 2)} -208 L${r(back + 3)} -210 Z" fill="palette(accent)" ${stroke(3)}/>`,
        sleeveF: "",
        sleeveB: "",
        longSleeves: true,
      };
    case "coat":
      return {
        torso: top + `<path d="M26 -334 L8 -270 L24 -200 M-6 -338 L4 -300" fill="none" stroke="palette(topDark)" stroke-width="4" stroke-linecap="round"/>` +
          `<path d="M-30 -330 C-36 -350 -20 -362 0 -356 L26 -350 C34 -346 36 -338 32 -330 Z" fill="palette(accent)" ${stroke()}/>`,
        sleeveF: "",
        sleeveB: "",
        longSleeves: true,
      };
    case "armor":
      return {
        torso: top + `<path d="M${r(back + 4)} -300 C${r(back + 20)} -290 ${r(front - 20)} -290 ${r(front - 2)} -300 M${r(back + 4)} -262 C${r(back + 20)} -252 ${r(front - 20)} -252 ${r(front - 2)} -262" fill="none" stroke="palette(topDark)" stroke-width="5"/>` +
          `<path d="M-40 -330 C-46 -356 -10 -372 18 -362 C38 -356 48 -342 44 -326 C20 -334 -16 -334 -40 -330 Z" fill="palette(topDark)" ${stroke()}/>` +
          `<path d="M-30 -344 L-46 -366 L-24 -356 L-28 -380 L-8 -360 Z" fill="palette(topDark)" ${stroke(3)}/>`,
        sleeveF: `<path d="M4 -336 C30 -348 52 -330 46 -300 C30 -292 10 -296 2 -306 Z" fill="palette(topDark)" ${stroke()}/>`,
        sleeveB: `<path d="M-20 -338 C4 -346 22 -330 16 -302 C2 -296 -14 -298 -24 -308 Z" fill="palette(topDark)" ${stroke()}/>`,
        longSleeves: true,
      };
  }
}

// ------------------------------------------------------------------ the builder

export function humanCharacter(look: HumanLook): ToonDoc {
  const b = look.bulk ?? 1;
  const hair = hairArt(look);
  const out = outfitArt(look);
  const eye = eyes(look);
  const mouth = mouthShapes([52, -378], [61, -380], 0.55);
  const brow = brows();
  const sleeve = out.longSleeves ? "palette(top)" : "palette(skin)";
  const sleeveFar = out.longSleeves ? "palette(topDark)" : "palette(skinDark)";
  const extraBones: Record<string, unknown>[] = [];
  const extraParts: Record<string, unknown>[] = [];
  const physics: Record<string, unknown>[] = [{ type: "jiggle", bone: "body", stiffness: 0.75, damping: 0.6, translate: 0.04, squash: 0.03 }];
  for (const l of hair.locks) {
    const mid: P = [(l.from[0] + l.to[0]) / 2, (l.from[1] + l.to[1]) / 2];
    extraBones.push({ id: `${l.id}1`, parent: "head", from: l.from, to: mid, mass: 0.3 }, { id: `${l.id}2`, parent: `${l.id}1`, from: mid, to: l.to, mass: 0.25 });
    extraParts.push({ id: l.id, type: "skinned", path: l.d, bones: [`${l.id}1`, `${l.id}2`], fill: "palette(hair)", stroke: "palette(ink)", strokeWidth: SW, attrs: { "stroke-linejoin": "round" } });
    physics.push({ type: "spring", bones: [`${l.id}1`, `${l.id}2`], stiffness: 0.35, damping: 0.25, gravity: [0, 260], inertia: 0.5 });
  }
  const flowing: { id: string; parent: string; from: P; to: P; d: string; color: string; z: "back" | "front" }[] = [];
  if (look.headband)
    flowing.push({ id: "tails", parent: "head", from: [-24, -428], to: [-96, -404], color: "palette(headband)", z: "back", d: "M-22 -432 C-50 -436 -80 -424 -100 -398 L-86 -404 L-96 -386 C-70 -404 -46 -418 -22 -420 Z" });
  if (look.scarf)
    flowing.push({ id: "scarf", parent: "body", from: [-10, -330], to: [-110, -300], color: "palette(scarf)", z: "back", d: "M-8 -340 C-50 -344 -96 -330 -124 -296 L-104 -302 L-112 -280 C-84 -306 -44 -320 -6 -322 Z" });
  if (look.cape)
    flowing.push({ id: "cape", parent: "body", from: [-24, -330], to: [-90, -150], color: "palette(cape)", z: "back", d: "M-20 -334 C-60 -320 -96 -250 -110 -140 L-80 -160 L-70 -128 L-46 -158 L-30 -132 C-34 -200 -40 -270 -10 -322 Z" });
  for (const f of flowing) {
    const mid: P = [(f.from[0] + f.to[0]) / 2, (f.from[1] + f.to[1]) / 2];
    extraBones.push({ id: `${f.id}1`, parent: f.parent, from: f.from, to: mid, mass: 0.3 }, { id: `${f.id}2`, parent: `${f.id}1`, from: mid, to: f.to, mass: 0.25 });
    physics.push({ type: "spring", bones: [`${f.id}1`, `${f.id}2`], stiffness: 0.3, damping: 0.22, gravity: [0, 200], inertia: 0.6 });
  }
  const flowParts = (z: "back" | "front") =>
    flowing.filter((f) => f.z === z).map((f) => ({ id: f.id, type: "skinned", path: f.d, bones: [`${f.id}1`, `${f.id}2`], fill: f.color, stroke: "palette(ink)", strokeWidth: 3.5, attrs: { "stroke-linejoin": "round" } }));

  const doc = {
    format: "toon",
    version: 1,
    name: look.name,
    meta: { description: `${look.name}: anime-style human (profile, facing right)` },
    palette: {
      ink: INK,
      skin: look.skin,
      skinDark: shade(look.skin, 0.86),
      hair: look.hairColor,
      hairDark: shade(look.hairColor, 0.75),
      hairShine: look.hairColor === "#eef3ff" ? "#ffffff" : shade(look.hairColor, 1.6),
      hairTip: look.hairTip ?? look.hairColor,
      iris: look.iris,
      irisDark: shade(look.iris, 0.45),
      top: look.top,
      topDark: look.topDark ?? shade(look.top, 0.78),
      pants: look.pants,
      pantsDark: shade(look.pants, 0.78),
      shoes: look.shoes,
      accent: look.accent ?? "#e8414f",
      accentDark: shade(look.accent ?? "#e8414f", 0.75),
      headband: look.headband ?? "#e8414f",
      scarf: look.scarf ?? "#e8414f",
      cape: look.cape ?? "#2b2238",
      mouth: "#7a2638",
      blush: "#ff8f9e",
    },
    art: {
      head: `<path d="${HEAD}" fill="palette(skin)" ${stroke()}/>` +
        `<path d="M66 -398 L61 -394" stroke="palette(ink)" stroke-width="2.5" stroke-linecap="round"/>` +
        `<path d="M8 -404 C2 -412 -4 -404 -2 -394 C0 -386 6 -384 10 -390" fill="palette(skin)" ${stroke(3)}/>` +
        (look.glow ? "" : `<ellipse cx="42" cy="-386" rx="7" ry="3.5" fill="palette(blush)" opacity="0.45"/>`) +
        (look.glasses ? `<path d="M34 -410 h24 v14 h-24 Z" fill="#cdeeff" fill-opacity="0.35" ${stroke(3)}/><path d="M34 -404 L10 -402" ${stroke(3)}/>` : ""),
      neck: `<path d="M0 -326 L2 -368 L30 -368 L28 -326 Z" fill="palette(skinDark)" ${stroke()}/>`,
      hairBack: hair.back,
      hairCap: hair.cap ?? "",
      band: look.headband
        ? `<path d="M-30 -416 C-2 -434 32 -440 62 -432" fill="none" stroke="palette(ink)" stroke-width="16" stroke-linecap="round"/><path d="M-30 -416 C-2 -434 32 -440 62 -432" fill="none" stroke="palette(headband)" stroke-width="10" stroke-linecap="round"/>` +
          `<path d="M24 -446 L52 -448 L54 -430 L26 -428 Z" fill="#c9ccd6" ${stroke(3)}/><path d="M32 -440 L46 -441 M33 -434 L47 -436" stroke="palette(ink)" stroke-width="2"/>`
        : "",
      hairFront: hair.front,
      torso: out.torso,
      sleeveF: out.sleeveF,
      sleeveB: out.sleeveB,
      ...Object.fromEntries(Object.entries(handShapes([24, -200], { r: 13, fill: "palette(skin)" })).map(([k, v]) => [`handF_${k}`, v])),
      ...Object.fromEntries(Object.entries(handShapes([-8, -202], { r: 12, fill: "palette(skinDark)" })).map(([k, v]) => [`handB_${k}`, v])),
      shoe: `<path d="M-14 -14 C-6 -20 14 -18 26 -10 C36 -6 38 2 34 6 L-16 6 C-20 0 -18 -8 -14 -14 Z" fill="palette(shoes)" ${stroke()}/><path d="M-17 2 H35" stroke="#fff" stroke-width="3"/>`,
      eyeOpen: eye.open,
      eyeWide: eye.wide,
      eyeClosed: eye.closed,
      eyeHappy: eye.happy,
      eyeHalf: eye.half,
      eyeDead: eye.dead,
      eyeShine: eye.shine,
      iris: eye.iris,
    },
    skeleton: [
      { id: "root" },
      { id: "ground" },
      { id: "hips", parent: "root", from: [0, -200], to: [0, -210], mass: 2 },
      { id: "body", parent: "hips", from: [0, -200], to: [8, -330], mass: 2 },
      { id: "neck", parent: "body", from: [12, -330], to: [16, -360], mass: 1, limits: { rotation: [-25, 25] } },
      { id: "head", parent: "neck", from: [16, -360], to: [30, -456], mass: 1.4, limits: { rotation: [-40, 40] } },
      { id: "pupils", parent: "head", from: [EYE[0], EYE[1]] },
      ...extraBones,
      ...limbBones({
        shoulderF: [16, -322], elbowF: [22, -262], handF: [24, -200],
        shoulderB: [-6, -324], elbowB: [-10, -264], handB: [-8, -202],
        hipF: [12, -200], kneeF: [17, -104], footF: [12, -12], toeF: 26,
        hipB: [-8, -200], kneeB: [-3, -104], footB: [-8, -12], toeB: 26,
      }),
    ],
    parts: [
      { id: "shadow", type: "rigid", bone: "ground", art: `<ellipse cx="4" cy="2" rx="${r(66 * b)}" ry="10" fill="#000" opacity="0.2"/>` },
      ...flowParts("back"),
      { id: "legB", type: "hose", bones: ["legB1", "legB2"], width: [r(32 * b), 24], fill: "palette(pantsDark)", stroke: "palette(ink)", strokeWidth: SW },
      { id: "shoeB", type: "rigid", bone: "footB", art: "shoe", space: "bone" },
      { id: "armB", type: "hose", bones: ["armB1", "armB2"], width: [r(21 * b), 17], fill: sleeveFar, stroke: "palette(ink)", strokeWidth: SW },
      { id: "handB", type: "switch", bone: "handB", variants: { open: "handB_open", fist: "handB_fist", point: "handB_point", grip: "handB_grip" }, default: "fist" },
      { id: "sleeveB", type: "rigid", bone: "armB1", art: "sleeveB" },
      ...extraParts.filter((p) => (p as { id: string }).id !== "front"),
      { id: "hairBack", type: "rigid", bone: "head", art: "hairBack" },
      { id: "legF", type: "hose", bones: ["legF1", "legF2"], width: [r(32 * b), 24], fill: "palette(pants)", stroke: "palette(ink)", strokeWidth: SW },
      { id: "shoeF", type: "rigid", bone: "footF", art: "shoe", space: "bone" },
      { id: "neck", type: "rigid", bone: "neck", art: "neck" },
      { id: "torso", type: "rigid", bone: "body", art: "torso" },
      { id: "head", type: "rigid", bone: "head", art: "head" },
      { id: "hairCap", type: "rigid", bone: "head", art: "hairCap" },
      { id: "band", type: "rigid", bone: "head", art: "band" },
      { id: "mouth", type: "morph", bone: "head", fill: "palette(mouth)", stroke: "palette(ink)", strokeWidth: 2.5, attrs: { "stroke-linejoin": "round" }, base: mouth.base, shapes: mouth.shapes },
      { id: "eyes", type: "switch", bone: "head", variants: { open: "eyeOpen", wide: "eyeWide", closed: "eyeClosed", happy: "eyeHappy", half: "eyeHalf", dead: "eyeDead", shine: "eyeShine" }, default: "open" },
      { id: "pupils", type: "rigid", bone: "pupils", art: "iris", visibleWhen: { part: "eyes", variant: ["open", "wide", "half"] } },
      { id: "brows", type: "morph", bone: "head", fill: "none", stroke: "palette(hairDark)", strokeWidth: 4.5, attrs: { "stroke-linecap": "round" }, base: brow.base, shapes: brow.shapes },
      { id: "hairFront", type: "rigid", bone: "head", art: "hairFront" },
      ...flowParts("front"),
      { id: "armF", type: "hose", bones: ["armF1", "armF2"], width: [r(21 * b), 17], fill: sleeve, stroke: "palette(ink)", strokeWidth: SW },
      { id: "handF", type: "switch", bone: "handF", variants: { open: "handF_open", fist: "handF_fist", point: "handF_point", grip: "handF_grip" }, default: "fist" },
      { id: "sleeveF", type: "rigid", bone: "armF1", art: "sleeveF" },
    ],
    anchors: {
      head: { bone: "head", at: [30, -410] },
      // The centre of the face as drawn from the front (close-ups and front gestures aim here).
      face: { bone: "head", at: [14, -404] },
      hand: { bone: "handF", at: [24, -200] },
      handB: { bone: "handB", at: [-8, -202] },
      fist: { bone: "handF", at: [34, -200] },
    },
    ik: limbIk,
    physics,
    controls: {
      mouth: { type: "viseme", part: "mouth" },
      look: { type: "aim", targets: [{ bone: "head", forward: -80, maxAngle: 14, weight: 0.35 }, { bone: "pupils", mode: "translate", radius: 3 }] },
      emotion: emotions({
        dead: { "parts.eyes.variant": "dead", "parts.mouth.morph.D": 0.6, "bones.head.rotation": 10 },
        determined: { "parts.eyes.variant": "half", "parts.mouth.morph.frown": 0.4, "parts.brows.morph.cross": 1, "bones.head.rotation": 2 },
        calm: { "parts.eyes.variant": "closed", "parts.brows.morph.cross": 0.4 },
        excited: { "parts.eyes.variant": "shine", "parts.mouth.morph.grin": 0.9, "parts.brows.morph.up": 0.8, "bones.head.rotation": -6 },
      }),
    },
    behaviors: [
      { type: "blink", id: "blink", part: "eyes", open: "open", closed: "closed", interval: [2.2, 4.8], duration: 0.12 },
      { type: "breathe", id: "breathe", bone: "body", amount: 0.012, period: 3.4 },
    ],
    clips: {
      ...characterClips({
        walk: { a: 30, lift: 18, dur: 0.66, bob: 4, lean: 2, armSwing: 26 },
        run: { a: 52, lift: 30, dur: 0.44, bob: 8, lean: 8, armSwing: 60 },
        jump: 90,
        hands: true,
      }),
      ...humanClips(),
    },
  };
  // Anime proportions: a big head, a slightly shorter body.
  return withProportions(frontView(doc as unknown as ToonDoc, look, eye), { head: 1.32, torso: 0.94, legs: 0.92 });
}

/** Extra clips of the human characters (all bones from the kit skeleton): stance, power, punch, knocked, read, facepalm, roll. */
export function humanClips() {
  return {
    // Fighting stance: knees bent, fists up.
    stance: {
      duration: 1.6,
      loop: true,
      tracks: {
        "bones.hips.y": [[0, 14], [0.8, 18], [1.6, 14]],
        "bones.body.rotation": [[0, 6], [0.8, 8], [1.6, 6]],
        "bones.armF1.rotation": [[0, -70], [0.8, -66], [1.6, -70]],
        "bones.armF2.rotation": [[0, -110], [1.6, -110]],
        "bones.armB1.rotation": [[0, -40], [1.6, -40]],
        "bones.armB2.rotation": [[0, -120], [1.6, -120]],
      },
    },
    // Charging power, eyes closed: arms down and back, fists clenched, chin down.
    power: {
      duration: 1.2,
      loop: true,
      tracks: {
        "bones.hips.y": [[0, 10], [0.6, 12], [1.2, 10]],
        "bones.body.rotation": [[0, -2], [0.6, -3], [1.2, -2]],
        "bones.head.rotation": [[0, 8], [1.2, 8]],
        "bones.armF1.rotation": [[0, 22], [0.6, 24], [1.2, 22]],
        "bones.armF2.rotation": [[0, -30], [1.2, -30]],
        "bones.armB1.rotation": [[0, 26], [1.2, 26]],
        "bones.armB2.rotation": [[0, -30], [1.2, -30]],
      },
    },
    // A straight punch: wind-up, thrust (fast), hold, recover.
    punch: {
      duration: 0.9,
      tracks: {
        "bones.body.rotation": [[0, 0], [0.18, -10, "easeOut"], [0.28, 16, "easeIn"], [0.6, 14], [0.9, 0]],
        "bones.hips.y": [[0, 0], [0.18, 10], [0.28, 6], [0.9, 0]],
        "bones.armF1.rotation": [[0, 0], [0.18, 50, "easeOut"], [0.28, -84, "easeIn"], [0.6, -82], [0.9, 0]],
        "bones.armF2.rotation": [[0, 0], [0.18, -120, "easeOut"], [0.28, -4, "easeIn"], [0.6, -4], [0.9, 0]],
        "bones.armB1.rotation": [[0, 0], [0.28, 40], [0.9, 0]],
        "bones.armB2.rotation": [[0, 0], [0.28, -100], [0.9, 0]],
      },
    },
    // Thrown back by a hit: arms and legs flung forward.
    knocked: {
      duration: 0.6,
      tracks: {
        "bones.body.rotation": [[0, 0], [0.12, -24, "easeOut"], [0.6, -18]],
        "bones.head.rotation": [[0, 0], [0.12, -20, "easeOut"], [0.6, -14]],
        "bones.armF1.rotation": [[0, 0], [0.12, -120, "easeOut"], [0.6, -100]],
        "bones.armB1.rotation": [[0, 0], [0.12, -140, "easeOut"], [0.6, -120]],
        "bones.legF1.rotation": [[0, 0], [0.12, -50, "easeOut"], [0.6, -40]],
        "bones.legB1.rotation": [[0, 0], [0.12, -20, "easeOut"], [0.6, -30]],
      },
    },
    // Holding a character sheet up to read it (sitting or standing).
    read: {
      duration: 2.4,
      loop: true,
      tracks: {
        "bones.armF1.rotation": [[0, -48], [1.2, -52], [2.4, -48]],
        "bones.armF2.rotation": [[0, -78], [1.2, -74], [2.4, -78]],
        "bones.armB1.rotation": [[0, -40], [2.4, -40]],
        "bones.armB2.rotation": [[0, -86], [2.4, -86]],
        "bones.head.rotation": [[0, 10], [1.2, 12], [2.4, 10]],
      },
    },
    // Facepalm: the hand up to the forehead, the head drops (held, then down again).
    facepalm: {
      duration: 1.6,
      tracks: {
        "bones.armF1.rotation": [[0, 0], [0.22, -144, "easeOut"], [1.3, -140], [1.6, 0]],
        "bones.armF2.rotation": [[0, 0], [0.22, -25, "easeOut"], [1.3, -22], [1.6, 0]],
        "bones.head.rotation": [[0, 0], [0.22, 14, "easeOut"], [0.5, 10], [0.8, 14], [1.3, 12], [1.6, 0]],
        "bones.body.rotation": [[0, 0], [0.22, 6], [1.3, 6], [1.6, 0]],
      },
    },
    // Throwing dice from a sitting position: hand back, then a flick forward.
    roll: {
      duration: 0.8,
      tracks: {
        "bones.body.rotation": [[0, 0], [0.25, -6], [0.4, 8, "easeIn"], [0.8, 0]],
        "bones.armF1.rotation": [[0, 0], [0.25, 30, "easeOut"], [0.4, -70, "easeIn"], [0.8, -20]],
        "bones.armF2.rotation": [[0, 0], [0.25, -90, "easeOut"], [0.4, -10, "easeIn"], [0.8, -30]],
      },
    },
  };
}
