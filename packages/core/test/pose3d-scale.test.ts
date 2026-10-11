import { describe, expect, it } from "vitest";
import { apply, compileRig, evaluatePose, makeTrack, resolveChannel, viewPoint } from "../src";

// The 2.5D projection must agree with the 2D forward kinematics whatever the bones' scales: rest
// scales (uniform, non-uniform, mirrored), scale channels, and a parent squashed by its own scale.
const biped = (scales: Record<string, { scaleX?: number; scaleY?: number }>) => ({
  format: "toon", version: 1, name: "biped",
  skeleton: [
    { id: "root" },
    { id: "hips", parent: "root", from: [0, -100], to: [0, -110], ...scales.hips },
    { id: "body", parent: "hips", from: [0, -100], to: [0, -180], ...scales.body },
    { id: "legF1", parent: "hips", from: [0, -100], to: [0, -50], ...scales.legF1 },
    { id: "legF2", parent: "legF1", from: [0, -50], to: [0, 0], ...scales.legF2 },
    { id: "armF1", parent: "body", from: [0, -170], to: [0, -130], ...scales.armF1 },
    { id: "armF2", parent: "armF1", from: [0, -130], to: [0, -90], inheritRotation: false, ...scales.armF2 },
  ],
  parts: [{ id: "torso", type: "rigid", bone: "body", art: "<rect x='-10' y='-180' width='20' height='80'/>" }],
  ik: [{ id: "footF", bones: ["legF1", "legF2"], bend: 1 }],
  controls: { view: { type: "pose", poses: { front: {}, side: {}, q: {} } } },
  rig3d: {
    bones: {
      hips: { from: [0, -100, 0], to: [0, -110, 0] },
      body: { from: [0, -100, 0], to: [0, -180, 0] },
      legF1: { from: [0, -100, 0], to: [0, -50, 3] },
      legF2: { from: [0, -50, 3], to: [0, 0, 0] },
      armF1: { from: [0, -170, 0], to: [0, -130, 0] },
      armF2: { from: [0, -130, 0], to: [0, -90, 0] },
    },
    views: { front: 0, side: 90, q: 40 },
    pitch: 12,
    chains: [{ bones: ["legF1", "legF2"], parts: [] }, { bones: ["armF1", "armF2"], parts: [] }],
  },
});

const cases: [string, Record<string, { scaleX?: number; scaleY?: number }>][] = [
  ["unit scales", {}],
  ["a uniformly scaled torso", { body: { scaleX: 1.5, scaleY: 1.5 } }],
  ["unevenly scaled hips (every 3D bone under them)", { hips: { scaleX: 1.5, scaleY: 0.8 } }],
  ["a limb bone with its own rest scale", { legF1: { scaleX: 1.4 }, armF1: { scaleY: 0.7 } }],
  ["a mirrored parent", { body: { scaleX: -1 } }],
];

describe("applyRig3d with scaled 2D bones", () => {
  for (const [name, scales] of cases) {
    it(`matches the projection with ${name}`, () => {
      const rig = compileRig(biped(scales) as never);
      const tr = (ch: string, v: unknown) => ({ channel: ch, ref: resolveChannel(rig, ch), track: makeTrack([{ t: 0, v: v as never }]) });
      for (const view of ["front", "side", "q"]) {
        const tracks = [tr("ik.footF.x", 15), tr("ik.footF.y", -8), tr("bones.armF1.rotation", -50), tr("bones.armF1.turn", 30), tr("bones.body.scaleX", 1.3), tr("bones.legF2.scaleY", 0.8)];
        const p = evaluatePose(rig, { time: 0, controls: { view }, tracks } as never);
        const f = p.frame3d!;
        for (const [i, B] of rig.rig3d!.bones.entries()) {
          const joint2d = apply(p.world[B.index], [0, 0]);
          const tip2d = apply(p.world[B.index], [rig.bones[B.index].length, 0]);
          const j = viewPoint(f.pos[i], f.yaw, f.pitch);
          const joint3d = [j[0] + f.off[0], j[1] + f.off[1]];
          const tip3d = f.tipView.get(B.index)!;
          expect(Math.hypot(joint2d[0] - joint3d[0], joint2d[1] - joint3d[1]), `${rig.bones[B.index].id} joint in ${view}`).toBeLessThan(0.05);
          // Limbs foreshorten to the projected length; a torso keeps its drawing (unsquashed), so only its direction must match.
          const limb = rig.rig3d!.chains.some((c) => c.bones.includes(B.index));
          if (limb) expect(Math.hypot(tip2d[0] - tip3d[0], tip2d[1] - tip3d[1]), `${rig.bones[B.index].id} tip in ${view}`).toBeLessThan(0.05);
          else {
            const a2 = Math.atan2(tip2d[1] - joint2d[1], tip2d[0] - joint2d[0]), a3 = Math.atan2(tip3d[1] - joint3d[1], tip3d[0] - joint3d[0]);
            if (Math.hypot(tip3d[0] - joint3d[0], tip3d[1] - joint3d[1]) > 1) expect(Math.abs(Math.atan2(Math.sin(a2 - a3), Math.cos(a2 - a3))), `${rig.bones[B.index].id} direction in ${view}`).toBeLessThan(1e-3);
          }
        }
      }
    });
  }
});
