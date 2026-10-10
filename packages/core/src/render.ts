import { type Mat, type Vec2, apply, formatNumber, isIdentity, matToString, multiply } from "./math";
import { type CubicPath, hoseOutline, pathPoints, pathToString, withPoints } from "./paths";
import { type EvaluatedPose, currentVariant } from "./pose";
import { type PathStyle, type Rig, type RigPart, namespaceIds } from "./rig";

/** Framework-agnostic render tree, consumed by the React and string renderers. */
export type RenderNode =
  | { kind: "group"; key: string; id?: string; transform?: Mat; opacity?: number; /** Screen-space CSS filter (e.g. `blur(2px)`). */ filter?: string; children: RenderNode[] }
  | { kind: "markup"; key: string; transform?: Mat; opacity?: number; /** Screen-space CSS filter (e.g. `blur(2px)`). */ filter?: string; markup: string }
  | { kind: "path"; key: string; d: string; opacity?: number; attrs: Record<string, string | number> };

export interface RenderFrame {
  width: number;
  height: number;
  background?: string;
  defs: string;
  nodes: RenderNode[];
}

const styleAttrs = (style: PathStyle): Record<string, string | number> => {
  const a: Record<string, string | number> = {};
  a.fill = style.fill ?? "none";
  if (style.stroke) a.stroke = style.stroke;
  if (style.strokeWidth !== undefined) a["stroke-width"] = style.strokeWidth;
  if (style.stroke) a["stroke-linejoin"] = "round";
  if (style.attrs) Object.assign(a, style.attrs);
  return a;
};

const transformPath = (path: CubicPath, m: Mat): CubicPath => withPoints(path, pathPoints(path).map((p) => apply(m, p)));

/** Matrix mapping a part's art space into character space for the current pose. */
function partMatrix(rig: Rig, world: Mat[], bone: number, space: "setup" | "bone"): Mat {
  return space === "bone" ? world[bone] : multiply(world[bone], rig.bones[bone].setupWorldInv);
}

function renderPart(rig: Rig, pose: EvaluatedPose, part: RigPart, keyPrefix: string): RenderNode | null {
  const { state: s, world } = pose;
  const opacity = part.opacity * s.opacity[part.index];
  if (!part.visible || opacity <= 0) return null;
  if (part.visibleWhen) {
    const v = currentVariant(rig, s, part.visibleWhen.part);
    if (v === undefined || !part.visibleWhen.variants.includes(v)) return null;
  }
  const key = `${keyPrefix}${part.id}`;
  const op = opacity < 1 ? opacity : undefined;
  switch (part.type) {
    case "rigid":
      return { kind: "markup", key, transform: partMatrix(rig, world, part.bone, part.space), opacity: op, markup: part.markup };
    case "switch": {
      const variant = currentVariant(rig, s, part.index)!;
      const markup = part.variants[variant] ?? "";
      if (!markup) return null;
      return { kind: "markup", key, transform: partMatrix(rig, world, part.bone, part.space), opacity: op, markup };
    }
    case "skinned": {
      const mats = part.influences.map((b) => multiply(world[b], rig.bones[b].setupWorldInv));
      const pts = pathPoints(part.path).map((p, i): Vec2 => {
        const w = part.weights[i];
        let x = 0;
        let y = 0;
        for (let k = 0; k < mats.length; k++) {
          if (w[k] === 0) continue;
          const q = apply(mats[k], p);
          x += q[0] * w[k];
          y += q[1] * w[k];
        }
        return [x, y];
      });
      return { kind: "path", key, opacity: op, d: pathToString(withPoints(part.path, pts)), attrs: styleAttrs(part.style) };
    }
    case "hose": {
      const joints: Vec2[] = part.bones.map((b) => [world[b][4], world[b][5]]);
      const last = part.bones[part.bones.length - 1];
      joints.push(apply(world[last], [rig.bones[last].length, 0]));
      // The bone's scale, not its squash (a squash is volume-preserving: a foreshortened thigh
      // must not thin the whole leg).
      const m0 = world[part.bones[0]];
      const scale = Math.sqrt(Math.abs(m0[0] * m0[3] - m0[1] * m0[2])) || 1;
      const widths = part.widths.map((w) => w * scale);
      return { kind: "path", key, opacity: op, d: hoseOutline(joints, widths, part.cap, part.smooth), attrs: styleAttrs(part.style) };
    }
    case "hull": {
      // The convex hull of circles around the posed points, as a smooth closed path.
      const pts: Vec2[] = [];
      for (const q of part.points) {
        const m = multiply(world[q.bone], rig.bones[q.bone].setupWorldInv);
        const c = apply(m, q.at);
        const k = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
        for (let i = 0; i < 20; i++) {
          const a = (i / 20) * Math.PI * 2;
          pts.push([c[0] + Math.cos(a) * q.r * k, c[1] + Math.sin(a) * q.r * k]);
        }
      }
      return { kind: "path", key, opacity: op, d: hullPath(pts), attrs: styleAttrs(part.style) };
    }
    case "morph": {
      const weights = s.morph[part.index];
      const basePts = pathPoints(part.base);
      const pts = basePts.map((p): Vec2 => [p[0], p[1]]);
      for (const [name, w] of Object.entries(weights)) {
        const shape = part.shapes[name];
        if (!shape || w === 0) continue;
        const sp = pathPoints(shape);
        for (let i = 0; i < pts.length; i++) {
          pts[i][0] += (sp[i][0] - basePts[i][0]) * w;
          pts[i][1] += (sp[i][1] - basePts[i][1]) * w;
        }
      }
      const m = partMatrix(rig, world, part.bone, part.space);
      const d = pathToString(transformPath(withPoints(part.base, pts), m));
      return { kind: "path", key, opacity: op, d, attrs: styleAttrs(part.style) };
    }
  }
}

/** Smooth closed path around the convex hull of points (monotone chain, corners rounded). */
function hullPath(pts: Vec2[]): string {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [], upper: Vec2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  const h = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  if (h.length < 3) return "";
  const f = (n: number) => Math.round(n * 100) / 100;
  const mid = (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const m0 = mid(h[h.length - 1], h[0]);
  let d = `M${f(m0[0])} ${f(m0[1])}`;
  for (let i = 0; i < h.length; i++) {
    const m = mid(h[i], h[(i + 1) % h.length]);
    d += ` Q${f(h[i][0])} ${f(h[i][1])} ${f(m[0])} ${f(m[1])}`;
  }
  return d + " Z";
}

/** Renders a posed character into render nodes (character space). */
export function renderCharacter(rig: Rig, pose: EvaluatedPose, keyPrefix = "", only?: (partId: string) => boolean): RenderNode[] {
  const out: RenderNode[] = [];
  for (const part of pose.drawOrder ?? rig.drawOrder) {
    if (only && !only(part.id)) continue;
    const node = renderPart(rig, pose, part, keyPrefix);
    if (node) out.push(node);
  }
  return out;
}

// ---------------------------------------------------------------------------
// String renderer
// ---------------------------------------------------------------------------

const escapeAttr = (v: string | number) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;");

const attrString = (attrs: Record<string, string | number | undefined>) =>
  Object.entries(attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${escapeAttr(typeof v === "number" ? formatNumber(v) : v!)}"`)
    .join("");

export function nodeToString(node: RenderNode): string {
  const common = {
    transform: "transform" in node && node.transform && !isIdentity(node.transform) ? matToString(node.transform) : undefined,
    opacity: node.opacity,
  };
  // Filters are in screen space: applied on a wrapper without transform.
  const wrap = (inner: string) => ("filter" in node && node.filter ? `<g style="filter:${node.filter}">${inner}</g>` : inner);
  switch (node.kind) {
    case "group":
      return wrap(`<g${attrString({ id: node.id, ...common })}>${node.children.map(nodeToString).join("")}</g>`);
    case "markup":
      return wrap(`<g${attrString(common)}>${node.markup}</g>`);
    case "path":
      return `<path${attrString({ d: node.d, ...node.attrs, opacity: node.opacity })}/>`;
  }
}

/** Serializes a frame to a standalone SVG document. */
export function frameToSVG(frame: RenderFrame): string {
  const bg = frame.background ? `<rect width="100%" height="100%" fill="${escapeAttr(frame.background)}"/>` : "";
  const defs = frame.defs ? `<defs>${frame.defs}</defs>` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${frame.width}" height="${frame.height}" viewBox="0 0 ${frame.width} ${frame.height}">` +
    defs +
    bg +
    frame.nodes.map(nodeToString).join("") +
    `</svg>`
  );
}

/**
 * Returns a copy of a frame whose SVG ids (defs, groups, masks, filters, gradients) are prefixed,
 * so two frames can be composited into one document (crossfades between shots).
 */
export function prefixFrame(frame: RenderFrame, prefix: string): RenderFrame {
  const ns = (v: string) => namespaceIds(v, prefix);
  const fixUrl = (v: string | undefined) => (v ? v.replace(/url\(#([^)]+)\)/g, (_m, id: string) => `url(#${prefix}-${id})`) : v);
  const walk = (n: RenderNode): RenderNode => {
    switch (n.kind) {
      case "group":
        return { ...n, id: n.id ? `${prefix}-${n.id}` : undefined, children: n.children.map(walk) };
      case "markup":
        return { ...n, markup: ns(n.markup) };
      case "path":
        return { ...n, attrs: Object.fromEntries(Object.entries(n.attrs).map(([k, v]) => [k, typeof v === "string" ? (fixUrl(v) as string) : v])) };
    }
  };
  return { ...frame, defs: ns(frame.defs), nodes: frame.nodes.map(walk) };
}
