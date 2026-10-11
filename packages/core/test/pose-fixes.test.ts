import { describe, expect, it } from "vitest";
import { type ClipInstance, apply, applyPhysicsSample, compileRig, evaluatePose, makeTrack, resolveChannel, rig3dPose } from "../src";
import { stick } from "./fixtures";

const near = (a: number, b: number, eps = 1e-3) => expect(Math.abs(a - b)).toBeLessThan(eps);

// ---------------------------------------------------------------- M1: stepped control values from clips

describe("control channels from clips", () => {
  const doc = {
    ...stick,
    clips: {
      ...stick.clips,
      calm: { duration: 1, tracks: { "controls.emotion": [[0, "calm"]] } },
      sad: { duration: 1, tracks: { "controls.emotion": [[0, "sad"]] } },
      sadWeights: { duration: 1, tracks: { "controls.emotion": [[0, { sad: 1 }]] } },
      noWeights: { duration: 1, tracks: { "controls.emotion": [[0, { sad: 0 }]] } },
    },
  };
  const rig = compileRig(doc as never);
  const inst = (clip: string, layer: number, weight: number): ClipInstance => ({ clip, start: 0, end: Infinity, speed: 1, loop: false, fadeIn: 0, fadeOut: 0, layer, blend: "override", weight });
  const head = rig.boneIndex.get("head")!;

  it("a name on top of a name switches at half weight, like a variant", () => {
    const at = (w: number) => evaluatePose(rig, { time: 0, clips: [inst("calm", 0, 1), inst("sad", 1, w)] });
    expect(at(0.99).state.controls.emotion).toBe("sad");
    near(at(0.99).state.brot[head], 20);
    expect(at(0.5).state.controls.emotion).toBe("sad");
    expect(at(0.49).state.controls.emotion).toBe("calm");
    near(at(0.49).state.brot[head], 0);
  });
  it("a name against weights switches too; weights on weights still blend", () => {
    const mixed = evaluatePose(rig, { time: 0, clips: [inst("calm", 0, 1), inst("sadWeights", 1, 0.6)] });
    expect(mixed.state.controls.emotion).toEqual({ sad: 1 });
    near(mixed.state.brot[head], 20);
    const blended = evaluatePose(rig, { time: 0, clips: [inst("noWeights", 0, 1), inst("sadWeights", 1, 0.5)] });
    expect(blended.state.controls.emotion).toEqual({ sad: 0.5 });
    near(blended.state.brot[head], 10);
  });
});

// ---------------------------------------------------------------- M5: the sign of spread (the engine's math, documented truthfully)

describe("rig3d channel signs", () => {
  const hanging = { skeleton: [{ id: "hips" }, { id: "limb", parent: "hips" }], rig3d: { bones: { hips: { from: [0, 0, 0], to: [0, -10, 0] }, limb: { from: [0, 0, 0], to: [0, 100, 0] } } } } as never;
  const forward = { skeleton: [{ id: "hips" }, { id: "limb", parent: "hips" }], rig3d: { bones: { hips: { from: [0, 0, 0], to: [0, -10, 0] }, limb: { from: [0, 0, 0], to: [0, 0, 100] } } } } as never;
  it("+spread swings a hanging limb towards -x, +rotation backwards, +turn turns the front towards +x", () => {
    const spread = rig3dPose(hanging, { limb: { spread: 30 } }).limb.to;
    near(spread[0], -50);
    near(spread[1], 86.603);
    const rot = rig3dPose(hanging, { limb: { rotation: 30 } }).limb.to;
    near(rot[2], -50);
    const turn = rig3dPose(forward, { limb: { turn: 30 } }).limb.to;
    near(turn[0], 50);
  });
});

// ---------------------------------------------------------------- B9: setup-form bones under a parent with rest scale

describe("setup-form bones under scaled parents", () => {
  const doc = {
    format: "toon", version: 1, name: "scaled",
    skeleton: [
      { id: "root", x: 5, y: -7, rotation: 30, scaleX: 2, scaleY: 0.5 },
      { id: "both", parent: "root", from: [10, 20], to: [50, 60] },
      { id: "noScale", parent: "root", from: [10, 20], to: [50, 60], inheritScale: false },
      { id: "noRot", parent: "root", from: [10, 20], to: [50, 60], inheritRotation: false },
      { id: "neither", parent: "root", from: [10, 20], to: [50, 60], inheritRotation: false, inheritScale: false },
      { id: "own", parent: "root", from: [10, 20], to: [50, 60], scaleX: 2 },
      { id: "grand", parent: "both", from: [50, 60], to: [20, 90] },
      { id: "mirror", x: 0, y: 0, scaleY: -1 },
      { id: "mirrored", parent: "mirror", from: [10, 20], to: [50, 60] },
      { id: "tipless", parent: "root", from: [10, 20] },
    ],
    parts: [],
  };
  const rig = compileRig(doc as never);
  const joint = (id: string) => apply(rig.bones[rig.boneIndex.get(id)!].setupWorld, [0, 0]);
  const tip = (id: string) => { const b = rig.bones[rig.boneIndex.get(id)!]; return apply(b.setupWorld, [b.length, 0]); };
  it("the joint lands on `from` and the tip on `to`, whatever the bone inherits", () => {
    for (const id of ["both", "noScale", "noRot", "neither", "own", "mirrored"]) {
      near(joint(id)[0], 10, 1e-6);
      near(joint(id)[1], 20, 1e-6);
      near(tip(id)[0], 50, 1e-6);
      near(tip(id)[1], 60, 1e-6);
    }
    near(tip("grand")[0], 20, 1e-6);
    near(tip("grand")[1], 90, 1e-6);
  });
  it("a bone without `to` has length 0 and world rotation 0", () => {
    const b = rig.bones[rig.boneIndex.get("tipless")!];
    expect(b.length).toBe(0);
    const dir = apply(b.setupWorld, [1, 0]);
    near(Math.atan2(dir[1] - 20, dir[0] - 10), 0, 1e-6);
  });
});

// ---------------------------------------------------------------- B12: side-plane leg IK on a 2.5D rig

describe("side-plane leg IK", () => {
  // A hip, a torso, a front leg (knee a little forward at rest) and a front arm; feet and hands have IK.
  const doc = {
    format: "toon", version: 1, name: "biped",
    skeleton: [
      { id: "root" },
      { id: "hips", parent: "root", from: [0, -100], to: [0, -110] },
      { id: "body", parent: "hips", from: [0, -100], to: [0, -180] },
      { id: "legF1", parent: "hips", from: [0, -100], to: [0, -50] },
      { id: "legF2", parent: "legF1", from: [0, -50], to: [0, 0] },
      { id: "armF1", parent: "body", from: [0, -170], to: [0, -130] },
      { id: "armF2", parent: "armF1", from: [0, -130], to: [0, -90] },
    ],
    parts: [{ id: "torso", type: "rigid", bone: "body", art: "<rect x='-10' y='-180' width='20' height='80'/>" }],
    ik: [
      { id: "footF", bones: ["legF1", "legF2"], bend: 1 },
      { id: "handF", bones: ["armF1", "armF2"], bend: 1, mix: 0 },
    ],
    physics: [{ type: "spring", bones: ["legF1", "legF2"], stiffness: 0.3, damping: 0.2 }],
    controls: { view: { type: "pose", poses: { front: {}, side: {} } } },
    rig3d: {
      bones: {
        hips: { from: [0, -100, 0], to: [0, -110, 0] },
        body: { from: [0, -100, 0], to: [0, -180, 0] },
        legF1: { from: [0, -100, 0], to: [0, -50, 3] },
        legF2: { from: [0, -50, 3], to: [0, 0, 0] },
        armF1: { from: [0, -170, 0], to: [0, -130, 0] },
        armF2: { from: [0, -130, 0], to: [0, -90, 0] },
      },
      views: { front: 0, side: 90 },
      chains: [{ bones: ["legF1", "legF2"], parts: [] }, { bones: ["armF1", "armF2"], parts: [] }],
    },
  };
  const rig = compileRig(doc as never);
  const bone = (id: string) => rig.boneIndex.get(id)!;
  const tr = (ch: string, v: unknown) => ({ channel: ch, ref: resolveChannel(rig, ch), track: makeTrack([{ t: 0, v: v as never }]) });
  const pose = (view: string, tracks: ReturnType<typeof tr>[], extra: Record<string, unknown> = {}) => evaluatePose(rig, { time: 0, controls: { view }, tracks, ...extra } as never);
  const tipOf = (p: ReturnType<typeof evaluatePose>, id: string) => apply(p.world[bone(id)], [rig.bones[bone(id)].length, 0]);
  const jointOf = (p: ReturnType<typeof evaluatePose>, id: string) => apply(p.world[bone(id)], [0, 0]);

  it("legs are the hanging chains ending at the bottom of the skeleton, by geometry — not by name", () => {
    expect(rig.rig3d!.sideIk).toEqual([0]);
    const renamed = { ...doc, skeleton: doc.skeleton.map((b) => ({ ...b, id: b.id.replace("leg", "limb"), ...(b.parent ? { parent: b.parent.replace("leg", "limb") } : {}) })), ik: [{ id: "footF", bones: ["limbF1", "limbF2"], bend: 1 }], physics: [], rig3d: { ...doc.rig3d, bones: Object.fromEntries(Object.entries(doc.rig3d.bones).map(([k, v]) => [k.replace("leg", "limb"), v])) } };
    expect(compileRig(renamed as never).rig3d!.sideIk).toEqual([0]);
  });
  it("a step forward is solved in the side plane: forward in profile, towards the camera from the front", () => {
    const step = [tr("ik.footF.x", 20), tr("ik.footF.y", -10)];
    const side = pose("side", step), front = pose("front", step);
    expect(side.frame3d!.sideIk).toEqual([0]);
    near(tipOf(side, "legF2")[0] - jointOf(side, "legF1")[0], 20, 0.5);
    near(tipOf(side, "legF2")[1], -10, 0.5);
    // Not re-solved by the 2D pass (which would put the foot 20 px to the right in the front view).
    near(tipOf(front, "legF2")[0] - jointOf(front, "legF1")[0], 0, 0.5);
    near(tipOf(front, "legF2")[1], -10, 0.5);
    expect(front.state.bsq[bone("legF1")]).toBeLessThan(-0.01);
  });
  it("honours the chain's bend channel: the knee goes the other way", () => {
    const fwd = pose("side", [tr("ik.footF.y", -20)]);
    const back = pose("side", [tr("ik.footF.y", -20), tr("ik.footF.bend", -1)]);
    expect(jointOf(fwd, "legF2")[0] - jointOf(fwd, "legF1")[0]).toBeGreaterThan(5);
    expect(jointOf(back, "legF2")[0] - jointOf(back, "legF1")[0]).toBeLessThan(-5);
  });
  it("takes the ground under the foot (ikOffset) by its height", () => {
    const lifted = pose("side", [], { ikOffset: { footF: [0, -15] } });
    near(tipOf(lifted, "legF2")[1], -15, 0.5);
  });
  it("keeps the chain's mix on, so a spring on the placed leg gives way", () => {
    const placed = pose("front", [tr("ik.footF.y", -10)]);
    expect(placed.state.ikMix[0]).toBe(1);
    const before = placed.state.brot[bone("legF1")];
    applyPhysicsSample(rig, placed, { values: [[30, 30]] });
    near(placed.state.brot[bone("legF1")], before);
    const loose = pose("front", [tr("ik.footF.mix", 0)]);
    const was = loose.state.brot[bone("legF1")];
    applyPhysicsSample(rig, loose, { values: [[30, 30]] });
    near(loose.state.brot[bone("legF1")], was + 30);
  });
  it("an arm chain is not a leg: a hand target is solved in the picture", () => {
    const reach = pose("front", [tr("ik.handF.mix", 1), tr("ik.handF.x", 30), tr("ik.handF.y", -10)]);
    expect(reach.frame3d!.sideIk).toEqual([0]);
    near(tipOf(reach, "armF2")[0], 30, 0.5);
    near(tipOf(reach, "armF2")[1], -100, 0.5);
  });
  it("a held foot (an absolute target) goes to the 2D pass", () => {
    const held = pose("front", [], { ikTarget: { footF: { point: [25, -10], weight: 1 } } });
    expect(held.frame3d!.sideIk).toEqual([]);
    near(tipOf(held, "legF2")[0], 25, 0.5);
    near(tipOf(held, "legF2")[1], -10, 0.5);
  });
});
