import { describe, expect, it } from "vitest";
import { type CompiledRig3d, type SolidBody, type ToonDoc, compileRig, drawSolid, evaluatePose, parsePath, viewPoint } from "../src";
import { bone3d, cartoonDocs, play } from "./face-clearance.helpers";

// A hand bringing something to the mouth under a dropped jaw: with the jaw unhinged (`jaw: {gape: 2}`)
// the elbow raised in front of the chest and the forearm are drawn over the open chin, not hidden
// behind it. (The head is drawn over the shoulders whatever their depth — the kit's `under` — but only
// the shoulder's half of the upper arm: the elbow's keeps its true depth.) Measured on the drawing,
// where that convention applies, not on the depths alone.

const docs: Record<string, ToonDoc> = { ...(await cartoonDocs()) };
{
  // A stocky grown-up with a big head (a series' dad): shorter legs and torso, a much bigger head.
  const kit = await import("../../kit/src");
  const look = { name: "dad", build: "man", heavy: 0.35, skin: "#f0c7a5", hair: "receding", hairColor: "#3d2b20", top: "shirt", topColor: "#e3edf5", tie: "#c0473b", bottom: "pants", bottomColor: "#4a4f63", shoes: "dress", glasses: true, moustache: true, nose: "round" } as const;
  const a = kit.cartoonAnatomy(look as never);
  a.body.head = Math.round(a.body.head * 1.45);
  a.body.hip = Math.round(a.body.hip * 0.8);
  a.body.torso = Math.round(a.body.torso * 0.88);
  docs.dad = kit.cartoonCharacter(look as never, { anatomy: a, style: { ink: "#3a2824", shade: false, line: 2.8, limbs: "tube", hands: "open", eyes: "wide", proportions: "bigHead" } });
}

/** A path's outline as a polygon (its curves sampled). */
function polygons(d: string): [number, number][][] {
  return parsePath(d).map((sp) => {
    const out: [number, number][] = [sp.start];
    let p0 = sp.start;
    for (const [c1, c2, e] of sp.segments) {
      for (let k = 1; k <= 6; k++) {
        const t = k / 6, mt = 1 - t;
        out.push([mt ** 3 * p0[0] + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t ** 3 * e[0], mt ** 3 * p0[1] + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t ** 3 * e[1]]);
      }
      p0 = e;
    }
    return out;
  });
}
/** Even-odd inside test over a path's subpaths. */
function inside(d: string, x: number, y: number): boolean {
  let n = 0;
  for (const poly of polygons(d))
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) n++;
    }
  return n % 2 === 1;
}

describe("a raised elbow under a dropped jaw", () => {
  for (const [name, doc] of Object.entries(docs)) {
    const rig = compileRig(doc);
    const arms = rig.parts[rig.partIndex.get("arms")!] as unknown as { bodies: SolidBody[]; step: number };
    // The near arm's drawing: the body (with a fill) whose shapes ride the near forearm.
    const near = new Set([rig.boneIndex.get("armF1"), rig.boneIndex.get("armF2")]);
    const onNear = (b: SolidBody) => b.shapes.some((sh) => ("from" in sh ? [sh.from, sh.to] : [sh.at]).some((q) => near.has((q as { bone: number }).bone)));
    const nearFill = arms.bodies.filter((b) => b.fill && onNear(b)).map((b) => b.fill);
    const dur = rig.clips.drink.duration;
    for (const view of ["profile", "half", "front"]) {
      it(`${name}, ${view}: the elbow and forearm of a hand going to the mouth are drawn over the unhinged jaw`, () => {
        // Rising out of a hold in front of the chest, then at the mouth.
        const poses = [
          ...[0.16, 0.22, 0.3].map((f) => ({ t: f * dur, clips: [play("read"), { ...play("drink"), layer: 1, weight: 0.85 }] })),
          ...[0.4, 0.55].map((f) => ({ t: f * dur, clips: [play("drink")] })),
        ];
        for (const { t, clips } of poses) {
          const pose = evaluatePose(rig, { time: t, controls: { view, jaw: { gape: 2 } }, clips } as never);
          const frame = pose.frame3d!;
          const paths = drawSolid(arms.bodies, arms.step, rig.rig3d as CompiledRig3d, frame);
          const up = bone3d(rig, frame, "armF1"), lo = bone3d(rig, frame, "armF2");
          const at = (a: number[], b: number[], u: number) => a.map((v, k) => v + (b[k] - v) * u) as [number, number, number];
          for (const [label, p] of [["elbow half", at(up.from, up.to, 0.8)], ["forearm", at(lo.from, lo.to, 0.5)]] as const) {
            const v = viewPoint(p, frame.yaw, frame.pitch);
            const x = v[0] + frame.off[0], y = v[1] + frame.off[1];
            // The last path drawn there (paths are painted in order).
            const top = [...paths].reverse().find((q) => q.attrs.fill && q.attrs.fill !== "none" && inside(q.d, x, y));
            expect(top && nearFill.includes(top.attrs.fill as string), `${name} ${view} t=${t.toFixed(2)} ${label}: ${top?.attrs.fill}`).toBe(true);
          }
        }
      });
    }
  }
});
