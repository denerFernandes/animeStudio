/**
 * "animeStudio" — a 16:9 promo (≈ 28 s) showing the engine's main features, one shot each:
 * title, characters from a description, emotions & lip sync, personality walks, physics & cartoon
 * FX, lighting & camera, the end card.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ActionDef, SceneDoc } from "@animestudio/core";
import { cast } from "./cast";
import { C, FONT, GROUND, H, MONO, W, card, code, lamp, park, ring, signature, stage, street, studio, wordmark } from "./look";

const dir = import.meta.dirname;
const audio = JSON.parse(readFileSync(join(dir, "data", "audio.json"), "utf8")) as {
  cues: Record<string, { start: number; end: number; value: string }[]>; files: Record<string, string>; durations: Record<string, number>; words: Record<string, [string, number][]>;
};
// Sound files are stored by name, in audio/.
for (const k of Object.keys(audio.files)) audio.files[k] = join(dir, "audio", audio.files[k]);
const word = (id: string, w: string) => audio.words[id].find(([x]) => x === w)![1];
export const FPS = 30;
export const characters = cast();
type Track = NonNullable<SceneDoc["tracks"]>[string];
type Prop = Record<string, unknown>;

/** The library's repository, small at the top right of every frame. */
export const REPO = "github.com/denerFernandes/animeStudio";
const scene = (id: string, duration: number, art: string, extra: Partial<SceneDoc> & { props?: Prop[] }): SceneDoc => ({
  format: "toon-scene", version: 1, width: W, height: H, fps: FPS, duration, background: C.cream,
  characters: Object.fromEntries(Object.keys(characters).map((k) => [k, "x"])),
  camera: { x: W / 2, y: H / 2, zoom: 1 },
  layers: [{ id: `${id}Set`, art }],
  ...extra,
  // The repository link, fixed to the screen over everything.
  props: [...(extra.props ?? []), { id: "sign", art: signature(REPO), x: 0, y: 0, z: 200, parallax: 0 }],
} as SceneDoc);
const fx = (at: number, type: string, o: Record<string, unknown> = {}) => ({ at, action: "fx", type, ...o }) as ActionDef;
const play = (at: number, actor: string, clip: string, o: Record<string, unknown> = {}) => ({ at, actor, action: "play", clip, ...o }) as ActionDef;
const emo = (at: number, actor: string, value: string, duration = 0.25) => ({ at, actor, action: "pose", control: "emotion", value, duration }) as ActionDef;
const idle = (...ids: string[]) => ids.map((a) => play(0, a, "idle", { loop: true, layer: -1 }));
/** Wipes between shots: in at the start, out at the end (sun yellow, left → right). */
const wipeIn = (): ActionDef => ({ at: 0, action: "transition", type: "wipe", mode: "in", duration: 0.3, color: C.sun, direction: "right" }) as ActionDef;
const wipeOut = (end: number): ActionDef => ({ at: end - 0.3, action: "transition", type: "wipe", mode: "out", duration: 0.3, color: C.sun, direction: "right" }) as ActionDef;
/** A screen-fixed feature card sliding in from the left after `at`, out before `end`. */
const cardProp = (n: number, title: string, sub: string, at: number, end: number) => ({
  prop: { id: "card", art: card(n, title, sub), x: -1100, y: 44, z: 150, parallax: 0 },
  tracks: { "props.card.x": [[0, -1100], [at, -1100], [at + 0.45, 44, "backOut"], [end - 0.55, 44], [end - 0.3, -1100, "quadIn"]] as Track },
});
/** A pop: scale 0 → overshoot → 1 at `at` (a prop or an actor channel). */
const pop = (at: number, to = 1): Track => [[0, 0], [at, 0], [at + 0.22, to * 1.15, "quadOut"], [at + 0.4, to, "sineInOut"]];
const fade = (at: number, d = 0.35): Track => [[0, 0], [at, 0], [at + d, 1]];

// --- 1. Title ------------------------------------------------------------------------------------------
const S1 = 3.0;
function title(): SceneDoc {
  return scene("title", S1, stage(), {
    actors: [
      { id: "maya", character: "maya", x: 330, y: GROUND, scale: 1.05, z: 1 },
      { id: "kai", character: "kai", x: 1590, y: GROUND, scale: 1.05, flip: true, z: 1 },
    ],
    props: [
      { id: "logo", art: wordmark(170), x: W / 2, y: 410, z: 50, parallax: 0, scale: 0 },
      { id: "tag", art: `<text x="0" y="0" text-anchor="middle" font-family="${FONT}" font-weight="600" font-size="46" fill="${C.cream}">2D cartoon animation, written as data</text>`, x: W / 2, y: 560, z: 50, parallax: 0, opacity: 0 },
    ],
    tracks: {
      "props.logo.scale": pop(0.15),
      "props.tag.opacity": fade(0.75),
      "props.tag.y": [[0, 600], [0.75, 600], [1.15, 560, "quadOut"]],
      "actors.maya.y": [[0, GROUND + 700], [0.35, GROUND + 700], [0.75, GROUND, "backOut"]],
      "actors.kai.y": [[0, GROUND + 700], [0.5, GROUND + 700], [0.9, GROUND, "backOut"]],
    },
    script: [
      ...idle("maya", "kai"),
      emo(0, "maya", "joy", 0), emo(0, "kai", "happy", 0),
      { at: 0, actor: "maya", action: "lookAt", target: [W / 2, 420] },
      { at: 0, actor: "kai", action: "lookAt", target: [W / 2, 420] },
      play(1.0, "maya", "wave", { duration: 1.6 }),
      play(1.15, "kai", "cheer", { duration: 1.5 }),
      fx(0.25, "sparkle", { x: 640, y: 330 }), fx(0.35, "sparkle", { x: 1300, y: 470 }),
      fx(1.2, "hearts", { actor: "maya" }),
      wipeOut(S1),
    ] as ActionDef[],
  });
}

// --- 2. Characters from a description ----------------------------------------------------------------
const S2 = 4.0;
function lineup(): SceneDoc {
  const ids = ["nell", "otto", "maya", "kai", "pip"];
  const xs = [300, 630, 960, 1290, 1620];
  const c = cardProp(1, "Characters from a description", "One short look → a full rig: 12 drawn angles, emotions, 40+ clips", 0.25, S2);
  // One full turn through the drawn angles (profile = three-quarter facing right), round the back
  // and through the front again, one step every STEP seconds.
  const views = ["profile", "q50", "q64", "q77", "side", "q112", "away", "q158", "back"];
  const order = [...views, "front", "half", "q24", "profile"];
  const T0 = 2.0, STEP = 0.11;
  return scene("lineup", S2, studio(), {
    actors: ids.map((id, i) => ({ id, character: id, x: xs[i], y: GROUND, scale: 0, z: 1 })),
    props: [
      c.prop,
      { id: "code", art: code([
        ["cartoonCharacter({", "#8be9fd"],
        ['  build: "teen", hair: "spiky",'],
        ['  top: "tee", topColor: "#ffc93c",'],
        ['  freckles: true })', "#e8e6ff"],
      ], 600), x: 1270, y: 200, z: 150, parallax: 0, opacity: 0 },
    ],
    tracks: {
      ...c.tracks,
      ...Object.fromEntries(ids.map((id, i) => [`actors.${id}.scale`, pop(0.35 + i * 0.17)])),
      "props.code.opacity": fade(0.9),
    },
    script: [
      wipeIn(),
      ...idle(...ids),
      ...ids.map((id, i) => fx(0.45 + i * 0.17, "sparkle", { actor: id })),
      ...ids.map((id) => emo(0, id, "happy", 0)),
      // Everyone turns round, a beat apart.
      ...ids.flatMap((id, i) => order.map((v, k) => ({ at: T0 + i * 0.06 + k * STEP, actor: id, action: "pose", control: "view", value: v, duration: 0 }) as ActionDef)),
      wipeOut(S2),
    ] as ActionDef[],
  });
}

// --- 3. Emotions & lip sync --------------------------------------------------------------------------
const LINE = 0.3;
const S3 = LINE + audio.durations.maya + 0.35;
function talk(): SceneDoc {
  const c = cardProp(2, "Emotions & lip sync", "Any voice → mouth shapes, timed to the word", 0.25, S3);
  const hi = LINE + word("maya", "hi"), made = LINE + word("maya", "made"), json = LINE + word("maya", "json"), and = LINE + word("maya", "and"), talkW = LINE + word("maya", "talk");
  const laugh = json + 0.55;
  // A label naming the current emotion, at the bottom right.
  const moods: [string, number, number][] = [["happy", 0, made], ["smug", made, laugh], ["joy", laugh, and], ["excited", and, S3]];
  const label = (m: string) => `<g font-family="${FONT}"><rect x="-150" y="-44" width="300" height="72" rx="36" fill="${C.ink}" opacity="0.9"/>
    <text x="0" y="6" text-anchor="middle" font-size="34" xml:space="preserve" font-weight="700" fill="${C.sun}"><tspan fill="#b9b4e8" font-weight="600">emotion</tspan>  ${m}</text></g>`;
  return scene("talk", S3, studio(), {
    actors: [{ id: "maya", character: "maya", x: 960, y: GROUND + 40, scale: 1.0, z: 1 }],
    props: [c.prop, ...moods.map(([m]) => ({ id: `m_${m}`, art: label(m), x: 1650, y: 980, z: 150, parallax: 0, opacity: 0 }))],
    camera: { x: 960, y: 560, zoom: 1.75 },
    tracks: {
      ...c.tracks,
      ...Object.fromEntries(moods.map(([m, a, b]) => [`props.m_${m}.opacity`, [[0, 0], [a, 0], [a + 0.12, 1], [b, 1], [b + 0.01, 0]]])),
    },
    script: [
      wipeIn(),
      ...idle("maya"),
      { at: 0, actor: "maya", action: "lookAt", target: [600, 600] },
      { at: 0, actor: "maya", action: "pose", control: "view", value: "half", duration: 0 },
      { at: 0, action: "camera", zoom: 2.05, y: 520, duration: S3, ease: "sineInOut" },
      emo(0, "maya", "happy", 0),
      { at: LINE, actor: "maya", action: "say", cues: audio.cues.maya },
      play(hi - 0.1, "maya", "wave", { duration: 1.0, fadeIn: 0.15 }),
      emo(made, "maya", "smug", 0.25),
      play(made, "maya", "present", { duration: 1.3, fadeIn: 0.25 }),
      fx(json, "sparkle", { actor: "maya" }),
      emo(laugh, "maya", "joy", 0.2),
      play(laugh, "maya", "laugh", { duration: and - laugh, fadeIn: 0.15 }),
      emo(and, "maya", "excited", 0.2),
      play(talkW - 0.15, "maya", "cheer", { duration: 1.0, fadeIn: 0.15 }),
      fx(talkW + 0.1, "exclaim", { actor: "maya" }),
      wipeOut(S3),
    ] as ActionDef[],
  });
}

// --- 4. Personality walks ----------------------------------------------------------------------------
const S4 = 4.0;
function walks(): SceneDoc {
  const c = cardProp(3, "Personality walks", "sneak · strut · march · scared run — feet never slide", 0.25, S4);
  const FRONT = 1040, BACK = 880;
  const walk = (at: number, actor: string, x: number, clip: string, duration: number) =>
    ({ at, actor, action: "walkTo", x, clip, duration }) as ActionDef;
  return scene("walks", S4, street(), {
    actors: [
      { id: "pip", character: "pip", x: -200, y: BACK, scale: 0.8, z: 0 },
      { id: "maya", character: "maya", x: 2150, y: BACK, scale: 0.72, flip: true, z: 0 },
      { id: "kai", character: "kai", x: 560, y: FRONT, scale: 0.95, z: 2 },
      { id: "otto", character: "otto", x: 1900, y: FRONT, scale: 0.95, flip: true, z: 2 },
    ],
    props: [c.prop],
    tracks: c.tracks,
    script: [
      wipeIn(),
      ...idle("pip", "maya", "kai", "otto"),
      emo(0, "kai", "smug", 0), emo(0, "otto", "smug", 0), emo(0, "pip", "determined", 0), emo(0, "maya", "scared", 0),
      walk(0, "kai", 1060, "sneak", S4 - 0.2),
      walk(0, "otto", 1460, "strut", S4 - 0.3),
      walk(0.1, "pip", 520, "march", S4 - 0.4),
      walk(1.3, "maya", -300, "scaredRun", 2.2),
      fx(1.4, "sweat", { actor: "maya" }),
      fx(1.5, "dust", { actor: "maya", anchor: "origin" }),
      fx(2.3, "dust", { actor: "maya", anchor: "origin" }),
      { at: 1.9, actor: "otto", action: "lookAt", target: "maya" },
      fx(2.0, "question", { actor: "otto" }),
      wipeOut(S4),
    ] as ActionDef[],
  });
}

// --- 5. Physics & cartoon FX -----------------------------------------------------------------------
const S5 = 4.4;
const PUNCH = 1.35, LAND = PUNCH + 0.28;
function fight(): SceneDoc {
  const c = cardProp(4, "Physics & cartoon FX", "Rigid bodies, springy hair, impacts, K.O.s", 0.25, S5);
  const ball = (fill: string) => `<g stroke="${C.ink}" stroke-width="4"><circle r="44" fill="#fff"/>
    <path d="M-44 0 A44 44 0 0 1 0 -44 L0 0 Z M44 0 A44 44 0 0 1 0 44 L0 0 Z" fill="${fill}"/><circle r="44" fill="none"/></g>`;
  const FLOOR = GROUND - 20;
  return scene("fight", S5, ring(), {
    actors: [
      { id: "kai", character: "kai", x: 780, y: FLOOR, scale: 1.0, z: 1 },
      { id: "otto", character: "otto", x: 1130, y: FLOOR, scale: 1.0, flip: true, z: 1 },
    ],
    props: [
      c.prop,
      { id: "floor", art: "", x: W / 2, y: FLOOR + 60, body: { type: "static", shape: { box: [2600, 120] }, friction: 0.6 } },
      { id: "wallL", art: "", x: 20, y: 500, body: { type: "static", shape: { box: [40, 1400] } } },
      { id: "wallR", art: "", x: W - 20, y: 500, body: { type: "static", shape: { box: [40, 1400] } } },
      { id: "b1", art: ball(C.coral), x: 260, y: -120, z: 5, body: { type: "dynamic", shape: { circle: 44 }, restitution: 0.75, velocity: [160, 0], angularVelocity: 3 } },
      { id: "b2", art: ball(C.teal), x: 1650, y: -300, z: 5, body: { type: "dynamic", shape: { circle: 44 }, restitution: 0.75, velocity: [-120, 0], angularVelocity: -3 } },
      { id: "b3", art: ball(C.sun), x: 420, y: -520, z: 5, body: { type: "dynamic", shape: { circle: 44 }, restitution: 0.7, velocity: [60, 0], angularVelocity: 2 } },
      { id: "b4", art: ball(C.violet), x: 1500, y: -700, z: 5, body: { type: "dynamic", shape: { circle: 44 }, restitution: 0.7, velocity: [-200, 0], angularVelocity: -2 } },
    ],
    tracks: {
      ...c.tracks,
      // Thrown back by the punch, a hop and down.
      "actors.otto.x": [[0, 1130], [LAND, 1130], [LAND + 0.55, 1460, "quadOut"]],
      "actors.otto.y": [[0, FLOOR], [LAND, FLOOR], [LAND + 0.22, FLOOR - 90, "quadOut"], [LAND + 0.5, FLOOR, "quadIn"]],
    },
    script: [
      wipeIn(),
      play(0, "kai", "stance", { loop: true, layer: -1 }),
      play(0, "otto", "stance", { loop: true, layer: -1 }),
      emo(0, "kai", "determined", 0), emo(0, "otto", "angry", 0),
      { at: 0, actor: "kai", action: "lookAt", target: "otto" },
      { at: 0, actor: "otto", action: "lookAt", target: "kai" },
      fx(0.5, "anger", { actor: "otto" }),
      play(PUNCH, "kai", "punch", { duration: 0.6, fadeIn: 0.05 }),
      fx(LAND, "impactFrame"),
      fx(LAND, "burst", { actor: "otto" }),
      { at: LAND, action: "shake", duration: 0.35, amount: 18 },
      emo(LAND, "otto", "dead", 0.05),
      play(LAND, "otto", "knocked", { duration: S5 - LAND, fadeIn: 0.05 }),
      fx(LAND + 0.7, "stars", { actor: "otto", duration: 2.0 }),
      emo(LAND + 0.4, "kai", "joy", 0.2),
      play(LAND + 0.5, "kai", "cheer", { duration: 1.6, fadeIn: 0.2 }),
      fx(LAND + 0.55, "caption", { text: "K.O.!", style: "ko", x: 1180, y: 330, duration: 1.6 }),
      wipeOut(S5),
    ] as ActionDef[],
  });
}

// --- 6. Lighting & camera ----------------------------------------------------------------------------
const S6 = 4.0;
function night(): SceneDoc {
  const c = cardProp(5, "Lighting & camera", "Lights, cel shading, grading, moves and depth of field", 0.25, S6);
  const LX = 1000, BULB: [number, number] = [LX, GROUND - 548];
  return scene("night", S6, park(), {
    actors: [{ id: "nell", character: "nell", x: 260, y: GROUND, scale: 1.0, z: 1 }],
    props: [
      c.prop,
      { id: "lamp", art: lamp(), x: LX, y: GROUND, z: 0 },
    ],
    camera: { x: 960, y: 540, zoom: 1 },
    tracks: c.tracks,
    lighting: {
      ambient: { color: "#1a1d4a", opacity: 0.45 },
      lights: [
        { id: "bulb", type: "point", x: BULB[0], y: BULB[1], radius: 760, glow: 0.8, color: "#ffd98a", flicker: { amount: 0.08, speed: 5 } },
        { id: "key", type: "directional", angle: 120, glow: 0 },
      ],
      shading: { light: "key", color: "#2b2a6b", opacity: 0.32, rim: "#ffd98a", rimOpacity: 0.7, offset: 6, inset: 3.5 },
      vignette: { color: "#000", opacity: 0.35 },
    },
    script: [
      wipeIn(),
      ...idle("nell"),
      emo(0, "nell", "calm", 0),
      { at: 0, actor: "nell", action: "walkTo", x: LX - 150, duration: 2.0 },
      { at: 0.3, action: "camera", x: LX - 140, y: 560, zoom: 1.6, duration: 3.2, ease: "sineInOut" },
      { at: 2.0, actor: "nell", action: "lookAt", target: BULB },
      emo(2.1, "nell", "happy", 0.4),
      fx(2.3, "sparkle", { x: BULB[0] + 60, y: BULB[1] + 40 }),
      { at: 2.2, action: "light", channel: "lights.bulb.intensity", value: 1.25, duration: 0.6 },
      wipeOut(S6),
    ] as ActionDef[],
  });
}

// --- 7. End card ---------------------------------------------------------------------------------------
const S7 = 4.2;
function end(): SceneDoc {
  const ids = ["nell", "otto", "maya", "kai", "pip"];
  const chips = ["Open JSON format", "Remotion", "Lip sync", "Visual editor", "CLI"];
  const chipArt = (t: string) => {
    const w = t.length * 19 + 56;
    return `<g font-family="${FONT}"><rect x="${-w / 2}" y="-30" width="${w}" height="60" rx="30" fill="${C.cream}" opacity="0.95"/>
      <text x="0" y="11" text-anchor="middle" font-size="30" font-weight="700" fill="${C.indigo}">${t}</text></g>`;
  };
  const widths = chips.map((t) => t.length * 19 + 56 + 24);
  let cx = W / 2 - widths.reduce((a, b) => a + b, 0) / 2;
  const chipXs = widths.map((w) => { const x = cx + w / 2; cx += w; return x; });
  return scene("end", S7, stage(), {
    actors: ids.map((id, i) => ({ id, character: id, x: 560 + i * 200, y: GROUND + 20, scale: 0.62, z: 1 })),
    props: [
      { id: "logo", art: wordmark(180), x: W / 2, y: 200, z: 50, parallax: 0, scale: 0 },
      { id: "fn", art: `<text x="0" y="0" text-anchor="middle" font-family="${MONO}" font-size="44" fill="${C.cream}"><tspan fill="${C.sun}">pose</tspan> = f(document, time)</text>`, x: W / 2, y: 330, z: 50, parallax: 0, opacity: 0 },
      { id: "repo", art: `<g font-family="${FONT}"><rect x="-520" y="-40" width="1040" height="80" rx="40" fill="${C.sun}"/>
        <text x="0" y="14" text-anchor="middle" font-size="40" font-weight="800" fill="${C.ink}">${REPO}</text></g>`, x: W / 2, y: 530, z: 50, parallax: 0, scale: 0 },
      ...chips.map((t, i) => ({ id: `chip${i}`, art: chipArt(t), x: chipXs[i], y: 420, z: 50, parallax: 0, scale: 0 })),
    ],
    tracks: {
      "props.logo.scale": pop(0.35),
      "props.fn.opacity": fade(0.9),
      ...Object.fromEntries(chips.map((_, i) => [`props.chip${i}.scale`, pop(1.1 + i * 0.1)])),
      "props.repo.scale": pop(1.75),
    },
    script: [
      wipeIn(),
      ...idle(...ids),
      ...ids.map((id) => emo(0, id, "happy", 0)),
      ...ids.map((id) => ({ at: 0, actor: id, action: "pose", control: "view", value: "front", duration: 0 }) as ActionDef),
      ...ids.map((id, i) => play(1.8 + i * 0.1, id, i % 2 ? "cheer" : "wave", { duration: 2.0 })),
      fx(0.4, "sparkle", { x: 560, y: 160 }), fx(0.5, "sparkle", { x: 1380, y: 260 }),
      { at: S7 - 0.5, action: "transition", type: "fade", mode: "out", duration: 0.5, color: C.indigo },
    ] as ActionDef[],
  });
}

export const shots = [title(), lineup(), talk(), walks(), fight(), night(), end()];

/** Each shot's start on the timeline (s). */
const starts = shots.reduce<number[]>((a, s, i) => [...a, i ? a[i - 1] + shots[i - 1].duration : 0], []);
const at = (shot: number, t: number) => starts[shot] + t;
export const sounds: { file: string; at: number; volume: number; loop?: boolean }[] = [
  { file: audio.files.music, at: 0, volume: 0.32 },
  { file: audio.files.sparkle, at: 0.15, volume: 0.5 },
  ...[1, 2, 3, 4, 5, 6].map((i) => ({ file: audio.files.whoosh, at: at(i, 0) - 0.3, volume: 0.45 })),
  ...[0, 1, 2, 3, 4].map((i) => ({ file: audio.files.pop, at: at(1, 0.35 + i * 0.17), volume: 0.5 })),
  { file: audio.files.maya, at: at(2, LINE), volume: 1 },
  { file: audio.files.steps, at: at(3, 0.2), volume: 0.35 },
  { file: audio.files.bell, at: at(4, 0.15), volume: 0.5 },
  { file: audio.files.punch, at: at(4, LAND - 0.03), volume: 0.9 },
  { file: audio.files.birdie, at: at(4, LAND + 0.7), volume: 0.45 },
  { file: audio.files.crickets, at: at(5, 0), volume: 0.4 },
  { file: audio.files.sparkle, at: at(5, 2.3), volume: 0.35 },
  { file: audio.files.sting, at: at(6, 0.3), volume: 0.6 },
];
