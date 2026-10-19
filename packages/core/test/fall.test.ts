import { describe, expect, it } from "vitest";
import {
  type ActionDef,
  type CompiledActor,
  type SceneDoc,
  type ToonDoc,
  actorPlacement,
  apply,
  compileRig,
  compileScene,
  groundParts,
  hipBone,
  lyingPose,
  sampleTrack,
  validateScene,
} from "../src";

// Knock-downs (`fall` / `getUp` actions and the `lyingPose` geometry): the whole actor turns and
// moves (never a bone), the back lands exactly on the floor in both facings, the shadow on the
// floor goes and comes back, a walk under way is taken over, and the geometry is the director's.

/** A small 2D biped: a hunched head (in front of the hips), leg chains standing on the floor, a shadow on `ground`. */
const biped: ToonDoc = {
  format: "toon",
  version: 1,
  name: "biped",
  art: { box: "<rect x='-10' y='-10' width='20' height='20'/>", shadow: "<ellipse rx='30' ry='6'/>" },
  skeleton: [
    { id: "root" },
    { id: "ground" },
    { id: "hips", parent: "root", from: [0, -80], to: [0, -90] },
    { id: "body", parent: "hips", from: [0, -80], to: [10, -150] },
    { id: "neck", parent: "body", from: [10, -150], to: [24, -165] },
    { id: "head", parent: "neck", from: [24, -165], to: [30, -200] },
    { id: "legF1", parent: "hips", from: [0, -80], to: [0, -40] },
    { id: "legF2", parent: "legF1", from: [0, -40], to: [0, 0] },
    { id: "legB1", parent: "hips", from: [0, -80], to: [0, -40] },
    { id: "legB2", parent: "legB1", from: [0, -40], to: [0, 0] },
  ],
  parts: [
    { id: "shadow", type: "rigid", bone: "ground", art: "shadow" },
    { id: "torso", type: "rigid", bone: "body", art: "box" },
    { id: "skull", type: "rigid", bone: "head", art: "box" },
  ],
  anchors: { head: { bone: "head", at: [28, -185] } },
  ik: [
    { id: "footF", bones: ["legF1", "legF2"], mix: 1 },
    { id: "footB", bones: ["legB1", "legB2"], mix: 1 },
  ],
  clips: {
    walk: { duration: 1, loop: true, stride: 100, tracks: { "bones.body.rotation": [[0, 2], [0.5, -2], [1, 2]] } },
    knocked: { duration: 0.85, tracks: { "ik.footF.mix": [[0, 1], [0.1, 0]], "bones.legF1.rotation": [[0, 0], [0.85, -90]] } },
    down: { duration: 2, tracks: { "ik.footF.mix": [[0, 0], [2, 0]], "bones.legF1.rotation": [[0, -90], [0.4, 0]] } },
  },
};

const FLOOR = 500;
function scene(script: ActionDef[], o: { flip?: boolean; scale?: number | [number, number]; actors?: SceneDoc["actors"]; world?: SceneDoc["world"] } = {}): SceneDoc {
  return {
    format: "toon-scene",
    version: 1,
    width: 1600,
    height: 700,
    fps: 30,
    duration: 8,
    characters: { b: "b" },
    ...(o.world ? { world: o.world } : {}),
    actors: o.actors ?? [
      { id: "a", character: "b", x: 800, y: FLOOR, ...(o.flip ? { flip: true } : {}), ...(o.scale !== undefined ? { scale: o.scale } : {}) },
      { id: "hitter", character: "b", x: 700, y: FLOOR },
    ],
    script,
  } as unknown as SceneDoc;
}
const compile = (doc: SceneDoc) => compileScene(doc, { characters: { b: biped } });
const actor = (sc: ReturnType<typeof compile>, id = "a") => sc.actors.find((x) => x.id === id)! as CompiledActor;
const channel = (a: CompiledActor, ch: string, t: number) => {
  const tr = a.tracks.find((x) => x.channel === ch);
  return tr ? (sampleTrack(tr.track, t) as number) : undefined;
};
const rotationAt = (a: CompiledActor, t: number) => sampleTrack(a.placement.rotation!, t) as number;

/** The director's `lying()` before it used the shared helper (the parity reference). */
function directorLying(doc: ToonDoc, dir: number, side: "back" | "front", s: number, hip: [number, number], depth: number, height: number) {
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  let head: [number, number] = (doc.anchors?.head?.at as [number, number] | undefined) ?? [0, -height * 0.85];
  const lean = (h: [number, number]) => (Math.atan2(h[0] - hip[0], -(h[1] - hip[1])) * 180) / Math.PI;
  const neckBone = doc.skeleton.find((b) => b.id === "neck" && b.from) ?? doc.skeleton.find((b) => b.id === "head" && b.from);
  let neck: { bone: string; rotation: number } | undefined;
  if (neckBone?.from) {
    const rot = Math.max(-60, Math.min(60, -lean(head)));
    const a = (rot * Math.PI) / 180, [cx, cy] = neckBone.from as [number, number];
    head = [cx + (head[0] - cx) * Math.cos(a) - (head[1] - cy) * Math.sin(a), cy + (head[0] - cx) * Math.sin(a) + (head[1] - cy) * Math.cos(a)];
    if (Math.abs(rot) > 1) neck = { bone: neckBone.id, rotation: r3(rot) };
  }
  const rest = lean(head);
  const v = [head[0] - hip[0], head[1] - hip[1]];
  const len = Math.hypot(v[0], v[1]) || 1;
  const normal = [v[1] / len, -v[0] / len];
  const back = side === "back";
  const contact: [number, number] = [hip[0] + (back ? 1 : -1) * normal[0] * depth, hip[1] + (back ? 1 : -1) * normal[1] * depth];
  const rotation = r3(back ? -dir * (90 + rest) : dir * (90 - rest));
  const r = (rotation * Math.PI) / 180;
  const px = contact[0] * dir * s, py = contact[1] * s;
  return { rotation, contact, offset: [px * Math.cos(r) - py * Math.sin(r), px * Math.sin(r) + py * Math.cos(r)], neck };
}

describe("lyingPose", () => {
  const rig = compileRig(biped);

  it("is the director's lying geometry, given the same measures of the body", () => {
    for (const dir of [1, -1] as const)
      for (const side of ["back", "front"] as const)
        for (const s of [0.5, 1.3]) {
          const ref = directorLying(biped, dir, side, s, [0, -80], 20, 200);
          const g = lyingPose(rig, { dir, side, scale: s, hip: [0, -80], depth: 20, skull: false });
          expect(g.rotation).toBeCloseTo(ref.rotation, 6);
          expect(g.contact[0]).toBeCloseTo(ref.contact[0], 6);
          expect(g.contact[1]).toBeCloseTo(ref.contact[1], 6);
          expect(g.offset[0]).toBeCloseTo(ref.offset[0], 6);
          expect(g.offset[1]).toBeCloseTo(ref.offset[1], 6);
          expect(g.neck).toEqual(ref.neck);
        }
  });

  it("finds the hip joint on the leg chains, the neck bone and a depth from the skeleton", () => {
    const g = lyingPose(rig);
    expect(g.hip).toEqual([0, -80]);
    expect(g.neck?.bone).toBe("neck");
    // A hunched head: the neck bends back so the head lines up with the spine.
    expect(g.neck!.rotation).toBeLessThan(-1);
    // 70% of the smaller of 34 px and 12% of the height (200).
    expect(g.depth).toBeCloseTo(0.7 * 24, 6);
    // Lying, the back's resting point is below the origin (the feet, on the spine's line): the
    // actor's y lying is the floor's minus offset[1].
    expect(g.offset[1]).toBeGreaterThan(0);
  });

  it("on a 2.5D character: the torso's depth as drawn, the hip joint of its legs, a big head lifted by the neck", async () => {
    const kit = await import("../../kit/src");
    const look = { name: "Kai", build: "teen", skin: "#f2c9a6", hair: "spiky", hairColor: "#2b3a8c", top: "tee", topColor: "#ffc93c", bottom: "shorts", bottomColor: "#2ec4b6", shoes: "sneakers" } as const;
    const doc = kit.cartoonCharacter(look as never);
    const info = kit.cartoonInfo(doc, look as never);
    const cr = compileRig(doc);
    const side = lyingPose(cr, { view: "side", skull: false });
    expect(side.hip[0]).toBeCloseTo(info.hip![0], 0);
    expect(side.hip[1]).toBeCloseTo(info.hip![1], 0);
    expect(side.depth).toBeCloseTo(info.depth!.back, -0.5);
    // Its head reaches farther out of the back than the torso: the neck lifts it (chin towards the
    // chest, up to the neck's limit), whatever is left raises the head end of the body.
    const lifted = lyingPose(cr, { view: "side" });
    expect(lifted.neck!.rotation).toBeGreaterThan(side.neck?.rotation ?? 0);
    expect(lifted.tilt).toBeGreaterThanOrEqual(side.tilt);
    expect(side.tilt).toBeGreaterThanOrEqual(0);
    // (The tilt raises the head end: lying on the back facing right, the rotation grows by it.)
    expect(lifted.rotation - lifted.tilt).toBeCloseTo(side.rotation - side.tilt, 2);
    // From the front the same bend is a sideways one (`spread`), split by the view's yaw.
    const front = lyingPose(cr, { view: "front" });
    expect(Math.abs(front.neck!.rotation)).toBeLessThan(0.01);
    expect(front.neck!.spread).toBeGreaterThan(1);
  });

  it("names the parts drawn only on the `ground` bone", () => {
    expect(groundParts(rig)).toEqual(["shadow"]);
  });
});

describe("fall and getUp", () => {
  const rig = compileRig(biped);

  it("lands the back exactly on the floor, both facings, with a scale, and keeps it there", () => {
    for (const flip of [false, true])
      for (const scale of [1, 0.6, [0.8, 1.1] as [number, number]]) {
        const sc = compile(scene([{ at: 1, actor: "a", action: "fall", from: "hitter" } as ActionDef], { flip, scale }));
        const a = actor(sc);
        const [sx, sy] = Array.isArray(scale) ? scale : [scale, scale];
        const g = lyingPose(rig, { dir: flip ? -1 : 1, scale: [sx, sy] });
        // Settled: the resting point of the back on the floor, the body turned to lying.
        for (const t of [3, 4, 6]) {
          expect(apply(actorPlacement(a, t), g.contact)[1], `flip ${flip} scale ${scale} t ${t}`).toBeCloseTo(FLOOR, 3);
          expect(rotationAt(a, t)).toBeCloseTo(g.rotation, 3);
        }
        // From the hips touching down (0.85 s after the hit) through the bounce: never into the floor.
        for (let t = 1.85; t < 3; t += 1 / 60) expect(apply(actorPlacement(a, t), g.contact)[1]).toBeLessThanOrEqual(FLOOR + 1e-6);
        // Thrown away from the hitter (who stands on its left): the hips land well to the right,
        // whichever way the body faces (facing left, its feet then lie back towards the hitter).
        expect(apply(actorPlacement(a, 4), g.contact)[0], `flip ${flip} scale ${scale}`).toBeGreaterThan(800 + 80 * sx);
      }
  });

  it("hides the shadow on the floor while down and shows it again after getUp, back upright", () => {
    const sc = compile(scene([
      { at: 1, actor: "a", action: "fall" },
      { at: 4, actor: "a", action: "getUp", duration: 0.8 },
    ] as ActionDef[]));
    const a = actor(sc);
    expect(channel(a, "parts.shadow.opacity", 0.9)).toBe(1);
    expect(channel(a, "parts.shadow.opacity", 2)).toBe(0);
    expect(channel(a, "parts.shadow.opacity", 3.9)).toBe(0);
    expect(channel(a, "parts.shadow.opacity", 5)).toBe(1);
    expect(rotationAt(a, 3.9)).toBeCloseTo(lyingPose(rig).rotation, 3);
    expect(rotationAt(a, 5)).toBeCloseTo(0, 6);
    expect(apply(actorPlacement(a, 5), [0, 0])[1]).toBeCloseTo(FLOOR, 6);
    // The neck straightens again; the lying clip lets go.
    expect(channel(a, "bones.neck.rotation", 3)).toBeLessThan(-1);
    expect(channel(a, "bones.neck.rotation", 5)).toBeCloseTo(0, 6);
    const down = a.clips.find((c) => c.clip === "down")!;
    expect(down.start).toBeCloseTo(1 + 0.45, 6);
    expect(down.end).toBeLessThan(5);
  });

  it("plays the flight clip until the hips touch down, then the lying clip, held", () => {
    const sc = compile(scene([{ at: 1, actor: "a", action: "fall", from: "hitter", duration: 0.6 }] as ActionDef[]));
    const a = actor(sc);
    const knocked = a.clips.find((c) => c.clip === "knocked")!;
    const down = a.clips.find((c) => c.clip === "down")!;
    expect(knocked.loop).toBe(false);
    // Played at the speed that ends it as the hips land.
    expect(knocked.speed).toBeCloseTo(0.85 / 0.6, 6);
    expect(down.start).toBeCloseTo(1.6, 6);
    expect(down.end).toBe(Infinity);
    expect(knocked.end).toBeGreaterThan(down.start);
    // `null`: none.
    const bare = actor(compile(scene([{ at: 1, actor: "a", action: "fall", clip: null, pose: null }] as ActionDef[])));
    expect(bare.clips.some((c) => c.clip === "knocked" || c.clip === "down")).toBe(false);
  });

  it("gets up by sitting up about the hips into a crouch, then standing, the feet never below the floor", () => {
    expect(hipBone(rig)).toBe("hips");
    const sc = compile(scene([
      { at: 1, actor: "a", action: "fall" },
      { at: 4, actor: "a", action: "getUp", duration: 1.2 },
    ] as ActionDef[]));
    const a = actor(sc);
    const hips = (t: number) => channel(a, "bones.hips.y", t) ?? 0;
    for (let t = 4; t <= 5.3; t += 1 / 60) expect(apply(actorPlacement(a, t), [0, 0])[1], `t ${t}`).toBeLessThanOrEqual(FLOOR + 1e-6);
    // Upright half-way (sitting up), in a crouch: the hips lowered, the feet on the floor.
    expect(rotationAt(a, 4.6)).toBeCloseTo(0, 6);
    expect(hips(4.6)).toBeGreaterThan(20);
    expect(apply(actorPlacement(a, 4.6), [0, 0])[1]).toBeCloseTo(FLOOR, 6);
    // Sitting up turns about the hip joint: it barely moves along x while the body comes up.
    const g = lyingPose(rig);
    const hipX = (t: number) => apply(actorPlacement(a, t), [g.hip[0], g.hip[1] + hips(t)])[0];
    expect(Math.abs(hipX(4.6) - hipX(4))).toBeLessThan(2);
    // Then standing: the hips rise back over the planted feet.
    expect(hips(5.3)).toBe(0);
    expect(apply(actorPlacement(a, 5.3), [0, 0])[0]).toBeCloseTo(apply(actorPlacement(a, 4.6), [0, 0])[0], 6);
  });

  it("takes over a walk under way", () => {
    const sc = compile(scene([
      { at: 0, actor: "a", action: "walkTo", x: 1400, duration: 3 },
      { at: 1, actor: "a", action: "fall" },
    ] as ActionDef[]));
    const a = actor(sc);
    const walk = a.clips.find((c) => c.clip === "walk")!;
    expect(walk.end).toBeCloseTo(1.12, 6);
    const x1 = apply(actorPlacement(a, 1), [0, 0])[0];
    expect(x1).toBeGreaterThan(950);
    // It falls where it was — the hips sit down behind the feet, the walk's momentum carries them on
    // a little — not on to the walk's end.
    const x = apply(actorPlacement(a, 5), lyingPose(rig).contact)[0];
    expect(Math.abs(x - x1)).toBeLessThan(100);
    const still = actor(compile(scene([{ at: 1, actor: "a", action: "fall" }] as ActionDef[])));
    const moved = (b: CompiledActor) => apply(actorPlacement(b, 5), lyingPose(rig).contact)[0] - apply(actorPlacement(b, 1), [0, 0])[0];
    expect(moved(a)).toBeGreaterThan(moved(still) + 20);
  });

  it("falls onto a ground surface (its height over it) and gets up on it", () => {
    const sc = compile(scene([
      { at: 1, actor: "a", action: "fall" },
      { at: 4, actor: "a", action: "getUp" },
    ] as ActionDef[], { world: { surfaces: [{ id: "floor", path: "M0 400 L1600 400" }] }, actors: [{ id: "a", character: "b", x: 800, y: 0, ground: { surface: "floor" } }] }));
    const a = actor(sc);
    const g = lyingPose(rig);
    expect(apply(actorPlacement(a, 3), g.contact)[1]).toBeCloseTo(400, 3);
    expect(apply(actorPlacement(a, 6), [0, 0])[1]).toBeCloseTo(400, 6);
  });

  it("reports what cannot be", () => {
    expect(() => compile(scene([{ at: 1, actor: "a", action: "getUp" }] as ActionDef[]))).toThrow(/not down/);
    expect(() => compile(scene([{ at: 1, actor: "a", action: "fall" }, { at: 2, actor: "a", action: "fall" }] as ActionDef[]))).toThrow(/already down/);
    expect(() => compile(scene([{ at: 1, actor: "a", action: "fall" }, { at: 2, actor: "a", action: "face", direction: "left" }] as ActionDef[]))).toThrow(/getUp first/);
    expect(() => compile(scene([{ at: 1, actor: "a", action: "fall" }, { at: 2, actor: "a", action: "walkTo", x: 100, duration: 1 }] as ActionDef[]))).toThrow(/getUp first/);
    expect(() => compile(scene([{ at: 1, actor: "a", action: "fall", clip: "nope" }] as ActionDef[]))).toThrow(/unknown flight clip "nope"/);
    expect(() => compile(scene([{ at: 1, actor: "a", action: "fall", from: "a" }] as ActionDef[]))).toThrow(/away from itself/);
    expect(validateScene(scene([{ at: 1, actor: "a", action: "fall", side: "left" }] as unknown as ActionDef[])).ok).toBe(false);
    expect(validateScene(scene([{ at: 1, actor: "a", action: "fall", distance: -5 }] as unknown as ActionDef[])).ok).toBe(false);
    expect(validateScene(scene([{ at: 1, actor: "a", action: "getUp", duration: 0 }] as unknown as ActionDef[])).ok).toBe(false);
    expect(validateScene(scene([{ at: 1, actor: "a", action: "fall", from: "hitter", side: "front", spin: true }, { at: 3, actor: "a", action: "getUp", clip: null }] as ActionDef[])).ok).toBe(true);
  });
});
