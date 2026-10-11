import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type ToonDoc, compileRig, evaluatePose, makeTrack, sampleTrack, validateToon } from "@animestudio/core";
import { type CartoonLook, type HumanLook, cartoonCharacter, gait, humanCharacter, personalityGaits } from "../src";

type Keys = (number | string)[][];
type Clip = { duration: number; loop: boolean; stride: number; tracks: Record<string, Keys> };

const kid: CartoonLook = {
  name: "kid", build: "kid", skin: "#f6d3b5", hair: "ponytail", hairColor: "#5a3a22", accent: "#ff4fa0",
  top: "shirt", topColor: "#ffffff", pattern: "pinstripes", pocketItem: { color: "#ffffff" }, earItem: "cigarette",
  bottom: "bermuda", bottomColor: "#3a62b0", shoes: "sneakers", glasses: "sun", hat: "capBack", tie: "#a8202f",
};
const man = { name: "man", build: "man", skin: "#e0b08a", hair: "sidePart", hairColor: "#222", top: "polo", topColor: "#2b6", bottom: "pants", bottomColor: "#334", shoes: "sneakers" } as CartoonLook;
const ana: HumanLook = { name: "ana", skin: "#f2c7a5", hair: "ponytail", hairColor: "#6b3e26", iris: "#3f8f4e", outfit: "tee", top: "#2ec4b6", pants: "#3b4a6b", shoes: "#ff6fa3" };

const WALKS = ["sneak", "strut", "tired", "march", "scaredRun"] as const;
const builders: [string, () => ToonDoc, string | undefined][] = [
  ["humanCharacter", () => humanCharacter(ana), undefined],
  // The 2.5D cartoon is checked in the true side view (the three-quarter view foreshortens x).
  ["cartoonCharacter", () => cartoonCharacter(kid), "side"],
];
const clipsOf = (doc: ToonDoc) => (doc as unknown as { clips: Record<string, Clip> }).clips;
const track = (keys: Keys, d: number) => makeTrack(keys.map((k) => ({ t: k[0] as number, v: k[1] as number, ease: k[2] as never })), { loop: { duration: d } });
const play = (clip: string, view?: string) => ({
  clips: [{ clip, start: 0, end: Infinity, speed: 1, loop: true, fadeIn: 0, fadeOut: 0, layer: 0, blend: "override" as const, weight: 1 }],
  controls: view ? { view } : undefined,
});

describe.each(builders)("personality walks (%s)", (_name, build, view) => {
  const doc = build();
  const clips = clipsOf(doc);
  const rig = compileRig(doc);

  it("has the five clips as plain looping clips with a stride, and the doc validates", () => {
    expect(validateToon(doc).ok).toBe(true);
    for (const name of WALKS) {
      const c = clips[name];
      expect(c, name).toBeDefined();
      expect(c.loop).toBe(true);
      expect(c.stride).toBeGreaterThan(0);
      expect(Object.keys(c).sort()).toEqual(["duration", "loop", "stride", "tracks"]);
    }
    expect(clips.sneak.duration).toBe(0.9);
    expect(clips.strut.duration).toBe(0.6);
    expect(clips.tired.duration).toBe(0.95);
    expect(clips.march.duration).toBe(0.5);
    expect(clips.scaredRun.duration).toBe(0.36);
  });

  it("strides come from the planted feet's travel, scaled from the walk and run", () => {
    for (const name of WALKS) {
      const c = clips[name], d = c.duration;
      const F = track(c.tracks["ik.footF.x"], d), B = track(c.tracks["ik.footB.x"], d);
      const travel = Math.abs((sampleTrack(F, 0) as number) - (sampleTrack(F, d / 2) as number)) + Math.abs((sampleTrack(B, d / 2) as number) - (sampleTrack(B, d) as number));
      expect(c.stride, name).toBeCloseTo(travel, 6);
    }
    const w = clips.walk.stride;
    expect(clips.sneak.stride / w).toBeCloseTo(0.6, 1);
    expect(clips.strut.stride / w).toBeCloseTo(1.1, 1);
    expect(clips.tired.stride / w).toBeCloseTo(0.8, 1);
    expect(clips.march.stride / w).toBeCloseTo(1, 1);
    expect(clips.scaredRun.stride).toBe(clips.run.stride);
  });

  it("evaluates at 8 phases without NaN", () => {
    for (const name of WALKS) {
      const d = clips[name].duration;
      for (let k = 0; k < 8; k++) {
        const p = evaluatePose(rig, { time: (k / 8) * d, ...play(name, view) } as never);
        expect(p.world.every((m) => m.every(Number.isFinite)), `${name} @${k}/8`).toBe(true);
      }
    }
  });

  it("the planted foot does not slide: its target and its drawn foot advance with the stride", () => {
    const fi = rig.boneIndex.get("footF")!, bi = rig.boneIndex.get("footB")!;
    for (const name of WALKS) {
      const c = clips[name], d = c.duration, v = c.stride / d;
      // Targets: x + stride·t/d constant while planted (near foot first half, far foot second).
      const F = track(c.tracks["ik.footF.x"], d), B = track(c.tracks["ik.footB.x"], d);
      for (let k = 0; k <= 10; k++) {
        const t = (k / 10) * (d / 2);
        expect((sampleTrack(F, t) as number) + v * t).toBeCloseTo(sampleTrack(F, 0) as number, 6);
        expect((sampleTrack(B, d / 2 + t) as number) + v * t).toBeCloseTo(sampleTrack(B, d / 2) as number, 6);
      }
      // The posed feet (IK, the 2.5D projection): within a pixel or so of a fixed point.
      for (const [bone, from] of [[fi, 0], [bi, d / 2]] as const) {
        const xs: number[] = [];
        for (let k = 1; k < 10; k++) {
          const t = from + (k / 10) * (d / 2);
          xs.push(evaluatePose(rig, { time: t, ...play(name, view) } as never).world[bone][4] + v * t);
        }
        expect(Math.max(...xs) - Math.min(...xs), name).toBeLessThan(1.5);
      }
    }
  });

  it("shapes the hands: fists for strut and march, open for the others", () => {
    for (const name of WALKS) {
      const c = clips[name];
      const want = name === "strut" || name === "march" ? "fist" : "open";
      expect(c.tracks["parts.handF.variant"][0][1], name).toBe(want);
      expect(c.tracks["parts.handB.variant"][0][1], name).toBe(want);
    }
  });

  it("keeps head-lag loops seamless", () => {
    for (const name of WALKS) {
      const c = clips[name], keys = c.tracks["bones.head.rotation"];
      expect(keys[0][0]).toBe(0);
      expect(keys[keys.length - 1][0]).toBeCloseTo(c.duration, 6);
      expect(keys[keys.length - 1][1]).toBe(keys[0][1]);
    }
  });
});

describe("walk and run are unchanged", () => {
  const snap = JSON.parse(readFileSync(new URL("./fixtures/walk-snapshot.json", import.meta.url), "utf8"));
  const docs: Record<string, ToonDoc> = { cartoonKid: cartoonCharacter(kid), cartoonMan: cartoonCharacter(man), human: humanCharacter(ana) };
  it.each(Object.keys(docs))("%s", (k) => {
    const clips = clipsOf(docs[k]);
    expect(JSON.parse(JSON.stringify(clips.walk))).toEqual(snap[k].walk);
    expect(JSON.parse(JSON.stringify(clips.run))).toEqual(snap[k].run);
  });
});

describe("gait options", () => {
  const base = { a: 20, lift: 12, dur: 0.8, bob: 3, lean: 2, armSwing: 20 };
  const at = (keys: Keys, d: number, t: number) => sampleTrack(track(keys, d), t) as number;

  it("headLag delays the head's bob and wraps the loop", () => {
    const plain = gait(base).tracks["bones.head.rotation"];
    const late = gait({ ...base, headLag: 0.2 }).tracks["bones.head.rotation"];
    expect(late[0][1]).toBe(late[late.length - 1][1]);
    expect(late[late.length - 1][0]).toBeCloseTo(base.dur, 6);
    // The rest value (an extreme) now comes 0.2 of the cycle late.
    expect(late.some((k) => Math.abs((k[0] as number) - 0.16) < 1e-6 && k[1] === plain[0][1])).toBe(true);
    for (const t of [0.1, 0.3, 0.5]) expect(at(late, 0.8, t + 0.16)).toBeCloseTo(at(plain, 0.8, t), 0);
  });

  it("crouch, tiptoe, knee and drag shape the feet and hips", () => {
    const c = gait({ ...base, crouch: 0.2, leg: 150 }).tracks;
    expect(c["bones.hips.y"][0][1]).toBe(33); // bob 3 + 0.2 × 150
    const tip = gait({ ...base, tiptoe: true, foot: 20 }).tracks;
    expect(tip["ik.footF.y"][0][1]).toBeLessThan(-8); // the ankle up on the ball of the foot
    expect(tip["ik.footF.y"][1][1]).toBe(tip["ik.footF.y"][0][1]); // held while planted
    expect(tip["bones.footF.rotation"][0][1]).toBe(40);
    const peak = (t: Record<string, Keys>) => Math.min(...t["ik.footF.y"].map((k) => k[1] as number));
    expect(peak(gait({ ...base, knee: 1, leg: 150 }).tracks)).toBeLessThan(peak(gait(base).tracks) - 30);
    expect(peak(gait({ ...base, drag: 0.8 }).tracks)).toBeGreaterThan(peak(gait(base).tracks) / 2);
    // Dragged: at the top of the swing the foot is still behind.
    expect(gait({ ...base, drag: 1 }).tracks["ik.footF.x"][2][1]).toBeLessThan(0);
  });

  it("sway follows the planted foot; doubleBounce bobs twice a step; slump bends the torso", () => {
    const s = gait({ ...base, sway: 6 }).tracks;
    // Near foot planted in the first half: its hip up (spread +) at mid-stance, the torso back.
    expect(s["bones.hips.spread"][1]).toEqual([0.2, 6]);
    expect(s["bones.hips.spread"][3]).toEqual([0.6000000000000001, -6]);
    expect(s["bones.body.spread"][1][1]).toBe(-6);
    const dbl = gait({ ...base, doubleBounce: true }).tracks["bones.hips.y"];
    expect(dbl.filter((k) => k[1] === -3)).toHaveLength(4);
    const sl = gait({ ...base, slump: 12 }).tracks;
    expect(sl["bones.body.rotation"][0][1]).toBe(14);
  });

  it("arm styles", () => {
    const style = (armStyle: "swing" | "pump" | "hang" | "up") => gait({ ...base, armStyle, slump: 10 }).tracks;
    expect(style("swing")["bones.armF1.rotation"]).toEqual([[0, 20], [0.4, -20], [0.8, 20]]);
    expect(style("pump")["bones.armF2.rotation"][0][1]).toBe(-75);
    expect(style("up")["bones.armF1.rotation"][0][1]).toBeLessThan(-140);
    const hang = style("hang")["bones.armF1.rotation"];
    expect(hang[0][1]).toBe(hang[hang.length - 1][1]);
    // Plumb: about −0.9 × (lean + slump).
    const vals = hang.map((k) => k[1] as number);
    expect((Math.max(...vals) + Math.min(...vals)) / 2).toBeCloseTo(-10.8, 1);
  });

  it("personalityGaits scales the walk and run", () => {
    const g = personalityGaits(base, { ...base, a: 40, dur: 0.4 }, { leg: 150, foot: 20 });
    expect(g.sneak).toMatchObject({ dur: 0.9, crouch: 0.18, knee: 0.8, tiptoe: true, a: 12 });
    expect(g.strut).toMatchObject({ dur: 0.6, slump: -4, sway: 6, armStyle: "pump", doubleBounce: true, a: 22 });
    expect(g.tired).toMatchObject({ dur: 0.95, slump: 12, drag: 0.7, armStyle: "hang", bob: 1, a: 16 });
    expect(g.march).toMatchObject({ dur: 0.5, knee: 1, armStyle: "pump", sway: 0, a: 20 });
    expect(g.scaredRun).toMatchObject({ dur: 0.36, armStyle: "up", lean: 12, a: 40 });
  });

  it("2.5D rigs: the planted feet stay on the ground through a crouch (hip-relative leg IK)", () => {
    const doc = cartoonCharacter(kid);
    const rig = compileRig(doc);
    const fi = rig.boneIndex.get("footF")!;
    const d = clipsOf(doc).sneak.duration;
    const ys = [1, 3, 5, 7, 9].map((k) => evaluatePose(rig, { time: (k / 10) * (d / 2), ...play("sneak", "side") } as never).world[fi][5]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.5);
    // On tiptoe: the ankle well above where it rests.
    const rest = evaluatePose(rig, { time: 0, controls: { view: "side" } } as never).world[fi][5];
    expect(ys[0]).toBeLessThan(rest - 8);
  });
});
