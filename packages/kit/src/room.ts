/**
 * A room seen by one camera (2.5D): a one-point perspective — a horizon, a vanishing point, the
 * floor line where 1 world unit = 1 px — and furniture modelled as volumes, each drawn flat from the
 * angle the camera sees it at (its own turn, plus how far it is off the camera's axis, plus the
 * camera looking down at it), with cel shading and coloured lines like the cartoon characters. So
 * the sofa, the TV, the floor and the people sitting agree in perspective.
 *
 * World space: x to the right (scene px on the floor line), z into the room (0 = the floor line,
 * larger = further), h up from the floor. A piece of furniture's own model: front towards the
 * camera (+z in model space), floor at y = 0, y down, centred on x = 0, z = 0; `turn` (degrees)
 * turns its front towards the right of the screen.
 */
import type { ToonDoc } from "@animestudio/core";
import { type PieceOpts, piece, withTones } from "./cartoon";
import { type Box3, type P2, type Sdf, type V3, type View, box, capsule, cast, gridFor, project } from "./volume";

export interface RoomCamera {
  /** Screen y of the horizon (eye level). */
  horizon: number;
  /** Screen x of the vanishing point. */
  vpx: number;
  /** Screen y of the floor line (depth 0): there 1 world unit = 1 px. */
  y0: number;
  /** Distance of the camera from the floor line (world units): smaller = stronger perspective. */
  dist: number;
}

const r = (n: number) => Math.round(n * 100) / 100;

/** Screen point and scale of a world point (x, depth z, height h). */
export function roomPoint(cam: RoomCamera, x: number, z: number, h = 0): [number, number, number] {
  const k = cam.dist / (cam.dist + z);
  return [r(cam.vpx + (x - cam.vpx) * k), r(cam.horizon + (cam.y0 - cam.horizon - h) * k), r(k)];
}

/** Depth of a screen y on the floor (inverse of `roomPoint`): where to place something standing there. */
export function floorDepth(cam: RoomCamera, y: number): number {
  return cam.dist * ((cam.y0 - cam.horizon) / (y - cam.horizon) - 1);
}

/**
 * How the camera sees something standing at (x, z) and turned by `turn` degrees: its yaw (turn plus
 * how far it is off the camera's axis) and the pitch the camera looks down at it.
 */
export function viewAt(cam: RoomCamera, x: number, z: number, turn = 0): View {
  const d = cam.dist + z;
  return { yaw: (turn * Math.PI) / 180 + Math.atan2(x - cam.vpx, d), pitch: Math.atan2(cam.y0 - cam.horizon, d) };
}

// ------------------------------------------------------------------ floors

/** A polygon on the floor (world points), as screen points. */
export function floorPolygon(cam: RoomCamera, pts: [number, number][]): P2[] {
  return pts.map(([x, z]) => {
    const p = roomPoint(cam, x, z);
    return [p[0], p[1]];
  });
}

/**
 * Floor lines for a room (screen-space SVG): boards (`taco`), tiles or planks running from the floor
 * line to `depth`, converging on the vanishing point.
 */
export function floorLines(cam: RoomCamera, o: { x0: number; x1: number; depth: number; size: number; kind?: "tiles" | "boards"; color: string; width?: number; opacity?: number }): string {
  const w = o.width ?? 2.5, op = o.opacity ?? 0.5;
  let d = "";
  for (let x = o.x0; x <= o.x1 + 1e-6; x += o.size) {
    const a = roomPoint(cam, x, 0), b = roomPoint(cam, x, o.depth);
    d += `M${a[0]} ${a[1]} L${b[0]} ${b[1]} `;
  }
  const rows = o.kind === "boards" ? o.size * 3 : o.size;
  for (let z = 0; z <= o.depth + 1e-6; z += rows) {
    const a = roomPoint(cam, o.x0, z), b = roomPoint(cam, o.x1, z);
    d += `M${a[0]} ${a[1]} L${b[0]} ${b[1]} `;
  }
  return `<path d="${d.trim()}" fill="none" stroke="${o.color}" stroke-width="${w}" opacity="${op}"/>`;
}

/** An ellipse lying on the floor (a rug), as a screen-space SVG path. */
export function floorEllipse(cam: RoomCamera, x: number, z: number, rx: number, rz: number, attrs: string): string {
  const pts = Array.from({ length: 48 }, (_, i) => {
    const a = (i / 48) * Math.PI * 2;
    const p = roomPoint(cam, x + Math.cos(a) * rx, z + Math.sin(a) * rz);
    return `${p[0]} ${p[1]}`;
  });
  return `<path d="M${pts.join(" L")} Z" ${attrs}/>`;
}

// ------------------------------------------------------------------ furniture models

/** A part of a piece of furniture: a volume, its colour (palette key) and outline. */
export interface Component { sdf: Sdf; box: Box3; color: string; regions?: (p: V3) => string; edges?: string[] }

export interface FurnitureModel {
  name: string;
  parts: Component[];
  /** Hip points of the seats (model space), first `seat`, then `seat2`… */
  seats?: V3[];
  /** Other named points (model space): `top` of a table, the `screen` of a TV… */
  points?: Record<string, V3>;
  palette: Record<string, string>;
  /** Floor footprint (half width, half depth) for its shadow. */
  footprint: [number, number];
}

const boxPart = (c: V3, h: V3, round: number, color: string, regions?: (p: V3) => string, edges?: string[]): Component => ({
  sdf: box(c, h, round),
  box: { x: [c[0] - h[0], c[0] + h[0]], y: [c[1] - h[1], c[1] + h[1]], z: [c[2] - h[2], c[2] + h[2]] },
  color,
  regions,
  edges,
});

/**
 * A sofa (or with `seats: 1`, an armchair): a frame on short legs, seat cushions, a backrest with
 * back cushions, two arms. Sizes in world units (the floor line's px).
 */
export function sofaModel(o: { seats?: number; width?: number; depth?: number; seat?: number; back?: number; arm?: number; fabric: string; cushion?: string; legs?: string; doilies?: string }): FurnitureModel {
  const n = o.seats ?? 3, W = o.width ?? 300 * n, D = o.depth ?? 330, seatH = o.seat ?? 150, backH = o.back ?? 400, armH = o.arm ?? 240;
  const armW = Math.min(110, W * 0.12), backT = 95, legH = 22;
  const inner = W - armW * 2, cw = inner / n;
  const parts: Component[] = [];
  // Legs, the frame, the backrest.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(boxPart([sx * (W / 2 - 30), -legH / 2, sz * (D / 2 - 30)], [12, legH / 2, 12], 3, "legs"));
  const frameTop = seatH - 48;
  // (Parts never share a surface: coplanar faces would flicker between them.)
  parts.push(boxPart([0, -(legH + frameTop) / 2, 3], [W / 2 - armW + 6, (frameTop - legH) / 2, D / 2 - 6], 16, "fabric"));
  parts.push(boxPart([0, -(seatH - 20 + backH) / 2, -D / 2 + backT / 2 + 4], [W / 2 - 8, (backH - seatH + 20) / 2, backT / 2], 34, "fabric"));
  // Seat cushions and back cushions, one per seat; doilies on the back cushions' tops.
  const doily = o.doilies;
  for (let i = 0; i < n; i++) {
    const cx = -inner / 2 + cw * (i + 0.5);
    parts.push(boxPart([cx, -(frameTop + seatH) / 2, backT / 2], [cw / 2 - 3, (seatH - frameTop) / 2, D / 2 - backT / 2], 20, "cushion"));
    const by0 = seatH + 4, by1 = backH - 26;
    parts.push(boxPart([cx, -(by0 + by1) / 2, -D / 2 + backT + 26], [cw / 2 - 6, (by1 - by0) / 2, 30], 30, "cushion", doily ? (p) => (p[1] < -by1 + 24 && p[2] > -D / 2 + backT + 20 && Math.abs(p[0] - cx) < cw * 0.28 ? "doily" : "cushion") : undefined, doily ? ["doily"] : []));
  }
  // Arms, their tops a little rounder.
  for (const sx of [-1, 1]) parts.push(boxPart([sx * (W / 2 - armW / 2), -(legH + armH) / 2, 0], [armW / 2, (armH - legH) / 2, D / 2], 36, "fabric", doily ? (p) => (p[1] < -armH + 30 && p[2] > 0 && p[2] < D * 0.35 ? "doily" : "fabric") : undefined, doily ? ["doily"] : []));
  const seats = Array.from({ length: n }, (_, i) => [-inner / 2 + cw * (i + 0.5), -seatH + 6, 10] as V3);
  return {
    name: n === 1 ? "armchair" : "sofa",
    parts,
    seats,
    palette: { fabric: o.fabric, cushion: o.cushion ?? o.fabric, legs: o.legs ?? "#4a2e18", doily: o.doilies ?? "#fbf8f0" },
    footprint: [W / 2 + 10, D / 2 + 10],
  };
}

/** A CRT television on its own (no stand): the cabinet, the tube's bulge behind, the screen, knobs, rabbit-ear antenna. */
export function crtTvModel(o: { width?: number; cabinet?: string; screen?: string; antenna?: boolean } = { }): FurnitureModel {
  const w = o.width ?? 300, h = w * 0.78, d = w * 0.5;
  const front = boxPart([0, -h / 2, d * 0.15], [w / 2, h / 2, d * 0.35], 22, "cabinet", (p) => (p[2] > d * 0.42 && Math.abs(p[0] + w * 0.1) < w * 0.32 && Math.abs(p[1] + h * 0.5) < h * 0.36 ? "screen" : p[2] > d * 0.42 && p[0] > w * 0.3 && Math.abs(p[1] + h * 0.55) < h * 0.2 && Math.round(p[1] / 18) % 2 === 0 ? "knob" : "cabinet"), ["screen", "knob"]);
  const bulge = boxPart([0, -h * 0.48, -d * 0.35], [w * 0.36, h * 0.36, d * 0.3], 40, "cabinet");
  const parts = [bulge, front];
  if (o.antenna !== false) {
    const top: V3 = [0, -h - 4, -d * 0.1];
    for (const s of [-1, 1]) {
      const a = capsule(top, [s * w * 0.42, -h - w * 0.62, -d * 0.2], 3.5);
      parts.push({ sdf: a, box: { x: [Math.min(0, s * w * 0.45) - 6, Math.max(0, s * w * 0.45) + 6], y: [-h - w * 0.66, -h], z: [-d * 0.3, 0] }, color: "metal" });
    }
    parts.push(boxPart([0, -h - 8, -d * 0.1], [w * 0.1, 8, w * 0.07], 6, "plastic"));
  }
  return {
    name: "tv",
    parts,
    points: { screen: [-w * 0.1, -h * 0.5, d * 0.5], top: [0, -h, 0] },
    palette: { cabinet: o.cabinet ?? "#6e5a48", screen: o.screen ?? "#3a4a4f", knob: "#c9b89a", metal: "#a9a9a9", plastic: "#2a2a2a" },
    footprint: [w / 2, d / 2],
  };
}

/** A low table or a TV stand (a box on four legs). */
export function tableModel(o: { width?: number; depth?: number; height?: number; wood?: string; top?: string } = {}): FurnitureModel {
  const w = o.width ?? 320, d = o.depth ?? 180, h = o.height ?? 160;
  const parts: Component[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(boxPart([sx * (w / 2 - 16), -(h - 16) / 2, sz * (d / 2 - 16)], [9, (h - 16) / 2, 9], 3, "wood"));
  parts.push(boxPart([0, -h + 8, 0], [w / 2, 8, d / 2], 5, "top"));
  return { name: "table", parts, points: { top: [0, -h, 0] }, palette: { wood: o.wood ?? "#7a4e2c", top: o.top ?? o.wood ?? "#8a5a34" }, footprint: [w / 2, d / 2] };
}

// ------------------------------------------------------------------ drawing

/**
 * Draws a model's parts from a view with a soft floor shadow. Parts are composited per pixel by
 * depth (the nearest surface wins, as in 3D): each part is drawn only where it is in front, so its
 * outline also marks where it passes in front of another. Setup space: floor centre at (0, 0).
 */
export function drawModel(m: FurnitureModel, view: View, step = 2.5): string {
  const shadow = Array.from({ length: 32 }, (_, i) => {
    const a = (i / 32) * Math.PI * 2;
    const p = project([Math.cos(a) * m.footprint[0] * 1.05, 0, Math.sin(a) * m.footprint[1] * 1.08], view);
    return `${r(p[0])} ${r(p[1])}`;
  });
  const g = gridFor(m.parts.map((c) => c.box), view, step);
  const n = g.w * g.h;
  // Each part cast on its own small grid (aligned with the common one), copied into full-size buffers.
  const casts = m.parts.map((c) => {
    const sub = gridFor([c.box], view, step);
    const cc = cast(c.sdf, sub, view);
    const val = new Float32Array(n).fill(step * 4), depth = new Float32Array(n).fill(-Infinity), hit = new Float32Array(n * 3).fill(NaN);
    const di = Math.round((sub.x0 - g.x0) / step), dj = Math.round((sub.y0 - g.y0) / step);
    for (let j = 0; j < sub.h; j++) {
      const jj = j + dj;
      if (jj < 0 || jj >= g.h) continue;
      for (let i = 0; i < sub.w; i++) {
        const ii = i + di;
        if (ii < 0 || ii >= g.w) continue;
        const a = j * sub.w + i, b = jj * g.w + ii;
        val[b] = cc.val[a];
        depth[b] = cc.depth[a];
        hit[b * 3] = cc.hit[a * 3]; hit[b * 3 + 1] = cc.hit[a * 3 + 1]; hit[b * 3 + 2] = cc.hit[a * 3 + 2];
      }
    }
    return { val, depth, hit };
  });
  // The nearest part at each cell.
  const nearest = new Int16Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    let best = -Infinity;
    casts.forEach((c, k) => {
      if (c.val[i] < 0 && c.depth[i] > best) { best = c.depth[i]; nearest[i] = k; }
    });
  }
  let art = `<path d="M${shadow.join(" L")} Z" fill="#000" opacity="0.16"/>`;
  m.parts.forEach((c, k) => {
    const cc = casts[k];
    const field = new Float32Array(n);
    for (let i = 0; i < n; i++) field[i] = cc.val[i] < 0 ? (nearest[i] === k ? cc.val[i] : 1) : cc.val[i];
    art += piece(cc, g, { sdf: c.sdf, theta: view, base: c.color, color: c.regions, edges: c.edges, field });
  });
  return art;
}

/**
 * A piece of furniture placed in a room: the rig (its drawing from the camera's angle, `seat`,
 * `seat2`… anchors on the projected seats, other points as anchors) and where to put it — the
 * screen point of its floor centre and its scale. `meta.seat.yaw` (degrees) is how far the seats
 * face away from the camera: the director seats people in the matching view.
 */
export function furnitureRig(m: FurnitureModel, cam: RoomCamera, place: { x: number; z: number; turn?: number }, name = m.name): { doc: ToonDoc; x: number; y: number; scale: number } {
  const view = viewAt(cam, place.x, place.z, place.turn ?? 0);
  const [x, y, scale] = roomPoint(cam, place.x, place.z);
  const anchors: Record<string, { bone: string; at: [number, number] }> = {};
  (m.seats ?? []).forEach((p, i) => (anchors[i ? `seat${i + 1}` : "seat"] = { bone: "root", at: project(p, view) as [number, number] }));
  for (const [k, p] of Object.entries(m.points ?? {})) anchors[k] = { bone: "root", at: project(p, view) as [number, number] };
  const doc = {
    format: "toon",
    version: 1,
    name,
    meta: { description: `${m.name} drawn from volumes for a room camera`, seat: { yaw: r((view.yaw * 180) / Math.PI), pitch: r((view.pitch * 180) / Math.PI) } },
    palette: { ink: "#2a201e", ...withTones(m.palette) },
    art: { body: drawModel(m, view) },
    skeleton: [{ id: "root" }],
    parts: [{ id: "body", type: "rigid", bone: "root", art: "body" }],
    anchors,
  };
  return { doc: doc as unknown as ToonDoc, x, y, scale };
}


