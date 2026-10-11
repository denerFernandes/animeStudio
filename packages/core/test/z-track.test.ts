import { describe, expect, it } from "vitest";
import { type SceneDoc, compileScene, evaluateScene } from "../src";
import { stick } from "./fixtures";

const doc: SceneDoc = {
  format: "toon-scene",
  version: 1,
  width: 400,
  height: 300,
  fps: 30,
  duration: 4,
  characters: { stick: "stick" },
  actors: [
    { id: "a", character: "stick", x: 100, y: 250, z: 1 },
    { id: "b", character: "stick", x: 200, y: 250, z: 2 },
  ],
  props: [{ id: "p", art: "<circle r='5'/>", x: 300, y: 250, z: 0 }],
  tracks: { "props.p.z": [[0, 0], [2, 5]] },
  script: [{ at: 1, actor: "a", action: "set", channel: "z", value: 3, duration: 1 }],
} as unknown as SceneDoc;

const order = (t: number) => evaluateScene(compileScene(doc, { characters: { stick } }), t).nodes.map((n) => n.key);

describe("z is an animatable, stepped placement channel", () => {
  it("draws an actor set to a higher z above the others from that moment, with no in-between", () => {
    const before = order(0.5);
    expect(before.indexOf("actor-a")).toBeLessThan(before.indexOf("actor-b"));
    const mid = order(1.5); // a `set` with a duration still cuts: the depth order has no in-between
    expect(mid.indexOf("actor-a")).toBeGreaterThan(mid.indexOf("actor-b"));
    expect(order(1.0).indexOf("actor-a")).toBeGreaterThan(order(1.0).indexOf("actor-b"));
  });
  it("steps a prop's z track", () => {
    expect(order(1).indexOf("prop-p")).toBeLessThan(order(1).indexOf("actor-a"));
    expect(order(3).indexOf("prop-p")).toBeGreaterThan(order(3).indexOf("actor-b"));
  });
});
