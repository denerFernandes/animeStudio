import { describe, expect, it } from "vitest";
import { type SceneDoc, compileScene, evaluateScene, frameToSVG, lightingAt, mixColor, normalizeTrack, sampleTrack, validateScene } from "../src";
import { stick } from "./fixtures";

const scene = (lighting: SceneDoc["lighting"], extra: Partial<SceneDoc> = {}): SceneDoc => ({
  format: "toon-scene",
  version: 1,
  width: 400,
  height: 300,
  fps: 30,
  duration: 2,
  characters: { stick: "x" },
  actors: [{ id: "a", character: "stick", x: 200, y: 280 }],
  lighting,
  ...extra,
});

describe("color interpolation", () => {
  it("blends hex colors smoothly", () => {
    expect(mixColor("#000000", "#ffffff", 0.5)).toBe("#808080");
    const tr = normalizeTrack([[0, "#ff0000"], [1, "#0000ff", "linear"]]);
    expect(sampleTrack(tr, 0.5)).toBe("#800080");
    // Non-color strings still step.
    expect(sampleTrack(normalizeTrack([[0, "open"], [1, "closed"]]), 0.5)).toBe("open");
  });
});

describe("lighting", () => {
  const lit: SceneDoc["lighting"] = {
    ambient: { color: "#101030", opacity: 0.5 },
    lights: [{ id: "sun", type: "point", x: 380, y: 40, radius: 300, glow: 0.8, color: "#ffcc66" }],
    shading: { opacity: 0.3, rimOpacity: 0.5 },
    vignette: { opacity: 0.3 },
  };

  it("renders glows, ambient darkness, shading and vignette", () => {
    const s = compileScene(scene(lit), { characters: { stick } });
    const svg = frameToSVG(evaluateScene(s, 0));
    expect(svg).toContain("feMorphology");
    expect(svg).toContain('id="actor-art-a"');
    expect(svg).toContain('mask="url(#shade-a)"');
    expect(svg).toContain('mask="url(#rim-a)"');
    expect(svg).toContain("url(#glow-sun)");
    expect(svg).toContain('mask="url(#ambient-mask)"');
    expect(svg).toContain("url(#vignette)");
  });

  it("animates lights with tracks and actions", () => {
    const s = compileScene(
      scene(lit, {
        tracks: { "lights.sun.y": [[0, 300], [2, 40]] },
        script: [{ at: 0, action: "light", channel: "lighting.ambient.opacity", value: 0, duration: 1, ease: "linear" }],
      }),
      { characters: { stick } },
    );
    const a = lightingAt(s.lighting!.def, s.lighting!.tracks, 0.5);
    expect(a.ambient.opacity).toBeCloseTo(0.25);
    expect(a.lights[0].y).toBeLessThan(300);
    expect(a.lights[0].y).toBeGreaterThan(40);
  });

  it("skips shading for opted-out actors", () => {
    const doc = scene(lit);
    doc.actors![0].shading = false;
    const svg = frameToSVG(evaluateScene(compileScene(doc, { characters: { stick } }), 0));
    expect(svg).not.toContain("shade-a");
  });

  it("reports unknown lighting channels", () => {
    const r = validateScene(scene(lit, { script: [{ at: 0, action: "light", channel: "lights.moon.intensity", value: 1 }] }), { characters: { stick } });
    expect(r.ok).toBe(false);
    expect(r.issues[0].message).toContain('unknown light "moon"');
  });
});
