import { describe, expect, it } from "vitest";
import { type SceneDoc, type ToonDoc, actorPose, compileScene, currentVariant } from "../src";
import { stick } from "./fixtures";

// A hand with drawn shapes: it closes around what it holds, whatever a clip or control chose for it.
const holder: ToonDoc = {
  ...stick,
  parts: [
    ...stick.parts,
    { id: "hand", type: "switch", bone: "arm2", variants: { open: "<circle r='4'/>", fist: "<circle r='3'/>", point: "<circle r='2'/>", grip: "<circle r='5'/>" }, default: "open" },
    { id: "plain", type: "switch", bone: "arm2", variants: { a: "<circle r='1'/>", b: "<circle r='1'/>" }, default: "a" },
  ],
  anchors: { ...stick.anchors, hand: { bone: "arm2", at: [80, -110] }, fist: { bone: "arm2", at: [86, -110] } },
  clips: { ...stick.clips, pointing: { duration: 1, loop: true, tracks: { "parts.hand.variant": [[0, "point"]] } } },
} as ToonDoc;

const scene = (script: Record<string, unknown>[]): SceneDoc =>
  ({
    format: "toon-scene", version: 1, width: 400, height: 300, fps: 30, duration: 6,
    characters: { holder: "holder" },
    actors: [{ id: "a", character: "holder", x: 100, y: 250 }],
    props: [{ id: "cup", art: "<rect width='10' height='10'/>", x: 300, y: 250 }],
    script,
  }) as unknown as SceneDoc;

const variantAt = (doc: SceneDoc, t: number) => {
  const sc = compileScene(doc, { characters: { holder } });
  const actor = sc.actors[0];
  const i = actor.rig.partIndex.get("hand")!;
  return { hand: currentVariant(actor.rig, actorPose(sc, actor, t).state, i), plain: currentVariant(actor.rig, actorPose(sc, actor, t).state, actor.rig.partIndex.get("plain")!) };
};

describe("a holding hand closes around the prop", () => {
  it("shows the grip while the prop is held, over a clip pointing, and lets go on release", () => {
    const doc = scene([
      { at: 0, actor: "a", action: "play", clip: "pointing", loop: true, duration: 6 },
      { at: 1, actor: "a", action: "grab", prop: "cup", anchor: "hand" },
      { at: 3, actor: "a", action: "release", prop: "cup" },
    ]);
    expect(variantAt(doc, 0.5).hand).toBe("point");
    expect(variantAt(doc, 2).hand).toBe("grip");
    expect(variantAt(doc, 2).plain).toBe("a"); // a switch part without a grip (or anchor-named) variant is left alone
    expect(variantAt(doc, 4).hand).toBe("point");
  });
  it("shows the variant named after the anchor when the part has one", () => {
    const doc = scene([{ at: 1, actor: "a", action: "grab", prop: "cup", anchor: "fist" }]);
    expect(variantAt(doc, 2).hand).toBe("fist");
  });
});
