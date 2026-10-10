import { describe, expect, it } from "vitest";
import { cartoonCharacter, cartoonInfo } from "../../kit/src";
import { type Kit, type Line, type Staging, direct } from "../src";

// A kid sitting on the floor with a candy cigarette on the lips: takes it out, holds it while
// talking, puts it back.
const look = { name: "kid", build: "kid", skin: "#f6d3b5", hair: "bowl", hairColor: "#5a3a22", top: "tee", topColor: "#2d8f4e", bottom: "shorts", bottomColor: "#3a62b0", shoes: "sneakers" } as const;
const doc = cartoonCharacter(look as never);
const kit = {
  characters: { kid: doc }, cast: { kid: { name: "kid", scale: 1, rig: cartoonInfo(doc, look as never) } },
  sets: { s: { layers: () => [], ground: { near: 900 }, marks: { a: { x: 960 } }, bounds: [0, 0, 1920, 1080] } },
  props: { cig: { art: () => `<rect width="60" height="6"/>`, radius: 30, points: { tip: [-4, 1], end: [54, 0] } } },
  width: 1920, height: 1080, fps: 30, narrators: ["n"],
} as unknown as Kit;
const lines: Line[] = [{ i: 0, s: 0.3, e: 1, text: "…", speaker: "n" }, { i: 1, s: 1.6, e: 3.2, text: "hi", speaker: "kid" }];
const beats = (extra: unknown[]) => ({ blocks: [{ id: "x", set: "s", from: 0, to: 1, cast: [{ id: "kid", at: "a", facing: "left" }], props: [{ id: "c", kind: "cig", heldBy: "kid" }],
  beats: [{ line: 0, do: "sit", who: "kid", on: "ground", legs: "straight" }, { line: 0, offset: 0.4, do: "use", who: "kid", prop: "c", at: { tip: "mouth", end: 22 }, hands: false }, ...extra] }] }) as unknown as Staging;

describe("props on a 2.5D rig", () => {
  it("hangs on the lips, is taken, held at the chest while talking and put back", () => {
    const d = direct(beats([
      { line: 1, offset: -0.6, do: "take", who: "kid", prop: "c" },
      { line: 1, do: "hold", who: "kid", prop: "c", until: { line: 1, end: true } },
      { line: 1, end: true, offset: 0.3, do: "putBack", who: "kid", prop: "c" },
    ]), lines, kit);
    expect(d.issues.filter((i) => i.severity === "error")).toEqual([]);
    const script = d.scenes.x.script as { action: string; anchor?: string; channel?: string; fit?: { angle?: number; fixed?: boolean }[] }[];
    const grabs = script.filter((a) => a.action === "grab");
    // On the lips (no hand), in the hand standing up, back on the lips.
    expect(grabs.map((g) => g.anchor)).toEqual(["hand", "mouth", "hand", "hand", "mouth"]);
    expect(grabs[2].fit?.[1]).toMatchObject({ angle: -90, fixed: true });
    // The near arm is posed in 3D (no 2D reach that would cross the chest).
    expect(script.some((a) => a.action === "reach")).toBe(false);
    expect(script.filter((a) => a.action === "set" && a.channel === "bones.armF2.rotation").length).toBeGreaterThan(3);
  });
  it("cannot take what does not hang on the body, nor put back what never hung there", () => {
    const d = direct({ blocks: [{ ...beats([]).blocks[0], beats: [{ line: 1, do: "take", who: "kid", prop: "c" }, { line: 1, offset: 0.5, do: "putBack", who: "kid", prop: "c" }] }] } as unknown as Staging, lines, kit);
    const msgs = d.issues.map((i) => i.message).join("\n");
    expect(msgs).toMatch(/cannot take "c"/);
    expect(msgs).toMatch(/cannot put "c" back/);
  });
});
