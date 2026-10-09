import type { ToonDoc } from "@animestudio/core";

/**
 * "Pip" — an original pig character in a flat, Peppa-like cut-out style, authored in code.
 * Facing right, ground at y = 0, about 340 px tall in setup space.
 */

type P = [number, number];
const f = (n: number) => Math.round(n * 100) / 100;
const pt = (p: P) => `${f(p[0])} ${f(p[1])}`;

/** Closed mouth outline with 4 cubic segments (morph-compatible). */
function mouth(width: number, opening: number, lift = 4, cx = 44, cy = -238): string {
  const w = width * 1.35;
  const open = opening * 1.35;
  const smile = lift * 1.2;
  const l: P = [cx - w / 2, cy - smile];
  const r: P = [cx + w / 2, cy - smile];
  const top = cy - open * 0.25;
  const bot = cy + open * 0.75;
  return [
    `M${pt(l)}`,
    `C${pt([l[0], l[1] + open * 0.5])} ${pt([cx - w * 0.3, bot])} ${pt([cx, bot])}`,
    `C${pt([cx + w * 0.3, bot])} ${pt([r[0], r[1] + open * 0.5])} ${pt(r)}`,
    `C${pt([r[0] - w * 0.1, r[1] - open * 0.15])} ${pt([cx + w * 0.25, top])} ${pt([cx, top])}`,
    `C${pt([cx - w * 0.25, top])} ${pt([l[0] + w * 0.1, l[1] - open * 0.15])} ${pt(l)}Z`,
  ].join("");
}

const outlined = (shapes: string, fill: string, width = 6) =>
  `<g fill="palette(outline)" stroke="palette(outline)" stroke-width="${width}" stroke-linejoin="round">${shapes}</g><g fill="${fill}">${shapes}</g>`;

const headShapes =
  `<ellipse cx="12" cy="-262" rx="64" ry="56"/>` +
  `<path d="M40 -290 L92 -290 L92 -236 L40 -232 Z"/>` +
  `<ellipse cx="94" cy="-263" rx="18" ry="27"/>`;

const earShape = (base: P, tip: P, w: number) => {
  const dx = tip[0] - base[0];
  const dy = tip[1] - base[1];
  const len = Math.hypot(dx, dy);
  const nx = (-dy / len) * w;
  const ny = (dx / len) * w;
  return `<path d="M${pt([base[0] + nx, base[1] + ny])} Q${pt([tip[0] + nx * 0.9, tip[1] + ny * 0.9])} ${pt(tip)} Q${pt([tip[0] - nx * 0.9, tip[1] - ny * 0.9])} ${pt([base[0] - nx, base[1] - ny])} Z"/>`;
};

const eyeWhites = `<circle cx="24" cy="-286" r="12"/><circle cx="54" cy="-280" r="12"/>`;

export const pip: ToonDoc = {
  $schema: "../../schemas/toon.schema.json",
  format: "toon",
  version: 1,
  name: "pip",
  meta: { description: "Original pig character, flat cut-out style, facing right." },
  palette: {
    skin: "#F7B2C8",
    skinShade: "#EE9AB6",
    outline: "#D2668C",
    cheek: "#F27BA3",
    dress: "#E4473B",
    dressShade: "#B8332B",
    shoe: "#2E2B36",
    ink: "#2E2B36",
    mouth: "#8C2346",
    white: "#FFFFFF",
  },
  art: {
    head:
      outlined(headShapes, "palette(skin)") +
      `<ellipse cx="88" cy="-270" rx="3.2" ry="4.5" fill="palette(outline)"/>` +
      `<ellipse cx="100" cy="-256" rx="3.2" ry="4.5" fill="palette(outline)"/>`,
    cheek: `<circle cx="2" cy="-240" r="13" fill="palette(cheek)" opacity="0.75"/>`,
    eyesOpen: outlined(eyeWhites, "palette(white)", 4),
    eyesClosed: `<g fill="none" stroke="palette(ink)" stroke-width="3.5" stroke-linecap="round"><path d="M13 -284 Q24 -278 35 -284"/><path d="M43 -278 Q54 -272 65 -278"/></g>`,
    eyesHappy: `<g fill="none" stroke="palette(ink)" stroke-width="3.5" stroke-linecap="round"><path d="M13 -282 Q24 -294 35 -282"/><path d="M43 -276 Q54 -288 65 -276"/></g>`,
    eyesSad:
      outlined(eyeWhites, "palette(white)", 4) +
      `<g fill="none" stroke="palette(ink)" stroke-width="3" stroke-linecap="round"><path d="M12 -303 L32 -308"/><path d="M47 -304 L66 -296"/></g>`,
    pupils: `<g fill="palette(ink)"><circle cx="26" cy="-286" r="5"/><circle cx="56" cy="-280" r="5"/></g>`,
    earFar: outlined(earShape([-14, -306], [-26, -342], 11), "palette(skinShade)", 5),
    earNear: outlined(earShape([12, -310], [10, -350], 12), "palette(skin)", 5),
    dress:
      `<path d="M-30 -194 Q0 -202 30 -194 L74 -88 Q78 -76 64 -74 L-64 -74 Q-78 -76 -74 -88 Z" fill="palette(dress)" stroke="palette(dressShade)" stroke-width="3" stroke-linejoin="round"/>` +
      `<path d="M-66 -86 L66 -86" stroke="palette(dressShade)" stroke-width="3" opacity="0.5"/>`,
    handNear: outlined(`<circle cx="62" cy="-92" r="8"/>`, "palette(skin)", 5),
    handFar: outlined(`<circle cx="-76" cy="-112" r="8"/>`, "palette(skinShade)", 5),
    shoeNear: `<path d="M8 -2 Q8 -16 26 -15 Q44 -14 44 -4 Q44 2 26 2 Q8 2 8 -2 Z" fill="palette(shoe)"/>`,
    shoeFar: `<path d="M-32 -2 Q-32 -16 -14 -15 Q4 -14 4 -4 Q4 2 -14 2 Q-32 2 -32 -2 Z" fill="palette(shoe)" opacity="0.85"/>`,
  },
  skeleton: [
    { id: "root" },
    { id: "hips", parent: "root", from: [0, -86], to: [0, -96], mass: 3 },
    { id: "body", parent: "hips", from: [0, -86], to: [0, -196], mass: 3 },
    { id: "head", parent: "body", from: [0, -196], to: [0, -250], mass: 2, limits: { rotation: [-35, 35] } },
    { id: "pupils", parent: "head", from: [40, -283] },
    { id: "earFar", parent: "head", from: [-14, -306], to: [-26, -342], mass: 0.4 },
    { id: "earNear", parent: "head", from: [12, -310], to: [10, -350], mass: 0.4 },
    { id: "armNear1", parent: "body", from: [16, -172], to: [44, -132], mass: 0.6 },
    { id: "armNear2", parent: "armNear1", from: [44, -132], to: [62, -92], mass: 0.4 },
    { id: "armFar1", parent: "body", from: [-16, -172], to: [-46, -140], mass: 0.6 },
    { id: "armFar2", parent: "armFar1", from: [-46, -140], to: [-76, -112], mass: 0.4 },
    { id: "legNear1", parent: "hips", from: [16, -84], to: [27, -46], mass: 1 },
    { id: "legNear2", parent: "legNear1", from: [27, -46], to: [20, -6], mass: 0.8 },
    { id: "legFar1", parent: "hips", from: [-16, -84], to: [-9, -46], mass: 1 },
    { id: "legFar2", parent: "legFar1", from: [-9, -46], to: [-20, -6], mass: 0.8 },
    // Feet keep their world orientation so shoes stay flat on the ground.
    { id: "toeNear", parent: "legNear2", from: [20, -6], to: [40, -6], inheritRotation: false },
    { id: "toeFar", parent: "legFar2", from: [-20, -6], to: [0, -6], inheritRotation: false },
    { id: "tail1", parent: "body", from: [-68, -112], to: [-82, -120], mass: 0.2 },
    { id: "tail2", parent: "tail1", from: [-82, -120], to: [-92, -110], mass: 0.2 },
    { id: "tail3", parent: "tail2", from: [-92, -110], to: [-84, -102], mass: 0.2 },
  ],
  parts: [
    { id: "earFar", type: "rigid", bone: "earFar", art: "earFar" },
    { id: "armFar", type: "hose", bones: ["armFar1", "armFar2"], width: [11, 9], fill: "palette(skinShade)", stroke: "palette(outline)", strokeWidth: 2.5 },
    { id: "handFar", type: "rigid", bone: "armFar2", art: "handFar" },
    { id: "legFar", type: "hose", bones: ["legFar1", "legFar2"], width: [13, 11], fill: "palette(skinShade)", stroke: "palette(outline)", strokeWidth: 2.5 },
    { id: "shoeFar", type: "rigid", bone: "toeFar", art: "shoeFar" },
    { id: "legNear", type: "hose", bones: ["legNear1", "legNear2"], width: [13, 11], fill: "palette(skin)", stroke: "palette(outline)", strokeWidth: 2.5 },
    { id: "shoeNear", type: "rigid", bone: "toeNear", art: "shoeNear" },
    { id: "tail", type: "hose", bones: ["tail1", "tail2", "tail3"], width: [7, 4], fill: "palette(skin)", stroke: "palette(outline)", strokeWidth: 2 },
    { id: "dress", type: "rigid", bone: "body", art: "dress" },
    { id: "earNear", type: "rigid", bone: "earNear", art: "earNear" },
    { id: "head", type: "rigid", bone: "head", art: "head" },
    { id: "cheek", type: "rigid", bone: "head", art: "cheek" },
    {
      id: "eyes",
      type: "switch",
      bone: "head",
      variants: { open: "eyesOpen", closed: "eyesClosed", happy: "eyesHappy", sad: "eyesSad" },
      default: "open",
    },
    { id: "pupils", type: "rigid", bone: "pupils", art: "pupils", visibleWhen: { part: "eyes", variant: ["open", "sad"] } },
    {
      id: "mouth",
      type: "morph",
      bone: "head",
      fill: "palette(mouth)",
      base: mouth(30, 2.5, 5),
      shapes: {
        A: mouth(26, 1, 3),
        B: mouth(28, 7, 3),
        C: mouth(30, 13, 2),
        D: mouth(34, 21, 1),
        E: mouth(22, 15, 0),
        F: mouth(14, 9, 0),
        G: mouth(26, 5, 2),
        H: mouth(28, 12, 2),
        smile: mouth(38, 9, 9),
        frown: mouth(26, 3, -6),
      },
    },
    { id: "armNear", type: "hose", bones: ["armNear1", "armNear2"], width: [11, 9], fill: "palette(skin)", stroke: "palette(outline)", strokeWidth: 2.5 },
    { id: "handNear", type: "rigid", bone: "armNear2", art: "handNear" },
  ],
  anchors: {
    head: { bone: "head", at: [40, -262] },
    handNear: { bone: "armNear2", at: [62, -92] },
    handFar: { bone: "armFar2", at: [-76, -112] },
  },
  ik: [
    { id: "footNear", bones: ["legNear1", "legNear2"], bend: 1 },
    { id: "footFar", bones: ["legFar1", "legFar2"], bend: 1 },
  ],
  physics: [
    { type: "spring", bones: ["earNear"], stiffness: 0.42, damping: 0.22, gravity: [0, 300] },
    { type: "spring", bones: ["earFar"], stiffness: 0.4, damping: 0.22, gravity: [0, 300] },
    { type: "spring", bones: ["tail1", "tail2", "tail3"], stiffness: 0.35, damping: 0.18 },
  ],
  colliders: [
    { bone: "body", radius: 46 },
    { bone: "head", radius: 50 },
    { bone: "legNear2", radius: 9 },
    { bone: "legFar2", radius: 9 },
  ],
  controls: {
    mouth: { type: "viseme", part: "mouth" },
    look: {
      type: "aim",
      targets: [
        { bone: "head", forward: 90, maxAngle: 18, weight: 0.45 },
        { bone: "pupils", mode: "translate", radius: 4.5 },
      ],
    },
    emotion: {
      type: "pose",
      poses: {
        happy: { "parts.eyes.variant": "happy", "parts.mouth.morph.smile": 0.9, "bones.head.rotation": -4, "bones.earNear.rotation": -6 },
        sad: {
          "parts.eyes.variant": "sad",
          "parts.mouth.morph.frown": 1,
          "bones.head.rotation": 9,
          "bones.earNear.rotation": 22,
          "bones.earFar.rotation": 18,
          "bones.body.rotation": 3,
        },
        surprised: { "parts.mouth.morph.E": 0.8, "bones.head.rotation": -6, "bones.earNear.rotation": -12, "bones.earFar.rotation": -10 },
      },
    },
  },
  behaviors: [
    { type: "blink", id: "blink", part: "eyes", open: "open", closed: "closed", interval: [2.2, 5], duration: 0.14 },
    { type: "breathe", id: "breathe", bone: "body", amount: 0.012, period: 3.2 },
    { type: "sway", id: "sway", bone: "head", angle: 1.5, period: 4.5 },
  ],
  clips: {
    idle: {
      duration: 3,
      loop: true,
      tracks: {
        "bones.armNear1.rotation": [[0, 0], [1.5, 4], [3, 0]],
        "bones.armFar1.rotation": [[0, 0], [1.5, -3], [3, 0]],
        "bones.body.rotation": [[0, 0], [1.5, 1], [3, 0]],
      },
    },
    wave: {
      duration: 1.2,
      loop: true,
      tracks: {
        "bones.armNear1.rotation": [[0, -60], [0.6, -66], [1.2, -60]],
        "bones.armNear2.rotation": [[0, -85], [0.3, -45], [0.6, -85], [0.9, -45], [1.2, -85]],
        "bones.head.rotation": [[0, -3], [0.6, -5], [1.2, -3]],
        "bones.body.rotation": [[0, -2], [0.6, -3], [1.2, -2]],
      },
    },
    walk: {
      duration: 0.8,
      loop: true,
      stride: 112,
      tracks: {
        // Feet: linear stance (no sliding), lifted swing.
        "ik.footNear.x": [[0, 28], [0.4, -28, "linear"], [0.6, 0], [0.8, 28]],
        "ik.footNear.y": [[0, 0], [0.4, 0, "linear"], [0.6, -20], [0.8, 0]],
        "ik.footFar.x": [[0, -28], [0.2, 0], [0.4, 28], [0.8, -28, "linear"]],
        "ik.footFar.y": [[0, 0], [0.2, -20], [0.4, 0], [0.8, 0, "linear"]],
        "bones.hips.y": [[0, 9], [0.2, 2], [0.4, 9], [0.6, 2], [0.8, 9]],
        "bones.armNear1.rotation": [[0, -22], [0.4, 22], [0.8, -22]],
        "bones.armFar1.rotation": [[0, 22], [0.4, -22], [0.8, 22]],
        "bones.body.rotation": [[0, 3], [0.2, 4], [0.4, 3], [0.6, 4], [0.8, 3]],
        "bones.head.rotation": [[0, -2], [0.2, 0], [0.4, -2], [0.6, 0], [0.8, -2]],
      },
    },
    kick: {
      duration: 0.75,
      tracks: {
        "ik.footNear.x": [[0, 0], [0.2, -28, "easeOut"], [0.32, 72, "easeIn"], [0.45, 64], [0.75, 0]],
        "ik.footNear.y": [[0, 0], [0.2, -10], [0.32, -38], [0.45, -32], [0.75, 0]],
        "bones.hips.y": [[0, 0], [0.2, 4], [0.32, -2], [0.75, 0]],
        "bones.body.rotation": [[0, 0], [0.2, 5], [0.32, -7, "easeIn"], [0.75, 0]],
        "bones.armNear1.rotation": [[0, 0], [0.2, 25], [0.32, -45, "easeIn"], [0.75, 0]],
        "bones.armFar1.rotation": [[0, 0], [0.2, -15], [0.32, 45, "easeIn"], [0.75, 0]],
      },
    },
    jump: {
      duration: 1.1,
      tracks: {
        "bones.root.y": [[0, 0], [0.25, 0], [0.55, -110, "sineOut"], [0.85, 0, "sineIn"], [1.1, 0]],
        "ik.footNear.y": [[0, 0], [0.25, 0], [0.55, -110, "sineOut"], [0.85, 0, "sineIn"], [1.1, 0]],
        "ik.footFar.y": [[0, 0], [0.25, 0], [0.55, -110, "sineOut"], [0.85, 0, "sineIn"], [1.1, 0]],
        "bones.hips.y": [[0, 0], [0.25, 14, "easeOut"], [0.35, -6, "easeOut"], [0.55, -14], [0.85, 0], [0.92, 12, "easeOut"], [1.1, 0, "backOut"]],
        "bones.body.squash": [[0, 0], [0.25, -0.12, "easeOut"], [0.35, 0.1, "easeOut"], [0.6, 0], [0.85, 0], [0.92, -0.1, "easeOut"], [1.1, 0, "backOut"]],
        "bones.armNear1.rotation": [[0, 0], [0.25, 25], [0.4, -62, "backOut"], [0.85, -50], [1.1, 0]],
        "bones.armFar1.rotation": [[0, 0], [0.25, -20], [0.4, 80, "backOut"], [0.85, 60], [1.1, 0]],
        "bones.armNear2.rotation": [[0, 0], [0.25, 10], [0.4, 15], [0.85, 10], [1.1, 0]],
      },
    },
  },
};
