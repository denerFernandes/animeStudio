import { describe, expect, it } from "vitest";
import {
  type CompiledScene,
  type SceneDoc,
  actorBake,
  actorPlacement,
  actorPose,
  cameraAt,
  compileScene,
  diagnoseFrames,
  drawingTime,
  evaluateScene,
  frameToSVG,
  parseScene,
  propPlacement,
} from "../src";
import { stick } from "./fixtures";

const FPS = 24;

/** A walking actor holding a cup, a second walker, a camera move: the cartoon timing comes from `extra`. */
const sceneDoc = (extra: Partial<SceneDoc> = {}, second: Record<string, unknown> = {}): SceneDoc =>
  ({
    format: "toon-scene",
    version: 1,
    width: 800,
    height: 400,
    fps: FPS,
    duration: 3,
    characters: { stick: "stick" },
    actors: [
      { id: "a", character: "stick", x: 100, y: 350 },
      { id: "b", character: "stick", x: 100, y: 300, ...second },
    ],
    props: [{ id: "cup", art: "<rect width='10' height='10'/>", x: 300, y: 350 }],
    script: [
      { at: 0, actor: "a", action: "grab", prop: "cup", anchor: "hand" },
      { at: 0, actor: "a", action: "walkTo", x: 700, duration: 3 },
      { at: 0, actor: "b", action: "walkTo", x: 600, duration: 3 },
      { at: 0, action: "camera", x: 600, duration: 3, ease: "linear" },
    ],
    ...extra,
  }) as unknown as SceneDoc;

const compile = (doc: SceneDoc): CompiledScene => compileScene(doc, { characters: { stick } });
const at = (f: number) => f / FPS;
const actor = (sc: CompiledScene, id: string) => sc.actors.find((a) => a.id === id)!;
const placement = (sc: CompiledScene, id: string, f: number) => actorPlacement(actor(sc, id), at(f));
const pose = (sc: CompiledScene, id: string, f: number) => actorPose(sc, actor(sc, id), at(f)).world;
const cup = (sc: CompiledScene, f: number) => propPlacement(sc, sc.props[0], at(f));

describe("cartoon timing off (default)", () => {
  it("leaves frames as they were: drawings are the frames, a walker moves every frame", () => {
    const sc = compile(sceneDoc());
    expect(sc.animation).toEqual({ twos: 1, holds: 0 });
    expect(sc.actors.map((a) => a.twos)).toEqual([1, 1]);
    for (const t of [0, 0.01, at(7), 1.234, 2.99]) expect(drawingTime(sc, sc.actors[0], t)).toBe(t);
    for (let f = 10; f < 20; f++) expect(placement(sc, "a", f + 1)[4]).not.toBe(placement(sc, "a", f)[4]);
    // Spelled out on ones and without holds, the scene renders byte for byte the same.
    const ones = compile(sceneDoc({ animation: { twos: 1, holds: 0 } }, { twos: false }));
    for (const f of [0, 13, 40, 71]) expect(frameToSVG(evaluateScene(ones, at(f)))).toBe(frameToSVG(evaluateScene(sc, at(f))));
  });
});

describe("on twos", () => {
  const sc = compile(sceneDoc({ animation: { twos: true } }));
  const smooth = compile(sceneDoc());

  it("holds each drawing for two frames: pose and placement change every other frame", () => {
    expect(sc.actors[0].twos).toBe(2);
    for (let k = 3; k < 30; k++) {
      expect(placement(sc, "a", 2 * k + 1)).toEqual(placement(sc, "a", 2 * k));
      expect(pose(sc, "a", 2 * k + 1)).toEqual(pose(sc, "a", 2 * k));
      expect(placement(sc, "a", 2 * k + 2)[4]).not.toBe(placement(sc, "a", 2 * k)[4]);
      expect(pose(sc, "a", 2 * k + 2)).not.toEqual(pose(sc, "a", 2 * k));
    }
  });

  it("shows the smooth animation's frame of each drawing, physics included (the bake is unchanged)", () => {
    expect(actorBake(sc, actor(sc, "a"))).toEqual(actorBake(smooth, actor(smooth, "a")));
    for (const k of [4, 11, 25]) {
      expect(placement(sc, "a", 2 * k + 1)).toEqual(placement(smooth, "a", 2 * k));
      expect(pose(sc, "a", 2 * k + 1)).toEqual(pose(smooth, "a", 2 * k));
    }
  });

  it("keeps the camera smooth", () => {
    for (let f = 10; f < 20; f++) expect(cameraAt(sc, at(f + 1)).x).not.toBe(cameraAt(sc, at(f)).x);
  });

  it("carries a held prop with its holder's drawing", () => {
    for (const k of [5, 12, 20]) {
      expect(cup(sc, 2 * k + 1)).toEqual(cup(sc, 2 * k));
      expect(cup(sc, 2 * k + 2).x).not.toBe(cup(sc, 2 * k).x);
    }
  });

  it("keeps an actor with `twos: false` smooth", () => {
    const mixed = compile(sceneDoc({ animation: { twos: true } }, { twos: false }));
    expect(mixed.actors.map((a) => a.twos)).toEqual([2, 1]);
    for (let f = 10; f < 20; f++) expect(placement(mixed, "b", f + 1)[4]).not.toBe(placement(mixed, "b", f)[4]);
    expect(placement(mixed, "a", 21)).toEqual(placement(mixed, "a", 20));
  });

  it("validates the fields", () => {
    expect(() => parseScene(sceneDoc({ animation: { twos: 2, holds: 0.5 } }, { twos: 3 }))).not.toThrow();
    expect(() => parseScene(sceneDoc({ animation: { twos: 5 } } as unknown as Partial<SceneDoc>))).toThrow();
    expect(() => parseScene(sceneDoc({ animation: { holds: 2 } }))).toThrow();
  });
});

describe("on threes", () => {
  it("steps every three frames", () => {
    const sc = compile(sceneDoc({ animation: { twos: 3 } }));
    for (let k = 2; k < 20; k++) {
      expect(placement(sc, "a", 3 * k + 1)).toEqual(placement(sc, "a", 3 * k));
      expect(placement(sc, "a", 3 * k + 2)).toEqual(placement(sc, "a", 3 * k));
      expect(pose(sc, "a", 3 * k + 2)).toEqual(pose(sc, "a", 3 * k));
      expect(placement(sc, "a", 3 * k + 3)[4]).not.toBe(placement(sc, "a", 3 * k)[4]);
    }
  });
});

describe("moving holds", () => {
  // Standing still: any movement is the hold's drift.
  const still = (holds?: number): SceneDoc =>
    ({
      format: "toon-scene", version: 1, width: 800, height: 400, fps: FPS, duration: 6,
      characters: { stick: "stick" },
      actors: [{ id: "a", character: "stick", x: 300, y: 350, rotation: 5 }],
      ...(holds !== undefined ? { animation: { holds } } : {}),
    }) as unknown as SceneDoc;
  const state = (sc: CompiledScene, t: number) => {
    const m = actorPlacement(sc.actors[0], t);
    return { x: m[4], y: m[5], rotation: (Math.atan2(m[1], m[0]) * 180) / Math.PI };
  };
  const times = Array.from({ length: 144 }, (_, i) => i / FPS);

  it("an actor's own `holds` overrides the scene's (0: a wall clock keeps perfectly still)", () => {
    const doc = still(1);
    (doc.actors![0] as { holds?: number }).holds = 0;
    const sc = compile(doc);
    for (const t of times) {
      const s = state(sc, t);
      expect(s.x).toBeCloseTo(300, 9);
      expect(s.y).toBeCloseTo(350, 9);
      expect(s.rotation).toBeCloseTo(5, 9);
    }
  });

  it("drifts within the stated amplitudes, never standing quite still", () => {
    const sc = compile(still(1));
    let moved = 0;
    for (const t of times) {
      const s = state(sc, t);
      expect(Math.abs(s.x - 300)).toBeLessThanOrEqual(1.2 + 1e-9);
      expect(Math.abs(s.y - 350)).toBeLessThanOrEqual(0.8 + 1e-9);
      expect(Math.abs(s.rotation - 5)).toBeLessThanOrEqual(0.35 + 1e-9);
      moved = Math.max(moved, Math.abs(s.x - 300));
    }
    expect(moved).toBeGreaterThan(0.2);
    expect(state(sc, 1)).not.toEqual(state(sc, 1 + 1 / FPS));
  });

  it("is deterministic and scales with `holds`", () => {
    const a = compile(still(1));
    const b = compile(still(1));
    const half = compile(still(0.5));
    for (const t of [0.3, 2.2, 4.75]) {
      expect(state(b, t)).toEqual(state(a, t));
      expect(state(half, t).x - 300).toBeCloseTo((state(a, t).x - 300) / 2, 9);
    }
  });

  it("is nothing at `holds` 0", () => {
    const none = compile(still(0));
    const unset = compile(still());
    for (const t of times) {
      expect(state(none, t)).toEqual(state(unset, t));
      expect(state(none, t).x).toBe(300);
    }
  });

  it("steps with the drawings on twos", () => {
    const sc = compileScene({ ...still(1), animation: { holds: 1, twos: true } } as SceneDoc, { characters: { stick } });
    expect(state(sc, at(21))).toEqual(state(sc, at(20)));
    expect(state(sc, at(22))).not.toEqual(state(sc, at(20)));
  });
});

describe("diagnostics on twos", () => {
  const frames = (doc: SceneDoc) => {
    const sc = compile(doc);
    const n = Math.round(sc.duration * sc.fps);
    const times = Array.from({ length: n }, (_, i) => at(i));
    return diagnoseFrames(times.map((t) => evaluateScene(sc, t)), times);
  };
  const jumps = (doc: SceneDoc) => frames(doc).filter((d) => d.kind === "jump");
  // A dash: 100 px a frame (fine on ones), 200 px a drawing on twos.
  const dash = (animation: SceneDoc["animation"], extra: Record<string, unknown>[] = []): SceneDoc =>
    ({
      format: "toon-scene", version: 1, width: 3000, height: 400, fps: FPS, duration: 2,
      characters: { stick: "stick" },
      camera: { x: 1500, y: 200 },
      ...(animation ? { animation } : {}),
      actors: [{ id: "a", character: "stick", x: 100, y: 350 }],
      script: [{ at: 0.25, actor: "a", action: "set", channel: "x", value: 2500, duration: 1, ease: "linear" }, ...extra],
    }) as unknown as SceneDoc;

  it("reports no jump for a walk on twos", () => {
    expect(jumps(sceneDoc({ animation: { twos: true } }))).toEqual([]);
  });

  it("compares drawings, not frames, for actors on twos and threes", () => {
    expect(jumps(dash(undefined))).toEqual([]);
    expect(jumps(dash({ twos: true }))).toEqual([]);
    expect(jumps(dash({ twos: 3 }))).toEqual([]);
  });

  it("still reports a real pop on twos", () => {
    const pop = jumps(dash({ twos: true }, [{ at: 1.75, actor: "a", action: "set", channel: "x", value: 100 }]));
    expect(pop.map((d) => d.key)).toContain("actor-a");
  });
});
