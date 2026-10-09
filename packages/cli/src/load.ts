import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { LipsyncDoc, SceneAssets, SceneDoc, ToonDoc } from "@animestudio/core";

export const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

/** Loads the characters and lip sync files referenced by a scene (paths relative to the scene). */
export function loadSceneAssets(scenePath: string, scene: SceneDoc): SceneAssets {
  const base = dirname(resolve(scenePath));
  const characters: Record<string, ToonDoc> = {};
  for (const [id, path] of Object.entries(scene.characters)) characters[id] = readJson(resolve(base, path)) as ToonDoc;
  const lipsync: Record<string, LipsyncDoc> = {};
  for (const [id, path] of Object.entries(scene.lipsync ?? {})) lipsync[id] = readJson(resolve(base, path)) as LipsyncDoc;
  return { characters, lipsync };
}
