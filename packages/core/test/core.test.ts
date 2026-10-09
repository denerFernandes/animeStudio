import { describe, expect, it } from "vitest";
import {
  actorPlacement,
  anchorPosition,
  apply,
  bakePhysics,
  compileRig,
  compileScene,
  cuesFromText,
  evaluatePose,
  evaluateScene,
  frameToSVG,
  fromTRS,
  invert,
  jsonSchemas,
  multiply,
  normalizeTrack,
  samplePhysics,
  sampleTrack,
  validateScene,
  validateToon,
  type SceneDoc,
} from "../src";
import { stick } from "./fixtures";

const close = (a: number, b: number, eps = 1e-3) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe("math", () => {
  it("inverts matrices", () => {
    const m = fromTRS(10, 20, 33, 2, 0.5);
    const id = multiply(m, invert(m));
    [1, 0, 0, 1, 0, 0].forEach((v, i) => close(id[i], v));
  });
});

describe("keyframes", () => {
  it("passes through keys smoothly without overshoot", () => {
    const tr = normalizeTrack([[0, 0], [1, 10], [2, 10], [3, 0]]);
    close(sampleTrack(tr, 1) as number, 10);
    for (let t = 0; t <= 3; t += 0.01) {
      const v = sampleTrack(tr, t) as number;
      expect(v).toBeLessThanOrEqual(10 + 1e-9);
      expect(v).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it("keeps velocity through intermediate keys (fluid motion)", () => {
    const tr = normalizeTrack([[0, 0], [1, 10], [2, 20]]);
    // Monotone spline: no stop at t = 1, so the value just after the key keeps rising quickly.
    const v1 = sampleTrack(tr, 1.05) as number;
    expect(v1 - 10).toBeGreaterThan(0.3);
  });

  it("honours explicit easing and steps strings", () => {
    const tr = normalizeTrack([[0, 0], [1, 10, "linear"]]);
    close(sampleTrack(tr, 0.25) as number, 2.5);
    const s = normalizeTrack([[0, "a"], [1, "b"]]);
    expect(sampleTrack(s, 0.99)).toBe("a");
    expect(sampleTrack(s, 1)).toBe("b");
  });
});

describe("rig", () => {
  it("builds setup-space bones", () => {
    const rig = compileRig(stick);
    const arm2 = rig.bones[rig.boneIndex.get("arm2")!];
    const o = apply(arm2.setupWorld, [0, 0]);
    close(o[0], 40);
    close(o[1], -110);
    const tip = apply(arm2.setupWorld, [arm2.length, 0]);
    close(tip[0], 80);
  });

  it("reports actionable errors", () => {
    const bad = structuredClone(stick);
    bad.parts[1] = { id: "body", type: "rigid", bone: "torso", art: "body" };
    const r = validateToon(bad);
    expect(r.ok).toBe(false);
    expect(r.issues[0].message).toContain('unknown bone "torso"');
    expect(r.issues[0].message).toContain("Known bones");
  });

  it("rejects unknown fields (typos)", () => {
    const bad = structuredClone(stick) as Record<string, unknown>;
    (bad.skeleton as Record<string, unknown>[])[0].rotaton = 5;
    expect(validateToon(bad).ok).toBe(false);
  });
});

describe("pose", () => {
  it("applies clips with forward kinematics", () => {
    const rig = compileRig(stick);
    const { world } = evaluatePose(rig, {
      time: 0.5,
      clips: [{ clip: "wave", start: 0, end: Infinity, speed: 1, loop: true, fadeIn: 0, fadeOut: 0, layer: 0, blend: "override", weight: 1 }],
    });
    const i = rig.boneIndex.get("arm2")!;
    const o = apply(world[i], [0, 0]);
    // arm1 rotated -90° (counter-clockwise) → arm2 origin is now above the shoulder.
    close(o[0], 0, 1e-2);
    close(o[1], -150, 1e-2);
  });

  it("keeps squash local: children are not scaled or sheared", () => {
    const rig = compileRig(stick);
    const body = rig.boneIndex.get("body")!;
    const head = rig.boneIndex.get("head")!;
    const squash = { channel: "bones.body.squash", ref: { kind: "bone" as const, index: body, prop: "squash" as const }, track: normalizeTrack([[0, -0.3]]) };
    const rot = { channel: "bones.body.rotation", ref: { kind: "bone" as const, index: body, prop: "rotation" as const }, track: normalizeTrack([[0, 25]]) };
    const { world } = evaluatePose(rig, { time: 0, tracks: [squash, rot] });
    const h = world[head];
    // Orthonormal (rotation only): unit columns, perpendicular.
    close(Math.hypot(h[0], h[1]), 1);
    close(Math.hypot(h[2], h[3]), 1);
    close(h[0] * h[2] + h[1] * h[3], 0);
    // But the head still moved down with the squashed body.
    const restHead = apply(rig.bones[head].setupWorld, [0, 0]);
    expect(Math.hypot(h[4] - restHead[0], h[5] - restHead[1])).toBeGreaterThan(5);
    // The body itself is squashed along its own axis and widened across it.
    expect(Math.hypot(world[body][0], world[body][1])).toBeLessThan(0.8);
    expect(Math.hypot(world[body][2], world[body][3])).toBeGreaterThan(1.3);
  });

  it("solves two-bone IK", () => {
    const rig = compileRig(stick);
    const ref = { kind: "ik" as const, index: 0 };
    const target: [number, number] = [50, -60];
    const rest = rig.ik[0].restTarget;
    const { world } = evaluatePose(rig, {
      time: 0,
      tracks: [
        { channel: "ik.hand.mix", ref: { ...ref, prop: "mix" }, track: normalizeTrack([[0, 1]]) },
        { channel: "ik.hand.x", ref: { ...ref, prop: "x" }, track: normalizeTrack([[0, target[0] - rest[0]]]) },
        { channel: "ik.hand.y", ref: { ...ref, prop: "y" }, track: normalizeTrack([[0, target[1] - rest[1]]]) },
      ],
    });
    const i = rig.boneIndex.get("arm2")!;
    const tip = apply(world[i], [rig.bones[i].length, 0]);
    close(tip[0], target[0], 0.05);
    close(tip[1], target[1], 0.05);
  });

  it("drives switch parts from visemes and poses", () => {
    const rig = compileRig(stick);
    const ctrl = (name: string, v: string) => ({ channel: `controls.${name}`, ref: { kind: "control" as const, name }, track: normalizeTrack([[0, v]]) });
    const a = evaluatePose(rig, { time: 0, tracks: [ctrl("mouth", "D")] });
    expect(a.state.variant[rig.partIndex.get("mouth")!]).toBe("D");
    // "C" is missing → falls back to a close shape.
    const b = evaluatePose(rig, { time: 0, tracks: [ctrl("mouth", "C")] });
    expect(b.state.variant[rig.partIndex.get("mouth")!]).toBe("D");
    const c = evaluatePose(rig, { time: 0, tracks: [ctrl("emotion", "sad")] });
    close(c.state.brot[rig.boneIndex.get("head")!], 20);
  });

  it("scales a bone's rotation with rotationMix", () => {
    const rig = compileRig(stick);
    const ch = (channel: string, v: number) => ({ channel, ref: { kind: "bone" as const, index: rig.boneIndex.get("head")!, prop: channel.split(".")[2] as never }, track: normalizeTrack([[0, v]]) });
    const p = evaluatePose(rig, { time: 0, tracks: [ch("bones.head.rotation", 20), ch("bones.head.rotationMix", -0.85)] });
    close(p.state.brot[rig.boneIndex.get("head")!], 3);
  });

  it("drives several mouths (one per view) from one viseme control", () => {
    const doc = structuredClone(stick);
    doc.parts!.push({ id: "mouthFront", type: "switch", bone: "head", variants: { A: "mouthA", D: "mouthD", X: "mouthX" }, default: "X" } as never);
    doc.controls!.mouth = { type: "viseme", part: ["mouth", "mouthFront"] };
    const rig = compileRig(doc);
    const track = { channel: "controls.mouth", ref: { kind: "control" as const, name: "mouth" }, track: normalizeTrack([[0, "D"]]) };
    const pose = evaluatePose(rig, { time: 0, tracks: [track] });
    expect(pose.state.variant[rig.partIndex.get("mouth")!]).toBe("D");
    expect(pose.state.variant[rig.partIndex.get("mouthFront")!]).toBe("D");
  });
});

const scene: SceneDoc = {
  format: "toon-scene",
  version: 1,
  width: 640,
  height: 360,
  fps: 30,
  duration: 4,
  background: "#fff",
  characters: { stick: "stick.toon.json" },
  actors: [
    { id: "a", character: "stick", x: 100, y: 300 },
    { id: "b", character: "stick", x: 500, y: 300, flip: true },
  ],
  script: [
    { at: 0, actor: "a", action: "walkTo", x: 300, duration: 2 },
    { at: 0.5, actor: "b", action: "say", text: "Hello there!", duration: 1 },
    { at: 1, actor: "a", action: "lookAt", target: "b" },
    { at: 2.5, actor: "a", action: "pose", control: "emotion", value: "sad", duration: 0.5 },
    { at: 3, action: "shake", duration: 0.5 },
  ],
};

describe("scene", () => {
  it("validates and compiles", () => {
    const r = validateScene(scene, { characters: { stick } });
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("walks actors with eased motion and faces direction", () => {
    const s = compileScene(scene, { characters: { stick } });
    const xs = [0, 0.15, 1, 1.85, 2].map((t) => {
      const node = evaluateScene(s, t).nodes.find((n) => n.key === "actor-a")!;
      return (node as { transform: number[] }).transform[4];
    });
    close(xs[0], 100);
    close(xs[4], 300);
    expect(xs[1] - xs[0]).toBeLessThan(xs[2] - xs[1]); // accelerates
    expect(xs.every((x, i) => i === 0 || x >= xs[i - 1])).toBe(true);
  });

  it("is deterministic and bakes physics", () => {
    const s1 = compileScene(scene, { characters: { stick } });
    const s2 = compileScene(scene, { characters: { stick } });
    for (const t of [3.2, 0.7, 1.9]) expect(frameToSVG(evaluateScene(s1, t))).toBe(frameToSVG(evaluateScene(s2, t)));
    expect(s1.actors[0].bake?.samples.length).toBeGreaterThan(400);
  });

  it("makes the tail lag behind while walking (follow-through)", () => {
    const s = compileScene(scene, { characters: { stick } });
    evaluateScene(s, 0);
    const bake = s.actors[0].bake!;
    const max = Math.max(...bake.samples.slice(0, Math.round(2.5 * bake.rate)).map((s) => Math.abs(s.values[0][0])));
    expect(max).toBeGreaterThan(2);
    // Settles back after stopping.
    expect(Math.abs(bake.samples[bake.samples.length - 1].values[0][0])).toBeLessThan(0.5);
  });

  it("renders SVG", () => {
    const s = compileScene(scene, { characters: { stick } });
    const svg = frameToSVG(evaluateScene(s, 1.2));
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("#f0c");
    expect(svg).not.toContain("palette(");
  });

  it("reports unknown clips in scripts", () => {
    const bad = structuredClone(scene);
    bad.script!.push({ at: 1, actor: "a", action: "play", clip: "dance" });
    const r = validateScene(bad, { characters: { stick } });
    expect(r.ok).toBe(false);
    expect(r.issues[0].message).toContain('unknown clip "dance"');
  });
});

describe("physics", () => {
  it("is deterministic", () => {
    const rig = compileRig(stick);
    const run = () =>
      bakePhysics(rig, {
        duration: 1,
        poseAt: (t) => evaluatePose(rig, { time: t }),
        placementAt: (t) => fromTRS(Math.sin(t * 6) * 100, 0, 0),
      });
    expect(run()).toEqual(run());
  });
});

describe("lipsync", () => {
  it("spreads text cues over the duration", () => {
    const cues = cuesFromText("Hello, world!", { start: 1, duration: 2 });
    close(cues[0].start, 1);
    expect(cues[cues.length - 1].value).toBe("X");
    close(cues[cues.length - 1].end, 3.1, 0.01);
    for (let i = 1; i < cues.length; i++) expect(cues[i].value).not.toBe(cues[i - 1].value);
  });
});

describe("json schema", () => {
  it("exports JSON schemas", () => {
    const s = jsonSchemas();
    expect(JSON.stringify(s.toon)).toContain("skeleton");
    expect(JSON.stringify(s.scene)).toContain("script");
  });
});

describe("physics on flips", () => {
  it("restarts at rest when an actor turns instead of whipping the tail", () => {
    const doc: SceneDoc = {
      format: "toon-scene",
      version: 1,
      width: 400,
      height: 300,
      fps: 30,
      duration: 2,
      characters: { stick: "x" },
      actors: [{ id: "a", character: "stick", x: 200, y: 280 }],
      script: [{ at: 1, actor: "a", action: "face", direction: "left" }],
    };
    const s = compileScene(doc, { characters: { stick } });
    evaluateScene(s, 0);
    const bake = s.actors[0].bake!;
    const after = bake.samples.slice(Math.round(1 * bake.rate), Math.round(1.5 * bake.rate));
    const maxDelta = Math.max(...after.map((x) => Math.abs(x.values[0][0])));
    expect(maxDelta).toBeLessThan(0.5);
    // Sampling right at the turn never blends pre- and post-flip states.
    expect(bake.resets?.length).toBe(1);
    const r = bake.resets![0];
    const mid = samplePhysics(bake, (r - 0.5) / bake.rate)!;
    expect([bake.samples[r - 1], bake.samples[r]]).toContainEqual(mid);
  });
});

describe("riding (mount + reach)", () => {
  const bike = {
    format: "toon",
    version: 1,
    name: "bike",
    skeleton: [
      { id: "root" },
      { id: "frame", parent: "root", from: [0, -10], to: [60, -10] },
      { id: "crank", parent: "frame", from: [30, -60], to: [45, -60] },
    ],
    parts: [{ id: "frame", type: "rigid", bone: "frame", art: "<rect x='-40' y='-60' width='100' height='50'/>" }],
    anchors: { seat: { bone: "frame", at: [0, -20] }, pedal: { bone: "crank", at: [45, -60] } },
    clips: { drive: { duration: 1, loop: true, tracks: { "bones.crank.rotation": [[0, 0, "linear"], [1, 360]] } } },
  } as unknown as SceneDoc["characters"][string];
  const doc: SceneDoc = {
    format: "toon-scene",
    version: 1,
    width: 800,
    height: 400,
    fps: 30,
    duration: 3,
    characters: { stick: "stick", bike: "bike" },
    actors: [
      { id: "bike", character: "bike", x: 200, y: 300 },
      { id: "kid", character: "stick", x: 100, y: 300 },
    ],
    script: [
      { at: 0, actor: "bike", action: "play", clip: "drive", loop: true },
      { at: 0, actor: "bike", action: "walkTo", x: 600, duration: 2, clip: "drive", ease: "linear" },
      { at: 0.2, actor: "kid", action: "mount", on: "bike", point: [0, -40], duration: 0 },
      { at: 0.2, actor: "kid", action: "reach", chain: "hand", target: { actor: "bike", anchor: "pedal" }, duration: 0 },
      { at: 2.5, actor: "kid", action: "mount", on: null, duration: 0 },
    ],
  };
  const scene = compileScene(doc, { characters: { stick, bike: bike as never } });

  it("carries the rider on the anchor and keeps the hand on a turning pedal", () => {
    for (const t of [0.5, 0.9, 1.3]) {
      const seat = anchorPosition(scene, "bike", "seat", t);
      const kid = scene.actors.find((a) => a.id === "kid")!;
      const hip = apply(actorPlacement(kid, t), [0, -40]);
      expect(hip[0]).toBeCloseTo(seat[0], 3);
      expect(hip[1]).toBeCloseTo(seat[1], 3);
      const hand = anchorPosition(scene, "kid", "hand", t);
      const pedal = anchorPosition(scene, "bike", "pedal", t);
      expect(Math.hypot(hand[0] - pedal[0], hand[1] - pedal[1])).toBeLessThan(0.5);
    }
    // Off again: back on its own placement.
    expect(apply(actorPlacement(scene.actors[1], 2.8), [0, 0])[0]).toBeCloseTo(100, 3);
    expect(() => evaluateScene(scene, 1)).not.toThrow();
  });

  it("draws the parts listed in `behind` just under the ridden actor", () => {
    const behind = { ...doc, script: [...doc.script!.slice(0, 2), { at: 0.2, actor: "kid", action: "mount", on: "bike", point: [0, -40], duration: 0, behind: ["tail"] }] } as SceneDoc;
    const json = JSON.stringify(evaluateScene(compileScene(behind, { characters: { stick, bike: bike as never } }), 1));
    // Order: the kid's tail, then the bike, then the rest of the kid.
    const tail = json.indexOf('"actor-kid-behind"'), bikeArt = json.indexOf('"actor-bike"'), kid = json.indexOf('"actor-kid"');
    expect(tail).toBeGreaterThan(-1);
    expect(tail).toBeLessThan(bikeArt);
    expect(bikeArt).toBeLessThan(kid);
  });

  it("rejects unknown anchors and chains", () => {
    const bad = { ...doc, script: [{ at: 0, actor: "kid", action: "reach", chain: "foot", target: { actor: "bike", anchor: "pedal" } }] } as SceneDoc;
    expect(() => compileScene(bad, { characters: { stick, bike: bike as never } })).toThrow(/unknown IK chain "foot"/);
    const bad2 = { ...doc, script: [{ at: 0, actor: "kid", action: "mount", on: "bike", anchor: "saddle" }] } as SceneDoc;
    expect(() => compileScene(bad2, { characters: { stick, bike: bike as never } })).toThrow(/no anchor "saddle"/);
  });
});
