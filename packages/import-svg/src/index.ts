import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { SVGPathData } from "svg-pathdata";
import {
  type BoneDef,
  type Mat,
  type PartDef,
  type ToonDoc,
  type Vec2,
  apply,
  identity,
  matToString,
  multiply,
  fromTRS,
} from "@animestudio/core";

/**
 * Imports a layered SVG drawing into a toon character using a naming convention.
 *
 * Layer / element names (from `inkscape:label`, `data-name` or `id`):
 *   bone:<id>[@<parent>]          <line> / <path> (first → last point) or <circle> (zero length)
 *   part:<id>@<bone>              any element or group: rigid art attached to <bone>
 *   switch:<part>/<variant>@<bone>  variants of a switch part (first one is the default)
 *   skin:<id>@<bone1>,<bone2>     a <path> deformed by several bones
 *   anchor:<name>@<bone>          a <circle> marking a named point
 *   origin                        a <circle> marking the character's ground origin
 * Unnamed visible elements outside parts become a rigid part on the root bone.
 * Illustrator's `_x3A_` style escapes are decoded.
 */
export interface ImportOptions {
  name?: string;
}

export interface ImportResult {
  doc: ToonDoc;
  warnings: string[];
}

type XmlNode = Record<string, unknown> & { ":@"?: Record<string, string> };

const ATTR = "@_";
const parserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: ATTR,
  preserveOrder: true,
  trimValues: false,
  allowBooleanAttributes: true,
  processEntities: false,
} as const;

const tagOf = (n: XmlNode) => Object.keys(n).find((k) => k !== ":@")!;
const childrenOf = (n: XmlNode) => (n[tagOf(n)] as XmlNode[]) ?? [];
const attrsOf = (n: XmlNode) => n[":@"] ?? {};
const attr = (n: XmlNode, name: string): string | undefined => attrsOf(n)[ATTR + name];

const decode = (s: string) => s.replace(/_x([0-9A-Fa-f]{2})_/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
const nameOf = (n: XmlNode) => {
  const raw = attr(n, "inkscape:label") ?? attr(n, "data-name") ?? attr(n, "id");
  return raw === undefined ? undefined : decode(raw).trim();
};

/** Parses an SVG `transform` attribute into a matrix. */
export function parseTransform(t: string | undefined): Mat {
  let m = identity();
  if (!t) return m;
  for (const [, fn, args] of t.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = args.split(/[\s,]+/).filter(Boolean).map(Number);
    let n: Mat = identity();
    switch (fn) {
      case "matrix":
        n = [a[0], a[1], a[2], a[3], a[4], a[5]];
        break;
      case "translate":
        n = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
        break;
      case "scale":
        n = [a[0], 0, 0, a[1] ?? a[0], 0, 0];
        break;
      case "rotate":
        n = fromTRS(0, 0, a[0]);
        if (a.length === 3) n = multiply(multiply([1, 0, 0, 1, a[1], a[2]], n), [1, 0, 0, 1, -a[1], -a[2]]);
        break;
      case "skewX":
        n = [1, 0, Math.tan((a[0] * Math.PI) / 180), 1, 0, 0];
        break;
      case "skewY":
        n = [1, Math.tan((a[0] * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    m = multiply(m, n);
  }
  return m;
}

function endpoints(n: XmlNode, m: Mat): [Vec2, Vec2] | null {
  const tag = tagOf(n);
  const num = (k: string) => Number(attr(n, k) ?? 0);
  if (tag === "line") return [apply(m, [num("x1"), num("y1")]), apply(m, [num("x2"), num("y2")])];
  if (tag === "circle" || tag === "ellipse") {
    const c = apply(m, [num("cx"), num("cy")]);
    return [c, c];
  }
  if (tag === "path" || tag === "polyline") {
    const d = tag === "path" ? attr(n, "d") : `M${attr(n, "points")}`;
    if (!d) return null;
    const cmds = new SVGPathData(d).toAbs().commands.filter((c) => "x" in c && "y" in c) as { x: number; y: number }[];
    if (!cmds.length) return null;
    const first = cmds[0];
    const last = cmds[cmds.length - 1];
    return [apply(m, [first.x, first.y]), apply(m, [last.x, last.y])];
  }
  return null;
}

const round = (v: number) => Math.round(v * 100) / 100;
const roundVec = (v: Vec2): Vec2 => [round(v[0]), round(v[1])];

export function importSvg(svg: string, opts: ImportOptions = {}): ImportResult {
  const warnings: string[] = [];
  const parser = new XMLParser(parserOptions);
  const builder = new XMLBuilder({ ...parserOptions, suppressEmptyNode: true });
  const tree = parser.parse(svg) as XmlNode[];
  const root = tree.find((n) => tagOf(n) === "svg");
  if (!root) throw new Error("No <svg> root element found");

  // Origin: an element named "origin", else the bottom-center of the viewBox.
  const vb = (attr(root, "viewBox") ?? `0 0 ${attr(root, "width") ?? 100} ${attr(root, "height") ?? 100}`)
    .split(/[\s,]+/)
    .map(Number);
  let origin: Vec2 = [vb[0] + vb[2] / 2, vb[1] + vb[3]];

  const bones: { id: string; parent?: string; from: Vec2; to: Vec2 }[] = [];
  const rigid: { id: string; bone: string; art: string; order: number }[] = [];
  const switches = new Map<string, { bone: string; variants: [string, string][]; order: number }>();
  const skins: { id: string; bones: string[]; path: string; attrs: Record<string, string>; order: number }[] = [];
  const anchors: Record<string, { bone: string; at: Vec2 }> = {};
  let defs = "";
  let order = 0;
  let unnamed = 0;

  const serialize = (n: XmlNode, m: Mat) => {
    const markup = builder.build([n]) as string;
    return { markup, transform: m };
  };

  const walk = (nodes: XmlNode[], m: Mat) => {
    for (const n of nodes) {
      const tag = tagOf(n);
      if (tag === "#text" || tag === "?xml" || tag === "#comment" || tag.startsWith("sodipodi") || tag === "metadata" || tag === "title") continue;
      if (tag === "defs" || tag === "style") {
        defs += builder.build(tag === "defs" ? childrenOf(n) : [n]);
        continue;
      }
      const own = multiply(m, parseTransform(attr(n, "transform")));
      const name = nameOf(n);
      const [kind, rest] = name && name.includes(":") ? [name.slice(0, name.indexOf(":")), name.slice(name.indexOf(":") + 1)] : [name, ""];
      if (kind === "origin") {
        const e = endpoints(n, own);
        if (e) origin = e[0];
        continue;
      }
      if (kind === "bone") {
        const [id, parent] = rest.split("@");
        const e = endpoints(n, own);
        if (!e) warnings.push(`bone "${id}": use a <line>, <path> or <circle>`);
        else bones.push({ id, parent, from: e[0], to: e[1] });
        continue;
      }
      if (kind === "anchor") {
        const [id, bone] = rest.split("@");
        const e = endpoints(n, own);
        if (e && bone) anchors[id] = { bone, at: e[0] };
        else warnings.push(`anchor "${id}" needs a <circle> and @bone`);
        continue;
      }
      if (kind === "part") {
        const [id, bone] = rest.split("@");
        if (!bone) warnings.push(`part "${id}" has no @bone; attached to root`);
        const s = serialize(n, m);
        rigid.push({ id, bone: bone ?? "root", art: wrap(s.markup, s.transform), order: order++ });
        continue;
      }
      if (kind === "switch") {
        const [path, bone] = rest.split("@");
        const [part, variant] = path.split("/");
        let sw = switches.get(part);
        if (!sw) {
          sw = { bone: bone ?? "root", variants: [], order: order++ };
          switches.set(part, sw);
        }
        const s = serialize(n, m);
        sw.variants.push([variant ?? `v${sw.variants.length}`, wrap(s.markup, s.transform)]);
        continue;
      }
      if (kind === "skin") {
        const [id, list] = rest.split("@");
        const d = attr(n, "d");
        if (tag !== "path" || !d) {
          warnings.push(`skin "${id}" must be a <path>`);
          continue;
        }
        const pd = new SVGPathData(d).toAbs().matrix(...(own as [number, number, number, number, number, number])).encode();
        const attrs: Record<string, string> = {};
        for (const [k, v] of Object.entries(attrsOf(n))) {
          const key = k.slice(ATTR.length);
          if (!["d", "id", "transform", "data-name", "inkscape:label"].includes(key)) attrs[key] = v;
        }
        skins.push({ id, bones: (list ?? "root").split(","), path: pd, attrs, order: order++ });
        continue;
      }
      if (tag === "g" || tag === "svg") {
        walk(childrenOf(n), own);
        continue;
      }
      // Unnamed drawable outside any part → static art on the root bone.
      const s = serialize(n, m);
      rigid.push({ id: `art${unnamed++}`, bone: "root", art: wrap(s.markup, s.transform), order: order++ });
    }
  };

  const shift: Mat = [1, 0, 0, 1, 0, 0];
  walk(childrenOf(root), shift);

  // Re-express everything relative to the origin.
  const toSetup = (p: Vec2): Vec2 => roundVec([p[0] - origin[0], p[1] - origin[1]]);
  const originMat: Mat = [1, 0, 0, 1, -origin[0], -origin[1]];
  function wrap(markup: string, m: Mat): string {
    return `<g transform="${matToString(m)}">${markup}</g>`;
  }
  const reorigin = (art: string) => `<g transform="${matToString(originMat)}">${art}</g>`;

  // Bones: ensure a root, sort parents first.
  const skeleton: BoneDef[] = [{ id: "root" }];
  const pending = bones.filter((b) => b.id !== "root");
  const placed = new Set(["root"]);
  while (pending.length) {
    const idx = pending.findIndex((b) => placed.has(b.parent ?? "root"));
    if (idx < 0) {
      for (const b of pending) warnings.push(`bone "${b.id}" has unknown parent "${b.parent}"; attached to root`);
      for (const b of pending) b.parent = "root";
      continue;
    }
    const [b] = pending.splice(idx, 1);
    const from = toSetup(b.from);
    const to = toSetup(b.to);
    const zero = from[0] === to[0] && from[1] === to[1];
    skeleton.push({ id: b.id, parent: b.parent ?? "root", from, ...(zero ? {} : { to }) });
    placed.add(b.id);
  }
  const knownBone = (id: string) => {
    if (!placed.has(id)) {
      warnings.push(`unknown bone "${id}"; attached to root`);
      return "root";
    }
    return id;
  };

  const parts: (PartDef & { order: number })[] = [
    ...rigid.map((r) => ({ id: r.id, type: "rigid" as const, bone: knownBone(r.bone), art: reorigin(r.art), order: r.order })),
    ...[...switches.entries()].map(([id, sw]) => ({
      id,
      type: "switch" as const,
      bone: knownBone(sw.bone),
      variants: Object.fromEntries(sw.variants.map(([k, v]) => [k, reorigin(v)])),
      default: sw.variants[0][0],
      order: sw.order,
    })),
    ...skins.map((s) => ({
      id: s.id,
      type: "skinned" as const,
      bones: s.bones.map(knownBone),
      path: new SVGPathData(s.path).translate(-origin[0], -origin[1]).round(100).encode(),
      fill: s.attrs.fill,
      stroke: s.attrs.stroke,
      strokeWidth: s.attrs["stroke-width"] ? Number(s.attrs["stroke-width"]) : undefined,
      order: s.order,
    })),
  ];
  parts.sort((a, b) => a.order - b.order);

  const doc: ToonDoc = {
    format: "toon",
    version: 1,
    name: opts.name ?? "imported",
    ...(defs ? { defs } : {}),
    skeleton,
    parts: parts.map(({ order: _o, ...p }) => p as PartDef),
    ...(Object.keys(anchors).length
      ? { anchors: Object.fromEntries(Object.entries(anchors).map(([k, a]) => [k, { bone: knownBone(a.bone), at: toSetup(a.at) }])) }
      : {}),
  };
  return { doc, warnings };
}
