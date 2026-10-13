import { type Mat, type Rig, type ToonDoc, type Value, apply, compileRig, evaluatePose, multiply, parsePath, renderCharacter, type RenderNode } from "@animestudio/core";
import type { P } from "./rig";

/**
 * Measurements of a kit character used by the director (hand-holding, spacing): read from the
 * skeleton, not measured by hand. All values in setup space (facing right, feet at y = 0).
 */
export interface RigInfo {
  /** Rest positions of the hands (near F / far B). */
  hand: { F: P; B: P };
  /** Shoulder joints. */
  shoulder: { F: P; B: P };
  /** Upper + lower arm length. */
  armLength: { F: number; B: number };
  /** How the back view moves the shoulders (added to `shoulder`). */
  backShoulder: { F: P; B: P };
  /**
   * How far the drawing reaches in front of / behind the feet (snout, beak, cap, shell, a big head…):
   * measured from the character as drawn at rest (`drawnBounds`, main view) unless given.
   */
  extent: { front: number; back: number };
  /** Height of the top of the drawing (positive, px): measured as drawn unless given. */
  height: number;
  /** Hip joint (between the legs' joints): the point that sits on a saddle when riding. */
  hip?: P;
  /** Thigh + shin length (hip joint to ankle). */
  legLength?: { F: number; B: number };
  /**
   * Half thickness of the torso (back and belly, from the body's centre line): what rests on a bed
   * or the ground when lying. Not the reach (`extent` includes tails, backpacks, shells, snouts).
   */
  depth?: { back: number; front: number };
}

type Bone = { id: string; from?: P; to?: P };

/** A box `[minX, minY, maxX, maxY]`. */
export type Bounds = [number, number, number, number];

/** Parses an SVG `transform` attribute (translate, scale, rotate, skewX, skewY, matrix, in order). */
function parseTransform(t: string | undefined): Mat {
  let m: Mat = [1, 0, 0, 1, 0, 0];
  if (!t) return m;
  for (const [, fn, args] of t.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = (args.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    const rad = ((a[0] ?? 0) * Math.PI) / 180;
    let n: Mat;
    switch (fn) {
      case "translate": n = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]; break;
      case "scale": n = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]; break;
      case "rotate": {
        const c = Math.cos(rad), s = Math.sin(rad), cx = a[1] ?? 0, cy = a[2] ?? 0;
        n = [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
        break;
      }
      case "skewX": n = [1, 0, Math.tan(rad), 1, 0, 0]; break;
      case "skewY": n = [1, Math.tan(rad), 0, 1, 0, 0]; break;
      case "matrix": n = a.length >= 6 ? [a[0], a[1], a[2], a[3], a[4], a[5]] : [1, 0, 0, 1, 0, 0]; break;
      default: n = [1, 0, 0, 1, 0, 0];
    }
    m = multiply(m, n);
  }
  return m;
}

/** The extremes of a cubic Bézier along one axis (its ends and where its derivative is zero). */
function cubicRange(p0: number, p1: number, p2: number, p3: number): [number, number] {
  let lo = Math.min(p0, p3), hi = Math.max(p0, p3);
  const a = -p0 + 3 * p1 - 3 * p2 + p3, b = 2 * (p0 - 2 * p1 + p2), c = p1 - p0;
  const at = (t: number) => {
    if (t <= 0 || t >= 1) return;
    const u = 1 - t, v = u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
    lo = Math.min(lo, v); hi = Math.max(hi, v);
  };
  if (Math.abs(a) < 1e-9) {
    if (Math.abs(b) > 1e-12) at(-c / b);
  } else {
    const d = b * b - 4 * a * c;
    if (d >= 0) {
      const q = Math.sqrt(d);
      at((-b + q) / (2 * a));
      at((-b - q) / (2 * a));
    }
  }
  return [lo, hi];
}

/**
 * Bounds of an SVG drawing (`[minX, minY, maxX, maxY]`), in the space `m` maps it to: its paths
 * (curves measured exactly, not by their control points), rects, circles, ellipses, lines,
 * polygons and polylines, through every `transform` (on `<g>` and on the shapes: translate, scale,
 * rotate, skew, matrix). What is not drawn — clip paths, masks, defs, symbols — is left out, as
 * are shapes with neither fill nor stroke. Strokes are not widened. Undefined when nothing is drawn.
 */
export function svgBounds(svg: string, m: Mat = [1, 0, 0, 1, 0, 0]): Bounds | undefined {
  let box: Bounds | undefined;
  const add = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    box = box ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)] : [x, y, x, y];
  };
  const stack: Mat[] = [m];
  // Inside a container that is not drawn (its depth in the tags).
  let hidden = 0;
  const HIDDEN = /^(clipPath|mask|defs|symbol|pattern|marker|linearGradient|radialGradient|filter)$/;
  for (const tag of svg.matchAll(/<(\/?)([a-zA-Z][\w:-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g)) {
    const [, close, name, attrs, self] = tag;
    const str = (k: string) => new RegExp(`(?:^|\\s)${k}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs);
    const get = (k: string) => {
      const r = str(k);
      return r ? (r[1] ?? r[2]) : undefined;
    };
    const num = (k: string, d = 0) => {
      const v = get(k);
      const n = v === undefined ? NaN : Number.parseFloat(v);
      return Number.isFinite(n) ? n : d;
    };
    if (HIDDEN.test(name)) {
      if (close) hidden = Math.max(0, hidden - 1);
      else if (!self) hidden++;
      continue;
    }
    if (name === "g" || name === "svg" || name === "a") {
      if (close) stack.length > 1 && stack.pop();
      else if (!self) stack.push(multiply(stack[stack.length - 1], parseTransform(get("transform"))));
      continue;
    }
    if (close || hidden) continue;
    if (get("fill") === "none" && (get("stroke") === undefined || get("stroke") === "none")) continue;
    if (get("display") === "none" || get("visibility") === "hidden" || get("opacity") === "0") continue;
    const M = multiply(stack[stack.length - 1], parseTransform(get("transform")));
    const pt = (x: number, y: number) => {
      const q = apply(M, [x, y]);
      add(q[0], q[1]);
    };
    switch (name) {
      case "path": {
        const d = get("d");
        if (!d) break;
        try {
          for (const sp of parsePath(d)) {
            let p0 = apply(M, sp.start);
            add(p0[0], p0[1]);
            for (const [c1, c2, e] of sp.segments) {
              const a = apply(M, c1), b = apply(M, c2), c = apply(M, e);
              const [x0, x1] = cubicRange(p0[0], a[0], b[0], c[0]), [y0, y1] = cubicRange(p0[1], a[1], b[1], c[1]);
              add(x0, y0);
              add(x1, y1);
              p0 = c;
            }
          }
        } catch {
          // Unparsable path data: not measured.
        }
        break;
      }
      case "rect": {
        const x = num("x"), y = num("y"), w = num("width"), h = num("height");
        if (w > 0 && h > 0) for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) pt(cx, cy);
        break;
      }
      case "circle":
      case "ellipse": {
        const cx = num("cx"), cy = num("cy");
        const rx = name === "circle" ? num("r") : num("rx", num("ry")), ry = name === "circle" ? num("r") : num("ry", num("rx"));
        if (rx <= 0 || ry <= 0) break;
        // (An ellipse through an affine map: its box from the transformed axes.)
        const ax = [M[0] * rx, M[1] * rx], ay = [M[2] * ry, M[3] * ry];
        const c = apply(M, [cx, cy]), hx = Math.hypot(ax[0], ay[0]), hy = Math.hypot(ax[1], ay[1]);
        add(c[0] - hx, c[1] - hy);
        add(c[0] + hx, c[1] + hy);
        break;
      }
      case "line":
        pt(num("x1"), num("y1"));
        pt(num("x2"), num("y2"));
        break;
      case "polygon":
      case "polyline": {
        const v = (get("points") ?? "").trim().split(/[\s,]+/).map(Number);
        for (let i = 0; i + 1 < v.length; i += 2) pt(v[i], v[i + 1]);
        break;
      }
    }
  }
  return box;
}

/** Bounds of render nodes (character space): groups' transforms, markup, paths. */
function nodeBounds(nodes: RenderNode[], m: Mat = [1, 0, 0, 1, 0, 0]): Bounds | undefined {
  let box: Bounds | undefined;
  const join = (b: Bounds | undefined) => {
    if (b) box = box ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])] : b;
  };
  for (const n of nodes) {
    if (n.opacity !== undefined && n.opacity <= 0) continue;
    const t = n.kind !== "path" && n.transform ? multiply(m, n.transform) : m;
    if (n.kind === "group") join(nodeBounds(n.children, t));
    else if (n.kind === "markup") join(svgBounds(n.markup, t));
    else {
      const attrs = Object.entries(n.attrs).map(([k, v]) => ` ${k}="${String(v).replace(/"/g, "&quot;")}"`).join("");
      join(svgBounds(`<path d="${n.d}"${attrs}/>`, m));
    }
  }
  return box;
}

/** The bones a part is drawn on (a solid: the bones of its drawn bodies, not its occluders). */
function partBones(part: Rig["parts"][number]): number[] {
  switch (part.type) {
    case "solid": return part.bodies.filter((b) => b.fill).flatMap((b) => b.shapes.flatMap((s) => (s.kind === "cone" ? [s.from.bone, s.to.bone] : [s.at.bone])));
    case "skinned": return part.influences;
    case "hose": return part.bones;
    case "hull": return part.points.map((q) => q.bone);
    default: return [part.bone];
  }
}

/**
 * Bounds of a character as drawn (`[minX, minY, maxX, maxY]`, character space: feet at y = 0,
 * facing right): the document compiled, its rest pose evaluated in `view` (a `view` control's pose,
 * when the rig has one — the main `profile` view by default), every part rendered and measured
 * through its transforms (`svgBounds`) — hair, hats, noses, tails included. Parts on a bone named
 * `ground` (the shadow on the floor) are left out, and so is anything `skip` names; `arms: false`
 * leaves out the arms too (the parts on the bones of the `handF` / `handB` chains and below them,
 * and solids drawing only those bones): they hang at rest and move with every gesture.
 */
export function drawnBounds(doc: ToonDoc, view = "profile", o: { controls?: Record<string, Value>; skip?: (partId: string) => boolean; arms?: boolean } = {}): Bounds | undefined {
  const rig = compileRig(doc);
  const viewControl = rig.controls.view as { type: string; poses?: Record<string, unknown> } | undefined;
  const controls: Record<string, Value> = { ...(viewControl?.type === "pose" && viewControl.poses?.[view] ? { view } : {}), ...(o.controls ?? {}) };
  const pose = evaluatePose(rig, { time: 0, controls });
  const left = new Set(rig.parts.filter((p) => partBones(p).some((b) => rig.bones[b]?.id === "ground")).map((p) => p.id));
  if (o.arms === false) {
    // The arms' bones: the hand chains and every bone below them.
    const arm = new Set(rig.ik.filter((k) => /^hand/.test(k.id)).flatMap((k) => k.bones));
    for (let grew = true; grew; ) {
      grew = false;
      rig.bones.forEach((b, i) => {
        if (!arm.has(i) && b.parent !== undefined && b.parent >= 0 && arm.has(b.parent)) (arm.add(i), (grew = true));
      });
    }
    for (const p of rig.parts) {
      const bones = partBones(p);
      if (arm.size && bones.length && bones.every((b) => arm.has(b))) left.add(p.id);
    }
  }
  return nodeBounds(renderCharacter(rig, pose, "", (id) => !left.has(id) && !o.skip?.(id)));
}

/**
 * Measurements of a rig for the director, read from its skeleton. `extent` and `height` are measured
 * from the character as drawn at rest in its main view unless given (`drawnBounds`, the arms left
 * out: whatever the head and body reach — a big head, hair, a cap's peak, a snout, a belly);
 * `view` picks the view measured (default `profile`).
 */
export function rigInfo(doc: ToonDoc, o: { extent?: { front: number; back: number }; height?: number; depth?: number | { back: number; front: number }; view?: string } = {}): RigInfo {
  const bones = new Map((doc.skeleton as Bone[]).map((b) => [b.id, b]));
  const from = (id: string): P => {
    const b = bones.get(id);
    if (!b?.from) throw new Error(`${doc.name}: bone "${id}" needs a setup-form "from"`);
    return b.from;
  };
  const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const move = ((doc.meta as { views?: { move?: Record<string, Record<string, P>> } } | undefined)?.views?.move?.back ?? {}) as Record<string, P>;
  const drawn = o.extent && o.height !== undefined ? undefined : drawnBounds(doc, o.view, { arms: false });
  const rd = (n: number) => Math.round(n * 100) / 100;
  return {
    hand: { F: from("handF"), B: from("handB") },
    shoulder: { F: from("armF1"), B: from("armB1") },
    armLength: {
      F: dist(from("armF1"), from("armF2")) + dist(from("armF2"), from("handF")),
      B: dist(from("armB1"), from("armB2")) + dist(from("armB2"), from("handB")),
    },
    backShoulder: { F: move.armF1 ?? [0, 0], B: move.armB1 ?? [0, 0] },
    extent: o.extent ?? { front: rd(Math.max(0, drawn?.[2] ?? 0)), back: rd(Math.max(0, -(drawn?.[0] ?? 0))) },
    height: o.height ?? rd(Math.max(0, -(drawn?.[1] ?? 0))),
    ...(o.depth !== undefined ? { depth: typeof o.depth === "number" ? { back: o.depth, front: o.depth } : o.depth } : {}),
    hip: [(from("legF1")[0] + from("legB1")[0]) / 2, (from("legF1")[1] + from("legB1")[1]) / 2],
    legLength: {
      F: dist(from("legF1"), from("legF2")) + dist(from("legF2"), from("footF")),
      B: dist(from("legB1"), from("legB2")) + dist(from("legB2"), from("footB")),
    },
  };
}
