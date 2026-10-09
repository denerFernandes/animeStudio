import type { ToonDoc } from "@animestudio/core";
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
  /** How far the drawing reaches in front of / behind the feet (snout, beak, cap, shell…). */
  extent: { front: number; back: number };
  /** Height of the top of the head (positive, px). */
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

export function rigInfo(doc: ToonDoc, o: { extent: { front: number; back: number }; height: number; depth?: number | { back: number; front: number } }): RigInfo {
  const bones = new Map((doc.skeleton as Bone[]).map((b) => [b.id, b]));
  const from = (id: string): P => {
    const b = bones.get(id);
    if (!b?.from) throw new Error(`${doc.name}: bone "${id}" needs a setup-form "from"`);
    return b.from;
  };
  const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const move = ((doc.meta as { views?: { move?: Record<string, Record<string, P>> } } | undefined)?.views?.move?.back ?? {}) as Record<string, P>;
  return {
    hand: { F: from("handF"), B: from("handB") },
    shoulder: { F: from("armF1"), B: from("armB1") },
    armLength: {
      F: dist(from("armF1"), from("armF2")) + dist(from("armF2"), from("handF")),
      B: dist(from("armB1"), from("armB2")) + dist(from("armB2"), from("handB")),
    },
    backShoulder: { F: move.armF1 ?? [0, 0], B: move.armB1 ?? [0, 0] },
    extent: o.extent,
    height: o.height,
    ...(o.depth !== undefined ? { depth: typeof o.depth === "number" ? { back: o.depth, front: o.depth } : o.depth } : {}),
    hip: [(from("legF1")[0] + from("legB1")[0]) / 2, (from("legF1")[1] + from("legB1")[1]) / 2],
    legLength: {
      F: dist(from("legF1"), from("legF2")) + dist(from("legF2"), from("footF")),
      B: dist(from("legB1"), from("legB2")) + dist(from("legB2"), from("footB")),
    },
  };
}
