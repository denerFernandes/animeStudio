import { describe, expect, it } from "vitest";
import { apply, actorPlacement, compileScene } from "@animestudio/core";
import { cartoonCharacter, cartoonInfo } from "../../kit/src";
import { check, direct, type Kit, type Line, type Staging } from "../src";
import { stick } from "../../core/test/fixtures";

// Anticipation and settle (`animation.anticipation`): walks lean back before setting off, into the
// move and past upright on arrival; landings squash and settle about the feet; free limb moves
// overshoot and settle. Off (the default), the director's output does not change.

const rig = { hand: { F: [80, -110], B: [80, -110] }, shoulder: { F: [0, -110], B: [0, -110] }, armLength: { F: 80, B: 80 }, backShoulder: { F: [0, 0], B: [0, 0] }, extent: { front: 60, back: 40 }, height: 160 } as const;
// The stick that can run, one that can fly, one with the kit's arm bone names (sets on `bones.armF1.*`).
const runner = { ...stick, clips: { ...stick.clips, run: stick.clips!.walk } } as typeof stick;
const bird = { ...runner, meta: { canFly: true } } as unknown as typeof stick;
const armer = JSON.parse(JSON.stringify(runner).replace(/\barm1\b/g, "armF1").replace(/\barm2\b/g, "armF2")) as typeof stick;
const kit: Kit = {
  characters: { a: runner, b: bird, c: armer },
  cast: {
    a: { name: "Ana", scale: 1, rig: rig as never, speed: { walk: 200, run: 400 } },
    b: { name: "Bia", scale: 1, rig: rig as never, speed: { walk: 200, run: 400, fly: 300 } },
    c: { name: "Caio", scale: 1, rig: rig as never, speed: { walk: 200, run: 400 } },
  },
  sets: { room: { layers: [{ id: "bg", art: "<rect width='1920' height='1080' fill='#eee'/>" }], ground: { near: 900 }, marks: { left: { x: 300 }, door: { x: 1500 }, mid: { x: 900 } }, bounds: [-200, 0, 2120, 1080] } },
  props: { ball: { art: () => "<circle r='20'/>", radius: 20 } },
  width: 1920, height: 1080, fps: 24, narrators: ["n"],
};
const lines: Line[] = [
  { i: 0, s: 0.5, e: 1.0, text: "…", speaker: "n" },
  { i: 1, s: 1.0, e: 2.0, text: "…", speaker: "n" },
  { i: 2, s: 9.0, e: 10.0, text: "…", speaker: "n" },
  { i: 3, s: 16.0, e: 17.0, text: "…", speaker: "n" },
  { i: 4, s: 18.0, e: 19.0, text: "…", speaker: "n" },
];
const block = (beats: unknown[], cast = [{ id: "a", at: "left" }, { id: "b", at: "door" }]) => ({ id: "x", set: "room", from: 0, to: 5, cast, beats }) as Staging["blocks"][number];
const staged = (beats: unknown[], anticipation?: number, cast?: { id: string; at: string }[]): Staging => ({ ...(anticipation !== undefined ? { animation: { anticipation } } : {}), blocks: [block(beats, cast)] });
type Act = { action: string; actor?: string; channel?: string; at: number; duration?: number; value?: unknown; ease?: string; x?: number };
const scriptOf = (s: Staging) => direct(s, lines, kit).scenes.x.script as Act[];
const compiled = (s: Staging) => compileScene(direct(s, lines, kit).scenes.x, { characters: kit.characters } as never);
/** Where the top of the body (the head anchor) is relative to the feet, across (scene px). */
const leanAt = (sc: ReturnType<typeof compileScene>, id: string, t: number) => {
  const m = actorPlacement(sc.actors.find((a) => a.id === id)!, t);
  return apply(m, [0, -150])[0] - apply(m, [0, 0])[0];
};
const walksOf = (s: Staging, id: string) => scriptOf(s).filter((a) => a.action === "walkTo" && a.actor === id).map((a) => ({ t0: a.at, t1: a.at + a.duration! }));

describe("anticipation and settle", () => {
  it("off, the director's output is what it was (a walk, a flight, a gesture)", () => {
    const beats = [{ line: 1, do: "walk", who: "a", to: "mid" }, { line: 2, do: "fly", who: "b", to: "left" }, { line: 3, do: "gesture", who: "a", clip: "wave" }];
    const plain = direct(staged(beats), lines, kit);
    expect(direct(staged(beats, 0), lines, kit)).toEqual(plain);
    // (Nor does the option reach the scene: the scene's `animation` has no such field.)
    expect((direct(staged(beats, 1), lines, kit).scenes.x as { animation?: unknown }).animation).toBeUndefined();
    const withTwos = direct({ animation: { twos: true, anticipation: 1 }, blocks: [block(beats)] }, lines, kit);
    expect((withTwos.scenes.x as { animation?: unknown }).animation).toEqual({ twos: true });
    // Off, a walk never turns the body.
    expect(plain.scenes.x.script!.some((a) => (a as Act).action === "set" && (a as Act).actor === "a" && (a as Act).channel === "rotation")).toBe(false);
  });

  it("a walk leans back before setting off, into the move, past upright on arrival and back — both ways", () => {
    const s = staged([{ line: 1, do: "walk", who: "a", to: "door" }, { line: 2, do: "walk", who: "a", to: "left" }], 1);
    const sc = compiled(s);
    const [right, left] = walksOf(s, "a");
    expect(right.t1).toBeLessThan(left.t0 - 1);
    for (const [w, dir] of [[right, 1], [left, -1]] as const) {
      // Winding up: the top goes back, away from where they will go.
      expect(leanAt(sc, "a", w.t0 - 0.01) * dir).toBeLessThan(-3);
      // Going: the top ahead of the feet (5° of 150 px: about 13 px).
      expect(leanAt(sc, "a", (w.t0 + w.t1) / 2) * dir).toBeGreaterThan(10);
      // Arriving: past upright the other way, then upright.
      expect(leanAt(sc, "a", w.t1 + 0.15) * dir).toBeLessThan(-4);
      expect(Math.abs(leanAt(sc, "a", w.t1 + 0.5))).toBeLessThan(1e-6);
    }
    // Never left turned: the last rotation key is upright.
    const rot = scriptOf(s).filter((a) => a.action === "set" && a.actor === "a" && a.channel === "rotation");
    expect(rot.at(-1)?.value).toBe(0);
    // A run leans more.
    const run = compiled(staged([{ line: 1, do: "run", who: "a", to: "door" }], 1));
    const r = walksOf(staged([{ line: 1, do: "run", who: "a", to: "door" }], 1), "a")[0];
    expect(leanAt(run, "a", (r.t0 + r.t1) / 2)).toBeGreaterThan(leanAt(sc, "a", (right.t0 + right.t1) / 2) * 1.4);
  });

  it("no lean over a fall or while lying", () => {
    const s = staged([{ line: 1, do: "walk", who: "a", to: "door" }, { line: 1, offset: 6.2, do: "fall", who: "a" }], 1);
    const rot = scriptOf(s).filter((a) => a.action === "set" && a.actor === "a" && a.channel === "rotation");
    const w = walksOf(s, "a")[0];
    // Upright before the fall turns the body (no overshoot past the moment it falls).
    const fall = rot.find((a) => Math.abs(a.value as number) > 45)!;
    const before = rot.filter((a) => a.at < fall.at);
    expect(before.at(-1)?.value).toBe(0);
    expect(before.at(-1)!.at + before.at(-1)!.duration!).toBeLessThanOrEqual(fall.at + 1e-6);
    expect(fall.at).toBeGreaterThan(w.t1 - 1e-6);
  });

  it("a landing squashes about the feet and settles: a flight, a fall", () => {
    const s = staged([{ line: 1, do: "fly", who: "b", to: "mid" }], 1);
    const scale = scriptOf(s).filter((a) => a.action === "set" && a.actor === "b" && a.channel === "scale");
    const touch = scale.find((a) => JSON.stringify(a.value) === "[1.12,0.88]")!;
    expect(touch).toBeDefined();
    const land = touch.at;
    expect(scale.map((a) => a.value)).toEqual(expect.arrayContaining([[1.12, 0.88], [0.97, 1.04], [1, 1]]));
    expect(scale.at(-1)?.value).toBe(1);
    const sc = compiled(s);
    const b = sc.actors.find((x) => x.id === "b")!;
    for (const t of [land + 0.06, land + 0.16, land + 0.3]) expect(apply(actorPlacement(b, t), [0, 0])[1]).toBeCloseTo(900, 3);
    const m = actorPlacement(b, land + 0.06);
    expect(Math.abs(m[0])).toBeCloseTo(1.12, 2);
    expect(m[3]).toBeCloseTo(0.88, 2);
    // Off, the touch-down is the old one.
    const off = scriptOf(staged([{ line: 1, do: "fly", who: "b", to: "mid" }])).filter((a) => a.action === "set" && a.actor === "b" && a.channel === "scale");
    expect(off.map((a) => a.value)).toEqual([[1.08, 0.9], 1, [1.1, 0.88], 1]);

    // Falling flat on the back: the body flattens across (its own x), the back stays on the ground.
    const f = staged([{ line: 1, do: "fall", who: "a" }], 1);
    const fs = scriptOf(f).filter((a) => a.action === "set" && a.actor === "a" && a.channel === "scale");
    expect(fs.map((a) => a.value)).toEqual([[1, 1], [0.88, 1.12], [1.04, 0.97], [1, 1], 1]);
    const fc = compiled(f);
    const fa = fc.actors.find((x) => x.id === "a")!;
    const t = fs[1].at;
    // The resting point of the back: the hip joint (0, −64) and 70% of the back's reach (40 → 34 max) behind it.
    const contact: [number, number] = [-0.7 * 34, -64];
    const ground = apply(actorPlacement(fa, t), contact)[1];
    for (const dt of [0.06, 0.16, 0.3]) expect(apply(actorPlacement(fa, t + dt), contact)[1]).toBeCloseTo(ground, 0);
  });

  it("a free arm move overshoots and settles from 0.5; arcs and contacts are left as they are", () => {
    const beats = [{ line: 1, do: "hold", who: "c", prop: "bola", until: { line: 2 } }];
    const s = (anticipation?: number): Staging => ({ ...(anticipation !== undefined ? { animation: { anticipation } } : {}), blocks: [{ ...block(beats, [{ id: "c", at: "mid" }]), props: [{ id: "bola", kind: "ball", heldBy: "c" }] }] });
    const eases = (a?: number) => scriptOf(s(a)).filter((x) => x.action === "set" && x.actor === "c" && /^bones\.armF/.test(x.channel ?? "")).map((x) => x.ease);
    expect(eases().length).toBeGreaterThan(0);
    expect(new Set(eases())).toEqual(new Set(["easeInOut"]));
    expect(eases(0.4)).toEqual(eases());
    expect(new Set(eases(1))).toEqual(new Set(["backOut"]));

    // A 2.5D rig: every arm move is an arc (or into a contact: sitting) — unchanged.
    const look = { name: "kid", build: "kid", skin: "#f6d3b5", hair: "bowl", hairColor: "#5a3a22", top: "tee", topColor: "#2d8f4e", bottom: "shorts", bottomColor: "#3a62b0", shoes: "sneakers" } as const;
    const doc = cartoonCharacter(look as never);
    const k3 = { ...kit, characters: { ...kit.characters, kid: doc }, cast: { ...kit.cast, kid: { name: "kid", scale: 1, rig: cartoonInfo(doc, look as never) } }, props: { cig: { art: () => `<rect width="60" height="6"/>`, radius: 30, points: { tip: [-4, 1], end: [54, 0] } } } } as unknown as Kit;
    const s3 = (anticipation: number) => ({ animation: { anticipation }, blocks: [{ id: "x", set: "room", from: 0, to: 5, cast: [{ id: "kid", at: "mid" }], props: [{ id: "c", kind: "cig", heldBy: "kid" }],
      beats: [{ line: 0, do: "sit", who: "kid", on: "ground" }, { line: 0, offset: 0.4, do: "use", who: "kid", prop: "c", at: { tip: "mouth", end: 22 }, hands: false }, { line: 1, do: "take", who: "kid", prop: "c" }, { line: 1, offset: 0.8, do: "hold", who: "kid", prop: "c", until: { line: 2 } }] }] }) as unknown as Staging;
    const limbs = (a: number) => (direct(s3(a), lines, k3).scenes.x.script as Act[]).filter((x) => x.action === "set" && x.actor === "kid" && /^bones\.(arm|leg)/.test(x.channel ?? ""));
    expect(limbs(1).length).toBeGreaterThan(6);
    expect(limbs(1)).toEqual(limbs(0));
  });

  it("adds nothing to the strict checks (walks, a flight, a fall, arm moves)", () => {
    const beats = [
      { line: 0, do: "walk", who: "a", to: "mid" },
      { line: 1, do: "run", who: "a", to: "door" },
      { line: 1, do: "fly", who: "b", to: "left" },
      { line: 2, do: "walk", who: "a", to: "left" },
      { line: 2, offset: 0.5, do: "hold", who: "c", prop: "bola", until: { line: 3 } },
      { line: 3, do: "fall", who: "b" },
      { line: 4, do: "getUp", who: "b" },
    ];
    const s = (anticipation: number): Staging => ({ animation: { anticipation }, blocks: [{ ...block(beats, [{ id: "a", at: "left" }, { id: "b", at: "door" }, { id: "c", at: "mid" }]), props: [{ id: "bola", kind: "ball", heldBy: "c" }] }] });
    const issues = (a: number) => check(s(a), lines, kit, { strict: true }).map((i) => i.message);
    const before = new Set(issues(0));
    expect(issues(1).filter((m) => !before.has(m))).toEqual([]);
  });
});
