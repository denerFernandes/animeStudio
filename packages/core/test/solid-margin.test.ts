import { describe, expect, it } from "vitest";
import { type CompiledRig3d, type SolidBody, compileRig, drawSolid, evaluatePose, parsePath } from "../src";

// An occluder's `margin`: a body behind it stays hidden a little past its edge in the picture, where
// its drawing (outline included) still is, while a body level with its edge or in front of it is
// drawn as without it.

/** The subpaths of a path and their areas (shoelace over the curve's end points). */
function islands(d: string): number[] {
  return parsePath(d).map((sp) => {
    const pts = [sp.start, ...sp.segments.map((s) => s[2])];
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
      a += x0 * y1 - x1 * y0;
    }
    return Math.abs(a / 2);
  });
}

describe("solid occluder margin", async () => {
  const kit = await import("../../kit/src");
  const look = { name: "mom", build: "woman", female: true, skin: "#e8b896", hair: "bun", hairColor: "#5b3a29", top: "blouse", topColor: "#e98a7b", bottom: "longSkirt", bottomColor: "#7c8f6a", shoes: "sandals", nose: "round" } as const;
  const a = kit.cartoonAnatomy(look as never);
  a.body.head = Math.round(a.body.head * 1.45);
  a.body.hip = Math.round(a.body.hip * 0.8);
  a.body.torso = Math.round(a.body.torso * 0.88);
  const doc = kit.cartoonCharacter(look as never, { anatomy: a, style: { ink: "#3a2824", shade: false, line: 2.8, limbs: "tube", hands: "open", eyes: "wide", proportions: "bigHead" } });
  const rig = compileRig(doc);
  const arms = rig.parts[rig.partIndex.get("arms")!] as unknown as { bodies: SolidBody[]; step: number };
  // The torso's occluder (the solid's first body without a fill), with a margin and without one.
  const torso = arms.bodies.findIndex((b) => !b.fill);
  const withMargin = arms.bodies.map((b, i) => (i === torso ? { ...b, margin: 8 } : b));
  const without = arms.bodies;

  for (const view of ["profile", "half", "front"]) {
    it(`${view}: a body level with the torso's edge or nearer (the near arm) is drawn as without a margin`, () => {
      const pose = evaluatePose(rig, { time: 0.4, controls: { view } } as never);
      const r3 = rig.rig3d as CompiledRig3d, frame = pose.frame3d!;
      const fill = (bodies: SolidBody[]) => drawSolid(bodies, arms.step, r3, frame).filter((p) => p.attrs.fill !== "none");
      const w = fill(withMargin), wo = fill(without);
      // The near arm's solid ("arms"): the far arm is an occluder in it; fills are the near arm and its sleeve.
      const skin = look.skin, top = look.topColor;
      const of = (ps: typeof w, c: string) => ps.filter((p) => p.attrs.fill === c).map((p) => p.d);
      const area = (d?: string) => (d ? islands(d).reduce((x, y) => x + y, 0) : 0);
      // The near arm and its sleeve: as without the margin (within the grid's rounding).
      for (const c of [skin, top]) {
        const nw = area(of(w, c).at(-1)), nwo = area(of(wo, c).at(-1));
        expect(Math.abs(nw - nwo), `${view} near ${c}`).toBeLessThan(Math.max(8, nwo * 0.03));
      }
    });
  }
});
