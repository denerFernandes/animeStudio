import { describe, expect, it } from "vitest";
import {
  type CompiledScene,
  type SceneDoc,
  type ToonDoc,
  actorPose,
  anchorPosition,
  apply,
  cameraAt,
  compileScene,
  currentVariant,
  evaluateScene,
  fromTRS,
  hangAngle,
  hangBake,
  propPlacement,
  validateScene,
} from "../src";
import { stick } from "./fixtures";

// The stick figure with a hand that closes around what it holds.
const holder: ToonDoc = {
  ...stick,
  parts: [...stick.parts, { id: "hand", type: "switch", bone: "arm2", variants: { open: "<circle r='4'/>", grip: "<circle r='5'/>" }, default: "open" }],
} as ToonDoc;

/** A bag drawn hanging below its handle (the origin): 60 px tall, so its centre of mass is 30 px down. */
const BAG = "<rect x='-8' y='0' width='16' height='60'/>";

const sceneDoc = (script: Record<string, unknown>[], extra: Record<string, unknown> = {}): SceneDoc =>
  ({
    format: "toon-scene",
    version: 1,
    width: 1200,
    height: 400,
    fps: 24,
    duration: 8,
    characters: { holder: "holder" },
    actors: [{ id: "a", character: "holder", x: 100, y: 350 }],
    props: [{ id: "bag", art: BAG, x: 300, y: 350 }],
    script,
    ...extra,
  }) as unknown as SceneDoc;

const compile = (doc: SceneDoc): CompiledScene => compileScene(doc, { characters: { holder } });
const bagOf = (sc: CompiledScene) => sc.props.find((p) => p.id === "bag")!;
/** The bag's swing (degrees) at every step of its bake, with their times. */
const swing = (sc: CompiledScene) => {
  const bag = bagOf(sc);
  const bake = hangBake(sc, bag, bag.grabs[0])!;
  return { bake, at: (n: number) => bake.start + n / bake.rate };
};

const walking = (hang: Record<string, unknown> = {}, walk: Record<string, unknown> = {}) =>
  sceneDoc([
    { at: 0, actor: "a", action: "grab", prop: "bag", anchor: "hand", hang },
    { at: 1, actor: "a", action: "walkTo", x: 600, ...walk },
  ]);

/** Time of the walk's end: when the holder's x stops changing. */
const walkEnd = (sc: CompiledScene): number => {
  let last = 0;
  for (let t = 1; t < sc.duration; t += 0.05) {
    const x0 = anchorPosition(sc, "a", "hand", t)[0];
    const x1 = anchorPosition(sc, "a", "hand", t + 0.05)[0];
    if (Math.abs(x1 - x0) > 1e-6) last = t + 0.05;
  }
  return last;
};

/** Last bake time the swing is wider than `deg`. */
const settledAt = (sc: CompiledScene, deg: number): number => {
  const { bake, at } = swing(sc);
  let last = bake.start;
  bake.angles.forEach((a, n) => {
    if (Math.abs(a) > deg) last = at(n);
  });
  return last;
};

describe("hung props", () => {
  it("(a) under a still holder the prop hangs straight with its handle on the anchor", () => {
    const sc = compile(sceneDoc([{ at: 0.5, actor: "a", action: "grab", prop: "bag", anchor: "hand", hang: {} }]));
    const bag = bagOf(sc);
    expect(bag.grabs[0].hang).toEqual({ point: [0, 0], length: 30, damping: 0.25, limit: 70, gravity: 1800 });
    for (const t of [0.5, 1, 2.5, 7]) {
      expect(hangAngle(sc, bag, t)).toBe(0);
      const p = propPlacement(sc, bag, t);
      const hand = anchorPosition(sc, "a", "hand", t);
      expect(p.x).toBeCloseTo(hand[0], 9);
      expect(p.y).toBeCloseTo(hand[1], 9);
      expect(p.rotation).toBeCloseTo(0, 9);
    }
    // Before the grab it is where its tracks say.
    expect(propPlacement(sc, bag, 0.2)).toMatchObject({ x: 300, y: 350 });
  });

  it("puts the handle `point` on the anchor and takes the scene gravity", () => {
    const doc = sceneDoc([{ at: 0, actor: "a", action: "grab", prop: "bag", anchor: "hand", hang: { point: [0, 10] } }], { world: { gravity: [0, 900] } });
    const sc = compile(doc);
    const bag = bagOf(sc);
    expect(bag.grabs[0].hang).toMatchObject({ point: [0, 10], length: 25, gravity: 900 });
    const p = propPlacement(sc, bag, 1);
    const hand = anchorPosition(sc, "a", "hand", 1);
    expect(p.y + 10).toBeCloseTo(hand[1], 9);
  });

  it("(b) swings behind the walk first, oscillates, and settles after the stop", () => {
    const sc = compile(walking());
    const { bake, at } = swing(sc);
    // The first move: opposite to the hand's acceleration as the walk starts.
    const n0 = bake.angles.findIndex((a) => Math.abs(a) > 0.05);
    expect(at(n0)).toBeGreaterThanOrEqual(1);
    const t0 = at(n0);
    const h = 1 / 120;
    const accel = (anchorPosition(sc, "a", "hand", t0 + h)[0] - 2 * anchorPosition(sc, "a", "hand", t0)[0] + anchorPosition(sc, "a", "hand", t0 - h)[0]) / (h * h);
    expect(accel).toBeGreaterThan(0);
    expect(bake.angles[n0]).toBeLessThan(0);
    // It oscillates: the swing changes sides several times.
    let crossings = 0;
    for (let n = 1; n < bake.angles.length; n++) if (Math.sign(bake.angles[n]) !== Math.sign(bake.angles[n - 1]) && Math.abs(bake.angles[n] - bake.angles[n - 1]) > 0.01) crossings++;
    expect(crossings).toBeGreaterThanOrEqual(3);
    // After the stop it swings forward (the bag keeps going), then settles within ~2.5 s.
    const end = walkEnd(sc);
    expect(end).toBeGreaterThan(1.5);
    const after = bake.angles.filter((_, n) => at(n) > end && at(n) < end + 0.6);
    expect(Math.max(...after.map(Math.abs))).toBeGreaterThan(1);
    expect(settledAt(sc, 0.5)).toBeLessThan(end + 2.5);
    expect(Math.abs(hangAngle(sc, bagOf(sc), 7.9))).toBeLessThan(0.05);
    // The placement swings with it: the art's down axis points along (sin θ, cos θ).
    const t = at(n0 + 12);
    const bag = bagOf(sc);
    const p = propPlacement(sc, bag, t);
    const m = fromTRS(p.x, p.y, p.rotation, p.scale[0] * (p.flip ? -1 : 1), p.scale[1]);
    const th = (hangAngle(sc, bag, t) * Math.PI) / 180;
    const d = [apply(m, [0, 30])[0] - p.x, apply(m, [0, 30])[1] - p.y];
    expect(d[0]).toBeCloseTo(30 * Math.sin(th), 6);
    expect(d[1]).toBeCloseTo(30 * Math.cos(th), 6);
  });

  it("(c) damping 1 settles much faster than 0.1", () => {
    const loose = compile(walking({ damping: 0.1 }));
    const firm = compile(walking({ damping: 1 }));
    const end = walkEnd(loose);
    const looseAfter = settledAt(loose, 0.5) - end;
    const firmAfter = settledAt(firm, 0.5) - end;
    expect(looseAfter).toBeGreaterThan(2);
    expect(firmAfter).toBeLessThan(looseAfter / 3);
    const peak = (sc: CompiledScene) => Math.max(...swing(sc).bake.angles.map(Math.abs));
    expect(peak(firm)).toBeLessThan(peak(loose));
  });

  it("(d) the swing never passes `limit`", () => {
    const free = compile(walking({}, { duration: 0.35 }));
    const peakFree = Math.max(...swing(free).bake.angles.map(Math.abs));
    expect(peakFree).toBeGreaterThan(15);
    const sc = compile(walking({ limit: 12 }, { duration: 0.35 }));
    const angles = swing(sc).bake.angles;
    expect(Math.max(...angles.map(Math.abs))).toBeLessThanOrEqual(12 + 1e-9);
    expect(angles.some((a) => Math.abs(a) >= 12 - 1e-9)).toBe(true);
  });

  it("(e) the same time gives the same result whatever was evaluated first", () => {
    const doc = walking();
    const fresh = compile(doc);
    const first = propPlacement(fresh, bagOf(fresh), 2.3);
    const other = compile(doc);
    for (const t of [5, 0.4, 3.1]) evaluateScene(other, t);
    cameraAt(other, 1.7);
    actorPose(other, other.actors[0], 2.9);
    expect(propPlacement(other, bagOf(other), 2.3)).toEqual(first);
    // And the frames agree too.
    const viaFrame = compile(doc);
    evaluateScene(viaFrame, 2.3);
    expect(propPlacement(viaFrame, bagOf(viaFrame), 2.3)).toEqual(first);
  });

  it("(f) cartoon timing on twos bakes the same swing (it runs in smooth time)", () => {
    const smooth = compile(walking());
    const twos = compile({ ...walking(), animation: { twos: true, holds: 1 } } as SceneDoc);
    expect(swing(twos).bake.angles).toEqual(swing(smooth).bake.angles);
    // A frame on twos shows the swing of its drawing (frames 2k and 2k+1 share it).
    const f = 41;
    const a = hangAngle(twos, bagOf(twos), f / 24);
    expect(a).toBe(hangAngle(twos, bagOf(twos), 40 / 24));
    expect(a).toBeCloseTo(hangAngle(smooth, bagOf(smooth), 40 / 24), 12);
  });

  it("(g) a flip of the holder restarts the swing at rest, and the mirror keeps its sense", () => {
    const doc = sceneDoc([
      { at: 0, actor: "a", action: "grab", prop: "bag", anchor: "hand", hang: { damping: 0.05 } },
      { at: 1, actor: "a", action: "walkTo", x: 600 },
      { at: 4.5, actor: "a", action: "face", direction: "left" },
    ]);
    const sc = compile(doc);
    const { bake, at } = swing(sc);
    expect(bake.resets).toHaveLength(1);
    const r = bake.resets[0];
    expect(at(r)).toBeGreaterThanOrEqual(4.5);
    expect(at(r - 1)).toBeLessThan(4.5);
    expect(Math.abs(bake.angles[r - 1])).toBeGreaterThan(0.5); // still swinging before the turn
    expect(bake.angles[r]).toBe(0);
    // The holder stands still after turning: the bag hangs straight from then on.
    expect(Math.max(...bake.angles.slice(r).map(Math.abs))).toBeLessThan(0.5);
    // Mirrored with its holder, handle on the anchor.
    const bag = bagOf(sc);
    const p = propPlacement(sc, bag, 5);
    expect(p.flip).toBe(true);
    const hand = anchorPosition(sc, "a", "hand", 5);
    expect(p.x).toBeCloseTo(hand[0], 9);
    expect(p.y).toBeCloseTo(hand[1], 9);
    // A swing seen in a mirrored holder's hand still points the art's down axis along (sin θ, cos θ).
    const left = compile(
      sceneDoc([
        { at: 0, actor: "a", action: "face", direction: "left" },
        { at: 0.1, actor: "a", action: "grab", prop: "bag", anchor: "hand", hang: {} },
        { at: 1, actor: "a", action: "walkTo", x: -400 },
      ]),
    );
    const lb = bagOf(left);
    const lbake = hangBake(left, lb, lb.grabs[0])!;
    const t = lbake.start + lbake.angles.findIndex((a) => Math.abs(a) > 1) / lbake.rate;
    const th = hangAngle(left, lb, t);
    expect(th).toBeGreaterThan(1); // walking towards −x: the bag lags towards +x
    const q = propPlacement(left, lb, t);
    const m = fromTRS(q.x, q.y, q.rotation, q.scale[0] * (q.flip ? -1 : 1), q.scale[1]);
    const d = apply(m, [0, 30]);
    expect(d[0] - q.x).toBeCloseTo(30 * Math.sin((th * Math.PI) / 180), 6);
  });

  it("(h) the hand still closes around it and is drawn over it", () => {
    const sc = compile(walking());
    const actor = sc.actors[0];
    const hand = actor.rig.partIndex.get("hand")!;
    expect(currentVariant(actor.rig, actorPose(sc, actor, 2).state, hand)).toBe("grip");
    const fr = evaluateScene(sc, 2);
    const keys = fr.nodes.map((n) => n.key);
    const iProp = keys.indexOf("prop-bag");
    const iHand = keys.indexOf("actor-a-hand");
    const iBody = keys.indexOf("actor-a");
    expect(iProp).toBeGreaterThan(-1);
    expect(iBody).toBeLessThan(iProp);
    expect(iHand).toBeGreaterThan(iProp);
  });

  it("(i) validation rejects `hang` together with `fit`", () => {
    const doc = sceneDoc([{ at: 0, actor: "a", action: "grab", prop: "bag", anchor: "hand", hang: {}, fit: [{ point: [0, 0], anchor: "hand" }] }]);
    const r = validateScene(doc);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => /fit.*hang|hang/.test(i.message) && i.path.includes("hang"))).toBe(true);
    expect(validateScene(sceneDoc([{ at: 0, actor: "a", action: "grab", prop: "bag", anchor: "hand", hang: { damping: 2 } }])).ok).toBe(false);
    expect(validateScene(sceneDoc([{ at: 0, actor: "a", action: "grab", prop: "bag", anchor: "hand", hang: { length: 40 } }]), { characters: { holder } }).ok).toBe(true);
  });
});
