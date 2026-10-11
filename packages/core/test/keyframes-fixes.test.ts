import { describe, expect, it } from "vitest";
import { makeTrack, normalizeTrack, parsePath, sampleTrack } from "../src";

describe("keyframe fixes", () => {
  it("returns the last of several keys at the first key's time (a stepped change placed on the first key)", () => {
    const tr = makeTrack([
      { t: 0, v: 100, ease: "step" },
      { t: 0, v: 500, ease: "step" },
      { t: 2, v: 500, ease: "step" },
    ]);
    expect(sampleTrack(tr, 0)).toBe(500);
    expect(sampleTrack(tr, -1)).toBe(500);
    expect(sampleTrack(tr, 1)).toBe(500);
    // The same in the middle of a track.
    const mid = makeTrack([
      { t: 0, v: 0, ease: "linear" },
      { t: 1, v: 10, ease: "linear" },
      { t: 1, v: 20, ease: "step" },
      { t: 2, v: 20, ease: "linear" },
    ]);
    expect(sampleTrack(mid, 0.5)).toBeCloseTo(5);
    expect(sampleTrack(mid, 1)).toBe(20);
  });

  it("computes seam tangents only when the last key sits at the end of the loop (loop.duration)", () => {
    // A cycle whose slopes agree across the seam: seamless gives a non-zero tangent at the first key.
    const keys: [number, number][] = [[0, 0], [0.3, 5], [0.6, -5], [1, 0]];
    const seamless = normalizeTrack(keys, { loop: { duration: 1 } });
    expect(Math.abs(seamless[0].m![0])).toBeGreaterThan(1);
    // The last key before the end of the loop: the value holds to the seam, so the cycle arrives at
    // and leaves its first key at rest (zero end tangents).
    const held = normalizeTrack([[0, 0], [0.3, 5], [0.6, -5], [0.9, 0]], { loop: { duration: 1 } });
    expect(held[0].m![0]).toBe(0);
    expect(held[held.length - 1].m![0]).toBe(0);
  });

  it("starts a new subpath after Z without an M, at the closed subpath's initial point", () => {
    const path = parsePath("M0 0 L10 0 L10 10 Z L20 20");
    expect(path).toHaveLength(2);
    expect(path[0].closed).toBe(true);
    expect(path[0].segments).toHaveLength(2);
    expect(path[1].closed).toBe(false);
    expect(path[1].start).toEqual([0, 0]);
    expect(path[1].segments).toHaveLength(1);
    expect(path[1].segments[0][2]).toEqual([20, 20]);
  });
});
