import { describe, expect, it } from "vitest";
import { type CompiledRig3d, type SolidBody, compileRig, drawSolid, evaluatePose, parsePath } from "../src";

// An occluder's `margin`: a body behind it stays hidden a little past its edge in the picture, where
// its drawing (outline included) still is — no sliver of a far arm along a torso's outline — while a
// body in front of it is drawn exactly as without it.

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
  const torso = arms.bodies.findIndex((b) => !b.fill && b.margin);
  const without = arms.bodies.map((b, i) => (i === torso ? { ...b, margin: undefined } : b));

  it("the kit's torso has a margin for the arms", () => {
    expect(torso).toBeGreaterThanOrEqual(0);
    expect(arms.bodies[torso].margin).toBe(kit.TORSO_MARGIN);
  });

  for (const view of ["profile", "half", "front"]) {
    it(`${view}: the far arm loses its slivers, the near arm is unchanged`, () => {
      const pose = evaluatePose(rig, { time: 0.4, controls: { view } } as never);
      const r3 = rig.rig3d as CompiledRig3d, frame = pose.frame3d!;
      const fill = (bodies: SolidBody[]) => drawSolid(bodies, arms.step, r3, frame).filter((p) => p.attrs.fill !== "none");
      const w = fill(arms.bodies), wo = fill(without);
      // Fills come in the drawn bodies' order: the far arm (B) and its sleeve, then the near arm (F) and its sleeve.
      const skin = look.skin, top = look.topColor;
      const of = (ps: typeof w, c: string) => ps.filter((p) => p.attrs.fill === c).map((p) => p.d);
      const area = (d?: string) => (d ? islands(d).reduce((x, y) => x + y, 0) : 0);
      // The near arm and its sleeve: as without the margin (within the grid's rounding).
      for (const c of [skin, top]) {
        const nw = area(of(w, c).at(-1)), nwo = area(of(wo, c).at(-1));
        expect(Math.abs(nw - nwo), `${view} near ${c}`).toBeLessThan(Math.max(8, nwo * 0.03));
      }
      // The far arm: no island smaller than a few cells left with the margin.
      const tiny = (d?: string) => (d ? islands(d).filter((x) => x > 0 && x < 60).length : 0);
      expect(tiny(of(w, skin)[0])).toBeLessThanOrEqual(tiny(of(wo, skin)[0]));
    });
  }
});
