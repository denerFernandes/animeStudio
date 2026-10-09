import type { ActionDef, SceneDoc, ToonDoc } from "./format/schema";
import { type CompiledScene, compileScene } from "./scene";

export interface PreviewOptions {
  /** Clip to loop (default: first clip, if any). Use null for the rest pose. */
  clip?: string | null;
  width?: number;
  height?: number;
  fps?: number;
  duration?: number;
  scale?: number;
  background?: string;
  /** Extra script actions for the single actor (id "actor"). */
  script?: ActionDef[];
}

/** Builds a one-character scene, handy for previews, tests and thumbnails. */
export function previewSceneDoc(toon: ToonDoc, opts: PreviewOptions = {}): SceneDoc {
  const width = opts.width ?? 800;
  const height = opts.height ?? 600;
  const clip = opts.clip === undefined ? Object.keys(toon.clips ?? {})[0] : opts.clip;
  const duration = opts.duration ?? (clip && toon.clips?.[clip] ? Math.max(toon.clips[clip].duration * 2, 2) : 2);
  const script: ActionDef[] = [];
  if (clip) script.push({ at: 0, actor: "actor", action: "play", clip, loop: true, fadeIn: 0 });
  script.push(...(opts.script ?? []));
  return {
    format: "toon-scene",
    version: 1,
    width,
    height,
    fps: opts.fps ?? 60,
    duration,
    background: opts.background ?? "#F3F6FA",
    characters: { [toon.name]: `${toon.name}.toon.json` },
    actors: [{ id: "actor", character: toon.name, x: width / 2, y: height * 0.85, scale: opts.scale ?? 1 }],
    script,
  };
}

export function previewScene(toon: ToonDoc, opts: PreviewOptions = {}): CompiledScene {
  return compileScene(previewSceneDoc(toon, opts), { characters: { [toon.name]: toon } });
}
