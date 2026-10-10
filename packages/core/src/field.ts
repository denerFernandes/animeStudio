/**
 * Outlines of sampled fields: a field sampled on a screen grid (negative inside) traced with
 * marching squares and smoothed into closed curves. Used by solids (`solid` parts) and by the kit's
 * volume drawings.
 */

export type P2 = [number, number];

/** A screen grid: `w`×`h` cells of `step` units from (`x0`, `y0`). */
export interface Grid {
  w: number;
  h: number;
  x0: number;
  y0: number;
  step: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Closed outlines (grid units) where a field crosses zero (marching squares). */
export function contours(val: ArrayLike<number>, w: number, h: number): P2[][] {
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= w || j >= h ? 1 : val[j * w + i]);
  const pts = new Map<string, P2>();
  const links = new Map<string, string[]>();
  const point = (key: string, p: P2) => (pts.has(key) ? key : (pts.set(key, p), key));
  const link = (a: string, b: string) => {
    (links.get(a) ?? links.set(a, []).get(a)!).push(b);
    (links.get(b) ?? links.set(b, []).get(b)!).push(a);
  };
  const lerp = (a: number, b: number) => (a === b ? 0.5 : clamp(a / (a - b), 0, 1));
  for (let j = -1; j < h; j++) {
    for (let i = -1; i < w; i++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
      const code = (a < 0 ? 1 : 0) | (b < 0 ? 2 : 0) | (c < 0 ? 4 : 0) | (d < 0 ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const top = () => point(`h${i},${j}`, [i + lerp(a, b), j]);
      const right = () => point(`v${i + 1},${j}`, [i + 1, j + lerp(b, c)]);
      const bottom = () => point(`h${i},${j + 1}`, [i + lerp(d, c), j + 1]);
      const left = () => point(`v${i},${j}`, [i, j + lerp(a, d)]);
      const centre = (a + b + c + d) / 4;
      switch (code) {
        case 1: case 14: link(left(), top()); break;
        case 2: case 13: link(top(), right()); break;
        case 4: case 11: link(right(), bottom()); break;
        case 8: case 7: link(bottom(), left()); break;
        case 3: case 12: link(left(), right()); break;
        case 6: case 9: link(top(), bottom()); break;
        case 5:
          if (centre < 0) { link(left(), bottom()); link(top(), right()); } else { link(left(), top()); link(right(), bottom()); }
          break;
        case 10:
          if (centre < 0) { link(left(), top()); link(right(), bottom()); } else { link(left(), bottom()); link(top(), right()); }
          break;
      }
    }
  }
  const seen = new Set<string>();
  const loops: P2[][] = [];
  for (const start of links.keys()) {
    if (seen.has(start)) continue;
    const loop: P2[] = [];
    let prev = "", cur = start;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      loop.push(pts.get(cur)!);
      const next = (links.get(cur) ?? []).find((k) => k !== prev && !seen.has(k)) ?? "";
      prev = cur;
      cur = next;
    }
    if (loop.length >= 4) loops.push(loop);
  }
  return loops;
}

const area = (pts: P2[]) => {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
};

function simplify(pts: P2[], tol: number): P2[] {
  if (pts.length < 8) return pts;
  const loop = [...pts, pts[0]];
  const rdp = (a: number, b: number, out: P2[]) => {
    const pts = loop;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let far = -1, fd = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
      if (d > fd) { fd = d; far = i; }
    }
    if (far < 0) out.push(pts[a]);
    else { rdp(a, far, out); rdp(far, b, out); }
  };
  // Split the loop at its two farthest-apart points.
  let m = 0, md = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > md) { md = d; m = i; }
  }
  const out: P2[] = [];
  rdp(0, m, out);
  rdp(m, loop.length - 1, out);
  return out.length >= 3 ? out : pts;
}

/** A smooth closed path through a polygon (quadratic curves between edge midpoints). */
export function smoothPath(pts: P2[]): string {
  const n = pts.length;
  const mid = (a: P2, b: P2): P2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const m0 = mid(pts[n - 1], pts[0]);
  let d = `M${r2(m0[0])} ${r2(m0[1])}`;
  for (let i = 0; i < n; i++) {
    const m = mid(pts[i], pts[(i + 1) % n]);
    d += ` Q${r2(pts[i][0])} ${r2(pts[i][1])} ${r2(m[0])} ${r2(m[1])}`;
  }
  return d + " Z";
}

/** Outline path of a field on a grid (model units), small specks dropped. */
export function fieldPath(val: ArrayLike<number>, g: Grid, minArea = 3): string {
  return contours(val, g.w, g.h)
    .filter((l) => Math.abs(area(l)) >= minArea)
    .map((l) => smoothPath(simplify(l.map(([i, j]) => [g.x0 + i * g.step, g.y0 + j * g.step] as P2), g.step * 0.35)))
    .join(" ");
}

