import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type CompiledScene, type EvaluatedPose, type Rig, type SceneDoc, type ToonDoc, type V3, actorPlacement, actorPose, apply, compileScene, evaluatePose, evaluateScene, invert, rig3dPose, validateToon } from "../src";
import { GESTURES, bone3d, cartoonDocs, compileRig, gestureHands, headClearance, hiddenBy, joint2d, play, poseOf, screenClearance, tracksOf, walkHash } from "./face-clearance.helpers";

// 2.5D rigs (`rig3d`): a scene `reach` on a limb of 3D bones is solved in 3D (the drawn arm — a
// solid posed on the 3D bones — and the hand drawn on the 2D hand bone stay together), and every arm
// is kept off the face in two stages: out of the head in 3D (a hand or forearm set into the head is
// moved out along the head's normal and the arm solved again), then off the head's outline in the
// picture (a forearm between the camera and the face hides it) — for direct poses and clips marked
// `clear`; authored clips (a wave, a drink) are left as authored.

const docs = await cartoonDocs();
const baseline = JSON.parse(readFileSync(new URL("./fixtures/face-clearance-baseline.json", import.meta.url), "utf8")) as Record<string, { walk: string; gestures: Record<string, [number, number]> }>;
const rigs = Object.fromEntries(Object.entries(docs).map(([k, d]) => [k, compileRig(d)])) as Record<"tito" | "kid", Rig>;
const LOOKS = ["tito", "kid"] as const;

type Case = { arm: "armF" | "armB"; a: number; b: number; view: string; grab?: boolean; covers?: boolean };
// The repro cases: FK rotations set on the arm bones that put the hand or the forearm into the head.
const CASES: Case[] = [
  // (`covers`: the forearm over the face in the picture before the clearance — 1a, 2b, 3a, 3b.)
  { arm: "armF", a: -120, b: 0, view: "profile", covers: true },
  { arm: "armF", a: -150, b: -20, view: "profile" },
  { arm: "armF", a: -75, b: -25, view: "profile" },
  { arm: "armF", a: -108, b: 0, view: "profile", covers: true },
  { arm: "armF", a: -130, b: -10, view: "half", covers: true },
  { arm: "armB", a: -130, b: -10, view: "half", covers: true },
  { arm: "armB", a: -118, b: -20, view: "profile", grab: true },
];

function caseScene(doc: ToonDoc, c: Case, view: string): CompiledScene {
  const s = {
    format: "toon-scene", version: 1, width: 400, height: 600, fps: 24, duration: 1, background: "#fff",
    characters: { kid: "x" }, actors: [{ id: "a", character: "kid", x: 200, y: 560 }],
    ...(c.grab ? { props: [{ id: "cup", art: "<rect x='-8' y='-12' width='16' height='24'/>", x: 0, y: 0 }] } : {}),
    script: [
      { at: 0, actor: "a", action: "set", channel: `bones.${c.arm}1.rotation`, value: c.a },
      { at: 0, actor: "a", action: "set", channel: `bones.${c.arm}2.rotation`, value: c.b },
      { at: 0, actor: "a", action: "pose", control: "view", value: view, duration: 0 },
      ...(c.grab ? [{ at: 0, actor: "a", action: "grab", prop: "cup", anchor: "handB" }] : []),
    ],
  } as unknown as SceneDoc;
  return compileScene(s, { characters: { kid: doc } });
}

/** The keys of the actor's drawn parts, in drawing order. */
function drawn(sc: CompiledScene, t: number): string[] {
  const actor = evaluateScene(sc, t).nodes.find((n) => n.key === "actor-a");
  return actor && actor.kind === "group" ? actor.children.map((n) => n.key) : [];
}

describe("face clearance: an arm set into the head is moved out of it", () => {
  for (const look of LOOKS)
    for (const c of CASES)
      it(`${look}: ${c.view} ${c.arm} ${c.a}/${c.b}${c.grab ? " holding a prop" : ""} — hand and forearm out of the head, still raised`, () => {
        const doc = docs[look], rig = rigs[look];
        const sc = caseScene(doc, c, c.view);
        const pose = actorPose(sc, sc.actors[0], 0.2);
        const f = pose.frame3d!;
        const fore = bone3d(rig, f, `${c.arm}2`), upper = bone3d(rig, f, `${c.arm}1`);
        expect(headClearance(doc, rig, f, fore.to)).toBeGreaterThanOrEqual(0.98);
        expect(headClearance(doc, rig, f, fore.mid)).toBeGreaterThanOrEqual(0.98);
        // Raised where the channels raised it (the hand above the shoulder).
        const fk = rig3dPose(doc as never, { [`${c.arm}1`]: { rotation: c.a }, [`${c.arm}2`]: { rotation: c.b } });
        if (fk[`${c.arm}2`].to[1] < fk[`${c.arm}1`].from[1]) expect(fore.to[1]).toBeLessThan(upper.from[1]);
        // Off the face in the picture: the forearm and the hand outside the head's outline.
        if (c.covers) expect(screenClearance(doc, rig, f, fore.from, fore.to)).toBeGreaterThanOrEqual(1);
      });
});

describe("face clearance: a raised arm is drawn (not sent behind the head)", () => {
  for (const look of LOOKS)
    for (const c of CASES.filter((x) => x.arm === "armF"))
      for (const view of ["profile", "half", "front"])
        it(`${look}: ${view} armF ${c.a}/${c.b}`, () => {
          const rig = rigs[look];
          const sc = caseScene(docs[look], c, view);
          const pose = actorPose(sc, sc.actors[0], 0.2);
          const f = pose.frame3d!;
          const fore = bone3d(rig, f, "armF2");
          // The wrist and the forearm are in front of the head's (and the body's) occluders where they are drawn.
          expect(hiddenBy(rig, f, "arms", fore.to)).toBeLessThanOrEqual(2);
          expect(hiddenBy(rig, f, "arms", fore.mid)).toBeLessThanOrEqual(2);
          // Both the arm (its solid) and the hand are drawn, the hand over the head.
          const keys = drawn(sc, 0.2);
          expect(keys).toContain("a-arms");
          expect(keys.indexOf("a-handF")).toBeGreaterThan(keys.indexOf("a-head"));
        });
});

describe("face clearance is continuous", () => {
  // Sweeping an arm up in front of the face, the picture-space stage holds it under the chin, then
  // over the head once the hand is above the head's middle: one side switch, a jump; everywhere else
  // the hand moves at the sweep's own pace. (Facing the camera the spread leads, which slides the
  // hand along the outline a little faster than the sweep: up to 5 px a degree.)
  for (const look of LOOKS)
    for (const view of ["profile", "half", "front"])
      for (const b of [0, -20])
        it(`${look}: sweeping armF1 rotation −40 → −160 (armF2 ${b}) in ${view}: at most one side switch, the hand otherwise under ${view === "profile" ? 4 : 5} px a degree`, () => {
          const rig = rigs[look], tip = rig.boneIndex.get("armF2")!;
          let prev: V3 | undefined;
          const steps: number[] = [];
          for (let a = -40; a >= -160; a--) {
            const t = poseOf(rig, view, { "bones.armF1.rotation": a, "bones.armF2.rotation": b }).frame3d!.tipView.get(tip)!;
            if (prev) steps.push(Math.hypot(t[0] - prev[0], t[1] - prev[1]));
            prev = t;
          }
          const limit = view === "profile" ? 4 : 5;
          expect(steps.filter((d) => d >= limit).length).toBeLessThanOrEqual(1);
        });
});

// ------------------------------------------------------------------ the `clear` clip marker

const stick = {
  format: "toon", version: 1, name: "stick",
  skeleton: [
    { id: "root" },
    { id: "hips", parent: "root", from: [0, -100], to: [0, -110] },
    { id: "body", parent: "hips", from: [0, -100], to: [0, -160] },
    { id: "neck", parent: "body", from: [0, -160], to: [0, -170] },
    { id: "head", parent: "neck", from: [0, -170], to: [0, -230] },
    { id: "armF1", parent: "body", from: [-15, -155], to: [-15, -110] },
    { id: "armF2", parent: "armF1", from: [-15, -110], to: [-15, -65] },
    { id: "legF1", parent: "hips", from: [-8, -100], to: [-8, -50] },
    { id: "legF2", parent: "legF1", from: [-8, -50], to: [-8, 0] },
  ],
  parts: [{ id: "torso", type: "rigid", bone: "body", art: "<rect x='-12' y='-160' width='24' height='60'/>" }],
  ik: [{ id: "footF", bones: ["legF1", "legF2"], bend: 1 }, { id: "handF", bones: ["armF1", "armF2"], bend: 1, mix: 0 }],
  controls: { view: { type: "pose", poses: { front: {}, q: {}, side: {} } } },
  clips: {
    raise: { duration: 1, loop: true, tracks: { "bones.armF1.rotation": [[0, -130]] } },
    raiseClear: { duration: 1, loop: true, clear: true, tracks: { "bones.armF1.rotation": [[0, -130]] } },
    // Touches the arm without moving it (the forearm as at rest): only its being authored counts.
    hold: { duration: 1, loop: true, tracks: { "bones.armF2.rotation": [[0, 0]] } },
  },
  rig3d: {
    bones: {
      hips: { from: [0, -100, 0], to: [0, -110, 0] },
      body: { from: [0, -100, 0], to: [0, -160, 0] },
      neck: { from: [0, -160, 0], to: [0, -170, 0] },
      head: { from: [0, -170, 0], to: [0, -230, 0] },
      armF1: { from: [-15, -155, 0], to: [-15, -110, 0] },
      armF2: { from: [-15, -110, 0], to: [-15, -65, 2] },
      legF1: { from: [-8, -100, 0], to: [-8, -50, 3] },
      legF2: { from: [-8, -50, 3], to: [-8, 0, 0] },
    },
    views: { front: 0, q: 36, side: 90 },
    chains: [{ bones: ["legF1", "legF2"], parts: [] }, { bones: ["armF2"], parts: [] }],
    keepOut: [{ bone: "head", at: [0, -30, 0], radii: [30, 32, 30] }],
  },
} as unknown as ToonDoc;

describe("authored clips are left as authored; direct poses and `clear` clips are kept off the face", () => {
  const rig = compileRig(stick);
  const fore = (pose: EvaluatedPose) => bone3d(rig, pose.frame3d!, "armF2");
  const covering = (pose: EvaluatedPose) => screenClearance(stick, rig, pose.frame3d!, fore(pose).from, fore(pose).to);
  for (const view of ["front", "q"]) {
    it(`${view}: a \`clear\` clip's arm is moved off the face, an authored clip's is not`, () => {
      const cleared = evaluatePose(rig, { time: 0, controls: { view }, clips: [play("raiseClear")] });
      const authored = evaluatePose(rig, { time: 0, controls: { view }, clips: [play("raise")] });
      expect(covering(cleared)).toBeGreaterThanOrEqual(1);
      expect(covering(authored)).toBeLessThan(0.6);
      // A direct track is never exempt.
      const set = evaluatePose(rig, { time: 0, controls: { view }, tracks: tracksOf(rig, { "bones.armF1.rotation": -130 }) });
      expect(covering(set)).toBeGreaterThanOrEqual(1);
    });
    it(`${view}: as an authored clip fades out over a direct pose, the arm leaves the face smoothly`, () => {
      const tracks = tracksOf(rig, { "bones.armF1.rotation": -130 });
      const inst = { ...play("hold"), end: 3, fadeOut: 2 };
      let prev: V3 | undefined, worst = 0;
      for (let fr = 0; fr <= 84; fr++) {
        const pose = evaluatePose(rig, { time: fr / 24, controls: { view }, tracks, clips: [inst] });
        const t = pose.frame3d!.tipView.get(rig.boneIndex.get("armF2")!)!;
        if (prev) worst = Math.max(worst, Math.hypot(t[0] - prev[0], t[1] - prev[1]));
        prev = t;
        if (fr === 0) expect(covering(pose)).toBeLessThan(0.6);
        if (fr === 84) expect(covering(pose)).toBeGreaterThanOrEqual(1);
      }
      expect(worst).toBeLessThan(4);
    });
  }
  it("the marker is in the schema and on the compiled clip", () => {
    expect(rig.clips.raiseClear.clear).toBe(true);
    expect(rig.clips.raise.clear).toBeUndefined();
    expect(validateToon(stick).ok).toBe(true);
  });
});

describe("hands resting on the face and walks are unchanged", () => {
  for (const look of LOOKS) {
    it(`${look}: ${GESTURES.join(", ")} — each hand within 0.5 px of the committed behaviour`, () => {
      const now = gestureHands(rigs[look]), was = baseline[look].gestures;
      expect(Object.keys(now).sort()).toEqual(Object.keys(was).sort());
      for (const [k, p] of Object.entries(now)) expect(Math.hypot(p[0] - was[k][0], p[1] - was[k][1]), k).toBeLessThan(0.5);
    });
    it(`${look}: a walk cycle's bones are as committed`, () => {
      expect(walkHash(rigs[look])).toBe(baseline[look].walk);
    });
  }
});

// ------------------------------------------------------------------ 3D reaches

const post = {
  format: "toon", version: 1, name: "post",
  skeleton: [{ id: "root" }],
  parts: [{ id: "pole", type: "rigid", bone: "root", art: "<rect x='-3' y='0' width='6' height='100'/>" }],
  anchors: { knob: { bone: "root", at: [0, 0] } },
} as unknown as ToonDoc;

const AT: [number, number] = [300, 640];
function reachScene(doc: ToonDoc, view: string, script: unknown[], postAt?: [number, number]): CompiledScene {
  const s = {
    format: "toon-scene", version: 1, width: 600, height: 700, fps: 24, duration: 6, background: "#fff",
    characters: { kid: "x", post: "y" },
    actors: [{ id: "a", character: "kid", x: AT[0], y: AT[1] }, ...(postAt ? [{ id: "p", character: "post", x: postAt[0], y: postAt[1] }] : [])],
    script: [{ at: 0, actor: "a", action: "pose", control: "view", value: view, duration: 0 }, ...script],
  } as unknown as SceneDoc;
  return compileScene(s, { characters: { kid: doc, post } });
}
const actorA = (sc: CompiledScene) => sc.actors.find((a) => a.id === "a")!;
const toScene = (sc: CompiledScene, p: [number, number]) => apply(actorPlacement(actorA(sc), 0), p) as [number, number];
const toChar = (sc: CompiledScene, p: [number, number], t: number) => apply(invert(actorPlacement(actorA(sc), t)), p) as [number, number];
const handOf = (rig: Rig, pose: EvaluatedPose) => ({ joint: joint2d(pose, rig, "handF"), tip: pose.frame3d!.tipView.get(rig.boneIndex.get("armF2")!)! });
const dist = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe("reach on a 2.5D limb is solved in 3D", () => {
  for (const look of LOOKS)
    for (const view of ["profile", "half", "front"]) {
      const doc = docs[look], rig = rigs[look];
      // Down and out from the shoulder, well within reach and away from the head.
      const free = reachScene(doc, view, []);
      const shoulder = joint2d(actorPose(free, actorA(free), 0), rig, "armF1");
      const offset: [number, number] = view === "front" ? [-40, 70] : [40, 70];
      const local: [number, number] = [shoulder[0] + offset[0], shoulder[1] + offset[1]];
      const target = toScene(free, local);

      it(`${look}: ${view} — the 2D hand, the 3D forearm's tip and a scene point coincide`, () => {
        const sc = reachScene(doc, view, [{ at: 0, actor: "a", action: "reach", chain: "handF", target, duration: 0 }]);
        const pose = actorPose(sc, actorA(sc), 0.5);
        expect(pose.frame3d!.ik3d).toContain(rig.ik.findIndex((k) => k.id === "handF"));
        const h = handOf(rig, pose);
        expect(dist(h.joint, local)).toBeLessThan(1);
        expect(dist(h.tip, local)).toBeLessThan(1);
      });

      it(`${look}: ${view} — on another actor's anchor`, () => {
        const sc = reachScene(doc, view, [{ at: 0, actor: "a", action: "reach", chain: "handF", target: { actor: "p", anchor: "knob" }, duration: 0 }], target);
        const h = handOf(rig, actorPose(sc, actorA(sc), 0.5));
        expect(dist(h.joint, local)).toBeLessThan(1);
        expect(dist(h.tip, local)).toBeLessThan(1);
      });

      it(`${look}: ${view} — blending in and out moves the hand smoothly, the hand on the arm all along`, () => {
        // (Two-second blends: the hand travels about 80 px, at most ~2.6 px a frame.)
        const sc = reachScene(doc, view, [
          { at: 0.5, actor: "a", action: "reach", chain: "handF", target, duration: 2 },
          { at: 3, actor: "a", action: "reach", chain: "handF", target: null, duration: 2 },
        ]);
        let prev: V3 | undefined, worst = 0;
        for (let fr = 0; fr <= 132; fr++) {
          const h = handOf(rig, actorPose(sc, actorA(sc), fr / 24));
          expect(dist(h.joint, h.tip), `frame ${fr}`).toBeLessThan(1);
          if (prev) worst = Math.max(worst, dist(h.tip, prev));
          prev = h.tip;
        }
        expect(worst).toBeLessThan(4);
        // Held at full weight, free again at the end.
        expect(dist(handOf(rig, actorPose(sc, actorA(sc), 2.8)).tip, local)).toBeLessThan(1);
        const rest = handOf(rig, actorPose(free, actorA(free), 0)).tip;
        expect(dist(handOf(rig, actorPose(sc, actorA(sc), 5.5)).tip, rest)).toBeLessThan(0.5);
      });

      it(`${look}: ${view} — out of reach, the arm points straight at the target`, () => {
        const far: [number, number] = [shoulder[0] + offset[0] * 6, shoulder[1] + offset[1] * 3];
        const sc = reachScene(doc, view, [{ at: 0, actor: "a", action: "reach", chain: "handF", target: toScene(free, far), duration: 0 }]);
        const pose = actorPose(sc, actorA(sc), 0.5);
        const f = pose.frame3d!;
        const up = bone3d(rig, f, "armF1"), fore = bone3d(rig, f, "armF2");
        const B = (id: string) => (doc.rig3d as { bones: Record<string, { from: V3; to: V3 }> }).bones[id];
        const len = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        // Straight: the hand as far from the shoulder as the two bones are long.
        expect(len(up.from, fore.to)).toBeGreaterThan(len(B("armF1").from, B("armF2").from) + len(B("armF2").from, B("armF2").to) - 0.5);
        // Pointing at it in the picture.
        const s2 = joint2d(pose, rig, "armF1"), h = handOf(rig, pose).tip;
        const a1 = Math.atan2(h[1] - s2[1], h[0] - s2[0]), a2 = Math.atan2(far[1] - s2[1], far[0] - s2[0]);
        expect(Math.abs(Math.atan2(Math.sin(a1 - a2), Math.cos(a1 - a2)))).toBeLessThan(0.02);
        expect(dist(handOf(rig, pose).joint, h)).toBeLessThan(1);
      });
    }
  it("the target is taken in character space (a moved actor reaches the same scene point)", () => {
    const doc = docs.kid, rig = rigs.kid;
    const free = reachScene(doc, "profile", []);
    const shoulder = joint2d(actorPose(free, actorA(free), 0), rig, "armF1");
    const target = toScene(free, [shoulder[0] + 30, shoulder[1] + 80]);
    const sc = reachScene(doc, "profile", [
      { at: 0, actor: "a", action: "set", channel: "x", value: AT[0] + 25 },
      { at: 0, actor: "a", action: "reach", chain: "handF", target, duration: 0 },
    ]);
    const h = handOf(rig, actorPose(sc, actorA(sc), 0.5));
    expect(dist(h.tip, toChar(sc, target, 0.5))).toBeLessThan(1);
  });
});
