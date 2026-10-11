import { describe, expect, it } from "vitest";
import { actorPose, compileScene, currentVariant, getEasing } from "@animestudio/core";
import { check, direct, type Kit, type Line, type Staging } from "../src";
import { arcIk } from "../src/direct";
import { stick } from "../../core/test/fixtures";

// Life in the eyes and head (`animation.life`): blinks on head turns, saccades while listening,
// head nods on stressed words; takes and double takes (`take` without a prop); arcs on paired IK
// moves (`animation.arcs`). Off (the default), the director's output does not change.

const rig = { hand: { F: [80, -110], B: [80, -110] }, shoulder: { F: [0, -110], B: [0, -110] }, armLength: { F: 80, B: 80 }, backShoulder: { F: [0, 0], B: [0, 0] }, extent: { front: 60, back: 40 }, height: 160 } as const;
// The stick with eyes (open / closed / wide), pupils, views and a few emotions.
const face = {
  ...stick,
  art: { ...stick.art, eyeOpen: "<circle r='4'/>", eyeClosed: "<path d='M-4 0h8'/>", eyeWide: "<circle r='6'/>", pupils: "<circle r='2'/>" },
  skeleton: [...stick.skeleton, { id: "pupils", parent: "head", from: [6, -150] }],
  parts: [...stick.parts, { id: "eyes", type: "switch", bone: "head", variants: { open: "eyeOpen", closed: "eyeClosed", wide: "eyeWide" }, default: "open" }, { id: "pupils", type: "rigid", bone: "pupils", art: "pupils" }],
  controls: {
    ...stick.controls,
    view: { type: "pose", poses: { profile: { "bones.body.rotation": 0 }, front: { "bones.body.rotation": 0 } } },
    emotion: { type: "pose", poses: { sad: { "bones.head.rotation": 20 }, surprised: { "parts.eyes.variant": "wide" }, sleep: { "parts.eyes.variant": "closed" } } },
  },
  clips: { ...stick.clips, run: stick.clips!.walk },
} as unknown as typeof stick;
// The same without a head bone (a blob): no nods.
const blob = JSON.parse(JSON.stringify(face).replace(/"head"/g, '"skull"')) as typeof stick;
const kitOf = (a: typeof stick = face): Kit => ({
  characters: { a, b: face },
  cast: { a: { name: "Ana", scale: 1, rig: rig as never, speed: { walk: 200, run: 400 } }, b: { name: "Bia", scale: 1, rig: rig as never, speed: { walk: 200, run: 400 } } },
  sets: { room: { layers: [{ id: "bg", art: "<rect width='1920' height='1080' fill='#eee'/>" }], ground: { near: 900 }, marks: { left: { x: 600 }, door: { x: 1300 }, mid: { x: 950 } }, bounds: [-200, 0, 2120, 1080] } },
  props: { ball: { art: () => "<circle r='20'/>", radius: 20 } },
  width: 1920, height: 1080, fps: 24, narrators: ["n"],
});
const kit = kitOf();
const w = (word: string, s: number, e: number) => ({ w: word, s, e });
// Ana's line: the accents are "Oh" (first clause), not "no!" (0.2 s later), "thought" (the longest of
// the second clause) and "honestly!" (the last word).
const lines: Line[] = [
  { i: 0, s: 0.5, e: 1.0, text: "…", speaker: "n" },
  { i: 1, s: 1.0, e: 3.0, text: "Oh, no! I never thought this could happen, honestly!", speaker: "Ana",
    words: [w("Oh,", 1.0, 1.15), w("no!", 1.2, 1.4), w("I", 1.5, 1.55), w("never", 1.6, 1.85), w("thought", 1.9, 2.15), w("this", 2.2, 2.3), w("could", 2.35, 2.45), w("happen,", 2.5, 2.7), w("honestly!", 2.75, 2.95)] },
  { i: 2, s: 9.0, e: 10.0, text: "…", speaker: "n" },
  { i: 3, s: 16.0, e: 17.0, text: "…", speaker: "n" },
  { i: 4, s: 18.0, e: 19.0, text: "…", speaker: "n" },
];
const block = (beats: unknown[]) => ({ id: "x", set: "room", from: 0, to: 5, cast: [{ id: "a", at: "left" }, { id: "b", at: "door" }], props: [{ id: "bola", kind: "ball", at: "mid" }], beats }) as Staging["blocks"][number];
const staged = (beats: unknown[], animation?: Staging["animation"]): Staging => ({ ...(animation ? { animation } : {}), blocks: [block(beats)] });
type Act = { action: string; actor?: string; channel?: string; at: number; duration?: number; value?: unknown; ease?: unknown; target?: unknown; control?: string };
const scriptOf = (s: Staging, k = kit) => direct(s, lines, k).scenes.x.script as Act[];
const sets = (s: Staging, actor: string, channel: string, k = kit) => scriptOf(s, k).filter((a) => a.action === "set" && a.actor === actor && a.channel === channel);
const F = 1 / 24;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-3;

const beats = [
  { line: 2, do: "face", who: "a", direction: "left" },
  { line: 3, do: "view", who: "b", value: "front" },
  { line: 4, do: "look", who: "a", target: "bola" },
];

describe("life in the eyes and head", () => {
  it("off, the director's output is what it was", () => {
    const plain = direct(staged(beats), lines, kit);
    expect(direct(staged(beats, { life: 0, anticipation: 0 }), lines, kit)).toEqual(plain);
    // (`life` never reaches the scene; `arcs` does — the scene's reach blends read it.)
    expect((direct(staged(beats, { life: 1 }), lines, kit).scenes.x as { animation?: unknown }).animation).toBeUndefined();
    expect((direct(staged(beats, { life: 1, arcs: 0.5, twos: true }), lines, kit).scenes.x as { animation?: unknown }).animation).toEqual({ arcs: 0.5, twos: true });
    // `arcs` 0 stages the same moves.
    expect(scriptOf(staged(beats, { arcs: 0 }))).toEqual(scriptOf(staged(beats)));
    // Off, nothing touches the eyes, the pupils or the head.
    expect(plain.scenes.x.script!.some((a) => /^(parts\.eyes|bones\.(pupils|head))\./.test(String((a as Act).channel)))).toBe(false);
  });

  it("blinks on a face and on a view: closed for 3 frames from a frame before the turn (two drawings on twos)", () => {
    const eyes = (anim: Staging["animation"], who: string) => sets(staged(beats, anim), who, "parts.eyes.variant").map((a) => [a.at, a.value] as [number, string]);
    const blinkAt = (keys: [number, string][], t: number) => keys.find(([at, v]) => v === "closed" && near(at, t));
    for (const [anim, frames] of [[{ life: 1 }, 3], [{ life: 1, twos: true }, 4]] as const) {
      const a = eyes(anim, "a"), b = eyes(anim, "b");
      // The face at 9 s and the view at 16 s.
      for (const [keys, t] of [[a, 9], [b, 16]] as const) {
        const k = blinkAt(keys, t - F);
        expect(k).toBeDefined();
        const back = keys[keys.indexOf(k!) + 1];
        expect(back[1]).toBeNull(); // let go: the emotion's eyes come back by themselves
        expect(back[0]).toBeCloseTo(t - F + frames * F, 3);
      }
      // A new gaze target (the ball at 18 s) blinks too.
      expect(blinkAt(a, 18 - F)).toBeDefined();
    }
    // The blink shows in the picture (no emotion of this rig sets the eyes).
    const s = staged(beats, { life: 1 });
    const sc = compileScene(direct(s, lines, kit).scenes.x, { characters: kit.characters } as never);
    const actor = sc.actors.find((x) => x.id === "a")!;
    const eyesAt = (t: number) => currentVariant(actor.rig, actorPose(sc, actor, t).state, actor.rig.partIndex.get("eyes")!);
    expect(eyesAt(9)).toBe("closed");
    expect(eyesAt(9 + 3 * F)).toBe("open");
    // Never while asleep.
    const asleep = sets(staged([{ line: 2, offset: -1, do: "emotion", who: "a", value: "sleep" }, ...beats], { life: 1 }), "a", "parts.eyes.variant");
    expect(asleep.some((k) => near(k.at, 9 - F))).toBe(false);
    // (No eye keys at all: the sleep emotion's closed eyes are the control's, never overridden.)
    expect(asleep.filter((k) => k.at > 8 && k.at < 10).map((k) => k.value)).toEqual([]);
  });

  it("nods the head on the stressed words, 0.35 s apart at least; none without a head", () => {
    const nods = (life: number, k = kit) => sets(staged([], { life }), "a", "bones.head.rotation", k);
    const n = nods(1);
    // Up at "Oh" (not "no!", 0.2 s later), "thought" and "honestly!": +3° over 0.08 s, back over 0.16 s.
    expect(n.filter((a) => a.value !== 0).map((a) => a.at)).toEqual([1, 1.9, 2.75]);
    for (const up of n.filter((a) => a.value !== 0)) {
      expect(up).toMatchObject({ value: 3, duration: 0.08 });
      expect(n.find((a) => a.value === 0 && near(a.at, up.at + 0.08))).toMatchObject({ duration: 0.16 });
    }
    expect(nods(0.5).filter((a) => a.value !== 0).map((a) => a.value)).toEqual([1.5, 1.5, 1.5]);
    // The listener does not nod; a rig without a head bone does not either.
    expect(sets(staged([], { life: 1 }), "b", "bones.head.rotation")).toEqual([]);
    expect(nods(1, kitOf(blob))).toEqual([]);
    expect(sets(staged([], { life: 1 }), "a", "bones.skull.rotation", kitOf(blob))).toEqual([]);
  });

  it("saccades: the same in every render, only while not speaking nor walking", () => {
    const s = staged([{ line: 2, do: "walk", who: "b", to: "mid" }], { life: 1 });
    const darts = (who: string) => sets(s, who, "bones.pupils.x");
    expect(darts("a")).toEqual(darts("a"));
    expect(scriptOf(s)).toEqual(scriptOf(s));
    for (const who of ["a", "b"]) {
      const d = darts(who);
      const out = d.filter((a) => a.value !== 0);
      expect(out.length).toBeGreaterThan(4);
      // ±2 px for 0.12 s, then back; 1.4–2.6 s apart at least.
      for (const a of out) {
        expect(Math.abs(a.value as number)).toBe(2);
        expect(d.find((x) => x.value === 0 && near(x.at, a.at + 0.12))).toBeDefined();
      }
      for (let i = 1; i < out.length; i++) expect(out[i].at - out[i - 1].at).toBeGreaterThanOrEqual(1.4 - 1e-6);
    }
    // Ana speaks line 1 (1–3 s): no dart of hers then.
    expect(darts("a").some((a) => a.at > 0.8 && a.at < 3.1)).toBe(false);
    // Bia walks from 9 s: none of hers while walking.
    const walk = scriptOf(s).find((a) => a.action === "walkTo" && a.actor === "b")!;
    expect(darts("b").some((a) => a.at > walk.at - 0.3 && a.at < walk.at + walk.duration!)).toBe(false);
    // A rig without pupils: no darts.
    const k = kitOf({ ...face, skeleton: face.skeleton.filter((b) => b.id !== "pupils"), parts: face.parts.filter((p) => p.id !== "pupils") } as typeof stick);
    expect(sets(staged([], { life: 1 }), "a", "bones.pupils.x", k)).toEqual([]);
  });
});

describe("takes", () => {
  const keys = (s: Staging, who: string, k = kit) => scriptOf(s, k).filter((a) => a.actor === who && (a.action === "set" || a.action === "lookAt" || (a.action === "pose" && a.control === "emotion")) && a.at > 8 && a.at < 30);
  const brief = (a: Act) => [a.at, a.action === "set" ? a.channel : a.action, a.action === "lookAt" ? a.target : a.value, a.duration ?? 0];

  it("a take: anticipation away from the target, the reaction towards it, held, settled", () => {
    const s = staged([{ line: 2, do: "take", who: "a", target: "b" }]);
    expect(keys(s, "a").map(brief)).toEqual([
      [8.878, "scale", [1, 1], 0],
      [8.88, "parts.eyes.variant", "closed", 0],
      [8.88, "scale", [1.04, 0.96], 0.12],
      [8.88, "rotation", -3, 0.12],
      [9, "parts.eyes.variant", "wide", 0],
      [9, "lookAt", "b", 0],
      [9, "pose", "surprised", 0.08],
      [9, "scale", [0.96, 1.06], 0.08],
      [9, "rotation", 4, 0.08],
      [9.43, "scale", [1, 1], 0.3],
      [9.43, "rotation", 0, 0.3],
      [9.73, "parts.eyes.variant", null, 0],
      [9.732, "scale", 1, 0],
    ]);
    // Sized by `animation.anticipation`; Bia, on the right of Ana's left mark, takes towards her (−x).
    const half = keys(staged([{ line: 2, do: "take", who: "b", target: "a" }], { anticipation: 0.5 }), "b");
    expect(half.filter((a) => a.channel === "rotation").map((a) => a.value)).toEqual([1.5, -2, 0]);
    expect(half.filter((a) => a.channel === "scale").map((a) => a.value)).toEqual([[1, 1], [1.02, 0.98], [0.98, 1.03], [1, 1], 1]);
  });

  it("a double take: a glance, a look away, then the full take 1.4× bigger", () => {
    const s = staged([{ line: 2, do: "take", who: "a", target: "bola", double: true }]);
    const k = keys(s, "a");
    // (Back to what they looked at before: here, ahead.)
    expect(k.filter((a) => a.action === "lookAt").map(brief)).toEqual([[9, "lookAt", "bola", 0], [9.25, "lookAt", null, 0], [9.57, "lookAt", "bola", 0]]);
    expect(k.filter((a) => a.channel === "rotation").map(brief)).toEqual([[9.45, "rotation", -4.2, 0.12], [9.57, "rotation", 5.6, 0.08], [10, "rotation", 0, 0.3]]);
    expect(k.filter((a) => a.channel === "scale").map((a) => a.value)).toEqual([[1, 1], [1.056, 0.944], [0.944, 1.084], [1, 1], 1]);
    expect(k.filter((a) => a.channel === "parts.eyes.variant").map(brief)).toEqual([[9.45, "parts.eyes.variant", "closed", 0], [9.57, "parts.eyes.variant", "wide", 0], [10.3, "parts.eyes.variant", null, 0]]);
  });

  it("an unknown target is reported (the take still happens); a take with a prop is the old one", () => {
    const out = direct(staged([{ line: 2, do: "take", who: "a", target: "bolla" }]), lines, kit);
    expect(out.issues.map((i) => i.message).join("\n")).toMatch(/"take": unknown target "bolla".*did you mean "bola"/);
    expect((out.scenes.x.script as Act[]).some((a) => a.actor === "a" && a.action === "pose" && a.value === "surprised")).toBe(true);
    // No blinks of `life` inside a take.
    const lively = sets(staged([{ line: 2, do: "take", who: "a", target: "b" }], { life: 1 }), "a", "parts.eyes.variant");
    expect(lively.filter((a) => a.at > 8.8 && a.at < 9.8).map((a) => a.value)).toEqual(["closed", "wide", null]);
  });
});

describe("arcs on IK moves", () => {
  const move = (x: number, y: number, at = 1, duration = 0.4) => [
    { at, actor: "a", action: "set", channel: "ik.hand.x", value: x, duration },
    { at, actor: "a", action: "set", channel: "ik.hand.y", value: y, duration },
  ];
  // The stick's arm: the shoulder at (0, −110), the hand's rest tip at (80, −110).
  const joints = () => ({ root: [0, -110] as [number, number], rest: [80, -110] as [number, number] });

  it("a key halfway, pushed across the chord by 0.3 × its length (arcs 1), away from the root", () => {
    const script = move(100, 0);
    expect(arcIk(script, 0, joints)).toBe(script);
    const out = arcIk(script, 1, joints).map((a) => [a.at, a.channel, a.value, a.duration]);
    // The root is on the chord's line: the arc bulges upwards (−y), 30 px at its middle.
    expect(out).toEqual([[1, "ik.hand.x", 50, 0.2], [1.2, "ik.hand.x", 100, 0.2], [1, "ik.hand.y", -30, 0.2], [1.2, "ik.hand.y", 0, 0.2]]);
    // A root above the chord: the arc bulges down, away from it; half as much at arcs 0.5.
    const below = arcIk(script, 0.5, () => ({ root: [50, -300], rest: [80, -110] }));
    expect(below.filter((a) => a.channel === "ik.hand.y").map((a) => a.value)).toEqual([15, 0]);
    // Unknown joints: upwards. A straight (linear) or instant move, or one taking over a move under way, is left as it is.
    expect(arcIk(script, 1, () => undefined).find((a) => a.channel === "ik.hand.y")?.value).toBe(-30);
    expect(arcIk(move(100, 0, 1, 0), 1, joints)).toEqual(move(100, 0, 1, 0));
    const lin = move(100, 0).map((a) => ({ ...a, ease: "linear" }));
    expect(arcIk(lin, 1, joints)).toEqual(lin);
    const overlap = [...move(40, 0, 0.8), ...move(100, 0)];
    expect(arcIk(overlap, 1, joints)).toEqual(overlap);
  });

  it("the two halves flow through the midpoint (no stop, no kink)", () => {
    const [x1, x2, y1, y2] = arcIk(move(100, 60), 1, joints) as (Act & { value: number; ease: [number, number, number, number] })[];
    const along = (from: number, a: typeof x1, u: number) => from + (a.value - from) * getEasing(a.ease)(u);
    // Positions just before and after the midpoint (in each half's own time).
    const e = 0.001;
    const vx = [(along(0, x1, 1) - along(0, x1, 1 - e)) / e, (along(x1.value, x2, e) - along(x1.value, x2, 0)) / e];
    const vy = [(along(0, y1, 1) - along(0, y1, 1 - e)) / e, (along(y1.value, y2, e) - along(y1.value, y2, 0)) / e];
    // Both axes keep their speed through it, along the chord (100, 60): π/4 of it per half.
    expect(vx[0]).toBeCloseTo(vx[1], 0);
    expect(vy[0]).toBeCloseTo(vy[1], 0);
    expect(vx[0]).toBeCloseTo((100 * Math.PI) / 4, -1);
    expect(vy[0]).toBeCloseTo((60 * Math.PI) / 4, -1);
    // Still at both ends.
    expect(along(0, x1, 0.01)).toBeCloseTo(0, 0);
    expect(along(x1.value, x2, 0.99)).toBeCloseTo(100, 0);
  });
});

describe("checks", () => {
  it("life, arcs and takes add nothing to the strict checks", () => {
    const all = [
      ...beats,
      { line: 2, offset: 2, do: "walk", who: "b", to: "mid" },
      { line: 3, offset: 0.5, do: "take", who: "a", target: "b" },
      { line: 4, offset: 0.2, do: "take", who: "b", target: "a", double: true },
    ];
    const issues = (animation?: Staging["animation"]) => check(staged(all, animation), lines, kit, { strict: true }).map((i) => i.message.replace(/^t [\d.]+ /, ""));
    const before = new Set(issues({ anticipation: 1 }));
    expect(issues({ anticipation: 1, life: 1, arcs: 1 }).filter((m) => !before.has(m))).toEqual([]);
    expect(issues({ anticipation: 1, life: 1, arcs: 1, twos: true }).filter((m) => !new Set(issues({ anticipation: 1, twos: true })).has(m))).toEqual([]);
  });
});
