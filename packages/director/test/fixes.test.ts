import { describe, expect, it } from "vitest";
import { rig3dPose, type Rig3dValues } from "@animestudio/core";
import { cartoonCharacter, cartoonInfo } from "../../kit/src";
import { check, direct, type Kit, type Line, type Staging } from "../src";
import { stick } from "../../core/test/fixtures";

// Fixes of the 2026-10-11 review (director items): one case per item.

type Act = { action: string; actor?: string; at: number; duration?: number; channel?: string; value?: unknown; anchor?: string; clip?: string; x?: number; y?: number; frame?: string[]; on?: unknown; prop?: string; zoom?: number; target?: unknown; z?: number };

const rig = { hand: { F: [80, -110], B: [80, -110] }, shoulder: { F: [0, -110], B: [0, -110] }, armLength: { F: 80, B: 80 }, backShoulder: { F: [0, 0], B: [0, 0] }, extent: { front: 60, back: 40 }, height: 160 } as const;
const holder = { ...stick, ik: [{ id: "handF", bones: ["arm1", "arm2"], mix: 0 }, { id: "handB", bones: ["arm1", "arm2"], mix: 0 }], clips: { ...stick.clips, hold: { duration: 1, loop: true, tracks: {} }, talk: { duration: 1, loop: true, tracks: {} } } } as unknown as typeof stick;
const kit: Kit = {
  characters: { a: holder, b: holder },
  cast: { a: { name: "Ana", scale: 1, rig: rig as never }, b: { name: "Bia", aliases: ["bibi"], scale: 1, rig: rig as never, speed: { walk: 200, run: 600 } } },
  sets: {
    room: { layers: [{ id: "bg", art: "<rect width='1920' height='1080' fill='#eee'/>" }], ground: { near: 900 }, marks: { door: { x: 1500 }, a: { x: 300 }, far: { x: 1500 }, window: { x: 1200, y: 400 } } },
    yard: { layers: [], ground: { near: 900, far: 700 }, depthScale: 0.6, marks: { gate: { x: 900 }, bank: { x: 1300, y: 700 } } },
  },
  props: { ball: { art: () => "<circle r='20'/>", radius: 20 } },
  width: 1920,
  height: 1080,
};
const lines: Line[] = [
  { i: 0, s: 0.2, e: 1.4, text: "Oi, Bia!", speaker: "Ana", words: [{ w: "Oi,", s: 0.2, e: 0.6 }, { w: "Bia!", s: 0.7, e: 1.4 }] },
  { i: 1, s: 1.8, e: 3.0, text: "Oi, Ana.", speaker: "Bia" },
  { i: 2, s: 3.4, e: 4.6, text: "Vamos lá fora?", speaker: "Ana" },
  { i: 3, s: 5.0, e: 6.2, text: "Vamos!", speaker: "Bia" },
];
const block = (beats: unknown[], extra: Partial<Staging["blocks"][number]> = {}): Staging => ({ blocks: [{ id: "x", set: "room", from: 0, to: 4, cast: [{ id: "a", at: "a" }, { id: "b", at: "door" }], beats: beats as never, ...extra }] });
const scriptOf = (s: Staging, k: Kit = kit) => {
  const out = direct(s, lines, k);
  return { out, script: out.scenes.x.script as Act[], errors: out.issues.filter((i) => i.severity === "error").map((i) => i.message), warnings: out.issues.filter((i) => i.severity === "warning").map((i) => i.message) };
};

describe("timeline and blocks", () => {
  it("A6: the first live block starts the episode even when an insert sorts first", () => {
    const s: Staging = {
      blocks: [
        { id: "ins", set: "room", from: 0, to: 2, insert: true, cast: [] },
        { id: "live", set: "room", from: 2, to: 4, cast: [{ id: "a" }] },
      ],
      cuts: [{ line: 0, insert: "ins", until: { line: 1, end: true } }],
    };
    const out = direct(s, lines, kit);
    const end = lines[3].e + 0.6;
    expect(out.scenes.live.duration).toBeCloseTo(end, 2);
    const live = out.sequence.shots.filter((sh) => sh.scene === "live");
    expect(live[live.length - 1].from! + live[live.length - 1].duration!).toBeCloseTo(end, 1);
    expect(check(s, lines, kit).filter((i) => /sequence/.test(i.where))).toEqual([]);
  });

  it("M17: a beat on a line that does not exist is reported, the others are staged", () => {
    const { script, errors } = scriptOf(block([{ line: 99, do: "walk", who: "a", to: "door" }, { line: 1, do: "walk", who: "b", to: "a" }]));
    expect(errors.join("\n")).toMatch(/line 99 "walk": line 99 does not exist/);
    expect(script.some((x) => x.action === "walkTo" && x.actor === "b")).toBe(true);
  });

  it("B28: a word the line does not have is reported (and timed on the line)", () => {
    const { script, warnings } = scriptOf(block([{ line: 0, word: "tchau", do: "walk", who: "b", to: "a" }]));
    expect(warnings.join("\n")).toMatch(/line 0 has no word "tchau"/);
    expect(script.find((x) => x.action === "walkTo" && x.actor === "b")!.at).toBeCloseTo(lines[0].s, 2);
  });

  it("M19: a speaker is found by id, name or alias, in direct() and check() alike", () => {
    const alias: Line[] = [{ ...lines[0] }, { ...lines[1], speaker: "bibi" }, { ...lines[2], speaker: "a" }, { ...lines[3] }];
    const out = direct(block([]), alias, kit);
    const says = (out.scenes.x.script as Act[]).filter((x) => x.action === "say").map((x) => x.actor);
    expect(says).toEqual(["a", "b", "a", "b"]);
    const missing = check({ blocks: [{ id: "x", set: "room", from: 0, to: 4, cast: [{ id: "a" }] }] }, alias, kit).map((i) => i.message).join("\n");
    expect(missing).toContain('bibi speaks but is not in block "x"');
  });

  it("B34: the rewind message says what is wrong", () => {
    const out = direct({ blocks: [{ id: "x", set: "room", from: 0, to: 4, cast: [{ id: "a" }] }], cuts: [{ line: 1, rewind: { line: 3 }, until: { line: 1, end: true } }] }, lines, kit);
    expect(out.issues.map((i) => i.message).join("\n")).toMatch(/rewind must go back to a moment before the cut \(line 3 is not before line 1\)/);
  });

  it("B35: music ending before it starts is an error, never played at full volume", () => {
    const out = direct({ ...block([]), music: [{ src: "m.mp3", from: { line: 3 }, until: { line: 1 } }] }, lines, kit);
    expect(out.music).toEqual([]);
    expect(out.issues.map((i) => i.message).join("\n")).toMatch(/ends \(until.*before it starts/);
  });
});

describe("walks, entrances and props", () => {
  it("A10: a walk that cannot fit before the block starts with it, and the grab waits for the arrival", () => {
    const { script, errors } = scriptOf(block([{ line: 0, do: "pick", who: "a", prop: "bola" }], { props: [{ id: "bola", kind: "ball", at: "far" }] }));
    expect(errors).toEqual([]);
    const walk = script.find((x) => x.action === "walkTo" && x.actor === "a")!;
    const grab = script.find((x) => x.action === "grab" && x.actor === "a")!;
    expect(walk.at).toBe(0);
    expect(walk.duration!).toBeGreaterThan(5);
    expect(grab.at).toBeGreaterThanOrEqual(walk.at + walk.duration! - 1e-6);
  });

  it("B24: exits and the pick approach go at the cast's speed", () => {
    const { script } = scriptOf(block([{ line: 1, do: "exit", who: "b", to: "right", run: true }]));
    const walk = script.find((x) => x.action === "walkTo" && x.actor === "b")!;
    expect(walk.duration).toBeCloseTo(Math.abs(walk.x! - 1500) / 600, 2);
  });

  it("B26: a walk deferred behind another one still ends at its until", () => {
    const { script } = scriptOf(block([
      { line: 0, do: "walk", who: "b", to: "a", until: { line: 1, end: true } },
      { line: 1, do: "walk", who: "b", to: "door", until: { line: 2 } },
    ]));
    const walks = script.filter((x) => x.action === "walkTo" && x.actor === "b");
    expect(walks[1].at).toBeCloseTo(lines[1].e, 2);
    expect(walks[1].at + walks[1].duration!).toBeCloseTo(lines[2].s, 2);
  });

  it("B27: a prop is dropped in front, the way they face", () => {
    const { script, out } = scriptOf(block([{ line: 1, do: "drop", who: "a", prop: "bola" }], { props: [{ id: "bola", kind: "ball", heldBy: "a" }], cast: [{ id: "a", at: "a", facing: "left" }, { id: "b", at: "door" }] }));
    const xs = (out.scenes.x.tracks as Record<string, [number, number][]>)["props.bola.x"];
    const ax = (out.scenes.x.actors as { id: string; x: number }[]).find((x) => x.id === "a")!.x;
    expect(xs[xs.length - 1][1]).toBeLessThan(ax);
    expect(script.some((x) => x.action === "release" && x.prop === "bola")).toBe(true);
  });

  it("M20: an enter beat honours end and offset; a second enter after an exit comes in again", () => {
    const { out } = scriptOf(block([{ line: 1, end: true, offset: 0.5, do: "enter", who: "b", from: "left" }], { cast: [{ id: "a", at: "a" }, { id: "b", at: "door" }] }));
    const op = (out.scenes.x.tracks as Record<string, [number, number][]>)["actors.b.opacity"];
    expect(op[op.length - 1]).toEqual([lines[1].e + 0.5, 1]);
    const again = scriptOf(block([
      { line: 0, do: "enter", who: "b", from: "left", run: true },
      { line: 1, do: "exit", who: "b", to: "left", run: true },
      { line: 3, do: "enter", who: "b", from: "right", to: "door", run: true },
    ], { cast: [{ id: "a", at: "door" }, { id: "b", at: "a" }] }));
    expect(again.errors).toEqual([]);
    const walks = again.script.filter((x) => x.action === "walkTo" && x.actor === "b");
    expect(walks.length).toBe(3);
    expect(walks[2].at).toBeCloseTo(lines[3].s, 2);
    expect(walks[2].x).toBe(1500);
    // Put beyond the right edge just before coming back in.
    const jump = again.script.find((x) => x.action === "set" && x.actor === "b" && x.channel === "x" && x.at < lines[3].s)!;
    expect(jump.value as number).toBeGreaterThan(1920);
  });

  it("B30: entering from the top without wings drops in from above the frame", () => {
    const { script, errors } = scriptOf(block([], { cast: [{ id: "a", at: "a" }, { id: "b", at: "door", enter: { line: 1, from: "top" } }] }));
    expect(errors).toEqual([]);
    const ys = script.filter((x) => x.action === "set" && x.actor === "b" && x.channel === "y");
    expect(ys[0].value as number).toBeLessThan(0);
    expect(ys[ys.length - 1]).toMatchObject({ value: 900 });
    expect(ys[ys.length - 1].at).toBeCloseTo(lines[1].s, 2);
    const x = (script.find((x) => x.action === "walkTo" && x.actor === "b"));
    expect(x).toBeUndefined();
  });

  it("M21: a graphic with until and no exit is gone at until", () => {
    const { out } = scriptOf(block([], { graphics: [{ id: "g", art: "<circle r='10'/>", at: [100, 100], until: { line: 1 } }] }));
    const op = (out.scenes.x.tracks as Record<string, [number, number][]>)["props.g.opacity"];
    expect(op[op.length - 1]).toEqual([lines[1].s + 0.001, 0]);
  });

  it("B25/B33: a mark's y is honoured by fx, furniture and rolls given as { mark, dx }", () => {
    const chair = { format: "toon", version: 1, name: "chair", skeleton: [{ id: "root" }], parts: [{ id: "c", type: "rigid", bone: "root", art: "<rect x='-20' y='-50' width='40' height='50'/>" }], anchors: { seat: { bone: "root", at: [0, -50] } } };
    const k: Kit = { ...kit, characters: { ...kit.characters, chair: chair as never }, furniture: { chair: { character: "chair", scale: 1 } } };
    const { script, out } = scriptOf({ blocks: [{ id: "x", set: "yard", from: 0, to: 4, cast: [{ id: "a", at: "gate" }], furniture: [{ id: "c1", kind: "chair", at: { mark: "bank", dx: 100 } }], props: [{ id: "bola", kind: "ball", at: "gate" }], beats: [
      { line: 0, do: "fx", type: "sparkle", at: "bank" },
      { line: 1, do: "roll", prop: "bola", to: { mark: "bank", dx: -50 }, until: { line: 2 } },
    ] }] }, k);
    expect(script.find((x) => x.action === "fx")).toMatchObject({ x: 1300, y: 700 });
    expect((out.scenes.x.actors as { id: string; y: number; x: number }[]).find((x) => x.id === "c1")).toMatchObject({ x: 1400, y: 700 });
    expect((out.scenes.x.props as { id: string; z: number }[]).find((p) => p.id === "bola")!.z).toBe(0.5);
  });

  it("B31: a drive-by on the far lane rides the far ground; a farLane mark without y is never NaN", () => {
    const car = { format: "toon", version: 1, name: "car", skeleton: [{ id: "root" }, { id: "body", parent: "root", from: [0, -20], to: [40, -20] }], parts: [{ id: "b", type: "rigid", bone: "body", art: "<rect width='80' height='40'/>" }], clips: { drive: { duration: 1, loop: true, stride: 200, tracks: { "bones.body.y": [[0, 0], [1, 0]] } } } };
    const k: Kit = { ...kit, characters: { ...kit.characters, car: car as never }, vehicles: { car: { character: "car", scale: 1 } } };
    const far = direct({ blocks: [{ id: "x", set: "yard", from: 0, to: 4, cast: [{ id: "a", at: "gate" }], beats: [{ line: 1, do: "vehicle", kind: "car", lane: "far" }] }] }, lines, k);
    const v = (far.scenes.x.actors as { id: string; y: number }[]).find((x) => x.id === "car1")!;
    expect(Math.abs(v.y - (700 - 16 * 0.6))).toBeLessThan(1);
    const k2: Kit = { ...k, sets: { ...k.sets, yard: { ...k.sets.yard, marks: { ...k.sets.yard.marks, farLane: { x: 0 } } } } };
    const noY = direct({ blocks: [{ id: "x", set: "yard", from: 0, to: 4, cast: [{ id: "a", at: "gate" }], beats: [{ line: 1, do: "vehicle", kind: "car", lane: "far" }] }] }, lines, k2);
    expect(Number.isFinite((noY.scenes.x.actors as { id: string; y: number }[]).find((x) => x.id === "car1")!.y)).toBe(true);
  });
});

describe("hands, seats and falls", () => {
  it("M13: the hand-in-hand clip and its busy window end at release", () => {
    const { script } = scriptOf(block([{ line: 0, do: "hold", who: ["a", "b"] }, { line: 1, do: "release", who: ["a", "b"] }]));
    const holds = script.filter((x) => x.action === "play" && x.clip === "hold");
    expect(holds.length).toBe(2);
    for (const h of holds) expect(h.at + h.duration!).toBeCloseTo(lines[1].s, 1);
    // Free again, Ana gestures while speaking line 2.
    expect(script.some((x) => x.action === "play" && x.clip === "talk" && x.actor === "a" && Math.abs(x.at - (lines[2].s - 0.15)) < 0.01)).toBe(true);
  });

  it("B32: releasing one of a pair frees the partner's hand too", () => {
    const { script } = scriptOf(block([{ line: 0, do: "hold", who: ["a", "b"] }, { line: 2, do: "release", who: "a" }]));
    const t = lines[2].s;
    expect(script.some((x) => x.action === "set" && x.actor === "b" && x.channel === "ik.handB.mix" && x.value === 0 && Math.abs(x.at - t) < 0.01)).toBe(true);
    expect(script.some((x) => x.action === "set" && x.actor === "a" && x.channel === "ik.handF.mix" && x.value === 0 && Math.abs(x.at - t) < 0.01)).toBe(true);
  });

  it("M12: hitting someone seated gets them off the seat first", () => {
    const chair = { format: "toon", version: 1, name: "chair", skeleton: [{ id: "root" }], parts: [{ id: "c", type: "rigid", bone: "root", art: "<rect x='-20' y='-50' width='40' height='50'/>" }], anchors: { seat: { bone: "root", at: [0, -50] } } };
    const fighter = { ...holder, clips: { ...holder.clips, punch: { duration: 0.9, tracks: {} } } } as unknown as typeof stick;
    const k: Kit = { ...kit, characters: { a: fighter, b: fighter, chair: chair as never }, furniture: { chair: { character: "chair", scale: 1 } }, sets: { ...kit.sets, room: { ...kit.sets.room, bounds: [0, 0, 1920, 1080] } } };
    const { script, errors, warnings } = scriptOf(block([
      { line: 0, do: "sit", who: "b", on: "c1" },
      { line: 2, do: "hit", who: "a", target: "b" },
      { line: 3, do: "getUp", who: "b" },
    ], { furniture: [{ id: "c1", kind: "chair", at: "door" }] }), k);
    expect(errors).toEqual([]);
    expect(warnings.join("\n")).not.toMatch(/not sitting or lying to get up/);
    const mounts = script.filter((x) => x.action === "mount" && x.actor === "b");
    expect(mounts.map((m) => m.on)).toEqual(["c1", null]);
    const hitT = script.find((x) => x.action === "fx" && (x as { type?: string }).type === "impactFrame")!.at;
    expect(mounts[1].at).toBeLessThanOrEqual(hitT + 1e-6);
    // Back on the feet at line 3: the rotation of the fall undone.
    expect(script.some((x) => x.action === "set" && x.actor === "b" && x.channel === "rotation" && x.value === 0 && Math.abs(x.at - lines[3].s) < 0.01)).toBe(true);
  });

  it("M16: a rest begun just before another is still closed (sit, then lie a second later, then get up)", () => {
    const { script, errors, warnings } = scriptOf(block([
      { line: 0, do: "sit", who: "a" },
      { line: 0, offset: 1, do: "lie", who: "a" },
      { line: 3, do: "getUp", who: "a" },
    ]));
    expect(errors).toEqual([]);
    expect(warnings.join("\n")).not.toMatch(/not sitting or lying/);
    const up = script.filter((x) => x.action === "set" && x.actor === "a" && x.channel === "rotation" && x.value === 0 && Math.abs(x.at - lines[3].s) < 0.01);
    expect(up.length).toBe(1);
  });

  it("M15: falling, riding or mounting while carried never throws", () => {
    const bike = { format: "toon", version: 1, name: "bike", skeleton: [{ id: "root" }, { id: "frame", parent: "root", from: [0, -20], to: [40, -20] }], parts: [{ id: "frame", type: "rigid", bone: "frame", art: "<rect x='-40' y='-50' width='80' height='40'/>" }], anchors: { seat: { bone: "frame", at: [-10, -60] } }, clips: { drive: { duration: 1, loop: true, stride: 200, tracks: { "bones.frame.y": [[0, 0], [1, 0]] } } } };
    const k: Kit = { ...kit, characters: { ...kit.characters, bike: bike as never }, vehicles: { bike: { character: "bike", scale: 1 } } };
    const fell = scriptOf(block([{ line: 0, do: "carry", who: "a", target: "b" }, { line: 2, do: "fall", who: "b" }]), k);
    expect(fell.errors).toEqual([]);
    expect(fell.script.filter((x) => x.action === "mount" && x.actor === "b").map((m) => m.on)).toEqual(["a", null]);
    expect(fell.script.some((x) => x.action === "set" && x.actor === "b" && x.channel === "rotation" && Math.abs(x.at - lines[2].s) < 0.01)).toBe(true);
    const rode = scriptOf(block([{ line: 0, do: "carry", who: "a", target: "b" }, { line: 2, do: "ride", who: "b", vehicle: "bike1", to: "a" }, { line: 3, do: "mount", who: "b", vehicle: "bike1" }], { vehicles: [{ id: "bike1", kind: "bike", at: "door" }] }), k);
    expect(rode.errors.join("\n")).toMatch(/b cannot ride: carried by a/);
    expect(rode.errors.join("\n")).toMatch(/b cannot mount "bike1": carried by a/);
    expect(rode.errors.join("\n")).not.toMatch(/Cannot read properties/);
  });

  it("M14: a peek from a crouch straightens the back and ducks into the same lean; never after the hide ends", () => {
    const table = { format: "toon", version: 1, name: "t", skeleton: [{ id: "root" }], parts: [{ id: "t", type: "rigid", bone: "root", art: "<rect x='-150' y='-90' width='300' height='90'/>" }] };
    const k: Kit = { ...kit, characters: { ...kit.characters, t: table as never }, sets: { ...kit.sets, room: { ...kit.sets.room, fixtures: [{ id: "tbl", character: "t", mark: "door", z: 5 }] } } };
    const { script, errors } = scriptOf(block([{ line: 0, do: "hide", who: "b", behind: "tbl", until: { line: 3 } }, { line: 1, do: "peek", who: "b" }, { line: 2, do: "peek", who: "b", until: { line: 3, offset: 0.5 } }]), k);
    expect(errors).toEqual([]);
    const lean = script.filter((x) => x.action === "set" && x.actor === "b" && x.channel === "bones.body.rotation").map((x) => [x.at, x.value as number]);
    const hidden = lean[0][1];
    expect(hidden).toBeGreaterThan(0);
    // Up at the first peek, back into the lean 1.2 s later.
    expect(lean.some(([t, v]) => v === 0 && Math.abs(t - lines[1].s) < 0.01)).toBe(true);
    expect(lean.some(([t, v]) => v === hidden && Math.abs(t - (lines[1].s + 1.2)) < 0.01)).toBe(true);
    // The second peek outlasts the hide: no crouching back after it.
    const hips = script.filter((x) => x.action === "set" && x.actor === "b" && x.channel === "bones.hips.y" && x.at > lines[2].s + 0.01);
    expect(hips.every((x) => x.value === 0)).toBe(true);
  });
});

describe("camera", () => {
  it("A7: the camera follows a prop, framed with the cast", () => {
    const { script, errors } = scriptOf(block([{ line: 1, do: "camera", type: "follow", who: "bola" }, { line: 2, do: "camera", type: "close", who: "bola" }], { props: [{ id: "bola", kind: "ball", at: "far" }] }));
    expect(errors).toEqual([]);
    const cams = script.filter((x) => x.action === "camera" && x.at >= lines[1].s - 0.01);
    expect(cams[0].frame).toEqual(["bola", "a", "b"]);
    expect(cams[1].frame).toEqual(["bola"]);
    expect(cams[1].on).toBeUndefined();
  });

  it("M18: a crossing goes to the beat's mark, the camera along (heights from the frame)", () => {
    const { script, errors } = scriptOf({ blocks: [{ id: "x", set: "yard", from: 0, to: 4, cast: [{ id: "a", at: "gate" }], beats: [{ line: 1, do: "cross", who: "a", to: "bank", until: { line: 3 } }] }] });
    expect(errors).toEqual([]);
    const cams = script.filter((x) => x.action === "camera" && x.at >= lines[1].s - 0.01);
    expect(cams[0]).toMatchObject({ x: 1300, y: Math.round(1080 * 0.593) });
    expect(script.find((x) => x.action === "walkTo" && x.actor === "a")!.x).toBe(1300);
  });

  it("B36: shots with a mark and nobody present stay on the mark; a push-in glides there", () => {
    const { script, errors } = scriptOf({ blocks: [{ id: "x", set: "room", from: 0, to: 4, cast: [], beats: [
      { line: 1, do: "camera", type: "medium", mark: "window" },
      { line: 2, do: "camera", type: "push-in", mark: "door", to: "close", until: { line: 3 } },
      { line: 3, do: "camera", type: "reveal", mark: "door" },
    ] }] });
    expect(errors).toEqual([]);
    const cams = script.filter((x) => x.action === "camera" && x.at >= lines[1].s - 0.01);
    expect(cams[0]).toMatchObject({ x: 1200, zoom: 1.6 });
    expect(cams[0].y).toBeLessThan(400);
    expect(cams[1]).toMatchObject({ x: 1500, zoom: 2.2, duration: lines[3].s - lines[2].s });
    expect(cams[2]).toMatchObject({ x: 1500, y: Math.round(1080 * 0.48) });
  });
});

describe("2.5D rigs", () => {
  const look = { name: "kid", build: "kid", skin: "#f6d3b5", hair: "bowl", hairColor: "#5a3a22", top: "tee", topColor: "#2d8f4e", bottom: "shorts", bottomColor: "#3a62b0", shoes: "sneakers" } as const;
  const doc = cartoonCharacter(look as never);
  const k3 = {
    characters: { kid: doc }, cast: { kid: { name: "kid", scale: 1, rig: cartoonInfo(doc, look as never) } },
    sets: { s: { layers: () => [], ground: { near: 900 }, marks: { a: { x: 960 } }, bounds: [0, 0, 1920, 1080] } },
    props: { cig: { art: () => `<rect width="60" height="6"/>`, radius: 30, points: { tip: [-4, 1], end: [54, 0], grip: [20, 0] } } },
    width: 1920, height: 1080, fps: 30, narrators: ["n"],
  } as unknown as Kit;
  const ls: Line[] = [{ i: 0, s: 0.3, e: 1, text: "…", speaker: "n" }, { i: 1, s: 1.6, e: 3.2, text: "…", speaker: "n" }, { i: 2, s: 4, e: 6, text: "…", speaker: "n" }];

  it("A9: a use ending after a turn round grabs back into the hand holding the prop then", () => {
    const d = direct({ blocks: [{ id: "x", set: "s", from: 0, to: 3, cast: [{ id: "kid", at: "a" }], props: [{ id: "c", kind: "cig", heldBy: "kid" }], beats: [
      { line: 0, do: "use", who: "kid", prop: "c", at: { tip: "mouth", end: 22 }, until: { line: 2 } },
      { line: 1, do: "face", who: "kid", direction: "left" },
    ] }] } as unknown as Staging, ls, k3);
    expect(d.issues.filter((i) => i.severity === "error")).toEqual([]);
    const grabs = (d.scenes.x.script as Act[]).filter((a) => a.action === "grab");
    expect(grabs.map((g) => g.anchor)).toEqual(["hand", "hand", "handB", "handB"]);
    expect(grabs[3].at).toBeCloseTo(ls[2].s, 2);
  });

  it("M5: sitting on the floor opens both knees away from the body's middle", () => {
    for (const legs of ["straight", "hug"]) {
      const d = direct({ blocks: [{ id: "x", set: "s", from: 0, to: 3, cast: [{ id: "kid", at: "a" }], beats: [{ line: 0, do: "sit", who: "kid", on: "ground", legs }] }] } as unknown as Staging, ls, k3);
      expect(d.issues.filter((i) => i.severity === "error")).toEqual([]);
      const values: Rig3dValues = {};
      for (const a of (d.scenes.x.script as Act[]).filter((x) => x.action === "set" && x.actor === "kid" && /^bones\.leg[FB][12]\.(rotation|turn|spread)$/.test(x.channel ?? ""))) {
        const [, bone, ch] = /^bones\.(\w+)\.(\w+)$/.exec(a.channel!)!;
        (values[bone] ??= {})[ch as "rotation"] = a.value as number;
      }
      const opened = rig3dPose(doc as never, values);
      const closed = rig3dPose(doc as never, Object.fromEntries(Object.entries(values).map(([b, v]) => [b, { rotation: v.rotation }])));
      for (const side of ["F", "B"]) {
        const hip = Math.sign(opened[`leg${side}1`].from[0]);
        expect((opened[`leg${side}1`].to[0] - closed[`leg${side}1`].to[0]) * hip).toBeGreaterThan(1);
      }
    }
  });
});
