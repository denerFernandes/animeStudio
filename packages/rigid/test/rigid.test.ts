import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type SceneDoc, type ToonDoc, compileScene, evaluateScene, frameToSVG } from "@animestudio/core";
import { describe, expect, it } from "vitest";
import { bakeRigidBodies, prepareScene } from "../src";

const root = join(__dirname, "../../../examples");
const pip = JSON.parse(readFileSync(join(root, "characters/pip.toon.json"), "utf8")) as ToonDoc;

const dropScene = (actors: SceneDoc["actors"] = []): SceneDoc => ({
  format: "toon-scene",
  version: 1,
  width: 800,
  height: 600,
  fps: 30,
  duration: 3,
  characters: { pip: "pip.toon.json" },
  world: { gravity: [0, 2000], ground: 500 },
  actors,
  props: [{ id: "ball", art: "<circle r='20'/>", x: 400, y: 100, body: { type: "dynamic", shape: { circle: 20 }, restitution: 0.5 } }],
});

describe("rigid bodies", () => {
  it("drops a ball onto the ground and settles", async () => {
    const scene = await prepareScene(dropScene(), { characters: { pip } });
    const end = scene.rigid!.sample("ball", 3)!;
    expect(end.y).toBeGreaterThan(470);
    expect(end.y).toBeLessThan(485);
  });

  it("is deterministic", async () => {
    const a = await prepareScene(dropScene(), { characters: { pip } });
    const b = await prepareScene(dropScene(), { characters: { pip } });
    for (const t of [0.4, 1.1, 2.5]) expect(a.rigid!.sample("ball", t)).toEqual(b.rigid!.sample("ball", t));
  });

  it("collides with character colliders", async () => {
    const scene = await prepareScene(dropScene([{ id: "p", character: "pip", x: 400, y: 500 }]), { characters: { pip } });
    // The ball lands on Pip's head instead of the ground.
    const y = scene.rigid!.sample("ball", 0.5)!.y;
    expect(y).toBeLessThan(300);
  });

  it("feeds the renderer", async () => {
    const scene = await bakeRigidBodies(compileScene(dropScene(), { characters: { pip } }));
    expect(frameToSVG(evaluateScene(scene, 1))).toContain("circle");
  });
});
