import type {
  BehaviorDef,
  ControlDef,
  PartDef,
  PhysicsDef,
  ToonDoc,
  Value,
} from "./format/schema";
import { type Track, normalizeTrack } from "./keyframes";
import {
  type Mat,
  type Vec2,
  angleOf,
  apply,
  dist,
  distToSegment,
  fromTRS,
  invert,
  matAngle,
  multiply,
  sub,
  wrapAngle,
} from "./math";
import { type CubicPath, equalizePaths, parsePath, pathPoints } from "./paths";

export class RigError extends Error {
  constructor(
    message: string,
    public path?: string,
  ) {
    super(path ? `${path}: ${message}` : message);
    this.name = "RigError";
  }
}

export interface RigBone {
  id: string;
  index: number;
  parent: number;
  x: number;
  y: number;
  rotation: number;
  length: number;
  scaleX: number;
  scaleY: number;
  mass: number;
  limits?: [number, number];
  inheritRotation: boolean;
  inheritScale: boolean;
  setupWorld: Mat;
  setupWorldInv: Mat;
}

export interface PathStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  attrs?: Record<string, string | number>;
}

interface RigPartBase {
  id: string;
  index: number;
  z: number;
  opacity: number;
  visible: boolean;
  visibleWhen?: { part: number; variants: string[] };
}

export type RigPart =
  | (RigPartBase & { type: "rigid"; bone: number; markup: string; space: "setup" | "bone" })
  | (RigPartBase & {
      type: "switch";
      bone: number;
      variants: Record<string, string>;
      default: string;
      space: "setup" | "bone";
    })
  | (RigPartBase & {
      type: "skinned";
      path: CubicPath;
      influences: number[];
      /** weights[pointIndex][influenceIndex] */
      weights: number[][];
      style: PathStyle;
    })
  | (RigPartBase & { type: "hose"; bones: number[]; widths: number[]; cap: "round" | "butt"; smooth: number; style: PathStyle })
  | (RigPartBase & {
      type: "morph";
      bone: number;
      base: CubicPath;
      shapes: Record<string, CubicPath>;
      space: "setup" | "bone";
      style: PathStyle;
    });

export type BoneProp = "x" | "y" | "rotation" | "scaleX" | "scaleY" | "squash";

export type ChannelRef =
  | { kind: "bone"; index: number; prop: BoneProp }
  | { kind: "part"; index: number; prop: "variant" | "opacity" }
  | { kind: "morph"; index: number; shape: string }
  | { kind: "ik"; index: number; prop: "x" | "y" | "mix" }
  | { kind: "control"; name: string }
  | { kind: "behavior"; index: number }
  | { kind: "physics"; index: number };

export interface RigTrack {
  channel: string;
  ref: ChannelRef;
  track: Track;
}

export interface RigClip {
  name: string;
  duration: number;
  loop: boolean;
  stride: number;
  tracks: RigTrack[];
}

export interface RigIk {
  id: string;
  bones: number[];
  bend: 1 | -1;
  mix: number;
  /** Chain tip in the setup pose (character space). */
  restTarget: Vec2;
}

export type RigPhysics =
  | {
      type: "spring";
      bones: number[];
      stiffness: number;
      damping: number;
      gravity: Vec2;
      inertia: number;
      mix: number;
    }
  | { type: "jiggle"; bone: number; stiffness: number; damping: number; translate: number; squash: number; mix: number };

export type RigControl =
  | { type: "viseme"; name: string; part: number; map: Record<string, string> }
  | {
      type: "aim";
      name: string;
      targets: { bone: number; weight: number; mode: "rotate" | "translate"; forward: number; maxAngle: number; radius: number }[];
    }
  | { type: "pose"; name: string; poses: Record<string, { ref: ChannelRef; value: Value }[]> };

export type RigBehavior =
  | { type: "blink"; id: string; part: number; open: string; closed: string; interval: [number, number]; duration: number }
  | { type: "breathe"; id: string; bone: number; amount: number; period: number }
  | { type: "sway"; id: string; bone: number; angle: number; period: number };

export interface Rig {
  name: string;
  doc: ToonDoc;
  bones: RigBone[];
  boneIndex: Map<string, number>;
  parts: RigPart[];
  partIndex: Map<string, number>;
  /** Parts in draw order. */
  drawOrder: RigPart[];
  anchors: Record<string, { bone: number; at: Vec2 }>;
  ik: RigIk[];
  physics: RigPhysics[];
  colliders: { bone: number; radius: number }[];
  controls: Record<string, RigControl>;
  behaviors: RigBehavior[];
  clips: Record<string, RigClip>;
  defs: string;
  palette: Record<string, string>;
}

export interface CompileRigOptions {
  /** Palette overrides (recoloring). */
  palette?: Record<string, string>;
  /** Prefix for SVG ids inside art/defs, to avoid collisions between actors. */
  idPrefix?: string;
}

// ---------------------------------------------------------------------------
// Markup helpers
// ---------------------------------------------------------------------------

export function resolvePalette(markup: string, palette: Record<string, string>): string {
  return markup.replace(/palette\(\s*([\w-]+)\s*\)/g, (m, name: string) => palette[name] ?? m);
}

export function namespaceIds(markup: string, prefix: string | undefined): string {
  if (!prefix) return markup;
  return markup
    .replace(/\bid\s*=\s*(["'])([^"']+)\1/g, (_m, q: string, id: string) => `id=${q}${prefix}-${id}${q}`)
    .replace(/url\(\s*#([^)\s]+)\s*\)/g, (_m, id: string) => `url(#${prefix}-${id})`)
    .replace(/(href\s*=\s*)(["'])#([^"']+)\2/g, (_m, a: string, q: string, id: string) => `${a}${q}#${prefix}-${id}${q}`);
}

// ---------------------------------------------------------------------------
// Forward kinematics on the setup pose
// ---------------------------------------------------------------------------

export function boneLocalMatrix(
  b: RigBone,
  dx = 0,
  dy = 0,
  drot = 0,
  msx = 1,
  msy = 1,
  squash = 0,
): Mat {
  // Squash is relative to the bone: > 0 stretches along the bone, < 0 squashes (volume-preserving).
  const sq = 1 + Math.max(-0.9, squash);
  return fromTRS(b.x + dx, b.y + dy, b.rotation + drot, b.scaleX * msx * sq, (b.scaleY * msy) / sq);
}

export function composeWorld(b: RigBone, parentWorld: Mat | undefined, local: Mat, localRotation: number): Mat {
  if (!parentWorld) return local;
  if (b.inheritRotation && b.inheritScale) return multiply(parentWorld, local);
  const pos = apply(parentWorld, [local[4], local[5]]);
  const psx = Math.hypot(parentWorld[0], parentWorld[1]);
  const psy = (parentWorld[0] * parentWorld[3] - parentWorld[1] * parentWorld[2]) / (psx || 1);
  const lsx = Math.hypot(local[0], local[1]);
  const lsy = (local[0] * local[3] - local[1] * local[2]) / (lsx || 1);
  const angle = (b.inheritRotation ? matAngle(parentWorld) : 0) + localRotation;
  return fromTRS(pos[0], pos[1], angle, b.inheritScale ? psx * lsx : lsx, b.inheritScale ? psy * lsy : lsy);
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

const BONE_PROPS: BoneProp[] = ["x", "y", "rotation", "scaleX", "scaleY", "squash"];

const known = (what: string, keys: Iterable<string>) => {
  const list = [...keys];
  return list.length ? ` Known ${what}: ${list.join(", ")}.` : ` This character has no ${what}.`;
};

/** Resolves a character channel path (e.g. `bones.arm.rotation`) to a reference. */
export function resolveChannel(rig: Pick<Rig, "boneIndex" | "partIndex" | "parts" | "ik" | "controls" | "behaviors" | "physics">, channel: string): ChannelRef {
  const seg = channel.split(".");
  const fail = (msg: string): never => {
    throw new RigError(msg, `channel "${channel}"`);
  };
  switch (seg[0]) {
    case "bones": {
      const index = rig.boneIndex.get(seg[1]);
      if (index === undefined) fail(`unknown bone "${seg[1]}".` + known("bones", rig.boneIndex.keys()));
      const prop = seg[2] as BoneProp;
      if (!BONE_PROPS.includes(prop) || seg.length !== 3) fail(`expected bones.<id>.(${BONE_PROPS.join("|")}).`);
      return { kind: "bone", index: index!, prop };
    }
    case "parts": {
      const index = rig.partIndex.get(seg[1]);
      if (index === undefined) fail(`unknown part "${seg[1]}".` + known("parts", rig.partIndex.keys()));
      const part = rig.parts[index!];
      if (seg[2] === "morph" && seg.length === 4) {
        if (part.type !== "morph") fail(`part "${seg[1]}" is not a morph part.`);
        if (part.type === "morph" && !(seg[3] in part.shapes)) fail(`unknown shape "${seg[3]}".` + known("shapes", Object.keys(part.shapes)));
        return { kind: "morph", index: index!, shape: seg[3] };
      }
      if ((seg[2] === "variant" || seg[2] === "opacity") && seg.length === 3) {
        if (seg[2] === "variant" && part.type !== "switch") fail(`part "${seg[1]}" is not a switch part.`);
        return { kind: "part", index: index!, prop: seg[2] };
      }
      return fail("expected parts.<id>.variant, parts.<id>.opacity or parts.<id>.morph.<shape>.");
    }
    case "ik": {
      const index = rig.ik.findIndex((k) => k.id === seg[1]);
      if (index < 0) fail(`unknown IK chain "${seg[1]}".` + known("IK chains", rig.ik.map((k) => k.id)));
      const prop = seg[2] as "x" | "y" | "mix";
      if (!["x", "y", "mix"].includes(prop) || seg.length !== 3) fail("expected ik.<id>.(x|y|mix).");
      return { kind: "ik", index, prop };
    }
    case "controls": {
      if (seg.length !== 2 || !(seg[1] in rig.controls)) fail(`unknown control "${seg[1]}".` + known("controls", Object.keys(rig.controls)));
      return { kind: "control", name: seg[1] };
    }
    case "behaviors": {
      const index = rig.behaviors.findIndex((b) => b.id === seg[1]);
      if (index < 0 || seg[2] !== "mix") fail(`expected behaviors.<id>.mix.` + known("behaviors", rig.behaviors.map((b) => b.id)));
      return { kind: "behavior", index };
    }
    case "physics": {
      const index = Number(seg[1]);
      if (!Number.isInteger(index) || index < 0 || index >= rig.physics.length || seg[2] !== "mix") {
        fail(`expected physics.<index>.mix with index in 0..${rig.physics.length - 1}.`);
      }
      return { kind: "physics", index };
    }
  }
  return fail(`channel must start with bones., parts., ik., controls., behaviors. or physics.`);
}

// ---------------------------------------------------------------------------
// Compilation
// ---------------------------------------------------------------------------

const VISEME_FALLBACK: Record<string, string[]> = {
  A: ["X"],
  B: ["C", "A"],
  C: ["B", "D"],
  D: ["C", "B"],
  E: ["C", "F", "D"],
  F: ["E", "A"],
  G: ["B", "A"],
  H: ["C", "B"],
  X: ["A"],
};

/**
 * Resolves a viseme to a variant (switch part) or shape (morph part) that exists,
 * using fallbacks for smaller mouth sets. Returns undefined when nothing matches
 * (for morph parts this means "base shape").
 */
export function visemeVariant(control: Extract<RigControl, { type: "viseme" }>, part: RigPart, viseme: string): string | undefined {
  if (part.type !== "switch" && part.type !== "morph") return undefined;
  const pool = part.type === "switch" ? part.variants : part.shapes;
  const has = (v: string | undefined) => v !== undefined && v in pool;
  const candidates = [viseme, ...(VISEME_FALLBACK[viseme] ?? [])];
  for (const c of candidates) {
    const mapped = control.map[c] ?? c;
    if (has(mapped)) return mapped;
  }
  return undefined;
}

function resampleWidths(width: number | number[], count: number): number[] {
  const src = typeof width === "number" ? [width] : width;
  if (src.length === 1) return new Array(count).fill(src[0]);
  return Array.from({ length: count }, (_, i) => {
    const u = count === 1 ? 0 : (i / (count - 1)) * (src.length - 1);
    const k = Math.min(src.length - 2, Math.floor(u));
    return src[k] + (src[k + 1] - src[k]) * (u - k);
  });
}

/** Compiles a validated character document into an evaluable rig. */
export function compileRig(doc: ToonDoc, options: CompileRigOptions = {}): Rig {
  const palette = { ...(doc.palette ?? {}), ...(options.palette ?? {}) };
  const prep = (markup: string) => namespaceIds(resolvePalette(markup, palette), options.idPrefix);
  const color = (c: string | undefined) => (c === undefined ? undefined : resolvePalette(c, palette));

  // Bones ------------------------------------------------------------------
  const bones: RigBone[] = [];
  const boneIndex = new Map<string, number>();
  doc.skeleton.forEach((def, i) => {
    const path = `skeleton[${i}] (${def.id})`;
    if (boneIndex.has(def.id)) throw new RigError(`duplicate bone id "${def.id}"`, path);
    let parent = -1;
    if (def.parent !== undefined) {
      const p = boneIndex.get(def.parent);
      if (p === undefined) throw new RigError(`parent "${def.parent}" is not declared before this bone`, path);
      parent = p;
    }
    const parentWorld = parent >= 0 ? bones[parent].setupWorld : undefined;
    const setupForm = def.from !== undefined || def.to !== undefined;
    const localForm = def.x !== undefined || def.y !== undefined || def.rotation !== undefined;
    if (setupForm && localForm) throw new RigError("use either setup form (from/to) or local form (x/y/rotation), not both", path);

    const bone: RigBone = {
      id: def.id,
      index: i,
      parent,
      x: def.x ?? 0,
      y: def.y ?? 0,
      rotation: def.rotation ?? 0,
      length: def.length ?? 0,
      scaleX: def.scaleX ?? 1,
      scaleY: def.scaleY ?? 1,
      mass: def.mass ?? 1,
      limits: def.limits?.rotation,
      inheritRotation: def.inheritRotation ?? true,
      inheritScale: def.inheritScale ?? true,
      setupWorld: [1, 0, 0, 1, 0, 0],
      setupWorldInv: [1, 0, 0, 1, 0, 0],
    };
    if (setupForm) {
      const from: Vec2 = def.from ?? (parentWorld ? apply(parentWorld, [0, 0]) : [0, 0]);
      const worldAngle = def.to ? angleOf(sub(def.to, from)) : 0;
      if (def.to && def.length === undefined) bone.length = dist(from, def.to);
      const local = parentWorld ? apply(invert(parentWorld), from) : from;
      bone.x = local[0];
      bone.y = local[1];
      const parentAngle = parentWorld && bone.inheritRotation ? matAngle(parentWorld) : 0;
      const flip = parentWorld && parentWorld[0] * parentWorld[3] - parentWorld[1] * parentWorld[2] < 0 ? -1 : 1;
      bone.rotation = wrapAngle((worldAngle - parentAngle) * flip);
    }
    const local = boneLocalMatrix(bone);
    bone.setupWorld = composeWorld(bone, parentWorld, local, bone.rotation);
    bone.setupWorldInv = invert(bone.setupWorld);
    bones.push(bone);
    boneIndex.set(def.id, i);
  });

  const boneRef = (id: string, path: string) => {
    const i = boneIndex.get(id);
    if (i === undefined) throw new RigError(`unknown bone "${id}".` + known("bones", boneIndex.keys()), path);
    return i;
  };
  const boneTip = (i: number): Vec2 => apply(bones[i].setupWorld, [bones[i].length, 0]);
  const boneOrigin = (i: number): Vec2 => apply(bones[i].setupWorld, [0, 0]);

  const art = (ref: string, path: string): string => {
    if (ref === "" || ref.trimStart().startsWith("<")) return prep(ref);
    const m = doc.art?.[ref];
    if (m === undefined) throw new RigError(`unknown art "${ref}".` + known("art entries", Object.keys(doc.art ?? {})), path);
    return prep(m);
  };

  // Parts ------------------------------------------------------------------
  const partIndex = new Map<string, number>();
  doc.parts.forEach((p, i) => {
    if (partIndex.has(p.id)) throw new RigError(`duplicate part id "${p.id}"`, `parts[${i}]`);
    partIndex.set(p.id, i);
  });

  const style = (p: { fill?: string; stroke?: string; strokeWidth?: number; attrs?: Record<string, string | number> }): PathStyle => ({
    fill: color(p.fill),
    stroke: color(p.stroke),
    strokeWidth: p.strokeWidth,
    attrs: p.attrs
      ? Object.fromEntries(Object.entries(p.attrs).map(([k, v]) => [k, typeof v === "string" ? prep(v) : v]))
      : undefined,
  });

  const parts: RigPart[] = doc.parts.map((def: PartDef, index): RigPart => {
    const path = `parts[${index}] (${def.id})`;
    let visibleWhen: RigPartBase["visibleWhen"];
    if (def.visibleWhen) {
      const target = partIndex.get(def.visibleWhen.part);
      if (target === undefined) throw new RigError(`visibleWhen references unknown part "${def.visibleWhen.part}"`, path);
      const v = def.visibleWhen.variant;
      visibleWhen = { part: target, variants: Array.isArray(v) ? v : [v] };
    }
    const base: RigPartBase = {
      id: def.id,
      index,
      z: def.z ?? 0,
      opacity: def.opacity ?? 1,
      visible: def.visible ?? true,
      visibleWhen,
    };
    switch (def.type) {
      case "rigid":
        return { ...base, type: "rigid", bone: boneRef(def.bone, path), markup: art(def.art, path), space: def.space ?? "setup" };
      case "switch": {
        const variants = Object.fromEntries(Object.entries(def.variants).map(([k, v]) => [k, art(v, `${path}.variants.${k}`)]));
        if (!(def.default in variants)) throw new RigError(`default variant "${def.default}" is not in variants`, path);
        return { ...base, type: "switch", bone: boneRef(def.bone, path), variants, default: def.default, space: def.space ?? "setup" };
      }
      case "skinned": {
        const influences = def.bones.map((b) => boneRef(b, path));
        const cubic = parsePath(def.path);
        const pts = pathPoints(cubic);
        let weights: number[][];
        if (def.weights) {
          if (def.weights.length !== pts.length) {
            throw new RigError(`weights has ${def.weights.length} rows but the normalized path has ${pts.length} points`, path);
          }
          weights = def.weights.map((row) => {
            const s = row.reduce((a, b) => a + b, 0) || 1;
            return influences.map((_, k) => (row[k] ?? 0) / s);
          });
        } else {
          const falloff = def.falloff ?? 2;
          weights = pts.map((p) => {
            const raw = influences.map((bi) => 1 / Math.pow(distToSegment(p, boneOrigin(bi), boneTip(bi)) + 1, falloff));
            const sorted = [...raw].sort((a, b) => b - a);
            const cut = sorted[Math.min(1, sorted.length - 1)];
            const kept = raw.map((w) => (w >= cut ? w : 0));
            const s = kept.reduce((a, b) => a + b, 0) || 1;
            return kept.map((w) => w / s);
          });
        }
        return { ...base, type: "skinned", path: cubic, influences, weights, style: style(def) };
      }
      case "hose": {
        const hb = def.bones.map((b) => boneRef(b, path));
        return {
          ...base,
          type: "hose",
          bones: hb,
          widths: resampleWidths(def.width, hb.length + 1),
          cap: def.cap ?? "round",
          smooth: def.smooth ?? 1,
          style: style(def),
        };
      }
      case "morph": {
        const names = Object.keys(def.shapes);
        let all: CubicPath[];
        try {
          all = equalizePaths([parsePath(def.base), ...names.map((n) => parsePath(def.shapes[n]))]);
        } catch (e) {
          throw new RigError((e as Error).message, path);
        }
        return {
          ...base,
          type: "morph",
          bone: boneRef(def.bone, path),
          base: all[0],
          shapes: Object.fromEntries(names.map((n, k) => [n, all[k + 1]])),
          space: def.space ?? "setup",
          style: style(def),
        };
      }
    }
  });

  const drawOrder = parts
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.z - b.p.z || a.i - b.i)
    .map((e) => e.p);

  // Anchors, IK, physics ----------------------------------------------------
  const anchors = Object.fromEntries(
    Object.entries(doc.anchors ?? {}).map(([k, a]) => [k, { bone: boneRef(a.bone, `anchors.${k}`), at: a.at }]),
  );

  const ik: RigIk[] = (doc.ik ?? []).map((def, i) => {
    const path = `ik[${i}] (${def.id})`;
    const chain = def.bones.map((b) => boneRef(b, path));
    for (let k = 1; k < chain.length; k++) {
      if (bones[chain[k]].parent !== chain[k - 1]) {
        throw new RigError(`bone "${def.bones[k]}" must be a child of "${def.bones[k - 1]}"`, path);
      }
    }
    return { id: def.id, bones: chain, bend: def.bend ?? 1, mix: def.mix ?? 1, restTarget: boneTip(chain[chain.length - 1]) };
  });

  const physics: RigPhysics[] = (doc.physics ?? []).map((def: PhysicsDef, i) => {
    const path = `physics[${i}]`;
    if (def.type === "spring") {
      const chain = def.bones.map((b) => boneRef(b, path));
      for (let k = 1; k < chain.length; k++) {
        if (bones[chain[k]].parent !== chain[k - 1]) {
          throw new RigError(`bone "${def.bones[k]}" must be a child of "${def.bones[k - 1]}"`, path);
        }
      }
      return {
        type: "spring",
        bones: chain,
        stiffness: def.stiffness ?? 0.5,
        damping: def.damping ?? 0.3,
        gravity: def.gravity ?? [0, 0],
        inertia: def.inertia ?? 1,
        mix: def.mix ?? 1,
      };
    }
    return {
      type: "jiggle",
      bone: boneRef(def.bone, path),
      stiffness: def.stiffness ?? 0.5,
      damping: def.damping ?? 0.3,
      translate: def.translate ?? 0.5,
      squash: def.squash ?? 0.3,
      mix: def.mix ?? 1,
    };
  });

  // Behaviors ----------------------------------------------------------------
  const partRef = (id: string, path: string) => {
    const i = partIndex.get(id);
    if (i === undefined) throw new RigError(`unknown part "${id}".` + known("parts", partIndex.keys()), path);
    return i;
  };

  const behaviors: RigBehavior[] = (doc.behaviors ?? []).map((def: BehaviorDef, i) => {
    const path = `behaviors[${i}] (${def.id})`;
    switch (def.type) {
      case "blink": {
        const part = parts[partRef(def.part, path)];
        if (part.type !== "switch") throw new RigError(`part "${def.part}" must be a switch part`, path);
        for (const v of [def.open, def.closed]) {
          if (!(v in part.variants)) throw new RigError(`variant "${v}" not found in part "${def.part}"`, path);
        }
        return {
          type: "blink",
          id: def.id,
          part: part.index,
          open: def.open,
          closed: def.closed,
          interval: def.interval ?? [2, 5],
          duration: def.duration ?? 0.15,
        };
      }
      case "breathe":
        return { type: "breathe", id: def.id, bone: boneRef(def.bone, path), amount: def.amount ?? 0.02, period: def.period ?? 3.5 };
      case "sway":
        return { type: "sway", id: def.id, bone: boneRef(def.bone, path), angle: def.angle ?? 2, period: def.period ?? 4 };
    }
  });

  // Controls (pose entries are resolved after the partial rig exists) --------
  const partial = { boneIndex, partIndex, parts, ik, behaviors, physics, controls: {} as Record<string, RigControl> };
  const controlDefs = Object.entries(doc.controls ?? {}) as [string, ControlDef][];
  for (const [name] of controlDefs) partial.controls[name] = { type: "pose", name, poses: {} };
  for (const [name, def] of controlDefs) {
    const path = `controls.${name}`;
    if (def.type === "viseme") {
      const part = parts[partRef(def.part, path)];
      if (part.type !== "switch" && part.type !== "morph") throw new RigError(`part "${def.part}" must be a switch or morph part`, path);
      partial.controls[name] = { type: "viseme", name, part: part.index, map: def.map ?? {} };
    } else if (def.type === "aim") {
      partial.controls[name] = {
        type: "aim",
        name,
        targets: def.targets.map((t) => ({
          bone: boneRef(t.bone, path),
          weight: t.weight ?? 1,
          mode: t.mode ?? "rotate",
          forward: t.forward ?? 0,
          maxAngle: t.maxAngle ?? 60,
          radius: t.radius ?? 0,
        })),
      };
    }
  }
  for (const [name, def] of controlDefs) {
    if (def.type !== "pose") continue;
    const poses: Record<string, { ref: ChannelRef; value: Value }[]> = {};
    for (const [pose, channels] of Object.entries(def.poses)) {
      poses[pose] = Object.entries(channels).map(([ch, value]) => {
        const ref = resolveChannel(partial, ch);
        if (ref.kind === "control") throw new RigError("poses cannot drive other controls", `controls.${name}.poses.${pose}`);
        return { ref, value };
      });
    }
    partial.controls[name] = { type: "pose", name, poses };
  }

  // Clips --------------------------------------------------------------------
  const clips: Record<string, RigClip> = {};
  for (const [name, def] of Object.entries(doc.clips ?? {})) {
    clips[name] = {
      name,
      duration: def.duration,
      loop: def.loop ?? false,
      stride: def.stride ?? 0,
      tracks: Object.entries(def.tracks).map(([channel, keys]) => {
        let ref: ChannelRef;
        try {
          ref = resolveChannel(partial, channel);
        } catch (e) {
          throw new RigError((e as Error).message, `clips.${name}`);
        }
        return { channel, ref, track: normalizeTrack(keys, def.loop ? { loop: { duration: def.duration } } : {}) };
      }),
    };
  }

  const colliders = (doc.colliders ?? []).map((c, i) => ({ bone: boneRef(c.bone, `colliders[${i}]`), radius: c.radius }));

  return {
    name: doc.name,
    doc,
    colliders,
    bones,
    boneIndex,
    parts,
    partIndex,
    drawOrder,
    anchors,
    ik,
    physics,
    controls: partial.controls,
    behaviors,
    clips,
    defs: doc.defs ? prep(doc.defs) : "",
    palette,
  };
}
