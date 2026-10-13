/**
 * Helpers of `face-clearance.test.ts`: the cartoon rigs it poses (the kit is a test-only import —
 * the kit depends on core, never the other way round) and the measurements it compares with the
 * fixtures captured from the code before the 3D reaches and the face clearance.
 */
import type { ClipInstance, CompiledRig3d, EvaluatedPose, Rig, Rig3dFrame, RigTrack, SolidBody, ToonDoc, V3 } from "../src";
import { apply, compileRig, evaluatePose, hashString, makeTrack, occluderDepthAt, resolveChannel, viewPoint } from "../src";

/** The repro look (a big-headed boy with spiky hair) and the kit's default kid. */
export async function cartoonDocs(): Promise<Record<"tito" | "kid", ToonDoc>> {
  const kit = await import("../../kit/src");
  const tito = kit.cartoonCharacter(
    { name: "Tito", build: "child", skin: "#f6d3b8", hair: "spiky", hairColor: "#c8612e", top: "stripes", topColor: "#f2b544", top2: "#fbf3df", bottom: "shorts", bottomColor: "#4f6fa8", shoes: "sneakers", shoeColor: "#e2584a", socks: "#ffffff", freckles: true, nose: "button" },
    { style: { ink: "#3a2824", shade: false, line: 2.8, limbs: "tube", hands: "open", eyes: "wide", proportions: "bigHead" } },
  );
  const kid = kit.cartoonCharacter({
    name: "kid", build: "kid", skin: "#f6d3b5", hair: "ponytail", hairColor: "#5a3a22", accent: "#ff4fa0",
    top: "shirt", topColor: "#ffffff", pattern: "pinstripes", pocketItem: { color: "#ffffff" }, earItem: "cigarette",
    bottom: "bermuda", bottomColor: "#3a62b0", shoes: "sneakers", glasses: "sun", hat: "capBack", tie: "#a8202f",
  } as never);
  return { tito, kid };
}

export const tracksOf = (rig: Rig, values: Record<string, number>): RigTrack[] =>
  Object.entries(values).map(([channel, v]) => ({ channel, ref: resolveChannel(rig, channel), track: makeTrack([{ t: 0, v }]) }) as RigTrack);

export const play = (clip: string): ClipInstance => ({ clip, start: 0, end: Infinity, speed: 1, loop: true, fadeIn: 0, fadeOut: 0, layer: 0, blend: "override", weight: 1 });

export function poseOf(rig: Rig, view: string, values: Record<string, number> = {}, clip?: string, time = 0): EvaluatedPose {
  return evaluatePose(rig, { time, controls: { view }, tracks: tracksOf(rig, values), ...(clip ? { clips: [play(clip)] } : {}) });
}

type KeepOut = { bone: string; at: V3; radii: V3 };
const mv = (m: number[], v: V3): V3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const mvT = (m: number[], v: V3): V3 => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];

/** A 3D bone's posed joint, tip and middle (body space). */
export function bone3d(rig: Rig, frame: Rig3dFrame, id: string): { from: V3; to: V3; mid: V3 } {
  const r3 = rig.rig3d!;
  const i = r3.byIndex.get(rig.boneIndex.get(id)!)!;
  const B = r3.bones[i];
  const from = frame.pos[i];
  const to = mv(frame.rot[i], [B.to[0] - B.from[0], B.to[1] - B.from[1], B.to[2] - B.from[2]]).map((v, k) => v + from[k]) as V3;
  return { from, to, mid: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2] };
}

/** The smallest normalised distance of a body-space point from the head's keep-outs (1: on the surface). */
export function headClearance(doc: ToonDoc, rig: Rig, frame: Rig3dFrame, p: V3): number {
  const keep = ((doc.rig3d as { keepOut?: KeepOut[] }).keepOut ?? []).filter((k) => k.bone === "head");
  const r3 = rig.rig3d!;
  let q = Infinity;
  for (const k of keep) {
    const i = r3.byIndex.get(rig.boneIndex.get(k.bone)!)!;
    const c = mv(frame.rot[i], k.at).map((v, j) => v + frame.pos[i][j]) as V3;
    const l = mvT(frame.rot[i], [p[0] - c[0], p[1] - c[1], p[2] - c[2]]);
    q = Math.min(q, Math.hypot(l[0] / k.radii[0], l[1] / k.radii[1], l[2] / k.radii[2]));
  }
  return q;
}

/**
 * The least normalised distance (1: the outline) of a body-space segment from the head's keep-outs
 * as drawn in the picture (each ellipsoid's outline: the ellipse of its projected axes).
 */
export function screenClearance(doc: ToonDoc, rig: Rig, frame: Rig3dFrame, a: V3, b: V3): number {
  const keep = ((doc.rig3d as { keepOut?: KeepOut[] }).keepOut ?? []).filter((k) => k.bone === "head");
  const r3 = rig.rig3d!;
  const vp = (p: V3) => viewPoint(p, frame.yaw, frame.pitch);
  let q = Infinity;
  for (const k of keep) {
    const i = r3.byIndex.get(rig.boneIndex.get(k.bone)!)!, R = frame.rot[i];
    const c = vp(mv(R, k.at).map((v, j) => v + frame.pos[i][j]) as V3);
    let A = 0, B = 0, C = 0;
    for (let m = 0; m < 3; m++) {
      const ax = vp([R[m] * k.radii[m], R[3 + m] * k.radii[m], R[6 + m] * k.radii[m]]);
      A += ax[0] * ax[0]; B += ax[0] * ax[1]; C += ax[1] * ax[1];
    }
    const det = A * C - B * B;
    const pa = vp(a), pb = vp(b);
    // Sampled finely along the segment.
    for (let s = 0; s <= 200; s++) {
      const x = pa[0] + ((pb[0] - pa[0]) * s) / 200 - c[0], y = pa[1] + ((pb[1] - pa[1]) * s) / 200 - c[1];
      q = Math.min(q, Math.sqrt(Math.max(0, (C * x * x - 2 * B * x * y + A * y * y) / det)));
    }
  }
  return q;
}

/** How far (view depth) a body-space point is hidden behind the solid's occluders at its place in the picture (≤ 0: in front). */
export function hiddenBy(rig: Rig, frame: Rig3dFrame, solid: string, p: V3): number {
  const part = rig.parts[rig.partIndex.get(solid)!] as { bodies: SolidBody[] };
  const y = frame.yaw, pt = frame.pitch;
  const X = p[0] * Math.cos(y) + p[2] * Math.sin(y), Z = -p[0] * Math.sin(y) + p[2] * Math.cos(y);
  const v: V3 = [X + frame.off[0], p[1] * Math.cos(pt) + Z * Math.sin(pt) + frame.off[1], -p[1] * Math.sin(pt) + Z * Math.cos(pt)];
  return occluderDepthAt(part.bodies, rig.rig3d as CompiledRig3d, frame, v[0], v[1]) - v[2];
}

/** The 2D joint of a bone (character space). */
export const joint2d = (pose: EvaluatedPose, rig: Rig, id: string): [number, number] => {
  const w = pose.world[rig.boneIndex.get(id)!];
  return [w[4], w[5]];
};
/** The 2D tip of a bone (character space). */
export const tip2d = (pose: EvaluatedPose, rig: Rig, id: string): [number, number] => {
  const i = rig.boneIndex.get(id)!;
  return apply(pose.world[i], [rig.bones[i].length, 0]) as [number, number];
};

export const GESTURES = ["facepalm", "think", "cry", "phone", "drink"] as const;
export const GESTURE_VIEWS = ["profile", "half", "front", "back"] as const;
export const GESTURE_FRACTIONS = [0, 0.13, 0.27, 0.4, 0.5, 0.63, 0.77, 0.9] as const;

/** The hands of the face-touching gestures: each hand's 2D joint, per clip, view and time. */
export function gestureHands(rig: Rig): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  for (const clip of GESTURES)
    for (const view of GESTURE_VIEWS)
      for (const f of GESTURE_FRACTIONS) {
        const t = f * rig.clips[clip].duration;
        const pose = poseOf(rig, view, {}, clip, t);
        for (const hand of ["handF", "handB"]) out[`${clip}/${view}/${f}/${hand}`] = joint2d(pose, rig, hand).map((v) => Math.round(v * 1000) / 1000) as [number, number];
      }
  return out;
}

/**
 * A hash of the 3D bones' world matrices (the body, the head, the limbs: what the 2.5D pass poses)
 * over a walk cycle (24 fps) in four views. (Not the face's own bones: the kit's face may change.)
 */
export function walkHash(rig: Rig): string {
  const rows: string[] = [];
  const bones = rig.rig3d!.bones.map((b) => b.index);
  for (const view of ["profile", "front", "side", "back"])
    for (let f = 0; f < 16; f++) {
      const pose = poseOf(rig, view, {}, "walk", f / 24);
      rows.push(bones.map((i) => pose.world[i].map((v) => v.toFixed(3)).join(",")).join(";"));
    }
  return `${hashString(rows.join("|")).toString(16)}:${rows.length}`;
}

export { compileRig };
