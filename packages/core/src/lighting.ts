import type { LightDef, LightingDef, Value } from "./format/schema";
import { type Track, sampleTrack } from "./keyframes";
import { type Mat, type Vec2, apply, formatNumber as f } from "./math";
import { namespaceIds } from "./rig";

/**
 * Scene lighting rendered with plain SVG (works in browsers and Remotion):
 * - point lights: additive radial glow (`mix-blend-mode: screen`) that also cuts through the
 *   ambient darkness;
 * - ambient: a multiply layer over the whole frame, masked away around point lights;
 * - character cel shading: the actor's silhouette (a copy of its art + filters) minus a copy
 *   shifted towards the key light gives a shadow crescent on the far side; the opposite gives a
 *   rim light;
 * - grade and vignette: full-frame overlays.
 * Every property is animatable through `lights.<id>.<prop>` and `lighting.<section>.<prop>` channels.
 */

export interface LightState {
  id: string;
  type: "point" | "directional";
  x: number;
  y: number;
  angle: number;
  color: string;
  intensity: number;
  radius: number;
  glow: number;
  parallax: number;
}

export interface LightingState {
  ambient: { color: string; opacity: number };
  lights: LightState[];
  shading: { light?: string; color: string; opacity: number; rim: string; rimOpacity: number; offset: number; inset: number };
  grade: { color: string; opacity: number; blend: string };
  vignette: { color: string; opacity: number };
}

const LIGHT_PROPS = ["x", "y", "angle", "color", "intensity", "radius", "glow"] as const;
const SECTION_PROPS: Record<string, string[]> = {
  ambient: ["color", "opacity"],
  shading: ["color", "opacity", "rim", "rimOpacity", "offset", "inset"],
  grade: ["color", "opacity"],
  vignette: ["color", "opacity"],
};

function lightDefaults(l: LightDef): LightState {
  return {
    id: l.id,
    type: l.type,
    x: l.x ?? 0,
    y: l.y ?? 0,
    angle: l.angle ?? 90,
    color: l.color ?? "#FFE6B0",
    intensity: l.intensity ?? 1,
    radius: l.radius ?? 600,
    glow: l.glow ?? (l.type === "point" ? 0.6 : 0),
    parallax: l.parallax ?? 1,
  };
}

/** Lighting state from the document alone (no animation). */
export function baseLighting(def: LightingDef): LightingState {
  return {
    ambient: { color: def.ambient?.color ?? "#241A4D", opacity: def.ambient?.opacity ?? 0 },
    lights: (def.lights ?? []).map(lightDefaults),
    shading: {
      light: def.shading?.light,
      color: def.shading?.color ?? "#2A2152",
      opacity: def.shading?.opacity ?? (def.shading ? 0.28 : 0),
      rim: def.shading?.rim ?? "#FFF1C9",
      rimOpacity: def.shading?.rimOpacity ?? (def.shading ? 0.45 : 0),
      offset: def.shading?.offset ?? 9,
      inset: def.shading?.inset ?? 3.5,
    },
    grade: { color: def.grade?.color ?? "#FFFFFF", opacity: def.grade?.opacity ?? 0, blend: def.grade?.blend ?? "soft-light" },
    vignette: { color: def.vignette?.color ?? "#000000", opacity: def.vignette?.opacity ?? 0 },
  };
}

/** Validates a lighting channel and returns its rest value. Throws a readable error. */
export function lightingChannelDefault(def: LightingDef, channel: string): Value {
  const base = baseLighting(def);
  const seg = channel.split(".");
  if (seg[0] === "lights" && seg.length === 3) {
    const l = base.lights.find((x) => x.id === seg[1]);
    if (!l) throw new Error(`unknown light "${seg[1]}". Known lights: ${base.lights.map((x) => x.id).join(", ") || "none"}.`);
    if (!(LIGHT_PROPS as readonly string[]).includes(seg[2])) throw new Error(`expected lights.<id>.(${LIGHT_PROPS.join("|")})`);
    return l[seg[2] as (typeof LIGHT_PROPS)[number]];
  }
  if (seg[0] === "lighting" && seg.length === 3 && SECTION_PROPS[seg[1]]?.includes(seg[2])) {
    return (base as unknown as Record<string, Record<string, Value>>)[seg[1]][seg[2]];
  }
  throw new Error(
    `unknown lighting channel "${channel}". Use lights.<id>.(${LIGHT_PROPS.join("|")}) or ` +
      Object.entries(SECTION_PROPS)
        .map(([k, v]) => `lighting.${k}.(${v.join("|")})`)
        .join(", "),
  );
}

/** Lighting state at time t. */
export function lightingAt(def: LightingDef, tracks: Record<string, Track>, t: number): LightingState {
  const s = baseLighting(def);
  for (const [channel, track] of Object.entries(tracks)) {
    const v = sampleTrack(track, t);
    if (v === undefined) continue;
    const seg = channel.split(".");
    if (seg[0] === "lights") {
      const l = s.lights.find((x) => x.id === seg[1]);
      if (l) (l as unknown as Record<string, Value>)[seg[2]] = v;
    } else (s as unknown as Record<string, Record<string, Value>>)[seg[1]][seg[2]] = v;
  }
  return s;
}

// ---------------------------------------------------------------------------
// SVG generation
// ---------------------------------------------------------------------------

/** Static filters used by character shading (added to the frame defs once). */
export const LIGHTING_DEFS =
  `<filter id="toon-white" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1 0"/></filter>` +
  `<filter id="toon-black" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0"/></filter>`;

const esc = (s: string) => s.replace(/"/g, "&quot;");

export interface ScreenLight extends LightState {
  /** Screen position (point lights). */
  sx: number;
  sy: number;
  /** Screen radius. */
  sr: number;
}

/** Key light used for character shading. */
export function keyLight(state: LightingState, lights: ScreenLight[]): ScreenLight | undefined {
  return lights.find((l) => l.id === state.shading.light) ?? lights[0];
}

/**
 * Shadow + rim crescents for one actor. `artMarkup` is the actor's rendered SVG (screen space);
 * masks embed their own copy instead of `<use>`-referencing the visible actor, because browsers
 * mis-paint `<use>` references to elements inside filtered groups (elements later in the frame
 * vanished). `center` is the actor's on-screen center; `scale` its on-screen scale.
 */
export function shadingMarkup(
  state: LightingState,
  key: ScreenLight | undefined,
  actorId: string,
  artMarkup: string,
  center: Vec2,
  scale: number,
  width: number,
  height: number,
): string {
  const sh = state.shading;
  if (!key || (sh.opacity <= 0 && sh.rimOpacity <= 0) || key.intensity <= 0) return "";
  let dir: Vec2;
  let strength = key.intensity;
  if (key.type === "directional") {
    const a = (key.angle * Math.PI) / 180;
    dir = [-Math.cos(a), -Math.sin(a)]; // towards the light
  } else {
    const dx = key.sx - center[0];
    const dy = key.sy - center[1];
    const d = Math.hypot(dx, dy) || 1;
    dir = [dx / d, dy / d];
    strength *= Math.max(0, Math.min(1, 1.3 - d / Math.max(1, key.sr)));
  }
  if (strength <= 0) return "";
  // Crescent widths are measured from the eroded edge: shift = inset + size.
  const off = (sh.inset + sh.offset) * scale;
  const box = `maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"`;
  // Each copy gets its own id namespace: duplicated ids (e.g. clip paths inside the art) make
  // references ambiguous, and rebuilding the duplicates every frame broke painting in Chrome.
  let copies = 0;
  const use = (filter: string, dx = 0, dy = 0) =>
    `<g filter="url(#${filter})"${dx || dy ? ` transform="translate(${f(dx)} ${f(dy)})"` : ""}>${namespaceIds(artMarkup, `shade${copies++}-${actorId}`)}</g>`;
  // White silhouette eroded by the outline width: light and shadow never paint over the outline.
  const inner = `toon-in-${actorId}`;
  let out =
    `<filter id="${inner}" color-interpolation-filters="sRGB"><feMorphology in="SourceAlpha" operator="erode" radius="${f(sh.inset * scale)}" result="e"/>` +
    `<feFlood flood-color="#fff"/><feComposite in2="e" operator="in"/></filter>`;
  if (sh.opacity > 0) {
    out +=
      `<mask id="shade-${actorId}" ${box}>${use(inner)}${use("toon-black", dir[0] * off, dir[1] * off)}</mask>` +
      `<rect width="${width}" height="${height}" fill="${esc(sh.color)}" opacity="${f(sh.opacity * Math.min(1, strength))}" mask="url(#shade-${actorId})" style="mix-blend-mode:multiply"/>`;
  }
  if (sh.rimOpacity > 0) {
    const r = (sh.inset + sh.offset * 0.5) * scale;
    out +=
      `<mask id="rim-${actorId}" ${box}>${use(inner)}${use("toon-black", -dir[0] * r, -dir[1] * r)}</mask>` +
      `<rect width="${width}" height="${height}" fill="${esc(key.color)}" opacity="${f(sh.rimOpacity * Math.min(1, strength))}" mask="url(#rim-${actorId})" style="mix-blend-mode:screen"/>`;
  }
  return out;
}

/** Ambient darkness, light glows, grade and vignette, drawn over the whole frame. */
export function overlayMarkup(state: LightingState, lights: ScreenLight[], width: number, height: number): string {
  let out = "";
  const points = lights.filter((l) => l.type === "point" && l.intensity > 0);
  const grad = (id: string, color: string, inner: number, outer: number) =>
    `<radialGradient id="${id}"><stop offset="0" stop-color="${esc(color)}" stop-opacity="${f(inner)}"/><stop offset="0.45" stop-color="${esc(color)}" stop-opacity="${f(inner * 0.45)}"/><stop offset="1" stop-color="${esc(color)}" stop-opacity="${f(outer)}"/></radialGradient>`;

  if (state.ambient.opacity > 0) {
    const holes = points
      .map((l) => `${grad(`hole-${l.id}`, "#000", Math.min(1, l.intensity), 0)}<circle cx="${f(l.sx)}" cy="${f(l.sy)}" r="${f(l.sr)}" fill="url(#hole-${l.id})"/>`)
      .join("");
    out +=
      `<mask id="ambient-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#fff"/>${holes}</mask>` +
      `<rect width="${width}" height="${height}" fill="${esc(state.ambient.color)}" opacity="${f(state.ambient.opacity)}" mask="url(#ambient-mask)" style="mix-blend-mode:multiply"/>`;
  }
  for (const l of points) {
    if (l.glow <= 0) continue;
    out += `${grad(`glow-${l.id}`, l.color, Math.min(1, l.glow * l.intensity), 0)}<circle cx="${f(l.sx)}" cy="${f(l.sy)}" r="${f(l.sr)}" fill="url(#glow-${l.id})" style="mix-blend-mode:screen"/>`;
  }
  if (state.grade.opacity > 0) {
    out += `<rect width="${width}" height="${height}" fill="${esc(state.grade.color)}" opacity="${f(state.grade.opacity)}" style="mix-blend-mode:${state.grade.blend}"/>`;
  }
  if (state.vignette.opacity > 0) {
    out +=
      `<radialGradient id="vignette" cx="0.5" cy="0.5" r="0.75"><stop offset="0.55" stop-color="${esc(state.vignette.color)}" stop-opacity="0"/><stop offset="1" stop-color="${esc(state.vignette.color)}" stop-opacity="${f(state.vignette.opacity)}"/></radialGradient>` +
      `<rect width="${width}" height="${height}" fill="url(#vignette)" style="mix-blend-mode:multiply"/>`;
  }
  return out;
}

/** Projects lights to screen space with the camera (per-light parallax). */
export function projectLights(state: LightingState, view: (parallax: number) => Mat): ScreenLight[] {
  return state.lights.map((l) => {
    const m = view(l.parallax);
    const p = apply(m, [l.x, l.y]);
    const scale = Math.hypot(m[0], m[1]);
    return { ...l, sx: p[0], sy: p[1], sr: l.radius * scale };
  });
}
