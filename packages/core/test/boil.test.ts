import { describe, expect, it } from "vitest";
import {
  type CompiledScene,
  type RenderFrame,
  type RenderNode,
  type SceneDoc,
  type ToonDoc,
  compileScene,
  diagnoseFrames,
  evaluateScene,
  frameToSVG,
  matScale,
  nodeToString,
  prefixFrame,
  withDebugOverlay,
} from "../src";
import { stick } from "./fixtures";

const FPS = 24;
const at = (f: number) => f / FPS;

/** One actor `a`, a free prop `cup` and a background layer `bg`; the cartoon timing comes from `animation`. */
const sceneDoc = (animation: Record<string, unknown> | undefined, extra: Record<string, unknown> = {}): SceneDoc =>
  ({
    format: "toon-scene",
    version: 1,
    width: 800,
    height: 400,
    fps: FPS,
    duration: 3,
    characters: { stick: "stick" },
    actors: [{ id: "a", character: "stick", x: 100, y: 350 }],
    props: [{ id: "cup", art: "<rect width='10' height='10'/>", x: 300, y: 350 }],
    layers: [{ id: "bg", art: "<rect width='800' height='400' fill='#cde'/>" }],
    ...(animation ? { animation } : {}),
    ...extra,
  }) as unknown as SceneDoc;

const compile = (doc: SceneDoc): CompiledScene => compileScene(doc, { characters: { stick } });
const frame = (sc: CompiledScene, f: number) => evaluateScene(sc, at(f));
const node = (fr: RenderFrame, key: string): RenderNode => {
  const n = fr.nodes.find((x) => x.key === key);
  if (!n) throw new Error(`no node "${key}"`);
  return n;
};
const svgFilterOf = (n: RenderNode) => (n.kind === "path" ? undefined : n.svgFilter);
/** The boil filter with this id in a frame's defs: its seed and displacement scale. */
function boilDef(fr: RenderFrame, id: string): { seed: number; scale: number; markup: string } {
  const m = new RegExp(`<filter id="${id}"[^>]*>.*?</filter>`).exec(fr.defs);
  if (!m) throw new Error(`no filter "${id}"`);
  return {
    markup: m[0],
    seed: Number(/seed="(\d+)"/.exec(m[0])![1]),
    scale: Number(/feDisplacementMap[^>]*scale="([\d.]+)"/.exec(m[0])![1]),
  };
}
const seedOf = (sc: CompiledScene, f: number, id = "boil-actor-a") => boilDef(frame(sc, f), id).seed;
/** On-screen displacement the boil asks for (px), from the item's screen scale. */
const screenPx = (boil: number, s: number) => boil * Math.min(2.4, Math.max(1, 2.4 * s));

describe("line boil off (default)", () => {
  it("leaves every frame exactly as before", () => {
    const plain = compile(sceneDoc(undefined, { script: [{ at: 0, actor: "a", action: "walkTo", x: 500, duration: 2 }] }));
    const zero = compile(sceneDoc({ boil: 0 }, { script: [{ at: 0, actor: "a", action: "walkTo", x: 500, duration: 2 }] }));
    expect(zero.animation.boil).toBeUndefined();
    for (const f of [0, 1, 7, 30]) {
      const a = frame(plain, f);
      const b = frame(zero, f);
      expect(b).toEqual(a);
      expect(frameToSVG(b)).toBe(frameToSVG(a));
      expect(frameToSVG(a)).not.toContain("feTurbulence");
      expect(a.nodes.some((n) => svgFilterOf(n) !== undefined)).toBe(false);
    }
  });
});

describe("line boil", () => {
  it("resolves the amount (clamped 0..1), present only when on", () => {
    expect(compile(sceneDoc({ boil: 0.5 })).animation.boil).toBe(0.5);
    expect(compile(sceneDoc({ boil: 3 })).animation.boil).toBe(1);
  });

  it("filters every actor and prop with turbulence displacing its art, ≈ 2.4 px × screen scale on screen", () => {
    const sc = compile(sceneDoc({ boil: 1 }));
    const fr = frame(sc, 0);
    for (const [key, id] of [["actor-a", "boil-actor-a"], ["prop-cup", "boil-prop-cup"]]) {
      const n = node(fr, key);
      expect(svgFilterOf(n)).toBe(`url(#${id})`);
      const d = boilDef(fr, id);
      expect(d.markup).toContain('x="-10%" y="-10%" width="120%" height="120%"');
      expect(d.markup).toContain('<feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2"');
      expect(d.markup).toContain('<feDisplacementMap in="SourceGraphic" in2="n"');
      expect(d.markup).toContain('xChannelSelector="R" yChannelSelector="G"');
      // The filter works in the item's own space: its scale × the item's screen scale is the
      // displacement on screen.
      const s = matScale((n as { transform: [number, number, number, number, number, number] }).transform);
      expect(s).toBeCloseTo(1, 6);
      expect(d.scale * s).toBeCloseTo(2.4 * s, 2);
    }
    // Half the boil, half the wobble.
    expect(boilDef(frame(compile(sceneDoc({ boil: 0.5 })), 0), "boil-actor-a").scale).toBeCloseTo(1.2, 3);
  });

  it("keeps the wobble 1–2.4 px on screen at any zoom (the scale is in the item's units)", () => {
    for (const [zoom, scale] of [[2, 1], [1, 0.5], [1, 0.25], [0.5, 0.5]]) {
      const doc = sceneDoc({ boil: 1 }, { camera: { zoom }, actors: [{ id: "a", character: "stick", x: 100, y: 350, scale }] });
      const fr = frame(compile(doc), 0);
      const n = node(fr, "actor-a") as Extract<RenderNode, { kind: "group" }>;
      const s = matScale(n.transform!);
      expect(s).toBeCloseTo(zoom * scale, 6);
      expect(boilDef(fr, "boil-actor-a").scale * s).toBeCloseTo(screenPx(1, s), 2);
    }
  });

  it("changes the seed every two frames, and with each drawing on twos or threes", () => {
    const ones = compile(sceneDoc({ boil: 1 }));
    for (const k of [0, 3, 10]) {
      expect(seedOf(ones, 2 * k + 1)).toBe(seedOf(ones, 2 * k));
      expect(seedOf(ones, 2 * k + 2)).not.toBe(seedOf(ones, 2 * k));
    }
    // On twos the drawings are the same two-frame groups.
    const twos = compile(sceneDoc({ boil: 1, twos: true }));
    for (const f of [0, 1, 2, 3, 8, 9]) expect(seedOf(twos, f)).toBe(seedOf(ones, f));
    // On threes the seed holds for each drawing's three frames and changes with the next drawing.
    const threes = compile(sceneDoc({ boil: 1, twos: 3 }));
    expect(seedOf(threes, 1)).toBe(seedOf(threes, 0));
    expect(seedOf(threes, 2)).toBe(seedOf(threes, 0));
    expect(seedOf(threes, 3)).not.toBe(seedOf(threes, 2));
    expect(seedOf(threes, 5)).toBe(seedOf(threes, 3));
    expect(seedOf(threes, 6)).not.toBe(seedOf(threes, 5));
    // A free prop stays smooth: every two frames of the scene, whatever the actors' timing.
    expect(seedOf(threes, 2, "boil-prop-cup")).not.toBe(seedOf(threes, 1, "boil-prop-cup"));
    // Different items get different seeds on the same frame.
    expect(seedOf(ones, 0, "boil-prop-cup")).not.toBe(seedOf(ones, 0));
  });

  it("boils a held prop with its holder's drawings", () => {
    const sc = compile(sceneDoc({ boil: 1, twos: 3 }, { script: [{ at: 0, actor: "a", action: "grab", prop: "cup", anchor: "hand" }] }));
    expect(seedOf(sc, 2, "boil-prop-cup")).toBe(seedOf(sc, 0, "boil-prop-cup"));
    expect(seedOf(sc, 3, "boil-prop-cup")).not.toBe(seedOf(sc, 2, "boil-prop-cup"));
  });

  it("is deterministic across fresh compiles", () => {
    const doc = sceneDoc({ boil: 0.8, twos: true }, { script: [{ at: 0, actor: "a", action: "walkTo", x: 500, duration: 2 }] });
    for (const f of [0, 5, 13, 40]) expect(frameToSVG(frame(compile(doc), f))).toBe(frameToSVG(frame(compile(doc), f)));
  });

  it("leaves layers still", () => {
    const fr = frame(compile(sceneDoc({ boil: 1 })), 4);
    expect(svgFilterOf(node(fr, "layer-bg"))).toBeUndefined();
    expect(fr.defs).not.toContain("boil-layer");
  });

  it("composes with motion blur: the boil on the item's element, the blur on a screen-space wrapper", () => {
    const sc = compile(sceneDoc({ boil: 1 }, { camera: { motionBlur: 1 }, script: [{ at: 0, actor: "a", action: "walkTo", x: 700, duration: 0.5 }] }));
    const fr = frame(sc, 6);
    const n = node(fr, "actor-a");
    expect(n.kind === "group" && n.filter).toMatch(/^blur\(/);
    expect(svgFilterOf(n)).toBe("url(#boil-actor-a)");
    expect(nodeToString(n)).toMatch(/^<g style="filter:blur\([\d.]+px\)"><g id="actor-art-a" transform="[^"]+" filter="url\(#boil-actor-a\)">/);
  });

  it("boils the held hand and the parts behind a mount with the actor's own filter", () => {
    // The stick with a fist on its forearm: drawn over the held prop.
    const fisted = { ...stick, parts: [...stick.parts, { id: "fist", type: "rigid", bone: "arm2", art: "mouthD" }] } as ToonDoc;
    const doc = sceneDoc({ boil: 1 }, { script: [{ at: 0, actor: "a", action: "grab", prop: "cup", anchor: "hand" }] });
    const fr = evaluateScene(compileScene(doc, { characters: { stick: fisted } }), at(3));
    expect(svgFilterOf(node(fr, "actor-a-hand"))).toBe("url(#boil-actor-a)");
  });

  it("keeps the cel-shading masks aligned: the shading's copy of the art boils with the same filter", () => {
    const lighting = { lights: [{ id: "sun", type: "point", x: 380, y: 40, radius: 300 }], shading: { opacity: 0.3, rimOpacity: 0.5 } };
    const sc = compile(sceneDoc({ boil: 1 }, { lighting }));
    const fr = frame(sc, 0);
    const shade = node(fr, "shade-a") as Extract<RenderNode, { kind: "markup" }>;
    // The art copy is namespaced by the shading; its boil filter has a namespaced twin, identical
    // but for its id.
    expect(shade.markup).toContain('filter="url(#shade-a-boil-actor-a)"');
    const twin = boilDef({ ...fr, defs: shade.markup }, "shade-a-boil-actor-a");
    expect(twin.markup.replace('id="shade-a-boil-actor-a"', 'id="boil-actor-a"')).toBe(boilDef(fr, "boil-actor-a").markup);
  });

  it("keeps diagnoseFrames quiet: no broken references, the same nodes every frame", () => {
    const lighting = { lights: [{ id: "sun", type: "point", x: 380, y: 40, radius: 300 }], shading: { opacity: 0.3, rimOpacity: 0.5 } };
    const sc = compile(sceneDoc({ boil: 1, twos: true }, { lighting, script: [{ at: 0, actor: "a", action: "walkTo", x: 300, duration: 1 }] }));
    const frames = Array.from({ length: 12 }, (_, f) => frame(sc, f));
    const issues = diagnoseFrames(frames, frames.map((_, f) => at(f)));
    expect(issues.filter((d) => d.severity !== "info")).toEqual([]);
  });

  it("draws a debug sentinel outside the boiled content (it stays verifiable)", () => {
    const fr = frame(compile(sceneDoc({ boil: 1 })), 0);
    const dbg = withDebugOverlay(fr, { frameIndex: 0, time: 0 });
    for (const key of ["actor-a", "prop-cup"]) {
      const n = node(dbg, key) as Extract<RenderNode, { kind: "markup" }>;
      expect(n.svgFilter).toBeUndefined();
      const id = `boil-${key}`;
      // Content: clipped, then boiled; the sentinel path follows the clipped group.
      expect(n.markup).toMatch(new RegExp(`<g clip-path="url\\(#dbg-clip-\\d+\\)"><g[^>]* filter="url\\(#${id}\\)">.*</g></g><path d="[^"]+" fill="rgb\\(`));
    }
  });

  it("emits the filter reference and its definition in frameToSVG, also in a prefixed frame", () => {
    const fr = frame(compile(sceneDoc({ boil: 1 })), 0);
    const svg = frameToSVG(fr);
    expect(svg).toContain('<defs><filter id="boil-actor-a"');
    expect(svg).toContain('<filter id="boil-prop-cup"');
    expect(svg).toContain('filter="url(#boil-actor-a)"');
    expect(svg).toContain('filter="url(#boil-prop-cup)"');
    const pre = frameToSVG(prefixFrame(fr, "x"));
    expect(pre).toContain('<filter id="x-boil-actor-a"');
    expect(pre).toContain('filter="url(#x-boil-actor-a)"');
    expect(pre).toContain('filter="url(#x-boil-prop-cup)"');
  });
});
