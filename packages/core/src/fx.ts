import { getEasing } from "./easing";
import { clamp, formatNumber as f, seededRandom } from "./math";

/**
 * Cartoon effects ("emanata"): procedural, deterministic SVG drawn around a character or at a
 * scene point. Each effect is a pure function of its normalized progress `u` (0..1) and local time.
 * Coordinates are in fx space: origin at the anchor, 1 unit ≈ 1 px of the character's setup space,
 * y down; the scene scales/flips it with the actor.
 */

export const FX_TYPES = [
  "surprise",
  "exclaim",
  "question",
  "sweat",
  "sparkle",
  "dust",
  "hearts",
  "zzz",
  "anger",
  "impact",
  "gloom",
  "notes",
  "stars",
  "lightbulb",
  "birds",
  // Anime effects.
  "focusLines",
  "speedLines",
  "impactFrame",
  "burst",
  "aura",
  "ghost",
  "caption",
] as const;

/** Effects drawn in screen space (fixed to the frame, never moved by the camera). */
export const SCREEN_FX: readonly FxType[] = ["focusLines", "speedLines", "impactFrame", "caption"];
/** Effects drawn just behind their actor. */
export const BEHIND_FX: readonly FxType[] = ["aura"];
/** Caption looks: a title card, a shouted impact word, a big K.O., a place name. */
export const CAPTION_STYLES = ["title", "impact", "ko", "place"] as const;

export type FxType = (typeof FX_TYPES)[number];

/** Default duration (s) of each effect. */
export const FX_DURATIONS: Record<FxType, number> = {
  surprise: 0.7,
  exclaim: 0.9,
  question: 1.2,
  sweat: 1.4,
  sparkle: 1.2,
  dust: 0.6,
  hearts: 1.6,
  zzz: 2.4,
  anger: 1.0,
  impact: 0.35,
  gloom: 1.8,
  notes: 2.0,
  stars: 1.6,
  lightbulb: 1.2,
  birds: 3.2,
  focusLines: 1.2,
  speedLines: 0.8,
  impactFrame: 0.14,
  burst: 0.35,
  aura: 3,
  ghost: 4,
  caption: 2,
};

export interface FxStyle {
  /** Line / ink color. */
  color: string;
  /** Secondary fill (sweat drop, hearts, sparkles…). */
  fill?: string;
  seed: number;
  /** caption: the text and its look. */
  text?: string;
  variant?: string;
  /** speedLines: direction of travel (degrees, 0 = to the right). */
  angle?: number;
  /** Screen size (screen-space effects). */
  width?: number;
  height?: number;
}

const backOut = getEasing("backOut");
const easeOut = getEasing("easeOut");
const sineInOut = getEasing("sineInOut");

/** Standard envelope: pop in over `inT`, fade out over the last `outT` of the effect (0..1). */
function envelope(u: number, inT = 0.18, outT = 0.3): { pop: number; alpha: number } {
  return {
    pop: backOut(clamp(u / inT, 0, 1)),
    alpha: clamp((1 - u) / outT, 0, 1),
  };
}

const line = (x1: number, y1: number, x2: number, y2: number, color: string, w: number) =>
  `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${color}" stroke-width="${f(w)}" stroke-linecap="round"/>`;

const g = (content: string, attrs: string) => `<g ${attrs}>${content}</g>`;

/** Four-point sparkle star. */
const star = (x: number, y: number, r: number, fill: string, stroke: string) =>
  `<path d="M${f(x)} ${f(y - r)} Q${f(x + r * 0.18)} ${f(y - r * 0.18)} ${f(x + r)} ${f(y)} Q${f(x + r * 0.18)} ${f(y + r * 0.18)} ${f(x)} ${f(y + r)} Q${f(x - r * 0.18)} ${f(y + r * 0.18)} ${f(x - r)} ${f(y)} Q${f(x - r * 0.18)} ${f(y - r * 0.18)} ${f(x)} ${f(y - r)} Z" fill="${fill}" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round"/>`;

const heart = (s: number, fill: string, stroke: string) =>
  `<path d="M0 ${f(s * 0.35)} C${f(-s)} ${f(-s * 0.35)} ${f(-s * 0.45)} ${f(-s * 1.05)} 0 ${f(-s * 0.45)} C${f(s * 0.45)} ${f(-s * 1.05)} ${f(s)} ${f(-s * 0.35)} 0 ${f(s * 0.35)} Z" fill="${fill}" stroke="${stroke}" stroke-width="3" stroke-linejoin="round"/>`;

/**
 * SVG markup of an effect at progress `u` (0..1), `t` seconds into the effect.
 * The anchor is the origin: head-type effects draw above it, `dust`/`impact` around it.
 */
export function fxMarkup(type: FxType, u: number, t: number, style: FxStyle): string {
  const c = style.color;
  const rnd = seededRandom(style.seed);
  const { pop, alpha } = envelope(u);
  switch (type) {
    case "surprise": {
      // Radiating strokes above the head, like the comic's "\ | /": shoot out, then fade.
      const out = easeOut(clamp(u / 0.35, 0, 1));
      const lines = [-42, -16, 12, 38]
        .map((deg, i) => {
          const a = ((deg - 90) * Math.PI) / 180;
          const r0 = 26 + out * 14 + i * 2;
          const r1 = r0 + 18 * pop;
          return line(Math.cos(a) * r0, Math.sin(a) * r0 - 20, Math.cos(a) * r1, Math.sin(a) * r1 - 20, c, 5);
        })
        .join("");
      return g(lines, `opacity="${f(alpha)}"`);
    }
    case "exclaim": {
      const s = pop;
      const wob = Math.sin(t * 28) * 6 * (1 - clamp(u / 0.4, 0, 1));
      return g(
        `<path d="M-7 -96 L7 -96 L4 -44 L-4 -44 Z" fill="${style.fill ?? "#E4473B"}" stroke="${c}" stroke-width="3.5" stroke-linejoin="round"/><circle cx="0" cy="-26" r="7" fill="${style.fill ?? "#E4473B"}" stroke="${c}" stroke-width="3.5"/>`,
        `transform="translate(0 -30) rotate(${f(wob)}) scale(${f(s)})" opacity="${f(alpha)}"`,
      );
    }
    case "question": {
      const bob = Math.sin(t * 5) * 4;
      const tilt = Math.sin(t * 3.4) * 8;
      return g(
        `<path d="M-14 -88 C-14 -110 16 -112 18 -92 C20 -76 2 -72 2 -56" fill="none" stroke="${c}" stroke-width="8" stroke-linecap="round"/><circle cx="2" cy="-38" r="5.5" fill="${c}"/>`,
        `transform="translate(0 ${f(-30 + bob)}) rotate(${f(tilt)}) scale(${f(pop)})" opacity="${f(alpha)}"`,
      );
    }
    case "sweat": {
      // A drop appears at the back of the head and slides down.
      const slide = sineInOut(clamp((u - 0.15) / 0.7, 0, 1)) * 34;
      const fill = style.fill ?? "#9FD3F5";
      return g(
        `<path d="M0 -18 C8 -6 12 2 12 8 C12 16 6 20 0 20 C-6 20 -12 16 -12 8 C-12 2 -8 -6 0 -18 Z" fill="${fill}" stroke="${c}" stroke-width="3" stroke-linejoin="round"/><path d="M-5 6 C-5 2 -3 -1 -1 -4" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round"/>`,
        `transform="translate(-34 ${f(-40 + slide)}) scale(${f(pop * 0.9)})" opacity="${f(alpha)}"`,
      );
    }
    case "sparkle": {
      const fill = style.fill ?? "#FFE27A";
      const stars = Array.from({ length: 4 }, (_, i) => {
        const x = (rnd() - 0.5) * 120;
        const y = -40 - rnd() * 90;
        const phase = rnd();
        const tw = Math.max(0, Math.sin((u * 2.2 + phase) * Math.PI));
        return star(x, y, 9 + 9 * tw * pop, fill, c);
      }).join("");
      return g(stars, `opacity="${f(alpha)}"`);
    }
    case "dust": {
      // Puffs expanding sideways from the feet.
      const k = easeOut(u);
      const puffs = [-1, 1]
        .flatMap((side) =>
          [0, 1, 2].map((i) => {
            const x = side * (14 + k * (30 + i * 18));
            const y = -6 - i * 5 - k * 6;
            const r = (7 + i * 2) * (0.6 + k * 0.8);
            return `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${style.fill ?? "#F1E6D2"}" stroke="${c}" stroke-width="2.5"/>`;
          }),
        )
        .join("");
      return g(puffs, `opacity="${f(clamp((1 - u) / 0.5, 0, 1))}"`);
    }
    case "hearts": {
      const fill = style.fill ?? "#F06292";
      return Array.from({ length: 3 }, (_, i) => {
        const delay = i * 0.18;
        const v = clamp((u - delay) / (1 - delay), 0, 1);
        if (v <= 0) return "";
        const x = (i - 1) * 28 + Math.sin(t * 4 + i) * 6;
        const y = -50 - v * 70;
        const s = 10 * backOut(clamp(v / 0.25, 0, 1));
        return g(heart(s, fill, c), `transform="translate(${f(x)} ${f(y)})" opacity="${f(clamp((1 - v) / 0.35, 0, 1))}"`);
      }).join("");
    }
    case "zzz": {
      return [0, 1, 2]
        .map((i) => {
          const v = (u * 1.6 + i / 3) % 1;
          const x = 20 + v * 40 + i * 4;
          const y = -60 - v * 70;
          const s = 10 + i * 4;
          return g(
            `<path d="M0 0 H${s} L0 ${s} H${s}" fill="none" stroke="${c}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`,
            `transform="translate(${f(x)} ${f(y)})" opacity="${f(Math.sin(v * Math.PI) * alpha)}"`,
          );
        })
        .join("");
    }
    case "anger": {
      const pulse = 1 + Math.sin(t * 18) * 0.12;
      const fill = style.fill ?? "#E53935";
      const vein = [0, 90, 180, 270]
        .map((r) => `<path d="M4 -4 Q12 -6 16 -16" transform="rotate(${r})" fill="none" stroke="${fill}" stroke-width="6" stroke-linecap="round"/>`)
        .join("");
      return g(vein, `transform="translate(38 -70) scale(${f(pop * pulse)})" opacity="${f(alpha)}"`);
    }
    case "impact": {
      const k = easeOut(u);
      const rays = Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2 + rnd() * 0.2;
        const r0 = 18 + k * 30;
        const r1 = r0 + 26 * (1 - k * 0.6);
        return line(Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a) * r1, Math.sin(a) * r1, c, 5);
      }).join("");
      return g(rays, `opacity="${f(clamp((1 - u) / 0.6, 0, 1))}"`);
    }
    case "notes": {
      // Music notes drifting up and swaying (singing, humming).
      const fills = [style.fill ?? "#F06292", "#4FC3F7", "#FFB300", "#7C4DFF"];
      return Array.from({ length: 4 }, (_, i) => {
        const v = (u * 1.3 + i / 4) % 1;
        const x = (i - 1.5) * 26 + Math.sin(t * 3 + i * 1.7) * 10;
        const y = -50 - v * 90;
        const s = 0.8 + (i % 2) * 0.25;
        const head = `<ellipse cx="0" cy="0" rx="8" ry="6" transform="rotate(-20)" fill="${fills[i]}" stroke="${c}" stroke-width="2.5"/>`;
        const stem = `<path d="M7 -2 V-30 ${i % 2 ? "Q16 -24 18 -14" : "L22 -34 V-8"}" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
        const second = i % 2 ? "" : `<ellipse cx="15" cy="-6" rx="8" ry="6" transform="rotate(-20 15 -6)" fill="${fills[i]}" stroke="${c}" stroke-width="2.5"/>`;
        return g(head + second + stem, `transform="translate(${f(x)} ${f(y)}) scale(${f(s * pop)})" opacity="${f(Math.sin(v * Math.PI) * alpha)}"`);
      }).join("");
    }
    case "stars": {
      // Little stars circling above the head (dizzy, starstruck).
      const fill = style.fill ?? "#FFE27A";
      return g(
        [0, 1, 2]
          .map((i) => {
            const a = t * 4 + (i * Math.PI * 2) / 3;
            const x = Math.cos(a) * 34;
            const y = -70 + Math.sin(a) * 9;
            const five = Array.from({ length: 10 }, (_, k) => {
              const r = k % 2 ? 4.5 : 11;
              const b = (k * Math.PI) / 5 - Math.PI / 2;
              return `${f(x + Math.cos(b) * r)} ${f(y + Math.sin(b) * r)}`;
            }).join(" L");
            return `<path d="M${five} Z" fill="${fill}" stroke="${c}" stroke-width="2.5" stroke-linejoin="round" opacity="${f(0.6 + 0.4 * Math.sin(a))}"/>`;
          })
          .join(""),
        `transform="scale(${f(pop)})" opacity="${f(alpha)}"`,
      );
    }
    case "lightbulb": {
      // A bulb pops up above the head and glows (an idea).
      const glow = 0.5 + 0.5 * Math.sin(t * 10);
      const fill = style.fill ?? "#FFE14D";
      const rays = [-60, -30, 0, 30, 60]
        .map((deg) => {
          const a = ((deg - 90) * Math.PI) / 180;
          return line(Math.cos(a) * 30, Math.sin(a) * 30 - 26, Math.cos(a) * (40 + glow * 6), Math.sin(a) * (40 + glow * 6) - 26, c, 4);
        })
        .join("");
      return g(
        `<circle cx="0" cy="-26" r="${f(30 + glow * 4)}" fill="${fill}" opacity="0.35"/>` +
          `<path d="M-18 -30 C-18 -54 18 -54 18 -30 C18 -18 8 -14 8 -4 H-8 C-8 -14 -18 -18 -18 -30 Z" fill="${fill}" stroke="${c}" stroke-width="3.5" stroke-linejoin="round"/>` +
          `<rect x="-9" y="-4" width="18" height="12" rx="3" fill="#B8B8C0" stroke="${c}" stroke-width="3"/>` +
          rays,
        `transform="translate(0 -40) scale(${f(pop)})" opacity="${f(alpha)}"`,
      );
    }
    case "birds": {
      // A few little birds crossing the sky (left → right) with flapping wings; around the origin.
      const fill = style.fill ?? "#ff8a3d";
      return Array.from({ length: 3 }, (_, i) => {
        const delay = i * 0.12;
        const v = clamp((u - delay) / (1 - delay), 0, 1);
        if (v <= 0 || v >= 1) return "";
        const x = -320 + v * 640 + (i - 1) * 40;
        const y = -40 * i + Math.sin(v * Math.PI * 2 + i) * 18;
        const flapUp = Math.sin(t * 22 + i * 2) > 0;
        const wing = flapUp ? "M-2 -2 C4 -16 16 -18 20 -10 C12 -8 6 -4 -2 -2 Z" : "M-2 0 C4 12 14 14 18 8 C10 6 6 2 -2 0 Z";
        const body =
          `<ellipse cx="0" cy="0" rx="13" ry="9" fill="${fill}" stroke="${c}" stroke-width="2.5"/>` +
          `<circle cx="10" cy="-6" r="7" fill="${fill}" stroke="${c}" stroke-width="2.5"/><circle cx="12.5" cy="-7.5" r="1.8" fill="${c}"/>` +
          `<path d="M16 -7 L23 -5 L16 -3 Z" fill="#ffd23f" stroke="${c}" stroke-width="1.8" stroke-linejoin="round"/>` +
          `<path d="${wing}" fill="${fill}" stroke="${c}" stroke-width="2.2" stroke-linejoin="round"/>`;
        return g(body, `transform="translate(${f(x)} ${f(y - 120)}) scale(${f(1 - i * 0.12)})" opacity="${f(clamp(Math.min(v, 1 - v) / 0.08, 0, 1))}"`);
      }).join("");
    }
    case "focusLines": {
      // Anime focus lines: wedges converging on the centre, a new pattern every two frames.
      const k = Math.floor(t / 0.066);
      const rr = seededRandom(style.seed + k * 7919);
      const R = Math.hypot(style.width ?? 1920, style.height ?? 1080) * 0.6;
      const inner = Math.min(style.width ?? 1920, style.height ?? 1080) * 0.36;
      const wedges = Array.from({ length: 64 }, (_, i) => {
        const a = (i / 64) * Math.PI * 2 + rr() * 0.07;
        const r0 = inner + rr() * inner * 0.45;
        const w = (3 + rr() * 10) * 6;
        const [cs, sn] = [Math.cos(a), Math.sin(a)];
        return `<path d="M${f(cs * r0)} ${f(sn * r0)} L${f(cs * R - sn * w)} ${f(sn * R + cs * w)} L${f(cs * R + sn * w)} ${f(sn * R - cs * w)} Z" fill="${c}"/>`;
      }).join("");
      return g(wedges, `opacity="${f(clamp(u / 0.06, 0, 1) * clamp((1 - u) / 0.15, 0, 1) * 0.7)}"`);
    }
    case "speedLines": {
      // Streaks across the frame in the direction of travel, re-drawn every frame and a half.
      const k = Math.floor(t / 0.05);
      const rr = seededRandom(style.seed + k * 104729);
      const W = style.width ?? 1920, H = style.height ?? 1080;
      const streaks = Array.from({ length: 36 }, () => {
        const y = (rr() - 0.5) * H, x = (rr() - 0.7) * W, l = W * (0.15 + rr() * 0.4);
        return `<path d="M${f(x)} ${f(y)} h${f(l)}" stroke="${style.fill ?? "#ffffff"}" stroke-width="${f(2 + rr() * 7)}" stroke-linecap="round"/>`;
      }).join("");
      return g(streaks, `transform="rotate(${f(style.angle ?? 0)})" opacity="${f(clamp(u / 0.08, 0, 1) * clamp((1 - u) / 0.2, 0, 1) * 0.85)}"`);
    }
    case "impactFrame": {
      // The flash of a hit: a frame or two of white, then of black.
      const W = style.width ?? 1920, H = style.height ?? 1080;
      return `<rect x="${f(-W / 2)}" y="${f(-H / 2)}" width="${W}" height="${H}" fill="${u < 0.5 ? (style.fill ?? "#ffffff") : c}"/>`;
    }
    case "burst": {
      // An anime hit: a jagged star (yellow, red heart, white core) that grows and flickers.
      const k = Math.floor(t / 0.05);
      const rr = seededRandom(style.seed + k * 31);
      const s = 0.5 + easeOut(clamp(u / 0.4, 0, 1)) * 1.1;
      const pts = Array.from({ length: 22 }, (_, i) => {
        const a = (i / 22) * Math.PI * 2, rad = i % 2 ? 60 + rr() * 30 : 150 + rr() * 120;
        return [Math.cos(a) * rad, Math.sin(a) * rad];
      });
      const d = (k2: number) => `M${pts.map(([x, y]) => `${f(x * k2)} ${f(y * k2)}`).join(" L")} Z`;
      return g(
        `<path d="${d(1)}" fill="${style.fill ?? "#ffe14a"}" stroke="${c}" stroke-width="6" stroke-linejoin="round"/><path d="${d(0.55)}" fill="#ff3b4e" opacity="0.75"/><circle r="56" fill="#ffffff"/>`,
        `transform="scale(${f(s)})" opacity="${f(clamp((1 - u) / 0.3, 0, 1))}"`,
      );
    }
    case "aura": {
      // Battle aura behind a standing character: three layers of flames, flickering.
      const k = Math.floor(t / 0.05);
      const flame = (k2: number, color: string, salt: number) => {
        const rr = seededRandom(style.seed + k * 13 + salt);
        const pts = Array.from({ length: 14 }, (_, i) => {
          const a = Math.PI + (i / 13) * Math.PI;
          const rx = 150 * k2, ry = 330 * k2 + rr() * 120 * k2;
          const tip = i % 2 ? 1 : 0.82 + rr() * 0.2;
          return `${f(Math.cos(a) * rx * tip)} ${f(-200 + Math.sin(a) * ry * tip)}`;
        });
        return `<path d="M${f(-150 * k2)} 0 L${pts.join(" L")} L${f(150 * k2)} 0 Z" fill="${color}"/>`;
      };
      const base = style.fill ?? "#ff3b4e";
      return g(flame(1, base, 1) + flame(0.78, "#ffb347", 2) + flame(0.5, "#fff3c8", 3), `opacity="${f(clamp(u / 0.08, 0, 1) * clamp((1 - u) / 0.1, 0, 1) * 0.85)}"`);
    }
    case "ghost": {
      // The comic soul leaving the body: a little ghost with a halo, floating up and swaying.
      const rise = sineInOut(clamp(u, 0, 1)) * 480;
      const sway = Math.sin(t * 5) * 10;
      return g(
        `<path d="M-50 40 C-60 -40 -40 -110 0 -110 C40 -110 60 -40 50 40 L34 22 L18 44 L0 22 L-18 44 L-34 22 Z" fill="#f4f7ff" fill-opacity="0.92" stroke="${c}" stroke-width="4" stroke-linejoin="round"/>` +
          `<path d="M-24 -60 l14 14 M-10 -60 l-14 14 M12 -60 l14 14 M26 -60 l-14 14" stroke="${c}" stroke-width="4" stroke-linecap="round"/><ellipse cx="0" cy="-26" rx="8" ry="6" fill="${c}"/>` +
          `<ellipse cx="0" cy="-150" rx="40" ry="10" fill="none" stroke="${style.fill ?? "#ffd23f"}" stroke-width="7"/>`,
        `transform="translate(${f(sway)} ${f(-60 - rise)}) rotate(${f(sway * 0.6)})" opacity="${f(clamp(u / 0.1, 0, 1) * 0.95)}"`,
      );
    }
    case "caption": {
      // Screen text: a title card, a shouted impact word, a big K.O., a place name.
      const text = (style.text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
      const v = style.variant ?? "title";
      const fade = clamp((1 - u) / 0.12, 0, 1);
      if (v === "place") {
        const slide = easeOut(clamp(u / 0.12, 0, 1));
        const w = text.length * 28 + 70;
        return g(
          `<rect x="0" y="-44" width="${w}" height="72" fill="#0a0414" fill-opacity="0.7"/><rect x="0" y="-44" width="8" height="72" fill="${style.fill ?? "#e8414f"}"/>` +
            `<text x="34" y="8" font-family="Georgia, serif" font-style="italic" font-size="52" fill="#ffffff">${text}</text>`,
          `transform="translate(${f((slide - 1) * 600)} 0)" opacity="${f(fade)}"`,
        );
      }
      const look = { title: { size: 150, fill: "#ffd23f", line: "#1d1a2b", rot: -5 }, impact: { size: 140, fill: "#ff2a3c", line: "#ffffff", rot: -3 }, ko: { size: 230, fill: "#ffd23f", line: "#c0122a", rot: -8 } }[v as "title" | "impact" | "ko"] ?? { size: 150, fill: "#ffd23f", line: "#1d1a2b", rot: -5 };
      const pop = backOut(clamp(u / 0.15, 0, 1));
      const jit = v === "impact" ? Math.sin(t * 69) * 6 : 0;
      return g(
        `<text x="0" y="${f(look.size * 0.35)}" font-family="'Arial Black', Impact, sans-serif" font-weight="900" font-size="${look.size}" text-anchor="middle" fill="${style.fill ?? look.fill}" stroke="${c === "#1D2833" ? look.line : c}" stroke-width="${f(look.size * 0.12)}" stroke-linejoin="round" paint-order="stroke" letter-spacing="4">${text}</text>`,
        `transform="translate(${f(jit)} ${f(-jit / 2)}) rotate(${look.rot}) scale(${f(pop)})" opacity="${f(fade)}"`,
      );
    }
    case "gloom": {
      // Wavy vertical lines hanging above the head.
      const drop = easeOut(clamp(u / 0.3, 0, 1));
      return g(
        [-30, -10, 10, 30]
          .map((x, i) => {
            const len = 30 + (i % 2) * 12;
            const w = Math.sin(t * 3 + i) * 3;
            const y0 = -96 + (1 - drop) * -20;
            return `<path d="M${x} ${f(y0)} q${f(4 + w)} ${f(len / 4)} 0 ${f(len / 2)} q${f(-4 - w)} ${f(len / 4)} 0 ${f(len / 2)}" fill="none" stroke="${c}" stroke-width="3.5" stroke-linecap="round" opacity="0.8"/>`;
          })
          .join(""),
        `opacity="${f(alpha)}"`,
      );
    }
  }
}
