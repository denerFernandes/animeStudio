import {
  type CompiledScene,
  type CompiledSequence,
  type SceneAssets,
  type SceneDoc,
  type SequenceDoc,
  compileScene,
  compileSequence,
  evaluateScene,
  evaluateSequence,
  sequenceAudio,
  sequenceDuration,
  withDebugOverlay,
} from "@animestudio/core";
import { ToonFrame } from "@animestudio/react";
import { bakeRigidBodies, sceneHasBodies } from "@animestudio/rigid";
import { Audio } from "@remotion/media";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import {
  AbsoluteFill,
  Sequence,
  continueRender,
  delayRender,
  getRemotionEnvironment,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

// A type alias (not an interface) so it satisfies Remotion's `Record<string, unknown>` props.
export type ToonCompositionProps = {
  scene: SceneDoc;
  assets: SceneAssets;
  /** Maps an audio path from the scene's `audio` map to a URL (default: `staticFile`). */
  resolveAudio?: (src: string) => string;
  /** Mute all scene audio. */
  muted?: boolean;
  /** Debug render: per-node sentinels + frame barcode, readable by `toon doctor`. */
  debug?: boolean;
  /**
   * How long each frame waits for Chrome to finish painting before capture: animation frames and
   * then milliseconds (default 4 and 60; heavy SVG — long extruded text, morphology filters —
   * rendered with high concurrency may need more).
   */
  paintSettle?: { frames?: number; ms?: number };
};

/**
 * Renders a toon scene inside a Remotion composition.
 * Every frame is evaluated from scratch (`pose = f(scene, time)`), so parallel and
 * out-of-order rendering is safe. Rigid bodies are baked once per tab before rendering.
 */
export function ToonComposition({ scene, assets, resolveAudio = staticFile, muted, debug, paintSettle }: ToonCompositionProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const compiled = useMemo(() => compileScene(scene, assets), [scene, assets]);
  const ready = usePreparedScene(compiled);
  usePaintSettled(frame, paintSettle?.frames, paintSettle?.ms);
  const rendered = useMemo(() => {
    if (!ready) return null;
    const f = evaluateScene(ready, frame / fps);
    return debug ? withDebugOverlay(f, { frameIndex: frame, time: frame / fps }) : f;
  }, [ready, frame, fps, debug]);

  if (!ready || !rendered) return null;
  return (
    <AbsoluteFill>
      <ToonFrame key={frameKey(frame)} frame={rendered} width="100%" height="100%" />
      {muted
        ? null
        : ready.audio.map((a, i) => (
            <Sequence key={`${a.id}-${i}`} from={Math.round(a.start * fps)} layout="none">
              <Audio src={resolveAudio(a.src)} volume={a.volume} />
            </Sequence>
          ))}
    </AbsoluteFill>
  );
}

/**
 * While rendering, every frame mounts a fresh SVG tree. Updating the previous frame's DOM in place
 * occasionally left a static element unpainted in Chrome's capture when blurred layers were
 * composited next to it (`toon doctor` reported "library output stable → browser paint problem").
 * In the Studio/Player the tree is reused for speed.
 */
const frameKey = (frame: number) => (getRemotionEnvironment().isRendering ? frame : "live");

/**
 * Holds each frame's capture for a few animation frames after it renders. Filtered / masked SVG
 * content is rasterized asynchronously by Chrome; capturing immediately sometimes missed those
 * layers, making elements flicker in the video.
 */
function usePaintSettled(frame: number, frames = 4, ms = 60) {
  useLayoutEffect(() => {
    const handle = delayRender(`Paint settle (frame ${frame})`);
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let left = frames;
    const tick = () => {
      if (--left <= 0) timer = setTimeout(() => continueRender(handle), ms);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
      continueRender(handle);
    };
  }, [frame, frames, ms]);
}

/** Bakes rigid bodies asynchronously, holding the render until done. */
function usePreparedScene(compiled: CompiledScene): CompiledScene | null {
  const needsBake = sceneHasBodies(compiled);
  const [ready, setReady] = useState<CompiledScene | null>(needsBake ? null : compiled);
  useEffect(() => {
    if (!needsBake) {
      setReady(compiled);
      return;
    }
    const handle = delayRender("Baking rigid bodies");
    let alive = true;
    bakeRigidBodies(compiled)
      .then((s) => alive && setReady(s))
      .finally(() => continueRender(handle));
    return () => {
      alive = false;
    };
  }, [compiled, needsBake]);
  return ready;
}

/** Composition metadata derived from a scene (use in `calculateMetadata` or as props). */
export function toonMetadata(scene: SceneDoc) {
  return {
    durationInFrames: Math.ceil(scene.duration * scene.fps),
    fps: scene.fps,
    width: scene.width,
    height: scene.height,
  };
}

export type ToonSequenceCompositionProps = {
  sequence: SequenceDoc;
  /** Scene documents and their assets by the ids used in `sequence.scenes`. */
  scenes: Record<string, { doc: SceneDoc; assets: SceneAssets }>;
  resolveAudio?: (src: string) => string;
  muted?: boolean;
  /** Debug render: per-node sentinels + frame barcode, readable by `toon doctor`. */
  debug?: boolean;
  /** How long each frame waits for the paint before capture (see `ToonCompositionProps`). */
  paintSettle?: { frames?: number; ms?: number };
};

/**
 * Renders a multi-shot sequence (cuts, crossfades, fades, irises, wipes, flashes) in Remotion.
 * Audio of each shot is cut at the shot boundary.
 */
export function ToonSequenceComposition({ sequence, scenes, resolveAudio = staticFile, muted, debug, paintSettle }: ToonSequenceCompositionProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const compiled = useMemo(() => compileSequence(sequence, { scenes }), [sequence, scenes]);
  const ready = usePreparedSequence(compiled);
  const rendered = useMemo(() => {
    if (!ready) return null;
    const f = evaluateSequence(ready, frame / fps);
    return debug ? withDebugOverlay(f, { frameIndex: frame, time: frame / fps }) : f;
  }, [ready, frame, fps, debug]);
  const audio = useMemo(() => (ready ? sequenceAudio(ready) : []), [ready]);
  usePaintSettled(frame, paintSettle?.frames, paintSettle?.ms);
  if (!ready || !rendered) return null;
  return (
    <AbsoluteFill>
      <ToonFrame key={frameKey(frame)} frame={rendered} width="100%" height="100%" />
      {muted
        ? null
        : audio.map((a, i) => (
            <Sequence key={`${a.id}-${i}`} from={Math.round(a.start * fps)} durationInFrames={Math.max(1, Math.round(a.maxDuration * fps))} layout="none">
              <Audio src={resolveAudio(a.src)} volume={a.volume} trimBefore={Math.round(a.trimStart * fps)} />
            </Sequence>
          ))}
    </AbsoluteFill>
  );
}

function usePreparedSequence(seq: CompiledSequence): CompiledSequence | null {
  const needsBake = seq.shots.some((s) => sceneHasBodies(s.scene));
  const [ready, setReady] = useState<CompiledSequence | null>(needsBake ? null : seq);
  useEffect(() => {
    if (!needsBake) {
      setReady(seq);
      return;
    }
    const handle = delayRender("Baking rigid bodies");
    let alive = true;
    const unique = [...new Set(seq.shots.map((s) => s.scene))];
    Promise.all(unique.map((s) => bakeRigidBodies(s)))
      .then(() => alive && setReady({ ...seq }))
      .finally(() => continueRender(handle));
    return () => {
      alive = false;
    };
  }, [seq, needsBake]);
  return ready;
}

/** Composition metadata for a sequence (scene documents give each shot's length). */
export function toonSequenceMetadata(sequence: SequenceDoc, scenes: Record<string, { doc: SceneDoc }>) {
  const duration = sequenceDuration(sequence, Object.fromEntries(Object.entries(scenes).map(([k, v]) => [k, v.doc])));
  return {
    durationInFrames: Math.ceil(duration * sequence.fps),
    fps: sequence.fps,
    width: sequence.width,
    height: sequence.height,
  };
}
