import { describe, expect, it } from "vitest";
import { compileRig, drawSolid, evaluatePose, makeTrack, resolveChannel } from "../src";

// A leg on a 2.5D rig (a thigh and a shin as a solid), in a colour.
const legDoc = (fill: string) => ({
  format: "toon",
  version: 1,
  name: "leg",
  skeleton: [
    { id: "root" },
    { id: "body", parent: "root", from: [0, -100], to: [0, -200] },
    { id: "thigh", parent: "body", from: [0, -100], to: [0, -50] },
    { id: "shin", parent: "thigh", from: [0, -50], to: [0, 0] },
  ],
  parts: [
    {
      id: "leg",
      type: "solid",
      step: 2,
      bodies: [
        { fill, shade: "#a80", stroke: "#530", strokeWidth: 2, blend: 4, shapes: [{ from: { bone: "thigh" }, to: { bone: "thigh", t: 1 }, r: [12, 9] }, { from: { bone: "shin" }, to: { bone: "shin", t: 1 }, r: [9, 7] }] },
      ],
    },
  ],
  rig3d: {
    bones: { body: { from: [0, -100, 0], to: [0, -200, 0] }, thigh: { from: [0, -100, 0], to: [0, -50, 0] }, shin: { from: [0, -50, 0], to: [0, 0, 0] } },
    views: { front: 0, side: 90 },
  },
});

type SolidPart = Extract<ReturnType<typeof compileRig>["parts"][number], { type: "solid" }>;

const draw = (rig: ReturnType<typeof compileRig>, thigh: number) => {
  const part = rig.parts.find((q) => q.id === "leg")! as SolidPart;
  const pose = evaluatePose(rig, {
    time: 0,
    tracks: [
      { channel: "controls.view", ref: { kind: "control", name: "view" }, track: makeTrack([{ t: 0, v: "side" }]) },
      { channel: "bones.thigh.rotation", ref: resolveChannel(rig, "bones.thigh.rotation"), track: makeTrack([{ t: 0, v: thigh }]) },
    ],
  } as never);
  return drawSolid(part.bodies, part.step, rig.rig3d!, pose.frame3d!);
};

describe("solid drawing cache", () => {
  it("keys the cache by the bodies' colours: two rigs with the same geometry draw in their own colours", () => {
    const red = compileRig(legDoc("#ff0000") as never);
    const blue = compileRig(legDoc("#0000ff") as never);
    expect(draw(red, -40).some((p) => p.attrs.fill === "#ff0000")).toBe(true);
    const b = draw(blue, -40);
    expect(b.some((p) => p.attrs.fill === "#0000ff")).toBe(true);
    expect(b.some((p) => p.attrs.fill === "#ff0000")).toBe(false);
  });

  it("keys the cache by the pose at full precision: a frame is the same drawing whatever was drawn before it", () => {
    const rig = compileRig(legDoc("#fc0") as never);
    const a1 = draw(rig, -40);
    // A pose that differs by less than half a pixel is its own drawing, not the first one's.
    const b = draw(rig, -40.2);
    expect(b).not.toBe(a1);
    expect(b.map((p) => p.d).join()).not.toBe(a1.map((p) => p.d).join());
    // The first pose again: the cached drawing of that very pose.
    expect(draw(rig, -40)).toBe(a1);
    // Drawn in another order, the same paths come out.
    const fresh = compileRig(legDoc("#fc0") as never);
    const order = [-40.2, -40, -39.8, -40.1].map((r) => draw(fresh, r).map((p) => p.d).join());
    const reverse = [-40.1, -39.8, -40, -40.2].map((r) => draw(compileRig(legDoc("#fc0") as never), r).map((p) => p.d).join()).reverse();
    expect(order).toEqual(reverse);
  });
});
