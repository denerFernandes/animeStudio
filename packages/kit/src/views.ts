import type { ToonDoc } from "@animestudio/core";
import { restAngle } from "./util";

/**
 * Several views (profile, front, back, in-between angles) on one skeleton. A hidden `view` switch
 * part selects which art is visible; the `view` pose control flips it and moves bones (arms to the
 * sides, eyes and mouth to the middle of the face, …). Every clip is shared by the views. Only the
 * views the spec draws exist (a spec with front art alone gives `profile` and `front`).
 *
 * - **front** looks at the camera: draw it symmetric about the body's centre line, eyes on that
 *   line with centred pupils (move `pupils` back by the profile look offset), mouth/snout/beak
 *   centred under the eyes, same heights as the profile.
 * - **back** is for walking away from the camera (`walkDepth`): the face is hidden, the far arm
 *   is redrawn in front of the body (`farArm`).
 */

type P = [number, number];
type Doc = Record<string, any>;

/** A view other than the profile: `front`, `back`, or any in-between angle a rig draws. */
export type ViewName = string;

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
  /** Far-arm parts, redrawn in front of the body in the back view (when the spec draws one). */
  farArm?: string[];
  /**
   * Bones kept (almost) straight in a view: their rotation from emotions, aim and clips is scaled
   * by `STILL_MIX`. A head tilting around the neck reads well in profile but looks broken from the
   * front or the back. Default: `{ front: ["head"], back: ["head"] }`.
   */
  still?: Partial<Record<ViewName, string[]>>;
  /**
   * The views in turning order, e.g. `["front", "half", "profile", "side", "back"]`: a rig drawn at
   * in-between angles. The director then turns characters through every drawing in between (a
   * turn on twos, like hand-drawn animation) instead of switching drawings at once.
   */
  order?: string[];
  /**
   * The view a character is drawn in crossing the frame (running across it): side-on enough to read
   * the move, the face still showing. The director turns runners to it and back on arrival.
   */
  travel?: string;
}

/** World angle of a bone's parent frame in the rest pose. */
function parentAngle(doc: Doc, id: string): number {
  const b = doc.skeleton.find((x: Doc) => x.id === id);
  return b?.parent ? restAngle(doc.skeleton, b.parent) : 0;
}

/** The views a spec draws (every view named anywhere in it, the profile aside), in the spec's order. */
function specViews(spec: ViewSpec): ViewName[] {
  const keys = [spec.parts, spec.move, spec.hide, spec.rotate ?? {}, spec.extra ?? {}, spec.still ?? {}].flatMap((o) => Object.keys(o));
  return [...new Set(keys)].filter((v) => v !== "profile");
}

const r = (n: number) => Math.round(n * 100) / 100;

/** Rotation kept by `still` bones in front/back views. */
export const STILL_MIX = 0.15;

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
  // The views the spec draws: only those get a switch variant and a pose (a rig without a `back`
  // drawing has no `back` view).
  const names = specViews(spec);
  // View selector.
  doc.art.viewNone = "<g/>";
  doc.parts.unshift({ id: "view", type: "switch", bone: "root", variants: Object.fromEntries(["profile", ...names].map((v) => [v, "viewNone"])), default: "profile" });
  for (const p of doc.parts) if (spec.profileOnly.includes(p.id)) p.visibleWhen = { part: "view", variant: "profile" };
  // From behind, the far arm is no longer hidden by the body: draw a copy of it on top.
  const farArm = names.includes("back") ? doc.parts.filter((p: Doc) => (spec.farArm ?? []).includes(p.id)) : [];
  if (farArm.length) {
    spec.parts.back = [...(spec.parts.back ?? []), ...farArm.map((p: Doc) => ({ part: { ...structuredClone(p), id: `${p.id}Back` } }))];
    spec.hide.back = [...(spec.hide.back ?? []), ...(spec.farArm ?? [])];
  }
  for (const view of names) {
    for (const { before, part } of spec.parts[view] ?? []) {
      const at = before ? doc.parts.findIndex((p: Doc) => p.id === before) : -1;
      // Shown in its view only; a part with its own switch condition (irises with open eyes) keeps
      // it, the view gate added as the second condition.
      const gate = { part: "view", variant: view };
      const own = part.visibleWhen as { part: string; variant: string | string[]; and?: unknown } | undefined;
      if (own?.and) throw new Error(`${doc.name}: view part "${part.id}" already has two switch conditions; the view gate needs one of them`);
      const def = { ...part, visibleWhen: own ? { ...own, and: gate } : gate };
      if (at < 0) doc.parts.push(def);
      else doc.parts.splice(at, 0, def);
    }
  }
  if (spec.mouths?.length) doc.controls.mouth = { type: "viseme", part: ["mouth", ...spec.mouths] };
  // The view pose control.
  const poses: Record<string, Record<string, unknown>> = { profile: { "parts.view.variant": "profile" } };
  for (const view of names) {
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
    for (const bone of spec.still?.[view] ?? (view === "front" || view === "back" ? ["head"] : [])) if (doc.skeleton.some((b: Doc) => b.id === bone)) pose[`bones.${bone}.rotationMix`] = STILL_MIX - 1;
    Object.assign(pose, spec.extra?.[view] ?? {});
    poses[view] = pose;
  }
  doc.controls.view = { type: "pose", poses };
  doc.meta = { ...(doc.meta ?? {}), views: { move: spec.move, ...(spec.order ? { order: spec.order } : {}), ...(spec.travel ? { travel: spec.travel } : {}) } };
  return doc as ToonDoc;
}
