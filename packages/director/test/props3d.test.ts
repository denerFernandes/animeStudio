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

describe("props in the air", () => {
  const k2 = { ...kit, props: { ...kit.props, saucer: { art: () => `<ellipse rx="60" ry="14"/>`, radius: 20, points: { hang: [0, -14] } }, phone: { art: () => `<rect width="20" height="80"/>`, radius: 40, points: { grip: [0, 0], cord: [0, 40] }, cord: { coils: 12, length: 400 } } } } as unknown as Kit;
  it("a saucer flies in on a string, the string snaps, it drops on a head; a phone has a coiled cord", () => {
    const s = { blocks: [{ id: "x", set: "s", from: 0, to: 1, cast: [{ id: "kid", at: "a" }],
      props: [{ id: "u", kind: "saucer" }, { id: "p", kind: "phone", cord: { from: [1500, 500] } }],
      beats: [
        { line: 0, do: "fly", prop: "u", path: [[960, 380]], until: { line: 1 }, bob: 8, hang: true },
        { line: 1, do: "snap", prop: "u" }, { line: 1, do: "dropOn", prop: "u", who: "kid" },
        { line: 1, do: "camera", type: "push-in", who: "kid", until: { line: 1, end: true } },
        { line: 1, offset: 0.5, do: "camera", type: "shake", amount: 6 },
        { line: 1, offset: 0.2, do: "fx", type: "sparkle", prop: "u" },
      ] }] } as unknown as Staging;
    const d = direct(s, lines, k2);
    expect(d.issues.filter((i) => i.severity === "error")).toEqual([]);
    const props = d.scenes.x.props as { id: string; cord?: { to: unknown; cut?: number; coils?: number } }[];
    expect(props.find((p) => p.id === "u")!.cord).toMatchObject({ to: "up" });
    expect(props.find((p) => p.id === "u")!.cord!.cut).toBeGreaterThan(0);
    expect(props.find((p) => p.id === "p")!.cord).toMatchObject({ to: [1500, 500], coils: 12 });
    const script = d.scenes.x.script as { action: string; anchor?: string; blend?: number; prop?: string }[];
    expect(script.some((a) => a.action === "grab" && a.anchor === "top")).toBe(true);
    expect(script.filter((a) => a.action === "shake").length).toBeGreaterThanOrEqual(2);
    expect(script.some((a) => a.action === "camera" && (a.blend ?? 0) > 1)).toBe(true);
    expect(script.some((a) => a.action === "fx" && a.prop === "u")).toBe(true);
  });
});

describe("graphics, rewinds and inserts", () => {
  const kg = { ...kit, graphics: { star: () => `<path d="M0 -20 L5 0 L0 20 L-5 0 Z"/>` } } as unknown as Kit;
  const ls: Line[] = [{ i: 0, s: 0.2, e: 1.5, text: "a", speaker: "n" }, { i: 1, s: 1.6, e: 3.4, text: "b", speaker: "n" }, { i: 2, s: 3.5, e: 6, text: "c", speaker: "n" }];
  it("graphics pop in, idle, and go; the tape rewinds; an insert is cut in, in step", () => {
    const s = {
      blocks: [
        { id: "x", set: "s", from: 0, to: 3, cast: [{ id: "kid", at: "a" }], graphics: [{ id: "g", art: "star", at: [300, 200], enter: "pop", idle: "wobble", exit: "pop", until: { line: 1, end: true } }] },
        { id: "ins", set: "s", from: 0, to: 3, insert: true, cast: [], graphics: [{ id: "logo", art: "<circle r='40'/>", at: [960, 540], enter: "stamp" }] },
      ],
      cuts: [{ line: 1, insert: "ins", until: { line: 1, offset: 1 } }, { line: 2, rewind: { line: 0 }, until: { line: 2, offset: 1.2 } }],
    } as unknown as Staging;
    const d = direct(s, ls, kg);
    expect(d.issues.filter((i) => i.severity === "error")).toEqual([]);
    const props = d.scenes.x.props as { id: string; parallax?: number; z?: number }[];
    expect(props.find((p) => p.id === "g")).toMatchObject({ parallax: 0 });
    const tracks = d.scenes.x.tracks as Record<string, [number, number, string?][]>;
    expect(tracks["props.g.scale"].some((k) => k[1] > 1)).toBe(true); // the overshoot
    expect(tracks["props.g.rotation"].length).toBeGreaterThan(3); // the wobble
    const shots = d.sequence.shots as { scene: string; speed?: number; overlay?: string; from?: number }[];
    expect(shots.some((x) => x.scene === "ins")).toBe(true);
    expect(shots.some((x) => (x.speed ?? 1) < 0 && x.overlay === "vhs")).toBe(true);
  });
});

describe("strict pictures", () => {
  it("refuses walking backwards and queues a walk given while walking; enters from beyond the set", () => {
    const ls: Line[] = [{ i: 0, s: 0.2, e: 1.5, text: "a", speaker: "n" }, { i: 1, s: 1.6, e: 6, text: "b", speaker: "n" }];
    const k3 = { ...kit, sets: { s: { ...(kit.sets as Record<string, unknown>).s as object, bounds: [-400, 0, 2320, 1080] } } } as unknown as Kit;
    const d = direct({ blocks: [{ id: "x", set: "s", from: 0, to: 2, cast: [{ id: "kid", at: "a", enter: { line: 0, from: "left" } }],
      beats: [{ line: 1, do: "walk", who: "kid", to: { mark: "a", dx: 500 } }, { line: 1, offset: 0.3, do: "face", who: "kid", direction: "left" }, { line: 1, offset: 0.5, do: "walk", who: "kid", to: { mark: "a", dx: 800 } }] }] } as unknown as Staging, ls, k3);
    const msgs = d.issues.map((i) => i.message).join("\n");
    expect(msgs).toMatch(/walking backwards/);
    expect(msgs).toMatch(/while still walking/);
    const walks = (d.scenes.x.script as { action: string; x?: number }[]).filter((a) => a.action === "walkTo");
    expect(walks[0].x).toBeGreaterThan(0);
    const firstX = (d.scenes.x.actors as { id: string; x: number }[]).find((a) => a.id === "kid")!.x;
    expect(firstX).toBeLessThan(-400);
  });
});

describe("cuts", () => {
  it("an insert at a block's first line starts with it, comes back with a straight cut; blocks cut straight", () => {
    const ls: Line[] = [{ i: 0, s: 0.2, e: 2, text: "a", speaker: "n" }, { i: 1, s: 2.1, e: 4, text: "b", speaker: "n" }, { i: 2, s: 4.1, e: 6, text: "c", speaker: "n" }];
    const s = { blocks: [
      { id: "x", set: "s", from: 0, to: 1, cast: [{ id: "kid", at: "a" }] },
      { id: "y", set: "s", from: 1, to: 3, cast: [{ id: "kid", at: "a" }] },
      { id: "ins", set: "s", from: 0, to: 3, insert: true, cast: [] },
    ], cuts: [{ line: 1, insert: "ins", until: { line: 1, end: true }, transition: "flash" }] } as unknown as Staging;
    const d = direct(s, ls, kit);
    const shots = d.sequence.shots as { scene: string; duration: number; from?: number; transition?: { type: string } }[];
    expect(shots.every((x) => x.duration >= 0.4)).toBe(true);
    const i = shots.findIndex((x) => x.scene === "ins");
    expect(shots[i].transition?.type).toBe("flash");
    expect(shots[i + 1].transition).toBeUndefined();
    expect(shots.filter((x) => x.transition?.type === "fade")).toEqual([]);
  });
});
