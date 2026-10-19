import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type ToonDoc, type V3, actorPlacement, actorPose, apply, compileRig, compileScene, evaluatePose, makeTrack, multiply, sampleTrack, validateToon, viewPoint } from "@animestudio/core";
import { type CartoonLook, type HumanLook, cartoonCharacter, gait, humanCharacter, personalityGaits, skirtRun } from "../src";

type Keys = (number | string)[][];
type Clip = { duration: number; loop: boolean; stride: number; clear?: boolean; tracks: Record<string, Keys> };

const kid: CartoonLook = {
  name: "kid", build: "kid", skin: "#f6d3b5", hair: "ponytail", hairColor: "#5a3a22", accent: "#ff4fa0",
  top: "shirt", topColor: "#ffffff", pattern: "pinstripes", pocketItem: { color: "#ffffff" }, earItem: "cigarette",
  bottom: "bermuda", bottomColor: "#3a62b0", shoes: "sneakers", glasses: "sun", hat: "capBack", tie: "#a8202f",
};
const man = { name: "man", build: "man", skin: "#e0b08a", hair: "sidePart", hairColor: "#222", top: "polo", topColor: "#2b6", bottom: "pants", bottomColor: "#334", shoes: "sneakers" } as CartoonLook;
const child = { name: "child", build: "child", skin: "#c98f6a", hair: "afro", hairColor: "#1e1410", top: "tee", topColor: "#2ec4b6", bottom: "shorts", bottomColor: "#ff6b5b", shoes: "sneakers" } as CartoonLook;
const ana: HumanLook = { name: "ana", skin: "#f2c7a5", hair: "ponytail", hairColor: "#6b3e26", iris: "#3f8f4e", outfit: "tee", top: "#2ec4b6", pants: "#3b4a6b", shoes: "#ff6fa3" };

const WALKS = ["sneak", "strut", "tired", "march", "scaredRun"] as const;
const LOCOMOTION = ["walk", "run", ...WALKS] as const;
const RUNS = ["run", "scaredRun"] as const;
const builders: [string, () => ToonDoc, string | undefined][] = [
  ["humanCharacter", () => humanCharacter(ana), undefined],
  // The 2.5D cartoon is checked in the true side view (the three-quarter view foreshortens x).
  ["cartoonCharacter", () => cartoonCharacter(kid), "side"],
];
const clipsOf = (doc: ToonDoc) => (doc as unknown as { clips: Record<string, Clip> }).clips;
const track = (keys: Keys, d: number) => makeTrack(keys.map((k) => ({ t: k[0] as number, v: k[1] as number, ease: k[2] as never })), { loop: { duration: d } });
const at = (keys: Keys, d: number, t: number) => sampleTrack(track(keys, d), t) as number;
const play = (clip: string, view?: string) => ({
  clips: [{ clip, start: 0, end: Infinity, speed: 1, loop: true, fadeIn: 0, fadeOut: 0, layer: 0, blend: "override" as const, weight: 1 }],
  controls: view ? { view } : undefined,
});
/** A foot's planted stretches: from the key a run of `linear` keys starts at to the last of them. */
const planted = (keys: Keys): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = 1; i < keys.length; i++) {
    if (keys[i][2] !== "linear") continue;
    const t0 = keys[i - 1][0] as number, t1 = keys[i][0] as number, last = out[out.length - 1];
    if (last && Math.abs(last[1] - t0) < 1e-9) last[1] = t1;
    else out.push([t0, t1]);
  }
  return out;
};
/** The speed (px/s) of a foot's first planted (flat-footed) stretch, as keyed. */
const plantedSpeed = (keys: Keys) => {
  const i = keys.findIndex((k) => k[2] === "linear");
  return ((keys[i - 1][1] as number) - (keys[i][1] as number)) / ((keys[i][0] as number) - (keys[i - 1][0] as number));
};

describe.each(builders)("personality walks (%s)", (_name, build, view) => {
  const doc = build();
  const clips = clipsOf(doc);
  const rig = compileRig(doc);
  // A foot's ankle and its ball (where it rolls onto, pushing off or on tiptoe), and how high the
  // lower of them is above where it rests.
  const rest = evaluatePose(rig, { time: 0, controls: view ? { view } : undefined } as never).world;
  const foot = (s: "F" | "B") => rig.boneIndex.get(`foot${s}`)!;
  const point = (world: number[][], s: "F" | "B", ball: boolean) => apply(world[foot(s)] as never, [ball ? 0.7 * rig.bones[foot(s)].length : 0, 0]);
  const height = (world: number[][], s: "F" | "B") => {
    const rs = Math.max(point(rest, s, false)[1], point(rest, s, true)[1]);
    return rs - Math.max(point(world, s, false)[1], point(world, s, true)[1]);
  };
  const knee = (world: number[][], s: "F" | "B") => {
    const o = (id: string) => world[rig.boneIndex.get(id)!];
    const h = o(`leg${s}1`), k = o(`leg${s}2`), f = o(`foot${s}`);
    const u = [k[4] - h[4], k[5] - h[5]], w = [f[4] - k[4], f[5] - k[5]];
    return (Math.acos((u[0] * w[0] + u[1] * w[1]) / Math.hypot(u[0], u[1]) / Math.hypot(w[0], w[1])) * 180) / Math.PI;
  };
  const pose = (name: string, t: number) => evaluatePose(rig, { time: t, ...play(name, view) } as never).world as unknown as number[][];

  it("has the locomotion clips as plain looping clips with a stride, kept clear of the face, and the doc validates", () => {
    expect(validateToon(doc).ok).toBe(true);
    for (const name of LOCOMOTION) {
      const c = clips[name];
      expect(c, name).toBeDefined();
      expect(c.loop).toBe(true);
      expect(c.clear, name).toBe(true);
      expect(c.stride).toBeGreaterThan(0);
      expect(Object.keys(c).sort()).toEqual(["clear", "duration", "loop", "stride", "tracks"]);
    }
    expect(clips.sneak.duration).toBe(2);
    expect(clips.strut.duration).toBe(0.6);
    expect(clips.tired.duration).toBe(0.95);
    expect(clips.march.duration).toBe(0.5);
    expect(clips.run.duration).toBe(0.6);
    // A faster cadence than the run's, never under nine frames at 30 fps.
    expect(clips.scaredRun.duration).toBe(0.41);
  });

  it("strides are the body's travel a cycle: the planted feet's speed × the cycle", () => {
    for (const name of LOCOMOTION) {
      const c = clips[name], d = c.duration;
      for (const s of ["F", "B"] as const) expect(c.stride, `${name} ${s}`).toBeCloseTo(plantedSpeed(c.tracks[`ik.foot${s}.x`]) * d, 6);
    }
    // Walks (each foot planted half the cycle): the planted travel itself. (The sneak's creep plants
    // each foot for 0.55 of the cycle: 2a ÷ 0.55, checked below.)
    for (const name of ["walk", "strut", "tired", "march"]) {
      const c = clips[name], d = c.duration;
      const F = track(c.tracks["ik.footF.x"], d), B = track(c.tracks["ik.footB.x"], d);
      const travel = Math.abs((sampleTrack(F, 0) as number) - (sampleTrack(F, d / 2) as number)) + Math.abs((sampleTrack(B, d / 2) as number) - (sampleTrack(B, d) as number));
      expect(c.stride, name).toBeCloseTo(travel, 6);
    }
    const w = clips.walk.stride;
    // The sneak: big steps (a × 1.9), each foot planted 0.55 of a slow cycle — farther a cycle than
    // the walk, at not much over half its speed (a slow, deliberate cycle of 2 s).
    expect(clips.sneak.stride / w).toBeCloseTo((1.9 * 2) / 0.55 / 4, 1);
    expect(clips.sneak.stride / clips.sneak.duration).toBeLessThan(0.6 * (w / clips.walk.duration));
    expect(clips.strut.stride / w).toBeCloseTo(1.1, 1);
    expect(clips.tired.stride / w).toBeCloseTo(0.8, 1);
    expect(clips.march.stride / w).toBeCloseTo(1, 1);
    // Runs: with flights the body goes farther than the planted feet — 2a ÷ the planted part of the
    // cycle (the foot planted from +a, flat, then rolling onto its ball to push off) — and the panic
    // sprint far faster than the run.
    for (const name of RUNS) {
      const c = clips[name], [[t0, t1]] = planted(c.tracks["ik.footF.x"]), a = c.tracks["ik.footF.x"][0][1] as number;
      expect(t0, name).toBe(0);
      expect(c.stride / (4 * a), name).toBeGreaterThan(1.3);
      expect(c.stride, name).toBeCloseTo(((2 * a) / t1) * c.duration, 0);
    }
    expect(clips.scaredRun.stride / clips.scaredRun.duration).toBeGreaterThan(1.8 * (clips.run.stride / clips.run.duration));
  });

  it("evaluates at 8 phases without NaN", () => {
    for (const name of LOCOMOTION) {
      const d = clips[name].duration;
      for (let k = 0; k < 8; k++) {
        const p = evaluatePose(rig, { time: (k / 8) * d, ...play(name, view) } as never);
        expect(p.world.every((m) => m.every(Number.isFinite)), `${name} @${k}/8`).toBe(true);
      }
    }
  });

  it("the planted foot does not slide: its target and its drawn foot advance with the stride", () => {
    for (const name of LOCOMOTION) {
      const c = clips[name], d = c.duration, v = c.stride / d;
      for (const s of ["F", "B"] as const) {
        const keys = c.tracks[`ik.foot${s}.x`];
        // Targets: x + stride·t/d constant along the flat-footed stretch.
        const i = keys.findIndex((k) => k[2] === "linear"), ta = keys[i - 1][0] as number, tb = keys[i][0] as number;
        for (let k = 0; k <= 10; k++) {
          const t = ta + (k / 10) * (tb - ta);
          expect(at(keys, d, t) + v * t, `${name} ${s}`).toBeCloseTo(at(keys, d, ta) + v * ta, 6);
        }
        // The drawn foot (IK, the 2.5D projection): its ball within a pixel or so of a fixed point
        // through the whole planted stretch (flat, then rolling onto it to push off).
        for (const [t0, t1] of planted(keys)) {
          const xs: number[] = [];
          for (let k = 1; k < 10; k++) {
            const t = t0 + (k / 10) * (t1 - t0);
            xs.push(point(pose(name, t), s, true)[0] + v * t);
          }
          expect(Math.max(...xs) - Math.min(...xs), `${name} ${s}`).toBeLessThan(1.5);
        }
      }
    }
  });

  it("the sneak: toe first and rolled flat about the ball, flat-footed, the knee high with a hold at the top, the hands raised in front of the chest", () => {
    const c = clips.sneak, d = c.duration, v = c.stride / d;
    for (const [s, p0] of [["F", 0], ["B", 0.5]] as const) {
      const rot = c.tracks[`bones.foot${s}.rotation`], y = c.tracks[`ik.foot${s}.y`];
      // Set down toe first (toe down), flat by 0.06 of the cycle and through 0.46 of it.
      expect(at(rot, d, p0 * d), s).toBeGreaterThan(10);
      for (let k = 0; k <= 8; k++) expect(Math.abs(at(rot, d, (p0 + 0.06 + (k / 8) * 0.4) * d)), `${s} flat @${k}`).toBeLessThan(0.5);
      // Rolled flat, the ball stays put (the drawn foot, with the body's travel).
      const xs = [0, 0.25, 0.5, 0.75, 1].map((u) => point(pose("sneak", (p0 + u * 0.06) * d), s, true)[0] + v * (p0 + u * 0.06) * d);
      expect(Math.max(...xs) - Math.min(...xs), s).toBeLessThan(1.5);
      // The knee high, held at the top: the foot near its highest through a fifth of the swing.
      const top = Math.min(...y.map((k) => k[1] as number));
      expect(-top, s).toBeGreaterThan(0.2 * c.stride);
      for (const u of [0.45, 0.55, 0.65]) expect(at(y, d, ((p0 + 0.55 + u * 0.45) % 1) * d), `${s} hold ${u}`).toBeLessThan(0.85 * top);
    }
    // The hands raised in front of the chest at every phase: above two thirds of the way up from
    // the hips to the neck, below the neck (y down).
    const b = (w: number[][], id: string) => w[rig.boneIndex.get(id)!];
    for (let k = 0; k < 8; k++) {
      const w = pose("sneak", (k / 8) * d), hip = b(w, "legF1")[5], neck = b(w, "head")[5];
      for (const h of ["handF", "handB"]) {
        expect(b(w, h)[5], `${h} @${k}`).toBeLessThan(hip + (2 / 3) * (neck - hip));
        expect(b(w, h)[5], `${h} @${k}`).toBeGreaterThan(neck);
      }
    }
  });

  it("runs: both feet off the ground between the steps, the hips lowest at mid-stance and highest in the air", () => {
    for (const name of RUNS) {
      const c = clips[name], d = c.duration;
      const [F] = planted(c.tracks["ik.footF.x"]), [B] = planted(c.tracks["ik.footB.x"]);
      // Planted for under half the cycle each (a third of it in a run, less in the sprint).
      expect(F[1] - F[0], name).toBeLessThan(0.4 * d);
      expect(B[0], name).toBeCloseTo(d / 2, 3);
      // In the air: both feet up (ankle and ball) through the middle of each flight.
      for (const [a, b] of [[F[1], B[0]], [B[1], d]]) {
        for (const u of [0.3, 0.5, 0.7]) {
          const w = pose(name, a + u * (b - a));
          expect(height(w, "F"), `${name} F in the air @${u}`).toBeGreaterThan(2);
          expect(height(w, "B"), `${name} B in the air @${u}`).toBeGreaterThan(2);
        }
      }
      // The hips (y down): lowest at mid-stance (the down), highest in mid-air.
      const hips = c.tracks["bones.hips.y"], ys = Array.from({ length: 48 }, (_, k) => at(hips, d, (k / 48) * d));
      expect(at(hips, d, (F[0] + F[1]) / 2), name).toBeCloseTo(Math.max(...ys), 1);
      expect(at(hips, d, (F[1] + B[0]) / 2), name).toBeCloseTo(Math.min(...ys), 1);
    }
  });

  it("runs: the stance leg is never locked straight, the planted foot stays on the ground, the swing knee folds", () => {
    for (const name of RUNS) {
      const c = clips[name], d = c.duration;
      for (const s of ["F", "B"] as const) {
        const [[t0, t1]] = planted(c.tracks[`ik.foot${s}.x`]);
        for (let k = 0; k <= 8; k++) {
          const t = t0 + (k / 8) * (t1 - t0), w = pose(name, t);
          expect(knee(w, s), `${name} ${s} stance knee @${k}/8`).toBeGreaterThan(15);
          expect(Math.abs(height(w, s)), `${name} ${s} planted @${k}/8`).toBeLessThan(1.5);
        }
      }
      let most = 0;
      for (let k = 0; k < 24; k++) most = Math.max(most, knee(pose(name, (k / 24) * d), "F"));
      // The heel kicked up behind: about a right angle in the run, near the buttocks in the sprint.
      expect(most, name).toBeGreaterThan(name === "run" ? 90 : 120);
      expect(most, name).toBeLessThan(160);
    }
  });

  it("shapes the hands: fists for the run, strut and march, open for the others", () => {
    for (const name of ["run", ...WALKS]) {
      const c = clips[name];
      const want = name === "run" || name === "strut" || name === "march" ? "fist" : "open";
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
    // The walk's tracks byte for byte as they were (the clip now marked `clear`).
    expect(JSON.parse(JSON.stringify(clips.walk))).toEqual({ ...snap[k].walk, clear: true });
    expect(JSON.parse(JSON.stringify(clips.run))).toEqual(snap[k].run);
  });
});

describe("the run's and the scared run's arms read from every side (2.5D)", () => {
  const mv = (R: number[], v: V3): V3 => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
  const mtv = (R: number[], v: V3): V3 => [R[0] * v[0] + R[3] * v[1] + R[6] * v[2], R[1] * v[0] + R[4] * v[1] + R[7] * v[2], R[2] * v[0] + R[5] * v[1] + R[8] * v[2]];
  const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const looks = [["kid", kid], ["man", man], ["child", child]] as const;
  const setup = (look: CartoonLook) => {
    const doc = cartoonCharacter(look) as unknown as { controls: { view: { poses: Record<string, unknown> } } };
    const rig = compileRig(doc as never), r3 = rig.rig3d!;
    // An arm's shoulder, elbow and hand (body space) in a frame.
    const arm = (f: NonNullable<ReturnType<typeof evaluatePose>["frame3d"]>, cl: (typeof r3.clear)[number]) => {
      const ia = r3.byIndex.get(cl.upper)!, ib = r3.byIndex.get(cl.lower)!;
      const S = f.pos[ia], E = f.pos[ib];
      return { S, E, H: add(E, mv(f.rot[ib], sub(r3.bones[ib].to, r3.bones[ib].from))) };
    };
    return { doc, rig, r3, arm };
  };

  it.each(looks)("never in the head nor drawn over it, in any view (%s)", (_n, look) => {
    const { doc, rig, r3, arm } = setup(look);
    for (const clip of RUNS) {
      const d = rig.clips[clip].duration;
      for (const view of Object.keys(doc.controls.view.poses)) {
        for (let i = 0; i < 16; i++) {
          const f = evaluatePose(rig, { time: (i / 16) * d, ...play(clip, view) } as never).frame3d!;
          for (const cl of r3.clear) {
            const { S, E, H } = arm(f, cl);
            for (const ko of cl.keepOut) {
              const K = r3.keepOut[ko], j = r3.byIndex.get(K.bone)!, R = f.rot[j], c = add(f.pos[j], mv(R, K.at));
              // In 3D: no point of the arm inside the head.
              for (const p of [lerp(S, E, 0.5), E, lerp(E, H, 0.5), H]) {
                const l = mtv(R, sub(p, c));
                expect(Math.hypot(l[0] / K.radii[0], l[1] / K.radii[1], l[2] / K.radii[2]), `${clip} ${view} @${i}`).toBeGreaterThan(0.98);
              }
              // In the picture: nothing of the arm drawn in front of the head over its outline.
              const vp = (p: V3) => viewPoint(p, f.yaw, f.pitch), c0 = vp(c);
              let A = 0, B = 0, C = 0;
              for (let m = 0; m < 3; m++) {
                const a = vp([R[m] * K.radii[m], R[3 + m] * K.radii[m], R[6 + m] * K.radii[m]]);
                A += a[0] * a[0];
                B += a[0] * a[1];
                C += a[1] * a[1];
              }
              const det = A * C - B * B, n11 = C / det, n12 = -B / det, n22 = A / det;
              for (const [a, b] of [[lerp(S, E, 0.5), E], [E, H]] as [V3, V3][]) {
                for (let u = 0; u <= 1.0001; u += 0.1) {
                  const p = vp(lerp(a, b, u));
                  if (!(p[2] > c0[2])) continue;
                  const dx = p[0] - c0[0], dy = p[1] - c0[1];
                  expect(Math.sqrt(n11 * dx * dx + 2 * n12 * dx * dy + n22 * dy * dy), `${clip} ${view} @${i}`).toBeGreaterThan(1);
                }
              }
            }
          }
        }
      }
    }
  });

  it.each(looks)("from the front each arm keeps to its own side: never across the body's middle, never over the crotch (%s)", (_n, look) => {
    const { rig, r3, arm } = setup(look);
    for (const clip of RUNS) {
      const d = rig.clips[clip].duration;
      for (let i = 0; i < 24; i++) {
        const f = evaluatePose(rig, { time: (i / 24) * d, ...play(clip, "front") } as never).frame3d!;
        const hip = f.pos[r3.byIndex.get(rig.boneIndex.get("legF1")!)!];
        for (const cl of r3.clear) {
          const { S, E, H } = arm(f, cl), side = Math.sign(S[0]);
          for (const p of [E, lerp(E, H, 0.5), H]) {
            // Outward of half the way from the middle to the shoulder (a run's hand comes in front
            // of the chest, short of its middle).
            expect(side * p[0], `${clip} @${i}`).toBeGreaterThan(0.5 * Math.abs(S[0]));
            // Below the hip joints, outside the hips.
            if (p[1] > hip[1]) expect(Math.abs(p[0]), `${clip} @${i}`).toBeGreaterThan(Math.abs(hip[0]) * 1.5);
          }
          // The scared run's hands are flung out past the shoulders (never clutched at the chest),
          // the forearm rising to them.
          if (clip === "scaredRun") {
            expect(side * H[0], `${clip} @${i}`).toBeGreaterThan(Math.abs(S[0]) * 1.3);
            expect(H[1], `${clip} @${i}`).toBeLessThan(E[1]);
          }
        }
      }
    }
  });
});

describe("walkTo keeps a 2.5D rig's planted feet in place in the picture, in any view", () => {
  const doc = cartoonCharacter(kid);
  // A run across the picture in `view` (or turning to `then` 0.5 s in), 500 px in 2 s (slow enough
  // that the view matching stays under its cap).
  const scene = (view: string, then?: string) =>
    compileScene(
      {
        format: "toon-scene", version: 1, width: 1600, height: 900, fps: 30, duration: 3,
        characters: { kid: "kid" }, actors: [{ id: "a", character: "kid", x: 300, y: 800 }],
        script: [
          { at: 0, actor: "a", action: "pose", control: "view", value: view, duration: 0 },
          ...(then ? [{ at: 0.5, actor: "a", action: "pose", control: "view", value: then, duration: 0 }] : []),
          { at: 0, actor: "a", action: "walkTo", x: 800, duration: 2, clip: "run" },
        ],
      } as never,
      { characters: { kid: doc } },
    );
  const speed = (view: string, then?: string) => scene(view, then).actors[0].clips[0].speed;

  it("plays the clip faster as the view draws the steps shorter (|sin yaw|, at least 0.35), capped at 1.3× its natural rate", () => {
    const side = speed("side");
    // (The speed alone asks for a rate under the cap.)
    expect(side).toBeLessThan(1.3 * Math.sin((36 * Math.PI) / 180));
    expect(speed("profile")).toBeCloseTo(side / Math.sin((36 * Math.PI) / 180), 6);
    expect(speed("q112")).toBeCloseTo(side / Math.sin((112 * Math.PI) / 180), 6);
    expect(speed("front")).toBeCloseTo(Math.min(side / 0.35, 1.3), 6);
    // The view through the walk's cruise, keyed after it starts (a turn into the run's travel view).
    const turned = speed("profile", "side") / side;
    expect(turned).toBeGreaterThan(1);
    expect(turned).toBeLessThan(1 / Math.sin((36 * Math.PI) / 180));
  });

  it("never plays the clip past 1.3× its natural rate for the view, nor past the rate the speed asks for when that is faster", () => {
    // A walk at its natural speed in the three-quarter view: 1.7× to keep the feet planted, 1.3× played.
    const c = clipsOf(doc).walk, rate = (view: string, v: number) =>
      compileScene(
        {
          format: "toon-scene", version: 1, width: 1600, height: 900, fps: 30, duration: 4,
          characters: { kid: "kid" }, actors: [{ id: "a", character: "kid", x: 300, y: 800 }],
          script: [
            { at: 0, actor: "a", action: "pose", control: "view", value: view, duration: 0 },
            { at: 0, actor: "a", action: "walkTo", x: 300 + v * 3, duration: 3, clip: "walk" },
          ],
        } as never,
        { characters: { kid: doc } },
      ).actors[0].clips[0].speed;
    const natural = c.stride / c.duration;
    // (The side view: the speed's own rate, a little over 1 for the walk's ease in and out; matched
    // to the three-quarter view it would be past the cap.)
    expect(rate("side", natural)).toBeLessThan(1.3);
    expect(rate("side", natural) / Math.sin((36 * Math.PI) / 180)).toBeGreaterThan(1.3);
    expect(rate("profile", natural)).toBeCloseTo(1.3, 6);
    // Already faster than natural: played at the speed's own rate, no faster for the view.
    expect(rate("profile", natural * 1.6)).toBeCloseTo(rate("side", natural * 1.6), 6);
  });

  it("the near foot's ball stays put on the screen while it is planted (the three-quarter view)", () => {
    const sc = scene("profile"), actor = sc.actors[0], c = clipsOf(doc).run, inst = actor.clips[0];
    const fi = actor.rig.boneIndex.get("footF")!, len = actor.rig.bones[fi].length;
    const ball = (t: number) => apply(multiply(actorPlacement(actor, t), actorPose(sc, actor, t).world[fi]) as never, [0.7 * len, 0]);
    // Planted stretches of the near foot in the cruise (clip time → scene time).
    const [[p0, p1]] = planted(c.tracks["ik.footF.x"]);
    let checked = 0;
    for (let n = 0; n < 6; n++) {
      const t0 = inst.start + (n * c.duration + p0) / inst.speed, t1 = inst.start + (n * c.duration + p1) / inst.speed;
      if (t0 < 0.4 || t1 > 1.6) continue;
      // Flat on the ground: to a pixel. (Rolling onto the ball to push off, the foot's drawing turns
      // toe down at full length where the side plane's ankle lift is foreshortened: its ball slips
      // back a few pixels in the last frame of the stance at this angle.)
      const xs = [0.1, 0.3, 0.5, 0.7].map((u) => ball(t0 + u * (t1 - t0))[0]), roll = ball(t0 + 0.95 * (t1 - t0))[0];
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(1);
      expect(Math.abs(roll - xs[0])).toBeLessThan(6);
      checked++;
    }
    expect(checked).toBeGreaterThan(1);
  });
});

describe("gait options", () => {
  const base = { a: 20, lift: 12, dur: 0.8, bob: 3, lean: 2, armSwing: 20 };

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

  it("the run's cycle: flight, heel kick, knee drive, reach, push-off on the ball", () => {
    const leg = 160, run = { ...base, a: 48, lift: 22, dur: 0.6, bob: 9, crouch: 0.1, leg, foot: 24 };
    const g = gait({ ...run, flight: 0.34, heel: 0.45, knee: 0.4, paw: 0.15 });
    const d = 0.6, x = g.tracks["ik.footF.x"], y = g.tracks["ik.footF.y"], rot = g.tracks["bones.footF.rotation"];
    // Planted for (1 − 0.34)/2 of the cycle; the stride is 2a ÷ that (the body's travel).
    const [[t0, t1]] = planted(x);
    expect(t0).toBe(0);
    expect(t1 / d).toBeCloseTo(0.33, 3);
    expect(g.stride).toBeCloseTo((2 * 48) / 0.33, 0);
    // Flat while planted, then rolling onto the ball: the ankle up and forward by what keeps the
    // ball where it is.
    const ball = 0.7 * 24, th = (at(rot, d, t1) * Math.PI) / 180;
    expect(at(rot, d, t1)).toBeCloseTo(35, 3);
    expect(at(y, d, t1)).toBeCloseTo(-ball * Math.sin(th), 1);
    expect(at(x, d, t1)).toBeCloseTo(-48 + ball * (1 - Math.cos(th)), 1);
    expect(at(rot, d, 0.1)).toBe(0);
    expect(at(rot, d, 0)).toBeLessThan(0); // heel first
    // The swing: up behind (the heel at 0.45 of the leg), the knee drive, the reach past the landing.
    const ys = y.map((k) => k[1] as number), xs = x.map((k) => k[1] as number);
    expect(Math.min(...ys)).toBeCloseTo(-0.45 * leg, 1);
    expect(Math.max(...xs)).toBeCloseTo(48 * 1.15, 1);
    expect(Math.min(...xs)).toBeLessThan(-48 - 0.2 * leg);
    // The far foot: the same, half a cycle later.
    for (const t of [0.05, 0.2, 0.35, 0.5]) expect(at(g.tracks["ik.footB.x"], d, (t + 0.3) % d)).toBeCloseTo(at(x, d, t), 1);
    // A walk-cycle gait is not a run: no `flight` (nor heel, paw), the same tracks as before.
    expect(gait(base).tracks["bones.footF.rotation"]).toBeUndefined();
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

  it("run arms: bent near a right angle, against the legs, a beat late, the far arm less", () => {
    // A 2D rig (`flat`): the channels are the angles seen from the side.
    const d = 0.6, flight = 0.34, run = { ...base, dur: d, armSwing: 44, flight, armStyle: "run" as const };
    const g = gait({ ...run, flat: true }).tracks;
    const vals = (ch: string) => g[ch].map((k) => k[1] as number);
    // The upper arm s forward and 0.9 s back; the elbow near a right angle, tighter in front.
    expect(Math.min(...vals("bones.armF1.rotation"))).toBeCloseTo(-44, 6);
    expect(Math.max(...vals("bones.armF1.rotation"))).toBeCloseTo(39.6, 6);
    for (const ch of ["bones.armF2.rotation", "bones.armB2.rotation"]) for (const v of vals(ch)) expect(v).toBeGreaterThanOrEqual(-100), expect(v).toBeLessThanOrEqual(-68);
    // The near arm forward in mid-air after the near foot pushed off (between its toe-off at 0.33
    // and the far foot's contact at 0.5), late by armLag.
    const fwd = g["bones.armF1.rotation"].find((k) => k[1] === -44)!;
    expect((fwd[0] as number) / d).toBeCloseTo((0.33 + 0.5) / 2 + 0.05, 3);
    // The far arm a little less, and a little later than half a cycle on.
    expect(Math.min(...vals("bones.armB1.rotation"))).toBeCloseTo(-44 * 0.9, 6);
    const fwdB = g["bones.armB1.rotation"].reduce((m, k) => ((k[1] as number) < (m[1] as number) ? k : m));
    expect(((fwdB[0] as number) / d - (fwd[0] as number) / d + 1) % 1).toBeGreaterThan(0.5);
    // Seamless loops; no 2.5D channels on a 2D rig.
    for (const ch of Object.keys(g)) if (/^bones\.arm/.test(ch)) expect(g[ch][0][1], ch).toBe(g[ch][g[ch].length - 1][1]);
    expect(g["bones.armF1.spread"]).toBeUndefined();
    // A 2.5D rig: the elbows a little out (the upper arm's spread: near −, far +), the forearm
    // turned in towards the chest at the front, out by the hip at the back; eight poses a cycle
    // (and the two seam keys).
    const g3 = gait(run).tracks;
    expect(g3["bones.armF1.spread"]).toHaveLength(10);
    for (const k of g3["bones.armF1.spread"]) expect(k[1] as number).toBeGreaterThan(0);
    for (const k of g3["bones.armB1.spread"]) expect(k[1] as number).toBeLessThan(0);
    for (const ch of Object.keys(g3)) if (/^bones\.arm/.test(ch)) expect(g3[ch][0][1], ch).toBe(g3[ch][g3[ch].length - 1][1]);
  });

  it("reach arms: flung up and out ahead, elbows bent, fluttering out of step, never overhead", () => {
    const d = 0.4, lean = 24, g = gait({ ...base, dur: d, lean, flight: 0.44, armStyle: "reach", flat: true }).tracks;
    for (const ch of Object.keys(g)) if (/^bones\.arm/.test(ch)) expect(g[ch][0][1], ch).toBe(g[ch][g[ch].length - 1][1]);
    const top = (s: "F" | "B") => g[`bones.arm${s}1.rotation`].reduce((m, k) => ((k[1] as number) < (m[1] as number) ? k : m));
    for (let k = 0; k < 40; k++) {
      const t = (k / 40) * d;
      for (const s of ["F", "B"] as const) {
        const upper = at(g[`bones.arm${s}1.rotation`], d, t), elbow = at(g[`bones.arm${s}2.rotation`], d, t);
        // In the picture (the torso's lean taken off): the upper arm 15–50° forward of hanging (the elbow low).
        expect(upper + lean, `${s} @${k}`).toBeLessThan(-15);
        expect(upper + lean, `${s} @${k}`).toBeGreaterThan(-50);
        // The elbow bent 54–80°, the forearm about level or rising, never up past 40° (the hand below the chin).
        expect(-elbow, `${s} @${k}`).toBeGreaterThan(54);
        expect(-elbow, `${s} @${k}`).toBeLessThan(80);
        expect(upper + elbow + lean, `${s} @${k}`).toBeLessThan(-70);
        expect(upper + elbow + lean, `${s} @${k}`).toBeGreaterThan(-130);
      }
    }
    // Fluttering twice a cycle, the arms a quarter of a cycle (half a step) apart.
    const lag = (((top("B")[0] as number) - (top("F")[0] as number)) / d + 1) % 0.5;
    expect(lag).toBeGreaterThan(0.2);
    expect(lag).toBeLessThan(0.35);
  });

  it("personalityGaits scales the walk and run", () => {
    const g = personalityGaits(base, { ...base, a: 40, dur: 0.4 }, { leg: 150, foot: 20 });
    expect(g.sneak).toMatchObject({ dur: 2, crouch: 0.18, knee: 1, creep: true, armStyle: "sneak", lean: 28, a: 38 });
    expect(g.sneak.tiptoe).toBeUndefined();
    expect(g.strut).toMatchObject({ dur: 0.6, slump: -4, sway: 6, armStyle: "pump", doubleBounce: true, a: 22 });
    expect(g.tired).toMatchObject({ dur: 0.95, slump: 12, drag: 0.7, armStyle: "hang", bob: 1, a: 16 });
    expect(g.march).toMatchObject({ dur: 0.5, knee: 1, armStyle: "pump", sway: 0, a: 20 });
    // Its own sprint: never under 0.3 s a cycle, leaning hard, long flights, heels up, knees pumping.
    expect(g.scaredRun).toMatchObject({ dur: 0.3, armStyle: "reach", lean: 24, a: 52, flight: 0.44, heel: 0.62, knee: 1, paw: 0.2, leg: 150, foot: 20 });
  });

  it("skirts: the runs are cut to the cloth (shorter steps, less knee drive, heel kick and flight)", () => {
    const run = { ...base, a: 40, dur: 0.4, flight: 0.34, heel: 0.45, knee: 0.4, paw: 0.15, crouch: 0.1 };
    expect(skirtRun(base, "long")).toBe(base);
    expect(skirtRun(run, undefined)).toBe(run);
    expect(skirtRun(run, "short")).toMatchObject({ a: 34, flight: 0.26, heel: 0.45, knee: 0.2 });
    const long = personalityGaits(base, run, { leg: 150, foot: 20, skirt: "long" }).scaredRun;
    expect(long).toMatchObject({ knee: 0, heel: 0.16, flight: 0.14, crouch: 0.05 });
    expect(long.a).toBeLessThan(40);
    // A long skirt's run, built: the swinging heel no higher than a fifth of the leg, the steps short.
    const nell = { ...kid, bottom: "longSkirt" } as CartoonLook, pants = { ...kid, bottom: "pants" } as CartoonLook;
    for (const clip of RUNS) {
      const c = clipsOf(cartoonCharacter(nell))[clip], p = clipsOf(cartoonCharacter(pants))[clip];
      expect(c.stride, clip).toBeLessThan(0.7 * p.stride);
      const heel = (cl: Clip) => -Math.min(...cl.tracks["ik.footF.y"].map((k) => k[1] as number));
      expect(heel(c), clip).toBeLessThan(0.5 * heel(p));
    }
  });

  it("2.5D rigs: the planted feet stay on the ground through a crouch (hip-relative leg IK)", () => {
    const doc = cartoonCharacter(kid);
    const rig = compileRig(doc);
    const fi = rig.boneIndex.get("footF")!;
    const d = clipsOf(doc).sneak.duration;
    // The sneak's near foot flat on the ground from 0.06 to 0.46 of the cycle.
    const ys = [1, 3, 5, 7, 9].map((k) => evaluatePose(rig, { time: (0.07 + (k / 10) * 0.38) * d, ...play("sneak", "side") } as never).world[fi][5]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.5);
    // Flat-footed (not on tiptoe): the ankle where it rests.
    const rest = evaluatePose(rig, { time: 0, controls: { view: "side" } } as never).world[fi][5];
    expect(Math.abs(ys[0] - rest)).toBeLessThan(1);
  });
});
