import { type Mat, apply, formatNumber as f, hashString, invert } from "./math";
import { type RenderFrame, type RenderNode, nodeToString } from "./render";

/**
 * Debug mode: tools to find rendering problems.
 *
 * 1. `diagnoseFrames` — checks what the library produces (no browser): invalid numbers, broken
 *    `url(#…)` references, duplicate ids, elements that exist for a single frame, sudden jumps.
 * 2. `withDebugOverlay` — instruments a frame for a debug render: every top-level node draws a
 *    small colored "sentinel" square *inside its own group* in a strip at the bottom of the frame,
 *    and a barcode encodes the frame index. If the browser fails to paint a node, its sentinel is
 *    missing from the captured image.
 * 3. `readDebugStrip` — reads the barcode and sentinels back from captured pixels (used by the
 *    `toon doctor` CLI) and reports exactly which nodes were not painted in which frame.
 */

// ---------------------------------------------------------------------------
// Frame diagnostics (library output)
// ---------------------------------------------------------------------------

export type DiagnosticKind =
  | "invalid-number"
  | "broken-reference"
  | "duplicate-id"
  | "single-frame-node"
  | "single-frame-gap"
  | "jump"
  | "zero-blur-axis";

export interface Diagnostic {
  frame: number;
  time: number;
  kind: DiagnosticKind;
  severity: "error" | "warning" | "info";
  /** Render node key involved, when known. */
  key?: string;
  message: string;
}

export interface DiagnoseOptions {
  /** Screen px a top-level node may move between consecutive frames before it counts as a jump (default 160). */
  maxJump?: number;
}

const ID_RE = /\bid\s*=\s*["']([^"']+)["']/g;
const REF_RE = /url\(#([^)\s]+)\)|href\s*=\s*["']#([^"']+)["']/g;

function nodePosition(n: RenderNode): [number, number] | undefined {
  return "transform" in n && n.transform ? [n.transform[4], n.transform[5]] : undefined;
}

/** Diagnoses a list of consecutive frames (frame i at time `times[i]`). */
export function diagnoseFrames(frames: RenderFrame[], times: number[], opts: DiagnoseOptions = {}): Diagnostic[] {
  const out: Diagnostic[] = [];
  const maxJump = opts.maxJump ?? 160;
  const keySets = frames.map((fr) => new Set(fr.nodes.map((n) => n.key)));

  frames.forEach((frame, i) => {
    const time = times[i];
    const svg = frame.defs + frame.nodes.map(nodeToString).join("");
    if (/NaN|Infinity/.test(svg)) {
      for (const n of frame.nodes) {
        if (/NaN|Infinity/.test(nodeToString(n))) {
          out.push({ frame: i, time, kind: "invalid-number", severity: "error", key: n.key, message: "NaN/Infinity in SVG output (the browser drops the element)" });
        }
      }
    }
    // Ids and references.
    const ids = new Map<string, number>();
    for (const m of svg.matchAll(ID_RE)) ids.set(m[1], (ids.get(m[1]) ?? 0) + 1);
    for (const [id, count] of ids) {
      if (count > 1) out.push({ frame: i, time, kind: "duplicate-id", severity: "warning", message: `id "${id}" defined ${count} times (references resolve to the first)` });
    }
    for (const n of frame.nodes) {
      const s = nodeToString(n);
      for (const m of s.matchAll(REF_RE)) {
        const id = m[1] ?? m[2];
        if (!ids.has(id)) out.push({ frame: i, time, kind: "broken-reference", severity: "error", key: n.key, message: `reference to undefined "#${id}"` });
      }
      if (/stdDeviation="[^"]*\b0(\s|")/.test(s)) {
        out.push({ frame: i, time, kind: "zero-blur-axis", severity: "error", key: n.key, message: "blur with a zero axis (browsers hide the element)" });
      }
    }
    // Temporal checks.
    if (i > 0 && i < frames.length - 1) {
      for (const key of keySets[i]) {
        if (!keySets[i - 1].has(key) && !keySets[i + 1].has(key)) {
          out.push({ frame: i, time, kind: "single-frame-node", severity: "warning", key, message: "node exists for a single frame" });
        }
      }
      for (const key of keySets[i - 1]) {
        if (!keySets[i].has(key) && keySets[i + 1].has(key)) {
          out.push({ frame: i, time, kind: "single-frame-gap", severity: "warning", key, message: "node missing for a single frame" });
        }
      }
    }
    if (i > 0) {
      const prev = new Map(frames[i - 1].nodes.map((n) => [n.key, nodePosition(n)]));
      for (const n of frame.nodes) {
        const a = prev.get(n.key);
        const b = nodePosition(n);
        if (a && b && Math.hypot(b[0] - a[0], b[1] - a[1]) > maxJump) {
          out.push({ frame: i, time, kind: "jump", severity: "info", key: n.key, message: `moved ${Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]))} px in one frame (a cut or a pop)` });
        }
      }
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Debug overlay (render instrumentation)
// ---------------------------------------------------------------------------

/** Height (px) of the instrumentation strip at the bottom of debug renders. */
export const DEBUG_STRIP = 24;
const CELL = 10;
const GAP = 4;
const BARCODE_BITS = 16;

/** Distinct, saturated sentinel color for a node key. */
export function sentinelColor(key: string): [number, number, number] {
  const h = (hashString(key) % 360) / 60;
  const c = 230;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const [r, g, b] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return [Math.round(r + 20), Math.round(g + 20), Math.round(b + 20)];
}

export interface Sentinel {
  key: string;
  x: number;
  y: number;
  size: number;
  color: [number, number, number];
}

/** Sentinel cells for a frame's top-level nodes (left part of the strip). */
export function sentinelLayout(frame: RenderFrame): Sentinel[] {
  const y = frame.height - DEBUG_STRIP + (DEBUG_STRIP - CELL) / 2;
  return frame.nodes
    .filter((n) => n.kind !== "path")
    .map((n, i) => ({ key: n.key, x: GAP + i * (CELL + GAP), y, size: CELL, color: sentinelColor(n.key) }));
}

/** Barcode cells (right part of the strip): frame index in binary, most significant bit first. */
export function barcodeLayout(frame: RenderFrame): { x: number; y: number; size: number }[] {
  const y = frame.height - DEBUG_STRIP + (DEBUG_STRIP - CELL) / 2;
  const x0 = frame.width - GAP - BARCODE_BITS * (CELL + 2);
  return Array.from({ length: BARCODE_BITS }, (_, i) => ({ x: x0 + i * (CELL + 2), y, size: CELL }));
}

const rgb = (c: [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`;

/** A screen-space rectangle expressed in a node's local coordinates (as path data). */
function localRectPath(transform: Mat | undefined, x: number, y: number, w: number, h: number): string {
  const corners: [number, number][] = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
  const inv = transform ? invert(transform) : undefined;
  const pts = corners.map((c) => (inv ? apply(inv, c) : c));
  return `M${pts.map((q) => `${f(q[0])} ${f(q[1])}`).join("L")}Z`;
}

export interface DebugOverlayOptions {
  frameIndex: number;
  time: number;
  /** Draw a text label with the frame index and time (default true). */
  label?: boolean;
}

/**
 * Instruments a frame for a debug render (see module docs). Every top-level node's content is
 * clipped out of the bottom `DEBUG_STRIP` px, where the node paints only its own sentinel square;
 * a barcode at the right encodes the frame index.
 */
export function withDebugOverlay(frame: RenderFrame, opts: DebugOverlayOptions): RenderFrame {
  const sentinels = new Map(sentinelLayout(frame).map((s) => [s.key, s]));
  const contentH = frame.height - DEBUG_STRIP;
  const nodes: RenderNode[] = [
    { kind: "markup", key: "debug-strip-bg", markup: `<rect x="0" y="${contentH}" width="${frame.width}" height="${DEBUG_STRIP}" fill="#808080"/>` },
  ];
  frame.nodes.forEach((n, i) => {
    const s = sentinels.get(n.key);
    if (!s || n.kind === "path") {
      nodes.push(n);
      return;
    }
    const inner = n.kind === "group" ? `<g${n.id ? ` id="${n.id}"` : ""}>${n.children.map(nodeToString).join("")}</g>` : n.markup;
    const clip = `dbg-clip-${i}`;
    nodes.push({
      kind: "markup",
      key: n.key,
      transform: n.transform,
      opacity: n.opacity,
      filter: n.filter,
      markup:
        `<clipPath id="${clip}"><path d="${localRectPath(n.transform, 0, 0, frame.width, contentH)}"/></clipPath>` +
        `<g clip-path="url(#${clip})">${inner}</g>` +
        `<path d="${localRectPath(n.transform, s.x, s.y, s.size, s.size)}" fill="${rgb(s.color)}"/>`,
    });
  });
  const bits = barcodeLayout(frame)
    .map((c, i) => {
      const on = (opts.frameIndex >> (BARCODE_BITS - 1 - i)) & 1;
      return `<rect x="${c.x}" y="${c.y}" width="${c.size}" height="${c.size}" fill="${on ? "#FFFFFF" : "#000000"}"/>`;
    })
    .join("");
  const label =
    opts.label === false
      ? ""
      : `<text x="${frame.width / 2}" y="${frame.height - 7}" font-family="monospace" font-size="13" text-anchor="middle" fill="#000">f ${opts.frameIndex} · ${opts.time.toFixed(3)}s · ${frame.nodes.length} nodes</text>`;
  nodes.push({ kind: "markup", key: "debug-barcode", markup: bits + label });
  return { ...frame, nodes };
}

// ---------------------------------------------------------------------------
// Reading captured pixels back
// ---------------------------------------------------------------------------

/** An RGB raster (8-bit, row-major, 3 bytes per pixel). */
export interface Raster {
  width: number;
  height: number;
  data: Uint8Array;
}

function sampleCell(img: Raster, x: number, y: number, size: number, scale: number): [number, number, number] {
  // Average the central half of the cell (robust to compression and slight blur).
  const x0 = Math.round((x + size * 0.3) * scale);
  const x1 = Math.max(x0 + 1, Math.round((x + size * 0.7) * scale));
  const y0 = Math.round((y + size * 0.3) * scale);
  const y1 = Math.max(y0 + 1, Math.round((y + size * 0.7) * scale));
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const o = (yy * img.width + xx) * 3;
      r += img.data[o];
      g += img.data[o + 1];
      b += img.data[o + 2];
      n++;
    }
  }
  return [r / n, g / n, b / n];
}

export interface StripReading {
  /** Frame index decoded from the barcode. */
  frameIndex: number;
  /** Sentinels found with their expected color. */
  painted: string[];
  /** Sentinels missing (the browser did not paint that node). */
  missing: string[];
}

/**
 * Reads the debug strip of a captured frame. `frame` is the library frame expected at that
 * index (gives the sentinel layout); `img` may be scaled (its width / frame.width).
 */
export function readDebugStrip(img: Raster, frame: RenderFrame, tolerance = 70): StripReading {
  const scale = img.width / frame.width;
  let frameIndex = 0;
  for (const c of barcodeLayout(frame)) {
    const [r, g, b] = sampleCell(img, c.x, c.y, c.size, scale);
    frameIndex = (frameIndex << 1) | ((r + g + b) / 3 > 128 ? 1 : 0);
  }
  const painted: string[] = [];
  const missing: string[] = [];
  for (const s of sentinelLayout(frame)) {
    const c = sampleCell(img, s.x, s.y, s.size, scale);
    const d = Math.hypot(c[0] - s.color[0], c[1] - s.color[1], c[2] - s.color[2]);
    (d <= tolerance ? painted : missing).push(s.key);
  }
  return { frameIndex, painted, missing };
}

/** Frame-to-frame difference (RMSE 0..1) of two equally sized rasters. */
export function rasterDiff(a: Raster, b: Raster): number {
  let sum = 0;
  for (let i = 0; i < a.data.length; i++) {
    const d = a.data[i] - b.data[i];
    sum += d * d;
  }
  return Math.sqrt(sum / a.data.length) / 255;
}

/**
 * Finds A→B→A flickers: frames that differ from both neighbours while the neighbours match each
 * other (a vanishing / reappearing element, not motion). Returns frame indices.
 */
export function findFlickers(rasters: Raster[], threshold = 0.006): number[] {
  const out: number[] = [];
  for (let i = 1; i < rasters.length - 1; i++) {
    const a = rasterDiff(rasters[i - 1], rasters[i]);
    const b = rasterDiff(rasters[i], rasters[i + 1]);
    const c = rasterDiff(rasters[i - 1], rasters[i + 1]);
    if (a > 2 * c + threshold && b > 2 * c + threshold) out.push(i);
  }
  return out;
}
