import { describe, expect, it } from "vitest";
import { compileScene, drawingTime } from "@animestudio/core";
import { check, direct, type Kit, type Line, type Staging } from "../src";
import { stick } from "../../core/test/fixtures";

// Cartoon timing: the staging's `animation` reaches every scene; a cast member, a vehicle or a
// fixture may keep its own; the motion checks compare drawings, not frames.

const rig = { hand: { F: [80, -110], B: [80, -110] }, shoulder: { F: [0, -110], B: [0, -110] }, armLength: { F: 80, B: 80 }, backShoulder: { F: [0, 0], B: [0, 0] }, extent: { front: 60, back: 40 }, height: 160 } as const;
const clock = { format: "toon", version: 1, name: "clock", skeleton: [{ id: "root" }, { id: "hand", parent: "root", from: [0, 0], to: [0, -20] }], parts: [{ id: "h", type: "rigid", bone: "hand", art: "<path d='M0 0V-20'/>" }], clips: { loop: { duration: 60, loop: true, tracks: { "bones.hand.rotation": [[0, 0, "linear"], [60, 360]] } } } };
const kit: Kit = {
  characters: { a: stick, b: stick, clock: clock as never },
  cast: { a: { name: "Ana", scale: 1, rig: rig as never }, b: { name: "Bia", scale: 1, rig: rig as never } },
  sets: { room: { layers: [{ id: "bg", art: "<rect width='1920' height='1080' fill='#eee'/>" }], ground: { near: 900 }, marks: { door: { x: 1500 } }, fixtures: [{ id: "tower", character: "clock", mark: "door", twos: false }] } },
  props: {},
  width: 1920, height: 1080, fps: 24,
};
const lines: Line[] = [
  { i: 0, s: 0.2, e: 1.4, text: "Oi", speaker: "Ana" },
  { i: 1, s: 1.8, e: 3.0, text: "Oi", speaker: "Bia" },
  { i: 2, s: 3.4, e: 4.6, text: "Vamos", speaker: "Ana" },
];
const staging: Staging = {
  animation: { twos: true, holds: 0.5 },
  blocks: [{ id: "x", set: "room", from: 0, to: 3, cast: [{ id: "a" }, { id: "b", twos: false }], beats: [{ line: 0, do: "walk", who: "a", to: "door", until: { line: 2 } }] }],
};

describe("cartoon timing in the director", () => {
  it("passes the staging's animation to the scenes, with per-actor overrides", () => {
    const out = direct(staging, lines, kit);
    const doc = out.scenes.x as { animation?: unknown; actors: { id: string; twos?: unknown }[] };
    expect(doc.animation).toEqual({ twos: true, holds: 0.5 });
    expect(doc.actors.find((a) => a.id === "b")?.twos).toBe(false);
    expect(doc.actors.find((a) => a.id === "tower")?.twos).toBe(false);
    expect(doc.actors.find((a) => a.id === "a")?.twos).toBeUndefined();
    const sc = compileScene(out.scenes.x, { characters: kit.characters });
    const a = sc.actors.find((x) => x.id === "a")!, b = sc.actors.find((x) => x.id === "b")!;
    expect(drawingTime(sc, a, 1 / 24)).toBeCloseTo(0, 6);
    expect(drawingTime(sc, b, 1 / 24)).toBeCloseTo(1 / 24, 6);
  });
  it("a walk on twos passes the motion checks (drawings compared, not frames)", () => {
    const strict = check(staging, lines, kit, { strict: true }).filter((i) => /walks backwards|going round|jumps/.test(i.message));
    expect(strict).toEqual([]);
  });
});
