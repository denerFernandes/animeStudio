import { type ToonDoc, parsePath, pathPoints, pathToString, withPoints } from "@animestudio/core";
import type { P } from "./rig";

/**
 * Body proportions applied to a kit character at build time: a grown-up made from a child template
 * gets a proportionally smaller head and longer torso, legs and arms — not just a bigger child.
 *
 * Setup space is remapped piecewise (no runtime cost):
 * - **legs**: everything below the hips stretches vertically by `legs`;
 * - **torso**: from the hips up, stretched vertically by `torso` (the hips move up with the legs);
 * - **arms**: each arm scales uniformly by `arms` around its shoulder (which follows the torso);
 * - **head**: the head and everything on it scales uniformly by `head` around the neck joint.
 *
 * Bones, rigid/switch art (setup space), morph paths, anchors and the bone offsets of pose
 * controls (e.g. the `view` poses) are transformed. Parts drawn in bone space (feet, tail tufts)
 * keep their size. Call `rigInfo` on the result to get matching measurements.
 */
export interface Proportions {
  head?: number;
  torso?: number;
  legs?: number;
  arms?: number;
}

type Mat = [number, number, number, number, number, number]; // a b c d e f (SVG matrix)
type Doc = Record<string, any>;

const apply = (m: Mat, p: P): P => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
const r2 = (n: number) => Math.round(n * 100) / 100;

export function withProportions(base: ToonDoc, p: Proportions): ToonDoc {
  const doc = structuredClone(base) as Doc;
  const head = p.head ?? 1, torso = p.torso ?? 1, legs = p.legs ?? 1, arms = p.arms ?? 1;
  const bones: Doc[] = doc.skeleton;
  const byId = new Map(bones.map((b) => [b.id, b]));
  const from = (id: string): P => byId.get(id)?.from ?? [0, 0];
  const hipY = from("hips")[1];

  // Group of every bone: walk up the parents.
  const groupOf = new Map<string, "legs" | "torso" | "armF" | "armB" | "head" | "root">();
  const classify = (id: string): "legs" | "torso" | "armF" | "armB" | "head" | "root" => {
    if (groupOf.has(id)) return groupOf.get(id)!;
    let g: "legs" | "torso" | "armF" | "armB" | "head" | "root";
    if (id === "head") g = "head";
    else if (id === "armF1") g = "armF";
    else if (id === "armB1") g = "armB";
    else if (id === "legF1" || id === "legB1") g = "legs";
    else if (id === "body" || id === "hips") g = "torso";
    else {
      const parent = byId.get(id)?.parent;
      g = parent ? classify(parent) : "root";
      if (g === "torso" && byId.get(id)?.parent === "hips" && !id.startsWith("leg")) g = "torso";
    }
    groupOf.set(id, g);
    return g;
  };
  bones.forEach((b) => classify(b.id));

  // Affine map of setup space for each group.
  const torsoMap: Mat = [1, 0, 0, torso, 0, hipY * legs - hipY * torso];
  const around = (pivot: P, s: number, target: P): Mat => [s, 0, 0, s, target[0] - pivot[0] * s, target[1] - pivot[1] * s];
  const maps: Record<string, Mat> = {
    root: [1, 0, 0, 1, 0, 0],
    legs: [1, 0, 0, legs, 0, 0],
    torso: torsoMap,
    armF: around(from("armF1"), arms, apply(torsoMap, from("armF1"))),
    armB: around(from("armB1"), arms, apply(torsoMap, from("armB1"))),
    head: around(from("head"), head, apply(torsoMap, from("head"))),
  };
  // The head pivot sits on the neck, which belongs to the torso.
  const mapOf = (bone: string) => maps[groupOf.get(bone) ?? "root"];
  const scaleOf = (bone: string) => ({ head, armF: arms, armB: arms } as Record<string, number>)[groupOf.get(bone) ?? ""] ?? 1;

  for (const b of bones) {
    const m = mapOf(b.id);
    // A bone's joint belongs to its parent's region (an arm starts on the torso…).
    if (b.from) b.from = apply(b.id === "head" || b.id === "armF1" || b.id === "armB1" ? maps.torso : m, b.from).map(r2);
    if (b.to) b.to = apply(m, b.to).map(r2);
  }

  const matrix = (m: Mat) => `matrix(${m.map(r2).join(" ")})`;
  const wrap = (art: string, m: Mat) => (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0 ? art : `<g transform="${matrix(m)}">${art}</g>`);
  const resolve = (ref: string) => (ref.trim().startsWith("<") ? ref : (doc.art?.[ref] ?? ref));
  const mapPath = (d: string, m: Mat) => pathToString(withPoints(parsePath(d), pathPoints(parsePath(d)).map((q) => apply(m, q))));

  for (const part of doc.parts as Doc[]) {
    if (part.space === "bone") continue;
    const bone = part.bone as string | undefined;
    if (!bone) continue; // hoses and skinned parts follow their bones
    const m = mapOf(bone);
    if (part.type === "rigid") part.art = wrap(resolve(part.art), m);
    else if (part.type === "switch") part.variants = Object.fromEntries(Object.entries(part.variants as Record<string, string>).map(([k, v]) => [k, wrap(resolve(v), m)]));
    else if (part.type === "morph") {
      part.base = mapPath(part.base, m);
      part.shapes = Object.fromEntries(Object.entries(part.shapes as Record<string, string>).map(([k, v]) => [k, mapPath(v, m)]));
      if (part.strokeWidth && scaleOf(bone) !== 1) part.strokeWidth = r2(part.strokeWidth * Math.sqrt(scaleOf(bone)));
    }
  }
  for (const a of Object.values((doc.anchors ?? {}) as Record<string, { bone: string; at: P }>)) a.at = apply(mapOf(a.bone), a.at).map(r2) as P;

  // Bone offsets in pose controls (views, emotions) scale with their region.
  for (const c of Object.values((doc.controls ?? {}) as Record<string, Doc>)) {
    if (c.type !== "pose") continue;
    for (const pose of Object.values(c.poses as Record<string, Record<string, unknown>>)) {
      for (const [ch, v] of Object.entries(pose)) {
        const m = /^bones\.([^.]+)\.(x|y)$/.exec(ch);
        if (m && typeof v === "number") pose[ch] = r2(v * scaleOf(m[1]) * (m[2] === "y" && groupOf.get(m[1]) === "torso" ? torso : 1));
      }
    }
  }
  const views = doc.meta?.views?.move as Record<string, Record<string, P>> | undefined;
  if (views) for (const v of Object.values(views)) for (const [bone, d] of Object.entries(v)) v[bone] = [r2(d[0] * scaleOf(bone)), r2(d[1] * scaleOf(bone))];
  doc.meta = { ...(doc.meta ?? {}), proportions: { head, torso, legs, arms } };
  return doc as ToonDoc;
}

/** Measurements for `rigInfo` after `withProportions` (extents follow the head, height everything). */
export function proportionMeasure(m: { extent: { front: number; back: number }; height: number }, p: Proportions, hipHeight: number) {
  const head = p.head ?? 1, torso = p.torso ?? 1, legs = p.legs ?? 1;
  const above = m.height - hipHeight;
  return {
    extent: { front: r2(m.extent.front * head), back: r2(m.extent.back * Math.max(head, torso)) },
    height: r2(hipHeight * legs + above * (torso * 0.55 + head * 0.45)),
  };
}
