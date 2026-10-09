import { SVGPathData } from "svg-pathdata";
import { type Vec2, formatNumber as f, lerp, sub, normalize, add, scale } from "./math";

/**
 * A path normalized to absolute cubic Béziers.
 * Each subpath starts with a move point followed by cubic segments (3 points each).
 */
export interface CubicSubpath {
  start: Vec2;
  /** Flattened [c1, c2, end] triplets. */
  segments: [Vec2, Vec2, Vec2][];
  closed: boolean;
}

export type CubicPath = CubicSubpath[];

/** Parses any SVG path data into absolute cubic subpaths. */
export function parsePath(d: string): CubicPath {
  const data = new SVGPathData(d).toAbs().normalizeHVZ(false).normalizeST().qtToC().aToC();
  const out: CubicPath = [];
  let current: CubicSubpath | null = null;
  let cursor: Vec2 = [0, 0];
  for (const cmd of data.commands) {
    switch (cmd.type) {
      case SVGPathData.MOVE_TO:
        current = { start: [cmd.x, cmd.y], segments: [], closed: false };
        out.push(current);
        cursor = [cmd.x, cmd.y];
        break;
      case SVGPathData.LINE_TO: {
        if (!current) throw new Error("Path must start with M");
        const end: Vec2 = [cmd.x, cmd.y];
        current.segments.push([
          [lerp(cursor[0], end[0], 1 / 3), lerp(cursor[1], end[1], 1 / 3)],
          [lerp(cursor[0], end[0], 2 / 3), lerp(cursor[1], end[1], 2 / 3)],
          end,
        ]);
        cursor = end;
        break;
      }
      case SVGPathData.CURVE_TO: {
        if (!current) throw new Error("Path must start with M");
        const end: Vec2 = [cmd.x, cmd.y];
        current.segments.push([[cmd.x1, cmd.y1], [cmd.x2, cmd.y2], end]);
        cursor = end;
        break;
      }
      case SVGPathData.CLOSE_PATH:
        if (current) {
          current.closed = true;
          cursor = current.start;
        }
        break;
      default:
        throw new Error(`Unsupported path command type ${cmd.type}`);
    }
  }
  return out;
}

/** All points of a cubic path in order (start, then c1, c2, end of each segment). */
export function pathPoints(path: CubicPath): Vec2[] {
  const pts: Vec2[] = [];
  for (const sp of path) {
    pts.push(sp.start);
    for (const s of sp.segments) pts.push(s[0], s[1], s[2]);
  }
  return pts;
}

/** Rebuilds a path with the same structure from a flat list of points. */
export function withPoints(path: CubicPath, pts: Vec2[]): CubicPath {
  let i = 0;
  return path.map((sp) => ({
    start: pts[i++],
    segments: sp.segments.map(() => [pts[i++], pts[i++], pts[i++]] as [Vec2, Vec2, Vec2]),
    closed: sp.closed,
  }));
}

export function pathToString(path: CubicPath): string {
  let d = "";
  for (const sp of path) {
    d += `M${f(sp.start[0])} ${f(sp.start[1])}`;
    for (const [c1, c2, e] of sp.segments) {
      d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(e[0])} ${f(e[1])}`;
    }
    if (sp.closed) d += "Z";
  }
  return d;
}

function splitCubic(p0: Vec2, seg: [Vec2, Vec2, Vec2]): [[Vec2, Vec2, Vec2], [Vec2, Vec2, Vec2]] {
  const [p1, p2, p3] = seg;
  const m = (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const p01 = m(p0, p1);
  const p12 = m(p1, p2);
  const p23 = m(p2, p3);
  const p012 = m(p01, p12);
  const p123 = m(p12, p23);
  const mid = m(p012, p123);
  return [
    [p01, p012, mid],
    [p123, p23, p3],
  ];
}

const segLength = (p0: Vec2, s: [Vec2, Vec2, Vec2]) =>
  Math.hypot(s[0][0] - p0[0], s[0][1] - p0[1]) +
  Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]) +
  Math.hypot(s[2][0] - s[1][0], s[2][1] - s[1][1]);

/** Splits the longest segments of a subpath until it has `count` segments. */
function subdivideTo(sp: CubicSubpath, count: number): CubicSubpath {
  const segs = [...sp.segments];
  while (segs.length < count) {
    let longest = 0;
    let best = -1;
    for (let i = 0; i < segs.length; i++) {
      const p0 = i === 0 ? sp.start : segs[i - 1][2];
      const l = segLength(p0, segs[i]);
      if (l > longest) {
        longest = l;
        best = i;
      }
    }
    if (best < 0) {
      // Degenerate subpath: duplicate a zero-length segment.
      const last = segs.length ? segs[segs.length - 1][2] : sp.start;
      segs.push([last, last, last]);
      continue;
    }
    const p0 = best === 0 ? sp.start : segs[best - 1][2];
    const [a, b] = splitCubic(p0, segs[best]);
    segs.splice(best, 1, a, b);
  }
  return { start: sp.start, segments: segs, closed: sp.closed };
}

/**
 * Makes a set of paths structurally compatible (same subpaths, same segment counts),
 * so their points can be blended. Throws if subpath counts differ.
 */
export function equalizePaths(paths: CubicPath[]): CubicPath[] {
  const n = paths[0].length;
  for (const p of paths) {
    if (p.length !== n) throw new Error(`Morph shapes must have the same number of subpaths (${n} vs ${p.length})`);
  }
  return paths.map((p) =>
    p.map((sp, i) => {
      const max = Math.max(...paths.map((q) => q[i].segments.length));
      return subdivideTo(sp, max);
    }),
  );
}

// ---------------------------------------------------------------------------
// Hose (rubber hose limbs)
// ---------------------------------------------------------------------------

function catmullRom(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number, tension: number): Vec2 {
  const t2 = t * t;
  const t3 = t2 * t;
  const out: Vec2 = [0, 0];
  for (let k = 0; k < 2; k++) {
    const m1 = ((p2[k] - p0[k]) / 2) * tension;
    const m2 = ((p3[k] - p1[k]) / 2) * tension;
    out[k] =
      (2 * t3 - 3 * t2 + 1) * p1[k] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[k] + (t3 - t2) * m2;
  }
  return out;
}

/** Samples a smooth centerline through `joints`. */
export function sampleCenterline(joints: Vec2[], smooth: number, perSegment = 10): Vec2[] {
  if (joints.length < 2) return joints.slice();
  const pts: Vec2[] = [joints[0]];
  for (let i = 0; i < joints.length - 1; i++) {
    const p0 = joints[Math.max(0, i - 1)];
    const p1 = joints[i];
    const p2 = joints[i + 1];
    const p3 = joints[Math.min(joints.length - 1, i + 2)];
    for (let s = 1; s <= perSegment; s++) pts.push(catmullRom(p0, p1, p2, p3, s / perSegment, smooth));
  }
  return pts;
}

/**
 * Builds the outline path of a variable-width tube following `joints`.
 * `widths` has one entry per joint (interpolated along the length).
 */
export function hoseOutline(joints: Vec2[], widths: number[], cap: "round" | "butt", smooth: number): string {
  const perSegment = 10;
  const pts = sampleCenterline(joints, smooth, perSegment);
  if (pts.length < 2) return "";
  const n = pts.length;
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  const halfWidth = (i: number) => {
    const u = (i / (n - 1)) * (widths.length - 1);
    const k = Math.min(widths.length - 2, Math.floor(u));
    if (widths.length === 1) return widths[0] / 2;
    return lerp(widths[k], widths[k + 1], u - k) / 2;
  };
  for (let i = 0; i < n; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(n - 1, i + 1)];
    let dir = normalize(sub(next, prev));
    if (dir[0] === 0 && dir[1] === 0) dir = [1, 0];
    const nrm: Vec2 = [-dir[1], dir[0]];
    const w = halfWidth(i);
    left.push(add(pts[i], scale(nrm, w)));
    right.push(add(pts[i], scale(nrm, -w)));
  }
  const p = (v: Vec2) => `${f(v[0])} ${f(v[1])}`;
  let d = `M${p(left[0])}`;
  for (let i = 1; i < n; i++) d += `L${p(left[i])}`;
  const we = halfWidth(n - 1);
  d += cap === "round" ? `A${f(we)} ${f(we)} 0 0 0 ${p(right[n - 1])}` : `L${p(right[n - 1])}`;
  for (let i = n - 2; i >= 0; i--) d += `L${p(right[i])}`;
  const ws = halfWidth(0);
  d += cap === "round" ? `A${f(ws)} ${f(ws)} 0 0 0 ${p(left[0])}` : "";
  return d + "Z";
}
