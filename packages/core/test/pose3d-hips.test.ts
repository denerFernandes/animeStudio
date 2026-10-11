import { describe, expect, it } from "vitest";
import { apply, compileRig, evaluatePose, makeTrack, resolveChannel } from "../src";

// A 2.5D rig's leg targets are in character space like a 2D chain's: the hips moving (a crouch,
// the bob of a walk) do not carry the planted feet with them.
const doc = {
  format: "toon", version: 1, name: "biped",
  skeleton: [
    { id: "root" },
    { id: "hips", parent: "root", from: [0, -100], to: [0, -110] },
    { id: "legF1", parent: "hips", from: [0, -100], to: [0, -50] },
    { id: "legF2", parent: "legF1", from: [0, -50], to: [0, 0] },
  ],
  parts: [{ id: "torso", type: "rigid", bone: "hips", art: "<rect x='-10' y='-110' width='20' height='10'/>" }],
  ik: [{ id: "footF", bones: ["legF1", "legF2"], bend: 1 }],
  controls: { view: { type: "pose", poses: { front: {}, side: {} } } },
  rig3d: {
    bones: { hips: { from: [0, -100, 0], to: [0, -110, 0] }, legF1: { from: [0, -100, 0], to: [0, -50, 3] }, legF2: { from: [0, -50, 3], to: [0, 0, 0] } },
    views: { front: 0, side: 90 },
    chains: [{ bones: ["legF1", "legF2"], parts: [] }],
  },
};

describe("2.5D leg targets stay put when the hips move", () => {
  const rig = compileRig(doc as never);
  const foot = rig.boneIndex.get("legF2")!;
  const tr = (ch: string, v: number) => ({ channel: ch, ref: resolveChannel(rig, ch), track: makeTrack([{ t: 0, v }]) });
  for (const view of ["side", "front"]) {
    it(`a crouch (hips.y +30) leaves the planted foot on the floor in the ${view} view`, () => {
      const up = evaluatePose(rig, { time: 0, controls: { view }, tracks: [] } as never);
      const down = evaluatePose(rig, { time: 0, controls: { view }, tracks: [tr("bones.hips.y", 30)] } as never);
      const tipUp = apply(up.world[foot], [rig.bones[foot].length, 0]), tipDown = apply(down.world[foot], [rig.bones[foot].length, 0]);
      expect(tipDown[1]).toBeCloseTo(tipUp[1], 0);
      expect(tipDown[0]).toBeCloseTo(tipUp[0], 0);
      // The knee bends to make room.
      const knee = rig.boneIndex.get("legF2")!;
      expect(Math.abs(apply(down.world[knee], [0, 0])[0] - apply(up.world[knee], [0, 0])[0]) + Math.abs(apply(down.world[knee], [0, 0])[1] - apply(up.world[knee], [0, 0])[1])).toBeGreaterThan(1);
    });
  }
});
