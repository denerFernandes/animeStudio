/** 2D point / vector. */
export type Vec2 = [number, number];

/**
 * 2D affine matrix in SVG order `[a, b, c, d, e, f]`:
 * x' = a·x + c·y + e, y' = b·x + d·y + f
 */
export type Mat = [number, number, number, number, number, number];

export const DEG = Math.PI / 180;

export const identity = (): Mat => [1, 0, 0, 1, 0, 0];

export function multiply(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return identity();
  const id = 1 / det;
  return [
    m[3] * id,
    -m[1] * id,
    -m[2] * id,
    m[0] * id,
    (m[2] * m[5] - m[3] * m[4]) * id,
    (m[1] * m[4] - m[0] * m[5]) * id,
  ];
}

/** Translate · Rotate(degrees) · Scale. */
export function fromTRS(x: number, y: number, rotationDeg: number, sx = 1, sy = 1): Mat {
  const r = rotationDeg * DEG;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return [cos * sx, sin * sx, -sin * sy, cos * sy, x, y];
}

export function apply(m: Mat, p: Vec2): Vec2 {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

/** Applies only the linear part (no translation). */
export function applyLinear(m: Mat, v: Vec2): Vec2 {
  return [m[0] * v[0] + m[2] * v[1], m[1] * v[0] + m[3] * v[1]];
}

/** World angle (degrees) of the matrix's +x axis. */
export const matAngle = (m: Mat): number => Math.atan2(m[1], m[0]) / DEG;
export const matScaleX = (m: Mat): number => Math.hypot(m[0], m[1]);
export const matScaleY = (m: Mat): number => {
  const sx = matScaleX(m);
  return sx === 0 ? 0 : (m[0] * m[3] - m[1] * m[2]) / sx;
};

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);

/** Wraps an angle in degrees to (-180, 180]. */
export function wrapAngle(deg: number): number {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a;
}

export const angleOf = (v: Vec2): number => Math.atan2(v[1], v[0]) / DEG;
export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const scale = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s];
export const length = (v: Vec2): number => Math.hypot(v[0], v[1]);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function normalize(v: Vec2): Vec2 {
  const l = Math.hypot(v[0], v[1]);
  return l === 0 ? [0, 0] : [v[0] / l, v[1] / l];
}

/** Distance from point `p` to segment `a`–`b`. */
export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const l2 = ab[0] * ab[0] + ab[1] * ab[1];
  if (l2 === 0) return dist(p, a);
  const t = clamp(((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2, 0, 1);
  return dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t]);
}

/** Stable 32-bit string hash (FNV-1a). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic PRNG (mulberry32). Returns a function yielding floats in [0, 1). */
export function seededRandom(seed: number | string): () => number {
  let a = typeof seed === "string" ? hashString(seed) : seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth deterministic 1D value noise in [-1, 1]. */
export function noise1(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const h = (n: number) => {
    const r = seededRandom((seed ^ Math.imul(n, 0x27d4eb2d)) >>> 0)();
    return r * 2 - 1;
  };
  const u = f * f * (3 - 2 * f);
  return lerp(h(i), h(i + 1), u);
}

const fmt = (n: number): string => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
};

export const formatNumber = fmt;

export function matToString(m: Mat): string {
  return `matrix(${m.map(fmt).join(" ")})`;
}

export const isIdentity = (m: Mat): boolean =>
  m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
