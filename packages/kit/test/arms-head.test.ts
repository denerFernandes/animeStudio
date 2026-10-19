import { describe, expect, it } from "vitest";
import { type ClipInstance, type EvaluatedPose, type Rig, type V3, compileRig, evaluatePose, viewPoint } from "@animestudio/core";
import { type CartoonLook, cartoonCharacter } from "../src";

// No arm inside or across the head, for every kit clip, in every view, for any proportions (a child
// whose afro is bigger than his reach, a teen, a woman, a man, a big man, an elder; painted and flat):
// in 3D no part of an arm (the upper arm, the elbow, the forearm, the hand) is inside the head's
// keep-outs — whatever the clip, a hand resting on the face included — and in the picture a clip
// whose hands never go to the face (marked `clear`) never shows an arm over the head: the upper arm
// and the forearm where they are drawn in front of the head, the forearm and the hand wherever they
// are (never lost behind the head, never sticking out of the face).

const LOOKS: Record<string, CartoonLook> = {
  child: { name: "Pip", build: "child", skin: "#c98f6a", hair: "afro", hairColor: "#1e1410", top: "stripes", topColor: "#2ec4b6", top2: "#f6efe0", bottom: "shorts", bottomColor: "#ff6b5b", shoes: "sneakers", hat: "capBack", hatColor: "#ff6b5b", nose: "button" },
  teen: { name: "Kai", build: "teen", skin: "#f2c9a6", hair: "spiky", hairColor: "#2b3a8c", top: "tee", topColor: "#ffc93c", bottom: "shorts", bottomColor: "#2ec4b6", shoes: "sneakers", nose: "button" },
  woman: { name: "Maya", build: "woman", female: true, skin: "#a8704f", hair: "puffs", hairColor: "#2a1b14", top: "jacket", topColor: "#ff6b5b", bottom: "pants", bottomColor: "#2f3a5c", shoes: "sneakers", nose: "button" },
  man: { name: "Dan", build: "man", skin: "#e0a77f", hair: "sidePart", hairColor: "#3b2a20", top: "tee", topColor: "#5b8c5a", bottom: "pants", bottomColor: "#34405a", shoes: "sneakers", nose: "long" },
  big: { name: "Otto", build: "big", heavy: 0.5, skin: "#e9b48f", hair: "receding", hairColor: "#4a3426", top: "overalls", topColor: "#4f6fa8", top2: "#f6efe0", bottom: "pants", bottomColor: "#4f6fa8", shoes: "dress", moustache: true, nose: "round", jaw: "square" },
  elder: { name: "Nell", build: "elder", female: true, skin: "#f3d2bd", hair: "bun", hairColor: "#d9d6e0", top: "cardigan", topColor: "#9b6fc4", bottom: "longSkirt", bottomColor: "#5d4a7a", shoes: "dress", glasses: true, nose: "round" },
} as Record<string, CartoonLook>;
/** The clips whose hands go to the face (their contact is kept: they are not `clear`). */
const FACE = ["drink", "smoke", "facepalm", "cry", "think", "phone", "texting", "textingTwo", "read"];

const mv = (R: number[], v: V3): V3 => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
const mtv = (R: number[], v: V3): V3 => [R[0] * v[0] + R[3] * v[1] + R[6] * v[2], R[1] * v[0] + R[4] * v[1] + R[7] * v[2], R[2] * v[0] + R[5] * v[1] + R[8] * v[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Each arm of a pose: its least normalised distance from the head's keep-outs in 3D and from their outlines in the picture. */
function arms(rig: Rig, pose: EvaluatedPose): { q3: number; qp: number }[] {
  const r3 = rig.rig3d!, f = pose.frame3d!, gap = r3.torsoGap ?? 0;
  const vp = (p: V3) => viewPoint(p, f.yaw, f.pitch);
  return r3.clear.map((cl) => {
    const ia = r3.byIndex.get(cl.upper)!, ib = r3.byIndex.get(cl.lower)!;
    const S = f.pos[ia], E = f.pos[ib], H = add(E, mv(f.rot[ib], sub(r3.bones[ib].to, r3.bones[ib].from)));
    let q3 = Infinity, qp = Infinity;
    for (const i of cl.keepOut) {
      const k = r3.keepOut[i], j = r3.byIndex.get(k.bone)!, R = f.rot[j], c = add(f.pos[j], mv(R, k.at));
      // 3D: the upper arm from its middle (its shoulder's end is under the head), the elbow, the forearm, the hand.
      for (const p of [0.5, 0.75, 1].map((u) => lerp(S, E, u)).concat([0.25, 0.5, 0.75, 1].map((u) => lerp(E, H, u)))) {
        const l = mtv(R, sub(p, c));
        q3 = Math.min(q3, Math.hypot(l[0] / k.radii[0], l[1] / k.radii[1], l[2] / k.radii[2]));
      }
      // The picture: the outline grown by the arm's half width, and the middle of the head along the line of sight.
      const cc = vp(c);
      let A = 0, B = 0, C = 0, X = 0, Y = 0;
      for (let m = 0; m < 3; m++) {
        const a = vp([R[m] * (k.radii[m] + gap), R[3 + m] * (k.radii[m] + gap), R[6 + m] * (k.radii[m] + gap)]);
        A += a[0] * a[0];
        B += a[0] * a[1];
        C += a[1] * a[1];
        X += a[0] * a[2];
        Y += a[1] * a[2];
      }
      const det = A * C - B * B || 1e-9, n11 = C / det, n12 = -B / det, n22 = A / det, gx = n11 * X + n12 * Y, gy = n12 * X + n22 * Y;
      const samples: [V3, boolean][] = [
        ...[0.5, 0.625, 0.75, 0.875].map((u): [V3, boolean] => [lerp(S, E, u), false]),
        ...[0, 0.25, 0.5].map((u): [V3, boolean] => [lerp(E, H, u), false]),
        ...[0.75, 1, 1.1, 1.2].map((u): [V3, boolean] => [lerp(E, H, u), true]),
      ];
      for (const [p3, always] of samples) {
        const p = vp(p3), dx = p[0] - cc[0], dy = p[1] - cc[1];
        if (!always && !(p[2] - cc[2] > gx * dx + gy * dy)) continue;
        qp = Math.min(qp, Math.sqrt(Math.max(0, n11 * dx * dx + 2 * n12 * dx * dy + n22 * dy * dy)));
      }
    }
    return { q3, qp };
  });
}

for (const style of ["painted", "flat"] as const)
  describe(`arms and the head (${style})`, () => {
    for (const [build, look] of Object.entries(LOOKS))
      it(`${build}: every clip in every view keeps its arms out of the head, and a \`clear\` clip's off it in the picture`, () => {
        const doc = cartoonCharacter(look, style === "flat" ? { style: "flat" } : {}) as never as { controls: { view: { poses: Record<string, unknown> } } };
        const rig = compileRig(doc as never);
        const views = Object.keys(doc.controls.view.poses);
        const bad3: string[] = [], badP: string[] = [];
        for (const [name, clip] of Object.entries(rig.clips)) {
          if (FACE.includes(name)) expect(clip.clear, name).toBeFalsy();
          const dur = clip.duration || 1, N = 8;
          const inst: ClipInstance = { clip: name, start: 0, end: dur + 1, speed: 1, loop: !!clip.loop, fadeIn: 0, fadeOut: 0, layer: 0, blend: "override", weight: 1 };
          for (const view of views)
            for (let i = 0; i < N; i++) {
              const t = clip.loop ? (i / N) * dur : Math.min((i / (N - 1)) * dur, dur - 1e-4);
              arms(rig, evaluatePose(rig, { time: t, clips: [inst], controls: { view } })).forEach(({ q3, qp }, a) => {
                const at = `${name} ${view} t=${t.toFixed(2)} arm ${a ? "B" : "F"}`;
                if (q3 < 0.97) bad3.push(`${at} q=${q3.toFixed(2)}`);
                if (clip.clear && qp < 1) badP.push(`${at} q=${qp.toFixed(2)}`);
              });
            }
        }
        expect(bad3, "inside the head (3D)").toEqual([]);
        expect(badP, "over the head (picture)").toEqual([]);
      }, 120_000);
  });
