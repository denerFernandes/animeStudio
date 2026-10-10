import type { Ease } from "./easing";
import { getEasing } from "./easing";
import type { ActionDef, ActorDef, LayerDef, LightingDef, LipsyncDoc, MouthCue, PropDef, SceneDoc, ToonDoc, Value } from "./format/schema";
import { type Key, type Track, makeTrack, normalizeTrack, sampleTrack } from "./keyframes";
import { cuesFromText } from "./lipsync";
import { BEHIND_FX, FX_DURATIONS, type FxType, SCREEN_FX, fxMarkup } from "./fx";
import {
  cssBlur,
  type CameraBounds,
  type CameraFollow,
  type CameraFrame,
  type CameraPose,
  type CameraPunch,
  type CameraSegment,
  type CameraState,
  bakeFollow,
  bakeFrame,
  clampToBounds,
  depthBlur,
  fitBox,
  handheldOffset,
  pathPoint,
  punchFactor,
  rigBounds,
  rigWeight,
  sampleFollow,
  sampleFrame,
} from "./camera";
import { type Surface, compileSurface, surfaceY } from "./surface";
import { type TransitionMode, type TransitionType, type WipeDirection, transitionCoverage, transitionMarkup } from "./transitions";
import {
  type Mat,
  type Vec2,
  apply,
  applyLinear,
  clamp,
  fromTRS,
  hashString,
  invert,
  lerp,
  multiply,
  noise1,
} from "./math";
import { type PhysicsBake, bakePhysics, samplePhysics } from "./physics";
import {
  LIGHTING_DEFS,
  keyLight,
  lightingAt,
  lightingChannelDefault,
  overlayMarkup,
  projectLights,
  shadingMarkup,
} from "./lighting";
import { type ClipInstance, type EvaluatedPose, applyPhysicsSample, evaluatePose } from "./pose";
import { type RenderFrame, type RenderNode, nodeToString, renderCharacter } from "./render";
import { type ChannelRef, type Rig, type RigTrack, RigError, compileRig, resolveChannel } from "./rig";

export class SceneError extends Error {
  constructor(
    message: string,
    public path?: string,
  ) {
    super(path ? `${path}: ${message}` : message);
    this.name = "SceneError";
  }
}

const PLACEMENT = ["x", "y", "rotation", "scale", "opacity", "flip"] as const;
type PlacementProp = (typeof PLACEMENT)[number];

export interface CompiledActor {
  id: string;
  def: ActorDef;
  rig: Rig;
  seed: number;
  clips: ClipInstance[];
  tracks: RigTrack[];
  placement: Partial<Record<PlacementProp, Track>>;
  /** Look tracks per aim control: values are target ids, scene points or null. */
  look: Record<string, Track>;
  /** Resolved ground: y follows the surface; feet adapt to its slope. */
  ground?: { surface: Surface; offset: number; feet: string[] };
  /** Riding another actor (`mount` actions), in time order. */
  mounts?: MountKey[];
  /** IK chains held on another actor's anchor or a scene point (`reach` actions), per chain. */
  reach?: Record<string, ReachKey[]>;
  /** Lazily computed. */
  bake?: PhysicsBake;
}

export interface MountKey {
  t: number;
  on: string | null;
  anchor: string;
  point: Vec2;
  blend: number;
  /** Parts drawn just behind the ridden actor. */
  behind?: string[];
}

export interface ReachKey {
  t: number;
  target: { actor: string; anchor: string } | { prop: string; point: Vec2; from?: number } | Vec2 | null;
  blend: number;
}

export interface Grab {
  actor: string;
  anchor: string;
  /** Fitted to the body: prop points on actor anchors (see the `grab` action). */
  fit?: ({ point: Vec2; anchor: string } | { point: Vec2; angle: number })[];
  start: number;
  end: number;
  releaseVelocity?: Vec2;
}

export interface CompiledProp {
  id: string;
  def: PropDef;
  markup: string;
  placement: Partial<Record<PlacementProp, Track>>;
  grabs: Grab[];
  impulses: { at: number; vector: Vec2 }[];
  ground?: { surface: Surface; offset: number };
}

export interface CompiledLayer {
  id: string;
  def: LayerDef;
  placement: Partial<Record<PlacementProp, Track>>;
}

export interface AudioEvent {
  /** Audio id from the scene's `audio` map. */
  id: string;
  /** Path/URL from the scene's `audio` map. */
  src: string;
  start: number;
  volume: number;
}

export interface CompiledFx {
  type: FxType;
  start: number;
  duration: number;
  actor?: string;
  anchor?: string;
  offset: Vec2;
  x: number;
  y: number;
  scale: number;
  color: string;
  fill?: string;
  seed: number;
  text?: string;
  variant?: string;
  angle?: number;
}

export interface CompiledTransition {
  type: TransitionType;
  start: number;
  duration: number;
  mode: TransitionMode;
  color: string;
  direction: WipeDirection;
  target?: string | Vec2;
}

export interface Shake {
  start: number;
  duration: number;
  amount: number;
  frequency: number;
  seed: number;
}

/** Rigid-body results provided by `@animestudio/rigid`. */
export interface RigidBodySampler {
  sample(propId: string, t: number): { x: number; y: number; rotation: number } | undefined;
}

export interface CompiledScene {
  doc: SceneDoc;
  width: number;
  height: number;
  fps: number;
  duration: number;
  background?: string;
  defs: string;
  layers: CompiledLayer[];
  actors: CompiledActor[];
  props: CompiledProp[];
  camera: Partial<Record<CameraChannel, Track>>;
  shakes: Shake[];
  /** Camera actions in time order (director model). */
  cameraSegments: CameraSegment[];
  punches: CameraPunch[];
  bounds?: CameraBounds;
  transitions: CompiledTransition[];
  surfaces: Record<string, Surface>;
  fx: CompiledFx[];
  audio: AudioEvent[];
  lighting?: { def: LightingDef; tracks: Record<string, Track> };
  rigid?: RigidBodySampler;
}

export const CAMERA_CHANNELS = ["x", "y", "zoom", "rotation", "handheld", "dolly", "focus", "blur", "focusRange", "motionBlur"] as const;
export type CameraChannel = (typeof CAMERA_CHANNELS)[number];

export interface SceneAssets {
  /** Character documents by the ids used in `scene.characters`. */
  characters: Record<string, ToonDoc>;
  /** Lip sync cue documents by the ids used in `scene.lipsync`. */
  lipsync?: Record<string, LipsyncDoc | MouthCue[]>;
}

// ---------------------------------------------------------------------------
// Track building helpers
// ---------------------------------------------------------------------------

class KeyBuffer {
  keys: Key[] = [];
  private cached?: Track;

  constructor(public initial: Value | undefined) {}

  valueAt(t: number): Value | undefined {
    if (!this.keys.length) return this.initial;
    this.cached ??= makeTrack(this.keys);
    return sampleTrack(this.cached, t);
  }

  /** Animates to `value` over [at, at + duration]. */
  transition(at: number, value: Value, duration: number, ease: Ease): void {
    const from = this.valueAt(at);
    if (duration > 0 && from !== undefined) {
      this.keys.push({ t: at, v: from, ease: "linear" });
      this.keys.push({ t: at + duration, v: value, ease });
    } else {
      if (from !== undefined && !this.keys.length) this.keys.push({ t: 0, v: from, ease: "step" });
      this.keys.push({ t: at, v: value, ease: "step" });
    }
    this.cached = undefined;
  }

  push(...keys: Key[]): void {
    this.keys.push(...keys);
    this.cached = undefined;
  }

  build(): Track | undefined {
    if (!this.keys.length) return undefined;
    return makeTrack(this.keys);
  }
}

/** Rest value of a character channel (what it is when nothing animates it). */
export function defaultChannelValue(rig: Rig, ref: ChannelRef): Value | undefined {
  switch (ref.kind) {
    case "bone":
      return ref.prop === "scaleX" || ref.prop === "scaleY" ? 1 : 0;
    case "part": {
      const part = rig.parts[ref.index];
      return ref.prop === "opacity" ? 1 : part.type === "switch" ? part.default : undefined;
    }
    case "morph":
      return 0;
    case "ik":
      return ref.prop === "mix" ? rig.ik[ref.index].mix : 0;
    case "behavior":
      return 1;
    case "physics":
      return rig.physics[ref.index].mix;
    case "control":
      return undefined;
  }
}

const easeOf = (e: unknown, fallback: Ease): Ease => (e as Ease | undefined) ?? fallback;
/** Quadratic ease-in / ease-out as cubic-béziers (constant acceleration). */
const ACCEL: Ease = [1 / 3, 0, 2 / 3, 1 / 3];
const DECEL: Ease = [1 / 3, 2 / 3, 2 / 3, 1];

function toCues(src: LipsyncDoc | MouthCue[]): MouthCue[] {
  return Array.isArray(src) ? src : src.mouthCues;
}

/** Converts mouth cues to a weight-record track with short cross-fades (smooth mouths). */
export function cuesToVisemeKeys(cues: MouthCue[], offset: number, blend = 0.06): Key[] {
  const keys: Key[] = [{ t: offset, v: { X: 1 }, ease: "step" }];
  let prev: Record<string, number> = { X: 1 };
  for (const c of cues) {
    const start = offset + c.start;
    const span = Math.max(0, c.end - c.start);
    const fade = Math.min(blend, span / 2);
    const next = { [c.value]: 1 };
    keys.push({ t: start, v: prev, ease: "linear" });
    keys.push({ t: start + fade, v: next, ease: "linear" });
    prev = next;
  }
  const end = offset + (cues.length ? cues[cues.length - 1].end : 0);
  keys.push({ t: end, v: prev, ease: "linear" }, { t: end + blend, v: { X: 1 }, ease: "linear" });
  return keys;
}

// ---------------------------------------------------------------------------
// Compilation
// ---------------------------------------------------------------------------

function initialPlacement(def: { x?: number; y?: number; rotation?: number; scale?: number | [number, number]; opacity?: number; flip?: boolean }): Record<PlacementProp, Value> {
  return {
    x: def.x ?? 0,
    y: def.y ?? 0,
    rotation: def.rotation ?? 0,
    scale: def.scale ?? 1,
    opacity: def.opacity ?? 1,
    flip: def.flip ?? false,
  };
}

/** Compiles a validated scene and its assets into an evaluable scene. */
export function compileScene(doc: SceneDoc, assets: SceneAssets): CompiledScene {
  const rigCache = new Map<string, Rig>();

  // Actors -----------------------------------------------------------------
  const actorBuffers = new Map<
    string,
    {
      placement: Record<PlacementProp, KeyBuffer>;
      channels: Map<string, KeyBuffer>;
      look: Map<string, KeyBuffer>;
      clips: ClipInstance[];
      mounts: MountKey[];
      reach: Map<string, ReachKey[]>;
    }
  >();

  const actors: CompiledActor[] = (doc.actors ?? []).map((def, i) => {
    const path = `actors[${i}] (${def.id})`;
    const charDoc = assets.characters[def.character];
    if (!doc.characters[def.character]) {
      throw new SceneError(`character "${def.character}" is not declared in "characters"`, path);
    }
    if (!charDoc) throw new SceneError(`character document "${def.character}" was not provided`, path);
    let rig: Rig;
    try {
      rig = compileRig(charDoc, { palette: def.palette, idPrefix: `${def.id}` });
    } catch (e) {
      throw new SceneError((e as Error).message, `${path} → ${def.character}`);
    }
    rigCache.set(def.id, rig);
    const init = initialPlacement(def);
    actorBuffers.set(def.id, {
      placement: Object.fromEntries(PLACEMENT.map((p) => [p, new KeyBuffer(init[p])])) as Record<PlacementProp, KeyBuffer>,
      channels: new Map(),
      look: new Map(),
      clips: [],
      mounts: [],
      reach: new Map(),
    });
    return {
      id: def.id,
      def,
      rig,
      seed: typeof def.seed === "string" ? hashString(def.seed) : (def.seed ?? hashString(def.id)),
      clips: [],
      tracks: [],
      placement: {},
      look: {},
    };
  });
  const actorIds = new Set(actors.map((a) => a.id));
  const propIds = new Set((doc.props ?? []).map((p) => p.id));

  const propSurfaces: Record<string, Surface> = {};
  for (const sd of doc.world?.surfaces ?? []) propSurfaces[sd.id] = compileSurface(sd);
  const props: CompiledProp[] = (doc.props ?? []).map((def, i) => {
    let ground: CompiledProp["ground"];
    if (def.ground) {
      const sf = propSurfaces[def.ground.surface];
      if (!sf) throw new SceneError(`unknown surface "${def.ground.surface}"`, `props[${i}].ground`);
      ground = { surface: sf, offset: def.ground.offset ?? 0 };
    }
    return { id: def.id, def, markup: def.art, placement: {}, grabs: [], impulses: [], ground };
  });
  const propBuffers = new Map(
    props.map((p) => {
      const init = initialPlacement(p.def);
      return [p.id, Object.fromEntries(PLACEMENT.map((k) => [k, new KeyBuffer(init[k])])) as Record<PlacementProp, KeyBuffer>];
    }),
  );
  const layers: CompiledLayer[] = (doc.layers ?? []).map((def) => ({ id: def.id, def, placement: {} }));
  const layerBuffers = new Map(
    layers.map((l) => {
      const init = initialPlacement(l.def);
      return [l.id, Object.fromEntries(PLACEMENT.map((k) => [k, new KeyBuffer(init[k])])) as Record<PlacementProp, KeyBuffer>];
    }),
  );

  /** Parallax depth of an actor, prop or layer (for depth of field focus). */
  const depthOf = (id: string, path: string): number => {
    const item = [...(doc.actors ?? []), ...(doc.props ?? []), ...(doc.layers ?? [])].find((x) => x.id === id);
    if (!item) throw new SceneError(`focus target "${id}" is not an actor, prop or layer`, path);
    return item.parallax ?? 1;
  };
  const cam = doc.camera ?? {};
  const cameraBuffers: Record<CameraChannel, KeyBuffer> = {
    x: new KeyBuffer(cam.x ?? doc.width / 2),
    y: new KeyBuffer(cam.y ?? doc.height / 2),
    zoom: new KeyBuffer(cam.zoom ?? 1),
    rotation: new KeyBuffer(cam.rotation ?? 0),
    handheld: new KeyBuffer(cam.handheld ?? 0),
    dolly: new KeyBuffer(cam.dolly ?? 0),
    focus: new KeyBuffer(typeof cam.focus === "string" ? depthOf(cam.focus, "camera.focus") : (cam.focus ?? 1)),
    blur: new KeyBuffer(cam.blur ?? 0),
    focusRange: new KeyBuffer(cam.focusRange ?? 0.5),
    motionBlur: new KeyBuffer(cam.motionBlur ?? 0),
  };

  // Surfaces and grounded items.
  const surfaces: Record<string, Surface> = {};
  for (const sd of doc.world?.surfaces ?? []) surfaces[sd.id] = compileSurface(sd);
  const surfaceRef = (id: string, path: string) => {
    const sf = surfaces[id];
    if (!sf) throw new SceneError(`unknown surface "${id}". Known surfaces: ${Object.keys(surfaces).join(", ") || "none"}.`, path);
    return sf;
  };
  actors.forEach((actor, i) => {
    const g = actor.def.ground;
    if (!g) return;
    const path = `actors[${i}].ground`;
    for (const foot of g.feet ?? []) {
      if (!actor.rig.ik.some((k) => k.id === foot)) throw new SceneError(`unknown IK chain "${foot}" on "${actor.rig.name}"`, path);
    }
    actor.ground = { surface: surfaceRef(g.surface, path), offset: g.offset ?? 0, feet: g.feet ?? [] };
  });

  const lightingDef = doc.lighting;
  const lightingBuffers = new Map<string, KeyBuffer>();
  const lightingBuffer = (channel: string, path: string): KeyBuffer => {
    if (!lightingDef) throw new SceneError(`lighting channel "${channel}" used but the scene has no "lighting"`, path);
    let buf = lightingBuffers.get(channel);
    if (!buf) {
      try {
        buf = new KeyBuffer(lightingChannelDefault(lightingDef, channel));
      } catch (e) {
        throw new SceneError((e as Error).message, path);
      }
      lightingBuffers.set(channel, buf);
    }
    return buf;
  };

  const channelBuffer = (actorId: string, channel: string): KeyBuffer => {
    const b = actorBuffers.get(actorId)!;
    let buf = b.channels.get(channel);
    if (!buf) {
      const rig = rigCache.get(actorId)!;
      buf = new KeyBuffer(defaultChannelValue(rig, resolveChannel(rig, channel)));
      b.channels.set(channel, buf);
    }
    return buf;
  };

  // User tracks --------------------------------------------------------------
  for (const [channel, keys] of Object.entries(doc.tracks ?? {})) {
    const path = `tracks["${channel}"]`;
    const seg = channel.split(".");
    const norm = normalizeTrack(keys).map((k) => ({ t: k.t, v: k.v, ease: k.ease }));
    if (seg[0] === "camera" && seg.length === 2 && (CAMERA_CHANNELS as readonly string[]).includes(seg[1])) {
      cameraBuffers[seg[1] as keyof typeof cameraBuffers].push(...norm);
    } else if (seg[0] === "actors" && actorIds.has(seg[1])) {
      const rest = seg.slice(2).join(".");
      if ((PLACEMENT as readonly string[]).includes(rest)) actorBuffers.get(seg[1])!.placement[rest as PlacementProp].push(...norm);
      else {
        try {
          channelBuffer(seg[1], rest).push(...norm);
        } catch (e) {
          throw new SceneError((e as Error).message, path);
        }
      }
    } else if (seg[0] === "props" && propIds.has(seg[1]) && (PLACEMENT as readonly string[]).includes(seg[2])) {
      propBuffers.get(seg[1])![seg[2] as PlacementProp].push(...norm);
    } else if (seg[0] === "layers" && layerBuffers.has(seg[1]) && (PLACEMENT as readonly string[]).includes(seg[2])) {
      layerBuffers.get(seg[1])![seg[2] as PlacementProp].push(...norm);
    } else if (seg[0] === "lights" || seg[0] === "lighting") {
      lightingBuffer(channel, path).push(...norm);
    } else {
      throw new SceneError(
        "unknown channel. Use camera.(x|y|zoom|rotation|handheld|dolly|focus|blur|focusRange|motionBlur), actors.<id>.<placement|character channel>, props.<id>.<placement>, layers.<id>.<placement>, lights.<id>.<prop> or lighting.<section>.<prop>.",
        path,
      );
    }
  }

  // Script ---------------------------------------------------------------------
  const shakes: Shake[] = [];
  const cameraSegments: CameraSegment[] = [];
  const punches: CameraPunch[] = [];
  const transitions: CompiledTransition[] = [];
  const fx: CompiledFx[] = [];
  const audio: AudioEvent[] = [];
  const script = (doc.script ?? []).map((a, i) => ({ a, i })).sort((x, y) => x.a.at - y.a.at || x.i - y.i);

  const audioEvent = (id: string, at: number, volume: number, path: string) => {
    const src = doc.audio?.[id];
    if (src === undefined) throw new SceneError(`unknown audio "${id}" (declare it in "audio")`, path);
    audio.push({ id, src, start: at, volume });
  };

  for (const { a, i } of script) {
    const path = `script[${i}] (${a.action})`;
    try {
      compileAction(a, path);
    } catch (e) {
      if (e instanceof SceneError) throw e;
      throw new SceneError((e as Error).message, path);
    }
  }

  function requireActor(id: string, path: string) {
    const b = actorBuffers.get(id);
    if (!b) throw new SceneError(`unknown actor "${id}".` + ` Known actors: ${[...actorIds].join(", ") || "none"}.`, path);
    return { buffers: b, rig: rigCache.get(id)! };
  }

  function firstControl(rig: Rig, type: "aim" | "viseme" | "pose", requested: string | undefined, path: string): string {
    if (requested) {
      const c = rig.controls[requested];
      if (!c || c.type !== type) throw new SceneError(`"${requested}" is not a ${type} control of "${rig.name}"`, path);
      return requested;
    }
    const found = Object.values(rig.controls).find((c) => c.type === type);
    if (!found) throw new SceneError(`character "${rig.name}" has no ${type} control`, path);
    return found.name;
  }

  function compileAction(a: ActionDef, path: string): void {
    switch (a.action) {
      case "play": {
        const { buffers, rig } = requireActor(a.actor, path);
        const clip = rig.clips[a.clip];
        if (!clip) throw new SceneError(`unknown clip "${a.clip}". Known clips: ${Object.keys(rig.clips).join(", ") || "none"}.`, path);
        const speed = a.speed ?? 1;
        const loop = a.loop ?? clip.loop;
        const end = a.duration !== undefined ? a.at + a.duration : loop ? Infinity : a.at + clip.duration / speed;
        buffers.clips.push({
          clip: a.clip,
          start: a.at,
          end,
          speed,
          loop,
          fadeIn: a.fadeIn ?? 0.2,
          fadeOut: a.fadeOut ?? 0.2,
          layer: a.layer ?? 0,
          blend: a.blend ?? "override",
          weight: a.weight ?? 1,
        });
        return;
      }
      case "set": {
        const { buffers, rig } = requireActor(a.actor, path);
        const duration = a.duration ?? 0;
        const ease = easeOf(a.ease, "sineInOut");
        if ((PLACEMENT as readonly string[]).includes(a.channel)) {
          buffers.placement[a.channel as PlacementProp].transition(a.at, a.value, a.channel === "flip" ? 0 : duration, ease);
          return;
        }
        const ref = resolveChannel(rig, a.channel);
        if (ref.kind === "control" && rig.controls[ref.name].type === "pose") {
          setPose(a.actor, ref.name, a.value, a.at, duration, ease);
          return;
        }
        channelBuffer(a.actor, a.channel).transition(a.at, a.value, duration, ease);
        return;
      }
      case "pose": {
        const { rig } = requireActor(a.actor, path);
        firstControl(rig, "pose", a.control, path);
        setPose(a.actor, a.control, a.value, a.at, a.duration ?? 0.3, easeOf(a.ease, "sineInOut"));
        return;
      }
      case "walkTo": {
        const { buffers, rig } = requireActor(a.actor, path);
        const clipName = a.clip ?? "walk";
        const clip = rig.clips[clipName];
        if (!clip) throw new SceneError(`walkTo needs a "${clipName}" clip on "${rig.name}"`, path);
        const x0 = buffers.placement.x.valueAt(a.at) as number;
        const y0 = buffers.placement.y.valueAt(a.at) as number;
        const y1 = a.y ?? y0;
        const distance = Math.hypot(a.x - x0, y1 - y0);
        if (distance < 1e-6) return;
        const duration = a.duration ?? distance / (a.speed ?? 220);
        // Trapezoidal velocity profile: accelerate, cruise, decelerate (no foot sliding pops).
        const ramp = Math.min(0.3, duration / 3);
        const v = distance / (duration - ramp);
        const rampDist = (v * ramp) / 2;
        const ux = (a.x - x0) / distance;
        const uy = (y1 - y0) / distance;
        for (const [buf, from, to, u] of [
          [buffers.placement.x, x0, a.x, ux],
          [buffers.placement.y, y0, y1, uy],
        ] as const) {
          if (Math.abs(to - from) < 1e-9) continue;
          if (a.ease) {
            buf.transition(a.at, to, duration, a.ease as Ease);
            continue;
          }
          buf.push(
            { t: a.at, v: from, ease: "linear" },
            { t: a.at + ramp, v: from + u * rampDist, ease: ACCEL },
            { t: a.at + duration - ramp, v: to - u * rampDist, ease: "linear" },
            { t: a.at + duration, v: to, ease: DECEL },
          );
        }
        if (Math.abs(a.x - x0) > 1e-6) buffers.placement.flip.transition(a.at, a.x < x0, 0, "step");
        const sc = buffers.placement.scale.valueAt(a.at);
        const actorScale = Math.abs(Array.isArray(sc) ? sc[0] : typeof sc === "number" ? sc : 1);
        const speed = clip.stride > 0 ? v / ((clip.stride * actorScale) / clip.duration) : 1;
        buffers.clips.push({
          clip: clipName,
          start: a.at,
          end: a.at + duration,
          speed,
          loop: true,
          fadeIn: ramp,
          fadeOut: ramp,
          layer: 0,
          blend: "override",
          weight: 1,
        });
        return;
      }
      case "face": {
        const { buffers } = requireActor(a.actor, path);
        buffers.placement.flip.transition(a.at, a.direction === "left", 0, "step");
        return;
      }
      case "mount": {
        const { buffers } = requireActor(a.actor, path);
        const anchor = a.anchor ?? "seat";
        if (a.on !== null) {
          if (a.on === a.actor) throw new SceneError(`"${a.actor}" cannot ride itself`, path);
          const ridden = rigCache.get(a.on);
          if (!ridden) throw new SceneError(`mount: unknown actor "${a.on}"`, path);
          if (!ridden.anchors[anchor]) throw new SceneError(`mount: "${a.on}" has no anchor "${anchor}". Known anchors: ${Object.keys(ridden.anchors).join(", ") || "none"}.`, path);
        }
        const { rig } = requireActor(a.actor, path);
        for (const id of a.behind ?? []) if (!rig.partIndex.has(id)) throw new SceneError(`mount: unknown part "${id}" in "behind". Known parts: ${[...rig.partIndex.keys()].join(", ")}.`, path);
        buffers.mounts.push({ t: a.at, on: a.on, anchor, point: (a.point as Vec2 | undefined) ?? [0, 0], blend: a.duration ?? 0.3, ...(a.behind?.length ? { behind: a.behind } : {}) });
        return;
      }
      case "reach": {
        const { buffers, rig } = requireActor(a.actor, path);
        if (!rig.ik.some((k) => k.id === a.chain)) throw new SceneError(`reach: unknown IK chain "${a.chain}". Known chains: ${rig.ik.map((k) => k.id).join(", ") || "none"}.`, path);
        const tg = a.target;
        if (tg && !Array.isArray(tg) && "prop" in tg) {
          if (!props.some((p) => p.id === tg.prop)) throw new SceneError(`reach: unknown prop "${tg.prop}"`, path);
        } else if (tg && !Array.isArray(tg)) {
          const other = rigCache.get(tg.actor);
          if (!other) throw new SceneError(`reach: unknown actor "${tg.actor}"`, path);
          if (!other.anchors[tg.anchor]) throw new SceneError(`reach: "${tg.actor}" has no anchor "${tg.anchor}". Known anchors: ${Object.keys(other.anchors).join(", ") || "none"}.`, path);
        }
        const list = buffers.reach.get(a.chain) ?? [];
        list.push({ t: a.at, target: (tg as ReachKey["target"]) ?? null, blend: a.duration ?? 0.3 });
        buffers.reach.set(a.chain, list);
        return;
      }
      case "lookAt": {
        const { buffers, rig } = requireActor(a.actor, path);
        const control = firstControl(rig, "aim", a.control, path);
        if (typeof a.target === "string" && !actorIds.has(a.target) && !propIds.has(a.target)) {
          throw new SceneError(`lookAt target "${a.target}" is not an actor or prop id`, path);
        }
        let buf = buffers.look.get(control);
        if (!buf) {
          buf = new KeyBuffer(null);
          buffers.look.set(control, buf);
        }
        buf.push({ t: a.at, v: a.target, ease: "step" });
        return;
      }
      case "say": {
        const { rig } = requireActor(a.actor, path);
        const control = firstControl(rig, "viseme", a.control, path);
        let cues: MouthCue[];
        if (a.cues) cues = a.cues;
        else if (a.lipsync) {
          const src = assets.lipsync?.[a.lipsync];
          if (!src) throw new SceneError(`lip sync data "${a.lipsync}" was not provided`, path);
          cues = toCues(src);
        } else if (a.text) cues = cuesFromText(a.text, { duration: a.duration });
        else throw new SceneError("say needs one of: cues, lipsync, text", path);
        channelBuffer(a.actor, `controls.${control}`).push(...cuesToVisemeKeys(cues, a.at));
        if (a.audio) audioEvent(a.audio, a.at, a.volume ?? 1, path);
        return;
      }
      case "grab": {
        requireActor(a.actor, path);
        const prop = props.find((p) => p.id === a.prop);
        if (!prop) throw new SceneError(`unknown prop "${a.prop}"`, path);
        for (const an of [a.anchor, ...(a.fit ?? []).flatMap((f) => ("anchor" in f ? [f.anchor] : []))]) {
          if (!rigCache.get(a.actor)!.anchors[an]) throw new SceneError(`unknown anchor "${an}" on actor "${a.actor}"`, path);
        }
        prop.grabs.push({ actor: a.actor, anchor: a.anchor, start: a.at, end: Infinity, ...(a.fit ? { fit: a.fit as Grab["fit"] } : {}) });
        return;
      }
      case "release": {
        const prop = props.find((p) => p.id === a.prop);
        const grab = prop?.grabs.find((g) => g.actor === a.actor && g.end === Infinity && g.start <= a.at);
        if (!prop || !grab) throw new SceneError(`actor "${a.actor}" is not holding "${a.prop}"`, path);
        grab.end = a.at;
        grab.releaseVelocity = a.velocity;
        return;
      }
      case "impulse": {
        const prop = props.find((p) => p.id === a.prop);
        if (!prop) throw new SceneError(`unknown prop "${a.prop}"`, path);
        prop.impulses.push({ at: a.at, vector: a.vector });
        return;
      }
      case "camera": {
        const ease = easeOf(a.ease, "sineInOut");
        const blend = a.blend ?? 0.6;
        const isRig = a.follow !== undefined || a.frame !== undefined;
        if (a.follow !== undefined) {
          if (a.follow === null) cameraSegments.push({ kind: "hold", start: a.at });
          else {
            if (!actorIds.has(a.follow)) throw new SceneError(`camera can't follow unknown actor "${a.follow}"`, path);
            const follow: CameraFollow = {
              actor: a.follow,
              start: a.at,
              end: Infinity,
              offset: a.offset ?? [0, 0],
              lag: a.lag ?? 0.3,
              axes: a.axes ?? "x",
              deadZone: a.deadZone ?? [0, 0],
              lookAhead: a.lookAhead ?? 0,
              blend,
            };
            cameraSegments.push({ kind: "follow", start: a.at, follow, zoom: a.zoom });
            if (a.duration !== undefined) cameraSegments.push({ kind: "hold", start: a.at + a.duration });
          }
        } else if (a.frame !== undefined) {
          if (a.frame === null) cameraSegments.push({ kind: "hold", start: a.at });
          else {
            for (const id of a.frame) {
              if (!actorIds.has(id) && !propIds.has(id)) throw new SceneError(`camera can't frame unknown actor/prop "${id}"`, path);
            }
            const frame: CameraFrame = {
              targets: a.frame,
              start: a.at,
              end: Infinity,
              padding: a.padding ?? 80,
              blend,
              minZoom: a.minZoom ?? 0.3,
              maxZoom: a.maxZoom ?? 4,
              lag: a.lag ?? 0.4,
              ...(a.band ? { band: a.band as [number, number] } : {}),
              ...(a.on ? { on: a.on } : {}),
            };
            cameraSegments.push({ kind: "frame", start: a.at, frame });
            if (a.duration !== undefined) cameraSegments.push({ kind: "hold", start: a.at + a.duration });
          }
        } else if (a.path) {
          cameraSegments.push({ kind: "path", start: a.at, duration: a.duration ?? 1, ease, points: a.path, zoom: a.zoom });
        } else if (a.x !== undefined || a.y !== undefined || a.zoom !== undefined || a.rotation !== undefined) {
          cameraSegments.push({ kind: "move", start: a.at, duration: a.duration ?? 1, ease, x: a.x, y: a.y, zoom: a.zoom, rotation: a.rotation });
        }
        // Lens / feel properties animate as tracks (`duration` = transition time; rigs use `blend`).
        const moveTime = isRig ? blend : (a.duration ?? 1);
        for (const k of ["handheld", "dolly", "blur", "focusRange", "motionBlur"] as const) {
          const v = a[k];
          if (v !== undefined) cameraBuffers[k].transition(a.at, v, moveTime, ease);
        }
        if (a.focus !== undefined) {
          const depth = typeof a.focus === "string" ? depthOf(a.focus, path) : a.focus;
          cameraBuffers.focus.transition(a.at, depth, moveTime, ease);
        }
        if (a.punch !== undefined) punches.push({ start: a.at, duration: isRig ? 0.4 : (a.duration ?? 0.4), amount: a.punch });
        return;
      }
      case "transition": {
        const defaults = { fade: 0.8, iris: 1.2, wipe: 0.8, flash: 0.3 } as const;
        if (typeof a.target === "string" && !actorIds.has(a.target) && !propIds.has(a.target)) {
          throw new SceneError(`transition target "${a.target}" is not an actor or prop`, path);
        }
        transitions.push({
          type: a.type,
          start: a.at,
          duration: a.duration ?? defaults[a.type],
          mode: a.mode ?? "outIn",
          color: a.color ?? (a.type === "flash" ? "#FFFFFF" : "#000000"),
          direction: a.direction ?? "right",
          target: a.target,
        });
        return;
      }
      case "shake":
        shakes.push({
          start: a.at,
          duration: a.duration ?? 0.5,
          amount: a.amount ?? 10,
          frequency: a.frequency ?? 12,
          seed: hashString(`shake${shakes.length}`),
        });
        return;
      case "sound":
        audioEvent(a.audio, a.at, a.volume ?? 1, path);
        return;
      case "fx": {
        if (a.actor) {
          requireActor(a.actor, path);
          const rig = rigCache.get(a.actor)!;
          if (a.anchor && a.anchor !== "origin" && !rig.anchors[a.anchor]) {
            throw new SceneError(`unknown anchor "${a.anchor}" on actor "${a.actor}". Known anchors: ${Object.keys(rig.anchors).join(", ") || "none"}, origin.`, path);
          }
        }
        fx.push({
          type: a.type,
          start: a.at,
          duration: a.duration ?? FX_DURATIONS[a.type],
          actor: a.actor,
          anchor: a.anchor,
          offset: a.offset ?? [0, 0],
          x: a.x ?? 0,
          y: a.y ?? 0,
          scale: a.scale ?? 1,
          color: a.color ?? "#1D2833",
          fill: a.fill,
          seed: hashString(`fx${fx.length}:${a.type}`),
          ...(a.text !== undefined ? { text: a.text } : {}),
          ...(a.style ? { variant: a.style } : {}),
          ...(a.angle !== undefined ? { angle: a.angle } : {}),
        });
        return;
      }
      case "light":
        lightingBuffer(a.channel, path).transition(a.at, a.value, a.duration ?? 0, easeOf(a.ease, "sineInOut"));
        return;
    }
  }

  function setPose(actorId: string, control: string, value: Value, at: number, duration: number, ease: Ease) {
    const buf = channelBuffer(actorId, `controls.${control}`);
    const toWeights = (v: Value | undefined): Record<string, number> =>
      typeof v === "string" ? { [v]: 1 } : v && typeof v === "object" && !Array.isArray(v) ? v : {};
    const from = toWeights(buf.valueAt(at));
    const to = toWeights(value);
    if (duration > 0) buf.push({ t: at, v: from, ease: "linear" }, { t: at + duration, v: to, ease });
    else buf.push({ t: at, v: to, ease: "step" });
  }

  // Finalize -----------------------------------------------------------------
  for (const actor of actors) {
    const b = actorBuffers.get(actor.id)!;
    actor.clips = b.clips;
    actor.tracks = [...b.channels.entries()].flatMap(([channel, buf]) => {
      const track = buf.build();
      return track ? [{ channel, ref: resolveChannel(actor.rig, channel), track }] : [];
    });
    for (const p of PLACEMENT) {
      const track = b.placement[p].build();
      if (track) actor.placement[p] = track;
    }
    for (const [control, buf] of b.look) {
      const track = buf.build();
      if (track) actor.look[control] = track;
    }
    if (b.mounts.length) actor.mounts = [...b.mounts].sort((x, y) => x.t - y.t);
    if (b.reach.size) actor.reach = Object.fromEntries([...b.reach].map(([c, keys]) => [c, [...keys].sort((x, y) => x.t - y.t)]));
  }
  for (const prop of props) {
    for (const p of PLACEMENT) {
      const track = propBuffers.get(prop.id)![p].build();
      if (track) prop.placement[p] = track;
    }
  }
  for (const layer of layers) {
    for (const p of PLACEMENT) {
      const track = layerBuffers.get(layer.id)![p].build();
      if (track) layer.placement[p] = track;
    }
  }
  // Every camera channel gets a track (constant when not animated) so document values apply.
  const camera: CompiledScene["camera"] = {};
  for (const k of CAMERA_CHANNELS) {
    camera[k] = cameraBuffers[k].build() ?? makeTrack([{ t: 0, v: cameraBuffers[k].initial ?? 0 }]);
  }

  const lighting = lightingDef
    ? {
        def: lightingDef,
        tracks: Object.fromEntries(
          [...lightingBuffers.entries()].flatMap(([ch, buf]) => {
            const track = buf.build();
            return track ? [[ch, track]] : [];
          }),
        ),
      }
    : undefined;

  const compiled: CompiledScene = {
    doc,
    lighting,
    width: doc.width,
    height: doc.height,
    fps: doc.fps,
    duration: doc.duration,
    background: doc.background,
    defs:
      (lightingDef ? LIGHTING_DEFS : "") +
      actors.map((a) => a.rig.defs).join(""),
    layers,
    actors,
    props,
    camera,
    shakes,
    cameraSegments: cameraSegments.sort((x, y) => x.start - y.start),
    punches,
    bounds: cam.bounds ? { minX: cam.bounds[0], minY: cam.bounds[1], maxX: cam.bounds[2], maxY: cam.bounds[3] } : undefined,
    transitions,
    surfaces,
    fx,
    audio: audio.sort((x, y) => x.start - y.start),
  };
  for (const actor of actors) if (actor.mounts) sceneOfActor.set(actor, compiled);
  return compiled;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

interface Placement {
  x: number;
  y: number;
  rotation: number;
  scale: [number, number];
  opacity: number;
  flip: boolean;
}

function samplePlacement(
  tracks: Partial<Record<PlacementProp, Track>>,
  def: { x?: number; y?: number; rotation?: number; scale?: number | [number, number]; opacity?: number; flip?: boolean },
  t: number,
): Placement {
  const init = initialPlacement(def);
  const v = (p: PlacementProp) => (tracks[p] ? sampleTrack(tracks[p]!, t) : init[p]);
  const scale = v("scale");
  return {
    x: v("x") as number,
    y: v("y") as number,
    rotation: v("rotation") as number,
    scale: Array.isArray(scale) ? [scale[0], scale[1]] : [scale as number, scale as number],
    opacity: v("opacity") as number,
    flip: Boolean(v("flip")),
  };
}

const placementMatrix = (p: Placement): Mat => fromTRS(p.x, p.y, p.rotation, p.scale[0] * (p.flip ? -1 : 1), p.scale[1]);

/** Scene of each compiled actor (riding resolves the ridden actor's pose). */
const sceneOfActor = new WeakMap<CompiledActor, CompiledScene>();
/** Actors whose mount is being resolved (guards against riding cycles). */
const resolvingMount = new Set<CompiledActor>();

/** Placement of an actor, standing on its ground surface when it has one, or riding another actor. */
function actorPlacementState(actor: CompiledActor, t: number): Placement {
  const p = samplePlacement(actor.placement, actor.def, t);
  if (actor.ground) p.y = surfaceY(actor.ground.surface, p.x) + actor.ground.offset;
  return actor.mounts ? mountedPlacement(actor, p, t) : p;
}

/**
 * Riding: the actor's `point` sits on the ridden actor's anchor (posed, so a bouncing saddle carries
 * the rider), with the ridden actor's rotation added and its facing. Mounting and getting off blend
 * from the previous placement over the key's `blend` time.
 */
function mountedPlacement(actor: CompiledActor, own: Placement, t: number): Placement {
  const keys = actor.mounts!;
  let idx = -1;
  for (let k = 0; k < keys.length; k++) if (keys[k].t <= t) idx = k;
  if (idx < 0) return own;
  const scene = sceneOfActor.get(actor);
  if (!scene || resolvingMount.has(actor)) return own;
  const on = (key: MountKey | undefined): Placement => {
    if (!key?.on) return own;
    const ridden = scene.actors.find((a) => a.id === key.on);
    if (!ridden) return own;
    const pv = actorPlacementState(ridden, t);
    const seat = anchorPosition(scene, ridden.id, key.anchor, t);
    const st: Placement = { ...own, rotation: own.rotation + pv.rotation, flip: pv.flip };
    const q = apply(placementMatrix({ ...st, x: 0, y: 0 }), key.point);
    return { ...st, x: seat[0] - q[0], y: seat[1] - q[1] };
  };
  resolvingMount.add(actor);
  try {
    const key = keys[idx];
    const cur = on(key);
    const u = key.blend > 0 ? getEasing("sineInOut")(clamp((t - key.t) / key.blend, 0, 1)) : 1;
    if (u >= 1) return cur;
    const prev = on(keys[idx - 1]);
    return { ...cur, x: lerp(prev.x, cur.x, u), y: lerp(prev.y, cur.y, u), rotation: lerp(prev.rotation, cur.rotation, u), flip: u < 0.5 ? prev.flip : cur.flip };
  } finally {
    resolvingMount.delete(actor);
  }
}

export function actorPlacement(actor: CompiledActor, t: number): Mat {
  return placementMatrix(actorPlacementState(actor, t));
}

export type { CameraState } from "./camera";

function cameraTrack(scene: CompiledScene, k: CameraChannel, t: number, d: number): number {
  const tr = scene.camera[k];
  return tr ? (sampleTrack(tr, t) as number) : d;
}

/** Scene-space bounding box of actors/props (for automatic framing). */
function targetsBox(scene: CompiledScene, ids: string[], t: number, faces = false): [number, number, number, number] {
  let box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  const add = (x: number, y: number) => {
    box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)];
  };
  for (const id of ids) {
    const actor = scene.actors.find((a) => a.id === id);
    if (actor && faces) {
      // A face: the posed face (or head) anchor, with room for the whole head around it.
      const name = actor.rig.anchors.face ? "face" : actor.rig.anchors.head ? "head" : undefined;
      const m = actorPlacement(actor, t);
      const [, by0, , by1] = rigBounds(actor.rig);
      const s = Math.abs(by1 - by0) * Math.hypot(m[0], m[1]) * 0.14;
      const p = name ? anchorPosition(scene, id, name, t) : apply(m, [0, by0 * 0.8]);
      add(p[0] - s, p[1] - s * 1.3);
      add(p[0] + s, p[1] + s * 1.2);
      continue;
    }
    if (actor) {
      const m = actorPlacement(actor, t);
      const [x0, y0, x1, y1] = rigBounds(actor.rig);
      for (const c of [
        [x0, y0],
        [x1, y0],
        [x0, y1],
        [x1, y1],
      ] as Vec2[])
        add(...apply(m, c));
      continue;
    }
    const prop = scene.props.find((p) => p.id === id);
    if (prop) {
      const p = propPlacement(scene, prop, t);
      add(p.x - 50, p.y - 50);
      add(p.x + 50, p.y + 50);
    }
  }
  return box;
}

/**
 * Camera at time t: tracks → curved paths → framing → follows → punch-ins → handheld → shakes →
 * scene bounds.
 */
export function cameraAt(scene: CompiledScene, t: number): CameraState {
  const cam = scene.doc.camera ?? {};
  const state: CameraState = {
    x: cameraTrack(scene, "x", t, cam.x ?? scene.width / 2),
    y: cameraTrack(scene, "y", t, cam.y ?? scene.height / 2),
    zoom: cameraTrack(scene, "zoom", t, cam.zoom ?? 1),
    rotation: cameraTrack(scene, "rotation", t, cam.rotation ?? 0),
    dolly: cameraTrack(scene, "dolly", t, 0),
    focus: cameraTrack(scene, "focus", t, 1),
    blur: cameraTrack(scene, "blur", t, 0),
    focusRange: cameraTrack(scene, "focusRange", t, 0.5),
    motionBlur: cameraTrack(scene, "motionBlur", t, 0),
  };

  let k = -1;
  for (let i = 0; i < scene.cameraSegments.length; i++) if (scene.cameraSegments[i].start <= t) k = i;
  const pose = segmentPose(scene, k, t, { x: state.x, y: state.y, zoom: state.zoom, rotation: state.rotation });
  state.x = pose.x;
  state.y = pose.y;
  state.zoom = pose.zoom;
  state.rotation = pose.rotation;

  for (const pu of scene.punches) state.zoom *= punchFactor(pu, t);

  const hh = handheldOffset(cameraTrack(scene, "handheld", t, 0), t);
  state.x += hh.x / state.zoom;
  state.y += hh.y / state.zoom;
  state.rotation += hh.rotation;

  for (const s of scene.shakes) {
    const u = (t - s.start) / s.duration;
    if (u < 0 || u > 1) continue;
    const fade = Math.pow(1 - u, 2);
    state.x += noise1(s.seed, t * s.frequency) * s.amount * fade;
    state.y += noise1(s.seed + 7, t * s.frequency) * s.amount * fade;
  }

  clampToBounds(state, scene.bounds, scene.width, scene.height);
  return state;
}

const logLerp = (a: number, b: number, u: number) => Math.exp(lerp(Math.log(a), Math.log(b), u));

/**
 * Camera pose produced by segment `k` at time t (k = -1: the base tracks, given as `base`).
 * Moves and paths start from the camera's actual pose when they begin; follows and frames blend
 * from the previous segment's (continuing) pose to their dynamic target.
 */
function segmentPose(scene: CompiledScene, k: number, t: number, base: CameraPose): CameraPose {
  if (k < 0) return base;
  const seg = scene.cameraSegments[k];
  const baseAt = (tt: number): CameraPose =>
    k === 0
      ? {
          x: cameraTrack(scene, "x", tt, base.x),
          y: cameraTrack(scene, "y", tt, base.y),
          zoom: cameraTrack(scene, "zoom", tt, base.zoom),
          rotation: cameraTrack(scene, "rotation", tt, base.rotation),
        }
      : base;
  const prevAt = (tt: number): CameraPose => segmentPose(scene, k - 1, tt, baseAt(tt));
  const frozen = (): CameraPose => {
    if (seg.kind !== "move" && seg.kind !== "path" && seg.kind !== "hold") return prevAt(seg.start);
    seg.from ??= prevAt(seg.start);
    return seg.from;
  };
  switch (seg.kind) {
    case "hold":
      return frozen();
    case "move": {
      const f = frozen();
      const u = seg.duration > 0 ? getEasing(seg.ease)(clamp((t - seg.start) / seg.duration, 0, 1)) : 1;
      return {
        x: lerp(f.x, seg.x ?? f.x, u),
        y: lerp(f.y, seg.y ?? f.y, u),
        zoom: logLerp(f.zoom, seg.zoom ?? f.zoom, u),
        rotation: lerp(f.rotation, seg.rotation ?? f.rotation, u),
      };
    }
    case "path": {
      const f = frozen();
      const u = seg.duration > 0 ? getEasing(seg.ease)(clamp((t - seg.start) / seg.duration, 0, 1)) : 1;
      const [x, y] = pathPoint([[f.x, f.y], ...seg.points], u);
      return { x, y, zoom: logLerp(f.zoom, seg.zoom ?? f.zoom, u), rotation: f.rotation };
    }
    case "follow": {
      const fl = seg.follow;
      const w = rigWeight(fl.start, Infinity, fl.blend, t);
      const actor = scene.actors.find((a) => a.id === fl.actor)!;
      fl.samples ??= bakeFollow(fl, scene.duration, (tt) => {
        const m = actorPlacement(actor, tt);
        return [m[4], m[5]];
      });
      const [fx, fy] = sampleFollow(fl.samples, fl.start, t);
      const prev = prevAt(t);
      return {
        x: lerp(prev.x, fx, w),
        y: fl.axes === "xy" ? lerp(prev.y, fy, w) : prev.y,
        zoom: seg.zoom !== undefined ? logLerp(prev.zoom, seg.zoom, w) : prev.zoom,
        rotation: prev.rotation,
      };
    }
    case "frame": {
      const fr = seg.frame;
      const w = rigWeight(fr.start, Infinity, fr.blend, t);
      fr.samples ??= bakeFrame(fr, scene.duration, (tt) => {
        const raw = targetsBox(scene, fr.targets, tt, fr.on === "face");
        const box: typeof raw = fr.band ? [raw[0], fr.band[0], raw[2], fr.band[1]] : raw;
        return Number.isFinite(box[0]) ? fitBox(box, scene.width, scene.height, fr.padding, fr.minZoom, fr.maxZoom) : null;
      });
      const prev = prevAt(t);
      const fit = sampleFrame(fr.samples, fr.start, t);
      if (!fit) return prev;
      return { x: lerp(prev.x, fit.x, w), y: lerp(prev.y, fit.y, w), zoom: logLerp(prev.zoom, fit.zoom, w), rotation: prev.rotation };
    }
  }
}

/**
 * Scene → screen matrix for a given parallax depth. `dolly` scales depths relative to the subject
 * plane (parallax 1): positive values push the background away while the subject keeps its size.
 */
export function viewMatrix(scene: CompiledScene, cam: CameraState, parallax = 1): Mat {
  const cx = lerp(scene.width / 2, cam.x, parallax);
  const cy = lerp(scene.height / 2, cam.y, parallax);
  const zoom = Math.pow(cam.zoom, parallax) * Math.exp(-(cam.dolly ?? 0) * (1 - parallax));
  // A camera roll turns the whole picture alike: rotating each depth by a different angle would
  // shear the scene. Only screen-fixed items (parallax 0) stay upright.
  return multiply(fromTRS(scene.width / 2, scene.height / 2, parallax > 0 ? cam.rotation : 0, zoom, zoom), fromTRS(-cx, -cy, 0));
}

const LOOK_BLEND = 0.35;

function resolveTargetPoint(scene: CompiledScene, target: Value | undefined, t: number): Vec2 | null {
  if (target === null || target === undefined) return null;
  if (Array.isArray(target)) return target as Vec2;
  if (typeof target !== "string") return null;
  const actor = scene.actors.find((a) => a.id === target);
  if (actor) {
    const m = actorPlacement(actor, t);
    const head = actor.rig.anchors.head;
    return apply(m, head ? head.at : [0, 0]);
  }
  const prop = scene.props.find((p) => p.id === target);
  if (prop) {
    const p = propPlacement(scene, prop, t);
    return [p.x, p.y];
  }
  return null;
}

/** Resolves look tracks to character-space aim targets with smooth transitions. */
function aimTargets(scene: CompiledScene, actor: CompiledActor, t: number, toChar: Mat): Record<string, { point: Vec2; weight: number } | null> {
  const out: Record<string, { point: Vec2; weight: number } | null> = {};
  const ease = getEasing("sineInOut");
  for (const [control, track] of Object.entries(actor.look)) {
    let idx = -1;
    for (let k = 0; k < track.length; k++) if (track[k].t <= t) idx = k;
    if (idx < 0) {
      out[control] = null;
      continue;
    }
    const curPt = resolveTargetPoint(scene, track[idx].v, t);
    const prevPt = idx > 0 ? resolveTargetPoint(scene, track[idx - 1].v, t) : null;
    const u = ease(clamp((t - track[idx].t) / LOOK_BLEND, 0, 1));
    if (curPt && prevPt) {
      out[control] = { point: apply(toChar, [lerp(prevPt[0], curPt[0], u), lerp(prevPt[1], curPt[1], u)]), weight: 1 };
    } else if (curPt) {
      out[control] = { point: apply(toChar, curPt), weight: u };
    } else if (prevPt) {
      out[control] = { point: apply(toChar, prevPt), weight: 1 - u };
    } else out[control] = null;
  }
  return out;
}

/**
 * Screen box an actor can cover in its current pose: its posed bones, widened by a margin for the
 * art around them (hair, clothes, props) — a third of its height, at least 120 setup px.
 */
function screenBox(actor: CompiledActor, pose: EvaluatedPose, m: Mat): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const bone of actor.rig.bones) {
    const w = pose.world[bone.index];
    for (const p of [apply(w, [0, 0]), apply(w, [bone.length, 0])]) {
      x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]);
      x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
    }
  }
  const pad = Math.max(120, (Math.max(y1, 0) - Math.min(y0, 0)) / 3);
  const corners: Vec2[] = [[x0 - pad, y0 - pad], [x1 + pad, y0 - pad], [x0 - pad, y1 + pad], [x1 + pad, y1 + pad]];
  const pts = corners.map((c) => apply(m, c));
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
}

/** Parts of a riding actor drawn just behind the ridden one, and that actor's z. */
function behindRidden(scene: CompiledScene, actor: CompiledActor, t: number): { parts: Set<string>; z: number } | undefined {
  if (!actor.mounts) return undefined;
  let key: MountKey | undefined;
  for (const k of actor.mounts) if (k.t <= t) key = k;
  if (!key?.on || !key.behind) return undefined;
  const ridden = scene.actors.find((a) => a.id === key!.on);
  return ridden ? { parts: new Set(key.behind), z: ridden.def.z ?? 0 } : undefined;
}

/** IK chains held on another actor's anchor (pedals, a handlebar) or a scene point, in character space. */
function reachTargets(scene: CompiledScene, actor: CompiledActor, t: number, toChar: Mat): Record<string, { point: Vec2; weight: number }> | undefined {
  if (!actor.reach) return undefined;
  const out: Record<string, { point: Vec2; weight: number; from?: Vec2 }> = {};
  // The forearm's direction at a prop's grip, in character space.
  const fromOf = (k: ReachKey | undefined): Vec2 | undefined => {
    if (!k?.target || Array.isArray(k.target) || !("prop" in k.target) || k.target.from === undefined) return undefined;
    // In the actor's own frame (character space: facing right, y down).
    const a = (k.target.from * Math.PI) / 180;
    return [Math.cos(a), Math.sin(a)];
  };
  const ease = getEasing("sineInOut");
  const resolve = (k: ReachKey | undefined): Vec2 | null => {
    if (!k?.target) return null;
    if (Array.isArray(k.target)) return k.target as Vec2;
    if ("prop" in k.target) {
      // A point of a prop: when the prop is fitted to this very actor (a phone at the ear), its place
      // comes from this actor's pose without the reach (the head does not depend on the arm).
      const tg = k.target;
      const prop = scene.props.find((p) => p.id === tg.prop);
      if (!prop) return null;
      const own = prop.grabs.some((g) => g.actor === actor.id && t >= g.start && t < g.end);
      const poses = own ? new Map([[actor.id, evaluatePose(actor.rig, { time: t, clips: actor.clips, tracks: actor.tracks, seed: actor.seed })]]) : undefined;
      const pl = propPlacement(scene, prop, t, poses);
      return apply(placementMatrix(pl), tg.point);
    }
    const other = scene.actors.find((a) => a.id === (k.target as { actor: string }).actor);
    if (!other || resolvingAim.has(other)) return null;
    return anchorPosition(scene, other.id, (k.target as { anchor: string }).anchor, t);
  };
  for (const [chain, keys] of Object.entries(actor.reach)) {
    let idx = -1;
    for (let k = 0; k < keys.length; k++) if (keys[k].t <= t) idx = k;
    if (idx < 0) continue;
    const key = keys[idx];
    const u = key.blend > 0 ? ease(clamp((t - key.t) / key.blend, 0, 1)) : 1;
    const cur = resolve(key);
    const prev = u < 1 ? resolve(keys[idx - 1]) : null;
    if (cur && prev) out[chain] = { point: apply(toChar, [lerp(prev[0], cur[0], u), lerp(prev[1], cur[1], u)]), weight: 1 };
    else if (cur) out[chain] = { point: apply(toChar, cur), weight: u, ...(fromOf(key) ? { from: fromOf(key) } : {}) };
    else if (prev) out[chain] = { point: apply(toChar, prev), weight: 1 - u };
  }
  return out;
}

/** Extra IK offsets that plant grounded feet on a sloped surface. */
function groundFeet(actor: CompiledActor, placement: Mat): Record<string, Vec2> | undefined {
  const g = actor.ground;
  if (!g || !g.feet.length) return undefined;
  const sy = Math.hypot(placement[2], placement[3]) || 1;
  const baseY = surfaceY(g.surface, placement[4]);
  const out: Record<string, Vec2> = {};
  for (const id of g.feet) {
    const ik = actor.rig.ik.find((k) => k.id === id);
    if (!ik) continue;
    const footX = apply(placement, ik.restTarget)[0];
    out[id] = [0, (surfaceY(g.surface, footX) - baseY) / sy];
  }
  return out;
}

/** Actors whose aim targets are being resolved (guards against cycles). */
const resolvingAim = new Set<CompiledActor>();

/** Pose of an actor before physics. */
function prePhysicsPose(scene: CompiledScene, actor: CompiledActor, t: number): EvaluatedPose {
  const placement = actorPlacement(actor, t);
  const toChar = invert(placement);
  // Looking at a prop held in one's own hand (or a chain of actors holding things and looking at
  // each other) depends on this very pose: inside such a cycle the pose is evaluated without aim.
  let aim: ReturnType<typeof aimTargets> | undefined;
  let reach: ReturnType<typeof reachTargets>;
  if (!resolvingAim.has(actor)) {
    resolvingAim.add(actor);
    try {
      aim = aimTargets(scene, actor, t, toChar);
      reach = reachTargets(scene, actor, t, toChar);
    } finally {
      resolvingAim.delete(actor);
    }
  }
  return evaluatePose(actor.rig, {
    time: t,
    clips: actor.clips,
    tracks: actor.tracks,
    seed: actor.seed,
    aim,
    ikOffset: actor.mounts ? undefined : groundFeet(actor, placement),
    ikTarget: reach,
    // A rig with a `side` control keeps its asymmetric details (a breast pocket, a wristwatch) on the
    // same side of the body when it faces left (the drawing is mirrored).
    ...(actor.rig.controls.side ? { controls: { side: placement[0] * placement[3] - placement[1] * placement[2] < 0 ? "left" : "right" } } : {}),
  });
}

export function actorBake(scene: CompiledScene, actor: CompiledActor): PhysicsBake | undefined {
  if (actor.rig.physics.length === 0) return undefined;
  actor.bake ??= bakePhysics(actor.rig, {
    duration: scene.duration,
    poseAt: (t) => prePhysicsPose(scene, actor, t),
    placementAt: (t) => actorPlacement(actor, t),
  });
  return actor.bake;
}

/** Full pose of an actor at time t (including baked physics), in character space. */
export function actorPose(scene: CompiledScene, actor: CompiledActor, t: number): EvaluatedPose {
  const pose = prePhysicsPose(scene, actor, t);
  applyPhysicsSample(actor.rig, pose, samplePhysics(actorBake(scene, actor), t));
  return pose;
}

/** Scene-space position of an actor anchor at time t. */
export function anchorPosition(scene: CompiledScene, actorId: string, anchor: string, t: number, pose?: EvaluatedPose): Vec2 {
  const actor = scene.actors.find((a) => a.id === actorId);
  if (!actor) throw new SceneError(`unknown actor "${actorId}"`);
  const a = actor.rig.anchors[anchor];
  if (!a) throw new RigError(`unknown anchor "${anchor}"`);
  const p = pose ?? actorPose(scene, actor, t);
  const local = apply(multiply(p.world[a.bone], actor.rig.bones[a.bone].setupWorldInv), a.at);
  return apply(actorPlacement(actor, t), local);
}

/**
 * How much a prop held at an anchor turns (degrees, scene space): the anchor bone's rotation from
 * its rest pose times the anchor's `turn` (a phone at the ear, a bottle tipped to the mouth).
 */
export function anchorTurn(scene: CompiledScene, actorId: string, anchor: string, t: number, pose?: EvaluatedPose): number {
  const actor = scene.actors.find((a) => a.id === actorId);
  const a = actor?.rig.anchors[anchor];
  if (!actor || !a?.turn) return 0;
  const p = pose ?? actorPose(scene, actor, t);
  const m = multiply(actorPlacement(actor, t), multiply(p.world[a.bone], actor.rig.bones[a.bone].setupWorldInv));
  const mirrored = m[0] * m[3] - m[1] * m[2] < 0;
  // A mirrored actor (facing left) turns the other way.
  const deg = (Math.atan2(m[1], mirrored ? -m[0] : m[0]) * 180) / Math.PI;
  return (mirrored ? -deg : deg) * a.turn;
}

/**
 * A prop fitted to the body: its first point on the first anchor, turned so its second point points
 * at the second anchor (or, with one point, turning with that anchor's bone).
 */
function fittedPlacement(scene: CompiledScene, prop: CompiledProp, grab: Grab, t: number, scale: [number, number], pose?: EvaluatedPose): { x: number; y: number; rotation: number } {
  const [f1, f2] = grab.fit! as [{ point: Vec2; anchor: string }, ({ point: Vec2; anchor: string } | { point: Vec2; angle: number })?];
  const a1 = anchorPosition(scene, grab.actor, f1.anchor, t, pose);
  // The first anchor's bone: how it turns from rest (scene space) and whether the actor is mirrored.
  const actor = scene.actors.find((a) => a.id === grab.actor)!;
  const an = actor.rig.anchors[f1.anchor];
  const p = pose ?? actorPose(scene, actor, t);
  const m = multiply(actorPlacement(actor, t), multiply(p.world[an.bone], actor.rig.bones[an.bone].setupWorldInv));
  const mirrored = m[0] * m[3] - m[1] * m[2] < 0;
  const boneTurn = mirrored ? -Math.atan2(m[1], -m[0]) : Math.atan2(m[1], m[0]);
  let rot: number;
  if (f2 && "anchor" in f2) {
    const a2 = anchorPosition(scene, grab.actor, f2.anchor, t, pose);
    rot = Math.atan2(a2[1] - a1[1], a2[0] - a1[0]) - Math.atan2(f2.point[1] - f1.point[1], f2.point[0] - f1.point[0]);
  } else if (f2) {
    // A direction in the actor's frame (mirrored when it faces left), turning with the bone.
    const dir = (f2.angle * Math.PI) / 180 + (mirrored ? -boneTurn : boneTurn);
    const world = mirrored ? Math.PI - dir : dir;
    rot = world - Math.atan2(f2.point[1] - f1.point[1], f2.point[0] - f1.point[0]);
  } else rot = boneTurn;
  const c = Math.cos(rot), s = Math.sin(rot);
  const px = f1.point[0] * scale[0], py = f1.point[1] * scale[1];
  void prop;
  return { x: a1[0] - (px * c - py * s), y: a1[1] - (px * s + py * c), rotation: (rot * 180) / Math.PI };
}

export function propPlacement(scene: CompiledScene, prop: CompiledProp, t: number, poses?: Map<string, EvaluatedPose>): Placement {
  const base = samplePlacement(prop.placement, prop.def, t);
  const rigid = scene.rigid?.sample(prop.id, t);
  if (rigid) return { ...base, x: rigid.x, y: rigid.y, rotation: rigid.rotation };
  const grab = prop.grabs.find((g) => t >= g.start && t < g.end);
  if (grab?.fit) return { ...base, ...fittedPlacement(scene, prop, grab, t, base.scale, poses?.get(grab.actor)) };
  if (grab) {
    const pose = poses?.get(grab.actor);
    const p = anchorPosition(scene, grab.actor, grab.anchor, t, pose);
    const turn = anchorTurn(scene, grab.actor, grab.anchor, t, pose);
    return { ...base, x: p[0], y: p[1], ...(turn ? { rotation: base.rotation + turn } : {}) };
  }
  if (prop.ground) base.y = surfaceY(prop.ground.surface, base.x) + prop.ground.offset;
  return base;
}

/** Screen position of an actor (head anchor), prop or scene point at time t. */
export function screenPoint(scene: CompiledScene, target: string | Vec2, t: number): Vec2 {
  const cam = cameraAt(scene, t);
  const p = resolveTargetPoint(scene, target, t);
  return p ? apply(viewMatrix(scene, cam, 1), p) : [scene.width / 2, scene.height / 2];
}

/** Screen point of a transition target (actor head / prop / scene point; default: center). */
function transitionCenter(scene: CompiledScene, cam: CameraState, target: string | Vec2 | undefined, t: number): Vec2 {
  if (target === undefined) return [scene.width / 2, scene.height / 2];
  const p = resolveTargetPoint(scene, target, t);
  return p ? apply(viewMatrix(scene, cam, 1), p) : [scene.width / 2, scene.height / 2];
}

/** Evaluates a full scene frame at time `t` (seconds). Pure and deterministic. */
export function evaluateScene(scene: CompiledScene, t: number): RenderFrame {
  const cam = cameraAt(scene, t);
  // Motion blur compares each item's screen placement with the previous frame.
  const dtPrev = 1 / scene.fps;
  const camPrev = cam.motionBlur > 0 ? cameraAt(scene, Math.max(0, t - dtPrev)) : null;
  const blurFor = (depth: number, m: Mat, mPrev: Mat | null): string | undefined => {
    const dof = depthBlur(cam, depth);
    let mx = 0;
    let my = 0;
    if (camPrev && mPrev) {
      mx = Math.abs(m[4] - mPrev[4]) * cam.motionBlur * 0.5;
      my = Math.abs(m[5] - mPrev[5]) * cam.motionBlur * 0.5;
    }
    if (dof <= 0 && mx <= 0 && my <= 0) return undefined;
    return cssBlur(Math.hypot(dof, mx), Math.hypot(dof, my));
  };

  const items: { z: number; order: number; node: RenderNode }[] = [];
  let order = 0;

  for (const layer of scene.layers) {
    const depth = layer.def.parallax ?? 1;
    const p = samplePlacement(layer.placement, layer.def, t);
    const m = multiply(viewMatrix(scene, cam, depth), placementMatrix(p));
    const mPrev = camPrev ? multiply(viewMatrix(scene, camPrev, depth), placementMatrix(samplePlacement(layer.placement, layer.def, t - dtPrev))) : null;
    items.push({
      z: layer.def.z ?? -1000,
      order: order++,
      node: {
        kind: "markup",
        key: `layer-${layer.id}`,
        transform: m,
        opacity: p.opacity < 1 ? p.opacity : undefined,
        filter: blurFor(depth, m, mPrev),
        markup: layer.def.art,
      },
    });
  }

  const light = scene.lighting ? lightingAt(scene.lighting.def, scene.lighting.tracks, t) : null;
  const screenLights = light ? projectLights(light, (parallax) => viewMatrix(scene, cam, parallax)) : [];
  const key = light ? keyLight(light, screenLights) : undefined;

  const poses = new Map<string, EvaluatedPose>();
  // Crowd shots: more lit actors on screen than `shading.crowd` → no rim light.
  const crowded = !!(light?.shading.crowd && scene.actors.filter((a) => a.def.shading !== false && actorPlacementState(a, t).opacity > 0.01 && a.rig.anchors.head).length > light.shading.crowd);
  for (const actor of scene.actors) {
    const depth = actor.def.parallax ?? 1;
    const pose = actorPose(scene, actor, t);
    poses.set(actor.id, pose);
    const p = actorPlacementState(actor, t);
    const m = multiply(viewMatrix(scene, cam, depth), placementMatrix(p));
    const mPrev = camPrev ? multiply(viewMatrix(scene, camPrev, depth), actorPlacement(actor, t - dtPrev)) : null;
    const z = actor.def.z ?? 0;
    const artId = `actor-art-${actor.id}`;
    // Riding: some parts (the far leg…) are drawn just behind the ridden actor.
    const under = behindRidden(scene, actor, t);
    // Holding a prop: the prop is drawn just above the actor and the holding hand above the prop
    // (the fingers wrap around it).
    const holdBones = new Set(scene.props.flatMap((pr) => pr.grabs.filter((g) => g.actor === actor.id && t >= g.start && t < g.end).map((g) => actor.rig.anchors[g.anchor]?.bone)).filter((b): b is number => b !== undefined));
    const overParts = new Set(holdBones.size ? actor.rig.parts.filter((pt) => "bone" in pt && holdBones.has((pt as { bone: number }).bone)).map((pt) => pt.id) : []);
    const actorNode: RenderNode = {
      kind: "group",
      key: `actor-${actor.id}`,
      id: artId,
      transform: m,
      opacity: p.opacity < 1 ? p.opacity : undefined,
      filter: blurFor(depth, m, mPrev),
      children: renderCharacter(actor.rig, pose, `${actor.id}-`, under || overParts.size ? (id) => !under?.parts.has(id) && !overParts.has(id) : undefined),
    };
    if (overParts.size) {
      const node: RenderNode = { ...actorNode, key: `actor-${actor.id}-hand`, id: undefined, children: renderCharacter(actor.rig, pose, `${actor.id}-h-`, (id) => overParts.has(id)) };
      items.push({ z: z + 2e-3, order: order++, node });
    }
    if (under) {
      const node: RenderNode = { ...actorNode, key: `actor-${actor.id}-behind`, id: undefined, children: renderCharacter(actor.rig, pose, `${actor.id}-b-`, (id) => under.parts.has(id)) };
      items.push({ z: under.z - 1e-3, order: order++, node });
    }
    items.push({ z, order: order++, node: actorNode });
    // Shading copies the actor's art, so it must fade with it (and vanish with a hidden actor). It is
    // the most expensive part of a frame without a GPU: skipped for actors too small to show it, and
    // without the rim light in crowd shots (`shading.crowd`).
    const box = light && actor.def.shading !== false && p.opacity > 0.01 ? screenBox(actor, pose, m) : undefined;
    const tall = box ? (box[3] - box[1]) * 0.7 : 0; // the box has a margin around the bones
    if (light && box && tall >= light.shading.minHeight) {
      // Shade around the actor's middle (head anchor if any, else ~100 px above its origin).
      const head = actor.rig.anchors.head;
      const local: Vec2 = head ? [head.at[0] * 0.5, head.at[1] * 0.5] : [0, -100];
      // The masks get their own copy of the (unfiltered, id-less) actor art.
      const art = nodeToString({ ...actorNode, id: undefined, filter: undefined, opacity: undefined });
      const lit = crowded ? { ...light, shading: { ...light.shading, rimOpacity: 0 } } : light;
      const markup = shadingMarkup(lit, key, actor.id, art, apply(m, local), Math.hypot(m[0], m[1]), scene.width, scene.height, box);
      if (markup) items.push({ z, order: order++, node: { kind: "markup", key: `shade-${actor.id}`, markup: p.opacity < 1 ? `<g opacity="${p.opacity}">${markup}</g>` : markup } });
    }
  }

  for (const prop of scene.props) {
    const depth = prop.def.parallax ?? 1;
    const p = propPlacement(scene, prop, t, poses);
    const holder = prop.grabs.find((g) => t >= g.start && t < g.end);
    const holderZ = holder ? scene.actors.find((a) => a.id === holder.actor)?.def.z : undefined;
    const m = multiply(viewMatrix(scene, cam, depth), placementMatrix(p));
    const mPrev = camPrev ? multiply(viewMatrix(scene, camPrev, depth), placementMatrix(propPlacement(scene, prop, t - dtPrev))) : null;
    items.push({
      // Held: just above its holder (under the holding hand, above the rest of the body).
      z: holder ? (holderZ ?? 0) + 1e-3 : prop.def.z ?? 0,
      order: order++,
      node: {
        kind: "markup",
        key: `prop-${prop.id}`,
        transform: m,
        opacity: p.opacity < 1 ? p.opacity : undefined,
        filter: blurFor(depth, m, mPrev),
        markup: prop.markup,
      },
    });
  }

  // Cartoon effects, attached to actors (follow, flip and scale with them) or at scene points.
  for (const e of scene.fx) {
    const u = (t - e.start) / e.duration;
    if (u < 0 || u > 1) continue;
    let m: Mat;
    let z = 100;
    if (SCREEN_FX.includes(e.type)) {
      // Fixed to the frame: x/y are screen coordinates (default: the centre; captions per look).
      const dflt: Vec2 = e.type === "caption" ? (e.variant === "place" ? [70, scene.height - 130] : e.variant === "impact" ? [scene.width / 2, 200] : [scene.width / 2, scene.height * 0.42]) : [scene.width / 2, scene.height / 2];
      const px = e.x || e.y ? e.x : dflt[0], py = e.x || e.y ? e.y : dflt[1];
      m = [e.scale, 0, 0, e.scale, px, py];
      z = e.type === "caption" ? 1e6 : e.type === "impactFrame" ? 1e6 + 1 : 999;
    } else if (e.actor) {
      const actor = scene.actors.find((a) => a.id === e.actor)!;
      const pose = poses.get(actor.id)!;
      const name = e.anchor ?? (actor.rig.anchors.head ? "head" : "origin");
      let local: Vec2 = [0, 0];
      if (name !== "origin") {
        const a = actor.rig.anchors[name];
        local = apply(multiply(pose.world[a.bone], actor.rig.bones[a.bone].setupWorldInv), a.at);
      }
      const am = multiply(viewMatrix(scene, cam, actor.def.parallax ?? 1), actorPlacement(actor, t));
      const p = apply(am, [local[0] + e.offset[0], local[1] + e.offset[1]]);
      // Keep the actor's flip and scale, but not its rotation (effects stay upright). Symbols that
      // read like text (?, !, Z, notes) are never mirrored: they are moved to the other side instead.
      const sx = Math.hypot(am[0], am[1]) * e.scale;
      const det = am[0] * am[3] - am[1] * am[2];
      const glyph = e.type === "question" || e.type === "exclaim" || e.type === "zzz" || e.type === "notes";
      m = [det < 0 && !glyph ? -sx : sx, 0, 0, sx, p[0], p[1]];
      z = (actor.def.z ?? 0) + (BEHIND_FX.includes(e.type) ? -0.01 : 0.5);
    } else {
      const v = viewMatrix(scene, cam, 1);
      const p = apply(v, [e.x, e.y]);
      const s = Math.hypot(v[0], v[1]) * e.scale;
      m = [s, 0, 0, s, p[0], p[1]];
    }
    const markup = fxMarkup(e.type, u, t - e.start, { color: e.color, fill: e.fill, seed: e.seed, text: e.text, variant: e.variant, angle: e.angle, width: scene.width, height: scene.height });
    items.push({ z, order: order++, node: { kind: "markup", key: `fx-${e.seed}-${e.start}`, transform: m, markup } });
  }

  if (light) {
    const markup = overlayMarkup(light, screenLights, scene.width, scene.height);
    if (markup) items.push({ z: Infinity, order: order++, node: { kind: "markup", key: "lighting", markup } });
  }

  // Screen transitions (fade, iris, wipe, flash) on top of everything.
  scene.transitions.forEach((tr, i) => {
    const u = (t - tr.start) / tr.duration;
    if (u < 0 || u > 1) return;
    const markup = transitionMarkup({
      type: tr.type,
      coverage: transitionCoverage(tr.mode, u),
      uncovering: tr.mode === "in" || (tr.mode === "outIn" && u > 0.5),
      color: tr.color,
      direction: tr.direction,
      center: transitionCenter(scene, cam, tr.target, t),
      width: scene.width,
      height: scene.height,
      id: String(i),
    });
    if (markup) items.push({ z: Infinity, order: order++ + 1e6, node: { kind: "markup", key: `transition-${i}`, markup } });
  });

  items.sort((a, b) => a.z - b.z || a.order - b.order);
  return {
    width: scene.width,
    height: scene.height,
    background: scene.background,
    defs: scene.defs,
    nodes: items.map((i) => i.node),
  };
}

/** Frame index → seconds. */
export const frameTime = (scene: CompiledScene, frame: number): number => frame / scene.fps;
export const frameCount = (scene: CompiledScene): number => Math.ceil(scene.duration * scene.fps);
