import { describe, expect, it } from "vitest";
import { type CompiledScene, type SceneDoc, type ToonDoc, type Vec2, actorPlacement, actorPose, apply, compileScene, evaluateScene, frameToSVG, parseScene } from "../src";
import { stick } from "./fixtures";

/** The stick with its arm on IK (mix 1): the shoulder at (0, −110), upper arm and forearm 40 px each. */
const reacher = { ...stick, ik: [{ id: "hand", bones: ["arm1", "arm2"], mix: 1 }] } as ToonDoc;
const SHOULDER: Vec2 = [0, -110];
/** The chain's own target (the rest tip): where a free hand goes. */
const OWN: Vec2 = [80, -110];

const sceneDoc = (animation: Record<string, unknown> | undefined, script: unknown[], character: ToonDoc = reacher): { doc: SceneDoc; character: ToonDoc } => ({
  doc: {
    format: "toon-scene",
    version: 1,
    width: 800,
    height: 400,
    fps: 24,
    duration: 4,
    characters: { stick: "stick" },
    actors: [{ id: "a", character: "stick", x: 100, y: 350 }],
    ...(animation ? { animation } : {}),
    script,
  } as unknown as SceneDoc,
  character,
});
const compile = ({ doc, character }: { doc: SceneDoc; character: ToonDoc }): CompiledScene => compileScene(doc, { characters: { stick: character } });

/** A character-space point as a scene point (the actor stands still at x 100, y 350). */
const scenePoint = (sc: CompiledScene, p: Vec2): Vec2 => apply(actorPlacement(sc.actors[0], 0), p);
/** The hand (tip of the forearm), in character space. */
const tipAt = (sc: CompiledScene, t: number): Vec2 => apply(actorPose(sc, sc.actors[0], t).world[sc.actors[0].rig.boneIndex.get("arm2")!], [40, 0]);
/**
 * The expected arc (FORMAT §3.8): the chord's lerp point pushed `arcs × 0.3 × |ab| × sin(π·u)`
 * across the chord, away from the root (a root on the chord's line: upwards, −y).
 */
function arcPoint(a: Vec2, b: Vec2, u: number, root: Vec2, arcs: number): Vec2 {
  const c: Vec2 = [b[0] - a[0], b[1] - a[1]];
  const len = Math.hypot(c[0], c[1]);
  let n: Vec2 = [-c[1] / len, c[0] / len];
  const side = (root[0] - a[0]) * n[0] + (root[1] - a[1]) * n[1];
  if (side > 1e-9 || (Math.abs(side) <= 1e-9 && n[1] > 0)) n = [-n[0], -n[1]];
  const h = arcs * 0.3 * len * Math.sin(Math.PI * u);
  return [a[0] + c[0] * u + n[0] * h, a[1] + c[1] * u + n[1] * h];
}
const near = (p: Vec2, q: Vec2, d = 0.05) => {
  expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeLessThan(d);
};

// A and B lie on a vertical chord 80 px long, 40 px in front of the shoulder: the arc bulges forwards (+x).
const A: Vec2 = [40, -150];
const B: Vec2 = [40, -70];
const reachAB = (sc0: CompiledScene) => [
  { at: 0, actor: "a", action: "reach", chain: "hand", target: scenePoint(sc0, A), duration: 0 },
  { at: 1, actor: "a", action: "reach", chain: "hand", target: scenePoint(sc0, B), duration: 0.6 },
];
const base = compile(sceneDoc(undefined, []));

describe("arcs off (default)", () => {
  it("renders reach blends exactly as before: straight", () => {
    const script = [...reachAB(base), { at: 2, actor: "a", action: "reach", chain: "hand", target: null, duration: 0.5 }];
    const before = compile(sceneDoc(undefined, script));
    const off = compile(sceneDoc({ arcs: 0 }, script));
    expect(off.animation.arcs).toBeUndefined();
    for (const t of [0, 1, 1.1, 1.3, 1.5, 1.6, 2, 2.2, 2.25, 2.4, 3]) expect(frameToSVG(evaluateScene(off, t))).toBe(frameToSVG(evaluateScene(before, t)));
    // Halfway (sineInOut at 0.5 is 0.5) the hand is on the chord's midpoint.
    near(tipAt(off, 1.3), [40, -110]);
  });

  it("validates the field", () => {
    expect(() => parseScene(sceneDoc({ arcs: 0.5 }, []).doc)).not.toThrow();
    expect(() => parseScene(sceneDoc({ arcs: 2 }, []).doc)).toThrow();
    expect(() => parseScene(sceneDoc({ arcs: -1 }, []).doc)).toThrow();
    expect(compile(sceneDoc({ arcs: 0.5 }, [])).animation.arcs).toBe(0.5);
  });
});

describe("arcs on a reach blend", () => {
  const sc = compile(sceneDoc({ arcs: 1 }, reachAB(base)));

  it("starts on A, ends on B and bulges 0.3 × |AB| away from the shoulder halfway", () => {
    near(tipAt(sc, 1), A);
    near(tipAt(sc, 1.6), B);
    near(tipAt(sc, 3), B);
    // |AB| = 80: 24 px forwards (away from the shoulder at x 0) of the midpoint (40, −110).
    near(tipAt(sc, 1.3), [64, -110]);
  });

  it("follows the arc all the way (the hand is the arc point at every u)", () => {
    const ease = (x: number) => -(Math.cos(Math.PI * x) - 1) / 2;
    for (const x of [0.1, 0.25, 0.4, 0.6, 0.75, 0.9]) near(tipAt(sc, 1 + 0.6 * x), arcPoint(A, B, ease(x), SHOULDER, 1));
  });

  it("scales with `arcs`", () => {
    const half = compile(sceneDoc({ arcs: 0.5 }, reachAB(base)));
    near(tipAt(half, 1.3), [52, -110]);
  });

  it("bulges upwards when the shoulder lies on the chord's line", () => {
    // From the shoulder's height straight out (60, −110) to (20, −110), both ways: 12 px up halfway.
    for (const [p, q] of [[[60, -110], [20, -110]], [[20, -110], [60, -110]]] as [Vec2, Vec2][]) {
      const s = compile(
        sceneDoc({ arcs: 1 }, [
          { at: 0, actor: "a", action: "reach", chain: "hand", target: scenePoint(base, p), duration: 0 },
          { at: 1, actor: "a", action: "reach", chain: "hand", target: scenePoint(base, q), duration: 0.6 },
        ]),
      );
      near(tipAt(s, 1.3), [40, -122]);
    }
  });
});

describe("a reach taken over mid-blend", () => {
  const C: Vec2 = [20, -60];
  // A → B over 0.6 s from t 1; at t 1.24 (40% of the way) a reach to C takes over.
  const takeover = (arcs: number) =>
    compile(sceneDoc({ arcs }, [...reachAB(base), { at: 1.24, actor: "a", action: "reach", chain: "hand", target: scenePoint(base, C), duration: 0.5 }]));

  for (const arcs of [0, 1]) {
    it(`starts the new blend where the hand is: no jump (arcs ${arcs})`, () => {
      const sc = takeover(arcs);
      near(tipAt(sc, 1.24), tipAt(sc, 1.24 - 1e-6), 1e-3);
      let prev = tipAt(sc, 1.1);
      for (let t = 1.1 + 1 / 96; t < 1.9; t += 1 / 96) {
        const p = tipAt(sc, t);
        expect(Math.hypot(p[0] - prev[0], p[1] - prev[1])).toBeLessThan(4);
        prev = p;
      }
      near(tipAt(sc, 1.74), C);
    });
  }

  it("takes over a blend in from the free hand at the weight it had reached", () => {
    // Free → A from t 1 over 0.6 s, taken over at 40% by a reach to B: smooth, then on B.
    for (const arcs of [0, 1]) {
      const sc = compile(
        sceneDoc({ arcs }, [
          { at: 1, actor: "a", action: "reach", chain: "hand", target: scenePoint(base, A), duration: 0.6 },
          { at: 1.24, actor: "a", action: "reach", chain: "hand", target: scenePoint(base, B), duration: 0.5 },
        ]),
      );
      near(tipAt(sc, 1.24), tipAt(sc, 1.24 - 1e-6), 1e-3);
      near(tipAt(sc, 1.74), B);
    }
  });
});

describe("blending in from and out to the free hand", () => {
  const sc = compile(
    sceneDoc({ arcs: 1 }, [
      { at: 1, actor: "a", action: "reach", chain: "hand", target: scenePoint(base, A), duration: 0.6 },
      { at: 2, actor: "a", action: "reach", chain: "hand", target: null, duration: 0.6 },
    ]),
  );
  const straight = compile(
    sceneDoc(undefined, [
      { at: 1, actor: "a", action: "reach", chain: "hand", target: scenePoint(base, A), duration: 0.6 },
      { at: 2, actor: "a", action: "reach", chain: "hand", target: null, duration: 0.6 },
    ]),
  );

  it("arcs into the reach from the chain's own target", () => {
    near(tipAt(sc, 1), OWN);
    near(tipAt(sc, 1.3), arcPoint(OWN, A, 0.5, SHOULDER, 1));
    near(tipAt(sc, 1.6), A);
    // Off: the straight chord.
    near(tipAt(straight, 1.3), [60, -130]);
  });

  it("arcs out to null too", () => {
    near(tipAt(sc, 2), A);
    const mid = tipAt(sc, 2.3);
    near(mid, arcPoint(A, OWN, 0.5, SHOULDER, 1));
    // Away from the shoulder: farther from it than the straight blend's midpoint.
    const d = (p: Vec2) => Math.hypot(p[0] - SHOULDER[0], p[1] - SHOULDER[1]);
    expect(d(mid)).toBeGreaterThan(d(tipAt(straight, 2.3)) + 10);
    near(tipAt(sc, 2.6), OWN);
    near(tipAt(sc, 3), OWN);
  });
});

describe("a target out of reach", () => {
  const FAR: Vec2 = [200, -40];
  const script = (sc0: CompiledScene) => [
    { at: 0, actor: "a", action: "reach", chain: "hand", target: scenePoint(sc0, A), duration: 0 },
    { at: 1, actor: "a", action: "reach", chain: "hand", target: scenePoint(sc0, FAR), duration: 0.6 },
  ];
  const sc = compile(sceneDoc({ arcs: 1 }, script(base)));
  const off = compile(sceneDoc(undefined, script(base)));
  /** Where a two-bone chain of 80 px reaching for `p` from the shoulder ends: clamped to its length. */
  const clamped = (p: Vec2): Vec2 => {
    const v: Vec2 = [p[0] - SHOULDER[0], p[1] - SHOULDER[1]];
    const l = Math.hypot(v[0], v[1]);
    const r = Math.min(l, 80 - 1e-4);
    return [SHOULDER[0] + (v[0] / l) * r, SHOULDER[1] + (v[1] / l) * r];
  };

  it("clamps the arc point as the IK always does", () => {
    near(tipAt(sc, 1.6), tipAt(off, 1.6), 1e-6);
    near(tipAt(sc, 1.6), clamped(FAR), 0.1);
    const target = arcPoint(A, FAR, 0.5, SHOULDER, 1);
    expect(Math.hypot(target[0] - SHOULDER[0], target[1] - SHOULDER[1])).toBeGreaterThan(80);
    near(tipAt(sc, 1.3), clamped(target), 0.1);
  });
});
