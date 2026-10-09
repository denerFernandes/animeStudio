import type { SceneDoc, SequenceDoc, ShotTransitionDef } from "./format/schema";
import type { Vec2 } from "./math";
import { type RenderFrame, type RenderNode, prefixFrame } from "./render";
import { type CompiledScene, type SceneAssets, SceneError, compileScene, evaluateScene, screenPoint } from "./scene";
import { transitionCoverage, transitionMarkup } from "./transitions";

/**
 * Sequences: a list of shots (scenes, optionally trimmed) joined by transitions — cuts,
 * crossfades, fades through a color, cartoon irises, wipes and flashes. A sequence is evaluated
 * like a scene: `evaluateSequence(seq, t)` is pure, so it renders in any order.
 */

export interface CompiledShot {
  index: number;
  sceneId: string;
  scene: CompiledScene;
  /** Start time inside the scene. */
  from: number;
  duration: number;
  /** Global start / end. */
  start: number;
  end: number;
  transition: Required<Pick<ShotTransitionDef, "type" | "duration">> & ShotTransitionDef;
}

export interface CompiledSequence {
  doc: SequenceDoc;
  width: number;
  height: number;
  fps: number;
  duration: number;
  shots: CompiledShot[];
}

export interface SequenceAssets {
  /** Scenes by the ids used in `sequence.scenes`: documents with their assets, or compiled scenes. */
  scenes: Record<string, { doc: SceneDoc; assets: SceneAssets } | CompiledScene>;
}

const DEFAULT_DURATION: Record<ShotTransitionDef["type"], number> = {
  cut: 0,
  crossfade: 0.6,
  fade: 0.8,
  iris: 1.2,
  wipe: 0.8,
  flash: 0.3,
};

/** Lays out shots on the timeline (crossfades overlap; other transitions happen at the cut). */
export function layoutShots(doc: SequenceDoc, sceneDuration: (id: string) => number) {
  let cursor = 0;
  return doc.shots.map((shot, index) => {
    if (!(shot.scene in doc.scenes)) throw new SceneError(`unknown scene "${shot.scene}"`, `shots[${index}]`);
    const from = shot.from ?? 0;
    const duration = shot.duration ?? Math.max(0.001, sceneDuration(shot.scene) - from);
    const tr = shot.transition ?? { type: "cut" as const };
    const transition = { ...tr, duration: tr.duration ?? DEFAULT_DURATION[tr.type] };
    const start = index > 0 && transition.type === "crossfade" ? Math.max(0, cursor - transition.duration) : cursor;
    const end = start + duration;
    cursor = end;
    return { index, sceneId: shot.scene, from, duration, start, end, transition };
  });
}

/** Total length (s) of a sequence given its scene documents (no compilation needed). */
export function sequenceDuration(doc: SequenceDoc, scenes: Record<string, SceneDoc>): number {
  const shots = layoutShots(doc, (id) => scenes[id].duration);
  return shots[shots.length - 1].end;
}

export function compileSequence(doc: SequenceDoc, assets: SequenceAssets): CompiledSequence {
  const compiled = new Map<string, CompiledScene>();
  const sceneOf = (id: string): CompiledScene => {
    let c = compiled.get(id);
    if (!c) {
      const src = assets.scenes[id];
      if (!src) throw new SceneError(`scene "${id}" was not provided`, `scenes.${id}`);
      c = "doc" in src && "assets" in src ? compileScene(src.doc, src.assets) : (src as CompiledScene);
      compiled.set(id, c);
    }
    return c;
  };
  const layout = layoutShots(doc, (id) => sceneOf(id).duration);
  const shots: CompiledShot[] = layout.map((l) => ({ ...l, scene: sceneOf(l.sceneId) }));
  return { doc, width: doc.width, height: doc.height, fps: doc.fps, duration: shots[shots.length - 1].end, shots };
}

function shotFrame(shot: CompiledShot, t: number): RenderFrame {
  return evaluateScene(shot.scene, shot.from + Math.max(0, Math.min(shot.duration, t - shot.start)));
}

function backgroundNode(frame: RenderFrame, key: string): RenderNode[] {
  return frame.background ? [{ kind: "markup", key, markup: `<rect width="${frame.width}" height="${frame.height}" fill="${frame.background}"/>` }] : [];
}

/** Evaluates a sequence frame at global time t. */
export function evaluateSequence(seq: CompiledSequence, t: number): RenderFrame {
  const { shots } = seq;
  let i = shots.findIndex((s) => t < s.end);
  if (i < 0) i = shots.length - 1;
  const shot = shots[i];
  const next = shots[i + 1];

  // Crossfade: the next shot fades in over this one.
  if (next && next.transition.type === "crossfade" && t >= next.start) {
    const a = shotFrame(shot, t);
    const b = prefixFrame(shotFrame(next, t), `s${next.index}`);
    const w = transitionCoverage("out", (t - next.start) / Math.max(1e-3, next.transition.duration));
    return {
      ...a,
      defs: a.defs + b.defs,
      nodes: [...a.nodes, { kind: "group", key: `shot-${next.index}`, opacity: w, children: [...backgroundNode(b, "bg"), ...b.nodes] }],
    };
  }

  const frame = shotFrame(shot, t);
  // Through-color transitions: the second half covers the start of this shot, the first half
  // covers the end of the previous one.
  const overlays: string[] = [];
  const add = (owner: CompiledShot, tr: CompiledShot["transition"], mode: "in" | "out", u: number) => {
    if (tr.type === "cut" || tr.type === "crossfade" || tr.duration <= 0) return;
    const center: Vec2 =
      typeof tr.target === "string"
        ? screenPoint(owner.scene, tr.target, owner.from + (t - owner.start))
        : tr.target ?? [seq.width / 2, seq.height / 2];
    overlays.push(
      transitionMarkup({
        type: tr.type,
        coverage: transitionCoverage(mode, u),
        uncovering: mode === "in",
        color: tr.color ?? (tr.type === "flash" ? "#FFFFFF" : "#000000"),
        direction: tr.direction ?? "right",
        center,
        width: seq.width,
        height: seq.height,
        id: `seq${owner.index}${mode}`,
      }),
    );
  };
  const half = (s: CompiledShot) => s.transition.duration / 2;
  if (i > 0 && t - shot.start < half(shot)) add(shot, shot.transition, "in", (t - shot.start) / half(shot));
  if (next && shot.end - t < half(next)) add(shot, next.transition, "out", 1 - (shot.end - t) / half(next));
  if (!overlays.length) return frame;
  return { ...frame, nodes: [...frame.nodes, { kind: "markup", key: "sequence-transition", markup: overlays.join("") }] };
}

export interface SequenceAudioEvent {
  id: string;
  src: string;
  /** Global start (s). */
  start: number;
  volume: number;
  /** Seconds to skip at the beginning of the file (event started before the shot). */
  trimStart: number;
  /** Max playing time (s) before the shot ends. */
  maxDuration: number;
}

/** All audio of a sequence on the global timeline, cut at shot boundaries. */
export function sequenceAudio(seq: CompiledSequence): SequenceAudioEvent[] {
  const out: SequenceAudioEvent[] = [];
  for (const shot of seq.shots) {
    for (const ev of shot.scene.audio) {
      const local = ev.start - shot.from;
      if (local >= shot.duration) continue;
      const trimStart = Math.max(0, -local);
      out.push({
        id: ev.id,
        src: ev.src,
        volume: ev.volume,
        start: shot.start + Math.max(0, local),
        trimStart,
        maxDuration: shot.duration - Math.max(0, local),
      });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}
