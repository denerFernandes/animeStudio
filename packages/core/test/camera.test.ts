import { describe, expect, it } from "vitest";
import {
  type SceneDoc,
  type SequenceDoc,
  actorPlacement,
  cameraAt,
  compileScene,
  compileSequence,
  evaluateScene,
  evaluateSequence,
  frameToSVG,
  handheldOffset,
  prefixFrame,
  sequenceAudio,
  surfaceY,
  validateScene,
  validateSequence,
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
  actors: [
    { id: "a", character: "stick", x: 100, y: 380 },
    { id: "b", character: "stick", x: 700, y: 380 },
  ],
  ...extra,
});
const compile = (doc: SceneDoc) => compileScene(doc, { characters: { stick } });

describe("advanced camera", () => {
  it("frames targets automatically", () => {
    const s = compile(scene({ camera: { x: 0, y: 0, zoom: 3 }, script: [{ at: 0, action: "camera", frame: ["a", "b"], blend: 0 }] }));
    const c = cameraAt(s, 1);
    expect(Math.abs(c.x - 400)).toBeLessThan(25);
    expect(c.zoom).toBeLessThan(1.2);
    // Both actors are on screen.
    for (const id of ["a", "b"]) {
      const m = actorPlacement(s.actors.find((x) => x.id === id)!, 1);
      const p = viewMatrix(s, c)[4] + m[4] * c.zoom;
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThan(800 * 2);
    }
  });

  it("follows with a dead zone (no camera motion for small moves)", () => {
    const s = compile(
      scene({
        camera: { x: 100, y: 200 },
        script: [
          { at: 0, action: "camera", follow: "a", deadZone: [60, 0], lag: 0, blend: 0 },
          { at: 0, actor: "a", action: "walkTo", x: 140, duration: 1 },
        ],
      }),
    );
    expect(cameraAt(s, 1.5).x).toBeCloseTo(100, 0); // moved 40 px, inside the 60 px zone
  });

  it("moves along curved paths and settles at the end", () => {
    const s = compile(scene({ camera: { x: 0, y: 0 }, script: [{ at: 0, action: "camera", path: [[200, -100], [400, 0]], duration: 2, ease: "linear" }] }));
    const mid = cameraAt(s, 1);
    expect(mid.y).toBeLessThan(-30); // curved, not straight
    const end = cameraAt(s, 3);
    expect(end.x).toBeCloseTo(400);
    expect(end.y).toBeCloseTo(0);
  });

  it("punches in and settles", () => {
    const s = compile(scene({ script: [{ at: 1, action: "camera", punch: 0.2, duration: 0.5 }] }));
    expect(cameraAt(s, 1.08).zoom).toBeGreaterThan(1.1);
    expect(cameraAt(s, 2).zoom).toBeCloseTo(1);
  });

  it("adds deterministic handheld drift", () => {
    expect(handheldOffset(10, 1.234)).toEqual(handheldOffset(10, 1.234));
    const s = compile(scene({ camera: { handheld: 8 } }));
    expect(cameraAt(s, 0.5).x).not.toBeCloseTo(400, 3);
  });

  it("dolly scales the background but not the subject plane", () => {
    const s = compile(scene({ camera: { dolly: 0.5 } }));
    const c = cameraAt(s, 0);
    expect(Math.hypot(...viewMatrix(s, c, 1).slice(0, 2))).toBeCloseTo(1);
    expect(Math.hypot(...viewMatrix(s, c, 0.5).slice(0, 2))).toBeLessThan(0.9);
  });

  it("keeps the view inside bounds", () => {
    const s = compile(scene({ camera: { x: -500, y: 200, bounds: [0, 0, 1600, 400] } }));
    expect(cameraAt(s, 0).x).toBe(400);
  });

  it("blurs out-of-focus depths and fast motion", () => {
    const dof = frameToSVG(
      evaluateScene(compile(scene({ camera: { blur: 6, focus: 1 }, layers: [{ id: "bg", art: "<rect width='10' height='10'/>", parallax: 0.3 }] })), 0),
    );
    expect(dof).toContain("filter:blur(");
    const mb = compile(scene({ camera: { motionBlur: 0.5 }, script: [{ at: 0, action: "camera", x: 3000, duration: 1, ease: "linear" }] }));
    expect(frameToSVG(evaluateScene(mb, 0.5))).toContain("filter:blur(");
  });

  it("expresses blur as stable numeric CSS (no per-frame filter references)", () => {
    const s = compile(scene({ camera: { motionBlur: 0.5, handheld: 4, blur: 3 }, layers: [{ id: "bg", art: "<rect/>", parallax: 0.4 }] }));
    for (let t = 0; t < 2; t += 0.1) {
      const svg = frameToSVG(evaluateScene(s, t));
      expect(svg).not.toContain('filter="url(#cam-blur');
    }
  });

  it("draws in-scene transitions", () => {
    const s = compile(scene({ script: [{ at: 1, action: "transition", type: "iris", duration: 1, target: "a" }] }));
    expect(frameToSVG(evaluateScene(s, 1.3))).toContain("iris-0");
    expect(frameToSVG(evaluateScene(s, 0.5))).not.toContain("iris-0");
  });

  it("lets an actor look at a prop it is holding", () => {
    const s = compile(
      scene({
        props: [{ id: "ball", art: "<circle r='10'/>", x: 0, y: 0 }],
        script: [
          { at: 0, actor: "a", action: "grab", prop: "ball", anchor: "hand" },
          { at: 0, actor: "a", action: "lookAt", target: "ball" },
        ],
      }),
    );
    expect(() => evaluateScene(s, 1)).not.toThrow();
  });

  it("rolls every depth by the same angle (no shear between layers)", () => {
    const s = compile(scene({ camera: { rotation: 3 } }));
    const c = cameraAt(s, 0);
    const angle = (m: number[]) => Math.atan2(m[1], m[0]);
    expect(angle(viewMatrix(s, c, 0.4))).toBeCloseTo(angle(viewMatrix(s, c, 1)));
    expect(angle(viewMatrix(s, c, 0))).toBeCloseTo(0);
  });

  it("does not mirror glyph effects and hides the shading of invisible actors", () => {
    const s = compile(
      scene({
        actors: [{ id: "a", character: "stick", x: 100, y: 380, flip: true, opacity: 0 }],
        lighting: { lights: [{ id: "key", type: "directional", angle: 130, glow: 0 }], shading: { light: "key" } },
        script: [{ at: 0, action: "fx", type: "question", actor: "a" }],
      }),
    );
    const f = evaluateScene(s, 0.3);
    const fx = f.nodes.find((n) => n.key.startsWith("fx-"));
    expect(fx && "transform" in fx && fx.transform![0]).toBeGreaterThan(0);
    expect(f.nodes.some((n) => n.key === "shade-a")).toBe(false);
  });

  it("validates camera targets", () => {
    const r = validateScene(scene({ script: [{ at: 0, action: "camera", frame: ["ghost"] }] }), { characters: { stick } });
    expect(r.ok).toBe(false);
    expect(r.issues[0].message).toContain('"ghost"');
  });
});

describe("ground surfaces", () => {
  const sloped = scene({
    world: { surfaces: [{ id: "hill", path: "M0 400 L800 200" }] },
    actors: [{ id: "a", character: "stick", x: 100, y: 0, ground: { surface: "hill", offset: 5, feet: ["hand"] } }],
    script: [{ at: 0, actor: "a", action: "walkTo", x: 700, duration: 3 }],
  });

  it("keeps actors on the surface while they walk", () => {
    const s = compile(sloped);
    const surface = s.surfaces.hill;
    for (const t of [0, 1, 2, 3]) {
      const m = actorPlacement(s.actors[0], t);
      expect(m[5]).toBeCloseTo(surfaceY(surface, m[4]) + 5, 3);
    }
    expect(surfaceY(surface, 400)).toBeCloseTo(300);
  });

  it("rejects unknown surfaces", () => {
    const bad = structuredClone(sloped);
    bad.actors![0].ground!.surface = "lava";
    expect(validateScene(bad, { characters: { stick } }).ok).toBe(false);
  });
});

describe("sequences", () => {
  const a = scene({ duration: 2, background: "#111" });
  const b = scene({ duration: 3, background: "#eee", audio: { x: "x.mp3" }, script: [{ at: 0.5, action: "sound", audio: "x" }] });
  const seq = (type: "crossfade" | "iris" | "cut"): SequenceDoc => ({
    format: "toon-sequence",
    version: 1,
    width: 800,
    height: 400,
    fps: 30,
    scenes: { a: "a", b: "b" },
    shots: [{ scene: "a" }, { scene: "b", transition: { type, duration: 1 } }],
  });
  const assets = { scenes: { a: { doc: a, assets: { characters: { stick } } }, b: { doc: b, assets: { characters: { stick } } } } };

  it("lays out shots (crossfades overlap)", () => {
    expect(compileSequence(seq("crossfade"), assets).duration).toBeCloseTo(4);
    expect(compileSequence(seq("iris"), assets).duration).toBeCloseTo(5);
  });

  it("composites crossfades with prefixed ids", () => {
    const s = compileSequence(seq("crossfade"), assets);
    const svg = frameToSVG(evaluateSequence(s, 1.5));
    expect(svg).toContain('id="actor-art-a"');
    expect(svg).toContain('id="s1-actor-art-a"');
  });

  it("draws iris transitions across the cut and offsets audio", () => {
    const s = compileSequence(seq("iris"), assets);
    expect(frameToSVG(evaluateSequence(s, 1.8))).toContain("mask=");
    expect(frameToSVG(evaluateSequence(s, 2.2))).toContain("mask=");
    expect(sequenceAudio(s)[0].start).toBeCloseTo(2.5);
  });

  it("mutes speech in replay shots", () => {
    const talky = scene({ duration: 2, script: [{ at: 0, actor: "a", action: "say", cues: [{ start: 0, end: 2, value: "D" }] }] });
    const doc: SequenceDoc = { format: "toon-sequence", version: 1, width: 800, height: 400, fps: 30, scenes: { t: "t" }, shots: [{ scene: "t" }, { scene: "t", muteSpeech: true }] };
    const s = compileSequence(doc, { scenes: { t: { doc: talky, assets: { characters: { stick } } } } });
    const mouth = (t: number) => frameToSVG(evaluateSequence(s, t)).includes("<ellipse rx='6' ry='8'") || frameToSVG(evaluateSequence(s, t)).includes('<ellipse rx="6" ry="8"');
    expect(mouth(1)).toBe(true);
    expect(mouth(3)).toBe(false);
  });

  it("validates shots", () => {
    const bad = seq("cut");
    bad.shots.push({ scene: "zzz" });
    expect(validateSequence(bad).ok).toBe(false);
  });

  it("prefixes frames", () => {
    const f = prefixFrame(evaluateScene(compile(scene()), 0), "p");
    expect(f.nodes.some((n) => n.kind === "group" && n.id === "p-actor-art-a")).toBe(true);
  });
});
