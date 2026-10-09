import {
  type CompiledScene,
  type EvaluatedPose,
  type Rig,
  type RenderNode,
  type SceneDoc,
  type ToonDoc,
  actorPose,
  compileRig,
  compileScene,
  evaluatePose,
  normalizeTrack,
  renderCharacter,
} from "@animestudio/core";
import { useMemo, useRef } from "react";
import type { Mode } from "./store";

export interface Preview {
  rig: Rig | null;
  pose: EvaluatedPose | null;
  nodes: RenderNode[];
  onion: RenderNode[][];
  error: string | null;
  /** Time actually evaluated (loops are shown after physics has settled). */
  evalTime: number;
}

/**
 * Evaluates what the viewport shows with the same pipeline as final renders
 * (clips → controls → IK → baked physics). Behaviors are muted so the clip is seen as authored.
 */
export function usePreview(doc: ToonDoc, mode: Mode, clip: string | null, time: number, onion: boolean): Preview {
  const lastGood = useRef<{ rig: Rig; scene: CompiledScene | null } | null>(null);

  const compiled = useMemo(() => {
    try {
      const rig = compileRig(doc);
      let scene: CompiledScene | null = null;
      const clipDef = clip ? doc.clips?.[clip] : undefined;
      if (mode === "animate" && clip && clipDef) {
        const duration = clipDef.loop ? clipDef.duration * 3 : clipDef.duration + 1;
        const muted = Object.fromEntries((doc.behaviors ?? []).map((b) => [`actors.a.behaviors.${b.id}.mix`, [[0, 0]]]));
        const sceneDoc: SceneDoc = {
          format: "toon-scene",
          version: 1,
          width: 1000,
          height: 1000,
          fps: 60,
          duration,
          characters: { c: "c" },
          actors: [{ id: "a", character: "c" }],
          tracks: muted as SceneDoc["tracks"],
          script: [{ at: 0, actor: "a", action: "play", clip, loop: clipDef.loop ?? false, fadeIn: 0, fadeOut: 0, duration }],
        };
        scene = compileScene(sceneDoc, { characters: { c: doc } });
      }
      lastGood.current = { rig, scene };
      return { rig, scene, error: null as string | null };
    } catch (e) {
      return { rig: lastGood.current?.rig ?? null, scene: lastGood.current?.scene ?? null, error: (e as Error).message };
    }
  }, [doc, mode, clip]);

  return useMemo(() => {
    const { rig, scene, error } = compiled;
    if (!rig) return { rig: null, pose: null, nodes: [], onion: [], error, evalTime: time };
    if (mode === "rig" || !scene) {
      const tracks = rig.behaviors.map((b, index) => ({
        channel: `behaviors.${b.id}.mix`,
        ref: { kind: "behavior" as const, index },
        track: normalizeTrack([[0, 0]]),
      }));
      const pose = evaluatePose(rig, { time: 0, tracks });
      return { rig, pose, nodes: renderCharacter(rig, pose), onion: [], error, evalTime: 0 };
    }
    const clipDef = clip ? doc.clips?.[clip] : undefined;
    const offset = clipDef?.loop ? clipDef.duration * 2 : 0;
    const actor = scene.actors[0];
    const at = (t: number) => actorPose(scene, actor, Math.max(0, t + offset));
    const pose = at(time);
    const ghosts = onion ? [-0.12, 0.12].map((dt) => renderCharacter(rig, at(time + dt), `onion${dt}-`)) : [];
    return { rig, pose, nodes: renderCharacter(rig, pose), onion: ghosts, error, evalTime: time + offset };
  }, [compiled, mode, time, onion, clip, doc.clips]);
}
