import { describe, expect, it } from "vitest";
import {
  type CompiledScene,
  type SceneDoc,
  type SequenceDoc,
  type ToonDoc,
  SolidShapeSchema,
  actorBake,
  actorPlacement,
  actorPose,
  anchorPosition,
  apply,
  cameraAt,
  compileScene,
  compileSequence,
  diagnoseFrames,
  evaluateScene,
  evaluateSequence,
  frameCount,
  frameToSVG,
  fromTRS,
  propPlacement,
  punchFactor,
  screenPoint,
  validateScene,
  viewMatrix,
} from "../src";
import { stick } from "./fixtures";

const scene = (extra: Partial<SceneDoc> = {}): SceneDoc => ({
  format: "toon-scene",
  version: 1,
  width: 800,
  height: 400,
  fps: 30,
  duration: 4,
  characters: { stick: "x" },
  actors: [{ id: "a", character: "stick", x: 100, y: 380 }],
  ...extra,
});
const compile = (doc: SceneDoc, chars: Record<string, ToonDoc> = { stick }) => compileScene(doc, { characters: chars });
const actor = (s: CompiledScene, id = "a") => s.actors.find((a) => a.id === id)!;
const placementMatrix = (p: ReturnType<typeof propPlacement>) => fromTRS(p.x, p.y, p.rotation, p.scale[0] * (p.flip ? -1 : 1), p.scale[1]);
const headRotation = (s: CompiledScene, t: number) => actorPose(s, actor(s), t).state.brot[actor(s).rig.boneIndex.get("head")!];
const arm1Rotation = (s: CompiledScene, t: number) => actorPose(s, actor(s), t).state.brot[actor(s).rig.boneIndex.get("arm1")!];
const irisCenter = (svg: string): [number, number] => {
  const m = svg.match(/<circle cx="(-?[\d.]+)" cy="(-?[\d.]+)" r="[\d.]+" fill="#000"\/>/);
  if (!m) throw new Error("no iris in the frame");
  return [Number(m[1]), Number(m[2])];
};

describe("A3: camera punch durations", () => {
  it("never builds a punch with duration 0 (a cut with a punch still settles over the default)", () => {
    const s = compile(scene({ script: [{ at: 1, action: "camera", zoom: 1.5, punch: 0.2, duration: 0 }] }));
    expect(s.punches).toHaveLength(1);
    expect(s.punches[0].duration).toBeCloseTo(0.4);
    expect(punchFactor({ start: 1, duration: 0, amount: 0.2 }, 1)).toBe(1);
    expect(frameToSVG(evaluateScene(s, 1))).not.toMatch(/NaN/);
    expect(cameraAt(s, 1 + 0.18 * 0.4).zoom).toBeGreaterThan(1.5);
  });
});

describe("A4: stepped changes at the first frame", () => {
  it("applies face, set x and set opacity at at: 0 on frame 0", () => {
    const s = compile(
      scene({
        script: [
          { at: 0, actor: "a", action: "face", direction: "left" },
          { at: 0, actor: "a", action: "set", channel: "x", value: 500 },
          { at: 0, actor: "a", action: "set", channel: "opacity", value: 0.5 },
        ],
      }),
    );
    const m = actorPlacement(actor(s), 0);
    expect(m[0]).toBeLessThan(0); // flipped
    expect(m[4]).toBe(500);
    const node = evaluateScene(s, 0).nodes.find((n) => n.key === "actor-a")!;
    expect(node.kind === "group" && node.opacity).toBe(0.5);
    expect(actorPlacement(actor(s), 1 / 30)[4]).toBe(500);
  });

  it("lets a stepped set at the time of a user track's first key win there", () => {
    const s = compile(scene({ tracks: { "actors.a.x": [[0, 100], [2, 300]] }, script: [{ at: 0, actor: "a", action: "set", channel: "x", value: 500 }] }));
    expect(actorPlacement(actor(s), 0)[4]).toBe(500);
    expect(actorPlacement(actor(s), 1)[4]).toBe(500);
  });

  it("keeps the earlier value before a later stepped set", () => {
    const s = compile(scene({ script: [{ at: 1, actor: "a", action: "set", channel: "x", value: 500 }] }));
    expect(actorPlacement(actor(s), 0.5)[4]).toBe(100);
    expect(actorPlacement(actor(s), 1)[4]).toBe(500);
  });

  it("keeps a ramp ending where a stepped set is placed (the step applies at that instant)", () => {
    const s = compile(
      scene({
        script: [
          { at: 0, actor: "a", action: "set", channel: "x", value: 300, duration: 1, ease: "linear" },
          { at: 1, actor: "a", action: "set", channel: "x", value: 500 },
        ],
      }),
    );
    expect(actorPlacement(actor(s), 0.5)[4]).toBeCloseTo(200);
    expect(actorPlacement(actor(s), 1)[4]).toBe(500);
  });
});

describe("M4: pose and walkTo take over a change under way", () => {
  it("setPose: a pose set during a transition replaces what was still planned", () => {
    const s = compile(
      scene({
        script: [
          { at: 1, actor: "a", action: "pose", control: "emotion", value: "sad", duration: 1 },
          { at: 1.5, actor: "a", action: "pose", control: "emotion", value: null, duration: 0.2 },
        ],
      }),
    );
    expect(headRotation(s, 1.5)).toBeGreaterThan(5);
    expect(Math.abs(headRotation(s, 2))).toBeLessThan(1e-6);
    expect(Math.abs(headRotation(s, 3))).toBeLessThan(1e-6);
  });

  it("setPose with duration 0 keeps the rest pose before it", () => {
    const s = compile(scene({ script: [{ at: 2, actor: "a", action: "pose", control: "emotion", value: "sad", duration: 0 }] }));
    expect(Math.abs(headRotation(s, 1))).toBeLessThan(1e-6);
    expect(headRotation(s, 2)).toBeCloseTo(20);
  });

  it("walkTo: a new walk takes over from where the actor is, with no jump", () => {
    const s = compile(
      scene({
        script: [
          { at: 0, actor: "a", action: "walkTo", x: 300, duration: 2 },
          { at: 1, actor: "a", action: "walkTo", x: 100, duration: 1 },
        ],
      }),
    );
    const x = (t: number) => actorPlacement(actor(s), t)[4];
    expect(x(2)).toBeCloseTo(100);
    expect(x(3)).toBeCloseTo(100);
    expect(Math.abs(x(1.01) - x(0.99))).toBeLessThan(10);
    expect(x(1)).toBeGreaterThan(150);
  });

  it("walkTo: an axis the new walk does not move stops where it was", () => {
    const s = compile(
      scene({
        script: [
          { at: 0, actor: "a", action: "walkTo", x: 300, y: 200, duration: 2 },
          { at: 1, actor: "a", action: "walkTo", x: 500, duration: 1 },
        ],
      }),
    );
    const y = (t: number) => actorPlacement(actor(s), t)[5];
    expect(y(1)).toBeLessThan(380);
    expect(y(1)).toBeGreaterThan(200);
    expect(y(2)).toBeCloseTo(y(1));
  });
});

describe("M2: reach with a grip direction", () => {
  const withBall = (script: SceneDoc["script"]) =>
    compile(scene({ props: [{ id: "ball", art: "<circle r='10'/>", x: 150, y: 320 }], script }));

  it("applies `from` during the blend between two reaches (no jump when the blend ends)", () => {
    const s = withBall([
      { at: 0, actor: "a", action: "reach", chain: "hand", target: [150, 250], duration: 0 },
      { at: 1, actor: "a", action: "reach", chain: "hand", target: { prop: "ball", point: [0, 0], from: 90 }, duration: 0.5 },
    ]);
    expect(Math.abs(arm1Rotation(s, 1.5) - arm1Rotation(s, 1.499))).toBeLessThan(2);
    expect(Math.abs(arm1Rotation(s, 1.6) - arm1Rotation(s, 1.5))).toBeLessThan(2);
  });

  it("turns the grip direction from one gripped reach to the next", () => {
    // From below (90) to from the front (0): the elbow changes side where the turning direction
    // crosses over, halfway through the blend — not at its end, nor at its start.
    const s = withBall([
      { at: 0, actor: "a", action: "reach", chain: "hand", target: { prop: "ball", point: [0, 0], from: 90 }, duration: 0 },
      { at: 1, actor: "a", action: "reach", chain: "hand", target: { prop: "ball", point: [0, 0], from: 0 }, duration: 1 },
    ]);
    const below = arm1Rotation(s, 0.5), front = arm1Rotation(s, 3);
    expect(Math.abs(below - front)).toBeGreaterThan(20);
    expect(arm1Rotation(s, 1.3)).toBeCloseTo(below, 3);
    expect(arm1Rotation(s, 1.7)).toBeCloseTo(front, 3);
  });
});

describe("M3: physics bake of a ridden actor", () => {
  // A looks at its rider with its body (the tail hangs off the body, so the look changes the bake).
  const doc = structuredClone(stick);
  doc.controls!.look = { type: "aim", targets: [{ bone: "body", forward: -90, maxAngle: 40 }] };
  const ride = (): SceneDoc =>
    scene({
      actors: [
        { id: "a", character: "stick", x: 300, y: 380 },
        { id: "b", character: "stick", x: 100, y: 380 },
      ],
      script: [
        { at: 0, actor: "b", action: "mount", on: "a", anchor: "hand", point: [0, 0], duration: 0 },
        { at: 0, actor: "a", action: "lookAt", target: "b" },
        { at: 0.5, actor: "a", action: "set", channel: "bones.arm1.rotation", value: -60, duration: 0.5 },
      ],
    });

  it("gives the same frame whichever API was called first", () => {
    const direct = frameToSVG(evaluateScene(compile(ride(), { stick: doc }), 1));
    const viaAnchor = compile(ride(), { stick: doc });
    anchorPosition(viaAnchor, "a", "head", 1);
    expect(frameToSVG(evaluateScene(viaAnchor, 1))).toBe(direct);
    const viaBake = compile(ride(), { stick: doc });
    actorBake(viaBake, actor(viaBake));
    expect(frameToSVG(evaluateScene(viaBake, 1))).toBe(direct);
    const viaRider = compile(ride(), { stick: doc });
    actorPlacement(actor(viaRider, "b"), 1);
    expect(frameToSVG(evaluateScene(viaRider, 1))).toBe(direct);
  });

  it("bakes with the look resolved (the same as a frame at rest)", () => {
    const s = compile(ride(), { stick: doc });
    const bake = actorBake(s, actor(s))!;
    expect(bake.samples.length).toBeGreaterThan(0);
    // The look turns the body: the bake is not the one of an actor that never looks.
    const plain = ride();
    plain.script = plain.script!.filter((a) => a.action !== "lookAt");
    const p = compile(plain, { stick: doc });
    expect(frameToSVG(evaluateScene(s, 1))).not.toBe(frameToSVG(evaluateScene(p, 1)));
  });
});

describe("M6 / M7: shading rim colour and key light id", () => {
  const lit: SceneDoc["lighting"] = {
    lights: [
      { id: "fill", type: "point", x: 0, y: 0, radius: 2000, glow: 0 },
      { id: "key", type: "directional", angle: 45 },
    ],
    shading: { light: "key", opacity: 0.3, rim: "#123456", rimOpacity: 0.5 },
  };

  it("paints the rim light in shading.rim", () => {
    const svg = frameToSVG(evaluateScene(compile(scene({ lighting: lit })), 0));
    expect(svg).toMatch(/fill="#123456" opacity="[\d.]+" mask="url\(#rim-a\)"/);
  });

  it("rejects an unknown shading.light with the known ids", () => {
    const bad = scene({ lighting: { ...lit, shading: { ...lit!.shading, light: "nope" } } });
    const r = validateScene(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues[0].path).toBe("lighting.shading.light");
      expect(r.issues[0].message).toMatch(/"nope"/);
      expect(r.issues[0].message).toMatch(/fill, key/);
    }
    expect(() => compile(bad)).toThrow(/"nope"/);
    expect(validateScene(scene({ lighting: lit })).ok).toBe(true);
  });
});

describe("M8 / B3: sequence transition targets", () => {
  const sceneA = scene({ duration: 2, actors: [{ id: "a", character: "stick", x: 400, y: 380 }, { id: "c", character: "stick", x: 650, y: 380 }] });
  const sceneB = scene({ duration: 4, tracks: { "actors.a.x": [[0, 100], [2, 700, "linear"]] } });
  const seq = (shot2: Partial<SequenceDoc["shots"][number]>): SequenceDoc => ({
    format: "toon-sequence",
    version: 1,
    width: 800,
    height: 400,
    fps: 30,
    scenes: { a: "a", b: "b" },
    shots: [{ scene: "a" }, { scene: "b", ...shot2 }],
  });
  const assets = { scenes: { a: { doc: sceneA, assets: { characters: { stick } } }, b: { doc: sceneB, assets: { characters: { stick } } } } };

  it("samples the iris target at the shot's own scene time (speed and clamp like the picture)", () => {
    const s = compileSequence(seq({ speed: 2, duration: 1, transition: { type: "iris", duration: 1, target: "a" } }), assets);
    const b = s.shots[1];
    // 0.2 s into the shot at speed 2: scene time 0.4.
    const svg = frameToSVG(evaluateSequence(s, b.start + 0.2));
    expect(irisCenter(svg)[0]).toBeCloseTo(screenPoint(b.scene, "a", 0.4)[0], 3);
    expect(irisCenter(svg)[0]).not.toBeCloseTo(screenPoint(b.scene, "a", 0.2)[0], 0);
  });

  it("closes the iris on where the target will be when the next shot opens", () => {
    const s = compileSequence(seq({ from: 1, transition: { type: "iris", duration: 1, target: "a" } }), assets);
    const [first, second] = s.shots;
    // The out half of the transition: the target lives in the incoming scene, at its start time.
    const svg = frameToSVG(evaluateSequence(s, first.end - 0.2));
    expect(irisCenter(svg)[0]).toBeCloseTo(screenPoint(second.scene, "a", 1)[0], 3);
    // The in half opens on the same point (continuous), then follows the actor.
    expect(irisCenter(frameToSVG(evaluateSequence(s, second.start + 0.001)))[0]).toBeCloseTo(screenPoint(second.scene, "a", 1.001)[0], 1);
  });

  it("falls back to the outgoing scene when the incoming one has no such id", () => {
    const s = compileSequence(seq({ transition: { type: "iris", duration: 1, target: "c" } }), assets);
    const [first] = s.shots;
    const svg = frameToSVG(evaluateSequence(s, first.end - 0.2));
    expect(irisCenter(svg)[0]).toBeCloseTo(screenPoint(first.scene, "c", first.end - 0.2)[0], 3);
  });
});

describe("B4: screen-fixed items and the dolly", () => {
  it("does not scale parallax 0 items with dolly", () => {
    const s = compile(scene({ camera: { dolly: 0.8 } }));
    const cam = cameraAt(s, 0);
    expect(viewMatrix(s, cam, 0)[0]).toBeCloseTo(1);
    expect(viewMatrix(s, cam, 1)[0]).toBeCloseTo(1);
    expect(viewMatrix(s, cam, 0.5)[0]).toBeLessThan(1);
  });
});

describe("B5: fx placement", () => {
  it("rejects an unknown prop like an unknown actor", () => {
    expect(() => compile(scene({ script: [{ at: 0, action: "fx", type: "sparkle", prop: "nope" }] }))).toThrow(/unknown prop "nope"/);
    expect(() => compile(scene({ script: [{ at: 0, action: "fx", type: "sparkle", actor: "nope" }] }))).toThrow(/unknown actor "nope"/);
  });

  it("gives a point with only x its default y (and x: 0, y: 0 is a point)", () => {
    const s = compile(
      scene({
        script: [
          { at: 0, action: "fx", type: "caption", text: "WOW", style: "impact", x: 100 },
          { at: 0, action: "fx", type: "sparkle", x: 100 },
          { at: 0, action: "fx", type: "caption", text: "WOW", style: "impact", x: 0, y: 0 },
          { at: 0, action: "fx", type: "caption", text: "WOW", style: "impact" },
        ],
      }),
    );
    expect([s.fx[0].x, s.fx[0].y]).toEqual([100, 200]);
    expect([s.fx[1].x, s.fx[1].y]).toEqual([100, 200]);
    expect([s.fx[2].x, s.fx[2].y]).toEqual([0, 0]);
    expect([s.fx[3].x, s.fx[3].y]).toEqual([400, 200]);
    const nodes = evaluateScene(s, 0.1).nodes.filter((n) => n.key.startsWith("fx-"));
    const at = (n: (typeof nodes)[number]) => ("transform" in n && n.transform ? [n.transform[4], n.transform[5]] : undefined);
    expect(at(nodes[2])).toEqual([0, 0]);
    expect(at(nodes[0])).toEqual([100, 200]);
  });
});

describe("B6: layer draw order", () => {
  it("draws layers at z 0 by default: behind actors and props at z 0, in front of negative z", () => {
    const s = compile(
      scene({
        layers: [{ id: "bg", art: "<rect width='10' height='10'/>" }],
        actors: [
          { id: "a", character: "stick", x: 100, y: 380 },
          { id: "deep", character: "stick", x: 300, y: 380, z: -5 },
        ],
      }),
    );
    const keys = evaluateScene(s, 0).nodes.map((n) => n.key);
    expect(keys.indexOf("layer-bg")).toBeLessThan(keys.indexOf("actor-a"));
    expect(keys.indexOf("layer-bg")).toBeGreaterThan(keys.indexOf("actor-deep"));
  });
});

describe("B7 / B42: held props", () => {
  type PropDef = NonNullable<SceneDoc["props"]>[number];
  // Props flip through their `flip` track (the document has no flip field for them).
  const withProp = (prop: Partial<PropDef>, script: SceneDoc["script"], flip = false, chars = { stick }) =>
    compile(scene({ props: [{ id: "phone", art: "<rect width='60' height='20'/>", x: 0, y: 0, ...prop }], script, ...(flip ? { tracks: { "props.phone.flip": [[0, true]] } } : {}) }), chars);

  it("places a flipped fitted prop on its anchor", () => {
    for (const flip of [false, true]) {
      const s = withProp({ scale: [1.5, 1] }, [{ at: 0, actor: "a", action: "grab", prop: "phone", anchor: "hand", fit: [{ point: [30, 5], anchor: "hand" }] }], flip);
      const p = propPlacement(s, s.props[0], 1);
      const on = apply(placementMatrix(p), [30, 5]);
      const hand = anchorPosition(s, "a", "hand", 1);
      expect(on[0]).toBeCloseTo(hand[0], 6);
      expect(on[1]).toBeCloseTo(hand[1], 6);
    }
  });

  it("turns a flipped prop fitted by two points so its second point aims at the second anchor", () => {
    for (const flip of [false, true]) {
      const s = withProp({}, [{ at: 0, actor: "a", action: "grab", prop: "phone", anchor: "hand", fit: [{ point: [30, 5], anchor: "hand" }, { point: [60, 5], anchor: "head" }] }], flip);
      const p = propPlacement(s, s.props[0], 1);
      const m = placementMatrix(p);
      const [a, b] = [apply(m, [30, 5]), apply(m, [60, 5])];
      const hand = anchorPosition(s, "a", "hand", 1), head = anchorPosition(s, "a", "head", 1);
      expect(a[0]).toBeCloseTo(hand[0], 6);
      expect(a[1]).toBeCloseTo(hand[1], 6);
      const want = Math.atan2(head[1] - hand[1], head[0] - hand[0]), got = Math.atan2(b[1] - a[1], b[0] - a[0]);
      expect(Math.abs(Math.atan2(Math.sin(got - want), Math.cos(got - want)))).toBeLessThan(1e-6);
    }
  });

  it("keeps the grab placement (turn with the hand) while held even when a rigid sample exists", () => {
    const doc = structuredClone(stick);
    doc.anchors!.hand = { bone: "arm2", at: [80, -110], turn: 1 };
    const s = withProp({ rotation: 10, body: { type: "dynamic", shape: { circle: 10 } } }, [
      { at: 0, actor: "a", action: "set", channel: "bones.arm1.rotation", value: 45 },
      { at: 1, actor: "a", action: "grab", prop: "phone", anchor: "hand" },
    ], false, { stick: doc });
    s.rigid = { sample: () => ({ x: 7, y: 8, rotation: 33 }) };
    // Not held yet: the rigid body's sample.
    expect(propPlacement(s, s.props[0], 0.5)).toMatchObject({ x: 7, y: 8, rotation: 33 });
    // Held: in the hand, turned with it.
    const held = propPlacement(s, s.props[0], 2);
    const hand = anchorPosition(s, "a", "hand", 2);
    expect(held.x).toBeCloseTo(hand[0]);
    expect(held.y).toBeCloseTo(hand[1]);
    expect(held.rotation).toBeCloseTo(10 + 45);
  });
});

describe("B8: posed anchors for screen points", () => {
  it("screenPoint and the iris centre use the posed head anchor", () => {
    const s = compile(
      scene({
        script: [
          { at: 0, actor: "a", action: "set", channel: "bones.body.rotation", value: 60 },
          { at: 0, action: "transition", type: "iris", duration: 2, mode: "out", target: "a" },
        ],
      }),
    );
    const cam = cameraAt(s, 1);
    const posed = apply(viewMatrix(s, cam, 1), anchorPosition(s, "a", "head", 1));
    const rest = apply(viewMatrix(s, cam, 1), apply(actorPlacement(actor(s), 1), actor(s).rig.anchors.head.at));
    expect(Math.hypot(posed[0] - rest[0], posed[1] - rest[1])).toBeGreaterThan(20);
    const sp = screenPoint(s, "a", 1);
    expect(sp[0]).toBeCloseTo(posed[0]);
    expect(sp[1]).toBeCloseTo(posed[1]);
    const c = irisCenter(frameToSVG(evaluateScene(s, 1)));
    expect(c[0]).toBeCloseTo(posed[0], 1);
    expect(c[1]).toBeCloseTo(posed[1], 1);
  });
});

describe("B15: zero blur axis diagnostic", () => {
  const frame = (std: string) => ({ width: 10, height: 10, defs: "", nodes: [{ kind: "markup" as const, key: "k", markup: `<filter id="f"><feGaussianBlur stdDeviation="${std}"/></filter>` }] });
  const zero = (std: string) => diagnoseFrames([frame(std)], [0]).filter((d) => d.kind === "zero-blur-axis").length;

  it("flags a whole token 0, not a digit inside another number", () => {
    expect(zero("0")).toBe(1);
    expect(zero("2 0")).toBe(1);
    expect(zero("0 2")).toBe(1);
    expect(zero("0.0")).toBe(1);
    expect(zero("2,0")).toBe(1);
    expect(zero("2.0")).toBe(0);
    expect(zero("0.5")).toBe(0);
    expect(zero("10")).toBe(0);
    expect(zero("2.0 1.0")).toBe(0);
  });
});

describe("B16: solid shapes", () => {
  it("is one of a cone, a sphere, a box or an ellipsoid", () => {
    const ok = (shape: unknown) => SolidShapeSchema.safeParse(shape).success;
    expect(ok({ from: { bone: "a" }, to: { bone: "a", t: 1 }, r: 3 })).toBe(true);
    expect(ok({ from: { bone: "a" }, r: 3 })).toBe(true);
    expect(ok({ from: { bone: "a" }, box: [1, 2, 3], round: 1 })).toBe(true);
    expect(ok({ from: { bone: "a" }, ellipsoid: [1, 2, 3] })).toBe(true);
    const bad = SolidShapeSchema.safeParse({ from: { bone: "a" }, to: { bone: "a", t: 1 }, r: 3, box: [1, 2, 3] });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0].message).toMatch(/one of/);
    expect(ok({ from: { bone: "a" }, box: [1, 2, 3], ellipsoid: [1, 2, 3] })).toBe(false);
    expect(ok({ from: { bone: "a" }, ellipsoid: [1, 2, 3], round: 2 })).toBe(false);
  });
});

describe("B38: frame count", () => {
  it("does not add a frame for floating point noise", () => {
    expect(frameCount({ duration: 2.2, fps: 25 } as CompiledScene)).toBe(55);
    expect(frameCount({ duration: 2.21, fps: 25 } as CompiledScene)).toBe(56);
    expect(frameCount({ duration: 1, fps: 30 } as CompiledScene)).toBe(30);
  });
});
