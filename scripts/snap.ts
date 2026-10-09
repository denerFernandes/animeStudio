/**
 * Dev tool: renders a contact sheet of a character clip or scene to PNG.
 * Usage: tsx scripts/snap.ts <out.png> [clip] [t1,t2,...] [scale]
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateScene, frameToSVG, parseToon, previewScene } from "@animestudio/core";
import { pip } from "../examples/characters/pip";

const [out = "sheet.png", clip = "idle", timesArg = "0,0.2,0.4,0.6", scaleArg = "1"] = process.argv.slice(2);
const doc = parseToon(pip);
const scene = previewScene(doc, { clip: clip === "rest" ? null : clip, width: 360, height: 420, duration: 6, scale: Number(scaleArg) });
const dir = mkdtempSync(join(tmpdir(), "snap-"));
const pngs = timesArg.split(",").map((t, i) => {
  const svg = frameToSVG(evaluateScene(scene, Number(t)));
  const svgPath = join(dir, `f${i}.svg`);
  const pngPath = join(dir, `f${i}.png`);
  writeFileSync(svgPath, svg);
  execFileSync("rsvg-convert", ["-o", pngPath, svgPath]);
  return pngPath;
});
execFileSync("magick", [...pngs, "+append", out]);
console.log(out);
