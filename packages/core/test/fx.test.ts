import { describe, expect, it } from "vitest";
import { FX_TYPES, type SceneDoc, cameraAt, compileScene, evaluateScene, frameToSVG, fxMarkup, validateScene } from "../src";
import { stick } from "./fixtures";

const base = (script: SceneDoc["script"], extra: Partial<SceneDoc> = {}): SceneDoc => ({
  format: "toon-scene",
  version: 1,
  width: 800,
  height: 400,
  fps: 30,
  duration: 4,
  characters: { stick: "x" },
  actors: [{ id: "a", character: "stick", x: 100, y: 380 }],
  script,
  ...extra,
});

describe("cartoon fx", () => {
  it("renders every effect type across its lifetime", () => {
    for (const type of FX_TYPES) {
      for (const u of [0, 0.1, 0.5, 0.9, 1]) {
        const svg = fxMarkup(type, u, u, { color: "#000", seed: 1 });
        expect(svg).not.toContain("NaN");
      }
      expect(fxMarkup(type, 0.4, 0.4, { color: "#000", seed: 1 }).length).toBeGreaterThan(20);
    }
  });

  it("attaches effects to actors and only shows them while active", () => {
    const s = compileScene(base([{ at: 1, actor: "a", action: "fx", type: "surprise", duration: 0.5 }]), { characters: { stick } });
    const key = (t: number) => evaluateScene(s, t).nodes.find((n) => n.key.startsWith("fx-"));
    expect(key(0.5)).toBeUndefined();
    const node = key(1.2) as { transform: number[] };
    expect(node).toBeDefined();
    // Positioned at the actor's head anchor (x ≈ actor x).
    expect(Math.abs(node.transform[4] - 100)).toBeLessThan(5);
    expect(key(1.6)).toBeUndefined();
  });

  it("mirrors effects with flipped actors", () => {
    const doc = base([{ at: 0, actor: "a", action: "fx", type: "sweat" }]);
    doc.actors![0].flip = true;
    const node = evaluateScene(compileScene(doc, { characters: { stick } }), 0.5).nodes.find((n) => n.key.startsWith("fx-")) as { transform: number[] };
    expect(node.transform[0]).toBeLessThan(0);
  });

  it("validates anchors", () => {
    const r = validateScene(base([{ at: 0, actor: "a", action: "fx", type: "dust", anchor: "tail" }]), { characters: { stick } });
    expect(r.ok).toBe(false);
    expect(r.issues[0].message).toContain('unknown anchor "tail"');
  });

  it("renders scene-point effects", () => {
    const s = compileScene(base([{ at: 0, action: "fx", type: "impact", x: 400, y: 200 }]), { characters: { stick } });
    expect(frameToSVG(evaluateScene(s, 0.1))).toContain("<line");
  });
});

describe("camera follow", () => {
  it("tracks a walking actor with smoothing and releases it", () => {
    const doc = base(
      [
        { at: 0, actor: "a", action: "walkTo", x: 700, duration: 3 },
        { at: 0, action: "camera", follow: "a", offset: [50, 0], lag: 0.2 },
        { at: 3.2, action: "camera", follow: null },
      ],
      { camera: { x: 400, y: 200 } },
    );
    const s = compileScene(doc, { characters: { stick } });
    const xAt = (t: number) => cameraAt(s, t).x;
    expect(xAt(0)).toBeCloseTo(400); // follow blends in
    expect(xAt(2)).toBeGreaterThan(400);
    expect(xAt(1.5)).toBeLessThan(xAt(2.5));
    // Released: the camera holds where it is (director model), it does not jump back.
    expect(xAt(3.9)).toBeCloseTo(xAt(3.2), 3);
  });

  it("starts moves from wherever the camera actually is (no jumps after rigs)", () => {
    const doc = base(
      [
        { at: 0, actor: "a", action: "walkTo", x: 700, duration: 2 },
        { at: 0, action: "camera", follow: "a", lag: 0, blend: 0 },
        { at: 2.5, action: "camera", x: 100, duration: 1, ease: "linear" },
      ],
      { camera: { x: 400, y: 200 } },
    );
    const s = compileScene(doc, { characters: { stick } });
    const before = cameraAt(s, 2.49).x;
    const after = cameraAt(s, 2.51).x;
    expect(Math.abs(after - before)).toBeLessThan(15);
    expect(cameraAt(s, 3.6).x).toBeCloseTo(100);
  });
});
