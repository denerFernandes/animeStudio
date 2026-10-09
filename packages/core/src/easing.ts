export type EasingName =
  | "linear"
  | "step"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  | "sineIn"
  | "sineOut"
  | "sineInOut"
  | "backIn"
  | "backOut"
  | "backInOut"
  | "elasticOut"
  | "bounceOut";

/** An easing name or CSS-style cubic-bezier control points `[x1, y1, x2, y2]`. */
export type Ease = EasingName | [number, number, number, number];

export const EASING_NAMES: EasingName[] = [
  "linear",
  "step",
  "easeIn",
  "easeOut",
  "easeInOut",
  "sineIn",
  "sineOut",
  "sineInOut",
  "backIn",
  "backOut",
  "backInOut",
  "elasticOut",
  "bounceOut",
];

const BACK = 1.70158;

function bounceOut(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

const named: Record<EasingName, (t: number) => number> = {
  linear: (t) => t,
  step: (t) => (t >= 1 ? 1 : 0),
  easeIn: (t) => t * t * t,
  easeOut: (t) => 1 - Math.pow(1 - t, 3),
  easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  sineIn: (t) => 1 - Math.cos((t * Math.PI) / 2),
  sineOut: (t) => Math.sin((t * Math.PI) / 2),
  sineInOut: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  backIn: (t) => (BACK + 1) * t * t * t - BACK * t * t,
  backOut: (t) => 1 + (BACK + 1) * Math.pow(t - 1, 3) + BACK * Math.pow(t - 1, 2),
  backInOut: (t) => {
    const c2 = BACK * 1.525;
    return t < 0.5
      ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
      : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
  },
  elasticOut: (t) => {
    if (t === 0 || t === 1) return t;
    const c4 = (2 * Math.PI) / 3;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  bounceOut,
};

/** Solves a CSS cubic-bezier timing function (Newton-Raphson with bisection fallback). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-6) return sy(t);
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 30; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}

const bezierCache = new Map<string, (t: number) => number>();

export function getEasing(ease: Ease | undefined): (t: number) => number {
  if (ease === undefined) return named.linear;
  if (typeof ease === "string") return named[ease] ?? named.linear;
  const key = ease.join(",");
  let fn = bezierCache.get(key);
  if (!fn) {
    fn = cubicBezier(ease[0], ease[1], ease[2], ease[3]);
    bezierCache.set(key, fn);
  }
  return fn;
}
