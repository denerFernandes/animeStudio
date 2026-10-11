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

/**
 * Open outline pieces of a field (grid units → model units), keeping only the stretches where `keep`
 * holds at the point (a line left out where a shape meets another drawing).
 */
export function fieldStroke(val: ArrayLike<number>, g: Grid, keep: (x: number, y: number) => boolean): string {
  let d = "";
  for (const loop of contours(val, g.w, g.h)) {
    const pts = loop.map(([i, j]) => [g.x0 + i * g.step, g.y0 + j * g.step] as P2);
    const ok = pts.map(([x, y]) => keep(x, y));
    if (ok.every(Boolean)) {
      d += " " + curvePath(pts, g.step, true);
      continue;
    }
    const start = ok.indexOf(false);
    let run: P2[] = [];
    const flush = () => {
      if (run.length > 3) d += " " + curvePath(run, g.step, false);
      run = [];
    };
    for (let s = 1; s <= pts.length; s++) {
      const i = (start + s) % pts.length;
      if (ok[i]) run.push(pts[i]);
      else flush();
    }
    flush();
  }
  return d.trim();
}

/**
 * Puts the zero crossing of a cast field where the silhouette is. A cast gives an outside cell its
 * ray's closest miss (≈ its distance to the silhouette) but an inside cell how deep its ray goes —
 * no distance at all: the crossing between the two, placed by the ratio of the values, drifts
 * towards the outside cell by up to a cell, differently from cell to cell, and the traced outline
 * comes out lumpy. Each inside cell at the edge is given the signed distance its outside neighbours
 * imply (`miss − step`), so the crossing lands on the silhouette. In place; only edge cells change.
 */
export function refineEdges(val: Float32Array, w: number, h: number, step: number): void {
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= w || j >= h ? step : val[j * w + i]);
  const inside = new Uint8Array(val.length);
  for (let c = 0; c < val.length; c++) inside[c] = val[c] < 0 ? 1 : 0;
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const c = j * w + i;
      if (!inside[c]) continue;
      let d = -Infinity;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const ii = i + di, jj = j + dj;
        if (ii >= 0 && jj >= 0 && ii < w && jj < h && inside[jj * w + ii]) continue;
        d = Math.max(d, Math.min(at(ii, jj), step) - step);
      }
      if (d > -Infinity) val[c] = Math.min(d, -0.02 * step);
    }
}

/** Uniform resampling of a polyline (closed: the last point joins the first) every `spacing`. */
function resample(pts: P2[], spacing: number, closed: boolean): P2[] {
  const src = closed ? [...pts, pts[0]] : pts;
  const out: P2[] = [src[0]];
  let carry = 0;
  for (let i = 1; i < src.length; i++) {
    const [ax, ay] = src[i - 1], [bx, by] = src[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-9) continue;
    let t = spacing - carry;
    while (t <= len) {
      out.push([ax + ((bx - ax) * t) / len, ay + ((by - ay) * t) / len]);
      t += spacing;
    }
    carry = len - (t - spacing);
  }
  if (closed) {
    // (The last sample is the first point again, or within a whisker of it.)
    const l = out[out.length - 1], f = out[0];
    if (out.length > 1 && Math.hypot(l[0] - f[0], l[1] - f[1]) < spacing * 0.5) out.pop();
  } else {
    const l = out[out.length - 1], e = src[src.length - 1];
    if (Math.hypot(l[0] - e[0], l[1] - e[1]) > spacing * 0.25) out.push(e);
    else out[out.length - 1] = e;
  }
  return out;
}

/** Turning angle at each point (radians, over `m` points each side); the ends of an open line get 0. */
function turning(pts: P2[], m: number, closed: boolean): number[] {
  const n = pts.length;
  return pts.map((p, i) => {
    if (!closed && (i < m || i >= n - m)) return 0;
    const a = pts[(i - m + n) % n], b = pts[(i + m) % n];
    const ux = p[0] - a[0], uy = p[1] - a[1], vx = b[0] - p[0], vy = b[1] - p[1];
    const l = (Math.hypot(ux, uy) * Math.hypot(vx, vy)) || 1;
    return Math.acos(clamp((ux * vx + uy * vy) / l, -1, 1));
  });
}

/** Where the outline turns sharply (a hair spike, a collar's point): the local peaks of the turning angle. */
const CORNER = (70 * Math.PI) / 180;

/**
 * A clean curve through a traced outline (model units), the way a vectorizer draws a shape: the
 * points resampled evenly along it, the corners found (sharp turns stay sharp), the stretches
 * between them smoothed free of the grid's lumps, the anchors chosen where the curve bends and
 * joined by cubic curves whose tangents follow the smoothed line. `step` is the grid's cell (the
 * size of the lumps to smooth away).
 */
export function curvePath(pts: P2[], step: number, closed: boolean): string {
  if (pts.length < 2) return "";
  const sp = Math.max(0.5, step);
  let p = resample(pts, sp, closed);
  if (p.length < (closed ? 3 : 2)) p = pts;
  const n = p.length;
  const ang = turning(p, 2, closed);
  const corner = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (ang[i] > CORNER && ang[i] >= ang[(i - 1 + n) % n] && ang[i] >= ang[(i + 1) % n]) corner[i] = 1;
  if (!closed) corner[0] = corner[n - 1] = 1;
  // Smoothing (two passes of a small Gaussian), the corners and ends held in place.
  for (let pass = 0; pass < 2; pass++) {
    const q = p.map((v) => [v[0], v[1]] as P2);
    for (let i = 0; i < n; i++) {
      if (corner[i]) continue;
      const w = [1, 4, 6, 4, 1];
      let x = 0, y = 0, tw = 0;
      for (let k = -2; k <= 2; k++) {
        let j = i + k;
        if (closed) j = (j + n) % n;
        else if (j < 0 || j >= n) continue;
        // (Across a corner the line is another stretch: it does not pull.)
        if (k && corner[j] && Math.abs(k) > 1) continue;
        x += p[j][0] * w[k + 2]; y += p[j][1] * w[k + 2]; tw += w[k + 2];
      }
      q[i] = [x / tw, y / tw];
    }
    p = q;
  }
  // Anchors: the corners, and between them where the curve strays from a straight run (RDP).
  const anchors: number[] = [];
  const cornersAt = [...corner].map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
  const tol = sp * 0.3;
  const rdp = (a: number, b: number, out: number[]) => {
    // Indices a → b along the loop (b may wrap).
    const len = ((b - a) % n + n) % n;
    const [ax, ay] = p[a], [bx, by] = p[b % n];
    const chord = Math.hypot(bx - ax, by - ay);
    let far = -1, fd = tol;
    for (let s = 1; s < len; s++) {
      const q = p[(a + s) % n];
      const d = chord < 1e-9 ? Math.hypot(q[0] - ax, q[1] - ay) : Math.abs((bx - ax) * (ay - q[1]) - (ax - q[0]) * (by - ay)) / chord;
      if (d > fd) { fd = d; far = (a + s) % n; }
    }
    if (far < 0) out.push(a);
    else { rdp(a, far, out); rdp(far, b, out); }
  };
  if (cornersAt.length >= (closed ? 1 : 2)) {
    for (let k = 0; k < cornersAt.length; k++) {
      const a = cornersAt[k], b = cornersAt[(k + 1) % cornersAt.length];
      if (!closed && k === cornersAt.length - 1) break;
      rdp(a, b === a ? a + n : b, anchors);
    }
    if (!closed) anchors.push(n - 1);
  } else {
    // A closed loop without corners: split at its two farthest-apart points.
    let m = 0, md = 0;
    for (let i = 1; i < n; i++) {
      const d = Math.hypot(p[i][0] - p[0][0], p[i][1] - p[0][1]);
      if (d > md) { md = d; m = i; }
    }
    rdp(0, m, anchors);
    rdp(m, n, anchors);
  }
  if (anchors.length < (closed ? 3 : 2)) return closed ? smoothPath(p) : "";
  // Tangent at a point: along the smoothed line; at a corner, one-sided.
  const tangent = (i: number, side: -1 | 1): P2 => {
    const j = corner[i] ? i + side : i + 1, k = corner[i] ? i : i - 1;
    const a = p[((closed ? (k + n) % n : clamp(k, 0, n - 1)))], b = p[((closed ? (j + n) % n : clamp(j, 0, n - 1)))];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  };
  let d = `M${r2(p[anchors[0]][0])} ${r2(p[anchors[0]][1])}`;
  const segs = closed ? anchors.length : anchors.length - 1;
  for (let s = 0; s < segs; s++) {
    const i = anchors[s], j = anchors[(s + 1) % anchors.length];
    const a = p[i], b = p[j];
    const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ta = tangent(i, 1), tb = tangent(j, -1);
    const k = chord / 3;
    d += ` C${r2(a[0] + ta[0] * k)} ${r2(a[1] + ta[1] * k)} ${r2(b[0] - tb[0] * k)} ${r2(b[1] - tb[1] * k)} ${r2(b[0])} ${r2(b[1])}`;
  }
  return closed ? d + " Z" : d;
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

/** Outline path of a field on a grid (model units), small specks dropped: clean curves (`curvePath`). */
export function fieldPath(val: ArrayLike<number>, g: Grid, minArea = 3): string {
  return contours(val, g.w, g.h)
    .filter((l) => Math.abs(area(l)) >= minArea)
    .map((l) => curvePath(l.map(([i, j]) => [g.x0 + i * g.step, g.y0 + j * g.step] as P2), g.step, true))
    .filter(Boolean)
    .join(" ");
}

