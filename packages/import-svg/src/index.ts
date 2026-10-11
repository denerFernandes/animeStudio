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
 *   bone:<id>[@<parent>]          <line> / <path> (first → last point) or <circle> (zero length);
 *                                 `bone:root` places the root bone itself
 *   part:<id>@<bone>              any element or group: rigid art attached to <bone>
 *   switch:<part>/<variant>@<bone>  variants of a switch part (first one is the default)
 *   skin:<id>@<bone1>,<bone2>     a <path> deformed by several bones
 *   anchor:<name>@<bone>          a <circle> marking a named point
 *   origin                        a <circle> marking the character's ground origin
 * Unnamed visible elements outside parts become a rigid part on the root bone.
 * Illustrator's `_x3A_` style escapes are decoded.
 *
 * Skins take their `fill`, `stroke` and `stroke-width` the way a browser resolves them: inherited
 * from enclosing groups, presentation attributes overridden by the `style` attribute (Inkscape and
 * Illustrator write `style="fill:#fc9;stroke:#000"`); a path with no fill anywhere is black, as in
 * SVG. Stylesheet classes are not applied to skins (a warning says so).
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

/**
 * An SVG number token. SVG lets numbers run together when a sign or a leading decimal point
 * separates them: `10-5` is 10 and -5, `.5.5` is .5 and .5, `1e3-2` is 1000 and -2.
 */
const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;

/** Splits an SVG number list (transform arguments, `viewBox`, `points`); `undefined` when anything else is in it. */
function numberList(s: string): number[] | undefined {
  if (!/^[\s,]*$/.test(s.replace(NUMBER, ""))) return undefined;
  return (s.match(NUMBER) ?? []).map(Number);
}

/** CSS absolute units in user units (`px`). Relative units (`%`, `em`, `ex`, …) cannot be resolved by the importer. */
const UNITS: Record<string, number> = { "": 1, px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pt: 4 / 3, pc: 16 };

/** An SVG length attribute → user units; `undefined` when it cannot be resolved. */
function parseLength(s: string): number | undefined {
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-Z%]*)\s*$/.exec(s);
  if (!m) return undefined;
  const k = UNITS[m[2].toLowerCase()];
  return k === undefined ? undefined : Number(m[1]) * k;
}

/** How many arguments each transform function takes. */
const ARITY: Record<string, number[]> = { matrix: [6], translate: [1, 2], scale: [1, 2], rotate: [1, 3], skewX: [1], skewY: [1] };

/**
 * Parses an SVG `transform` attribute into a matrix. Functions that cannot be read (unknown name,
 * wrong number of arguments, non-numeric arguments) are reported through `warn` and skipped, so
 * the result never holds NaN.
 */
export function parseTransform(t: string | undefined, warn?: (message: string) => void): Mat {
  let m = identity();
  if (!t) return m;
  for (const [, fn, args] of t.matchAll(/([A-Za-z]+)\s*\(([^)]*)\)/g)) {
    const a = numberList(args);
    const arity = ARITY[fn];
    if (!arity) {
      warn?.(`transform: unknown function "${fn}" ignored`);
      continue;
    }
    if (!a || !arity.includes(a.length)) {
      warn?.(`transform: cannot read "${fn}(${args.trim()})"; ignored`);
      continue;
    }
    let n: Mat = identity();
    switch (fn) {
      case "matrix":
        n = [a[0], a[1], a[2], a[3], a[4], a[5]];
        break;
      case "translate":
        n = [1, 0, 0, 1, a[0], a[1] ?? 0];
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

/** The two ends of a bone / anchor element, or why it has none. */
function endpoints(n: XmlNode, m: Mat): { points: [Vec2, Vec2] } | { error: string } {
  const tag = tagOf(n);
  let bad: string | undefined;
  const num = (k: string) => {
    const raw = attr(n, k);
    if (raw === undefined) return 0;
    const v = parseLength(raw);
    if (v === undefined) bad ??= `cannot read ${k}="${raw}"`;
    return v ?? 0;
  };
  let points: [Vec2, Vec2] | undefined;
  if (tag === "line") points = [apply(m, [num("x1"), num("y1")]), apply(m, [num("x2"), num("y2")])];
  else if (tag === "circle" || tag === "ellipse") {
    const c = apply(m, [num("cx"), num("cy")]);
    points = [c, c];
  } else if (tag === "path" || tag === "polyline") {
    const d = tag === "path" ? attr(n, "d") : `M${attr(n, "points") ?? ""}`;
    if (!d) return { error: "empty path" };
    let cmds: { x: number; y: number }[];
    try {
      cmds = new SVGPathData(d).toAbs().commands.filter((c) => "x" in c && "y" in c) as { x: number; y: number }[];
    } catch (e) {
      return { error: `cannot read path data (${(e as Error).message})` };
    }
    if (!cmds.length) return { error: "empty path" };
    const first = cmds[0];
    const last = cmds[cmds.length - 1];
    points = [apply(m, [first.x, first.y]), apply(m, [last.x, last.y])];
  } else return { error: "use a <line>, <path> or <circle>" };
  if (bad) return { error: bad };
  if (!points.flat().every(Number.isFinite)) return { error: "coordinates are not finite" };
  return { points };
}

/** Fill, stroke and stroke width as a browser resolves them for an element (inherited, `style` winning over attributes). */
interface Paint {
  fill?: string;
  stroke?: string;
  strokeWidth?: string;
}

/** The `style` attribute's declarations, lower-cased property → value (without `!important`). */
function styleDeclarations(style: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!style) return out;
  for (const decl of style.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const value = decl
      .slice(i + 1)
      .replace(/!\s*important\s*$/i, "")
      .trim();
    if (prop && value) out[prop] = value;
  }
  return out;
}

/** The paint of an element: presentation attributes over the inherited paint, the `style` attribute over both. */
function paintOf(n: XmlNode, inherited: Paint): Paint {
  const p: Paint = { ...inherited };
  const decl = styleDeclarations(attr(n, "style"));
  const pick = (key: "fill" | "stroke" | "stroke-width"): string | undefined => decl[key] ?? attr(n, key);
  const set = (key: keyof Paint, v: string | undefined) => {
    if (v === undefined || v === "inherit") return;
    p[key] = v;
  };
  set("fill", pick("fill"));
  set("stroke", pick("stroke"));
  set("strokeWidth", pick("stroke-width"));
  return p;
}

const round = (v: number) => Math.round(v * 100) / 100;
const roundVec = (v: Vec2): Vec2 => [round(v[0]), round(v[1])];

export function importSvg(svg: string, opts: ImportOptions = {}): ImportResult {
  const warnings: string[] = [];
  const warn = (message: string) => warnings.push(message);
  const parser = new XMLParser(parserOptions);
  const builder = new XMLBuilder({ ...parserOptions, suppressEmptyNode: true });
  const tree = parser.parse(svg) as XmlNode[];
  const root = tree.find((n) => tagOf(n) === "svg");
  if (!root) throw new Error("No <svg> root element found");

  // Origin: an element named "origin", else the bottom-center of the viewBox (or of width × height).
  const size = (key: "width" | "height"): number => {
    const raw = attr(root, key);
    if (raw === undefined) return 100;
    const v = parseLength(raw);
    if (v === undefined) warn(`cannot read ${key}="${raw}"; using 100`);
    return v ?? 100;
  };
  const viewBoxAttr = attr(root, "viewBox");
  let vb = viewBoxAttr === undefined ? undefined : numberList(viewBoxAttr);
  if (viewBoxAttr !== undefined && (!vb || vb.length !== 4)) {
    warn(`cannot read viewBox="${viewBoxAttr}"; using width × height`);
    vb = undefined;
  }
  vb ??= [0, 0, size("width"), size("height")];
  let origin: Vec2 = [vb[0] + vb[2] / 2, vb[1] + vb[3]];

  const bones: { id: string; parent?: string; from: Vec2; to: Vec2 }[] = [];
  const rigid: { id: string; bone: string; art: string; order: number }[] = [];
  const switches = new Map<string, { bone: string; variants: [string, string][]; order: number }>();
  const skins: { id: string; bones: string[]; path: string; paint: Paint; order: number }[] = [];
  const anchors: Record<string, { bone: string; at: Vec2 }> = {};
  let defs = "";
  let order = 0;
  let unnamed = 0;

  const serialize = (n: XmlNode, m: Mat) => {
    const markup = builder.build([n]) as string;
    return { markup, transform: m };
  };

  const walk = (nodes: XmlNode[], m: Mat, inherited: Paint) => {
    for (const n of nodes) {
      const tag = tagOf(n);
      if (tag === "#text" || tag === "?xml" || tag === "#comment" || tag.startsWith("sodipodi") || tag === "metadata" || tag === "title") continue;
      if (tag === "defs" || tag === "style") {
        defs += builder.build(tag === "defs" ? childrenOf(n) : [n]);
        continue;
      }
      const name = nameOf(n);
      const label = name ?? `<${tag}>`;
      const own = multiply(m, parseTransform(attr(n, "transform"), (msg) => warn(`${label}: ${msg}`)));
      const paint = paintOf(n, inherited);
      const [kind, rest] = name && name.includes(":") ? [name.slice(0, name.indexOf(":")), name.slice(name.indexOf(":") + 1)] : [name, ""];
      if (kind === "origin") {
        const e = endpoints(n, own);
        if ("points" in e) origin = e.points[0];
        else warn(`origin: ${e.error}`);
        continue;
      }
      if (kind === "bone") {
        const [id, parent] = rest.split("@");
        const e = endpoints(n, own);
        if ("error" in e) warn(`bone "${id}": ${e.error}`);
        else bones.push({ id, parent, from: e.points[0], to: e.points[1] });
        continue;
      }
      if (kind === "anchor") {
        const [id, bone] = rest.split("@");
        const e = endpoints(n, own);
        if ("points" in e && bone) anchors[id] = { bone, at: e.points[0] };
        else warn(`anchor "${id}" needs a <circle> and @bone${"error" in e ? ` (${e.error})` : ""}`);
        continue;
      }
      if (kind === "part") {
        const [id, bone] = rest.split("@");
        if (!bone) warn(`part "${id}" has no @bone; attached to root`);
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
          warn(`skin "${id}" must be a <path>`);
          continue;
        }
        const pd = new SVGPathData(d).toAbs().matrix(...(own as [number, number, number, number, number, number])).encode();
        if (attr(n, "class") !== undefined) warn(`skin "${id}": stylesheet classes are not applied to skins; set fill / stroke on the path`);
        skins.push({ id, bones: (list ?? "root").split(","), path: pd, paint, order: order++ });
        continue;
      }
      if (tag === "g" || tag === "svg") {
        walk(childrenOf(n), own, paint);
        continue;
      }
      // Unnamed drawable outside any part → static art on the root bone.
      const s = serialize(n, m);
      rigid.push({ id: `art${unnamed++}`, bone: "root", art: wrap(s.markup, s.transform), order: order++ });
    }
  };

  const shift: Mat = [1, 0, 0, 1, 0, 0];
  walk(childrenOf(root), shift, paintOf(root, {}));

  // Re-express everything relative to the origin.
  const toSetup = (p: Vec2): Vec2 => roundVec([p[0] - origin[0], p[1] - origin[1]]);
  const originMat: Mat = [1, 0, 0, 1, -origin[0], -origin[1]];
  function wrap(markup: string, m: Mat): string {
    return `<g transform="${matToString(m)}">${markup}</g>`;
  }
  const reorigin = (art: string) => `<g transform="${matToString(originMat)}">${art}</g>`;

  const boneDef = (b: { id: string; parent?: string; from: Vec2; to: Vec2 }): BoneDef => {
    const from = toSetup(b.from);
    const to = toSetup(b.to);
    const zero = from[0] === to[0] && from[1] === to[1];
    return { id: b.id, ...(b.id === "root" ? {} : { parent: b.parent ?? "root" }), from, ...(zero ? {} : { to }) };
  };

  // Bones: the root is the drawn `bone:root` when there is one, sort parents first.
  const drawnRoot = bones.find((b) => b.id === "root");
  if (drawnRoot?.parent) warn(`bone "root" cannot have a parent; "@${drawnRoot.parent}" ignored`);
  const skeleton: BoneDef[] = [drawnRoot ? boneDef(drawnRoot) : { id: "root" }];
  const pending = bones.filter((b) => b.id !== "root");
  const placed = new Set(["root"]);
  while (pending.length) {
    const idx = pending.findIndex((b) => placed.has(b.parent ?? "root"));
    if (idx < 0) {
      for (const b of pending) warn(`bone "${b.id}" has unknown parent "${b.parent}"; attached to root`);
      for (const b of pending) b.parent = "root";
      continue;
    }
    const [b] = pending.splice(idx, 1);
    skeleton.push(boneDef(b));
    placed.add(b.id);
  }
  const knownBone = (id: string) => {
    if (!placed.has(id)) {
      warn(`unknown bone "${id}"; attached to root`);
      return "root";
    }
    return id;
  };

  const strokeWidthOf = (s: { id: string; paint: Paint }): number | undefined => {
    if (s.paint.strokeWidth === undefined) return undefined;
    const v = parseLength(s.paint.strokeWidth);
    if (v === undefined) warn(`skin "${s.id}": cannot read stroke-width "${s.paint.strokeWidth}"; ignored`);
    return v;
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
      // SVG's initial fill is black; the renderer's is none.
      fill: s.paint.fill ?? "#000",
      ...(s.paint.stroke !== undefined && s.paint.stroke !== "none" ? { stroke: s.paint.stroke } : {}),
      ...((w) => (w === undefined ? {} : { strokeWidth: w }))(strokeWidthOf(s)),
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
