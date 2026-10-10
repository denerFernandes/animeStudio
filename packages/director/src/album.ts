/**
 * Photos and photo albums: a moment of a block rendered as a photo on paper (a print with photo
 * corners or a Polaroid, aged, with a handwritten caption), and an album lying open whose pages turn
 * and which closes on its cover. Everything is drawn as SVG markup for props of the scene.
 */

export type PhotoFrame = "print" | "polaroid";
export type PhotoLook = "faded" | "sepia" | "flash" | "plain";

export interface PhotoStyle {
  /** Picture size (px, the photo's own, not counting the border). */
  size: [number, number];
  frame?: PhotoFrame;
  /** 0 (new) … 1 (old: yellowed, faded, the colours gone towards sepia). */
  age?: number;
  look?: PhotoLook;
  /** Handwritten: on the Polaroid's wide bottom border, or on the page under a print. Kept within the picture's width (smaller, on two lines if long). */
  caption?: string;
  /** The caption's ink under a print (default blue; in an album, white pencil on a dark page). */
  ink?: string;
  /** The whole scene frame's size (default 1920 × 1080): the picture is cropped from its middle. */
  source?: [number, number];
  /** Part of the frame to show: [x, y, w, h] in its pixels (default the middle, at the photo's aspect). */
  crop?: [number, number, number, number];
}

const r = (n: number) => Math.round(n * 100) / 100;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Handwriting (a cursive face, falling back to the system's). */
export const HANDWRITING = "'Caveat','Patrick Hand','Comic Sans MS','Segoe Print',cursive";

/**
 * A photo: `frame` (the frozen frame's markup, in a `source`-sized space) cropped to the picture,
 * aged, on its paper. Drawn with the picture's top-left at (0, 0); returns the markup and the size
 * of the whole paper (the border and, for a print, the caption below it).
 */
export function photoMarkup(frame: string, o: PhotoStyle, id: string): { markup: string; size: [number, number] } {
  const [w, h] = o.size;
  const [W, H] = o.source ?? [1920, 1080];
  const age = Math.max(0, Math.min(1, o.age ?? 0.4));
  const kind = o.frame ?? "print";
  // Crop: the middle of the frame at the picture's aspect.
  let crop = o.crop;
  if (!crop) {
    const a = w / h;
    const cw = Math.min(W, H * a), ch = cw / a;
    crop = [(W - cw) / 2, (H - ch) / 2, cw, ch];
  }
  const b = kind === "polaroid" ? w * 0.06 : w * 0.035;
  const bottom = kind === "polaroid" ? w * 0.26 : b;
  const pw = w + b * 2, ph = h + b + bottom;
  // Age: colours towards sepia and washed out (a colour matrix), a warm yellow over it, a vignette.
  const s = age * 0.75;
  const sep = [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131];
  const m = [0, 1, 2].flatMap((row) => [0, 1, 2].map((col) => r((row === col ? 1 - s : 0) + sep[row * 3 + col] * s)));
  const wash = r(age * 0.12);
  const look = o.look ?? (age > 0.6 ? "sepia" : "faded");
  const sepia = look === "sepia" ? 1 : look === "plain" ? 0 : 0.5;
  const filter = look === "plain" && age === 0 ? "" :
    `<filter id="${id}-age" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${m[0]} ${m[1]} ${m[2]} 0 ${wash} ${m[3]} ${m[4]} ${m[5]} 0 ${wash} ${m[6]} ${m[7]} ${m[8]} 0 ${r(wash * 0.6)} 0 0 0 1 0"/></filter>`;
  const defs =
    `<defs>${filter}<clipPath id="${id}-clip"><rect width="${r(w)}" height="${r(h)}"/></clipPath>` +
    `<radialGradient id="${id}-vig" cx="50%" cy="50%" r="70%"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#2a1a08" stop-opacity="${r(0.25 + age * 0.3)}"/></radialGradient>` +
    `<radialGradient id="${id}-flash" cx="50%" cy="42%" r="55%"><stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>`;
  const picture =
    `<g clip-path="url(#${id}-clip)"><g${filter ? ` filter="url(#${id}-age)"` : ""}>` +
    `<svg width="${r(w)}" height="${r(h)}" viewBox="${r(crop[0])} ${r(crop[1])} ${r(crop[2])} ${r(crop[3])}" preserveAspectRatio="xMidYMid slice">${frame}</svg></g>` +
    `<rect width="${r(w)}" height="${r(h)}" fill="#e9c27a" opacity="${r(age * 0.22 * sepia + age * 0.08)}" style="mix-blend-mode:multiply"/>` +
    (look === "flash" ? `<rect width="${r(w)}" height="${r(h)}" fill="url(#${id}-flash)" style="mix-blend-mode:screen"/>` : "") +
    `<rect width="${r(w)}" height="${r(h)}" fill="url(#${id}-vig)"/></g>`;
  const paperColor = age > 0.5 ? "#f3ead2" : "#fbf8ef";
  let out = defs;
  // The paper (its shadow on the page under it).
  out += `<rect x="${r(-b + 4)}" y="${r(-b + 5)}" width="${r(pw)}" height="${r(ph)}" fill="#000" opacity="0.22"/>`;
  out += `<rect x="${r(-b)}" y="${r(-b)}" width="${r(pw)}" height="${r(ph)}" fill="${paperColor}" stroke="#d8cfb6" stroke-width="1.2"/>`;
  out += picture;
  if (kind === "print") {
    // Photo corners holding it on the page.
    const c = Math.min(w, h) * 0.12;
    const corner = (x: number, y: number, sx: number, sy: number) => `<path d="M${r(x)} ${r(y)} l${r(sx * c)} 0 l${r(-sx * c)} ${r(sy * c)} Z" fill="#1d1a17" opacity="0.88"/>`;
    out += corner(-b, -b, 1, 1) + corner(w + b, -b, -1, 1) + corner(-b, h + b, 1, -1) + corner(w + b, h + b, -1, -1);
  }
  let size: [number, number] = [pw, ph];
  if (o.caption) {
    // The caption never runs wider than the picture: a smaller hand, then two lines, and each line
    // held to the picture's width (textLength squeezes it whatever handwriting face is installed).
    const room = w * 0.92;
    const want = kind === "polaroid" ? bottom * 0.42 : Math.max(16, w * 0.085);
    const lines = captionLines(o.caption, want, room);
    const two = lines.length > 1;
    const fs = Math.min(two ? want * 0.82 : want, fitSize(lines, room));
    const lh = fs * 1.05;
    const y0 = kind === "polaroid" ? h + bottom * (two ? 0.42 : 0.62) : h + b + fs * 1.15;
    const tspans = lines.map((t, i) => {
      const est = textWidth(t, fs);
      const len = est > room * 0.7 ? ` textLength="${r(Math.min(est, room))}" lengthAdjust="spacingAndGlyphs"` : "";
      return `<tspan x="${r(w / 2)}" y="${r(y0 + i * lh)}"${len}>${esc(t)}</tspan>`;
    }).join("");
    const color = kind === "polaroid" ? "#2b3a75" : o.ink ?? "#2b3a75";
    out += `<text text-anchor="middle" font-family="${HANDWRITING}" font-size="${r(fs)}" fill="${color}" transform="rotate(-1.5 ${r(w / 2)} ${r(y0)})">${tspans}</text>`;
    if (kind === "print") size = [pw, ph + fs * 0.4 + lh * lines.length];
  }
  return { markup: `<g transform="translate(${r(b)} ${r(b)})">${out}</g>`, size };
}

/** Relative luminance (0 black … 1 white) of a #rgb / #rrggbb colour. */
export function luminance(hex: string): number {
  let h = hex.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const v = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return Number.isFinite(v[0]) ? 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2] : 0.5;
}

/**
 * Markup as a standalone picture: an `<image>` holding it as an SVG document (a data URI). The
 * browser decodes it once and reuses it frame after frame, where inline markup — a whole frozen
 * scene — would be rebuilt every frame; its ids are its own.
 */
export function pictureMarkup(markup: string, size: [number, number], at: [number, number] = [0, 0]): string {
  const [w, h] = size.map((v) => Math.ceil(v));
  const doc = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="${r(at[0])} ${r(at[1])} ${w} ${h}">${markup}</svg>`;
  const b64 = typeof Buffer !== "undefined" ? Buffer.from(doc, "utf8").toString("base64") : btoa(unescape(encodeURIComponent(doc)));
  return `<image x="${r(at[0])}" y="${r(at[1])}" width="${w}" height="${h}" href="data:image/svg+xml;base64,${b64}"/>`;
}

/** A generous width for handwriting (wider faces than Caveat may stand in for it). */
const textWidth = (t: string, fs: number) => t.length * fs * 0.52;
/** The largest size at which every line fits `room`. */
const fitSize = (lines: string[], room: number) => Math.min(...lines.map((t) => room / Math.max(1, t.length * 0.52)));
/** One line, or two split at the space nearest the middle when one line would be too small to read. */
function captionLines(text: string, fs: number, room: number): string[] {
  if (textWidth(text, fs) <= room || textWidth(text, fs * 0.7) <= room) return [text];
  const mid = text.length / 2;
  let cut = -1;
  for (let i = 0; i < text.length; i++) if (text[i] === " " && (cut < 0 || Math.abs(i - mid) < Math.abs(cut - mid))) cut = i;
  return cut < 0 ? [text] : [text.slice(0, cut), text.slice(cut + 1)];
}

/** A photo on a page: a moment of a block, where it goes on the page (its top-left), tilted. */
export interface AlbumPhoto extends Omit<PhotoStyle, "source"> {
  id?: string;
  /** The block photographed (an `insert: true` block staged for it) and the moment. */
  block: string;
  at: { line: number; word?: string; end?: boolean; offset?: number };
  /**
   * Top-left of the photo (its paper, caption and tilt) on the page, px from that page's top-left
   * corner. Kept on the page (moved in, or made smaller if larger than it). Without it, the photos
   * without one share the page, one under the other, each as large as fits.
   */
  place?: [number, number];
  rotation?: number;
}

/** One side of a page: its photos and stuck-on notes. */
export interface AlbumSide { photos?: AlbumPhoto[]; paper?: string; notes?: { text: string; at: [number, number]; size?: number; rotation?: number }[] }

/**
 * An album lying open on a surface: spreads (left and right sides; the first left is the inside of
 * the cover), turned one by one (`flips`), closed on its cover (`close`).
 */
export interface Album {
  id: string;
  /** The spine's middle (scene px) and a page's size. */
  at: [number, number];
  page: [number, number];
  spreads: { left?: AlbumSide; right?: AlbumSide }[];
  /** The front cover: a kit.graphics name or SVG markup, drawn over a right page's area (x 0…w, y 0…h). */
  cover: string;
  /** The pages' colour (default a black album page; a side's own `paper` wins). */
  paper?: string;
  /** Colour of the binding (default a brown leather). */
  binding?: string;
  flips?: { line: number; word?: string; end?: boolean; offset?: number }[];
  close?: { line: number; word?: string; end?: boolean; offset?: number };
  /** Seconds a page takes to turn (default 0.7). */
  turn?: number;
}

/** A page side's art: paper, photos (already drawn), notes. Drawn from x0 (−w for a left page) to x0 + w. */
export function sideMarkup(side: AlbumSide | undefined, page: [number, number], left: boolean, photos: string[], id: string): string {
  const [w, h] = page;
  const x0 = left ? -w : 0;
  const paper = side?.paper ?? "#2f2a26";
  // Black album pages, a gutter shadow along the spine.
  // Everything on the page stays on it (clipped to the page: nothing spills onto the table or shows
  // from a page under another).
  let out = `<defs><linearGradient id="${id}-gutter" x1="${left ? 1 : 0}" y1="0" x2="${left ? 0 : 1}" y2="0"><stop offset="0" stop-color="#000" stop-opacity="0.45"/><stop offset="0.12" stop-color="#000" stop-opacity="0"/></linearGradient><clipPath id="${id}-page"><rect x="${r(x0)}" y="0" width="${r(w)}" height="${r(h)}"/></clipPath></defs>`;
  out += `<rect x="${r(x0)}" y="0" width="${r(w)}" height="${r(h)}" fill="${paper}" stroke="#1c1916" stroke-width="2"/>`;
  out += `<g clip-path="url(#${id}-page)">`;
  out += photos.join("");
  for (const n of side?.notes ?? []) {
    // A note stays on its page: a smaller hand when it would run past the edge.
    const room = Math.max(40, w - n.at[0] - 16);
    const fs = Math.min(n.size ?? 34, room / Math.max(1, n.text.length * 0.52));
    const est = textWidth(n.text, fs);
    const len = est > room * 0.7 ? ` textLength="${r(Math.min(est, room))}" lengthAdjust="spacingAndGlyphs"` : "";
    const ink = luminance(paper) < 0.45 ? "#f4eedc" : "#2b3a75";
    out += `<text x="${r(x0 + n.at[0])}" y="${r(n.at[1])}"${len} font-family="${HANDWRITING}" font-size="${r(fs)}" fill="${ink}" transform="rotate(${n.rotation ?? -3} ${r(x0 + n.at[0])} ${r(n.at[1])})">${esc(n.text)}</text>`;
  }
  out += `</g><rect x="${r(x0)}" y="0" width="${r(w)}" height="${r(h)}" fill="url(#${id}-gutter)"/>`;
  return out;
}
