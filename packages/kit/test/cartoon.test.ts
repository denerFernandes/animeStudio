import { describe, expect, it } from "vitest";
import { compileRig, evaluatePose, validateToon } from "@animestudio/core";
import { type CartoonLook, cast, ellipsoid, fieldPath, fluid, gridFor, mouthInside, onSurface, cartoonCharacter, cartoonInfo, sphere } from "../src";

const kid: CartoonLook = {
  name: "kid", build: "kid", skin: "#f6d3b5", hair: "ponytail", hairColor: "#5a3a22", accent: "#ff4fa0",
  top: "shirt", topColor: "#ffffff", pattern: "pinstripes", pocketItem: { color: "#ffffff" }, earItem: "cigarette",
  bottom: "bermuda", bottomColor: "#3a62b0", shoes: "sneakers", glasses: "sun", hat: "capBack", tie: "#a8202f",
};

describe("volumes", () => {
  it("draws a volume from any angle as a closed outline", () => {
    const ball = sphere([0, -50, 0], 40);
    for (const theta of [0, 0.6, Math.PI]) {
      const g = gridFor([{ x: [-45, 45], y: [-95, -5], z: [-45, 45] }], theta, 2);
      const c = cast(ball, g, theta);
      const d = fieldPath(c.val, g);
      expect(d.startsWith("M")).toBe(true);
      expect(d.trim().endsWith("Z")).toBe(true);
      // The outline stays on the sphere's silhouette.
      const xs = [...d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
      expect(Math.max(...xs)).toBeLessThan(43);
      expect(Math.max(...xs)).toBeGreaterThan(36);
    }
  });
  it("projects points drawn on a surface: a turned face moves its features towards the turn", () => {
    const head = ellipsoid([0, 0, 0], [50, 60, 50]);
    const front = onSurface(head, 0).point(20, 0), turned = onSurface(head, 0.6).point(20, 0);
    expect(front[0]).toBeCloseTo(20, 0);
    expect(turned[0]).toBeGreaterThan(front[0]);
    expect(onSurface(head, Math.PI).visible(20, 0)).toBe(false);
  });
});

describe("sitcom characters", () => {
  const doc = cartoonCharacter(kid);
  it("build valid rigs with every drawn angle as a view, in turning order", () => {
    const v = validateToon(doc);
    expect(v.ok).toBe(true);
    const meta = doc.meta as { views: { order: string[] } };
    expect(meta.views.order).toEqual(["front", "half", "profile", "side", "away", "back"]);
    const poses = (doc.controls as Record<string, { poses: Record<string, unknown> }>).view.poses;
    expect(Object.keys(poses).sort()).toEqual(["away", "back", "front", "half", "profile", "side"]);
    // A ponytail on a spring, follow-through on the forearms.
    const physics = doc.physics as { type: string; bones?: string[] }[];
    expect(physics.some((p) => p.bones?.includes("tail"))).toBe(true);
    expect(physics.some((p) => p.bones?.includes("armF2"))).toBe(true);
  });
  it("evaluates in every view and measures for the director", () => {
    const rig = compileRig(doc);
    for (const view of ["front", "half", "profile", "side", "away", "back"]) expect(() => evaluatePose(rig, { controls: { view } } as never)).not.toThrow();
    const info = cartoonInfo(doc, kid);
    expect(info.height).toBeGreaterThan(380);
    expect(info.legLength!.F).toBeGreaterThan(150);
  });
  it("can sit facing the camera, its skirt follows the thighs, held props turn with the hand", () => {
    const lady = cartoonCharacter({ ...kid, name: "lady", bottom: "skirt" });
    const parts = lady.parts as { id: string; type: string; bones?: string[]; variants?: Record<string, string> }[];
    for (const side of ["F", "B"]) expect(Object.keys(parts.find((p) => p.id === `lap${side}`)!.variants!)).toEqual(["off", "on"]);
    const skirt = parts.filter((p) => p.id.startsWith("skirt_"));
    expect(skirt.length).toBeGreaterThan(1);
    expect(skirt.every((p) => p.type === "skinned" && p.bones!.includes("legF1"))).toBe(true);
    expect((lady.anchors as Record<string, { turn?: number }>).hand.turn).toBe(1);
    // Shoes point at the camera from the front.
    const front = (lady.controls as Record<string, { poses: Record<string, Record<string, unknown>> }>).view.poses.front;
    expect(front["parts.shoeF.variant"]).toBe("front");
  });
  it("gives every colour a shadow tone and a line tone", () => {
    const p = doc.palette as Record<string, string>;
    for (const k of ["skin", "top", "hair", "stripe"]) {
      expect(p[`${k}Shade`]).toMatch(/^#[0-9a-f]{6}$/);
      expect(p[`${k}Line`]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("hand-drawn timing", () => {
  it("adds anticipation and overshoot to big gesture moves, never to loops", () => {
    const clips = fluid({
      wave: { duration: 1, tracks: { "bones.armF1.rotation": [[0, 0], [0.4, -120], [1, -120]] } },
      walk: { duration: 1, loop: true, tracks: { "bones.armF1.rotation": [[0, 0], [0.5, -60], [1, 0]] } },
    });
    const k = clips.wave.tracks["bones.armF1.rotation"] as number[][];
    expect(k.length).toBe(5);
    expect(k[1][1]).toBeGreaterThan(0); // the other way first
    expect(k[2][1]).toBeLessThan(-120); // past the pose
    expect(k[3][1]).toBe(-120); // settles
    expect(clips.walk.tracks["bones.armF1.rotation"]).toHaveLength(3);
  });
  it("mouth insides morph with the mouth and hide when it is closed", () => {
    const m = mouthInside([0, 0], [40, 0]);
    expect(Object.keys(m.teeth.shapes)).toContain("D");
    expect(m.teeth.base).toMatch(/^M(\S+ \S+) Q\1 \1 Q\1 \1 Z$/);
  });
});
