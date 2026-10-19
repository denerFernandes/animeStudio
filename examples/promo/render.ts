/**
 * Renders the promo without a browser: frameToSVG → rsvg-convert → ffmpeg, then mixes the sounds.
 *
 *   npx tsx examples/promo/render.ts preview 0:1.5,2:2         (shot:time list → contact sheet)
 *   npx tsx examples/promo/render.ts video
 */
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { evaluateScene, frameToSVG } from "@animestudio/core";
import { prepareScene } from "@animestudio/rigid";
import { H, W } from "./look";
import { FPS, characters, shots, sounds } from "./shots";

const run = promisify(execFile);
const dir = import.meta.dirname;
const work = join(dir, "out", "work");
mkdirSync(work, { recursive: true });

async function pool<T>(items: T[], n: number, f: (x: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) { const i = next++; await f(items[i], i); } }));
}

const scenes = await Promise.all(shots.map((s) => prepareScene(s, { characters })));
const frame = async (shot: number, t: number, png: string) => {
  const svg = png.replace(/\.png$/, ".svg");
  writeFileSync(svg, frameToSVG(evaluateScene(scenes[shot], t)));
  await run("rsvg-convert", ["-w", String(W), "-h", String(H), "-o", png, svg]);
};

const [mode = "preview", arg] = process.argv.slice(2);
if (mode === "preview") {
  const picks = (arg ?? "0:1.5").split(",").map((s) => s.split(":").map(Number) as [number, number]);
  const files: string[] = [];
  await pool(picks, 6, async ([s, t], i) => { const f = join(work, `p${i}.png`); await frame(s, t, f); files[i] = f; });
  const out = join(dir, "out", "preview.png");
  const rows: string[] = [];
  for (let i = 0; i < files.length; i += 3) {
    const r = join(work, `row${i}.png`);
    execFileSync("magick", [...files.slice(i, i + 3), "-resize", "640x", "+append", r]);
    rows.push(r);
  }
  execFileSync("magick", [...rows, "-append", out]);
  console.log(out);
} else {
  const frames = join(work, "frames");
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  const list: [number, number][] = [];
  shots.forEach((s, i) => { const n = Math.round(s.duration * FPS); for (let k = 0; k < n; k++) list.push([i, k / FPS]); });
  const total = list.length / FPS;
  const start = Date.now();
  await pool(list, 8, async ([s, t], i) => frame(s, t, join(frames, `${String(i).padStart(5, "0")}.png`)));
  console.log(`${list.length} frames (${total.toFixed(2)} s) in ${((Date.now() - start) / 1000).toFixed(1)} s`);
  const silent = join(work, "video.mp4");
  execFileSync("ffmpeg", ["-y", "-v", "error", "-framerate", String(FPS), "-i", join(frames, "%05d.png"),
    "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p", silent]);
  const chains = sounds.map((s, i) => `[${i}:a]aresample=44100,aformat=channel_layouts=stereo,volume=${s.volume},adelay=${Math.max(0, Math.round(s.at * 1000))}:all=1[s${i}]`);
  const graph = `${chains.join(";")};${sounds.map((_, i) => `[s${i}]`).join("")}amix=inputs=${sounds.length}:normalize=0:duration=longest,atrim=0:${total.toFixed(3)},afade=t=out:st=${(total - 0.8).toFixed(3)}:d=0.8,alimiter=limit=0.95[a]`;
  const mix = join(work, "mix.wav");
  execFileSync("ffmpeg", ["-y", "-v", "error", ...sounds.flatMap((s) => ["-i", s.file]), "-filter_complex", graph, "-map", "[a]", mix]);
  const out = join(dir, "animestudio-promo.mp4");
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", silent, "-i", mix, "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", out]);
  console.log(out);
}
