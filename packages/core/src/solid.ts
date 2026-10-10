/**
 * Solids (`solid` parts): volumes attached to the bones of a 2.5D rig, drawn every frame from the
 * current view the way a cartoon is painted — the fill, a cel shadow on the side turned away from
 * the light and an outline in the body's line colour.
 *
 * A solid has bodies, each a smooth union of shapes (cones between two points of the skeleton,
 * spheres, rounded boxes). The bodies are ray cast on a screen grid and composited per cell by depth
 * (the nearest surface wins, as in 3D), so a knee coming towards the camera is drawn over the shin
 * below it and a thigh over the other one, each outlined where it passes in front. A body without a
 * fill is an occluder: it hides the bodies behind it and draws nothing, so the drawing under the
 * solid shows there (the torso drawn by the rig, with the legs' solid over it only where they are
 * nearer than the torso).
 */
import { type Grid, fieldPath, fieldStroke } from "./field";
import type { CompiledRig3d, Rig3dFrame, V3 } from "./pose3d";

/** A point of the skeleton: along a 3D bone (`t`: 0 = its joint, 1 = its tip) plus an offset (body space, rest pose). */
export interface SolidPoint {
  bone: number;
  t: number;
  at: V3;
}

export type SolidShape =
  | { kind: "cone"; from: SolidPoint; to: SolidPoint; r: [number, number] }
  | { kind: "box"; at: SolidPoint; size: V3; round: number };

export interface SolidBody {
  /** Resolved colours; no fill: an occluder. */
  fill?: string;
  shade?: string;
  stroke?: string;
  strokeWidth: number;
  /** Smooth union of the shapes over this distance (0: a plain union). */
  blend: number;
  /** No outline where it meets an occluder: cloth that continues the drawing under it (a dress's skirt out of the torso). */
  seamless?: boolean;
  shapes: SolidShape[];
}

/** A shape in view space (screen x, screen y, depth towards the camera). */
type ViewShape =
  | { kind: "cone"; a: V3; b: V3; ra: number; rb: number }
  | { kind: "box"; c: V3; m: number[]; h: V3; round: number };

/** Light from the upper left, in front (view space, y down, z towards the camera). */
const LIGHT: V3 = (() => {
  const v: V3 = [-0.5, -0.62, 0.6];
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
})();
/** Cel shading: surfaces turned away from the light more than this are in shadow. */
const SHADE_AT = -0.02;

const r2 = (n: number) => Math.round(n * 100) / 100;

function shapeSdf(s: ViewShape): (x: number, y: number, z: number) => number {
  if (s.kind === "cone") {
    const { a, b, ra, rb } = s;
    const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
    const ll = bx * bx + by * by + bz * bz;
    if (ll < 1e-9) return (x, y, z) => Math.hypot(x - a[0], y - a[1], z - a[2]) - ra;
    return (x, y, z) => {
      const px = x - a[0], py = y - a[1], pz = z - a[2];
      const h = Math.max(0, Math.min(1, (px * bx + py * by + pz * bz) / ll));
      return Math.hypot(px - bx * h, py - by * h, pz - bz * h) - (ra + (rb - ra) * h);
    };
  }
  const { c, m, h, round } = s;
  return (x, y, z) => {
    const px = x - c[0], py = y - c[1], pz = z - c[2];
    const qx = Math.abs(m[0] * px + m[1] * py + m[2] * pz) - h[0] + round;
    const qy = Math.abs(m[3] * px + m[4] * py + m[5] * pz) - h[1] + round;
    const qz = Math.abs(m[6] * px + m[7] * py + m[8] * pz) - h[2] + round;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - round;
  };
}

function bodySdf(shapes: ViewShape[], k: number): (x: number, y: number, z: number) => number {
  const fs = shapes.map(shapeSdf);
  if (fs.length === 1) return fs[0];
  return (x, y, z) => {
    let d = fs[0](x, y, z);
    for (let i = 1; i < fs.length; i++) {
      const e = fs[i](x, y, z);
      if (k <= 0) d = Math.min(d, e);
      else {
        // Polynomial smooth minimum.
        const hh = Math.max(k - Math.abs(d - e), 0) / k;
        d = Math.min(d, e) - hh * hh * k * 0.25;
      }
    }
    return d;
  };
}

/** Screen box (x0, y0, x1, y1) and depth range of a view shape. */
function shapeBounds(s: ViewShape): [number, number, number, number, number, number] {
  if (s.kind === "cone") {
    const r = Math.max(s.ra, s.rb);
    return [Math.min(s.a[0], s.b[0]) - r, Math.min(s.a[1], s.b[1]) - r, Math.max(s.a[0], s.b[0]) + r, Math.max(s.a[1], s.b[1]) + r, Math.min(s.a[2], s.b[2]) - r, Math.max(s.a[2], s.b[2]) + r];
  }
  const e = Math.hypot(...s.h);
  return [s.c[0] - e, s.c[1] - e, s.c[0] + e, s.c[1] + e, s.c[2] - e, s.c[2] + e];
}

// ------------------------------------------------------------------ posing the shapes

const mv = (m: number[], v: V3): V3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];

/** The view rotation (body space → view space) of a yaw and a pitch. */
function viewMatrix(yaw: number, pitch: number): number[] {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  return [cy, 0, sy, -sy * sp, cp, cy * sp, -sy * cp, -sp, cy * cp];
}

function poseShapes(body: SolidBody, r3: CompiledRig3d, f: Rig3dFrame): ViewShape[] {
  const V = viewMatrix(f.yaw, f.pitch);
  const place = (p: SolidPoint): V3 => {
    const i = r3.byIndex.get(p.bone)!;
    const B = r3.bones[i];
    const rest: V3 = [(B.to[0] - B.from[0]) * p.t + p.at[0], (B.to[1] - B.from[1]) * p.t + p.at[1], (B.to[2] - B.from[2]) * p.t + p.at[2]];
    const w = mv(f.rot[i], rest);
    const q = mv(V, [f.pos[i][0] + w[0], f.pos[i][1] + w[1], f.pos[i][2] + w[2]]);
    return [q[0] + f.off[0], q[1] + f.off[1], q[2]];
  };
  return body.shapes.map((s): ViewShape => {
    if (s.kind === "cone") return { kind: "cone", a: place(s.from), b: place(s.to), ra: s.r[0], rb: s.r[1] };
    // View space → box space: the transpose of (view · bone rotation).
    const R = f.rot[r3.byIndex.get(s.at.bone)!];
    const VR = [0, 1, 2].flatMap((row) => [0, 1, 2].map((col) => V[row * 3] * R[col] + V[row * 3 + 1] * R[3 + col] + V[row * 3 + 2] * R[6 + col]));
    const m = [VR[0], VR[3], VR[6], VR[1], VR[4], VR[7], VR[2], VR[5], VR[8]];
    return { kind: "box", c: place(s.at), m, h: s.size, round: s.round };
  });
}

// ------------------------------------------------------------------ drawing

export interface SolidPath {
  d: string;
  attrs: Record<string, string | number>;
}

const cache = new Map<string, SolidPath[]>();
const CACHE_SIZE = 256;

/**
 * The paths drawing a solid for this frame (character space). Deterministic, and cached: a pose
 * held still (sitting through a dialogue) is drawn once.
 */
export function drawSolid(bodies: SolidBody[], step: number, r3: CompiledRig3d, frame: Rig3dFrame): SolidPath[] {
  const posed = bodies.map((b) => poseShapes(b, r3, frame));
  const key = step + "|" + posed.map((ss, i) => i + ":" + ss.map((s) => (s.kind === "cone" ? [...s.a, ...s.b, s.ra, s.rb] : [...s.c, ...s.m.map((v) => v * 100), ...s.h, s.round]).map((v) => Math.round(v * 2)).join(",")).join(";")).join("/");
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const out = castSolid(bodies, posed, step);
  cache.set(key, out);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return out;
}

function castSolid(bodies: SolidBody[], posed: ViewShape[][], step: number): SolidPath[] {
  const bounds = posed.map((ss) => {
    const b = ss.map(shapeBounds);
    return [Math.min(...b.map((q) => q[0])), Math.min(...b.map((q) => q[1])), Math.max(...b.map((q) => q[2])), Math.max(...b.map((q) => q[3])), Math.min(...b.map((q) => q[4])), Math.max(...b.map((q) => q[5]))];
  });
  const drawn = bodies.map((b, i) => i).filter((i) => bodies[i].fill && posed[i].length);
  if (!drawn.length) return [];
  // The grid covers the drawn bodies (occluders matter only where they hide one), one empty cell around.
  const gx0 = Math.floor(Math.min(...drawn.map((i) => bounds[i][0])) / step - 2) * step;
  const gy0 = Math.floor(Math.min(...drawn.map((i) => bounds[i][1])) / step - 2) * step;
  const g: Grid = { x0: gx0, y0: gy0, step, w: Math.ceil((Math.max(...drawn.map((i) => bounds[i][2])) - gx0) / step) + 3, h: Math.ceil((Math.max(...drawn.map((i) => bounds[i][3])) - gy0) / step) + 3 };
  const n = g.w * g.h;
  const sdfs = bodies.map((b, i) => bodySdf(posed[i], b.blend));
  const minStep = step * 0.25;
  const vals: Float32Array[] = [], depths: Float32Array[] = [];
  const castBody = (k: number, only?: Uint8Array) => {
    const f = sdfs[k], [bx0, by0, bx1, by1, zmin, zmax] = bounds[k];
    const val = new Float32Array(n).fill(step * 4), depth = new Float32Array(n).fill(-Infinity);
    for (let j = 0; j < g.h; j++) {
      const Y = g.y0 + j * step;
      if (Y < by0 - step * 2 || Y > by1 + step * 2) continue;
      for (let i = 0; i < g.w; i++) {
        const X = g.x0 + i * step;
        if (X < bx0 - step * 2 || X > bx1 + step * 2) continue;
        const c = j * g.w + i;
        if (only && !only[c]) continue;
        let Z = zmax + 1, closest = Infinity, deepest = 0, entered = false;
        while (Z > zmin - 1) {
          const d = f(X, Y, Z);
          if (d < closest) closest = d;
          if (d <= 0) {
            if (!entered) {
              entered = true;
              depth[c] = Z;
            }
            if (-d > deepest) deepest = -d;
            Z -= Math.max(minStep, -d * 0.8);
          } else {
            if (entered) break;
            Z -= Math.max(minStep, d * 0.9);
          }
        }
        val[c] = entered ? -Math.max(deepest, 0.05) : closest;
      }
    }
    vals[k] = val;
    depths[k] = depth;
  };
  for (const k of drawn) castBody(k);
  // Occluders only where a drawn body is (and a few cells around: where a seam is looked for).
  const covered = new Uint8Array(n);
  const R = 7;
  for (const k of drawn)
    for (let c = 0; c < n; c++) {
      if (vals[k][c] >= 0) continue;
      const ci = c % g.w, cj = Math.floor(c / g.w);
      for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
        const i = ci + di, j = cj + dj;
        if (i >= 0 && j >= 0 && i < g.w && j < g.h) covered[j * g.w + i] = 1;
      }
    }
  bodies.forEach((b, k) => {
    if (!b.fill && posed[k].length) castBody(k, covered);
  });
  // The nearest body at each cell.
  const nearest = new Int16Array(n).fill(-1);
  for (let c = 0; c < n; c++) {
    let best = -Infinity;
    for (let k = 0; k < bodies.length; k++) if (vals[k] && vals[k][c] < 0 && depths[k][c] > best) { best = depths[k][c]; nearest[c] = k; }
  }
  const fills: SolidPath[] = [], lines: SolidPath[] = [];
  for (const k of drawn) {
    const b = bodies[k], val = vals[k], f = sdfs[k];
    const field = new Float32Array(n);
    for (let c = 0; c < n; c++) field[c] = val[c] < 0 ? (nearest[c] === k ? val[c] : 1) : val[c];
    const outline = fieldPath(field, g);
    if (!outline) continue;
    fills.push({ d: outline, attrs: { fill: b.fill!, "fill-rule": "evenodd" } });
    if (b.shade) {
      // Cel shading from the surface normal (a smooth terminator: lighting is a continuous field).
      const e = Math.max(1, step);
      const light = new Float32Array(n).fill(1);
      for (let c = 0; c < n; c++) {
        if (nearest[c] !== k) continue;
        const X = g.x0 + (c % g.w) * step, Y = g.y0 + Math.floor(c / g.w) * step, Z = depths[k][c];
        const nx = f(X + e, Y, Z) - f(X - e, Y, Z), ny = f(X, Y + e, Z) - f(X, Y - e, Z), nz = f(X, Y, Z + e) - f(X, Y, Z - e);
        const l = Math.hypot(nx, ny, nz) || 1;
        light[c] = ((nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / l - SHADE_AT) * 20;
      }
      const d = fieldPath(light, g, 6);
      if (d) fills.push({ d, attrs: { fill: b.shade, "fill-rule": "evenodd" } });
    }
    if (b.stroke && b.strokeWidth > 0) {
      let d = outline;
      if (b.seamless) {
        // Left out where an occluder is right there (the drawing it continues).
        const occ = bodies.map((x, i) => i).filter((i) => !bodies[i].fill && vals[i]);
        const at = (x: number, y: number) => {
          const i = Math.round((x - g.x0) / step), j = Math.round((y - g.y0) / step);
          // (The drawing is a little larger than its occluder: a few cells' margin.)
          const M = Math.max(2, Math.round(10 / step));
          for (let dj = -M; dj <= M; dj++) for (let di = -M; di <= M; di++) {
            const ii = i + di, jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= g.w || jj >= g.h) continue;
            if (occ.some((o) => vals[o][jj * g.w + ii] < 0)) return true;
          }
          return false;
        };
        d = fieldStroke(field, g, (x, y) => !at(x, y));
      }
      if (d) lines.push({ d, attrs: { fill: "none", stroke: b.stroke, "stroke-width": b.strokeWidth, "stroke-linejoin": "round", "stroke-linecap": "round", "fill-rule": "evenodd" } });
    }
  }
  return [...fills, ...lines];
}

/** The screen box of a solid this frame (for tests and debugging). */
export function solidBounds(bodies: SolidBody[], r3: CompiledRig3d, frame: Rig3dFrame): [number, number, number, number] {
  const b = bodies.flatMap((x) => poseShapes(x, r3, frame).map(shapeBounds));
  return [r2(Math.min(...b.map((q) => q[0]))), r2(Math.min(...b.map((q) => q[1]))), r2(Math.max(...b.map((q) => q[2]))), r2(Math.max(...b.map((q) => q[3])))];
}
