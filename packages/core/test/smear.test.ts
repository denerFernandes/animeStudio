import { describe, expect, it } from "vitest";
import {
  type CompiledScene,
  type Mat,
  type RenderNode,
  type SceneDoc,
  type ToonDoc,
  actorPlacement,
  actorPose,
  apply,
  applyLinear,
  compileScene,
  evaluateScene,
  frameToSVG,
  invert,
  multiply,
  parseScene,
} from "../src";
import { stick } from "./fixtures";

const FPS = 24;
const at = (f: number) => f / FPS;

/** The stick with a fist on its forearm and a fast arm swing: `arm1` turns 180° in 0.2 s. */
const swinger: ToonDoc = {
  ...stick,
  parts: [...stick.parts, { id: "fist", type: "rigid", bone: "arm2", art: "mouthD" }],
  clips: { ...stick.clips, swing: { duration: 0.2, tracks: { "bones.arm1.rotation": [[0, 0], [0.2, 180]] } } },
} as ToonDoc;

/** A one-actor scene (`a` at x 100); the cartoon timing comes from `animation`. */
const sceneDoc = (animation: Record<string, unknown> | undefined, extra: Partial<SceneDoc> = {}): SceneDoc =>
  ({
    format: "toon-scene",
    version: 1,
    width: 800,
    height: 400,
    fps: FPS,
    duration: 3,
    characters: { stick: "stick" },
    actors: [{ id: "a", character: "stick", x: 100, y: 350 }],
    ...(animation ? { animation } : {}),
    ...extra,
  }) as unknown as SceneDoc;

const compile = (doc: SceneDoc): CompiledScene => compileScene(doc, { characters: { stick: swinger } });
const svg = (sc: CompiledScene, f: number) => frameToSVG(evaluateScene(sc, at(f)));

/** The node with this key, anywhere in a frame. */
function find(nodes: RenderNode[], key: string): RenderNode | undefined {
  for (const n of nodes) {
    if (n.key === key) return n;
    if (n.kind === "group") {
      const hit = find(n.children, key);
      if (hit) return hit;
    }
  }
  return undefined;
}
const transformOf = (sc: CompiledScene, f: number, key: string): Mat => {
  const n = find(evaluateScene(sc, at(f)).nodes, key);
  if (!n || n.kind === "path" || !n.transform) throw new Error(`no transformed node "${key}"`);
  return n.transform;
};
/** The extra transform `with` carries over `without` (with = S · without). */
const ratio = (withM: Mat, withoutM: Mat): Mat => multiply(withM, invert(withoutM));
const stretch = (m: Mat, v: [number, number]) => Math.hypot(...applyLinear(m, v));
const expectMat = (a: Mat, b: Mat, digits = 6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

/** Body stretch for a move of `dx` px per drawing of the 160 px stick (smear 1): from 0.15 to 0.6 of its height. */
const bodyF = (dx: number, tall = 160) => 1 + 0.9 * Math.min(1, Math.max(0, (dx / tall - 0.15) / 0.45));
const walk = (x: number, duration: number) => ({ script: [{ at: 0, actor: "a", action: "walkTo", x, duration }] }) as Partial<SceneDoc>;
const swing = (props: unknown[] = [], grab = false) =>
  ({
    props,
    script: [
      ...(grab ? [{ at: 0, actor: "a", action: "grab", prop: "cup", anchor: "hand" }] : []),
      { at: 0.5, actor: "a", action: "play", clip: "swing", fadeIn: 0, fadeOut: 0.2 },
    ],
  }) as unknown as Partial<SceneDoc>;

describe("smears off (default)", () => {
  it("renders a moving scene exactly as before", () => {
    const moving = {
      props: [{ id: "cup", art: "<rect width='10' height='10'/>", x: 300, y: 350 }],
      tracks: { "props.cup.x": [[0, 0], [1, 800, "linear"]] },
      script: [
        { at: 0, actor: "a", action: "walkTo", x: 700, duration: 1 },
        { at: 0.5, actor: "a", action: "play", clip: "swing", fadeIn: 0 },
        { at: 0, action: "camera", x: 600, duration: 2, ease: "linear" },
      ],
    } as unknown as Partial<SceneDoc>;
    const before = compile(sceneDoc(undefined, moving));
    const off = compile(sceneDoc({ smear: 0 }, moving));
    expect(off.animation.smear).toBeUndefined();
    for (const f of [0, 1, 7, 13, 14, 30]) expect(svg(off, f)).toBe(svg(before, f));
  });

  it("validates the field", () => {
    expect(() => parseScene(sceneDoc({ smear: 0.5 }))).not.toThrow();
    expect(() => parseScene(sceneDoc({ smear: 2 }))).toThrow();
    expect(() => parseScene(sceneDoc({ smear: -1 }))).toThrow();
    expect(compile(sceneDoc({ smear: 0.5 })).animation.smear).toBe(0.5);
  });
});

describe("whole-body smear", () => {
  // A dash: 600 px in 0.6 s (over 6 heights a second).
  const plain = compile(sceneDoc(undefined, walk(700, 0.6)));
  const smeared = compile(sceneDoc({ smear: 1 }, walk(700, 0.6)));
  const F = 7;

  it("stretches a fast walker along its move and thins it across", () => {
    const mS = transformOf(smeared, F, "actor-a");
    const mP = transformOf(plain, F, "actor-a");
    const S = ratio(mS, mP);
    const dx = actorPlacement(smeared.actors[0], at(F))[4] - actorPlacement(smeared.actors[0], at(F - 1))[4];
    expect(dx).toBeGreaterThan(30);
    const f = bodyF(dx);
    expect(f).toBeGreaterThan(1.2);
    // (The posed height swings a little with the walk around the stick's 160 px.)
    expect(stretch(S, [1, 0])).toBeCloseTo(f, 2);
    expect(stretch(S, [0, 1])).toBeCloseTo(1 / Math.sqrt(stretch(S, [1, 0])), 6);
    expect(stretch(S, [1, 0])).toBeGreaterThan(stretch(S, [0, 1]));
  });

  it("keeps its leading point in place: the front stays, the back trails over the path", () => {
    const mS = transformOf(smeared, F, "actor-a");
    const mP = transformOf(plain, F, "actor-a");
    // Leading point: the origin plus a quarter of the stick's height (160 px) along the move.
    const origin = apply(mP, [0, 0]);
    const lead: [number, number] = [origin[0] + 40, origin[1]];
    const art = apply(invert(mP), lead);
    const moved = apply(mS, art);
    expect(Math.hypot(moved[0] - lead[0], moved[1] - lead[1])).toBeLessThan(1);
    // The origin (behind the leading point) is pulled back along the path.
    expect(apply(mS, [0, 0])[0]).toBeLessThan(origin[0] - 5);
  });

  it("leaves a walk alone, even in a close-up following it (measured against the actor's size, not in screen px)", () => {
    const follow = { script: [{ at: 0, actor: "a", action: "walkTo", x: 260, duration: 1 }, { at: 0, action: "camera", zoom: 4, x: 260, duration: 1, ease: "linear" }] } as unknown as Partial<SceneDoc>;
    const closePlain = compile(sceneDoc(undefined, follow));
    const close = compile(sceneDoc({ smear: 1 }, follow));
    for (const f of [6, 12, 18]) expect(svg(close, f)).toBe(svg(closePlain, f));
  });

  it("leaves a slow move alone", () => {
    const slowPlain = compile(sceneDoc(undefined, walk(160, 2)));
    const slow = compile(sceneDoc({ smear: 1 }, walk(160, 2)));
    for (const f of [0, 5, 24, 40]) expect(svg(slow, f)).toBe(svg(slowPlain, f));
  });

  it("is not made by the camera panning over a still actor", () => {
    const pan = { script: [{ at: 0, action: "camera", x: 900, duration: 1, ease: "linear" }] } as unknown as Partial<SceneDoc>;
    const panPlain = compile(sceneDoc(undefined, pan));
    const panSmear = compile(sceneDoc({ smear: 1 }, pan));
    for (const f of [3, 12, 20]) expect(svg(panSmear, f)).toBe(svg(panPlain, f));
  });
});

/** Keys of the ghosts of a part (`<prefix>g<k>-<part>`) in a frame, in draw order. */
function ghostsOf(nodes: RenderNode[], part: string, prefix = "a-"): RenderNode[] {
  const out: RenderNode[] = [];
  const walk = (ns: RenderNode[]) => {
    for (const n of ns) {
      if (new RegExp(`^${prefix}g\\d-${part}$`).test(n.key)) out.push(n);
      if (n.kind === "group") walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/** Normalised speed of a part's fastest bone (joint or tip, against its length) between two frames, on ones, unscaled actor. */
function partSpeed(sc: CompiledScene, bones: string[], f: number, prev = f - 1): number {
  const a = sc.actors[0];
  const now = actorPose(sc, a, at(f)).world, before = actorPose(sc, a, at(prev)).world;
  let q = 0;
  for (const id of bones) {
    const b = a.rig.bones.find((x) => x.id === id)!;
    const j = Math.hypot(now[b.index][4] - before[b.index][4], now[b.index][5] - before[b.index][5]);
    const tip = apply(now[b.index], [b.length, 0]), tipP = apply(before[b.index], [b.length, 0]);
    const len = Math.hypot(tip[0] - now[b.index][4], tip[1] - now[b.index][5]);
    // Against the bone's own length: from 0.3 to 1 of it per drawing.
    q = Math.max(q, Math.min(1, Math.max(0, (Math.max(j, Math.hypot(tip[0] - tipP[0], tip[1] - tipP[1])) / len - 0.3) / 0.7)));
  }
  return q;
}

const angle = (m: Mat) => (Math.atan2(m[1], m[0]) * 180) / Math.PI;
const between = (x: number, a: number, b: number) => x > Math.min(a, b) + 1e-6 && x < Math.max(a, b) - 1e-6;

describe("limb smears (multiple images)", () => {
  const plain = compile(sceneDoc(undefined, swing()));
  const smeared = compile(sceneDoc({ smear: 1 }, swing()));
  const F = 14; // mid-swing (the swing runs from frame 12 to 16.8)

  it("draws faded ghosts of a fast-swinging arm before it, the body standing still", () => {
    const frame = evaluateScene(smeared, at(F));
    expect(transformOf(smeared, F, "actor-a")).toEqual(transformOf(plain, F, "actor-a"));
    const q = partSpeed(smeared, ["arm1", "arm2"], F);
    expect(q).toBeGreaterThan(0);
    const ghosts = ghostsOf(frame.nodes, "arm");
    expect(ghosts.length).toBe(q < 0.5 ? 1 : 2);
    expect(ghosts.map((g) => g.opacity)).toEqual(ghosts.length === 1 ? [0.45 * q] : [0.3 * q, 0.45 * q].map((v) => expect.closeTo(v, 9)));
    // Same group, right before the drawing itself, which is not stretched.
    const group = find(frame.nodes, "actor-a") as Extract<RenderNode, { kind: "group" }>;
    const keys = group.children.map((c) => c.key);
    expect(keys.indexOf(ghosts[ghosts.length - 1].key)).toBeLessThan(keys.indexOf("a-arm"));
    expect(find(frame.nodes, "a-arm")).toEqual(find(evaluateScene(plain, at(F)).nodes, "a-arm"));
    // The skinned limb on the same bones has as many ghosts.
    expect(ghostsOf(frame.nodes, "limb").length).toBe(ghosts.length);
  });

  it("leaves the head and the body alone", () => {
    const frame = evaluateScene(smeared, at(F));
    expect(ghostsOf(frame.nodes, "mouth")).toEqual([]);
    expect(ghostsOf(frame.nodes, "body")).toEqual([]);
    expect(transformOf(smeared, F, "a-mouth")).toEqual(transformOf(plain, F, "a-mouth"));
  });

  it("draws real in-betweens: a ghost's arm angle lies between the two drawings'", () => {
    const prev = angle(transformOf(plain, F - 1, "a-fist")), cur = angle(transformOf(plain, F, "a-fist"));
    const ghosts = ghostsOf(evaluateScene(smeared, at(F)).nodes, "fist");
    expect(ghosts.length).toBeGreaterThan(0);
    for (const g of ghosts) expect(between(angle((g as Extract<RenderNode, { kind: "markup" }>).transform!), prev, cur)).toBe(true);
  });

  it("gives a cup held in the swinging hand as many ghosts as the hand, where the ghost hands hold it", () => {
    const cup = [{ id: "cup", art: "<rect width='10' height='10'/>", x: 300, y: 350 }];
    const held = compile(sceneDoc({ smear: 1 }, swing(cup, true)));
    const frame = evaluateScene(held, at(F));
    const arm = ghostsOf(frame.nodes, "arm");
    const cups = frame.nodes.filter((n) => /^prop-cup-g\d$/.test(n.key));
    expect(cups.length).toBe(arm.length);
    expect(cups.map((c) => c.opacity)).toEqual(arm.map((a) => expect.closeTo(a.opacity!, 9)));
    // Ghosts first, then the cup itself.
    const keys = frame.nodes.map((n) => n.key);
    for (const c of cups) expect(keys.indexOf(c.key)).toBeLessThan(keys.indexOf("prop-cup"));
    // Each ghost cup sits in the matching ghost fist (the hand anchor, [80, -110] in setup space).
    const M = transformOf(held, F, "actor-a");
    const fists = ghostsOf(frame.nodes, "fist", "a-h-");
    expect(fists.length).toBe(cups.length);
    cups.forEach((c, i) => {
      const hand = apply(M, apply((fists[i] as Extract<RenderNode, { kind: "markup" }>).transform!, [80, -110]));
      const m = (c as Extract<RenderNode, { kind: "markup" }>).transform!;
      expect(m[4]).toBeCloseTo(hand[0], 6);
      expect(m[5]).toBeCloseTo(hand[1], 6);
    });
  });
});

describe("free props", () => {
  it("smear by their own move between frames", () => {
    const flying = {
      props: [{ id: "ball", art: "<circle r='20'/>", x: 0, y: 200 }],
      tracks: { "props.ball.x": [[0, 0], [1, 800, "linear"]] },
    } as unknown as Partial<SceneDoc>;
    const S = ratio(transformOf(compile(sceneDoc({ smear: 1 }, flying)), 10, "prop-ball"), transformOf(compile(sceneDoc(undefined, flying)), 10, "prop-ball"));
    // 33.3 px per frame for a 40 px ball (0.83 of its size): f = 1 + 0.9 · (0.83 − 0.5) / 1.5.
    const f = 1 + (0.9 * (800 / 24 / 40 - 0.5)) / 1.5;
    expect(stretch(S, [1, 0])).toBeCloseTo(f, 6);
    expect(stretch(S, [0, 1])).toBeCloseTo(1 / Math.sqrt(f), 6);
    // The first frame has nothing to compare with.
    expect(svg(compile(sceneDoc({ smear: 1 }, flying)), 0)).toBe(svg(compile(sceneDoc(undefined, flying)), 0));
  });
});

describe("on twos", () => {
  it("draws real in-betweens of a swing, different from both drawings, on both frames of the drawing", () => {
    const plain = compile(sceneDoc({ twos: true }, swing()));
    const smeared = compile(sceneDoc({ twos: true, smear: 1 }, swing()));
    expect(svg(smeared, 15)).toBe(svg(smeared, 14));
    const prev = angle(transformOf(plain, 12, "a-fist")), cur = angle(transformOf(plain, 14, "a-fist"));
    const ghosts = ghostsOf(evaluateScene(smeared, at(14)).nodes, "fist");
    expect(ghosts.length).toBeGreaterThan(0);
    for (const g of ghosts) {
      const a = angle((g as Extract<RenderNode, { kind: "markup" }>).transform!);
      expect(between(a, prev, cur)).toBe(true);
    }
  });

  const doc = (smear?: number) => sceneDoc({ twos: true, ...(smear ? { smear } : {}) }, walk(700, 1.2));
  const plain = compile(doc());
  const smeared = compile(doc(1));

  it("shows the same smeared drawing on both frames of a drawing", () => {
    for (const k of [6, 12, 20]) expect(svg(smeared, 2 * k + 1)).toBe(svg(smeared, 2 * k));
    expect(svg(smeared, 24)).not.toBe(svg(plain, 24));
  });

  it("smears the change frame by the whole two-frame move", () => {
    for (const k of [5, 7, 9]) {
      const S = ratio(transformOf(smeared, 2 * k, "actor-a"), transformOf(plain, 2 * k, "actor-a"));
      const a = smeared.actors[0];
      const dx = actorPlacement(a, at(2 * k))[4] - actorPlacement(a, at(2 * k - 2))[4];
      const f = bodyF(dx);
      expect(f).toBeGreaterThan(1);
      expect(stretch(S, [1, 0])).toBeCloseTo(f, 2);
    }
  });
});
