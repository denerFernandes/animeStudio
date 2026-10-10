/**
 * Turnarounds from volumes: a character piece (head, hair, torso…) is modelled as a signed
 * distance function in 3D — ellipsoids, capsules and tapers blended together, cut by planes — and
 * drawn from any angle around the vertical axis as flat cartoon shapes: the silhouette of the
 * piece (ray marched on a grid, traced with marching squares, smoothed into curves), its colour
 * regions (a stripe, a collar, a bib…) and what lies in front of another piece (the hair over the
 * forehead). Features drawn on a surface (eyes, brows, mouth) are projected from the front view.
 *
 * Model space is the front view (looking at the camera): x to the right of the screen, y down
 * (feet at y = 0), z towards the camera. A view turns the model by a yaw around the vertical
 * axis x = 0: positive angles turn the face towards +x (a three-quarter view facing right).
 * Everything is deterministic and runs once, when the character is built.
 */

export type V3 = [number, number, number];
export type P2 = [number, number];
/** Signed distance (approximate): negative inside. */
export type Sdf = (x: number, y: number, z: number) => number;

const r2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ------------------------------------------------------------------ primitives

export function ellipsoid(c: V3, rad: V3): Sdf {
  const [cx, cy, cz] = c, [rx, ry, rz] = rad;
  return (x, y, z) => {
    const px = (x - cx) / rx, py = (y - cy) / ry, pz = (z - cz) / rz;
    const k0 = Math.sqrt(px * px + py * py + pz * pz);
    const k1 = Math.sqrt((px / rx) ** 2 + (py / ry) ** 2 + (pz / rz) ** 2);
    return k1 === 0 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
  };
}

export function sphere(c: V3, rad: number): Sdf {
  return (x, y, z) => Math.hypot(x - c[0], y - c[1], z - c[2]) - rad;
}

/** A rounded cylinder from a to b (radius `ra` at a, `rb` at b). */
export function capsule(a: V3, b: V3, ra: number, rb = ra): Sdf {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
  const ll = bx * bx + by * by + bz * bz || 1;
  return (x, y, z) => {
    const px = x - a[0], py = y - a[1], pz = z - a[2];
    const h = clamp((px * bx + py * by + pz * bz) / ll, 0, 1);
    return Math.hypot(px - bx * h, py - by * h, pz - bz * h) - (ra + (rb - ra) * h);
  };
}

/** A box with rounded edges (`round`), centred on `c`, half sizes `h`. */
export function box(c: V3, h: V3, round = 0): Sdf {
  return (x, y, z) => {
    const qx = Math.abs(x - c[0]) - h[0] + round, qy = Math.abs(y - c[1]) - h[1] + round, qz = Math.abs(z - c[2]) - h[2] + round;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - round;
  };
}

/**
 * An elliptic cylinder between heights y0 (top) and y1 (bottom) whose half width / half depth go
 * from `top` to `bottom` (skirts, aprons, sleeves); `fwd` moves the centre towards the camera.
 */
export function taper(y0: number, y1: number, top: P2, bottom: P2, fwd = 0, cx = 0): Sdf {
  return (x, y, z) => {
    const t = clamp((y - y0) / (y1 - y0), 0, 1);
    const a = top[0] + (bottom[0] - top[0]) * t, b = top[1] + (bottom[1] - top[1]) * t;
    const k = Math.hypot((x - cx) / a, (z - fwd) / b);
    const side = (k - 1) * Math.min(a, b);
    return Math.max(side, y0 - y, y - y1);
  };
}

export const union = (...fs: Sdf[]): Sdf => (x, y, z) => {
  let d = Infinity;
  for (const f of fs) d = Math.min(d, f(x, y, z));
  return d;
};

/** Union blended over a distance `k` (soft cartoon joints). */
export const blend = (k: number, ...fs: Sdf[]): Sdf => (x, y, z) => {
  let d = fs[0](x, y, z);
  for (let i = 1; i < fs.length; i++) {
    const e = fs[i](x, y, z);
    const h = clamp(0.5 + (0.5 * (e - d)) / k, 0, 1);
    d = e * (1 - h) + d * h - k * h * (1 - h);
  }
  return d;
};

export const intersect = (...fs: Sdf[]): Sdf => (x, y, z) => {
  let d = -Infinity;
  for (const f of fs) d = Math.max(d, f(x, y, z));
  return d;
};

export const subtract = (a: Sdf, b: Sdf): Sdf => (x, y, z) => Math.max(a(x, y, z), -b(x, y, z));

/** Grows (positive) or shrinks a volume. */
export const grow = (f: Sdf, g: number): Sdf => (x, y, z) => f(x, y, z) - g;

/** Keeps the part above a height that may depend on x and z (inside where y < top(x, z)). */
export const above = (f: Sdf, top: (x: number, z: number) => number): Sdf => (x, y, z) => Math.max(f(x, y, z), y - top(x, z));
export const below = (f: Sdf, bottom: (x: number, z: number) => number): Sdf => (x, y, z) => Math.max(f(x, y, z), bottom(x, z) - y);

/** Bumpy surface (curls, an afro, a perm): small waves of amplitude `amp` and wavelength `size`. */
export const bumpy = (f: Sdf, amp: number, size: number): Sdf => {
  const k = (2 * Math.PI) / size;
  return (x, y, z) => f(x, y, z) - amp * (Math.sin(x * k + 1.3) * Math.sin(y * k * 1.1 + 0.7) * Math.sin(z * k * 0.9 + 2.1));
};

// ------------------------------------------------------------------ views

/**
 * A view of a volume: turned by `yaw` around the vertical axis (positive turns the model's front
 * towards +x), seen from `pitch` above (radians; positive looks down at it: tops show). A number is a
 * yaw with no pitch.
 */
export interface View { yaw: number; pitch: number }
export type ViewLike = number | View;
export const toView = (v: ViewLike): View => (typeof v === "number" ? { yaw: v, pitch: 0 } : v);

/** Model point → view space: screen x, screen y (down), depth (larger = nearer the camera). */
export function toCam(p: V3, view: ViewLike): V3 {
  const { yaw, pitch } = toView(view);
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const X = p[0] * cy + p[2] * sy, Z = -p[0] * sy + p[2] * cy;
  return [X, p[1] * cp + Z * sp, -p[1] * sp + Z * cp];
}
/** View space → model point. */
export function fromCam(X: number, Y: number, Z: number, view: ViewLike): V3 {
  const { yaw, pitch } = toView(view);
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const y = Y * cp - Z * sp, Zy = Y * sp + Z * cp;
  return [X * cy - Zy * sy, y, X * sy + Zy * cy];
}

/** Screen position of a model point in a view. */
export function project(p: V3, view: ViewLike): P2 {
  const c = toCam(p, view);
  return [c[0], c[1]];
}
/** Depth of a model point in a view (larger = nearer the camera). */
export const depthOf = (p: V3, view: ViewLike) => toCam(p, view)[2];

export interface Box3 { x: [number, number]; y: [number, number]; z: [number, number] }

export interface Grid {
  w: number;
  h: number;
  x0: number;
  y0: number;
  step: number;
}

export interface Cast {
  /** Silhouette field: negative inside (how deep the ray goes), positive outside (closest miss). */
  val: Float32Array;
  /** Depth of the first hit (−Infinity where the ray misses). */
  depth: Float32Array;
  /** Model point of the first hit (x, y, z per cell; NaN where the ray misses). */
  hit: Float32Array;
}

/** The screen grid covering a set of model boxes in a view. */
export function gridFor(boxes: Box3[], view: ViewLike, step: number): Grid & { zr: [number, number] } {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const b of boxes)
    for (const x of b.x)
      for (const y of b.y)
        for (const z of b.z) {
          const [X, Y, Z] = toCam([x, y, z], view);
          x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y); z0 = Math.min(z0, Z); z1 = Math.max(z1, Z);
        }
  // One empty cell all around: every traced outline closes.
  x0 = Math.floor(x0 / step - 2) * step; y0 = Math.floor(y0 / step - 2) * step;
  return { x0, y0, w: Math.ceil((x1 - x0) / step) + 3, h: Math.ceil((y1 - y0) / step) + 3, step, zr: [z0 - step, z1 + step] };
}

/** Ray marches a volume on a view's grid. */
export function cast(f: Sdf, g: Grid & { zr: [number, number] }, view: ViewLike): Cast {
  const n = g.w * g.h;
  const val = new Float32Array(n), depth = new Float32Array(n).fill(-Infinity), hit = new Float32Array(n * 3).fill(NaN);
  const { yaw, pitch } = toView(view);
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const [zmin, zmax] = g.zr;
  const minStep = g.step * 0.25;
  for (let j = 0; j < g.h; j++) {
    const Y = g.y0 + j * g.step;
    for (let i = 0; i < g.w; i++) {
      const X = g.x0 + i * g.step;
      const k = j * g.w + i;
      let Z = zmax, closest = Infinity, deepest = 0, entered = false;
      while (Z > zmin) {
        const y = Y * cp - Z * sp, Zy = Y * sp + Z * cp;
        const x = X * cy - Zy * sy, z = X * sy + Zy * cy;
        const d = f(x, y, z);
        if (d < closest) closest = d;
        if (d <= 0) {
          if (!entered) {
            entered = true;
            depth[k] = Z;
            hit[k * 3] = x; hit[k * 3 + 1] = y; hit[k * 3 + 2] = z;
          }
          if (-d > deepest) deepest = -d;
          Z -= Math.max(minStep, -d * 0.8);
        } else Z -= Math.max(minStep, d * 0.8);
      }
      val[k] = entered ? -Math.max(deepest, 0.05) : closest;
    }
  }
  return { val, depth, hit };
}

// ------------------------------------------------------------------ outlines

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

// ------------------------------------------------------------------ surfaces

/** The front surface point of a volume at (x, y) of the front view (undefined if it misses). */
export function surfaceZ(f: Sdf, x: number, y: number, zFrom = 400): number | undefined {
  let z = zFrom;
  for (let i = 0; i < 200 && z > -zFrom; i++) {
    const d = f(x, y, z);
    if (d < 0.05) return z;
    z -= Math.max(0.3, d * 0.9);
  }
  return undefined;
}

/** Normal of a volume (numeric gradient over `e`: a larger `e` smooths small bumps away). */
export function normal(f: Sdf, p: V3, e = 0.5): V3 {
  const nx = f(p[0] + e, p[1], p[2]) - f(p[0] - e, p[1], p[2]);
  const ny = f(p[0], p[1] + e, p[2]) - f(p[0], p[1] - e, p[2]);
  const nz = f(p[0], p[1], p[2] + e) - f(p[0], p[1], p[2] - e);
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

/**
 * Maps front-view points drawn on a surface to a view: each point is put on the surface (plus
 * `lift` along z) and turned. `visible` is false when the surface there faces away.
 */
export function onSurface(f: Sdf, theta: ViewLike) {
  const cache = new Map<string, V3 | null>();
  const lift3 = (x: number, y: number, lift: number): V3 | null => {
    const key = `${r2(x)},${r2(y)},${lift}`;
    if (cache.has(key)) return cache.get(key)!;
    const z = surfaceZ(f, x, y);
    const p: V3 | null = z === undefined ? null : [x, y, z + lift];
    cache.set(key, p);
    return p;
  };
  return {
    point(x: number, y: number, lift = 0): P2 {
      const p = lift3(x, y, lift);
      return p ? project(p, theta) : project([x, y, 0], theta);
    },
    /** Facing the camera at least `min` (0 = edge on, 1 = straight at it). */
    visible(x: number, y: number, min = 0.12) {
      const p = lift3(x, y, 0);
      if (!p) return false;
      const n = normal(f, p);
      return depthOf(n, theta) > min;
    },
  };
}
