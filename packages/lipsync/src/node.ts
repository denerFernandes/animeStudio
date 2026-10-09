import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { type LipsyncDoc, type MouthCue, LipsyncSchema, cuesFromAmplitude } from "@animestudio/core";
import { alignTextToAudio } from "./align";

const run = promisify(execFile);

export interface PcmAudio {
  samples: Float32Array;
  sampleRate: number;
}

/** Decodes a PCM WAV file (8/16/24/32-bit integer or 32-bit float) to mono float samples. */
export function decodeWav(buffer: Uint8Array): PcmAudio {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const tag = (o: number) => String.fromCharCode(buffer[o], buffer[o + 1], buffer[o + 2], buffer[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("Not a WAV file");
  let offset = 12;
  let format = 1;
  let channels = 1;
  let sampleRate = 44100;
  let bits = 16;
  while (offset + 8 <= buffer.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
      if (format === 0xfffe) format = view.getUint16(body + 24, true);
    } else if (id === "data") {
      const bytes = bits / 8;
      const frames = Math.floor(Math.min(size, buffer.length - body) / (bytes * channels));
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) {
          const o = body + (i * channels + c) * bytes;
          let v: number;
          if (format === 3 && bits === 32) v = view.getFloat32(o, true);
          else if (bits === 8) v = (view.getUint8(o) - 128) / 128;
          else if (bits === 16) v = view.getInt16(o, true) / 32768;
          else if (bits === 24) v = ((view.getUint8(o) | (view.getUint8(o + 1) << 8) | (view.getInt8(o + 2) << 16)) / 8388608);
          else v = view.getInt32(o, true) / 2147483648;
          sum += v;
        }
        samples[i] = sum / channels;
      }
      return { samples, sampleRate };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("WAV file has no data chunk");
}

export function readWav(path: string): PcmAudio {
  return decodeWav(readFileSync(path));
}

/** Audio duration in seconds. */
export function wavDuration(path: string): number {
  const { samples, sampleRate } = readWav(path);
  return samples.length / sampleRate;
}

export interface RhubarbOptions {
  /** Known dialog text — improves accuracy (English recognizer only). */
  dialog?: string;
  /**
   * `pocketSphinx`: English speech recognition (best for English).
   * `phonetic`: language-independent (use for Portuguese, Spanish, …).
   * Default: chosen from `language`.
   */
  recognizer?: "pocketSphinx" | "phonetic";
  /** BCP-47 language of the speech (default "en"). Non-English uses the phonetic recognizer. */
  language?: string;
  /** Path to the rhubarb binary (default: $RHUBARB_PATH, PATH, then ~/.local/bin). */
  binary?: string;
}

/** Locates the Rhubarb binary, or returns undefined. */
export function findRhubarb(binary = process.env.RHUBARB_PATH): string | undefined {
  if (binary) return binary.includes("/") ? (existsSync(binary) ? binary : undefined) : findOnPath(binary);
  return findOnPath("rhubarb") ?? [join(homedir(), ".local/bin/rhubarb"), "/opt/homebrew/bin/rhubarb", "/usr/local/bin/rhubarb"].find((p) => existsSync(p));
}

function findOnPath(name: string): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    const p = join(dir, name);
    if (dir && existsSync(p)) return p;
  }
  return undefined;
}

export const hasRhubarb = (binary?: string): boolean => findRhubarb(binary) !== undefined;

/** Runs Rhubarb Lip Sync on an audio file (WAV or OGG). Requires Rhubarb to be installed. */
export async function rhubarb(audioPath: string, opts: RhubarbOptions = {}): Promise<LipsyncDoc> {
  const binary = findRhubarb(opts.binary);
  if (!binary) {
    throw new Error(
      "Rhubarb not found. Install it from https://github.com/DanielSWolf/rhubarb-lip-sync/releases " +
        "and put it on PATH (or ~/.local/bin), or set RHUBARB_PATH. Alternatives: alignTextToAudio() or cuesFromAmplitude().",
    );
  }
  const english = (opts.language ?? "en").toLowerCase().startsWith("en");
  const recognizer = opts.recognizer ?? (english ? "pocketSphinx" : "phonetic");
  const dir = await mkdtemp(join(tmpdir(), "rhubarb-"));
  try {
    const args = ["-f", "json", "--extendedShapes", "GHX", "-r", recognizer, "--quiet"];
    if (opts.dialog && recognizer === "pocketSphinx") {
      const dialogPath = join(dir, "dialog.txt");
      await writeFile(dialogPath, opts.dialog);
      args.push("-d", dialogPath);
    }
    const out = join(dir, "out.json");
    args.push("-o", out, audioPath);
    await run(binary, args);
    const doc = LipsyncSchema.parse(JSON.parse(await readFile(out, "utf8")));
    return { mouthCues: doc.mouthCues };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export type LipsyncEngine = "auto" | "rhubarb" | "align" | "amplitude";

/**
 * One-stop lip sync for a WAV file:
 * - `rhubarb`: best for recorded audio (needs Rhubarb);
 * - `align`: text + audio, no external tools;
 * - `amplitude`: audio only, no external tools;
 * - `auto`: rhubarb if installed, else align (with text) or amplitude.
 */
export async function lipsyncFile(
  audioPath: string,
  opts: { text?: string; engine?: LipsyncEngine; language?: string } = {},
): Promise<LipsyncDoc> {
  let engine = opts.engine ?? "auto";
  if (engine === "auto") engine = hasRhubarb() ? "rhubarb" : opts.text ? "align" : "amplitude";
  if (engine === "rhubarb") return rhubarb(audioPath, { dialog: opts.text, language: opts.language });
  const { samples, sampleRate } = readWav(audioPath);
  let cues: MouthCue[];
  if (engine === "align") {
    if (!opts.text) throw new Error("The align engine needs the dialog text");
    cues = alignTextToAudio(opts.text, samples, sampleRate);
  } else cues = cuesFromAmplitude(samples, sampleRate);
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return { mouthCues: cues.map((c) => ({ start: r(c.start), end: r(c.end), value: c.value })) };
}
