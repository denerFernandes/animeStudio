import type { SurfaceDef } from "./format/schema";
import { type Vec2, lerp } from "./math";
import { parsePath } from "./paths";

/**
 * Walkable ground lines. A surface is the top edge of the ground (a branch, a hill, a floor) as an
 * SVG path in scene space; it is sampled into an x-sorted polyline so `surfaceY(x)` is cheap.
 */
export interface Surface {
  id: string;
  /** Sampled points, sorted by x. */
  points: Vec2[];
}

function cubicAt(p0: Vec2, c1: Vec2, c2: Vec2, p1: Vec2, t: number): Vec2 {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0],
    u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1],
  ];
}

export function compileSurface(def: SurfaceDef): Surface {
  const points: Vec2[] = [];
  for (const sp of parsePath(def.path)) {
    let prev = sp.start;
    points.push(prev);
    for (const [c1, c2, end] of sp.segments) {
      for (let i = 1; i <= 16; i++) points.push(cubicAt(prev, c1, c2, end, i / 16));
      prev = end;
    }
  }
  points.sort((a, b) => a[0] - b[0]);
  return { id: def.id, points };
}

/** Height (y) of a surface at scene x; clamped to the ends outside its range. */
export function surfaceY(surface: Surface, x: number): number {
  const p = surface.points;
  if (!p.length) return 0;
  if (x <= p[0][0]) return p[0][1];
  if (x >= p[p.length - 1][0]) return p[p.length - 1][1];
  let lo = 0;
  let hi = p.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (p[mid][0] <= x) lo = mid;
    else hi = mid;
  }
  const span = p[hi][0] - p[lo][0];
  return span <= 0 ? p[lo][1] : lerp(p[lo][1], p[hi][1], (x - p[lo][0]) / span);
}
