/**
 * Front view (looking at the camera) for the anime characters, on the kit's `withViews`: a
 * symmetric face (two eyes, a centred mouth and brows, both ears), the hair seen from the front,
 * the shirt from the front and the shoulders moved to the sides. Eyes, mouth and brows follow the
 * same emotions, blinks and lip sync as the profile ones.
 */
import type { ToonDoc } from "@animestudio/core";
import { mouthShapes } from "./rig";
import { type ViewSpec, withViews } from "./views";
import type { HumanLook as Look } from "./human";

type P = [number, number];
type Doc = Record<string, any>;
const SW = 4;
const r = (n: number) => Math.round(n * 100) / 100;
const st = (w = SW) => `stroke="palette(ink)" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;

/** Centre line of the face and body (setup space), the eye height and spacing. */
const C = 14;
const EY = -404;
const EX = 21;
/** The profile eye the art was drawn around. */
const PEYE: P = [47, -404];

const FACE = `M${C - 47} -414 C${C - 48} -462 ${C + 48} -462 ${C + 47} -414 C${C + 46} -390 ${C + 30} -366 ${C} -358 C${C - 30} -366 ${C - 46} -390 ${C - 47} -414 Z`;

/** Places an art drawn around the profile eye on both eyes (the screen-right one mirrored). */
const bothEyes = (art: string) =>
  `<g transform="translate(${C - EX - PEYE[0]} ${EY - PEYE[1]})">${art}</g>` +
  `<g transform="matrix(-1 0 0 1 ${C + EX + PEYE[0]} ${EY - PEYE[1]})">${art}</g>`;

function frontHair(look: Look): { back: string; front: string } {
  const fill = `fill="palette(hair)" ${st()}`;
  // A crown of spikes around the top of the head: n spikes between two angles, alternating radii.
  const crown = (n: number, r0: number, r1: number, a0 = 168, a1 = 372, cy = -416, jitter = 0) => {
    const pts: string[] = [];
    for (let i = 0; i <= n * 2; i++) {
      const a = ((a0 + ((a1 - a0) * i) / (n * 2)) * Math.PI) / 180;
      const rr = i % 2 ? r1 + (jitter ? ((i * 37) % 11) - 5 : 0) : r0;
      pts.push(`${r(C + Math.cos(a) * rr * 1.08)} ${r(cy + Math.sin(a) * rr)}`);
    }
    return `M${pts.join(" L")} Z`;
  };
  // Bangs: a zigzag across the forehead.
  // Bangs: the skull's top edge, then a zigzag of locks back across the forehead.
  const bangs = (n: number, top: number, low: number, w = 49) => {
    let d = `M${C - w} -414 C${C - w} -468 ${C + w} -468 ${C + w} -414`;
    for (let i = n; i >= 0; i--) d += ` L${r(C - w + ((2 * w) / n) * i)} ${i % 2 ? low : top}`;
    return `${d} Z`;
  };
  switch (look.hair) {
    case "spiky":
      return {
        back: `<path d="${crown(7, 52, 96, 160, 380, -420)}" ${fill}/>` + (look.hairTip ? "" : ""),
        front: `<path d="${bangs(6, -446, -418)}" ${fill}/>`,
      };
    case "messy":
      return { back: `<path d="${crown(8, 50, 72, 165, 375, -418, 1)}" ${fill}/>`, front: `<path d="${bangs(7, -444, -424)}" ${fill}/>` };
    case "short":
      return { back: `<path d="M${C - 49} -418 C${C - 50} -468 ${C + 50} -468 ${C + 49} -418 Z" ${fill}/>`, front: `<path d="M${C - 46} -440 C${C - 20} -452 ${C + 20} -452 ${C + 46} -440 L${C + 44} -452 C${C + 20} -462 ${C - 20} -462 ${C - 44} -452 Z" ${fill}/>` };
    case "curly": {
      const blob = Array.from({ length: 18 }, (_, i) => {
        const a = (Math.PI * 2 * i) / 18;
        const rr = i % 2 ? 76 : 86;
        return `${i ? "L" : "M"}${r(C + Math.cos(a) * rr * 1.1)} ${r(-432 + Math.sin(a) * rr * 0.86)}`;
      }).join(" ");
      return { back: `<path d="${blob} Z" ${fill}/>`, front: `<path d="M${C - 46} -432 C${C - 30} -452 ${C + 30} -452 ${C + 46} -432 C${C + 40} -462 ${C - 40} -462 ${C - 46} -432 Z" ${fill}/>` };
    }
    case "cap":
      // Cap worn backwards: the crown over the head, the visor sticking up behind it.
      return {
        back: `<path d="M${C - 50} -404 C${C - 52} -440 ${C - 46} -440 ${C - 44} -414 Z" ${fill}/><path d="M${C + 50} -404 C${C + 52} -440 ${C + 46} -440 ${C + 44} -414 Z" ${fill}/>`,
        front: `<path d="M${C - 50} -428 C${C - 50} -480 ${C + 50} -480 ${C + 50} -428 C${C + 20} -440 ${C - 20} -440 ${C - 50} -428 Z" fill="palette(accent)" ${st()}/><circle cx="${C}" cy="-474" r="4" fill="palette(accentDark)" ${st(2)}/>`,
      };
    default:
      return { back: `<path d="${crown(8, 50, 72)}" ${fill}/>`, front: `<path d="${bangs(6, -444, -426)}" ${fill}/>` };
  }
}

export function frontView(doc: ToonDoc, look: Look, eye: { open: string; wide: string; half: string; closed: string; happy: string; dead: string; shine: string }): ToonDoc {
  const d = doc as Doc;
  const hair = frontHair(look);
  const b = look.bulk ?? 1;
  const w = r(40 * b);
  // Face, ears, nose and cheeks.
  const ear = (x: number, flip: number) => `<path d="M${x} -414 C${x + flip * 12} -418 ${x + flip * 14} -396 ${x} -390" fill="palette(skin)" ${st(3)}/>`;
  const head =
    ear(C - 46, -1) + ear(C + 46, 1) +
    `<path d="${FACE}" fill="palette(skin)" ${st()}/>` +
    `<path d="M${C - 2} -392 L${C + 2} -386" stroke="palette(ink)" stroke-width="2.5" stroke-linecap="round"/>` +
    (look.glow ? "" : `<ellipse cx="${C - 30}" cy="-386" rx="8" ry="4" fill="palette(blush)" opacity="0.45"/><ellipse cx="${C + 30}" cy="-386" rx="8" ry="4" fill="palette(blush)" opacity="0.45"/>`) +
    (look.glasses ? `<rect x="${C - EX - 14}" y="${EY - 12}" width="28" height="22" rx="5" fill="#cdeeff" fill-opacity="0.3" ${st(3)}/><rect x="${C + EX - 14}" y="${EY - 12}" width="28" height="22" rx="5" fill="#cdeeff" fill-opacity="0.3" ${st(3)}/><path d="M${C - EX + 14} ${EY - 4} H${C + EX - 14}" ${st(3)}/>` : "");
  const torso =
    `<path d="M${C - w} -330 C${C - w - 6} -290 ${C - w - 4} -240 ${C - w + 4} -198 L${C + w - 4} -198 C${C + w + 4} -240 ${C + w + 6} -290 ${C + w} -330 C${C + 14} -342 ${C - 14} -342 ${C - w} -330 Z" fill="palette(top)" ${st()}/>` +
    (look.outfit === "hoodie"
      ? `<path d="M${C - 22} -334 C${C - 30} -350 ${C + 30} -350 ${C + 22} -334" fill="palette(topDark)" ${st(3)}/><path d="M${C - 6} -332 L${C - 8} -300 M${C + 6} -332 L${C + 8} -300" stroke="palette(accent)" stroke-width="3"/><path d="M${C - 22} -262 h44 v30 h-44 Z" fill="none" stroke="palette(topDark)" stroke-width="4"/>`
      : `<path d="M${C - 14} -334 Q${C} -318 ${C + 14} -334" fill="none" ${st(3)}/>`);
  // Sleeves on both shoulders (long sleeves: the arms are already the shirt's colour).
  const sleeve = (x: number, s: number) => `<path d="M${x} -332 C${x + s * 20} -334 ${x + s * 28} -318 ${x + s * 26} -294 C${x + s * 16} -290 ${x + s * 6} -292 ${x - s * 2} -298 Z" fill="palette(top)" ${st()}/>`;
  const sleeves = look.outfit === "tee" ? sleeve(C + w - 10, 1) + sleeve(C - w + 10, -1) : "";
  const neck = `<path d="M${C - 12} -326 L${C - 12} -366 L${C + 12} -366 L${C + 12} -326 Z" fill="palette(skinDark)" ${st()}/>`;
  // Eyes (one rigid part per variant, shown with the profile eyes' current variant: blinks and
  // emotions drive both) and the irises on the pupils bone (they follow the gaze).
  const variants = ["open", "wide", "half", "closed", "happy", "dead", "shine"] as const;
  const eyeParts = variants.map((v) => ({ id: `eyeF_${v}`, type: "rigid", bone: "head", art: bothEyes(eye[v]), visibleWhen: { part: "eyes", variant: v } }));
  const iris = (x: number) =>
    `<ellipse cx="${x}" cy="${EY + 1}" rx="6.5" ry="8.5" fill="palette(iris)" stroke="palette(ink)" stroke-width="1.5"/><ellipse cx="${x}" cy="${EY + 3}" rx="4" ry="5.5" fill="palette(irisDark)"/><circle cx="${x - 2}" cy="${EY - 3}" r="2.6" fill="#fff"/>`;
  const glowIris = (x: number) => `<ellipse cx="${x}" cy="${EY + 1}" rx="6" ry="8.5" fill="palette(iris)"/><ellipse cx="${x}" cy="${EY + 1}" rx="2.4" ry="6" fill="#fff6c8"/>`;
  const irises = look.glow ? glowIris(C - EX) + glowIris(C + EX) : iris(C - EX) + iris(C + EX);
  // Mouth and brows, morphed by the same channels as the profile ones (copied into the emotions).
  const mouth = mouthShapes([C - 10, -373], [C + 10, -373], 0.6);
  const brow = (dy: number, inner: number, outer: number) => {
    const one = (x: number, s: number) => `M${x - s * 13} ${EY - 22 + dy + outer} Q${x} ${EY - 28 + dy} ${x + s * 12} ${EY - 22 + dy + inner}`;
    return `${one(C - EX, 1)} ${one(C + EX, -1)}`;
  };
  const browsF = { base: brow(0, 0, 0), shapes: { up: brow(-7, 0, 0), sad: brow(-3, -5, 4), cross: brow(3, 6, -3), smug: brow(-2, 3, -2) } };
  const spec: ViewSpec = {
    eyes: { center: PEYE, parts: [] },
    mouth: { center: [56, -378], parts: [] },
    profileOnly: ["head", "hairBack", "hairCap", "hairFront", "torso", "neck", "band"],
    // Hidden by opacity (their own `visibleWhen` stays: pupils only with open eyes).
    hide: { front: ["eyes", "pupils", "mouth", "brows", "sleeveF", "sleeveB"] },
    parts: {
      front: [
        { before: "legF", part: { id: "hairBackF", type: "rigid", bone: "head", art: hair.back } },
        { before: "armF", part: { id: "neckF", type: "rigid", bone: "neck", art: neck } },
        { before: "armF", part: { id: "torsoF", type: "rigid", bone: "body", art: torso } },
        { before: "armF", part: { id: "headF", type: "rigid", bone: "head", art: head } },
        ...(sleeves ? [{ part: { id: "sleevesF", type: "rigid", bone: "body", art: sleeves } }] : []),
        ...eyeParts.map((p) => ({ before: "armF", part: p })),
        { before: "armF", part: { id: "pupilsF", type: "rigid", bone: "pupils", art: irises, visibleWhen: { part: "eyes", variant: ["open", "wide", "half"] } } },
        { before: "armF", part: { id: "mouthF", type: "morph", bone: "head", fill: "palette(mouth)", stroke: "palette(ink)", strokeWidth: 2.5, attrs: { "stroke-linejoin": "round" }, base: mouth.base, shapes: mouth.shapes } },
        { before: "armF", part: { id: "browsF", type: "morph", bone: "head", fill: "none", stroke: "palette(hairDark)", strokeWidth: 4.5, attrs: { "stroke-linecap": "round" }, base: browsF.base, shapes: browsF.shapes } },
        { before: "armF", part: { id: "hairFrontF", type: "rigid", bone: "head", art: hair.front } },
      ],
    },
    // Shoulders to the sides of the chest, hips side by side; the head stays straight.
    move: { front: { armF1: [r(C + w - 6 - 16), 0], armB1: [r(C - w + 6 + 6), 0], legF1: [C + 14 - 12, 0], legB1: [C - 14 + 8, 0] } },
    mouths: ["mouthF"],
  };
  const out = withViews(doc, spec) as unknown as Doc;
  // `visibleWhen` already shows the right eye variant; in profile every front part is hidden by the view switch.
  for (const p of out.parts) if (p.id?.startsWith("eyeF_")) p.visibleWhen = { part: "eyes", variant: p.id.slice(5) };
  const gate = out.parts.filter((p: Doc) => p.id?.startsWith("eyeF_") || p.id === "pupilsF");
  for (const [view, pose] of Object.entries(out.controls.view.poses as Record<string, Record<string, unknown>>)) {
    if (view !== "front") for (const p of gate) pose[`parts.${p.id}.opacity`] = -1;
  }
  // The front mouth and brows follow the emotions too.
  for (const pose of Object.values(out.controls.emotion.poses as Record<string, Record<string, unknown>>)) {
    for (const [k, v] of Object.entries({ ...pose })) {
      if (k.startsWith("parts.mouth.morph.")) pose[k.replace("parts.mouth.", "parts.mouthF.")] = v;
      if (k.startsWith("parts.brows.morph.")) pose[k.replace("parts.brows.", "parts.browsF.")] = v;
    }
  }
  return out as unknown as ToonDoc;
}
