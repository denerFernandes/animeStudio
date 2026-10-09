import type { ToonDoc } from "@animestudio/core";

/**
 * Several views (profile, front, back) on one skeleton. A hidden `view` switch part selects
 * which art is visible; the `view` pose control flips it and moves bones (arms to the sides, eyes
 * and mouth to the middle of the face, …). Every clip is shared by the three views.
 *
 * - **front** looks at the camera: draw it symmetric about the body's centre line, eyes on that
 *   line with centred pupils (move `pupils` back by the profile look offset), mouth/snout/beak
 *   centred under the eyes, same heights as the profile.
 * - **back** is for walking away from the camera (`walkDepth`): the face is hidden, the far arm
 *   is redrawn in front of the body (`farArm`).
 */

type P = [number, number];
type Doc = Record<string, any>;

export type ViewName = "front" | "back";

export interface ViewSpec {
  /** Face feature groups get their own bones so a view can move them as a unit. */
  eyes: { center: P; parts: string[] };
  mouth: { center: P; parts: string[] };
  /** Parts drawn only in profile (replaced by view art). */
  profileOnly: string[];
  /** Parts hidden (opacity) in a view. */
  hide: Partial<Record<ViewName, string[]>>;
  /** Extra parts for a view, inserted before the given part id (or appended). */
  parts: Partial<Record<ViewName, { before?: string; part: Doc }[]>>;
  /** Screen-space displacement of bones (setup units), and extra rotations, per view. */
  move: Partial<Record<ViewName, Record<string, P>>>;
  rotate?: Partial<Record<ViewName, Record<string, number>>>;
  /** Extra channels per view (e.g. mouth shapes). */
  extra?: Partial<Record<ViewName, Record<string, number | string>>>;
  /** Mouth parts used by the viseme control in addition to "mouth". */
  mouths?: string[];
  /** Far-arm parts, redrawn in front of the body in the back view. */
  farArm?: string[];
}

const angleOf = (doc: Doc, id: string): number => {
  const b = doc.skeleton.find((x: Doc) => x.id === id);
  if (!b?.from || !b.to) return 0;
  return Math.atan2(b.to[1] - b.from[1], b.to[0] - b.from[0]);
};

/** World angle of a bone's parent frame in the rest pose. */
function parentAngle(doc: Doc, id: string): number {
  const b = doc.skeleton.find((x: Doc) => x.id === id);
  return b?.parent ? angleOf(doc, b.parent) : 0;
}

const r = (n: number) => Math.round(n * 100) / 100;

export function withViews(base: ToonDoc, spec: ViewSpec): ToonDoc {
  const doc = structuredClone(base) as Doc;
  const headIdx = doc.skeleton.findIndex((b: Doc) => b.id === "head");
  // Feature bones (zero length, children of the head).
  doc.skeleton.splice(headIdx + 1, 0, { id: "eyesB", parent: "head", from: spec.eyes.center }, { id: "mouthB", parent: "head", from: spec.mouth.center });
  const pupils = doc.skeleton.find((b: Doc) => b.id === "pupils");
  if (pupils) pupils.parent = "eyesB";
  for (const p of doc.parts) {
    if (spec.eyes.parts.includes(p.id)) p.bone = "eyesB";
    if (spec.mouth.parts.includes(p.id)) p.bone = "mouthB";
  }
  // View selector.
  doc.art.viewNone = "<g/>";
  doc.parts.unshift({ id: "view", type: "switch", bone: "root", variants: { profile: "viewNone", front: "viewNone", back: "viewNone" }, default: "profile" });
  for (const p of doc.parts) if (spec.profileOnly.includes(p.id)) p.visibleWhen = { part: "view", variant: "profile" };
  // From behind, the far arm is no longer hidden by the body: draw a copy of it on top.
  const farArm = doc.parts.filter((p: Doc) => (spec.farArm ?? []).includes(p.id));
  spec.parts.back = [...(spec.parts.back ?? []), ...farArm.map((p: Doc) => ({ part: { ...structuredClone(p), id: `${p.id}Back` } }))];
  spec.hide.back = [...(spec.hide.back ?? []), ...(spec.farArm ?? [])];
  for (const view of ["front", "back"] as const) {
    for (const { before, part } of spec.parts[view] ?? []) {
      const at = before ? doc.parts.findIndex((p: Doc) => p.id === before) : -1;
      const def = { ...part, visibleWhen: { part: "view", variant: view } };
      if (at < 0) doc.parts.push(def);
      else doc.parts.splice(at, 0, def);
    }
  }
  if (spec.mouths?.length) doc.controls.mouth = { type: "viseme", part: ["mouth", ...spec.mouths] };
  // The view pose control.
  const poses: Record<string, Record<string, unknown>> = { profile: { "parts.view.variant": "profile" } };
  for (const view of ["front", "back"] as const) {
    const pose: Record<string, unknown> = { "parts.view.variant": view };
    for (const [bone, [dx, dy]] of Object.entries(spec.move[view] ?? {})) {
      // Screen displacement → offset in the parent's frame (rest pose).
      const a = parentAngle(doc, bone);
      pose[`bones.${bone}.x`] = r(dx * Math.cos(a) + dy * Math.sin(a));
      pose[`bones.${bone}.y`] = r(-dx * Math.sin(a) + dy * Math.cos(a));
    }
    for (const [bone, deg] of Object.entries(spec.rotate?.[view] ?? {})) pose[`bones.${bone}.rotation`] = deg;
    // Feet follow the legs that a view moves sideways (IK targets are in setup space).
    const legF = spec.move[view]?.legF1, legB = spec.move[view]?.legB1;
    if (legF) pose["ik.footF.x"] = legF[0];
    if (legB) pose["ik.footB.x"] = legB[0];
    for (const id of spec.hide[view] ?? []) pose[`parts.${id}.opacity`] = -1;
    Object.assign(pose, spec.extra?.[view] ?? {});
    poses[view] = pose;
  }
  doc.controls.view = { type: "pose", poses };
  doc.meta = { ...(doc.meta ?? {}), views: { move: spec.move } };
  return doc as ToonDoc;
}

/**
 * Walk for the front/back views (towards or away from the camera). Knees bend in depth, not
 * sideways, so the leg IK is switched off and the lifted leg is foreshortened instead: it stays
 * straight and gets shorter, its foot a little smaller as it moves away. The body is lowest at the
 * contacts and highest at the passing positions, and the weight shifts from one foot to the other.
 */
export function walkInPlace(dur: number, lift: number, bob: number, stride: number) {
  const q = dur / 4;
  const k = Math.min(0.32, lift / 40); // foreshortening of the lifted leg
  return {
    duration: dur,
    loop: true,
    stride,
    tracks: {
      "ik.footF.mix": [[0, 0], [dur, 0]],
      "ik.footB.mix": [[0, 0], [dur, 0]],
      "bones.legF1.squash": [[0, 0], [q, -k], [2 * q, 0], [dur, 0]],
      "bones.legF2.squash": [[0, 0], [q, -k], [2 * q, 0], [dur, 0]],
      "bones.footF.scaleX": [[0, 1], [q, 0.9], [2 * q, 1], [dur, 1]],
      "bones.legB1.squash": [[0, 0], [2 * q, 0], [3 * q, -k], [dur, 0]],
      "bones.legB2.squash": [[0, 0], [2 * q, 0], [3 * q, -k], [dur, 0]],
      "bones.footB.scaleX": [[0, 1], [2 * q, 1], [3 * q, 0.9], [dur, 1]],
      "bones.hips.y": [[0, bob], [q, -bob], [2 * q, bob], [3 * q, -bob], [dur, bob]],
      "bones.hips.x": [[0, 0], [q, 2.5], [2 * q, 0], [3 * q, -2.5], [dur, 0]],
      "bones.body.rotation": [[0, 0], [q, -1.5], [2 * q, 0], [3 * q, 1.5], [dur, 0]],
      "bones.armF1.rotation": [[0, -5], [2 * q, 5], [dur, -5]],
      "bones.armB1.rotation": [[0, 5], [2 * q, -5], [dur, 5]],
    },
  };
}

