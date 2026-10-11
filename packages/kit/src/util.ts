/**
 * Helpers shared by the kit's builders (colours, bone directions). Internal: not exported by the
 * package.
 */
import type { P } from "./rig";

type Bone = { id: string; from?: P; to?: P; parent?: string };

const r = (n: number) => Math.round(n * 100) / 100;

/** A short hex colour (`#abc`) written out (`#aabbcc`); anything else is returned as is. */
export const longHex = (hex: string) => (/^#[0-9a-f]{3}$/i.test(hex) ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex);

/** A hex colour multiplied by `k` (darker below 1, lighter above), each channel clamped. */
export const shade = (hex: string, k: number) => {
  const n = parseInt(longHex(hex).slice(1), 16);
  const c = (s: number) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * k)));
  return `#${((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, "0")}`;
};

/** Blends two hex colours (`t` = 0: `a`, 1: `b`). */
export const mix = (a: string, b: string, t: number) => {
  const pa = parseInt(longHex(a).slice(1), 16), pb = parseInt(longHex(b).slice(1), 16);
  const c = [16, 8, 0].map((sh) => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t));
  return `#${((c[0] << 16) | (c[1] << 8) | c[2]).toString(16).padStart(6, "0")}`;
};

/** Setup-space direction of a bone's rest form (`from` → `to`), in radians; 0 for a bone without one. */
export function restAngle(skeleton: Bone[], id: string): number {
  const b = skeleton.find((x) => x.id === id);
  if (!b?.from || !b.to) return 0;
  return Math.atan2(b.to[1] - b.from[1], b.to[0] - b.from[0]);
}

/**
 * The `forward` of an aim target (degrees): the core aims `matAngle(bone) + forward` at the target,
 * so forward is the facing direction less the bone's rest direction. `facing` is where the drawing
 * looks in setup space (default 0: along +x, a profile facing right).
 */
export const aimForward = (skeleton: Bone[], bone: string, facing = 0) => r(facing - (restAngle(skeleton, bone) * 180) / Math.PI);
