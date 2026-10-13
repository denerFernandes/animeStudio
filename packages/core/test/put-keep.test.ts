import { describe, expect, it } from "vitest";
import { type SceneDoc, type ToonDoc, compileScene, propPlacement } from "../src";

// Objects move only while something moves them: a prop let go with `keep` stays where the hand left it
// (put down on a table) instead of going back to its tracks, and a prop `put` on another (things on a
// tray) is carried with it, keeping its place on it.

const arm: ToonDoc = {
  format: "toon", version: 1, name: "arm",
  skeleton: [{ id: "root" }, { id: "hand", parent: "root", from: [0, 0], to: [10, 0] }],
  parts: [{ id: "p", type: "rigid", bone: "hand", art: "<rect width='10' height='10'/>" }],
  anchors: { hand: { bone: "hand", at: [10, 0] } },
} as unknown as ToonDoc;

function scene(script: unknown[], tracks: Record<string, unknown[]> = {}): SceneDoc {
  return {
    format: "toon-scene", version: 1, width: 400, height: 400, fps: 24, duration: 4, background: "#fff",
    characters: { arm: "x" },
    actors: [{ id: "a", character: "arm", x: 100, y: 100 }],
    props: [
      { id: "box", art: "<rect/>", x: 300, y: 300 },
      { id: "tray", art: "<rect/>", x: 50, y: 200 },
      { id: "eye", art: "<circle/>", x: 60, y: 190 },
    ],
    tracks,
    script,
  } as unknown as SceneDoc;
}
const at = (sc: SceneDoc, id: string, t: number) => {
  const c = compileScene(sc, { characters: { arm } });
  const p = propPlacement(c, c.props.find((x) => x.id === id)!, t);
  return [Math.round(p.x), Math.round(p.y), Math.round(p.rotation)];
};

describe("put down and carried on", () => {
  // The hand moves from x 100 to 200 over a second, holding the box from 0.5 to 1.0.
  const move = { "actors.a.x": [[0, 100], [1, 200, "linear"]] };
  const holding = (keep: boolean) => scene([
    { at: 0.5, actor: "a", action: "grab", prop: "box", anchor: "hand" },
    { at: 1.0, actor: "a", action: "release", prop: "box", ...(keep ? { keep: true } : {}) },
  ], move);

  it("released with keep, it stays where the hand left it", () => {
    const left = at(holding(true), "box", 0.9999);
    expect(at(holding(true), "box", 2)).toEqual(left);
    expect(left[0]).toBeGreaterThan(190);
  });

  it("released without keep, it goes back to its tracks (as before)", () => {
    expect(at(holding(false), "box", 2)).toEqual([300, 300, 0]);
  });

  it("put on a tray, it is carried with the tray and keeps its place on it", () => {
    const sc = scene([{ at: 0.2, action: "put", prop: "eye", on: "tray" }], {
      "props.tray.x": [[0, 50], [1, 150, "linear"]],
      "props.tray.rotation": [[0, 0], [1, 90, "linear"]],
    });
    // Before it is put there: its own tracks.
    expect(at(sc, "eye", 0.1)).toEqual([60, 190, 0]);
    // After: at the tray's place plus its offset turned with the tray (offset measured at 0.2).
    const [tx, ty] = [150, 200];
    const e = at(sc, "eye", 1);
    const tray0x = 50 + 100 * 0.2, rot0 = 18, rot = 90;
    const dx = 60 - tray0x, dy = -10;
    const a0 = (-rot0 * Math.PI) / 180, a = (rot * Math.PI) / 180;
    const lx = dx * Math.cos(a0) - dy * Math.sin(a0), ly = dx * Math.sin(a0) + dy * Math.cos(a0);
    expect(e[0]).toBeCloseTo(Math.round(tx + lx * Math.cos(a) - ly * Math.sin(a)), -1);
    expect(e[1]).toBeCloseTo(Math.round(ty + lx * Math.sin(a) + ly * Math.cos(a)), -1);
    expect(e[2]).toBe(72);
  });

  it("taken off again with `on: null`: it stays where the tray had brought it", () => {
    const sc = scene([{ at: 0, action: "put", prop: "eye", on: "tray" }, { at: 0.5, action: "put", prop: "eye", on: null }], { "props.tray.x": [[0, 50], [1, 150, "linear"]] });
    expect(at(sc, "eye", 1)).toEqual([110, 190, 0]);
  });

  it("rejects an unknown carrier", () => {
    expect(() => compileScene(scene([{ at: 0, action: "put", prop: "eye", on: "nope" }]), { characters: { arm } })).toThrow(/unknown prop "nope"/);
  });
});
