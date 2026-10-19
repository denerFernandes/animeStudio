import { describe, expect, it } from "vitest";
import { direct, type Kit, type Line } from "../src";
import { stick } from "../../core/test/fixtures";

// The limbs of a body knocked down: the rig's `knocked` clip played once over the whole flight (not
// looped and faded out before the landing), then its lying clip `down` from the landing until the
// body gets up.

const rig = { hand: { F: [80, -110], B: [80, -110] }, shoulder: { F: [0, -110], B: [0, -110] }, armLength: { F: 80, B: 80 }, backShoulder: { F: [0, 0], B: [0, 0] }, extent: { front: 60, back: 40 }, height: 160 } as const;
const fighter = {
  ...stick,
  controls: { ...stick.controls, emotion: { type: "pose", poses: { scared: {}, dead: {} } } },
  clips: { ...stick.clips, punch: { duration: 0.9, tracks: {} }, knocked: { duration: 0.85, tracks: {} }, down: { duration: 3, tracks: {} } },
} as unknown as typeof stick;
const kit: Kit = {
  characters: { a: fighter, b: fighter },
  cast: { a: { name: "Ana", scale: 1, rig: rig as never }, b: { name: "Bia", scale: 1, rig: rig as never } },
  sets: { room: { layers: [], ground: { near: 900 }, bounds: [0, 0, 1920, 1080], marks: { door: { x: 1000 } } } },
  props: {},
  width: 1920,
  height: 1080,
};
const lines: Line[] = [
  { i: 0, s: 0.2, e: 1.4, text: "Um.", speaker: "Ana" },
  { i: 1, s: 1.8, e: 3.0, text: "Dois.", speaker: "Bia" },
  { i: 2, s: 3.4, e: 4.6, text: "Três.", speaker: "Ana" },
  { i: 3, s: 5.0, e: 6.2, text: "Quatro.", speaker: "Bia" },
];
type Act = { action: string; actor?: string; at: number; clip?: string; duration?: number; loop?: boolean; speed?: number };

describe("knock-downs", () => {
  it("a hit plays `knocked` over the whole flight and `down` from the landing until getting up", () => {
    const out = direct({ blocks: [{ id: "x", set: "room", from: 0, to: 4, cast: [{ id: "a", at: "door", offset: -6 }, { id: "b", at: "door" }], beats: [{ line: 1, do: "hit", who: "a", target: "b" }, { line: 3, do: "getUp", who: "b" }] }] }, lines, kit);
    expect(out.issues.filter((i) => i.severity === "error")).toEqual([]);
    const script = out.scenes.x.script as Act[];
    const knocked = script.find((x) => x.action === "play" && x.actor === "b" && x.clip === "knocked")!;
    const down = script.find((x) => x.action === "play" && x.actor === "b" && x.clip === "down")!;
    expect(knocked.loop).toBe(false);
    expect(knocked.speed).toBe(1);
    expect(knocked.duration).toBeGreaterThanOrEqual(0.85);
    // The landing: 0.85 s after the hit.
    expect(down.at).toBeCloseTo(knocked.at + 0.85, 3);
    // Held until getting up (line 3), then let go.
    const up = script.find((x) => x.action === "set" && x.actor === "b" && (x as { channel?: string }).channel === "rotation" && (x as { value?: unknown }).value === 0)!;
    expect(down.at + down.duration!).toBeCloseTo(up.at + 0.3, 3);
  });

  it("a trip plays them over its shorter fall", () => {
    const out = direct({ blocks: [{ id: "x", set: "room", from: 0, to: 4, cast: [{ id: "a" }, { id: "b" }], beats: [{ line: 1, do: "fall", who: "a" }] }] }, lines, kit);
    const script = out.scenes.x.script as Act[];
    const knocked = script.find((x) => x.action === "play" && x.actor === "a" && x.clip === "knocked")!;
    expect(knocked.speed).toBeCloseTo(0.85 / 0.4, 3);
    const down = script.find((x) => x.action === "play" && x.actor === "a" && x.clip === "down")!;
    expect(down.at).toBeCloseTo(knocked.at + 0.4, 3);
  });
});
