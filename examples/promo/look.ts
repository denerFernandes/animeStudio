/** The promo's look: 1920 × 1080, flat bright sets, keynote-style feature cards and the signature. */
export const W = 1920;
export const H = 1080;
/** Where the feet stand in the full-body sets. */
export const GROUND = 960;

export const C = {
  ink: "#1d1b3a", indigo: "#2b2766", violet: "#5b4bc4", coral: "#ff6b5b", sun: "#ffc93c", teal: "#2ec4b6",
  cream: "#fbf6ea", sky: "#cfe8f3", grass: "#9ccf7a", night: "#1b2340",
};
export const FONT = "Avenir Next, Helvetica Neue, Arial";
export const MONO = "Menlo, Monaco, monospace";

export const rect = (x: number, y: number, w: number, h: number, fill: string, extra = "") =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`;

/** The animeStudio wordmark, centred on its origin: "anime" in cream, "Studio" in sun yellow, a little play-button badge before it. */
export const wordmark = (size = 150) => `<g font-family="${FONT}" font-weight="800" font-size="${size}" text-anchor="middle" letter-spacing="-2">
  <text x="0" y="${size * 0.35}" fill="${C.cream}" stroke="${C.ink}" stroke-width="${size / 9}" stroke-linejoin="round" paint-order="stroke"><tspan>anime</tspan><tspan fill="${C.sun}">Studio</tspan></text>
</g>`;

/**
 * A feature card at the top left: a numbered chip and the feature's name, a line below it.
 * Origin: the card's top left.
 */
export const card = (n: number, title: string, sub: string) => {
  const esc = (t: string) => t.replace(/&/g, "&amp;");
  const w = Math.max(title.length * 30 + 150, sub.length * 15.5 + 60);
  return `<g font-family="${FONT}">
  <rect x="0" y="0" width="${w}" height="132" rx="26" fill="${C.ink}" opacity="0.92"/>
  <rect x="22" y="22" width="64" height="52" rx="14" fill="${C.sun}"/>
  <text x="54" y="59" text-anchor="middle" font-weight="800" font-size="30" fill="${C.ink}">${String(n).padStart(2, "0")}</text>
  <text x="104" y="62" font-weight="800" font-size="46" fill="${C.cream}">${esc(title)}</text>
  <text x="26" y="110" font-weight="600" font-size="27" fill="#b9b4e8">${esc(sub)}</text>
</g>`;
};

/** A code card: monospaced lines on a dark rounded panel (origin: its top left). Each line is [text, colour?]. */
export const code = (lines: [string, string?][], w = 560) => `<g font-family="${MONO}" font-size="25">
  <rect x="0" y="0" width="${w}" height="${lines.length * 36 + 66}" rx="20" fill="#16152e" opacity="0.95"/>
  <circle cx="30" cy="26" r="7" fill="#ff5f57"/><circle cx="54" cy="26" r="7" fill="#febc2e"/><circle cx="78" cy="26" r="7" fill="#28c840"/>
  ${lines.map(([t, c], i) => `<text x="28" y="${82 + i * 36}" fill="${c ?? "#e8e6ff"}" xml:space="preserve">${t}</text>`).join("")}
</g>`;

/** The creator's handle, small at the top right of every frame. */
export const signature = (handle: string) =>
  `<text x="${W - 40}" y="58" text-anchor="end" font-family="${FONT}" font-weight="700" font-size="30" fill="${C.cream}" stroke="${C.ink}" stroke-width="6" stroke-linejoin="round" paint-order="stroke" opacity="0.9">${handle}</text>`;

// --- Sets -------------------------------------------------------------------------------------------

const blob = (cx: number, cy: number, r: number, fill: string, o = 1) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" opacity="${o}"/>`;

/** The title set: an indigo stage with big soft shapes and a floor line. */
export const stage = () => `<defs><linearGradient id="stg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.violet}"/><stop offset="1" stop-color="${C.indigo}"/></linearGradient></defs>
  ${rect(0, 0, W, H, "url(#stg)")}
  ${blob(260, 260, 220, C.coral, 0.22)}${blob(1700, 200, 160, C.sun, 0.2)}${blob(1560, 860, 300, C.teal, 0.16)}${blob(140, 900, 140, C.sun, 0.14)}
  ${rect(0, GROUND, W, H - GROUND, "#221f52")}<path d="M0 ${GROUND} H${W}" stroke="#7b6fe0" stroke-width="4" opacity="0.5"/>`;

/** A bright studio backdrop (the line-up): a cream cyclorama with a soft floor. */
export const studio = () => `<defs><radialGradient id="cyc" cx="0.5" cy="0.45" r="0.75"><stop offset="0" stop-color="#fffaf0"/><stop offset="1" stop-color="#f1e3c8"/></radialGradient></defs>
  ${rect(0, 0, W, H, "url(#cyc)")}
  <ellipse cx="${W / 2}" cy="${GROUND + 10}" rx="1000" ry="70" fill="#e8d5b2" opacity="0.7"/>
  ${[260, 660, 1060, 1460, 1860].map((x) => `<path d="M${x - 200} ${GROUND + 60} L${x} 0" stroke="#efe0c2" stroke-width="3" opacity="0.6"/>`).join("")}`;

/** A sunny street: sky, clouds, low houses, a pavement. */
export const street = () => {
  const houses = [[60, 360, 300, C.coral], [380, 300, 260, "#f2b544"], [660, 380, 320, "#8fb8de"], [1000, 330, 280, "#f29e8e"], [1300, 280, 300, "#a6d39a"], [1620, 350, 280, "#c7b2ea"]] as const;
  return `${rect(0, 0, W, H, C.sky)}
  ${[[300, 150, 1], [1100, 110, 1.3], [1650, 190, 0.9]].map(([x, y, s]) => `<g transform="translate(${x} ${y}) scale(${s})" fill="#fff"><ellipse rx="90" ry="34"/><ellipse cx="-50" cy="8" rx="56" ry="28"/><ellipse cx="54" cy="10" rx="60" ry="26"/></g>`).join("")}
  ${houses.map(([x, top, w, c]) => `<g stroke="${C.ink}" stroke-width="4" stroke-linejoin="round">
    <path d="M${x} 760 V${top + 80} L${x + w / 2} ${top} L${x + w} ${top + 80} V760 Z" fill="${c}"/>
    <rect x="${x + w * 0.2}" y="${top + 130}" width="${w * 0.22}" height="${w * 0.22}" fill="#fff7d6"/>
    <rect x="${x + w * 0.58}" y="${top + 130}" width="${w * 0.22}" height="${w * 0.22}" fill="#fff7d6"/>
    <rect x="${x + w * 0.4}" y="${640}" width="${w * 0.2}" height="120" fill="${C.ink}" opacity="0.75"/></g>`).join("")}
  ${rect(0, 760, W, 60, "#d9d3c7")}<path d="M0 760 H${W}" stroke="${C.ink}" stroke-width="4"/>
  ${rect(0, 820, W, H - 820, "#bdb6a8")}<path d="M0 820 H${W}" stroke="${C.ink}" stroke-width="3" opacity="0.5"/>
  ${Array.from({ length: 12 }, (_, i) => `<path d="M${i * 180 + 40} 1000 h90" stroke="#f4efe4" stroke-width="10" stroke-linecap="round"/>`).join("")}`;
};

/** A boxing ring for the fight. */
export const ring = () => `<defs><radialGradient id="spot" cx="0.5" cy="0.3" r="0.7"><stop offset="0" stop-color="#4a3f9a"/><stop offset="1" stop-color="#191733"/></radialGradient></defs>
  ${rect(0, 0, W, H, "url(#spot)")}
  ${Array.from({ length: 40 }, (_, i) => blob((i * 197) % W, 120 + ((i * 89) % 300), 3 + (i % 3), "#fff", 0.35)).join("")}
  <path d="M120 ${GROUND - 60} L1800 ${GROUND - 60} L1920 ${H} L0 ${H} Z" fill="#e9e1d0" stroke="${C.ink}" stroke-width="4"/>
  ${[0, 1, 2].map((i) => `<path d="M60 ${560 + i * 90} H1860" stroke="${[C.coral, "#fff", C.teal][i]}" stroke-width="12" stroke-linecap="round"/>`).join("")}
  <rect x="40" y="520" width="40" height="${GROUND - 470}" rx="8" fill="${C.coral}" stroke="${C.ink}" stroke-width="4"/>
  <rect x="1840" y="520" width="40" height="${GROUND - 470}" rx="8" fill="${C.teal}" stroke="${C.ink}" stroke-width="4"/>`;

/** A park at night: deep sky, stars, a moon, dark trees and a bench; the lamp is drawn by the scene. */
export const park = () => `${rect(0, 0, W, H, C.night)}
  ${Array.from({ length: 60 }, (_, i) => blob((i * 233) % W, (i * 131) % 520, 1.5 + (i % 3), "#fff", 0.6)).join("")}
  ${blob(1580, 190, 70, "#f6efd2")}${blob(1556, 176, 66, C.night)}
  ${[[150, 700, 170], [430, 640, 200], [1350, 660, 190], [1700, 700, 210]].map(([x, y, r]) => `<rect x="${x - 18}" y="${y}" width="36" height="${GROUND - y}" fill="#2a2440"/><circle cx="${x}" cy="${y - r * 0.4}" r="${r}" fill="#24395a"/>`).join("")}
  ${rect(0, GROUND - 40, W, H - GROUND + 40, "#22384a")}
  <path d="M1160 ${GROUND - 70} h300 M1180 ${GROUND - 70} v70 M1440 ${GROUND - 70} v70 M1160 ${GROUND - 130} h300" stroke="#5a4636" stroke-width="16" stroke-linecap="round"/>`;

/** The street lamp (a prop): its post's foot at the origin, the bulb at (0, -560). */
export const lamp = () => `<g stroke="${C.ink}" stroke-width="5" stroke-linejoin="round">
  <rect x="-12" y="-540" width="24" height="540" fill="#3c4256"/><rect x="-30" y="-20" width="60" height="20" fill="#3c4256"/>
  <path d="M-46 -540 L46 -540 L30 -600 L-30 -600 Z" fill="#3c4256"/><ellipse cx="0" cy="-548" rx="30" ry="14" fill="#ffe9a8"/></g>`;
