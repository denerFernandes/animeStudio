import type { ToonDoc } from "../src";

/** A minimal stick character used across tests. */
export const stick: ToonDoc = {
  format: "toon",
  version: 1,
  name: "stick",
  palette: { skin: "#f0c", ink: "#222" },
  art: {
    body: "<rect x='-20' y='-120' width='40' height='80' fill='palette(skin)'/>",
    mouthA: "<path d='M0 0h10'/>",
    mouthD: "<ellipse rx='6' ry='8'/>",
    mouthX: "<path d='M0 0h8'/>",
  },
  skeleton: [
    { id: "root" },
    { id: "body", parent: "root", from: [0, -40], to: [0, -120] },
    { id: "head", parent: "body", from: [0, -120], to: [0, -160] },
    { id: "arm1", parent: "body", from: [0, -110], to: [40, -110] },
    { id: "arm2", parent: "arm1", from: [40, -110], to: [80, -110] },
    { id: "tail1", parent: "body", from: [0, -60], to: [-30, -60], mass: 0.5 },
    { id: "tail2", parent: "tail1", from: [-30, -60], to: [-60, -60], mass: 0.5 },
  ],
  parts: [
    { id: "tail", type: "hose", bones: ["tail1", "tail2"], width: [8, 4], fill: "palette(skin)" },
    { id: "body", type: "rigid", bone: "body", art: "body" },
    { id: "arm", type: "hose", bones: ["arm1", "arm2"], width: 10, fill: "palette(ink)" },
    {
      id: "limb",
      type: "skinned",
      path: "M0 -110 L40 -110 L80 -110",
      bones: ["arm1", "arm2"],
      stroke: "palette(ink)",
      strokeWidth: 4,
    },
    { id: "mouth", type: "switch", bone: "head", variants: { A: "mouthA", D: "mouthD", X: "mouthX" }, default: "X" },
  ],
  anchors: { head: { bone: "head", at: [0, -150] }, hand: { bone: "arm2", at: [80, -110] } },
  ik: [{ id: "hand", bones: ["arm1", "arm2"], mix: 0 }],
  physics: [{ type: "spring", bones: ["tail1", "tail2"], stiffness: 0.3, damping: 0.2 }],
  controls: {
    mouth: { type: "viseme", part: "mouth" },
    look: { type: "aim", targets: [{ bone: "head", forward: -90, maxAngle: 30 }] },
    emotion: { type: "pose", poses: { sad: { "bones.head.rotation": 20, "parts.mouth.variant": "A" } } },
  },
  clips: {
    wave: {
      duration: 1,
      loop: true,
      tracks: { "bones.arm1.rotation": [[0, 0], [0.5, -90], [1, 0]] },
    },
    walk: {
      duration: 1,
      loop: true,
      stride: 200,
      tracks: { "bones.body.rotation": [[0, -3], [0.5, 3], [1, -3]] },
    },
  },
};
