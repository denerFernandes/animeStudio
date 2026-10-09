import { spawn, execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import {
  type Diagnostic,
  type Raster,
  type RenderFrame,
  type SceneDoc,
  type SequenceDoc,
  DEBUG_STRIP,
  compileScene,
  compileSequence,
  diagnoseFrames,
  evaluateScene,
  evaluateSequence,
  findFlickers,
  readDebugStrip,
} from "@animestudio/core";
import { loadSceneAssets, readJson } from "./load";

/** A scene or sequence loaded from disk, evaluable per frame. */
export interface Evaluable {
  fps: number;
  width: number;
  height: number;
  duration: number;
  frameAt(index: number): RenderFrame;
}

export function loadEvaluable(path: string): Evaluable {
  const doc = readJson(path) as { format?: string };
  if (doc.format === "toon-sequence") {
    const seqDoc = doc as SequenceDoc;
    const base = dirname(resolve(path));
    const scenes = Object.fromEntries(
      Object.entries(seqDoc.scenes).map(([id, rel]) => {
        const scenePath = resolve(base, rel);
        const sceneDoc = readJson(scenePath) as SceneDoc;
        return [id, { doc: sceneDoc, assets: loadSceneAssets(scenePath, sceneDoc) }];
      }),
    );
    const seq = compileSequence(seqDoc, { scenes });
    return { fps: seq.fps, width: seq.width, height: seq.height, duration: seq.duration, frameAt: (i) => evaluateSequence(seq, i / seq.fps) };
  }
  const sceneDoc = doc as SceneDoc;
  const scene = compileScene(sceneDoc, loadSceneAssets(path, sceneDoc));
  return { fps: scene.fps, width: scene.width, height: scene.height, duration: scene.duration, frameAt: (i) => evaluateScene(scene, i / scene.fps) };
}

/** Library-side diagnostics over a frame range. */
export function debugDocument(path: string, from = 0, to?: number): Diagnostic[] {
  const ev = loadEvaluable(path);
  const first = Math.round(from * ev.fps);
  const last = Math.min(Math.ceil(ev.duration * ev.fps) - 1, to !== undefined ? Math.round(to * ev.fps) : Infinity);
  const frames: RenderFrame[] = [];
  const times: number[] = [];
  for (let i = first; i <= last; i++) {
    frames.push(ev.frameAt(i));
    times.push(i / ev.fps);
  }
  return diagnoseFrames(frames, times).map((d) => ({ ...d, frame: d.frame + first }));
}

/** Streams decoded video frames (rgb24) through ffmpeg. */
async function readFrames(video: string, filter: string, w: number, h: number, onFrame: (img: Raster, index: number) => void) {
  const size = w * h * 3;
  await new Promise<void>((resolvePromise, reject) => {
    const ff = spawn("ffmpeg", ["-v", "error", "-i", video, "-vf", filter, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
    let buf = Buffer.alloc(0);
    let index = 0;
    ff.stdout.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= size) {
        onFrame({ width: w, height: h, data: new Uint8Array(buf.subarray(0, size)) }, index++);
        buf = buf.subarray(size);
      }
    });
    ff.on("error", (e) => reject(new Error(`ffmpeg is required for "toon doctor" (${e.message})`)));
    ff.on("close", (code) => (code === 0 ? resolvePromise() : reject(new Error(`ffmpeg exited with ${code}`))));
  });
}

export interface DoctorReport {
  frames: number;
  flickers: { frame: number; time: number; libStable: boolean }[];
  /** Present when the video was rendered with `debug`. */
  strip?: {
    frameMismatches: { frame: number; barcode: number }[];
    unpainted: { frame: number; time: number; key: string; filter?: string; opacity?: number }[];
    /** Sentinels skipped because their node was transparent or strongly blurred. */
    unverifiable: number;
  };
}

/**
 * Analyzes a rendered video against its document: A→B→A flickers, whether the library output was
 * stable at those frames (→ browser paint problem) and, for debug renders, exactly which nodes the
 * browser did not paint.
 */
export async function doctor(video: string, docPath: string): Promise<DoctorReport> {
  const ev = loadEvaluable(docPath);
  const [vw, vh] = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", video])
    .toString()
    .trim()
    .split(",")
    .map(Number);

  // 1. Flicker detection on downscaled frames.
  const small: Raster[] = [];
  const sw = 192;
  const sh = Math.round((sw * vh) / vw / 2) * 2;
  await readFrames(video, `scale=${sw}:${sh}`, sw, sh, (img) => small.push(img));
  const flickerFrames = findFlickers(small);
  const libString = (i: number) => JSON.stringify(ev.frameAt(i).nodes.map((n) => n.key));
  const flickers = flickerFrames.map((i) => ({
    frame: i,
    time: i / ev.fps,
    // The node set is the same before/at/after → the library did not drop anything.
    libStable: libString(i - 1) === libString(i) && libString(i) === libString(i + 1),
  }));

  // 2. Debug strip (if present): barcode + sentinels at native resolution.
  const stripH = Math.round((DEBUG_STRIP * vh) / ev.height);
  const full: Raster = { width: vw, height: vh, data: new Uint8Array(vw * vh * 3) };
  const mismatches: { frame: number; barcode: number }[] = [];
  const unpainted: { frame: number; time: number; key: string; filter?: string; opacity?: number }[] = [];
  let validBarcodes = 0;
  let unverifiable = 0;
  await readFrames(video, `crop=${vw}:${stripH}:0:${vh - stripH}`, vw, stripH, (strip, index) => {
    full.data.set(strip.data, (vh - stripH) * vw * 3);
    const expected = ev.frameAt(index);
    const reading = readDebugStrip(full, expected);
    if (reading.frameIndex === index) validBarcodes++;
    else mismatches.push({ frame: index, barcode: reading.frameIndex });
    for (const key of reading.missing) {
      const node = expected.nodes.find((n) => n.key === key);
      // Sentinels of transparent or strongly blurred nodes cannot be verified (their color fades).
      const opacity = node && "opacity" in node ? node.opacity : undefined;
      const blur = node && "filter" in node && node.filter ? Number(/blur\(([\d.]+)px\)/.exec(node.filter)?.[1] ?? 0) : 0;
      if ((opacity !== undefined && opacity < 0.6) || blur >= 2) {
        unverifiable++;
        continue;
      }
      unpainted.push({
        frame: index,
        time: index / ev.fps,
        key,
        filter: node && "filter" in node ? node.filter : undefined,
        opacity: node && "opacity" in node ? node.opacity : undefined,
      });
    }
  });
  const isDebug = validBarcodes > small.length * 0.5;
  return { frames: small.length, flickers, strip: isDebug ? { frameMismatches: mismatches, unpainted, unverifiable } : undefined };
}
