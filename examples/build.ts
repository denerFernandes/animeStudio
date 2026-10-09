/**
 * Builds the example assets:
 *  - examples/characters/pip.toon.json (from pip.ts)
 *  - examples/scenes/audio/*.wav (macOS `say` TTS) + *.cues.json (lip sync)
 *  - examples/scenes/hello.scene.json
 * Run: pnpm examples
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ActionDef, type SceneDoc, jsonSchemas, parseScene, parseToon } from "@animestudio/core";
import { lipsyncFile, wavDuration } from "@animestudio/lipsync/node";
import { pip } from "./characters/pip";

const root = dirname(fileURLToPath(import.meta.url));
const write = (path: string, data: unknown) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
  console.log("wrote", path);
};

// Character -------------------------------------------------------------------
const pipDoc = parseToon(pip);
write(join(root, "characters/pip.toon.json"), pipDoc);

// Schemas -----------------------------------------------------------------------
const schemas = jsonSchemas();
write(join(root, "../schemas/toon.schema.json"), schemas.toon);
write(join(root, "../schemas/scene.schema.json"), schemas.scene);
write(join(root, "../schemas/sequence.schema.json"), schemas.sequence);

// Dialog audio + lip sync ---------------------------------------------------------
const lines = {
  l1: { voice: "Flo (Português (Brasil))", pitch: 62, text: "Oi Bia! Quer brincar de bola comigo?" },
  l2: { voice: "Shelley (Português (Brasil))", pitch: 66, text: "Oba! Chuta pra mim!" },
  l3: { voice: "Shelley (Português (Brasil))", pitch: 66, text: "Que divertido! De novo!" },
} as const;

const audioDir = join(root, "scenes/audio");
mkdirSync(audioDir, { recursive: true });
const durations: Record<string, number> = {};
for (const [id, line] of Object.entries(lines)) {
  const wav = join(audioDir, `${id}.wav`);
  const cuesPath = join(audioDir, `${id}.cues.json`);
  if (!existsSync(wav) || process.argv.includes("--force")) {
    const aiff = join(audioDir, `${id}.aiff`);
    execFileSync("say", ["-v", line.voice, "-r", "185", "-o", aiff, `[[pbas ${line.pitch}]] ${line.text}`]);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", aiff, "-ar", "44100", "-ac", "1", wav]);
    rmSync(aiff);
  }
  write(cuesPath, await lipsyncFile(wav, { text: line.text, language: "pt" }));
  durations[id] = wavDuration(wav);
}

// Scene ---------------------------------------------------------------------------
const W = 1920;
const H = 1080;
const GROUND = 900;

const layers: SceneDoc["layers"] = [
  {
    id: "sky",
    parallax: 0,
    z: -100,
    art: `<defs><linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8FD3F4"/><stop offset="1" stop-color="#DFF4FB"/></linearGradient></defs><rect x="-200" y="-200" width="${W + 400}" height="${H + 400}" fill="url(#skyGrad)"/>`,
  },
  { id: "sun", parallax: 0.05, z: -90, art: `<circle cx="1640" cy="170" r="80" fill="#FFE27A"/><circle cx="1640" cy="170" r="110" fill="#FFE27A" opacity="0.25"/>` },
  {
    id: "clouds",
    parallax: 0.15,
    z: -80,
    art: ["<g fill='#fff' opacity='0.95'>", "<ellipse cx='300' cy='180' rx='110' ry='42'/><ellipse cx='370' cy='160' rx='80' ry='50'/>", "<ellipse cx='1080' cy='120' rx='130' ry='40'/><ellipse cx='1000' cy='105' rx='70' ry='40'/>", "</g>"].join(""),
  },
  {
    id: "hills",
    parallax: 0.5,
    z: -70,
    art: `<path d="M-400 ${GROUND - 60} Q 200 ${GROUND - 340} 700 ${GROUND - 120} T 1700 ${GROUND - 160} T 2500 ${GROUND - 90} L 2500 ${H + 300} L -400 ${H + 300} Z" fill="#8CCB6A"/>`,
  },
  {
    id: "ground",
    z: -60,
    art: `<path d="M-400 ${GROUND - 20} Q 960 ${GROUND - 50} 2400 ${GROUND - 20} L 2400 ${H + 400} L -400 ${H + 400} Z" fill="#6DB84F"/><path d="M-400 ${GROUND + 30} Q 960 ${GROUND + 10} 2400 ${GROUND + 30}" stroke="#5DA542" stroke-width="10" fill="none"/>`,
  },
  {
    id: "tree",
    z: -50,
    art: `<rect x="1660" y="${GROUND - 300}" width="40" height="300" rx="16" fill="#8A5A3B"/><circle cx="1680" cy="${GROUND - 340}" r="120" fill="#4FA34A"/><circle cx="1600" cy="${GROUND - 290}" r="70" fill="#4FA34A"/>`,
  },
];

const t0 = 2.7;
const t1 = t0 + durations.l1 + 0.35;
const t2 = t1 + durations.l2 + 0.25;
const kickHit = t2 + 0.32;
const t3 = t2 + 1.6;
const t4 = t3 + 1.3;
const end = t4 + durations.l3 + 1.2;

const script: ActionDef[] = [
  { at: 0, actor: "pip", action: "play", clip: "idle", loop: true, layer: -1, fadeIn: 0 },
  { at: 0, actor: "bia", action: "play", clip: "idle", loop: true, layer: -1, fadeIn: 0 },
  { at: 0, actor: "bia", action: "lookAt", target: "pip" },
  { at: 0.3, actor: "pip", action: "walkTo", x: 740, duration: 2.1 },
  { at: 1.2, actor: "pip", action: "lookAt", target: "bia" },
  { at: t0, actor: "pip", action: "say", audio: "l1", lipsync: "l1" },
  { at: t0, actor: "pip", action: "play", clip: "wave", duration: durations.l1 + 0.4, fadeIn: 0.3, fadeOut: 0.4 },
  { at: t1 - 0.2, actor: "bia", action: "pose", control: "emotion", value: "happy", duration: 0.35 },
  { at: t1, actor: "bia", action: "say", audio: "l2", lipsync: "l2" },
  { at: t2 - 0.3, actor: "pip", action: "lookAt", target: "ball" },
  { at: t2, actor: "pip", action: "play", clip: "kick", fadeIn: 0.1, fadeOut: 0.15 },
  { at: kickHit, prop: "ball", action: "impulse", vector: [1150, -1050] },
  { at: kickHit + 0.05, actor: "bia", action: "lookAt", target: "ball" },
  { at: kickHit + 0.1, action: "camera", x: 1080, y: 600, zoom: 1.12, duration: 1.4 },
  { at: t3, actor: "bia", action: "play", clip: "jump", fadeIn: 0.05, fadeOut: 0.1 },
  { at: t3 + 0.2, actor: "pip", action: "pose", control: "emotion", value: "happy", duration: 0.35 },
  { at: t3 + 0.9, action: "shake", duration: 0.35, amount: 6 },
  { at: t4 - 0.3, actor: "bia", action: "lookAt", target: "pip" },
  { at: t4 - 0.3, actor: "pip", action: "lookAt", target: "bia" },
  { at: t4, actor: "bia", action: "say", audio: "l3", lipsync: "l3" },
  { at: t4 + durations.l3 + 0.2, action: "camera", x: 960, y: 540, zoom: 1, duration: 1.2 },
];

const scene: SceneDoc = {
  $schema: "../../schemas/scene.schema.json",
  format: "toon-scene",
  version: 1,
  width: W,
  height: H,
  fps: 60,
  duration: Math.ceil(end * 10) / 10,
  background: "#DFF4FB",
  characters: { pip: "../characters/pip.toon.json" },
  audio: { l1: "audio/l1.wav", l2: "audio/l2.wav", l3: "audio/l3.wav" },
  lipsync: { l1: "audio/l1.cues.json", l2: "audio/l2.cues.json", l3: "audio/l3.cues.json" },
  world: { gravity: [0, 2200], ground: GROUND, walls: true },
  layers,
  actors: [
    { id: "pip", character: "pip", x: 380, y: GROUND, scale: 1.5 },
    {
      id: "bia",
      character: "pip",
      x: 1380,
      y: GROUND + 4,
      scale: 1.42,
      flip: true,
      seed: "bia",
      palette: { dress: "#3E7FE0", dressShade: "#2C5DAA", skin: "#F9BFD2", skinShade: "#F0A5BD" },
    },
  ],
  props: [
    {
      id: "ball",
      x: 905,
      y: GROUND - 34,
      art: `<circle r="34" fill="#F5D33F" stroke="#C99A12" stroke-width="4"/><path d="M-34 0 Q0 -18 34 0 M-34 0 Q0 18 34 0" stroke="#E2463B" stroke-width="7" fill="none"/>`,
      body: { type: "dynamic", shape: { circle: 34 }, restitution: 0.62, friction: 0.6, density: 1 },
    },
  ],
  script,
};

const lipsync = Object.fromEntries(
  Object.keys(lines).map((id) => [id, JSON.parse(readFileSync(join(audioDir, `${id}.cues.json`), "utf8"))]),
);
parseScene(scene, { characters: { pip: pipDoc }, lipsync });
write(join(root, "scenes/hello.scene.json"), scene);
