import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type SceneDoc, type ToonDoc, compileScene, propPlacement } from "@animestudio/core";
import { describe, expect, it } from "vitest";
import { prepareScene } from "../src";

const root = join(__dirname, "../../../examples");
const pip = JSON.parse(readFileSync(join(root, "characters/pip.toon.json"), "utf8")) as ToonDoc;
const assets = { characters: { pip } };

/** The shortest signed difference between two angles in degrees. */
const angleDelta = (a: number, b: number) => ((((b - a) % 360) + 540) % 360) - 180;

/** Pip walks across the scene holding a ball (fitted) and a stick (free in the hand), dropping both at 1.5 s. */
const carryScene = (): SceneDoc => ({
  format: "toon-scene",
  version: 1,
  width: 800,
  height: 600,
  fps: 30,
  duration: 3,
  characters: { pip: "pip.toon.json" },
  world: { gravity: [0, 2000], ground: 560 },
  actors: [{ id: "p", character: "pip", x: 200, y: 500 }],
  props: [
    { id: "ball", art: "<circle r='20'/>", x: 400, y: 100, body: { type: "dynamic", shape: { circle: 20 } } },
    { id: "stick", art: "<rect width='60' height='6'/>", x: 400, y: 100, body: { type: "dynamic", shape: { box: [60, 6] } } },
  ],
  script: [
    { action: "walkTo", actor: "p", at: 0, x: 600, duration: 2 },
    { action: "grab", actor: "p", at: 0, prop: "ball", anchor: "handNear" },
    { action: "grab", actor: "p", at: 0, prop: "stick", anchor: "handNear", fit: [{ point: [0, 0], anchor: "handNear" }, { point: [60, 0], angle: 45 }] },
    { action: "release", actor: "p", at: 1.5, prop: "ball" },
    { action: "release", actor: "p", at: 1.5, prop: "stick" },
  ],
});

/** The scene's own (unbaked) placement of a prop: the hand while held, the tracks otherwise. */
const scripted = (doc: SceneDoc, id: string, t: number) => {
  const plain = compileScene(doc, assets);
  return propPlacement(plain, plain.props.find((p) => p.id === id)!, t);
};

describe("rigid: held bodies (M22, B42)", () => {
  it("samples a held body where the hand is at the same time, not one step behind", async () => {
    const scene = await prepareScene(carryScene(), assets);
    for (const t of [0, 0.5, 1, 1.25]) {
      const hand = scripted(carryScene(), "ball", t);
      const got = scene.rigid!.sample("ball", t)!;
      expect(got.x).toBeCloseTo(hand.x, 1);
      expect(got.y).toBeCloseTo(hand.y, 1);
    }
  });

  it("samples a fitted prop with the rotation the scene fits it to", async () => {
    const scene = await prepareScene(carryScene(), assets);
    for (const t of [0.25, 1]) {
      const fitted = scripted(carryScene(), "stick", t);
      const got = scene.rigid!.sample("stick", t)!;
      expect(got.x).toBeCloseTo(fitted.x, 1);
      expect(got.y).toBeCloseTo(fitted.y, 1);
      expect(Math.abs(angleDelta(got.rotation, fitted.rotation))).toBeLessThan(0.05);
    }
    // The fit really turns it (45° in the actor's frame, with the hand): not the prop's own 0°.
    expect(Math.abs(angleDelta(scene.rigid!.sample("stick", 1)!.rotation, 0))).toBeGreaterThan(5);
  });

  it("leaves the hand with its velocity and falls to the ground", async () => {
    const scene = await prepareScene(carryScene(), assets);
    const atRelease = scene.rigid!.sample("ball", 1.5)!;
    const hand = scripted(carryScene(), "ball", 1.5 - 1 / 120);
    expect(atRelease.x).toBeCloseTo(hand.x, 0);
    // Walking right: the ball keeps going right after the release.
    expect(scene.rigid!.sample("ball", 1.7)!.x).toBeGreaterThan(atRelease.x + 5);
    expect(scene.rigid!.sample("ball", 3)!.y).toBeGreaterThan(530);
  });

  it("can be baked again after a bake (the sampler of the first bake is not read)", async () => {
    const once = await prepareScene(carryScene(), assets);
    const twice = await prepareScene(carryScene(), assets);
    const again = (await import("../src")).bakeRigidBodies;
    await again(once);
    for (const t of [0.5, 2]) expect(once.rigid!.sample("ball", t)).toEqual(twice.rigid!.sample("ball", t));
  });
});

describe("rigid: rotation samples (M23)", () => {
  it("interpolates rotation the short way round across ±180°", async () => {
    const doc: SceneDoc = {
      format: "toon-scene",
      version: 1,
      width: 800,
      height: 600,
      fps: 25,
      duration: 1,
      characters: {},
      world: { gravity: [0, 0] },
      actors: [],
      props: [{ id: "wheel", art: "<circle r='20'/>", x: 400, y: 300, body: { type: "dynamic", shape: { circle: 20 }, angularVelocity: 720 } }],
    };
    const scene = await prepareScene(doc, { characters: {} });
    // Half a sample after 180°: between samples reading 180 and −174.
    for (const t of [0.25 + 1 / 240, 0.25 - 1 / 240, 0.37, 0.7501]) {
      const got = scene.rigid!.sample("wheel", t)!.rotation;
      expect(Math.abs(angleDelta(got, 720 * t))).toBeLessThan(0.5);
    }
  });
});

describe("rigid: kinematic props (M24)", () => {
  it("follows its tracks again after being held", async () => {
    const doc: SceneDoc = {
      format: "toon-scene",
      version: 1,
      width: 800,
      height: 600,
      fps: 30,
      duration: 3,
      characters: { pip: "pip.toon.json" },
      world: { gravity: [0, 2000], ground: 560 },
      actors: [{ id: "p", character: "pip", x: 400, y: 500 }],
      props: [{ id: "box", art: "<rect width='40' height='40'/>", x: 100, y: 100, body: { type: "kinematic", shape: { box: [40, 40] } } }],
      tracks: { "props.box.x": [[0, 100], [3, 700]] },
      script: [
        { action: "grab", actor: "p", at: 0.5, prop: "box", anchor: "handNear" },
        { action: "release", actor: "p", at: 1, prop: "box" },
      ],
    };
    const scene = await prepareScene(doc, assets);
    // Before, during and after the grab: the tracks, the hand, the tracks again (not stuck in the hand).
    for (const t of [0.25, 0.75, 1.5, 2]) {
      const want = scripted(doc, "box", t);
      const got = scene.rigid!.sample("box", t)!;
      expect(got.x, `x at ${t}`).toBeCloseTo(want.x, 1);
      expect(got.y, `y at ${t}`).toBeCloseTo(want.y, 1);
    }
    // The hand really was somewhere else than the track.
    expect(Math.abs(scripted(doc, "box", 0.75).y - 100)).toBeGreaterThan(50);
  });
});
