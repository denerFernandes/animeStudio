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
  matScale,
  handheldOffset,
  pathPoint,
  punchFactor,
  rigBounds,
  rigWeight,
  sampleFollow,
  sampleFrame,
} from "./camera";
import { type Surface, compileSurface, surfaceY } from "./surface";
import { viewPoint } from "./pose3d";
import { type TransitionMode, type TransitionType, type WipeDirection, transitionCoverage, transitionMarkup } from "./transitions";
import {
  type Mat,
  type Vec2,
  apply,
  applyLinear,
  clamp,
  formatNumber,
  fromTRS,
  hashString,
  invert,
  lerp,
  multiply,
  noise1,
} from "./math";
import { type HangBake, type PhysicsBake, bakeHang, bakePhysics, sampleHang, samplePhysics } from "./physics";
import { markupBounds } from "./paths";
import {
  LIGHTING_DEFS,
  keyLight,
  lightingAt,
  lightingChannelDefault,
  overlayMarkup,
  projectLights,
  shadingMarkup,
  unknownKeyLight,
} from "./lighting";
import { type CharacterInput, type ClipInstance, type EvaluatedPose, applyPhysicsSample, evaluatePose } from "./pose";
import { type RenderFrame, type RenderNode, nodeToString, renderCharacter } from "./render";
import { type ChannelRef, type Rig, type RigPart, type RigTrack, RigError, compileRig, namespaceIds, resolveChannel } from "./rig";

export class SceneError extends Error {
  constructor(
    message: string,
    public path?: string,
  ) {
    super(path ? `${path}: ${message}` : message);
    this.name = "SceneError";
  }
}

/** Placement channels; `flip` and `z` are stepped (a side, a depth order: nothing in between). */
const PLACEMENT = ["x", "y", "rotation", "scale", "opacity", "flip", "z"] as const;
type PlacementProp = (typeof PLACEMENT)[number];

export interface CompiledActor {
  id: string;
  def: ActorDef;
  rig: Rig;
  seed: number;
  /** Frames per drawing (1 = smooth, 2 = on twos…): the actor's own `twos`, else the scene's. */
  twos: number;
  /** Moving-hold drift 0..1: the actor's own `holds`, else the scene's (0 for things that are not alive). */
  holds: number;
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
  /** Keeps the rider's own facing (`facing: "own"`) instead of the ridden actor's. */
  own?: boolean;
}

export interface ReachKey {
  t: number;
  target: { actor: string; anchor: string } | { prop: string; point: Vec2; from?: number } | Vec2 | null;
  blend: number;
}

export interface Grab {
  actor: string;
  anchor: string;
  /** Other anchors whose hands hold it too (two-handed): drawn over it like the holding hand. */
  also?: string[];
  /** Fitted to the body: prop points on actor anchors (see the `grab` action). */
  fit?: ({ point: Vec2; anchor: string } | { point: Vec2; angle: number; fixed?: boolean } | { point: Vec2; dir: [number, number, number]; view?: string; face?: [number, number, number]; fixed?: boolean })[];
  /** Hung from the hand by its handle, swinging like a pendulum (see the `grab` action's `hang`), resolved. */
  hang?: GrabHang;
  start: number;
  end: number;
  releaseVelocity?: Vec2;
  /** The hung prop's swing over the grab, lazily computed (`hangBake`). */
  hangBake?: HangBake;
}

/** A `grab`'s `hang`, with its defaults resolved. */
export interface GrabHang {
  /** The prop's handle (art coordinates), placed on the anchor. */
  point: Vec2;
  /** Handle → centre of mass, in the prop's art px (scaled with the prop). */
  length: number;
  /** 0..1 (mapped to a damping ratio of 0.04–1). */
  damping: number;
  /** Degrees either side of the vertical. */
  limit: number;
  /** px/s², down. */
  gravity: number;
}

/** Default handle → centre of mass length of a hung prop: half the art's extent below the handle (art px). */
function hangLength(art: string, point: Vec2): number {
  const b = markupBounds(art);
  if (!b) return 40;
  const below = b[3] - point[1];
  return Math.max(4, below > 0 ? below / 2 : (b[3] - b[1]) / 2);
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
  prop?: string;
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
  /**
   * Cartoon timing, resolved: frames per drawing of the characters, the moving-hold amount (0..1),
   * the smear amount (0..1; only present when smears are on), the arcs amount (0..1; only
   * present when arcs are on: a reaching hand or foot travels along an arc, not a straight line)
   * and the line boil amount (0..1; only present when the boil is on: the outlines of actors and
   * props wobble, redrawn every two frames).
   */
  animation: { twos: number; holds: number; smear?: number; arcs?: number; boil?: number };
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

  /**
   * A new change at `at` takes over from where the channel is: what was still planned after `at` is
   * dropped (a move under way stops there and turns into the new one, with no jump), and a stepped
   * key at that very instant is replaced by it (a key a ramp ends on stays: the ramp still ends
   * there, then the new change applies). Returns whether anything was dropped.
   */
  takeOver(at: number): boolean {
    const keep = this.keys.filter((k) => k.t < at - 1e-9 || (k.t <= at + 1e-9 && k.ease !== "step"));
    if (keep.length === this.keys.length) return false;
    this.keys = keep;
    this.cached = undefined;
    return true;
  }

  /**
   * Animates to `value` over [at, at + duration] from `from` (default: where the channel is at `at`),
   * taking over what was planned after `at`. With no duration the value steps in at `at`.
   */
  transition(at: number, value: Value, duration: number, ease: Ease, from: Value | undefined = this.valueAt(at)): void {
    this.takeOver(at);
    if (duration > 0 && from !== undefined) {
      this.keys.push({ t: at, v: from, ease: "linear" });
      this.keys.push({ t: at + duration, v: value, ease });
    } else {
      // Before a later step the channel keeps what it was; a step at the start needs no key before it.
      if (from !== undefined && !this.keys.length && at > 0) this.keys.push({ t: 0, v: from, ease: "step" });
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
      // A variant channel starts with no opinion (`null`): the pose controls choose the variant until a
      // `set` names one, and again after a `set` of `null` (a blink closing the eyes, then letting go).
      return ref.prop === "opacity" ? 1 : part.type === "switch" ? null : undefined;
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

/**
 * Where a cartoon effect goes when it is given no point: screen effects at the centre of the frame
 * (captions at their look's place), effects at a scene point at the centre of the scene.
 */
function fxDefaultPoint(type: FxType, variant: string | undefined, width: number, height: number): Vec2 {
  if (type === "caption") return variant === "place" ? [70, height - 130] : variant === "impact" ? [width / 2, 200] : [width / 2, height * 0.42];
  return [width / 2, height / 2];
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

function initialPlacement(def: { x?: number; y?: number; rotation?: number; scale?: number | [number, number]; opacity?: number; flip?: boolean; z?: number }): Record<PlacementProp, Value> {
  return {
    x: def.x ?? 0,
    y: def.y ?? 0,
    rotation: def.rotation ?? 0,
    scale: def.scale ?? 1,
    opacity: def.opacity ?? 1,
    flip: def.flip ?? false,
    z: def.z ?? 0,
  };
}

/** Frames per drawing from a `twos` field: `true` = 2, `false` = 1, a number as is (unset: `fallback`). */
const framesPerDrawing = (v: boolean | number | undefined, fallback: number): number =>
  v === undefined ? fallback : v === true ? 2 : v === false ? 1 : Math.max(1, Math.round(v));

/** Compiles a validated scene and its assets into an evaluable scene. */
export function compileScene(doc: SceneDoc, assets: SceneAssets): CompiledScene {
  const rigCache = new Map<string, Rig>();
  const smear = clamp(doc.animation?.smear ?? 0, 0, 1);
  const arcs = clamp(doc.animation?.arcs ?? 0, 0, 1);
  const boil = clamp(doc.animation?.boil ?? 0, 0, 1);
  const animation = {
    twos: framesPerDrawing(doc.animation?.twos, 1),
    holds: clamp(doc.animation?.holds ?? 0, 0, 1),
    ...(smear > 0 ? { smear } : {}),
    ...(arcs > 0 ? { arcs } : {}),
    ...(boil > 0 ? { boil } : {}),
  };

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
      twos: framesPerDrawing(def.twos, animation.twos),
      holds: clamp(def.holds ?? animation.holds, 0, 1),
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
  const badKeyLight = unknownKeyLight(lightingDef);
  if (badKeyLight) throw new SceneError(badKeyLight, "lighting.shading.light");
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
          buffers.placement[a.channel as PlacementProp].transition(a.at, a.value, a.channel === "flip" || a.channel === "z" ? 0 : duration, ease);
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
        // The walk takes over from where the actor is: a move under way (on either axis) stops here.
        for (const [buf, from] of [
          [buffers.placement.x, x0],
          [buffers.placement.y, y0],
        ] as const) {
          if (buf.takeOver(a.at)) buf.push({ t: a.at, v: from, ease: "linear" });
        }
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
            buf.transition(a.at, to, duration, a.ease as Ease, from);
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
        buffers.mounts.push({ t: a.at, on: a.on, anchor, point: (a.point as Vec2 | undefined) ?? [0, 0], blend: a.duration ?? 0.3, ...(a.behind?.length ? { behind: a.behind } : {}), ...(a.facing === "own" ? { own: true } : {}) });
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
        for (const an of [a.anchor, ...(a.also ?? []), ...(a.fit ?? []).flatMap((f) => ("anchor" in f ? [f.anchor] : []))]) {
          if (!rigCache.get(a.actor)!.anchors[an]) throw new SceneError(`unknown anchor "${an}" on actor "${a.actor}"`, path);
        }
        if (a.fit && a.hang) throw new SceneError("a grab cannot both `fit` the prop to the body and `hang` it from the hand", path);
        let hang: GrabHang | undefined;
        if (a.hang) {
          const point = (a.hang.point ?? [0, 0]) as Vec2;
          hang = {
            point,
            length: a.hang.length ?? hangLength(prop.markup, point),
            damping: a.hang.damping ?? 0.25,
            limit: a.hang.limit ?? 70,
            gravity: a.hang.gravity ?? doc.world?.gravity?.[1] ?? 1800,
          };
        }
        prop.grabs.push({ actor: a.actor, anchor: a.anchor, start: a.at, end: Infinity, ...(a.also?.length ? { also: a.also } : {}), ...(a.fit ? { fit: a.fit as Grab["fit"] } : {}), ...(hang ? { hang } : {}) });
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
        // A punch settles over the move's time; a rig or a cut (`duration: 0`) gives it the default.
        if (a.punch !== undefined) punches.push({ start: a.at, duration: isRig || !a.duration ? 0.4 : a.duration, amount: a.punch });
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
        if (a.prop && !propIds.has(a.prop)) throw new SceneError(`unknown prop "${a.prop}". Known props: ${[...propIds].join(", ") || "none"}.`, path);
        const dflt = fxDefaultPoint(a.type, a.style, doc.width, doc.height);
        fx.push({
          type: a.type,
          start: a.at,
          duration: a.duration ?? FX_DURATIONS[a.type],
          actor: a.actor,
          anchor: a.anchor,
          ...(a.prop ? { prop: a.prop } : {}),
          offset: a.offset ?? [0, 0],
          x: a.x ?? dflt[0],
          y: a.y ?? dflt[1],
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
    // Weights on both sides so the poses cross-fade; it takes over a change under way like `set`.
    buf.transition(at, toWeights(value), duration, ease, toWeights(buf.valueAt(at)));
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
    animation,
  };
  // Every actor knows its scene: riding resolves the ridden actor, drawings need the frame rate.
  for (const actor of actors) sceneOfActor.set(actor, compiled);
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
  /** Draw order (stepped). */
  z: number;
  /** A sided prop held with `fit` `face`: which side the camera sees. */
  side?: "front" | "back";
}

function samplePlacement(
  tracks: Partial<Record<PlacementProp, Track>>,
  def: { x?: number; y?: number; rotation?: number; scale?: number | [number, number]; opacity?: number; flip?: boolean; z?: number },
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
    z: v("z") as number,
  };
}

const placementMatrix = (p: Placement): Mat => fromTRS(p.x, p.y, p.rotation, p.scale[0] * (p.flip ? -1 : 1), p.scale[1]);

/** Scene of each compiled actor (riding resolves the ridden actor's pose; drawings need the frame rate). */
const sceneOfActor = new WeakMap<CompiledActor, CompiledScene>();
/** Actors whose mount is being resolved (guards against riding cycles). */
const resolvingMount = new Set<CompiledActor>();

// ---------------------------------------------------------------------------
// Cartoon timing: drawings on twos, moving holds
// ---------------------------------------------------------------------------

/**
 * Depth of smooth-time evaluation. The bakes (an actor's springs, a camera following or framing
 * actors) run over the animation as authored — no drawings on twos, no moving holds — so they come
 * out the same whatever the cartoon timing and whichever API needed them first; only their samples
 * are taken at drawing times.
 */
let smoothDepth = 0;

/** Runs `fn` with every actor on ones and without moving holds: what a bake (springs, camera rigs, rigid bodies) reads. */
export function inSmoothTime<T>(fn: () => T): T {
  smoothDepth++;
  try {
    return fn();
  } finally {
    smoothDepth--;
  }
}

/**
 * Time of the drawing an actor shows at `t`: `t` itself on ones (`twos` ≤ 1), else the start of its
 * group of `twos` frames at the scene's frame rate (on twos, frames 2k and 2k+1 show frame 2k's drawing).
 * The small tolerance keeps a frame time computed as `frame / fps` on its own frame.
 */
export function drawingTime(scene: CompiledScene, actor: CompiledActor, t: number): number {
  const n = actor.twos;
  if (!(n > 1)) return t;
  return (Math.floor((t * scene.fps) / n + 1e-6) * n) / scene.fps;
}

/** The time an actor is drawn at while a frame is evaluated (smooth inside the bakes). */
const drawnAt = (scene: CompiledScene, actor: CompiledActor, t: number): number => (smoothDepth > 0 ? t : drawingTime(scene, actor, t));

/**
 * Moving hold: a small drift of an actor's placement (scene px and degrees at `holds` 1), a slow and
 * a quicker noise blended, so a held pose never freezes. Seeded by the actor id: the same every render.
 */
function holdDrift(actor: CompiledActor, holds: number, t: number): { x: number; y: number; rotation: number } {
  const seed = hashString(actor.id);
  const drift = (k: number) => 0.7 * noise1((seed + k * 7919) >>> 0, t * 0.35) + 0.3 * noise1((seed + k * 7919 + 1) >>> 0, t * 0.9);
  return { x: drift(0) * 1.2 * holds, y: drift(1) * 0.8 * holds, rotation: drift(2) * 0.35 * holds };
}

/**
 * Placement of an actor, standing on its ground surface when it has one, or riding another actor.
 * On twos everything about it is taken at its drawing's time; moving holds add their drift on top
 * (a view-time offset, never written into the tracks).
 */
function actorPlacementState(actor: CompiledActor, t: number): Placement {
  const scene = sceneOfActor.get(actor);
  const td = scene ? drawnAt(scene, actor, t) : t;
  const p = samplePlacement(actor.placement, actor.def, td);
  if (actor.ground) p.y = surfaceY(actor.ground.surface, p.x) + actor.ground.offset;
  const placed = actor.mounts ? mountedPlacement(actor, p, td) : p;
  const holds = scene && smoothDepth === 0 ? actor.holds : 0;
  if (!(holds > 0)) return placed;
  const d = holdDrift(actor, holds, td);
  return { ...placed, x: placed.x + d.x, y: placed.y + d.y, rotation: placed.rotation + d.rotation };
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
    const st: Placement = { ...own, rotation: own.rotation + pv.rotation, flip: key.own ? own.flip : pv.flip };
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
    // Not there yet (invisible: waiting to come in) or gone: not framed.
    if (actor && actorPlacementState(actor, t).opacity <= 0.01) continue;
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
      // The camera is not a drawing: it follows the actor's smooth motion (a pan over characters on twos).
      fl.samples ??= inSmoothTime(() =>
        bakeFollow(fl, scene.duration, (tt) => {
          const m = actorPlacement(actor, tt);
          return [m[4], m[5]];
        }),
      );
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
      // Framed over the targets' smooth motion, like a follow.
      fr.samples ??= inSmoothTime(() =>
        bakeFrame(fr, scene.duration, (tt) => {
          const raw = targetsBox(scene, fr.targets, tt, fr.on === "face");
          const box: typeof raw = fr.band ? [raw[0], fr.band[0], raw[2], fr.band[1]] : raw;
          return Number.isFinite(box[0]) ? fitBox(box, scene.width, scene.height, fr.padding, fr.minZoom, fr.maxZoom) : null;
        }),
      );
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
  // Screen-fixed items (parallax 0) are not in the scene: the dolly leaves them alone.
  const zoom = Math.pow(cam.zoom, parallax) * (parallax > 0 ? Math.exp(-(cam.dolly ?? 0) * (1 - parallax)) : 1);
  // A camera roll turns the whole picture alike: rotating each depth by a different angle would
  // shear the scene. Only screen-fixed items (parallax 0) stay upright.
  return multiply(fromTRS(scene.width / 2, scene.height / 2, parallax > 0 ? cam.rotation : 0, zoom, zoom), fromTRS(-cx, -cy, 0));
}

const LOOK_BLEND = 0.35;

/**
 * Scene point of a target: an actor (its head anchor, or its origin), a prop or a scene point.
 * `posed`: the anchor where the actor's pose puts it (a seated actor's head); otherwise its rest
 * place, which needs no pose (looks resolved while a pose is evaluated).
 */
function resolveTargetPoint(scene: CompiledScene, target: Value | undefined, t: number, posed = false, poses?: Map<string, EvaluatedPose>): Vec2 | null {
  if (target === null || target === undefined) return null;
  if (Array.isArray(target)) return target as Vec2;
  if (typeof target !== "string") return null;
  const actor = scene.actors.find((a) => a.id === target);
  if (actor) {
    const head = actor.rig.anchors.head;
    if (head && posed) return anchorPosition(scene, actor.id, "head", t, poses?.get(actor.id));
    return apply(actorPlacement(actor, t), head ? head.at : [0, 0]);
  }
  const prop = scene.props.find((p) => p.id === target);
  if (prop) {
    const p = propPlacement(scene, prop, t, poses);
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
  // The mount is part of the drawing (its placement rides at the drawing's time too).
  const td = drawnAt(scene, actor, t);
  let key: MountKey | undefined;
  for (const k of actor.mounts) if (k.t <= td) key = k;
  if (!key?.on || !key.behind) return undefined;
  const ridden = scene.actors.find((a) => a.id === key!.on);
  return ridden ? { parts: new Set(key.behind), z: actorPlacementState(ridden, t).z } : undefined;
}

/**
 * The actor's pose without its reaches (lazily evaluated) and its extra IK offsets: where a free
 * chain aims (`restTarget` + `ik.<id>.x/y` + offset) and where its root joint is (arcs).
 */
interface FreePose {
  pose: () => EvaluatedPose;
  ikOffset?: Record<string, Vec2>;
}

/** How far an arc bulges at its middle (`arcs` 1), as a fraction of its chord. */
const ARC_BULGE = 0.3;

/**
 * A reach blend's state: the point the chain is held on (scene space; null: free) and its weight
 * (0: free, 1: held). The chain aims at own + (point − own) × weight, `own` being its own target.
 */
interface ReachState {
  point: Vec2 | null;
  weight: number;
}

/**
 * How far the point `u` of the way from `a` to `b` (character space) sits off the straight chord on
 * an arc: `amount × 0.3 × |ab| × sin(π·u)` across the chord, away from `root` (a root on the
 * chord's line: upwards, −y; a vertical chord there: forwards, +x).
 */
function arcOffset(a: Vec2, b: Vec2, u: number, root: Vec2, amount: number): Vec2 {
  const cx = b[0] - a[0], cy = b[1] - a[1];
  const len = Math.hypot(cx, cy);
  if (len < 1e-9 || amount <= 0) return [0, 0];
  let nx = -cy / len, ny = cx / len;
  const side = (root[0] - a[0]) * nx + (root[1] - a[1]) * ny;
  if (side > 1e-6 * len || (Math.abs(side) <= 1e-6 * len && (ny > 1e-9 || (Math.abs(ny) <= 1e-9 && nx < 0)))) {
    nx = -nx;
    ny = -ny;
  }
  const h = amount * ARC_BULGE * len * Math.sin(Math.PI * u);
  return [nx * h, ny * h];
}

/** IK chains held on another actor's anchor (pedals, a handlebar) or a scene point, in character space. */
function reachTargets(scene: CompiledScene, actor: CompiledActor, t: number, toChar: Mat, free?: FreePose): Record<string, { point: Vec2; weight: number }> | undefined {
  if (!actor.reach) return undefined;
  const arcs = scene.animation.arcs ?? 0;
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
  let freePose: EvaluatedPose | undefined;
  let toScene: Mat | undefined;
  for (const [chain, keys] of Object.entries(actor.reach)) {
    let idx = -1;
    for (let k = 0; k < keys.length; k++) if (keys[k].t <= t) idx = k;
    if (idx < 0) continue;
    const key = keys[idx];
    const u = key.blend > 0 ? ease(clamp((t - key.t) / key.blend, 0, 1)) : 1;
    const ci = actor.rig.ik.findIndex((k) => k.id === chain);
    const ik = actor.rig.ik[ci];
    if (!ik) continue;
    // A blend under way goes from where the chain is (the previous target, the point and weight a
    // blend it takes over had reached, or the chain's own target) to the new one — a new reach never
    // jumps — along an arc with `arcs` on. The chain's own target and root joint (character space)
    // come from the pose without reaches: only an arc needs them.
    let own: Vec2 | undefined, root: Vec2 | undefined;
    const ownTarget = (): Vec2 => {
      if (!own) {
        const fp = (freePose ??= free?.pose() ?? evaluatePose(actor.rig, { time: t, clips: actor.clips, tracks: actor.tracks, seed: actor.seed }));
        const extra = free?.ikOffset?.[chain];
        own = [ik.restTarget[0] + fp.state.ikX[ci] + (extra?.[0] ?? 0), ik.restTarget[1] + fp.state.ikY[ci] + (extra?.[1] ?? 0)];
        const m = fp.world[ik.bones[0]];
        root = [m[4], m[5]];
      }
      return own;
    };
    const resolved = new Map<number, ReachState>();
    const target = (i: number): ReachState => {
      let st = resolved.get(i);
      if (!st) {
        const p = resolve(keys[i]);
        st = p ? { point: p, weight: 1 } : { point: null, weight: 0 };
        resolved.set(i, st);
      }
      return st;
    };
    // `u` of the way from state `a` to `b` (points in scene space, as resolved). Without an arc
    // the chain's own target cancels out: the point is the weighted mean of both points.
    const blend = (a: ReachState, b: ReachState, v: number): ReachState => {
      const weight = lerp(a.weight, b.weight, v);
      let point: Vec2 | null;
      if (!a.point || a.weight <= 0) point = b.point;
      else if (!b.point || b.weight <= 0) point = a.point;
      else if (a.weight === b.weight) point = [lerp(a.point[0], b.point[0], v), lerp(a.point[1], b.point[1], v)];
      else {
        const wa = a.weight * (1 - v), wb = b.weight * v;
        point = [(a.point[0] * wa + b.point[0] * wb) / (wa + wb), (a.point[1] * wa + b.point[1] * wb) / (wa + wb)];
      }
      if (arcs > 0 && point && weight > 1e-9) {
        // The arc is drawn by the aimed-at point (own + (point − own) × weight), offset across
        // its chord (chord and root in character space); the point is scaled back so the pose's
        // blend lands on it. sin(πu) over the weight stays bounded.
        const o = ownTarget();
        const aim = (st: ReachState): Vec2 => {
          if (!st.point) return o;
          const c = apply(toChar, st.point);
          return [o[0] + (c[0] - o[0]) * st.weight, o[1] + (c[1] - o[1]) * st.weight];
        };
        const off = applyLinear((toScene ??= invert(toChar)), arcOffset(aim(a), aim(b), v, root!, arcs));
        point = [point[0] + off[0] / weight, point[1] + off[1] / weight];
      }
      return { point, weight };
    };
    // The state of key `i`'s blend at time `at` (its targets taken at t: a moving anchor moves on).
    const stateAt = (i: number, at: number): ReachState => {
      if (i < 0) return { point: null, weight: 0 };
      const k = keys[i];
      const v = k.blend > 0 ? ease(clamp((at - k.t) / k.blend, 0, 1)) : 1;
      const end = target(i);
      return v >= 1 ? end : blend(stateAt(i - 1, k.t), end, v);
    };
    const startState = u < 1 ? stateAt(idx - 1, key.t) : undefined, endState = target(idx);
    const st = startState ? blend(startState, endState, u) : endState;
    if (!st.point) continue;
    // The grip direction blends with the target: between two gripped reaches it turns from one to
    // the other; between a free and a gripped one it switches halfway, like the engine's other
    // stepped channels (a bend side has no in-between).
    const from = blendFrom(startState?.point && startState.weight > 0 ? fromOf(keys[idx - 1]) : undefined, endState.weight > 0 ? fromOf(key) : undefined, u);
    out[chain] = { point: apply(toChar, st.point), weight: st.weight, ...(from ? { from } : {}) };
  }
  return out;
}

/** A grip direction `u` of the way from `a` to `b` (unit vectors; one side without: that side's past halfway). */
function blendFrom(a: Vec2 | undefined, b: Vec2 | undefined, u: number): Vec2 | undefined {
  if (!a || !b) return u < 0.5 ? a : b;
  const v: Vec2 = [lerp(a[0], b[0], u), lerp(a[1], b[1], u)];
  const len = Math.hypot(v[0], v[1]);
  // Opposite directions meet at zero: turn through the way `b` is reached from `a`.
  if (len < 1e-6) return u < 0.5 ? a : b;
  return [v[0] / len, v[1] / len];
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
/**
 * The hand variants of an actor holding props at `t`: every switch part on a holding anchor's bone
 * shows the variant named after the anchor when it has one (a prop held at `fist`), else its `grip`
 * (the fingers close around what they hold) — whatever the clips and controls chose for the hand.
 */
function holdingVariants(scene: CompiledScene, actor: CompiledActor, t: number): Record<string, string> | undefined {
  let out: Record<string, string> | undefined;
  for (const prop of scene.props) {
    for (const g of prop.grabs) {
      if (g.actor !== actor.id || t < g.start || t >= g.end) continue;
      const anchor = actor.rig.anchors[g.anchor];
      if (!anchor) continue;
      for (const part of actor.rig.parts) {
        if (part.type !== "switch" || part.bone !== anchor.bone) continue;
        const variant = g.anchor in part.variants ? g.anchor : "grip" in part.variants ? "grip" : undefined;
        if (variant) (out ??= {})[part.id] = variant;
      }
    }
  }
  return out;
}

function prePhysicsPose(scene: CompiledScene, actor: CompiledActor, t: number): EvaluatedPose {
  const placement = actorPlacement(actor, t);
  const toChar = invert(placement);
  // Looking at a prop held in one's own hand (or a chain of actors holding things and looking at
  // each other) depends on this very pose: inside such a cycle the pose is evaluated without aim.
  let aim: ReturnType<typeof aimTargets> | undefined;
  let reach: ReturnType<typeof reachTargets>;
  const ikOffset = actor.mounts ? undefined : groundFeet(actor, placement);
  const input = (): CharacterInput => ({
    time: t,
    clips: actor.clips,
    tracks: actor.tracks,
    seed: actor.seed,
    aim,
    ikOffset,
    // A rig with a `side` control keeps its asymmetric details (a breast pocket, a wristwatch) on the
    // same side of the body when it faces left (the drawing is mirrored).
    ...(actor.rig.controls.side ? { controls: { side: placement[0] * placement[3] - placement[1] * placement[2] < 0 ? "left" : "right" } } : {}),
    // A hand holding a prop closes around it (its `grip` variant, or the one named after the anchor).
    variants: holdingVariants(scene, actor, t),
  });
  if (!resolvingAim.has(actor)) {
    resolvingAim.add(actor);
    try {
      aim = aimTargets(scene, actor, t, toChar);
      // Arcs measure a reach blend against the pose without reaches (only evaluated when needed).
      reach = reachTargets(scene, actor, t, toChar, { pose: () => evaluatePose(actor.rig, input()), ikOffset });
    } finally {
      resolvingAim.delete(actor);
    }
  }
  return evaluatePose(actor.rig, { ...input(), ikTarget: reach });
}

/** Actors whose physics bake is running (a pose of theirs needed meanwhile is taken before physics). */
const baking = new Set<CompiledActor>();

/**
 * Lazily computed physics bake of an actor. The bake is the same whichever API first needed it: it
 * runs with the aim and mount guards as empty as at the start of a render, so what a pose was being
 * resolved for when it was asked (a rider's seat, a look at the rider) never leaks into the samples.
 */
export function actorBake(scene: CompiledScene, actor: CompiledActor): PhysicsBake | undefined {
  if (actor.rig.physics.length === 0) return undefined;
  if (actor.bake) return actor.bake;
  if (baking.has(actor)) return undefined;
  const aimOuter = [...resolvingAim];
  const mountOuter = [...resolvingMount];
  resolvingAim.clear();
  resolvingMount.clear();
  baking.add(actor);
  try {
    // In smooth time: the springs follow the motion as animated, at the bake's own fixed rate, and
    // the pose and placement callbacks are not quantized to drawings (stepped placements would kick
    // the springs at every drawing). A drawing then takes its sample at its own time (`actorPose`),
    // so a frame on twos shows exactly the smooth animation's frame of that drawing, physics included.
    actor.bake = inSmoothTime(() =>
      bakePhysics(actor.rig, {
        duration: scene.duration,
        poseAt: (t) => prePhysicsPose(scene, actor, t),
        placementAt: (t) => actorPlacement(actor, t),
      }),
    );
  } finally {
    baking.delete(actor);
    resolvingAim.clear();
    resolvingMount.clear();
    for (const a of aimOuter) resolvingAim.add(a);
    for (const a of mountOuter) resolvingMount.add(a);
  }
  return actor.bake;
}

/**
 * Full pose of an actor at time t (including baked physics), in character space. On twos it is the
 * pose of the drawing shown at t: the pose, the aim and reach targets it resolves and the physics
 * sample are all taken at the drawing's time.
 */
export function actorPose(scene: CompiledScene, actor: CompiledActor, t: number): EvaluatedPose {
  const td = drawnAt(scene, actor, t);
  const pose = prePhysicsPose(scene, actor, td);
  applyPhysicsSample(actor.rig, pose, samplePhysics(actorBake(scene, actor), td));
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

/** Hung props whose swing is being baked (the prop's place needed meanwhile hangs straight). */
const hangBaking = new Set<Grab>();

/**
 * Lazily computed swing of a prop hung from a hand (a `grab` with `hang`), over the grab's
 * [start, end) clipped to the scene. It reads the holding anchor's smooth motion (`inSmoothTime`:
 * cartoon timing never changes the physics) at the fixed physics rate, and is the same whichever API
 * first needed it: like `actorBake`, it runs with the aim and mount guards as empty as at the start
 * of a render. Asked while the holder's own springs are being baked (the holder looking at what it
 * carries), the prop hangs straight for that bake and nothing is cached.
 */
export function hangBake(scene: CompiledScene, prop: CompiledProp, grab: Grab): HangBake | undefined {
  const hang = grab.hang;
  if (!hang) return undefined;
  if (grab.hangBake) return grab.hangBake;
  const actor = scene.actors.find((a) => a.id === grab.actor);
  if (!actor || hangBaking.has(grab) || baking.has(actor)) return undefined;
  const aimOuter = [...resolvingAim];
  const mountOuter = [...resolvingMount];
  resolvingAim.clear();
  resolvingMount.clear();
  hangBaking.add(grab);
  try {
    const end = Math.min(grab.end, scene.duration);
    grab.hangBake = inSmoothTime(() =>
      bakeHang({
        start: grab.start,
        duration: Math.max(0, end - grab.start),
        pivotAt: (t) => anchorPosition(scene, actor.id, grab.anchor, t),
        mirroredAt: (t) => {
          const m = actorPlacement(actor, t);
          return m[0] * m[3] - m[1] * m[2] < 0;
        },
        lengthAt: (t) => hang.length * Math.abs(samplePlacement(prop.placement, prop.def, t).scale[1]),
        gravity: hang.gravity,
        damping: hang.damping,
        limit: hang.limit,
      }),
    );
  } finally {
    hangBaking.delete(grab);
    resolvingAim.clear();
    resolvingMount.clear();
    for (const a of aimOuter) resolvingAim.add(a);
    for (const a of mountOuter) resolvingMount.add(a);
  }
  return grab.hangBake;
}

/**
 * How far a hung prop has swung at `t` (degrees from the vertical, scene space, positive = towards
 * +x): 0 when it is not held with `hang`. Taken at its holder's drawing time, like everything
 * attached to the holder (on twos the swing steps with the drawings; the bake itself is smooth).
 */
export function hangAngle(scene: CompiledScene, prop: CompiledProp, t: number): number {
  const grab = prop.grabs.find((g) => t >= g.start && t < g.end);
  if (!grab?.hang) return 0;
  const actor = scene.actors.find((a) => a.id === grab.actor);
  const td = actor ? Math.max(grab.start, drawnAt(scene, actor, t)) : t;
  return sampleHang(hangBake(scene, prop, grab), td);
}

/**
 * A prop hung from the hand: its handle on the anchor, swung by the baked angle about it (rotation
 * −θ: the art's down axis points along (sin θ, cos θ)), and mirrored with its holder. The swing is
 * measured in scene space, so the mirror never reverses it; the prop's own rotation track is
 * ignored while it hangs (gravity decides which way is down) and the anchor's `turn` too.
 */
function hungPlacement(scene: CompiledScene, prop: CompiledProp, grab: Grab, t: number, base: Placement, pose?: EvaluatedPose): Placement {
  const hang = grab.hang!;
  const p = anchorPosition(scene, grab.actor, grab.anchor, t, pose);
  const actor = scene.actors.find((a) => a.id === grab.actor)!;
  const m = actorPlacement(actor, t);
  const flip = base.flip !== m[0] * m[3] - m[1] * m[2] < 0;
  const rot = (-hangAngle(scene, prop, t) * Math.PI) / 180;
  const c = Math.cos(rot), s = Math.sin(rot);
  const px = hang.point[0] * base.scale[0] * (flip ? -1 : 1), py = hang.point[1] * base.scale[1];
  return { ...base, x: p[0] - (px * c - py * s), y: p[1] - (px * s + py * c), rotation: (rot * 180) / Math.PI, flip };
}

/**
 * A prop fitted to the body: its first point on the first anchor, turned so its second point points
 * at the second anchor (or, with one point, turning with that anchor's bone). The points are taken
 * in the prop's own drawing: scaled, and mirrored when the prop is flipped.
 */
function fittedPlacement(scene: CompiledScene, prop: CompiledProp, grab: Grab, t: number, scale: [number, number], flip: boolean, pose?: EvaluatedPose): { x: number; y: number; rotation: number; scale?: [number, number]; side?: "front" | "back" } {
  const [f1, f2] = grab.fit! as [{ point: Vec2; anchor: string }, ({ point: Vec2; anchor: string } | { point: Vec2; angle: number; fixed?: boolean } | { point: Vec2; dir: [number, number, number]; view?: string; face?: [number, number, number]; fixed?: boolean })?];
  const fs = flip ? -1 : 1;
  /** A prop point as drawn (scaled, mirrored when flipped). */
  const drawn = (p: Vec2, sc: [number, number]): Vec2 => [p[0] * sc[0] * fs, p[1] * sc[1]];
  /** Direction from the first point to the second, as drawn. */
  const axis = (sc: [number, number]): number => {
    const [ax, ay] = drawn(f1.point, sc), [bx, by] = drawn(f2!.point, sc);
    return Math.atan2(by - ay, bx - ax);
  };
  const a1 = anchorPosition(scene, grab.actor, f1.anchor, t, pose);
  // The first anchor's bone: how it turns from rest (scene space) and whether the actor is mirrored.
  const actor = scene.actors.find((a) => a.id === grab.actor)!;
  const an = actor.rig.anchors[f1.anchor];
  const p = pose ?? actorPose(scene, actor, t);
  const m = multiply(actorPlacement(actor, t), multiply(p.world[an.bone], actor.rig.bones[an.bone].setupWorldInv));
  const mirrored = m[0] * m[3] - m[1] * m[2] < 0;
  const boneTurn = mirrored ? -Math.atan2(m[1], -m[0]) : Math.atan2(m[1], m[0]);
  let rot: number;
  let shortened: [number, number] | undefined;
  let side: "front" | "back" | undefined;
  if (f2 && "anchor" in f2) {
    const a2 = anchorPosition(scene, grab.actor, f2.anchor, t, pose);
    rot = Math.atan2(a2[1] - a1[1], a2[0] - a1[0]) - axis(scale);
  } else if (f2 && "dir" in f2) {
    // A 3D direction seen from the current view (of the body, or of a head turned on its own): it
    // turns and foreshortens as the view turns, then turns with the bone like an angle.
    const r3 = actor.rig.rig3d;
    let yaw = p.frame3d?.yaw ?? 0;
    const pitch = p.frame3d?.pitch ?? ((r3?.pitch ?? 0) * Math.PI) / 180;
    const cv = p.state.controls[f2.view ?? "view"] as unknown;
    const name = typeof cv === "string" ? cv : cv && typeof cv === "object" ? Object.entries(cv as Record<string, number>).sort((a, b) => b[1] - a[1])[0]?.[0] : undefined;
    if (name && r3) {
      const mirror = name.startsWith("~"), deg = r3.views[mirror ? name.slice(1) : name];
      if (deg !== undefined) yaw = ((mirror ? -deg : deg) * Math.PI) / 180;
    }
    const v = viewPoint(f2.dir, yaw, pitch);
    const len = Math.hypot(v[0], v[1]) / (Math.hypot(...f2.dir) || 1);
    // Foreshortened along the prop's own axis (from its first point to its second).
    const alongX = Math.abs(f2.point[0] - f1.point[0]) >= Math.abs(f2.point[1] - f1.point[1]);
    shortened = alongX ? [scale[0] * Math.max(0.2, len), scale[1]] : [scale[0], scale[1] * Math.max(0.2, len)];
    if (f2.face) {
      // A flat prop: as wide across its axis as its front squarely faces the camera (an edge-on phone
      // is its thickness), showing its front or its back.
      const n = viewPoint(f2.face, yaw, pitch), nz = n[2] / (Math.hypot(...f2.face) || 1);
      const across = Math.max(FLAT_EDGE, Math.abs(nz));
      shortened = alongX ? [shortened[0], shortened[1] * across] : [shortened[0] * across, shortened[1]];
      side = nz >= 0 ? "front" : "back";
    }
    const dir = Math.atan2(v[1], v[0]) + (f2.fixed ? 0 : mirrored ? -boneTurn : boneTurn);
    const world = mirrored ? Math.PI - dir : dir;
    rot = world - axis(shortened);
  } else if (f2) {
    // A direction in the actor's frame (mirrored when it faces left), turning with the bone.
    const dir = (f2.angle * Math.PI) / 180 + (f2.fixed ? 0 : mirrored ? -boneTurn : boneTurn);
    const world = mirrored ? Math.PI - dir : dir;
    rot = world - axis(scale);
  } else rot = boneTurn;
  const c = Math.cos(rot), s = Math.sin(rot);
  const [px, py] = drawn(f1.point, shortened ?? scale);
  void prop;
  return { x: a1[0] - (px * c - py * s), y: a1[1] - (px * s + py * c), rotation: (rot * 180) / Math.PI, ...(shortened ? { scale: shortened } : {}), ...(side ? { side } : {}) };
}

/** The thinnest a flat prop held with `fit` `face` is drawn across, as a fraction of its width (seen edge-on: its thickness, thicker than life to read). */
const FLAT_EDGE = 0.3;

/**
 * Placement of a prop: held, in the hand (fitted to the body, hung from it swinging, or on the anchor,
 * turned with it) —
 * its rigid body, if any, only follows the hand then; free, where its rigid body is, else its tracks
 * (on its ground surface).
 */
export function propPlacement(scene: CompiledScene, prop: CompiledProp, t: number, poses?: Map<string, EvaluatedPose>): Placement {
  const base = samplePlacement(prop.placement, prop.def, t);
  const grab = prop.grabs.find((g) => t >= g.start && t < g.end);
  if (grab?.fit) return { ...base, ...fittedPlacement(scene, prop, grab, t, base.scale, base.flip, poses?.get(grab.actor)) };
  if (grab?.hang) return hungPlacement(scene, prop, grab, t, base, poses?.get(grab.actor));
  if (grab) {
    const pose = poses?.get(grab.actor);
    const p = anchorPosition(scene, grab.actor, grab.anchor, t, pose);
    const turn = anchorTurn(scene, grab.actor, grab.anchor, t, pose);
    return { ...base, x: p[0], y: p[1], ...(turn ? { rotation: base.rotation + turn } : {}) };
  }
  const rigid = scene.rigid?.sample(prop.id, t);
  if (rigid) return { ...base, x: rigid.x, y: rigid.y, rotation: rigid.rotation };
  if (prop.ground) base.y = surfaceY(prop.ground.surface, base.x) + prop.ground.offset;
  return base;
}

/**
 * A prop's cord as a screen path: from its tie point to the other end, sagging when slack and, coiled,
 * its loops opening up as it stretches. Cut, the far part springs back to its end for 0.35 s.
 */
function cordPath(scene: CompiledScene, c: NonNullable<PropDef["cord"]>, propM: Mat, view: Mat, t: number, poses: Map<string, EvaluatedPose>): string | undefined {
  const a = apply(propM, (c.point as Vec2 | undefined) ?? [0, 0]);
  let b: Vec2;
  if (c.to === "up") b = [a[0], a[1] - 4000];
  else if (Array.isArray(c.to)) b = c.to as Vec2;
  else if ("actor" in c.to) b = anchorPosition(scene, c.to.actor, c.to.anchor, t, poses.get(c.to.actor));
  else {
    const to = c.to as { prop: string; point?: Vec2 };
    const other = scene.props.find((q) => q.id === to.prop);
    if (!other) return undefined;
    b = apply(placementMatrix(propPlacement(scene, other, t, poses)), to.point ?? [0, 0]);
  }
  let from: Vec2 = a;
  if (c.cut !== undefined && t >= c.cut) {
    // Snapped: the far part springs back (to its end) and is gone.
    const u = (t - c.cut) / 0.35;
    if (u >= 1) return undefined;
    from = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  }
  const dx = b[0] - from[0], dy = b[1] - from[1];
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return undefined;
  const len = c.length ?? dist;
  const ux = dx / dist, uy = dy / dist, nx = -uy, ny = ux;
  const slack = Math.max(0, len - dist), coils = c.coils ?? 0;
  // Coils open up as it stretches.
  const rad = (c.radius ?? 7) * Math.max(0.25, Math.min(1, len / dist));
  const n = Math.max(12, Math.ceil(coils * 14), Math.ceil(dist / 12));
  const pts: string[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    // Slack hangs down (a parabola), more in the middle.
    const sag = slack * 0.5 * 4 * u * (1 - u);
    let x = from[0] + dx * u, y = from[1] + dy * u + sag;
    if (coils > 0) {
      const th = u * coils * Math.PI * 2;
      const along = rad * 0.6 * Math.cos(th), across = rad * Math.sin(th);
      x += ux * along + nx * across;
      y += uy * along + ny * across;
    }
    const q = apply(view, [x, y]);
    pts.push(`${Math.round(q[0] * 10) / 10} ${Math.round(q[1] * 10) / 10}`);
  }
  return `M${pts.join(" L")}`;
}

/** Screen position of an actor (its posed head anchor), prop or scene point at time t. */
export function screenPoint(scene: CompiledScene, target: string | Vec2, t: number): Vec2 {
  return transitionCenter(scene, cameraAt(scene, t), target, t);
}

// ---------------------------------------------------------------------------
// Smears
// ---------------------------------------------------------------------------

/** Most a smear stretches a drawing, on top of 1 (at `smear` 1: 1.9×). */
const SMEAR_MAX = 0.9;
/**
 * When something smears, measured against its own size, not in screen pixels (so a close-up of a
 * walk is no faster than the wide shot): the strobing rule — a drawing that jumps more than about
 * half its size along the move from one drawing to the next no longer reads as one thing moving, and
 * is drawn stretched over the gap. [start, full]: the move per drawing, as a fraction of the size,
 * where the stretch begins and where it is whole.
 *   body: of the actor's height (a figure is ~0.3 of its height across: half of it, 0.15) — a walk
 *         or an ordinary run stays under it; a dash, a leap, a throw-back goes over;
 *   limb: of the bone's own length (an arm swinging a third of its length per drawing and more);
 *   prop: of a free prop's size.
 */
const SMEAR_BODY: [number, number] = [0.15, 0.6];
const SMEAR_LIMB: [number, number] = [0.3, 1];
const SMEAR_PROP: [number, number] = [0.5, 2];

/**
 * Smear stretch about `p` along the unit direction `dir`: `T(p)·R(θ)·diag(f, 1/√f)·R(−θ)·T(−p)`, so
 * the drawing grows by `f` along its move and thins by `1/√f` across it, and `p` stays put.
 */
function smearMatrix(p: Vec2, dir: Vec2, f: number): Mat {
  const g = 1 / Math.sqrt(f);
  const [c, s] = dir;
  const a = f * c * c + g * s * s;
  const b = (f - g) * c * s;
  const d = f * s * s + g * c * c;
  return [a, b, b, d, p[0] - (a * p[0] + b * p[1]), p[1] - (b * p[0] + d * p[1])];
}

/** 0..1: how far a move of `rel` (per drawing, a fraction of the size) is into the smear range. */
const smearDegree = (rel: number, [start, full]: [number, number]): number => clamp((rel - start) / (full - start), 0, 1);

/**
 * Smear of something of on-screen `size` that moved by `delta` (px per drawing) to `at`: stretched
 * about its leading point, `lead` px ahead of `at` along the move, so the front stays put and the
 * drawing trails back over its path. None when too slow for its size.
 */
function smearAlong(amount: number, at: Vec2, delta: Vec2, size: number, range: [number, number], lead: number): { m: Mat; f: number } | undefined {
  const len = Math.hypot(delta[0], delta[1]);
  if (!(len > 0) || !(size > 0)) return undefined;
  const f = 1 + amount * SMEAR_MAX * smearDegree(len / size, range);
  if (!(f > 1)) return undefined;
  const dir: Vec2 = [delta[0] / len, delta[1] / len];
  return { m: smearMatrix([at[0] + dir[0] * lead, at[1] + dir[1] * lead], dir, f), f };
}

/** Vertical extent of an actor's posed bones and its origin (character px): what its smear's lead is measured against. */
function poseHeight(rig: Rig, pose: EvaluatedPose): number {
  let y0 = 0, y1 = 0;
  for (const bone of rig.bones) {
    const w = pose.world[bone.index];
    for (const y of [w[5], w[1] * bone.length + w[5]]) {
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  return y1 - y0;
}

/**
 * How fast each bone moves since the previous drawing, normalised 0..1 (0: under the limb smear
 * threshold). Joints and tips are compared in character space, so the actor's own move (its
 * placement) is not counted again; the faster of the two is measured against the bone's own length
 * (both seen through `linear`), so the shot's zoom does not change it.
 */
function limbSpeeds(rig: Rig, pose: EvaluatedPose, prev: EvaluatedPose, linear: Mat): number[] {
  return rig.bones.map((bone) => {
    const w = pose.world[bone.index], wp = prev.world[bone.index];
    const tip = apply(w, [bone.length, 0]);
    const tipP = apply(wp, [bone.length, 0]);
    const len = Math.hypot(...applyLinear(linear, [tip[0] - w[4], tip[1] - w[5]]));
    if (!(len > 1e-6)) return 0;
    const sJoint = Math.hypot(...applyLinear(linear, [w[4] - wp[4], w[5] - wp[5]]));
    const sTip = Math.hypot(...applyLinear(linear, [tip[0] - tipP[0], tip[1] - tipP[1]]));
    return smearDegree(Math.max(sJoint, sTip) / len, SMEAR_LIMB);
  });
}

/** Bones that carry a part (a part smears as much as its fastest bone). Solids are not smeared. */
function partBones(part: RigPart): number[] {
  switch (part.type) {
    case "rigid":
    case "switch":
    case "morph":
      return [part.bone];
    case "hose":
      return part.bones;
    case "skinned":
      return part.influences;
    case "hull":
      return part.points.map((q) => q.bone);
    case "solid":
      return [];
  }
}

/**
 * Ghost slots of a multiple-image smear: a part with one ghost (normalised speed under 0.5) uses
 * the middle slot, a part with two the slots at a third and two thirds. `k` numbers a part's ghosts
 * from the previous drawing; the one nearest the current drawing is the strongest.
 */
const GHOST_SLOTS = [
  { u: 1 / 3, ghosts: 2, k: 1, opacity: 0.3 },
  { u: 1 / 2, ghosts: 1, k: 1, opacity: 0.45 },
  { u: 2 / 3, ghosts: 2, k: 2, opacity: 0.45 },
] as const;

/** One ghost of a multiple-image smear: an in-between pose (smooth time) and the parts drawn from it, with their opacities. */
interface SmearGhost {
  k: number;
  /** Ghosts of the parts drawn from it (1 or 2) and their opacity at full speed and `smear` 1. */
  of: number;
  opacity: number;
  /** Smooth time of the in-between. */
  time: number;
  pose: EvaluatedPose;
  parts: Map<string, number>;
}

/** An actor's smears in a frame: its placement, the whole-body stretch (screen space), the limb ghosts (farthest first) and how fast each bone's parts move. */
interface ActorSmear {
  place: Mat;
  body?: Mat;
  ghosts: SmearGhost[];
  /** Normalised speed of each bone's fastest part (0: not smeared). */
  boneQ: number[];
}

/**
 * Limb ghosts of a drawing: each part whose bones moved fast since the previous drawing (`tp`) is
 * also drawn at one or two in-between poses, evaluated in smooth time (on twos they are real
 * in-betweens, not the held drawing), faded by `smear` and its speed.
 */
function limbGhosts(scene: CompiledScene, actor: CompiledActor, td: number, tp: number, q: number[], amount: number): { ghosts: SmearGhost[]; boneQ: number[] } {
  const rig = actor.rig;
  const boneQ = rig.bones.map(() => 0);
  const ghosts: SmearGhost[] = [];
  const partQ = new Map<string, number>();
  for (const part of rig.parts) {
    let pq = 0;
    for (const b of partBones(part)) pq = Math.max(pq, q[b]);
    if (!(pq > 0)) continue;
    partQ.set(part.id, pq);
    for (const b of partBones(part)) boneQ[b] = Math.max(boneQ[b], pq);
  }
  if (!partQ.size) return { ghosts, boneQ };
  for (const slot of GHOST_SLOTS) {
    const parts = new Map<string, number>();
    for (const [id, pq] of partQ) if ((pq < 0.5 ? 1 : 2) === slot.ghosts) parts.set(id, slot.opacity * amount * pq);
    if (!parts.size) continue;
    const time = tp + slot.u * (td - tp);
    ghosts.push({ k: slot.k, of: slot.ghosts, opacity: slot.opacity, time, pose: inSmoothTime(() => actorPose(scene, actor, time)), parts });
  }
  return { ghosts, boneQ };
}

/** Ghosts of `only`'s parts (keys `<prefix>g<k>-<part>`), faded, drawn before the main drawing. */
function ghostNodes(rig: Rig, ghosts: SmearGhost[], prefix: string, only?: (partId: string) => boolean): RenderNode[] {
  const out: RenderNode[] = [];
  for (const g of ghosts) {
    const gp = `${prefix}g${g.k}-`;
    for (const node of renderCharacter(rig, g.pose, gp, (id) => g.parts.has(id) && (!only || only(id)))) {
      const fade = g.parts.get(node.key.slice(gp.length)) ?? 1;
      out.push({ ...node, opacity: (node.opacity ?? 1) * fade });
    }
  }
  return out;
}

/** Screen point of a transition target (posed actor head / prop / scene point; default: center). */
function transitionCenter(scene: CompiledScene, cam: CameraState, target: string | Vec2 | undefined, t: number, poses?: Map<string, EvaluatedPose>): Vec2 {
  const p = target === undefined ? null : resolveTargetPoint(scene, target, t, true, poses);
  return p ? apply(viewMatrix(scene, cam, 1), p) : [scene.width / 2, scene.height / 2];
}

/** Displacement of the line boil on screen at `boil` 1 (px), and the least it shrinks to for small items. */
const BOIL_PX = 2.4;
const BOIL_MIN_PX = 1;

/**
 * Line boil: the SVG filter that makes an item's outlines wobble (turbulence noise displacing its
 * pixels), redrawn every two frames. It is set on the item's own (transformed) element, so the noise
 * belongs to the drawing (a held drawing under a moving camera does not swim) and its strength is
 * given in the item's units: `BOIL_PX × boil` screen px at a screen scale of 1 or more, shrinking
 * with the item (down to `BOIL_MIN_PX × boil`) for small, far ones. The seed steps every two frames
 * of the item's drawing time (on twos and threes: with each drawing), offset per item by `hashString`
 * of its key; the same frame always gets the same seed.
 */
function boilFilter(key: string, boil: number, drawnTime: number, fps: number, m: Mat): { ref: string; def: string } {
  const id = `boil-${key.replace(/[^\w-]/g, "_")}`;
  const seed = Math.floor((drawnTime * fps) / 2 + 1e-6) + 1 + (hashString(key) % 100000);
  const s = matScale(m) || 1;
  const scale = (boil * clamp(BOIL_PX * s, BOIL_MIN_PX, BOIL_PX)) / s;
  return {
    ref: `url(#${id})`,
    def:
      `<filter id="${id}" x="-10%" y="-10%" width="120%" height="120%">` +
      `<feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="${seed}" result="n"/>` +
      `<feDisplacementMap in="SourceGraphic" in2="n" scale="${formatNumber(scale)}" xChannelSelector="R" yChannelSelector="G"/></filter>`,
  };
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
      z: p.z,
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
  // Smears: a fast move drawn stretched along its path (cartoon timing). Off: nothing below runs.
  const smear = scene.animation.smear ?? 0;
  const smears = new Map<string, ActorSmear>();
  // Line boil: one filter per actor and prop in this frame's defs (layers stay still). Off: none.
  const boil = scene.animation.boil ?? 0;
  let boilDefs = "";
  // Crowd shots: more lit actors on screen than `shading.crowd` → no rim light.
  const crowded = !!(light?.shading.crowd && scene.actors.filter((a) => a.def.shading !== false && actorPlacementState(a, t).opacity > 0.01 && a.rig.anchors.head).length > light.shading.crowd);
  // Props held in a hand drawn behind the body (seen from behind, the phone in front of the chest): drawn
  // behind their holder too.
  const heldBehind = new Set<string>();
  for (const actor of scene.actors) {
    const depth = actor.def.parallax ?? 1;
    const pose = actorPose(scene, actor, t);
    poses.set(actor.id, pose);
    const p = actorPlacementState(actor, t);
    const view = viewMatrix(scene, cam, depth);
    const m0 = multiply(view, placementMatrix(p));
    const mPrev = camPrev ? multiply(viewMatrix(scene, camPrev, depth), actorPlacement(actor, t - dtPrev)) : null;
    // Smears compare this drawing with the previous one (on twos, a held frame shows its change
    // frame's smear: it is the same drawing), both seen through this frame's camera — the camera's
    // own move is not a smear. The first drawing has nothing to compare with.
    let sm: ActorSmear | undefined;
    if (smear > 0) {
      const td = drawingTime(scene, actor, t);
      const tp = td - actor.twos / scene.fps;
      if (tp >= -1e-9) {
        const pp = actorPlacementState(actor, tp);
        const o = apply(view, [p.x, p.y]);
        const op = apply(view, [pp.x, pp.y]);
        const tall = poseHeight(actor.rig, pose) * Math.hypot(m0[2], m0[3]);
        const q = limbSpeeds(actor.rig, pose, actorPose(scene, actor, tp), m0);
        sm = {
          place: placementMatrix(p),
          body: smearAlong(smear, o, [o[0] - op[0], o[1] - op[1]], tall, SMEAR_BODY, 0.25 * tall)?.m,
          ...limbGhosts(scene, actor, td, tp, q, smear),
        };
        smears.set(actor.id, sm);
      }
    }
    const m = sm?.body ? multiply(sm.body, m0) : m0;
    /** The parts `only` keeps: their limb ghosts (if any), then the drawing itself. */
    const draw = (prefix: string, only?: (id: string) => boolean): RenderNode[] => [
      ...(sm?.ghosts.length ? ghostNodes(actor.rig, sm.ghosts, prefix, only) : []),
      ...renderCharacter(actor.rig, pose, prefix, only),
    ];
    const z = p.z;
    const artId = `actor-art-${actor.id}`;
    // Riding: some parts (the far leg…) are drawn just behind the ridden actor.
    const under = behindRidden(scene, actor, t);
    // Holding a prop: the prop is drawn just above the actor and the holding hand above the prop
    // (the fingers wrap around it).
    // A 2.5D rig's hand drawn before the body (behind it, from this view): what it holds goes behind too.
    if (actor.rig.rig3d) {
      const ord = pose.drawOrder ?? actor.rig.drawOrder;
      const body = new Set(actor.rig.rig3d.body);
      const start = ord.findIndex((pt) => "bone" in pt && body.has((pt as { bone: number }).bone));
      for (const pr of scene.props) for (const g of pr.grabs) {
        if (g.actor !== actor.id || t < g.start || t >= g.end || g.hang) continue;
        const bone = actor.rig.anchors[g.anchor]?.bone;
        const at = ord.findIndex((pt) => "bone" in pt && (pt as { bone: number }).bone === bone);
        if (start >= 0 && at >= 0 && at < start) heldBehind.add(pr.id);
      }
    }
    // (Not over a flat prop's front: the hand holds it from behind, only its back is wrapped by the
    // fingers; nor over a prop held behind the body.)
    const holdBones = new Set(scene.props.flatMap((pr) => pr.grabs.filter((g) => g.actor === actor.id && t >= g.start && t < g.end && !heldBehind.has(pr.id) && !(pr.def.back && propPlacement(scene, pr, t, poses).side === "front")).flatMap((g) => [g.anchor, ...(g.also ?? [])].map((an) => actor.rig.anchors[an]?.bone))).filter((b): b is number => b !== undefined));
    const overParts = new Set(holdBones.size ? actor.rig.parts.filter((pt) => "bone" in pt && holdBones.has((pt as { bone: number }).bone)).map((pt) => pt.id) : []);
    // The boil follows the actor's drawings; the held hand and the parts behind a mount share it.
    const boiled = boil > 0 ? boilFilter(`actor-${actor.id}`, boil, drawingTime(scene, actor, t), scene.fps, m) : undefined;
    if (boiled) boilDefs += boiled.def;
    const actorNode: RenderNode = {
      kind: "group",
      key: `actor-${actor.id}`,
      id: artId,
      transform: m,
      opacity: p.opacity < 1 ? p.opacity : undefined,
      // Motion blur measures the unsmeared move; with smears on, it blurs the smeared drawing.
      filter: blurFor(depth, m0, mPrev),
      ...(boiled ? { svgFilter: boiled.ref } : {}),
      children: draw(`${actor.id}-`, under || overParts.size ? (id) => !under?.parts.has(id) && !overParts.has(id) : undefined),
    };
    if (overParts.size) {
      const node: RenderNode = { ...actorNode, key: `actor-${actor.id}-hand`, id: undefined, children: draw(`${actor.id}-h-`, (id) => overParts.has(id)) };
      items.push({ z: z + 2e-3, order: order++, node });
    }
    if (under) {
      const node: RenderNode = { ...actorNode, key: `actor-${actor.id}-behind`, id: undefined, children: draw(`${actor.id}-b-`, (id) => under.parts.has(id)) };
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
      // The masks get their own copy of the (unblurred, id-less) actor art. A boiled copy keeps its
      // boil, so the masks wobble with the drawing: the copy's references are namespaced by the
      // shading (`shade-<actor id>`), so its boil filter gets a namespaced twin.
      const art = nodeToString({ ...actorNode, id: undefined, filter: undefined, opacity: undefined });
      const lit = crowded ? { ...light, shading: { ...light.shading, rimOpacity: 0 } } : light;
      const shade = shadingMarkup(lit, key, actor.id, art, apply(m0, local), Math.hypot(m0[0], m0[1]), scene.width, scene.height, box);
      const markup = shade && boiled ? namespaceIds(boiled.def, `shade-${actor.id}`) + shade : shade;
      if (markup) items.push({ z, order: order++, node: { kind: "markup", key: `shade-${actor.id}`, markup: p.opacity < 1 ? `<g opacity="${p.opacity}">${markup}</g>` : markup } });
    }
  }

  for (const prop of scene.props) {
    const depth = prop.def.parallax ?? 1;
    const p = propPlacement(scene, prop, t, poses);
    // (Not there: nothing drawn — a hidden prop's art can be large, e.g. an album's other pages.)
    if (p.opacity <= 0.001) continue;
    const holder = prop.grabs.find((g) => t >= g.start && t < g.end);
    const holderActor = holder ? scene.actors.find((a) => a.id === holder.actor) : undefined;
    const holderZ = holderActor ? actorPlacementState(holderActor, t).z : undefined;
    const m0 = multiply(viewMatrix(scene, cam, depth), placementMatrix(p));
    const mPrev = camPrev ? multiply(viewMatrix(scene, camPrev, depth), placementMatrix(propPlacement(scene, prop, t - dtPrev))) : null;
    let m = m0;
    const ghosts: RenderNode[] = [];
    if (smear > 0 && holder && holderActor) {
      // Held: it stretches with its holder's whole body, and has ghosts with the holding hand's
      // (as many, as faded): the prop where the in-between pose's hand holds it, carried from the
      // holder's place at that smooth time to its place now.
      const sm = smears.get(holder.actor);
      if (sm?.body) m = multiply(sm.body, m0);
      const bone = holderActor.rig.anchors[holder.anchor]?.bone;
      const hq = sm && bone !== undefined ? sm.boneQ[bone] : 0;
      if (sm && hq > 0) {
        const view = viewMatrix(scene, cam, depth);
        for (const g of sm.ghosts) {
          if (g.of !== (hq < 0.5 ? 1 : 2) || g.time < holder.start || g.time >= holder.end) continue;
          const gp = inSmoothTime(() => placementMatrix(propPlacement(scene, prop, g.time, new Map([[holder.actor, g.pose]]))));
          const ga = inSmoothTime(() => actorPlacement(holderActor, g.time));
          const gm = multiply(view, multiply(sm.place, multiply(invert(ga), gp)));
          ghosts.push({ kind: "markup", key: `prop-${prop.id}-g${g.k}`, transform: sm.body ? multiply(sm.body, gm) : gm, opacity: p.opacity * g.opacity * smear * hq, markup: prop.markup });
        }
      }
    } else if (smear > 0 && t - dtPrev >= -1e-9) {
      // Free: smooth, so it is compared with the previous frame, through this frame's camera. Its
      // size is estimated from its scale (40 px art at scale 1).
      const view = viewMatrix(scene, cam, depth);
      const pp = propPlacement(scene, prop, t - dtPrev);
      const o = apply(view, [p.x, p.y]);
      const op = apply(view, [pp.x, pp.y]);
      const extent = 40 * Math.sqrt(Math.abs(m0[0] * m0[3] - m0[1] * m0[2]));
      const st = smearAlong(smear, o, [o[0] - op[0], o[1] - op[1]], extent, SMEAR_PROP, 0.5 * extent);
      if (st) m = multiply(st.m, m0);
    }
    if (prop.def.cord) {
      const vm = viewMatrix(scene, cam, depth);
      const d = cordPath(scene, prop.def.cord, placementMatrix(p), vm, t, poses);
      if (d) {
        const c = prop.def.cord;
        items.push({
          z: c.z ?? (holder ? (holderZ ?? 0) - 1e-3 : p.z - 1e-3),
          order: order++,
          node: { kind: "path", key: `cord-${prop.id}`, d, attrs: { fill: "none", stroke: c.color ?? "#2a2a2a", "stroke-width": Math.round((c.width ?? 3) * Math.hypot(vm[0], vm[1]) * 100) / 100, "stroke-linecap": "round", "stroke-linejoin": "round" } },
        });
      }
    }
    // Held: just above its holder (under the holding hand, above the rest of the body).
    const propZ = holder ? (holderZ ?? 0) + (heldBehind.has(prop.id) ? -1e-3 : 1e-3) : p.z;
    // A held prop boils with its holder's drawings; a free prop is smooth (every two frames).
    const boiled = boil > 0 ? boilFilter(`prop-${prop.id}`, boil, holderActor ? drawingTime(scene, holderActor, t) : t, scene.fps, m) : undefined;
    if (boiled) boilDefs += boiled.def;
    for (const node of ghosts) items.push({ z: propZ, order: order++, node });
    items.push({
      z: propZ,
      order: order++,
      node: {
        kind: "markup",
        key: `prop-${prop.id}`,
        transform: m,
        opacity: p.opacity < 1 ? p.opacity : undefined,
        filter: blurFor(depth, m0, mPrev),
        ...(boiled ? { svgFilter: boiled.ref } : {}),
        markup: p.side === "back" && prop.def.back ? prop.def.back : prop.markup,
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
      // Fixed to the frame: x/y are screen coordinates (defaults resolved when compiled).
      m = [e.scale, 0, 0, e.scale, e.x, e.y];
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
      z = actorPlacementState(actor, t).z + (BEHIND_FX.includes(e.type) ? -0.01 : 0.5);
    } else {
      const v = viewMatrix(scene, cam, 1);
      const pr = e.prop ? scene.props.find((q) => q.id === e.prop) : undefined;
      const at: Vec2 = pr ? (() => { const pl = propPlacement(scene, pr, t, poses); return [pl.x + e.offset[0], pl.y + e.offset[1]] as Vec2; })() : [e.x, e.y];
      const p = apply(v, at);
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
      center: transitionCenter(scene, cam, tr.target, t, poses),
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
    defs: scene.defs + boilDefs,
    nodes: items.map((i) => i.node),
  };
}

/** Frame index → seconds. */
export const frameTime = (scene: CompiledScene, frame: number): number => frame / scene.fps;
/** Frames in a scene (floating point noise in `duration × fps` does not add one). */
export const frameCount = (scene: CompiledScene): number => Math.ceil(scene.duration * scene.fps - 1e-6);
