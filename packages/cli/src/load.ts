import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Issue, LipsyncDoc, SceneAssets, SceneDoc, ToonDoc } from "@animestudio/core";

export const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

/** Loads the characters and lip sync files referenced by a scene (paths relative to the scene). Throws on the first file that cannot be read. */
export function loadSceneAssets(scenePath: string, scene: SceneDoc): SceneAssets {
  const { assets, issues } = tryLoadSceneAssets(scenePath, scene);
  if (issues.length) throw new Error(`${issues[0].path}: ${issues[0].message}`);
  return assets;
}

/**
 * Loads a scene's assets, reporting every file that cannot be read or parsed as an issue at
 * `characters.<id>` / `lipsync.<id>` instead of throwing (for `toon validate`).
 */
export function tryLoadSceneAssets(scenePath: string, scene: SceneDoc): { assets: SceneAssets; issues: Issue[] } {
  const base = dirname(resolve(scenePath));
  const issues: Issue[] = [];
  const load = <T>(section: "characters" | "lipsync", id: string, rel: string): T | undefined => {
    try {
      return readJson(resolve(base, rel)) as T;
    } catch (e) {
      issues.push({ path: `${section}.${id}`, message: `cannot load "${rel}": ${(e as Error).message}`, severity: "error" });
      return undefined;
    }
  };
  const characters: Record<string, ToonDoc> = {};
  for (const [id, path] of Object.entries(scene.characters ?? {})) {
    const doc = load<ToonDoc>("characters", id, path);
    if (doc) characters[id] = doc;
  }
  const lipsync: Record<string, LipsyncDoc> = {};
  for (const [id, path] of Object.entries(scene.lipsync ?? {})) {
    const doc = load<LipsyncDoc>("lipsync", id, path);
    if (doc) lipsync[id] = doc;
  }
  return { assets: { characters, lipsync }, issues };
}
