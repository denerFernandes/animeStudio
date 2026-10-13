import { describe, expect, it } from "vitest";
import { compileRig, evaluatePose } from "@animestudio/core";
import { cartoonCharacter } from "../src";

// The far arm is its own solid (`armsB`, like a cut-out animator's far-arm layer): while its upper
// arm is behind the torso it is drawn before the body's whole drawing — the torso's outline covers
// where it goes in — and in its place among the parts otherwise.

const doc = cartoonCharacter({
  name: "mom", build: "woman", female: true, skin: "#e8b896", hair: "bun", hairColor: "#5b3a29", top: "blouse", topColor: "#e98a7b",
  bottom: "longSkirt", bottomColor: "#7c8f6a", shoes: "sandals", nose: "round",
} as never);
const rig = compileRig(doc);
const order = (view: string) => {
  const pose = evaluatePose(rig, { time: 0.4, controls: { view } } as never);
  return (pose.drawOrder ?? rig.drawOrder).map((p) => p.id);
};

describe("far arm layer", () => {
  it("has a solid of its own before the near arm's", () => {
    const ids = rig.drawOrder.map((p) => p.id);
    expect(ids).toContain("armsB");
    expect(ids.indexOf("armsB")).toBeLessThan(ids.indexOf("arms"));
  });
  for (const view of ["profile", "half", "q50"]) {
    it(`${view}: hanging behind the torso, it is drawn before the torso's drawing`, () => {
      const ids = order(view);
      const torso = ids.findIndex((id) => /^torso/.test(id));
      expect(ids.indexOf("armsB")).toBeLessThan(torso);
    });
  }
  it("front: level with the torso, it keeps its place after it", () => {
    const ids = order("front");
    const torso = ids.findIndex((id) => /^torso/.test(id));
    expect(ids.indexOf("armsB")).toBeGreaterThan(torso);
  });
});
