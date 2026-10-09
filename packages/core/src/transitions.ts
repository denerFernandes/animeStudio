import { getEasing } from "./easing";
import { type Vec2, clamp, formatNumber as f } from "./math";

/**
 * Screen transitions drawn over a frame: fade (to a color), iris (classic cartoon circle), wipe
 * and flash. `coverage` is 0 (clear) … 1 (fully covered).
 */
export type TransitionType = "fade" | "iris" | "wipe" | "flash";
export type TransitionMode = "out" | "in" | "outIn";
export type WipeDirection = "left" | "right" | "up" | "down";

/** Coverage (0..1) of a transition at normalized progress u. */
export function transitionCoverage(mode: TransitionMode, u: number): number {
  const ease = getEasing("sineInOut");
  const v = clamp(u, 0, 1);
  if (mode === "out") return ease(v);
  if (mode === "in") return ease(1 - v);
  return ease(v < 0.5 ? v * 2 : (1 - v) * 2);
}

export interface TransitionParams {
  type: TransitionType;
  coverage: number;
  /** For wipes: true while uncovering (the cover keeps travelling in the same direction). */
  uncovering?: boolean;
  color: string;
  direction: WipeDirection;
  /** Iris center in screen space. */
  center: Vec2;
  width: number;
  height: number;
  /** Unique id suffix for masks. */
  id: string;
}

export function transitionMarkup(p: TransitionParams): string {
  const { width: W, height: H, coverage: c } = p;
  if (c <= 0.001) return "";
  switch (p.type) {
    case "fade":
      return `<rect width="${W}" height="${H}" fill="${p.color}" opacity="${f(c)}"/>`;
    case "flash":
      return `<rect width="${W}" height="${H}" fill="${p.color}" opacity="${f(c)}" style="mix-blend-mode:screen"/>`;
    case "iris": {
      const far = Math.max(
        ...[
          [0, 0],
          [W, 0],
          [0, H],
          [W, H],
        ].map(([x, y]) => Math.hypot(x - p.center[0], y - p.center[1])),
      );
      const r = Math.max(0, (1 - c) * far);
      return (
        `<mask id="iris-${p.id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/><circle cx="${f(p.center[0])}" cy="${f(p.center[1])}" r="${f(r)}" fill="#000"/></mask>` +
        `<rect width="${W}" height="${H}" fill="${p.color}" mask="url(#iris-${p.id})"/>`
      );
    }
    case "wipe": {
      const horizontal = p.direction === "left" || p.direction === "right";
      const size = horizontal ? W : H;
      const len = c * size;
      // Covering grows from the leading edge; uncovering keeps moving the same way.
      const forward = p.direction === "right" || p.direction === "down";
      let start: number;
      if (!p.uncovering) start = forward ? 0 : size - len;
      else start = forward ? size - len : 0;
      return horizontal
        ? `<rect x="${f(start)}" y="0" width="${f(len)}" height="${H}" fill="${p.color}"/>`
        : `<rect x="0" y="${f(start)}" width="${W}" height="${f(len)}" fill="${p.color}"/>`;
    }
  }
}
