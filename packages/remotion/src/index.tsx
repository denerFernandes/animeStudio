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
  frameToSVG,
  type RenderFrame,
  sequenceAudio,
  sequenceDuration,
  withDebugOverlay,
} from "@animestudio/core";
import { ToonFrame } from "@animestudio/react";
import { bakeRigidBodies, sceneHasBodies } from "@animestudio/rigid";
import { Audio } from "@remotion/media";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AbsoluteFill,
  Sequence,
  cancelRender,
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
  /**
   * While rendering, draw each frame into a canvas from its whole SVG document and capture only once
   * the canvas holds the complete picture. Heavy frames rendered by several tabs at once (many solid
   * parts, long markup) can otherwise be captured before Chrome has rasterized every layer — half
   * painted frames. Slower per frame; SVG drawn as an image uses installed fonts only and embedded
   * (data URI) pictures only. The Studio and the Player keep the live SVG.
   */
  raster?: boolean;
};

/**
 * Renders a toon scene inside a Remotion composition.
 * Every frame is evaluated from scratch (`pose = f(scene, time)`), so parallel and
 * out-of-order rendering is safe. Rigid bodies are baked once per tab before rendering.
 */
export function ToonComposition({ scene, assets, resolveAudio = staticFile, muted, debug, paintSettle, raster }: ToonCompositionProps) {
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
      {raster && getRemotionEnvironment().isRendering ? <RasterFrame frame={rendered} /> : <ToonFrame key={frameKey(frame)} frame={rendered} width="100%" height="100%" />}
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
    let gone = false;
    // (Text waits for its fonts.)
    const fonts = typeof document !== "undefined" && document.fonts ? document.fonts.ready : Promise.resolve();
    const tick = () => {
      if (--left <= 0) timer = setTimeout(() => continueRender(handle), ms);
      else raf = requestAnimationFrame(tick);
    };
    fonts.then(() => {
      if (!gone) raf = requestAnimationFrame(tick);
    });
    return () => {
      gone = true;
      cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
      continueRender(handle);
    };
  }, [frame, frames, ms]);
}

/**
 * A frame drawn into a canvas: its SVG document decoded as an image and drawn in one go on a
 * software canvas (pixels in memory, no GPU tiles), the capture held until it is there. Whatever
 * Chrome's compositor is doing in the other tabs, the captured canvas is the whole picture.
 */
function RasterFrame({ frame }: { frame: RenderFrame }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { width, height } = useVideoConfig();
  const svg = useMemo(() => frameToSVG(frame), [frame]);
  useLayoutEffect(() => {
    const handle = delayRender("Rasterizing the frame");
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      continueRender(handle);
    };
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const img = new Image();
    img.src = url;
    img
      .decode()
      .then(() => {
        const c = ref.current;
        if (done || !c) return;
        const k = window.devicePixelRatio || 1;
        c.width = Math.round(width * k);
        c.height = Math.round(height * k);
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("no 2D canvas context");
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        finish();
      })
      .catch((e: unknown) => {
        if (!done) cancelRender(new Error(`Could not rasterize the frame: ${e instanceof Error ? e.message : String(e)}`));
      });
    return finish;
  }, [svg, width, height]);
  return <canvas ref={ref} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />;
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
  /** Draw each frame into a canvas before capture (see `ToonCompositionProps`). */
  raster?: boolean;
};

/**
 * Renders a multi-shot sequence (cuts, crossfades, fades, irises, wipes, flashes) in Remotion.
 * Audio of each shot is cut at the shot boundary.
 */
export function ToonSequenceComposition({ sequence, scenes, resolveAudio = staticFile, muted, debug, paintSettle, raster }: ToonSequenceCompositionProps) {
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
      {raster && getRemotionEnvironment().isRendering ? <RasterFrame frame={rendered} /> : <ToonFrame key={frameKey(frame)} frame={rendered} width="100%" height="100%" />}
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
