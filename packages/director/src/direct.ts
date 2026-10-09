import {
  type MouthCue,
  type SceneDoc,
  type SequenceDoc,
  anchorPosition,
  compileScene,
  screenPoint,
  cuesFromText,
  mergeCues,
  validateScene,
  validateSequence,
} from "@animestudio/core";
import type { Beat, Block, CastMember, Directed, Issue, Kit, Line, Overlay, Place, SetDef, Staging, When } from "./types";

type Action = Record<string, unknown> & { at: number; action: string };
type Key = [number, number | string, string?];

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .trim();

/** "unknown x" messages name the closest valid id. */
/** Controls with their own actions, never worn. */
const NOT_WORN = ["view", "emotion"];
/**
 * Wardrobe controls of a rig (outfits, accessories): the pose controls listed in `meta.wardrobe`,
 * or, without that list, every pose control except `view` and `emotion`.
 */
export function wardrobeOf(doc: unknown): Record<string, string[]> {
  const d = doc as { meta?: { wardrobe?: string[] }; controls?: Record<string, { type: string; poses?: Record<string, unknown> }> } | undefined;
  const pose = Object.entries(d?.controls ?? {}).filter(([id, c]) => c.type === "pose" && !NOT_WORN.includes(id));
  const listed = d?.meta?.wardrobe;
  return Object.fromEntries(pose.filter(([id]) => !listed || listed.includes(id)).map(([id, c]) => [id, Object.keys(c.poses ?? {})]));
}

export function closest(word: string, options: string[]): string {
  const d = (a: string, b: string) => {
    const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) m[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return m[a.length][b.length];
  };
  const best = [...options].sort((a, b) => d(norm(word), norm(a)) - d(norm(word), norm(b)))[0];
  return best ? ` (did you mean "${best}"? valid: ${options.join(", ")})` : "";
}

/** Lighting presets for `light { mood }`: grade colour/opacity and the sun's height. */
export const MOODS: Record<string, { grade: string; opacity: number; ambient?: { color: string; opacity: number } }> = {
  morning: { grade: "#fff0b8", opacity: 0.1 },
  day: { grade: "#ffcf8a", opacity: 0.08 },
  afternoon: { grade: "#ff9d5c", opacity: 0.22 },
  evening: { grade: "#ff6f6f", opacity: 0.3, ambient: { color: "#4a3a8a", opacity: 0.25 } },
  night: { grade: "#3a4aa0", opacity: 0.35, ambient: { color: "#1c1f4a", opacity: 0.55 } },
};

/** Lead time: a block (and its camera) starts this much before its first line. */
const LEAD = 0.25;
const SLOT = 230;

// ------------------------------------------------------------------ timing

export class Timeline {
  constructor(readonly lines: Line[]) {}
  start(i: number): number {
    return this.lines[i]?.s ?? this.end;
  }
  get end(): number {
    const last = this.lines[this.lines.length - 1];
    return last ? last.e + 0.6 : 0;
  }
  /** Episode time of a `When`. */
  at(w: When): number {
    const l = this.lines[w.line];
    if (!l) throw new Error(`line ${w.line} does not exist (${this.lines.length} lines)`);
    let t = w.end ? l.e : l.s;
    if (w.word && l.words?.length) {
      const target = norm(w.word);
      const word = l.words.find((x) => norm(x.w) === target) ?? l.words.find((x) => norm(x.w).startsWith(target));
      if (word) t = w.end ? word.e : word.s;
    }
    return t + (w.offset ?? 0);
  }
  blockStart(b: Block) {
    return b.from <= 0 ? 0 : Math.max(0, this.start(b.from) - LEAD);
  }
  blockEnd(b: Block) {
    return b.to >= this.lines.length ? this.end : this.start(b.to) - LEAD;
  }
}

/** Mouth cues of a line from its word timings (relative to the line start). */
export function lineCues(l: Line): MouthCue[] {
  if (!l.words?.length) return cuesFromText(l.text, { duration: l.e - l.s });
  const cues: MouthCue[] = [];
  const last = l.words.length - 1;
  for (const [i, w] of l.words.entries()) {
    // Aligners often end the last word early (a drawn-out last word): keep the mouth moving until
    // the voice ends — `voiceEnd` when known, else the line end minus its usual trailing silence.
    const voiceEnd = l.voiceEnd ?? l.e - 0.22;
    const end = i === last ? Math.max(w.e, voiceEnd) : w.e;
    for (const c of cuesFromText(w.w, { start: Math.max(0, w.s - l.s), duration: Math.max(0.08, end - w.s) })) if (c.value !== "X" || c.end - c.start > 0.06) cues.push(c);
  }
  cues.sort((a, b) => a.start - b.start);
  const out: MouthCue[] = [];
  let t = 0;
  for (const c of cues) {
    if (c.start > t + 0.02) out.push({ start: r3(t), end: r3(c.start), value: "X" });
    out.push({ start: r3(Math.max(c.start, t)), end: r3(c.end), value: c.value });
    t = Math.max(t, c.end);
  }
  out.push({ start: r3(t), end: r3(t + 0.1), value: "X" });
  return mergeCues(out.filter((c) => c.end > c.start));
}

/** Every beat action (`do`). */
export const ACTIONS = ["walk", "run", "enter", "exit", "face", "look", "emotion", "wear", "gesture", "fx", "view", "hold", "release", "cross", "pick", "drop", "throw", "roll", "dribble", "vehicle", "fixture", "camera", "light", "mount", "dismount", "ride", "fall", "sit", "lie", "sleep", "getUp", "fly"];
/** Camera types. */
export const CAMERAS = ["wide", "group", "two-shot", "close", "follow", "reveal"];

// ------------------------------------------------------------------ one block = one continuous scene

interface Walk { actor: string; t0: number; t1: number; x0: number; x1: number }
interface PropState { id: string; radius: number; x: Key[]; y: Key[]; scale: Key[]; rotation: Key[]; heldBy: { actor: string; t0: number; t1: number }[] }

class BlockScene {
  readonly actors: Record<string, unknown>[] = [];
  readonly props: Record<string, unknown>[] = [];
  readonly script: Action[] = [];
  readonly tracks: Record<string, Key[]> = {};
  private walks: Walk[] = [];
  private x0: Record<string, number> = {};
  private facing0: Record<string, boolean> = {};
  private busy: { actor: string; t0: number; t1: number }[] = [];
  private views: { actor: string; t: number; view: string }[] = [];
  private holds: { actor: string; t0: number; t1: number }[] = [];
  /** Who holds whose hand (a on the left), so a new hold extends the chain instead of breaking it. */
  private handPairs: { a: string; b: string; t1: number }[] = [];
  private faces: { actor: string; t: number }[] = [];
  /** When each actor started crossing to the far ground (smaller from then on). */
  private crossed = new Map<string, number>();
  /** Riding: who is on which vehicle, and when. */
  private rides: { rider: string; vehicle: string; t0: number; t1: number }[] = [];
  /** Block vehicles (id → kind, scale) and the ones lying on their side. */
  private vehicleOf = new Map<string, { kind: string; scale: number }>();
  private fallen = new Set<string>();
  /** Block furniture (id → kind, scale). */
  private furnitureOf = new Map<string, { kind: string; scale: number; y: number; cover?: string }>();
  /** Sitting / lying (on furniture or the ground) and lying after a fall, until they get up. */
  private rests: { actor: string; kind: "sit" | "lie" | "fallen"; on: string | null; t0: number; t1: number; y?: number; front?: boolean; tuck?: boolean; sleep?: boolean }[] = [];
  private propStates = new Map<string, PropState>();
  private cam: Record<string, unknown>;
  readonly present: string[] = [];
  readonly t0: number;
  readonly t1: number;
  readonly setDef: SetDef;

  constructor(
    readonly block: Block,
    readonly kit: Kit,
    readonly time: Timeline,
    readonly issues: Issue[],
    first = false,
  ) {
    // The first block starts the episode (whatever cuts show before its first line).
    this.t0 = first ? 0 : time.blockStart(block);
    this.t1 = time.blockEnd(block);
    const set = kit.sets[block.set];
    if (!set) throw new Error(`block "${block.id}": unknown set "${block.set}" (sets: ${Object.keys(kit.sets).join(", ")})`);
    this.setDef = set;
    this.cam = { x: this.mark("center").x, y: (kit.height ?? 1080) / 2, zoom: 1, ...(set.bounds ? { bounds: set.bounds } : {}) };
  }

  // -------------------------------------------------- helpers
  t = (abs: number) => r3(Math.min(this.t1 - this.t0, Math.max(0, abs - this.t0)));
  push(a: Action) {
    this.script.push(a);
  }
  mark(name: string) {
    if (typeof name !== "string") {
      this.issue("error", `expected a mark name, got ${JSON.stringify(name)} (cast "at" takes a mark; use "offset" to move along)`);
      return { x: (this.kit.width ?? 1920) / 2 };
    }
    const m = this.setDef.marks[name];
    if (m) return m;
    if (name === "center") return { x: (this.kit.width ?? 1920) / 2 };
    if (name === "left") return { x: 160 };
    if (name === "right") return { x: (this.kit.width ?? 1920) - 160 };
    this.issue("error", `unknown mark "${name}" in set "${this.block.set}"${closest(name, [...Object.keys(this.setDef.marks), "center", "left", "right"])}`);
    return { x: (this.kit.width ?? 1920) / 2 };
  }
  issue(severity: Issue["severity"], message: string) {
    this.issues.push({ severity, where: `block ${this.block.id}`, message });
  }
  member(id: string): CastMember | undefined {
    return this.kit.cast[id];
  }
  scaleOf(id: string) {
    return this.member(id)?.scale ?? 1;
  }
  /** Smallest distance between two characters standing side by side, `a` left of `b`, so that
   *  neither covers the other: what `a` reaches to the right plus what `b` reaches to the left. */
  pairGap(a: string, b: string, aRight = true, bRight = true): number {
    const ea = this.member(a)?.rig.extent ?? { front: 60, back: 60 };
    const eb = this.member(b)?.rig.extent ?? { front: 60, back: 60 };
    return ((aRight ? ea.front : ea.back) * this.scaleOf(a) + (bRight ? eb.back : eb.front) * this.scaleOf(b)) * 0.95 + 20;
  }
  /** Scene x of a place at a given time. Next to someone = beside them, never on top of them. */
  placeX(p: Place, abs: number, who?: string): number {
    const beside = (target: string, side?: "left" | "right") => {
      const tx = this.xAt(target, abs);
      const left = side ? side === "left" : !!who && this.xAt(who, abs) < tx;
      // The walker ends facing the target.
      return left ? tx - (who ? this.pairGap(who, target, true, false) : SLOT) : tx + (who ? this.pairGap(target, who, true, false) : SLOT);
    };
    if (typeof p === "string") {
      if (this.present.includes(p)) return beside(p);
      if (this.propStates.has(p)) return this.propX(p, abs);
      return this.mark(p).x;
    }
    if ("mark" in p) return this.mark(p.mark).x + (p.dx ?? 0);
    return beside(p.near, p.side);
  }
  xAt(actor: string, abs: number): number {
    let x = this.x0[actor] ?? 960;
    for (const w of this.walks.filter((w) => w.actor === actor).sort((a, b) => a.t0 - b.t0)) {
      if (abs >= w.t1) x = w.x1;
      else if (abs > w.t0) x = w.x0 + ((w.x1 - w.x0) * (abs - w.t0)) / (w.t1 - w.t0);
    }
    return x;
  }
  private viewAt(actor: string, abs: number) {
    return this.views.filter((v) => v.actor === actor && v.t <= abs).sort((a, b) => b.t - a.t)[0]?.view ?? "profile";
  }

  // -------------------------------------------------- cast
  placeCast() {
    const entries = this.block.cast.filter((c) => {
      if (this.kit.cast[c.id]) return true;
      this.issue("error", `"${c.id}" is not in the cast${closest(c.id, Object.keys(this.kit.cast))}`);
      return false;
    });
    // Group by anchor mark; spread each group left → right in the listed order.
    const groups = new Map<string, typeof entries>();
    for (const c of entries) groups.set(c.at ?? "center", [...(groups.get(c.at ?? "center") ?? []), c]);
    const xs = new Map<string, number>();
    for (const [mark, group] of groups) {
      const widths = group.map((c) => this.spacing(c.id));
      const total = widths.reduce((a, b) => a + b, 0) - widths[widths.length - 1];
      let x = this.mark(mark).x - total / 2;
      group.forEach((c, i) => {
        xs.set(c.id, x + (c.offset ?? 0) * SLOT * this.scaleOf(c.id));
        x += widths[i];
      });
    }
    this.spaceOut(entries.map((c) => c.id), xs, entries);
    for (const c of entries) {
      const x = xs.get(c.id)!;
      // An "enter" beat is the same as an `enter` on the cast entry.
      const eb = (this.block.beats ?? []).find((b) => b.do === "enter" && (b.who === c.id || (Array.isArray(b.who) && b.who.includes(c.id))));
      const enter = c.enter ?? (eb ? { line: eb.line, word: eb.word, from: (eb.from as "left" | "right" | "top") ?? "left", run: !!eb.run, fly: !!eb.fly } : undefined);
      const startX = enter ? (enter.from === "left" ? -400 : enter.from === "right" ? (this.kit.width ?? 1920) + 400 : x + (x > (this.kit.width ?? 1920) / 2 ? 650 : -650)) : x;
      const flip = c.facing ? c.facing === "left" : enter ? enter.from === "right" : x > this.mark("center").x + 120;
      this.addActor(c.id, startX, { flip, emotion: c.emotion });
      if (c.wear) this.wear(c.id, c.wear, this.t0);
      if (enter?.fly) {
        this.flyIn(c.id, x, this.time.at(enter), enter.from);
      } else if (enter) {
        const at = this.time.at(enter);
        this.walk(c.id, x, at, Math.abs(x - startX) / ((this.member(c.id)?.speed?.[enter.run ? "run" : "walk"] ?? (enter.run ? 380 : 170)) * this.scaleOf(c.id)), { clip: enter.run ? "run" : "walk" });
      }
    }
  }
  /** Distance to the next character so heads never overlap (facing right). */
  private spacing(id: string) {
    const rig = this.member(id)?.rig;
    return ((rig?.extent.front ?? 100) + 90) * this.scaleOf(id);
  }
  private spaceOut(ids: string[], xs: Map<string, number>, entries: Block["cast"]) {
    const facingRight = (id: string) => {
      const e = entries.find((c) => c.id === id);
      return e?.facing ? e.facing === "right" : xs.get(id)! <= this.mark("center").x + 120;
    };
    for (let pass = 0; pass < 8; pass++) {
      const list = [...ids].sort((a, b) => xs.get(a)! - xs.get(b)!);
      for (let i = 1; i < list.length; i++) {
        const A = list[i - 1], B = list[i];
        const ea = this.member(A)!.rig.extent, eb = this.member(B)!.rig.extent;
        const need = ((facingRight(A) ? ea.front : ea.back) * this.scaleOf(A) + (facingRight(B) ? eb.back : eb.front) * this.scaleOf(B)) * 0.95;
        const gap = xs.get(B)! - xs.get(A)!;
        if (gap < need) {
          xs.set(A, xs.get(A)! - (need - gap) / 2);
          xs.set(B, xs.get(B)! + (need - gap) / 2);
        }
      }
    }
  }
  addActor(id: string, x: number, o: { flip?: boolean; emotion?: string; y?: number; scale?: number; character?: string; z?: number; palette?: Record<string, string>; parallax?: number } = {}) {
    const cast = !!this.kit.cast[id];
    this.actors.push({
      id,
      character: o.character ?? id,
      x: Math.round(x),
      y: Math.round(o.y ?? this.setDef.ground.near),
      scale: o.scale ?? this.scaleOf(id),
      flip: !!o.flip,
      z: o.z ?? 2,
      ...(o.palette ? { palette: o.palette } : {}),
      ...(o.parallax !== undefined ? { parallax: o.parallax } : {}),
    });
    this.x0[id] = x;
    this.facing0[id] = !o.flip;
    if (cast) {
      this.present.push(id);
      if (this.hasClip(id, "idle")) this.push({ at: 0, actor: id, action: "play", clip: "idle", loop: true, layer: -1, fadeIn: 0 });
      if (this.hasControl(id, "emotion")) this.push({ at: 0, actor: id, action: "pose", control: "emotion", value: o.emotion ?? "happy", duration: 0 });
      if (this.hasControl(id, "view")) this.push({ at: 0, actor: id, action: "pose", control: "view", value: "profile", duration: 0 });
    }
  }

  // -------------------------------------------------- primitive actions
  walk(actor: string, x: number, abs: number, dur: number, o: { clip?: string; y?: number; ease?: string } = {}) {
    // Sitting or lying: stand up first.
    const rest = this.rests.find((l) => l.actor === actor && l.t0 < abs && l.t1 === Infinity);
    if (rest) this.getUp(actor, Math.max(rest.t0 + 0.1, abs - 0.6));
    const x0 = this.xAt(actor, abs);
    const d = Math.max(0.4, dur);
    this.walks.push({ actor, t0: abs, t1: abs + d, x0, x1: x });
    this.busy.push({ actor, t0: abs, t1: abs + d });
    this.push({ at: this.t(abs), actor, action: "walkTo", x: Math.round(x), duration: r3(d), ...(o.y !== undefined ? { y: Math.round(o.y) } : {}), ...(o.clip ? { clip: o.clip } : {}), ...(o.ease ? { ease: o.ease } : {}) });
  }
  hasClip(actor: string, clip: string) {
    return !!this.kit.characters[this.characterOf(actor)]?.clips?.[clip];
  }
  /** Outfit / accessory changes (pose controls of the rig's wardrobe), instantly. */
  wear(actor: string, items: Record<string, string>, abs: number) {
    const doc = this.kit.characters[this.characterOf(actor)];
    const wardrobe = wardrobeOf(doc);
    for (const [control, value] of Object.entries(items)) {
      if (NOT_WORN.includes(control)) {
        this.issue("error", `"${control}" is not worn: use the "${control}" action`);
        continue;
      }
      const poses = wardrobe[control];
      if (!poses) {
        this.issue("error", `${actor} has no wardrobe control "${control}"${closest(control, Object.keys(wardrobe))}${Object.keys(wardrobe).length ? "" : " (the rig has none)"}`);
        continue;
      }
      if (!poses.includes(String(value))) {
        this.issue("error", `${actor}'s "${control}" has no "${value}"${closest(String(value), poses)} (has ${poses.join(", ")})`);
        continue;
      }
      this.push({ at: this.t(abs), actor, action: "pose", control, value, duration: 0 });
    }
  }
  hasControl(actor: string, control: string) {
    return !!this.kit.characters[this.characterOf(actor)]?.controls?.[control];
  }
  play(actor: string, clip: string, abs: number, dur?: number, o: Record<string, unknown> = {}) {
    if (!this.hasClip(actor, clip)) {
      // The automatic gestures (talk, turn, hold…) are optional; staged ones are reported.
      if (!["talk", "sing", "turn", "hold"].includes(clip)) this.issue("warning", `${actor} has no clip "${clip}"${closest(clip, Object.keys(this.kit.characters[this.characterOf(actor)]?.clips ?? {}))}`);
      return;
    }
    this.push({ at: this.t(abs), actor, action: "play", clip, ...(dur ? { duration: r3(dur), loop: true } : {}), fadeIn: 0.25, fadeOut: 0.3, ...o });
    this.busy.push({ actor, t0: abs, t1: abs + (dur ?? 1) });
  }
  private characterOf(actor: string) {
    return (this.actors.find((a) => a.id === actor)?.character as string) ?? actor;
  }
  set(actor: string, channel: string, value: unknown, abs: number, dur = 0, ease?: string) {
    this.push({ at: this.t(abs), actor, action: "set", channel, value, duration: r3(dur), ...(ease ? { ease } : {}) });
  }
  face(actor: string, dir: "left" | "right", abs: number) {
    this.faces.push({ actor, t: abs });
    this.push({ at: this.t(abs), actor, action: "face", direction: dir });
  }
  view(actor: string, v: string, abs: number, turn = true) {
    this.views.push({ actor, t: abs, view: v });
    if (!this.hasControl(actor, "view")) return this.issue("warning", `${actor} has no "view" control`);
    if (turn && this.hasClip(actor, "turn")) this.push({ at: this.t(abs - 0.12), actor, action: "play", clip: "turn", fadeIn: 0.02, fadeOut: 0.05 });
    this.push({ at: this.t(abs), actor, action: "pose", control: "view", value: v, duration: 0 });
    // Facing the camera means looking at the camera.
    if (v === "front") this.push({ at: this.t(abs), actor, action: "lookAt", target: null });
  }

  // -------------------------------------------------- props
  addProp(id: string, kind: string, color: string | undefined, x: number, y: number, z = 3) {
    const def = this.kit.props[kind];
    if (!def) {
      this.issue("error", `unknown prop kind "${kind}"${closest(kind, Object.keys(this.kit.props))}`);
      return;
    }
    this.props.push({ id, art: def.art({ color }), x: Math.round(x), y: Math.round(y), z });
    this.propStates.set(id, { id, radius: def.radius, x: [], y: [], scale: [], rotation: [], heldBy: [] });
  }
  propX(id: string, abs: number): number {
    const st = this.propStates.get(id);
    if (!st) return (this.kit.width ?? 1920) / 2;
    const held = st.heldBy.find((h) => h.t0 <= abs && h.t1 > abs);
    if (held) return this.xAt(held.actor, abs);
    const k = [...st.x].reverse().find((k) => k[0] <= this.t(abs));
    return (k?.[1] as number) ?? ((this.props.find((p) => p.id === id)?.x as number) ?? 960);
  }
  grab(actor: string, prop: string, abs: number) {
    const st = this.propStates.get(prop);
    if (!st) return this.issue("error", `unknown prop "${prop}"`);
    st.heldBy.push({ actor, t0: abs, t1: Infinity });
    this.push({ at: this.t(abs), action: "grab", actor, prop, anchor: "hand" });
  }
  release(prop: string, abs: number) {
    const st = this.propStates.get(prop);
    if (!st) return;
    const h = st.heldBy.find((h) => h.t1 === Infinity);
    if (!h) return;
    h.t1 = abs;
    this.push({ at: this.t(abs), action: "release", actor: h.actor, prop });
  }
  /** Hand position of an actor (scene space) while playing a clip at clip time `ct`. */
  private handIn(actor: string, clip: string, ct: number): [number, number] {
    const doc = this.kit.characters[this.characterOf(actor)];
    const probe: SceneDoc = {
      format: "toon-scene", version: 1, width: 100, height: 100, fps: 30, duration: 4,
      characters: { c: "c" }, actors: [{ id: "a", character: "c", x: 0, y: 0, scale: 1 }],
      script: [
        { at: 0, actor: "a", action: "play", clip, loop: true, fadeIn: 0 },
        { at: 0, actor: "a", action: "set", channel: "behaviors.breathe.mix", value: 0 },
      ],
    } as unknown as SceneDoc;
    try {
      const p = anchorPosition(compileScene(probe, { characters: { c: doc } }), "a", "hand", ct);
      return [p[0], p[1]];
    } catch {
      const h = this.member(actor)?.rig.hand.F ?? [20, -70];
      return [h[0], h[1]];
    }
  }

  // -------------------------------------------------- beats
  beat(b: Beat) {
    const at = this.time.at(b);
    const until = b.until ? this.time.at(b.until) : undefined;
    const all = (b.who === undefined ? [] : Array.isArray(b.who) ? b.who : [b.who]) as string[];
    // The camera can frame anything in the scene (cast, fixtures, vehicles, props); the other
    // actions are for the cast present in the block.
    const valid = b.do === "camera" ? [...this.actors.map((a) => a.id as string), ...this.propStates.keys()] : b.do === "wear" ? [...this.present, ...this.vehicleOf.keys(), ...this.furnitureOf.keys()] : this.present;
    for (const w of all) {
      if (valid.includes(w)) continue;
      const known = b.do === "camera" || this.kit.cast[w] ? "" : " and not in the kit";
      this.issue("error", `line ${b.line} "${b.do}": "${w}" is not in block "${this.block.id}"${known}${closest(w, valid)}`);
    }
    const who = all.filter((w) => valid.includes(w));
    if (all.length && !who.length) return;
    const one = who[0];
    for (const key of ["prop"] as const)
      if (b[key] !== undefined && !this.propStates.has(b[key] as string))
        return this.issue("error", `line ${b.line} "${b.do}": unknown prop "${String(b[key])}"${closest(String(b[key]), [...this.propStates.keys()])}`);
    switch (b.do) {
      case "walk":
      case "run": {
        // Several going to the same place stand side by side around it (left → right order kept).
        const dest = new Map<string, number>();
        if (who.length > 1) {
          const centre = this.placeX(b.to as Place, at, who[0]);
          const order = [...who].sort((a, b) => this.xAt(a, at) - this.xAt(b, at));
          const right = centre >= order.reduce((s, w) => s + this.xAt(w, at), 0) / order.length;
          const xs = [0];
          for (let i = 1; i < order.length; i++) xs.push(xs[i - 1] + this.pairGap(order[i - 1], order[i], right, right));
          const mid = (xs[0] + xs[xs.length - 1]) / 2;
          order.forEach((w, i) => dest.set(w, centre - mid + xs[i]));
        }
        for (const w of who) {
          const x = dest.get(w) ?? this.placeX(b.to as Place, at, w);
          const speed = (this.member(w)?.speed?.[b.do as "walk" | "run"] ?? (b.do === "run" ? 380 : 170)) * this.scaleOf(w);
          this.walk(w, x, at, until ? until - at : Math.abs(x - this.xAt(w, at)) / speed, { clip: b.do });
        }
        break;
      }
      case "enter":
        break; // handled when the cast is placed
      case "exit": {
        for (const w of who) {
          const x = b.to === "left" ? -500 : (this.kit.width ?? 1920) + 500;
          const speed = (b.run ? 380 : 170) * this.scaleOf(w);
          this.walk(w, x, at, Math.abs(x - this.xAt(w, at)) / speed, { clip: b.run ? "run" : "walk" });
        }
        break;
      }
      case "face":
        for (const w of who) this.face(w, b.direction === "left" ? "left" : "right", at);
        break;
      case "look": {
        // An actor, a prop, a set mark (looked at at its height, or the horizon) or null.
        const tg = b.target as string | null | undefined;
        const mk = typeof tg === "string" && !this.actors.some((a) => a.id === tg) && !this.propStates.has(tg) && !tg.match(/^[a-z]+\d+$/) ? this.setDef.marks[tg] ?? (tg === "left" || tg === "right" ? this.mark(tg) : undefined) : undefined;
        const target = mk ? [mk.x, mk.y ?? this.setDef.ground.near - 180] : (tg ?? null);
        for (const w of who) this.push({ at: this.t(at), actor: w, action: "lookAt", target });
        break;
      }
      case "emotion":
        for (const w of who.filter((w) => this.hasControl(w, "emotion"))) this.push({ at: this.t(at), actor: w, action: "pose", control: "emotion", value: b.value, duration: 0.35 });
        break;
      case "mount":
        for (const w of who) this.mountOn(w, b.vehicle as string, at);
        break;
      case "dismount":
        for (const w of who) this.dismount(w, at);
        break;
      case "ride":
        for (const w of who) this.ride(w, b, at, until);
        break;
      case "fall":
        for (const w of who) this.fallDown(w, at, (b.side ?? b.dir) === "front" ? "front" : "back");
        break;
      case "sit":
        for (const w of who) this.sit(w, (b.on as string | undefined) ?? null, at, b.view as string | undefined);
        break;
      case "lie":
        for (const w of who) this.lie(w, (b.on as string | undefined) ?? null, at);
        break;
      case "sleep":
        for (const w of who) this.lie(w, (b.on as string | undefined) ?? null, at, true);
        break;
      case "getUp":
        for (const w of who) this.getUp(w, at);
        break;
      case "fly":
        for (const w of who) this.fly(w, b.to as Place | "offLeft" | "offRight" | "up", at, until);
        break;
      case "wear": {
        // { wear: { control: pose } } or the shorthand { control, value }.
        const items = (b.wear as Record<string, string> | undefined) ?? (b.control ? { [b.control as string]: b.value as string } : {});
        if (!Object.keys(items).length) this.issue("error", `line ${b.line}: "wear" needs \`wear: { control: pose }\``);
        for (const w of who) this.wear(w, items, at);
        break;
      }
      case "gesture":
        for (const w of who) this.play(w, b.clip as string, at - 0.1, until ? until - at + 0.1 : undefined);
        break;
      case "fx":
        if (one) this.push({ at: this.t(at - 0.05), action: "fx", type: b.type, actor: one, ...(b.type === "dust" ? { anchor: "origin" } : {}) });
        else this.push({ at: this.t(at - 0.05), action: "fx", type: b.type, x: this.placeX((b.at as Place) ?? "center", at), y: 380, scale: 1.4 });
        break;
      case "view":
        for (const w of who) this.view(w, b.value as string, at);
        break;
      case "hold":
        this.hold(who, at, (b.view as "profile" | "back") ?? "profile");
        break;
      case "release":
        for (const w of who) this.releaseHands(w, at);
        this.stepApart(who, at);
        break;
      case "cross":
        this.cross(who, b.to as string, at, until ?? at + 8);
        break;
      case "pick": {
        const prop = b.prop as string;
        const px = this.propX(prop, at);
        if (Math.abs(px - this.xAt(one, at)) > 60 * this.scaleOf(one)) {
          const side = px > this.xAt(one, at) ? -1 : 1;
          const dur = Math.abs(px + side * 50 - this.xAt(one, at)) / (170 * this.scaleOf(one));
          this.walk(one, px + side * 50, at - dur, dur);
        }
        this.grab(one, prop, at);
        break;
      }
      case "drop": {
        const prop = b.prop as string;
        const x = this.xAt(one, at) + 60 * this.scaleOf(one);
        this.release(prop, at);
        this.propKeys(prop, [[at, x, this.setDef.ground.near - this.propStates.get(prop)!.radius, 1]]);
        break;
      }
      case "throw":
        this.throwProp(one, b.prop as string, at, b.to as Place | undefined);
        break;
      case "roll":
        this.roll(b.prop as string, b.to as Place, at, until ?? at + 2.5);
        break;
      case "dribble":
        this.dribble(one, b.prop as string, at, until ?? at + 3);
        break;
      case "vehicle":
        this.vehicle(b, at);
        break;
      case "fixture": {
        const f = this.setDef.fixtures?.find((x) => x.id === b.id);
        if (!f) this.issue("error", `unknown fixture "${String(b.id)}"${closest(String(b.id), (this.setDef.fixtures ?? []).map((x) => x.id))}`);
        else this.set(f.id, f.channel ?? "parts.light.variant", b.value, at);
        break;
      }
      case "camera":
        this.camera({ type: b.type as string, who: b.who as string[] | string, mark: b.mark as string }, at);
        break;
      case "light": {
        const d = r3(until ? until - at : 2);
        const mood = b.mood ? MOODS[b.mood as string] : undefined;
        if (b.mood && !mood) this.issue("error", `unknown light mood "${String(b.mood)}"${closest(String(b.mood), Object.keys(MOODS))}`);
        if (mood) {
          this.timeOfDay(b.mood as string, at, d);
          if (!this.setDef.lighting) break;
          this.push({ at: this.t(at), action: "light", channel: "lighting.grade.color", value: mood.grade, duration: d });
          this.push({ at: this.t(at), action: "light", channel: "lighting.grade.opacity", value: mood.opacity, duration: d });
        } else this.push({ at: this.t(at), action: "light", channel: b.channel, value: b.value, duration: d });
        break;
      }
      default:
        this.issue("error", `line ${b.line}: unknown action "${b.do}"${closest(b.do, ACTIONS)}`);
    }
  }

  /**
   * Set fixtures that show the time of day (a clock, a sun/moon dial…: rig `meta.timeOfDay`) follow
   * a light mood: their channel (the fixture's `channel`, default `parts.light.variant`) takes the
   * value `meta.timeOfDay.values[mood]`, else the mood's name when the switch has that variant
   * ("day" also finds "noon"), halfway through the light change.
   */
  private timeOfDay(mood: string, at: number, dur: number) {
    for (const f of this.setDef.fixtures ?? []) {
      const doc = this.kit.characters[f.character] as unknown as { meta?: { timeOfDay?: boolean | { values?: Record<string, string> } }; parts?: { id: string; variants?: Record<string, unknown> }[] } | undefined;
      const tod = doc?.meta?.timeOfDay;
      if (!tod) continue;
      const channel = f.channel ?? "parts.light.variant";
      const variants = Object.keys(doc?.parts?.find((p) => p.id === channel.split(".")[1])?.variants ?? {});
      const value = (typeof tod === "object" ? tod.values?.[mood] : undefined) ?? (variants.includes(mood) ? mood : mood === "day" && variants.includes("noon") ? "noon" : undefined);
      if (value) this.set(f.id, channel, value, at + dur / 2);
      else this.issue("warning", `fixture "${f.id}" shows the time of day but has nothing for "${mood}" (meta.timeOfDay.values or a "${mood}" variant)`);
    }
  }

  private propKeys(prop: string, keys: [number, number, number, number, number?][], ease = "sineInOut") {
    const st = this.propStates.get(prop);
    if (!st) return this.issue("error", `unknown prop "${prop}"`);
    for (const [abs, x, y, s, rot] of keys) {
      st.x.push([this.t(abs), Math.round(x), ease]);
      st.y.push([this.t(abs), Math.round(y), ease]);
      st.scale.push([this.t(abs), r3(s), ease]);
      if (rot !== undefined) st.rotation.push([this.t(abs), Math.round(rot), ease]);
    }
  }

  /** Throw up and land in front of the thrower (or at a place). */
  private throwProp(who: string, prop: string, at: number, to?: Place) {
    this.play(who, "toss", at - 0.4);
    const st = this.propStates.get(prop)!;
    const dir = this.facing(who, at) ? 1 : -1;
    const x0 = this.xAt(who, at) + dir * 80 * this.scaleOf(who);
    const x1 = to ? this.placeX(to, at) : x0 + dir * 30;
    const g = this.setDef.ground.near - st.radius;
    this.release(prop, at);
    const top = this.setDef.ground.near - (this.member(who)?.rig.height ?? 250) * this.scaleOf(who) - 140;
    const yk: Key[] = [[this.t(at), Math.round(g - 120)], [this.t(at + 0.6), Math.round(top), "easeOut"], [this.t(at + 1.3), Math.round(g), "easeIn"]];
    st.x.push([this.t(at), Math.round(x0)], [this.t(at + 1.3), Math.round(x1), "linear"]);
    st.y.push(...yk);
    st.scale.push([this.t(at), 1]);
  }

  /** Roll (with a couple of small bounces) to a place; crossing to the far ground if it is there. */
  private roll(prop: string, to: Place, at: number, until: number) {
    const st = this.propStates.get(prop);
    if (!st) return this.issue("error", `unknown prop "${prop}"`);
    const x0 = this.propX(prop, at);
    const x1 = this.placeX(to, at);
    const near = this.setDef.ground.near - st.radius;
    const markY = typeof to === "string" ? this.setDef.marks[to]?.y : undefined;
    const far = markY !== undefined && this.setDef.ground.far !== undefined && Math.abs(markY - this.setDef.ground.far) < Math.abs(markY - this.setDef.ground.near);
    const ds = this.setDef.depthScale ?? 0.6;
    const T = Math.max(0.8, until - at);
    const keys: [number, number, number, number, number][] = [];
    const steps = 16;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const e = 1 - (1 - u) ** 2;
      const x = x0 + (x1 - x0) * e;
      const depth = far ? Math.min(1, Math.max(0, (u - 0.25) / 0.6)) : 0;
      const s = 1 + (ds - 1) * depth;
      const ground = far ? near + ((this.setDef.ground.far! - st.radius * ds) - near) * depth : near;
      const hop = Math.abs(Math.sin(u * Math.PI * 3)) * 60 * (1 - u) * s;
      keys.push([at + u * T, x, ground - hop, s, ((x - x0) / (st.radius * s)) * (180 / Math.PI)]);
    }
    this.release(prop, at);
    this.propKeys(prop, keys);
    if (far) this.props.find((p) => p.id === prop)!.z = 0.5;
  }

  /** Bouncing a prop in sync with the `dribble` clip: the palm meets it at the top of each bounce. */
  private dribble(who: string, prop: string, at: number, until: number) {
    const st = this.propStates.get(prop);
    if (!st) return this.issue("error", `unknown prop "${prop}"`);
    const period = (this.kit.characters[this.characterOf(who)]?.clips?.dribble as { duration?: number } | undefined)?.duration ?? 0.6;
    const top = this.handIn(who, "dribble", 0);
    const push = this.handIn(who, "dribble", period * 0.2);
    const s = this.scaleOf(who);
    const dir = this.facing(who, at) ? 1 : -1;
    const x = this.xAt(who, at);
    const contact = 10 * s + st.radius;
    const X = (lx: number) => Math.round(x + dir * lx * s);
    const Y = (ly: number) => Math.round(this.setDef.ground.near + ly * s + contact);
    this.release(prop, at);
    this.play(who, "dribble", at, until - at, { fadeIn: 0.05 });
    for (let t = at; t <= until + 1e-6; t += period) {
      st.x.push([this.t(t), X(top[0])], [this.t(t + period * 0.2), X(push[0])]);
      st.y.push([this.t(t), Y(top[1])], [this.t(t + period * 0.2), Y(push[1]), "linear"], [this.t(t + period * 0.45), Math.round(this.setDef.ground.near - st.radius), "easeIn"]);
    }
  }

  private facing(actor: string, abs: number): boolean {
    let right = this.facing0[actor] ?? true;
    for (const a of this.script.filter((a) => a.actor === actor && a.at <= this.t(abs)).sort((x, y) => x.at - y.at)) {
      if (a.action === "face") right = a.direction === "right";
      if (a.action === "walkTo") right = (a.x as number) >= this.xAt(actor, this.t0 + a.at - 0.01);
    }
    return right;
  }

  /** A vehicle drives by on a lane and leaves the frame (invisible before and after). */
  private vehicle(b: Beat, at: number) {
    const kind = (b.kind as string) ?? "car";
    const v = this.kit.vehicles?.[kind];
    if (!v) return this.issue("error", `unknown vehicle "${kind}"${closest(kind, Object.keys(this.kit.vehicles ?? {}))}`);
    const id = `${kind}${this.actors.filter((a) => a.character === v.character).length + 1}`;
    const centre = this.present.length ? this.present.reduce((a, p) => a + this.xAt(p, at), 0) / this.present.length : 960;
    const leftToRight = b.dir !== "left";
    const x0 = leftToRight ? centre - 1500 : centre + 1500;
    const x1 = leftToRight ? centre + 2100 : centre - 2100;
    const speed = v.speed ?? 950;
    const dur = Math.abs(x1 - x0) / speed;
    const start = at - 0.3;
    const laneY = b.lane === "far" && this.setDef.marks.farLane ? this.setDef.marks.farLane.y! : (this.setDef.marks.nearLane?.y ?? this.setDef.ground.near - 16);
    this.addActor(id, x0, { character: v.character, y: laneY, scale: v.scale * (b.lane === "far" ? (this.setDef.depthScale ?? 0.6) : 1), z: b.lane === "far" ? 0.3 : 1, flip: !leftToRight, palette: b.color ? { paint: b.color as string } : undefined });
    this.push({ at: this.t(start), actor: id, action: "walkTo", x: Math.round(x1), duration: r3(dur), clip: "drive", ease: "linear" });
    this.tracks[`actors.${id}.opacity`] = [[0, 0], [this.t(start) - 0.001 > 0 ? this.t(start) - 0.001 : 0, 0], [this.t(start), 1], [this.t(start + dur), 1], [this.t(start + dur) + 0.001, 0]];
  }

  // -------------------------------------------------- hand in hand
  hold(who: string[], at: number, view: "profile" | "back" = "profile") {
    // Anyone already hand in hand with one of them joins: the whole chain steps together.
    const group = new Set(who);
    for (let grew = true; grew; ) {
      grew = false;
      for (const p of this.handPairs)
        if (p.t1 > at && group.has(p.a) !== group.has(p.b)) {
          group.add(p.a).add(p.b);
          grew = true;
        }
    }
    const order = [...group].sort((a, b) => this.xAt(a, at) - this.xAt(b, at));
    this.gather(order, at, view);
    for (const id of order) this.face(id, "right", at);
    for (let i = 1; i < order.length; i++) this.holdPair(order[i - 1], order[i], at, view);
  }
  /** Shoulder of an arm in setup space (the back view moves the shoulders to the sides). */
  private shoulder(id: string, arm: "F" | "B", view: "profile" | "back"): [number, number] {
    const rig = this.member(id)!.rig;
    const s = rig.shoulder[arm];
    return view === "back" ? [s[0] + rig.backShoulder[arm][0], s[1] + rig.backShoulder[arm][1]] : s;
  }
  /**
   * Distance between two neighbours holding hands (a left of b, scene px): heads (and, from behind,
   * bodies) side by side without covering each other, unless the arms are too short for that.
   */
  holdGap(a: string, b: string, view: "profile" | "back"): number {
    const sa = this.scaleOf(a), sb = this.scaleOf(b);
    const A = this.member(a)!.rig, B = this.member(b)!.rig;
    // From behind the head is centred: half its width on each side.
    const apart = view === "back"
      ? (((A.extent.front + A.extent.back) / 2) * sa + ((B.extent.front + B.extent.back) / 2) * sb) * 0.8
      : (A.extent.front * sa + B.extent.back * sb) * 0.85;
    const shoulders = this.shoulder(a, "F", view)[0] * sa - this.shoulder(b, "B", view)[0] * sb;
    const reach = shoulders + (A.armLength.F * sa + B.armLength.B * sb) * 0.94 * 1.3;
    return Math.max(60, Math.min(apart, reach));
  }
  /** Neighbours step together (around their centre) to holding distance, ending at `at`. */
  private gather(order: string[], at: number, view: "profile" | "back") {
    const xs = [0];
    for (let i = 1; i < order.length; i++) xs.push(xs[i - 1] + this.holdGap(order[i - 1], order[i], view));
    const centre = order.reduce((s, id) => s + this.xAt(id, at - 0.6), 0) / order.length;
    const mid = xs.reduce((s, x) => s + x, 0) / xs.length;
    order.forEach((id, i) => {
      const x = centre - mid + xs[i];
      if (Math.abs(this.xAt(id, at - 0.6) - x) > 6) this.walk(id, x, at - 0.6, 0.6);
    });
  }
  /** Hand in hand, computed in scene space so each character uses its own scale. */
  private holdPair(a: string, b: string, at: number, view: "profile" | "back") {
    const ik = (id: string, chain: string) => ((this.kit.characters[this.characterOf(id)]?.ik ?? []) as { id: string }[]).some((k) => k.id === chain);
    if (!ik(a, "handF") || !ik(b, "handB")) return this.issue("warning", `${a} and ${b} cannot hold hands (IK chains handF / handB missing)`);
    const A = this.member(a)!.rig, B = this.member(b)!.rig;
    const sa = this.scaleOf(a), sb = this.scaleOf(b);
    const pa = this.xAt(a, at), pb = this.xAt(b, at);
    const shA = this.shoulder(a, "F", view), shB = this.shoulder(b, "B", view);
    // Shoulders in scene space (y relative to the ground line).
    const SA: [number, number] = [pa + shA[0] * sa, shA[1] * sa];
    const SB: [number, number] = [pb + shB[0] * sb, shB[1] * sb];
    // The hands meet between the shoulders (split by arm length), as low as the arms allow unstretched.
    const LA = A.armLength.F * sa * 0.94, LB = B.armLength.B * sb * 0.94;
    const mx = SA[0] + (SB[0] - SA[0]) * (LA / (LA + LB));
    const top = Math.max(SA[1], SB[1]);
    const drop = (L: number, dx: number, dy: number) => Math.sqrt(Math.max(0, L * L - dx * dx)) - dy;
    const low = Math.max(18 * Math.min(sa, sb), Math.min((view === "back" ? 62 : 42) * Math.min(sa, sb), drop(LA, mx - SA[0], top - SA[1]), drop(LB, SB[0] - mx, top - SB[1])));
    const M: [number, number] = [mx, top + low];
    const arms = [
      { actor: a, chain: "handF", bones: ["armF1", "armF2"], target: [(M[0] - pa) / sa, M[1] / sa] as [number, number], rest: A.hand.F, shoulder: shA, len: A.armLength.F },
      { actor: b, chain: "handB", bones: ["armB1", "armB2"], target: [(M[0] - pb) / sb, M[1] / sb] as [number, number], rest: B.hand.B, shoulder: shB, len: B.armLength.B },
    ];
    for (const arm of arms) {
      const need = Math.hypot(arm.target[0] - arm.shoulder[0], arm.target[1] - arm.shoulder[1]);
      const stretch = r3(Math.max(0, need / (arm.len * 0.94) - 1));
      if (stretch > 0.6) this.issue("error", `${a} and ${b} are too far apart to hold hands (${arm.actor}'s arm would stretch ${Math.round(stretch * 100)}%): hold them before they move apart`);
      this.set(arm.actor, `ik.${arm.chain}.x`, r3(arm.target[0] - arm.rest[0]), at);
      this.set(arm.actor, `ik.${arm.chain}.y`, r3(arm.target[1] - arm.rest[1]), at);
      this.set(arm.actor, `ik.${arm.chain}.mix`, 1, at, 0.45, "sineInOut");
      for (const bone of arm.bones) this.set(arm.actor, `bones.${bone}.squash`, Math.min(0.6, stretch), at, 0.45, "sineInOut");
      const already = this.holds.some((h) => h.actor === arm.actor && h.t1 === Infinity);
      this.holds.push({ actor: arm.actor, t0: at, t1: Infinity });
      if (!already) this.play(arm.actor, "hold", at, 60, { fadeIn: 0.4 });
    }
    for (const p of this.handPairs) if (p.a === a && p.b === b && p.t1 === Infinity) p.t1 = at;
    this.handPairs.push({ a, b, t1: Infinity });
    // Whoever holds something in the near hand passes it to the other hand (a "heldHand" switch: near | far).
    const ca = this.kit.characters[this.characterOf(a)];
    if ((ca?.parts as { id: string }[] | undefined)?.some((p) => p.id === "heldHand")) this.set(a, "parts.heldHand.variant", "far", at);
  }
  releaseHands(actor: string, at: number) {
    for (const h of this.holds) if (h.actor === actor && h.t1 === Infinity) h.t1 = at;
    for (const p of this.handPairs) if ((p.a === actor || p.b === actor) && p.t1 === Infinity) p.t1 = at;
    for (const c of ["handF", "handB"]) this.set(actor, `ik.${c}.mix`, 0, at, 0.4, "sineInOut");
    for (const bone of ["armF1", "armF2", "armB1", "armB2"]) this.set(actor, `bones.${bone}.squash`, 0, at, 0.4);
    if ((this.kit.characters[this.characterOf(actor)]?.parts as { id: string }[] | undefined)?.some((p) => p.id === "heldHand")) this.set(actor, "parts.heldHand.variant", "near", at);
  }

  /** After letting go, neighbours who stood hand in hand step back to their usual spacing. */
  private stepApart(who: string[], at: number) {
    const t = at + 0.25;
    const order = [...who].sort((a, b) => this.xAt(a, t) - this.xAt(b, t));
    const xs = [0];
    for (let i = 1; i < order.length; i++) xs.push(xs[i - 1] + Math.max(this.xAt(order[i], t) - this.xAt(order[i - 1], t), this.pairGap(order[i - 1], order[i], this.facing(order[i - 1], t), this.facing(order[i], t))));
    const centre = order.reduce((s, id) => s + this.xAt(id, t), 0) / order.length;
    const mid = xs.reduce((s, x) => s + x, 0) / xs.length;
    order.forEach((id, i) => {
      const x = centre - mid + xs[i];
      const busy = this.walks.some((w) => w.actor === id && w.t1 > t && w.t0 < t + 0.7);
      if (!busy && Math.abs(this.xAt(id, t) - x) > 6) this.walk(id, x, t, 0.7);
    });
  }

  // -------------------------------------------------- riding (bicycles, scooters…)
  /** Vehicles standing in the block, sized for their first rider. */
  placeVehicles() {
    for (const v of this.block.vehicles ?? []) {
      const def = this.kit.vehicles?.[v.kind];
      if (!def) {
        this.issue("error", `vehicle "${v.id}": unknown kind "${v.kind}"${closest(v.kind, Object.keys(this.kit.vehicles ?? {}))}`);
        continue;
      }
      const first = (this.block.beats ?? []).find((b) => (b.do === "mount" || b.do === "ride") && b.vehicle === v.id)?.who;
      const rider = (Array.isArray(first) ? first[0] : first) as string | undefined;
      const scale = r3(def.scale * (rider && this.kit.cast[rider] ? this.scaleOf(rider) : 1));
      const x = v.at ? this.placeX(v.at, this.t0) : rider && this.present.includes(rider) ? this.xAt(rider, this.t0) + 150 * this.scaleOf(rider) : this.mark("center").x;
      this.addActor(v.id, x, { character: def.character, scale, z: 1.9, flip: v.facing === "left", palette: v.color ? { paint: v.color } : undefined });
      this.vehicleOf.set(v.id, { kind: v.kind, scale });
      // Upright from the start (a track holds its first key before it: a later "lying" would show).
      const up = this.lyingPose(v.id);
      if (up) this.push({ at: 0, actor: v.id, action: "pose", control: "view", value: up, duration: 0 });
      if (v.wear) this.wear(v.id, v.wear, this.t0);
    }
  }
  /** A vehicle drawn lying on its side: pose "lying" of its `view` control; returns its upright pose. */
  private lyingPose(vehicle: string): string | undefined {
    const poses = Object.keys(((this.kit.characters[this.characterOf(vehicle)]?.controls ?? {}) as Record<string, { type: string; poses?: object }>).view?.poses ?? {});
    return poses.includes("lying") ? (poses.find((p) => p !== "lying") ?? "side") : undefined;
  }
  /** Keeps a character's ground shadow on the floor while its body goes down (sitting) or hides it (lying). */
  private shadow(actor: string, abs: number, o: { drop?: number; hide?: boolean }, dur: number) {
    const doc = this.kit.characters[this.characterOf(actor)];
    const s = this.scaleOf(actor);
    if (o.drop !== undefined && (doc?.skeleton as { id: string }[] | undefined)?.some((b) => b.id === "ground")) this.set(actor, "bones.ground.y", r3(-o.drop / s), abs, dur, "easeOut");
    if (o.hide !== undefined && (doc?.parts as { id: string }[] | undefined)?.some((p) => p.id === "shadow")) this.set(actor, "parts.shadow.opacity", o.hide ? 0 : 1, abs, dur * 0.6);
  }
  private ridingAt(rider: string, abs: number) {
    return this.rides.find((r) => r.rider === rider && r.t0 <= abs && r.t1 > abs);
  }
  private restAt(actor: string, abs: number) {
    return this.rests.find((l) => l.actor === actor && l.t0 <= abs && l.t1 > abs);
  }
  /** IK chains of the rider held on the vehicle: feet on the pedals, hands on the handlebar. */
  private static readonly GRIPS: [string, string[]][] = [
    ["footF", ["pedalF"]],
    ["footB", ["pedalB"]],
    ["handF", ["gripF", "handlebar"]],
    ["handB", ["gripB", "handlebar"]],
  ];
  private grips(rider: string, vehicle: string) {
    const anchors = (this.kit.characters[this.characterOf(vehicle)]?.anchors ?? {}) as Record<string, { at: [number, number] }>;
    const chains = new Set(((this.kit.characters[this.characterOf(rider)]?.ik ?? []) as { id: string }[]).map((k) => k.id));
    return BlockScene.GRIPS.flatMap(([chain, names]) => {
      const anchor = names.find((n) => anchors[n]);
      return anchor && chains.has(chain) ? [{ chain, anchor }] : [];
    });
  }
  /** Gets on a vehicle: walks to it, sits on its `seat`, feet on the pedals, hands on the handlebar. */
  mountOn(rider: string, vehicle: string | undefined, at: number) {
    if (!vehicle || !this.vehicleOf.has(vehicle)) return this.issue("error", `${rider} cannot mount "${vehicle ?? ""}": not a vehicle of block "${this.block.id}"${closest(vehicle ?? "", [...this.vehicleOf.keys()])} (declare it in the block's "vehicles")`);
    const doc = this.kit.characters[this.characterOf(vehicle)];
    const anchors = (doc?.anchors ?? {}) as Record<string, { at: [number, number] }>;
    if (!anchors.seat) return this.issue("error", `"${vehicle}" cannot be ridden: its rig has no "seat" anchor`);
    if (this.ridingAt(rider, at)) return;
    const other = this.rides.find((r) => r.vehicle === vehicle && r.t0 <= at && r.t1 > at);
    if (other) return this.issue("error", `${rider} cannot mount "${vehicle}": ${other.rider} is riding it`);
    if (this.restAt(rider, at - 1.6)) this.getUp(rider, at - 1.6);
    const s = this.vehicleOf.get(vehicle)!.scale;
    // A fallen vehicle is lifted back up first.
    if (this.fallen.has(vehicle)) {
      const up = this.lyingPose(vehicle);
      if (up) this.push({ at: this.t(at - 0.5), actor: vehicle, action: "pose", control: "view", value: up, duration: 0 });
      this.set(vehicle, "rotation", 0, at - 0.5, 0.4, "easeOut");
      this.set(vehicle, "scale", s, at - 0.5, 0.4, "easeOut");
      this.fallen.delete(vehicle);
    }
    const bx = this.xAt(vehicle, at);
    if (Math.abs(this.xAt(rider, at - 0.8) - bx) > 30) this.walk(rider, bx, at - 0.8, 0.7);
    this.face(rider, this.facing(vehicle, at) ? "right" : "left", at);
    const rig = this.member(rider)?.rig;
    const hip = rig?.hip ?? [0, -Math.round((rig?.height ?? 200) * 0.4)];
    // The far leg goes behind the vehicle (its frame passes between the legs).
    const far = new Set(["legB1", "legB2", "footB"]);
    const parts = ((this.kit.characters[this.characterOf(rider)]?.parts ?? []) as { id: string; bone?: string; bones?: string[] }[]).filter((p) => (p.bone && far.has(p.bone)) || p.bones?.some((b) => far.has(b))).map((p) => p.id);
    this.push({ at: this.t(at), actor: rider, action: "mount", on: vehicle, anchor: "seat", point: hip, duration: 0.4, ...(parts.length ? { behind: parts } : {}) });
    for (const g of this.grips(rider, vehicle)) this.push({ at: this.t(at), actor: rider, action: "reach", chain: g.chain, target: { actor: vehicle, anchor: g.anchor }, duration: 0.4 });
    if (!this.grips(rider, vehicle).some((g) => g.chain.startsWith("foot"))) this.issue("warning", `${rider} rides "${vehicle}" without feet on pedals (anchors pedalF / pedalB or IK chains footF / footB missing)`);
    this.rides.push({ rider, vehicle, t0: at, t1: Infinity });
    // Can the legs reach the pedals? (setup positions: seat → farthest pedal, scaled)
    const legs = rig?.legLength ? Math.min(rig.legLength.F, rig.legLength.B) * this.scaleOf(rider) : undefined;
    const pedals = ["pedalF", "pedalB"].filter((p) => anchors[p]).map((p) => Math.hypot(anchors[p].at[0] - anchors.seat.at[0], anchors[p].at[1] - anchors.seat.at[1]) * s);
    if (legs && pedals.length && Math.max(...pedals) > legs * 1.02)
      this.issue("error", `${rider}'s legs (${Math.round(legs)} px) do not reach the pedals of "${vehicle}" (${Math.round(Math.max(...pedals))} px from the seat): make kit.vehicles.${this.vehicleOf.get(vehicle)!.kind}.scale smaller`);
  }
  /** Gets off and stands next to the vehicle, facing the same way. */
  dismount(rider: string, at: number) {
    const r = this.ridingAt(rider, at);
    if (!r) return this.issue("error", `${rider} cannot dismount: not riding anything then`);
    r.t1 = at;
    this.letGo(rider, r.vehicle, at, 0.4);
    const dir = this.facing(r.vehicle, at) ? 1 : -1;
    this.slide(rider, this.xAt(r.vehicle, at) - dir * 70 * this.scaleOf(rider), at, 0.45);
  }
  private letGo(rider: string, vehicle: string, at: number, dur: number) {
    this.push({ at: this.t(at), actor: rider, action: "mount", on: null, duration: dur });
    for (const g of this.grips(rider, vehicle)) this.push({ at: this.t(at), actor: rider, action: "reach", chain: g.chain, target: null, duration: Math.min(dur, 0.3) });
  }
  /** Rides to a place (mounting first if needed); `wobble` 0..1 rocks the vehicle like a beginner. */
  ride(rider: string, b: Beat, at: number, until?: number) {
    let start = at;
    if (!this.ridingAt(rider, at)) {
      // Without "vehicle": the one they rode last.
      const last = [...this.rides].reverse().find((r) => r.rider === rider)?.vehicle;
      this.mountOn(rider, (b.vehicle as string | undefined) ?? last, at);
      start = at + 0.45;
    }
    const r = this.ridingAt(rider, start);
    if (!r) return;
    const vehicle = r.vehicle;
    const v = this.vehicleOf.get(vehicle)!;
    if (!this.hasClip(vehicle, "drive")) return this.issue("error", `"${vehicle}" cannot ride: its rig has no "drive" clip`);
    if (b.to === undefined) return this.issue("error", `line ${b.line} "ride": needs "to"`);
    const x0 = this.xAt(vehicle, start);
    const x1 = this.placeX(b.to as Place, start, rider);
    const speed = (this.kit.vehicles?.[v.kind]?.speed ?? 240) * v.scale;
    const dur = Math.max(0.6, until !== undefined ? until - start : Math.abs(x1 - x0) / speed);
    this.walk(vehicle, x1, start, dur, { clip: "drive" });
    // The rider's own position goes along (it is where they stand when they get off).
    const own = ["ride", "hold", "idle"].find((c) => this.hasClip(rider, c));
    if (own) this.walk(rider, x1 + (this.xAt(rider, start) - x0), start, dur, { clip: own });
    const wobble = Math.min(1, Math.max(0, Number(b.wobble ?? 0)));
    if (wobble > 0) {
      // Irregular rocking (a beginner fighting for balance), back to level at the end.
      const amp = 7 * wobble;
      const rnd = (i: number) => Math.abs(Math.sin(i * 12.9898 + x0 * 0.001) * 43758.5453) % 1;
      let t = start + 0.15;
      for (let i = 0; t < start + dur - 0.35; i++) {
        const step = 0.3 + 0.25 * rnd(i);
        this.set(vehicle, "rotation", r3((i % 2 ? 1 : -1) * amp * (0.5 + 0.5 * rnd(i + 7))), t, step, "sineInOut");
        t += step;
      }
      this.set(vehicle, "rotation", 0, t, 0.3, "sineInOut");
    }
  }
  /** Falls off: the vehicle tips and drops on its side, the rider is thrown forward (or back) and lands lying. */
  fall(rider: string, at: number, side: "front" | "back") {
    const r = this.ridingAt(rider, at);
    if (!r) return this.issue("error", `${rider} cannot fall off: not riding anything then`);
    const vehicle = r.vehicle;
    if (this.walks.some((w) => w.actor === vehicle && w.t0 < at && w.t1 > at + 0.05))
      this.issue("warning", `${rider} falls while "${vehicle}" is still moving: end the ride ("until") at the fall`);
    r.t1 = at + 0.2;
    const dir = this.facing(vehicle, at) ? 1 : -1;
    const s = this.vehicleOf.get(vehicle)!.scale;
    // The front wheel digs in, then the vehicle drops on its side: its own "lying" drawing (pose
    // "lying" of its `view` control), else flattened as a fallback.
    this.set(vehicle, "rotation", dir * 10, at, 0.22, "easeIn");
    if (this.lyingPose(vehicle)) {
      this.set(vehicle, "rotation", 0, at + 0.22, 0.12, "easeOut");
      this.push({ at: this.t(at + 0.22), actor: vehicle, action: "pose", control: "view", value: "lying", duration: 0 });
    } else {
      this.set(vehicle, "scale", [s, r3(s * 0.6)], at + 0.22, 0.3, "easeIn");
      this.set(vehicle, "rotation", dir * 3, at + 0.22, 0.3, "easeIn");
    }
    this.fallen.add(vehicle);
    this.letGo(rider, vehicle, at + 0.2, 0.45);
    // Thrown clear of the vehicle: over the front, or off the back.
    this.knockDown(rider, at + 0.2, side, dir, 0.45, (side === "front" ? 0.35 : -0.3) * (this.member(rider)?.rig.height ?? 200) * this.scaleOf(rider));
  }
  /**
   * Down on the ground after a fall, rotated about the feet: on the back (default, "back") or face
   * down ("front"), lifted by the body's depth on that side so nothing sinks into the ground.
   */
  private knockDown(actor: string, at: number, side: "front" | "back", dir: number, dur: number, shift?: number) {
    const rig = this.member(actor)?.rig;
    const s = this.scaleOf(actor);
    const height = (rig?.height ?? 200) * s;
    const front = side === "front";
    const g = this.lying(actor, dir, side);
    const y = this.groundY(actor, at);
    this.slide(actor, this.xAt(actor, at) + dir * (shift ?? (front ? 0.12 : -0.06) * height), at, dur);
    this.set(actor, "rotation", g.rotation, at, dur, "easeIn");
    this.set(actor, "y", Math.round(y - g.offset[1]), at, dur, "easeIn");
    this.bendNeck(actor, g.neck, at, dur);
    this.rests.push({ actor, kind: "fallen", on: null, t0: at, t1: Infinity, y });
    this.shadow(actor, at, { hide: true }, dur);
    if (this.hasControl(actor, "emotion")) this.push({ at: this.t(at - 0.2), actor, action: "pose", control: "emotion", value: "scared", duration: 0.2 });
    this.push({ at: this.t(at + dur + 0.05), action: "fx", type: "stars", actor });
  }
  // -------------------------------------------------- flying
  /** Characters that fly: `meta.canFly` on the rig, or a `fly` clip. Wings beat with `fly`, else `flap`. */
  canFly(actor: string) {
    const doc = this.kit.characters[this.characterOf(actor)] as unknown as { meta?: { canFly?: boolean }; clips?: Record<string, unknown> } | undefined;
    return !!doc?.meta?.canFly || !!doc?.clips?.fly;
  }
  private groundOf(actor: string) {
    return !!(this.kit.characters[this.characterOf(actor)]?.skeleton as { id: string }[] | undefined)?.some((b) => b.id === "ground");
  }
  private wings(actor: string) {
    return this.hasClip(actor, "fly") ? "fly" : this.hasClip(actor, "flap") ? "flap" : undefined;
  }
  /**
   * One smooth flight along a cubic Bézier path (scene points), sampled finely so speed and height
   * change continuously (no stop in mid-air): `ease` spreads the progress (slow start and landing).
   * The body pitches with the direction of travel, the wings beat, and the ground shadow stays on
   * the floor, smaller and fainter the higher they are.
   */
  private flight(actor: string, path: [number, number][], at: number, dur: number, ease: (u: number) => number, lands: boolean) {
    const s = this.scaleOf(actor);
    const floor = this.groundY(actor, at);
    const doc = this.kit.characters[this.characterOf(actor)] as unknown as { skeleton?: { id: string }[]; parts?: { id: string }[] };
    const ground = doc.skeleton?.some((b) => b.id === "ground"), shadow = doc.parts?.some((p) => p.id === "shadow");
    const [p0, c1, c2, p3] = path;
    const bez = (u: number): [number, number] => {
      const a = (1 - u) ** 3, b = 3 * (1 - u) ** 2 * u, c = 3 * (1 - u) * u * u, d = u ** 3;
      return [a * p0[0] + b * c1[0] + c * c2[0] + d * p3[0], a * p0[1] + b * c1[1] + c * c2[1] + d * p3[1]];
    };
    const dirX = p3[0] >= p0[0] ? 1 : -1;
    this.face(actor, dirX > 0 ? "right" : "left", at);
    this.walks.push({ actor, t0: at, t1: at + dur, x0: p0[0], x1: p3[0] });
    const n = Math.max(6, Math.ceil(dur * 12));
    let prev = bez(0);
    for (let k = 1; k <= n; k++) {
      const t = at + ((k - 1) / n) * dur, d = dur / n;
      const p = bez(ease(k / n));
      const alt = Math.max(0, floor - p[1]);
      this.set(actor, "x", Math.round(p[0]), t, d, "linear");
      this.set(actor, "y", Math.round(p[1]), t, d, "linear");
      // Nose up when climbing, down when descending (gently), level at the end of a landing.
      const pitch = lands && k === n ? 0 : Math.max(-14, Math.min(14, (Math.atan2(p[1] - prev[1], Math.abs(p[0] - prev[0]) + 1e-3) * 180) / Math.PI * 0.35));
      this.set(actor, "rotation", r3(pitch * dirX), t, d, "linear");
      if (ground) this.set(actor, "bones.ground.y", r3(alt / s), t, d, "linear");
      if (shadow) this.set(actor, "parts.shadow.opacity", r3(Math.max(0.15, 1 - alt / 600)), t, d, "linear");
      prev = p;
    }
    const clip = this.wings(actor);
    if (clip) this.push({ at: this.t(at), actor, action: "play", clip, loop: true, duration: r3(dur), fadeIn: 0.15, fadeOut: 0.25 });
  }
  /** A little squash on touching down. */
  private touchDown(actor: string, at: number) {
    const s = this.scaleOf(actor);
    this.set(actor, "scale", [r3(s * 1.1), r3(s * 0.88)], at, 0.08, "easeOut");
    this.set(actor, "scale", s, at + 0.08, 0.22, "backOut");
  }
  /** Comes in through the air (from a side, high, or from the top), glides down and lands at x. */
  private flyIn(actor: string, x: number, at: number, from: "left" | "right" | "top") {
    if (!this.canFly(actor)) this.issue("error", `${actor} cannot fly (no "fly" clip nor meta.canFly on the rig)`);
    const s = this.scaleOf(actor);
    const floor = this.groundY(actor, at);
    // From above the frame (and off the side it comes from).
    const y0 = Math.min(floor - 700, -250);
    const x0 = this.xAt(actor, at);
    const dir = x >= x0 ? 1 : -1;
    const dur = Math.max(2.6, (Math.hypot(x - x0, floor - y0) * 1.3) / ((this.member(actor)?.speed?.fly ?? 360) * s));
    this.set(actor, "y", Math.round(y0), this.t0, 0);
    if (this.groundOf(actor)) this.set(actor, "bones.ground.y", r3((floor - y0) / s), this.t0, 0);
    // Placed up there first; the flight starts a moment later (keys at the same instant would merge).
    const t = Math.max(at, this.t0 + 0.05);
    // A swoop: down steeply at first, then gliding in nearly level to touch down.
    const path: [number, number][] = [[x0, y0], [x0 + (x - x0) * 0.35, y0 + (floor - y0) * 0.65], [x - dir * 220 * s, floor - 90 * s], [x, floor]];
    this.flight(actor, path, t, dur, (u) => Math.sin((u * Math.PI) / 2), true);
    this.touchDown(actor, t + dur);
  }
  /** Flies to a place (crouches, takes off, glides, lands) or away out of the frame ("offLeft", "offRight", "up"). */
  fly(actor: string, to: Place | "offLeft" | "offRight" | "up", at: number, until?: number) {
    if (!this.canFly(actor)) return this.issue("error", `${actor} cannot fly (no "fly" clip nor meta.canFly on the rig)`);
    if (this.restAt(actor, at)) this.getUp(actor, at - 0.6);
    const s = this.scaleOf(actor);
    const floor = this.groundY(actor, at);
    const x0 = this.xAt(actor, at);
    const speed = (this.member(actor)?.speed?.fly ?? 360) * s;
    // Crouch before the jump into the air.
    this.set(actor, "scale", [r3(s * 1.08), r3(s * 0.9)], at - 0.18, 0.15, "easeOut");
    this.set(actor, "scale", s, at, 0.2, "easeOut");
    if (to === "offLeft" || to === "offRight" || to === "up") {
      const x1 = to === "offLeft" ? -500 : to === "offRight" ? (this.kit.width ?? 1920) + 500 : x0 + (this.facing(actor, at) ? 300 : -300);
      const y1 = Math.min(floor - 900, -300);
      const dur = until !== undefined ? until - at : Math.max(1.6, Math.hypot(x1 - x0, floor - y1) / speed);
      // Up and away, speeding up.
      this.flight(actor, [[x0, floor], [x0 + (x1 - x0) * 0.15, floor - 220 * s], [x0 + (x1 - x0) * 0.6, y1 + 200], [x1, y1]], at, dur, (u) => u * u * (2 - u) * 0.5 + u * u * 0.5, false);
      return;
    }
    const x1 = this.placeX(to, at, actor);
    const dur = until !== undefined ? until - at : Math.max(1.3, Math.abs(x1 - x0) / speed + 0.7);
    const top = Math.min(280, 100 + Math.abs(x1 - x0) * 0.3) * s;
    // A hop through the air: up steeply, a long arc, a soft landing.
    this.flight(actor, [[x0, floor], [x0 + (x1 - x0) * 0.2, floor - top * 1.35], [x1 - (x1 - x0) * 0.2, floor - top * 1.35], [x1, floor]], at, dur, (u) => (1 - Math.cos(u * Math.PI)) / 2, true);
    this.touchDown(actor, at + dur);
  }


  // -------------------------------------------------- sitting and lying (furniture, set seats, the ground)
  /** Furniture standing in the block. */
  placeFurniture() {
    // The set's own furniture (always there) and the block's.
    for (const f of [...(this.setDef.furniture ?? []), ...(this.block.furniture ?? [])]) {
      const def = this.kit.furniture?.[f.kind];
      if (!def) {
        this.issue("error", `furniture "${f.id}": unknown kind "${f.kind}"${closest(f.kind, Object.keys(this.kit.furniture ?? {}))}`);
        continue;
      }
      // Standing on its mark's floor line (e.g. a sofa against the back wall), else the near ground.
      const y = (typeof f.at === "string" ? this.setDef.marks[f.at]?.y : undefined) ?? this.setDef.ground.near;
      this.addActor(f.id, this.placeX(f.at ?? "center", this.t0), { character: def.character, scale: def.scale, y, z: 1.9, flip: f.facing === "left", palette: f.color ? { paint: f.color } : undefined });
      // A blanket (`meta.cover`: its own rig, drawn over whoever lies there), hidden until then.
      const cover = (this.kit.characters[def.character]?.meta as { cover?: { character: string } } | undefined)?.cover;
      let coverId: string | undefined;
      if (cover) {
        if (!this.kit.characters[cover.character]) this.issue("error", `furniture "${f.id}": its cover rig "${cover.character}" is not in the kit`);
        else {
          coverId = `${f.id}Cover`;
          this.addActor(coverId, this.placeX(f.at ?? "center", this.t0), { character: cover.character, scale: def.scale, y, z: 2.01, flip: f.facing === "left", palette: f.color ? { paint: f.color } : undefined });
          this.set(coverId, "opacity", 0, this.t0);
        }
      }
      this.furnitureOf.set(f.id, { kind: f.kind, scale: def.scale, y, ...(coverId ? { cover: coverId } : {}) });
      if (f.wear) this.wear(f.id, f.wear, this.t0);
    }
  }
  private groundY(actor: string, abs: number) {
    const far = this.crossed.has(actor) && abs >= this.crossed.get(actor)!;
    return far ? (this.setDef.ground.far ?? this.setDef.ground.near) : this.setDef.ground.near;
  }
  /** Scene point of a furniture anchor in its setup pose (furniture stands still). */
  private furniturePoint(id: string, anchor: string): [number, number] | undefined {
    const at = ((this.kit.characters[this.characterOf(id)]?.anchors ?? {}) as Record<string, { at: [number, number] }>)[anchor]?.at;
    if (!at) return undefined;
    const s = this.furnitureOf.get(id)!.scale;
    const dir = this.facing(id, this.t0) ? 1 : -1;
    return [this.xAt(id, this.t0) + at[0] * s * dir, this.furnitureOf.get(id)!.y + at[1] * s];
  }
  private hasChain(actor: string, chain: string) {
    return ((this.kit.characters[this.characterOf(actor)]?.ik ?? []) as { id: string }[]).some((k) => k.id === chain);
  }
  /** Both feet planted on the floor at x (scene), the near foot a little ahead. */
  private feetDown(actor: string, x: number, dir: number, y: number, at: number, dur: number) {
    const s = this.scaleOf(actor);
    if (this.hasChain(actor, "footF")) this.push({ at: this.t(at), actor, action: "reach", chain: "footF", target: [Math.round(x + dir * 4 * s), Math.round(y)], duration: dur });
    if (this.hasChain(actor, "footB")) this.push({ at: this.t(at), actor, action: "reach", chain: "footB", target: [Math.round(x - dir * 8 * s), Math.round(y)], duration: dur });
  }
  /**
   * Half thickness of the torso on one side (setup px): what rests on the bed or the ground when
   * lying. `RigInfo.depth`, else a guess capped so tails, backpacks or snouts never lift the body.
   */
  private depthOf(actor: string, side: "back" | "front") {
    const rig = this.member(actor)?.rig;
    return rig?.depth?.[side] ?? Math.min(rig?.extent[side] ?? 34, 34) * 0.7;
  }
  /**
   * Lying flat: the spine (hip joint → head) horizontal, whatever the posture (a hunched old turtle's
   * head sits far in front of its hips), face up (head towards the back) or face down. Returns the
   * rotation, the setup point that rests on the surface (back or belly at the hips, `depth` out from
   * the spine), the outward normal of the back, and where that point lands relative to the feet
   * (scene px, after rotation and scale).
   */
  private lying(actor: string, dir: number, side: "back" | "front") {
    const s = this.scaleOf(actor);
    const hip = this.hipOf(actor);
    const doc = this.kit.characters[this.characterOf(actor)] as unknown as { skeleton: { id: string; from?: [number, number] }[]; anchors?: Record<string, { at: [number, number] }> };
    let head: [number, number] = doc.anchors?.head?.at ?? [0, -(this.member(actor)?.rig.height ?? 200) * 0.85];
    const lean = (h: [number, number]) => (Math.atan2(h[0] - hip[0], -(h[1] - hip[1])) * 180) / Math.PI;
    // The neck bends back so the head lines up with the spine (a hunched turtle's head sits far in
    // front of its hips): the legs stay flat and the head reaches the pillow.
    const neckBone = doc.skeleton.find((b) => b.id === "neck" && b.from) ?? doc.skeleton.find((b) => b.id === "head" && b.from);
    let neck: { bone: string; rotation: number } | undefined;
    if (neckBone?.from) {
      const rot = Math.max(-60, Math.min(60, -lean(head)));
      const a = (rot * Math.PI) / 180, [cx, cy] = neckBone.from;
      head = [cx + (head[0] - cx) * Math.cos(a) - (head[1] - cy) * Math.sin(a), cy + (head[0] - cx) * Math.sin(a) + (head[1] - cy) * Math.cos(a)];
      if (Math.abs(rot) > 1) neck = { bone: neckBone.id, rotation: r3(rot) };
    }
    const rest = lean(head);
    const v = [head[0] - hip[0], head[1] - hip[1]];
    const len = Math.hypot(v[0], v[1]) || 1;
    const normal: [number, number] = [v[1] / len, -v[0] / len]; // out of the back
    const back = side === "back";
    const d = this.depthOf(actor, side);
    const contact: [number, number] = [hip[0] + (back ? 1 : -1) * normal[0] * d, hip[1] + (back ? 1 : -1) * normal[1] * d];
    const rotation = r3(back ? -dir * (90 + rest) : dir * (90 - rest));
    const r = (rotation * Math.PI) / 180;
    const px = contact[0] * dir * s, py = contact[1] * s;
    const offset: [number, number] = [px * Math.cos(r) - py * Math.sin(r), px * Math.sin(r) + py * Math.cos(r)];
    return { rotation, contact, normal, offset, head, neck };
  }
  /** Bends (or straightens) the neck for lying. */
  private bendNeck(actor: string, neck: { bone: string; rotation: number } | undefined, abs: number, dur: number) {
    if (neck) this.set(actor, `bones.${neck.bone}.rotation`, neck.rotation, abs, dur, "sineInOut");
  }
  private hipOf(actor: string): [number, number] {
    const rig = this.member(actor)?.rig;
    return rig?.hip ?? [0, -Math.round((rig?.height ?? 200) * 0.4)];
  }
  /**
   * Where to sit / lie: a furniture actor, a set mark with a `seat` height, or the ground
   * (`"ground"` or nothing). Reports what is wrong and returns undefined.
   */
  private restPlace(actor: string, on: string | null, kind: "sit" | "lie"): { furniture: string } | { x?: number; h: number } | undefined {
    if (!on || on === "ground") return { h: 0 };
    if (this.furnitureOf.has(on)) return { furniture: on };
    const m = this.setDef.marks[on];
    if (m) {
      if (m.seat === undefined) return void this.issue("error", `${actor} cannot ${kind} on mark "${on}": it has no "seat" height (set "${this.block.set}")`);
      if (kind === "lie" && !m.lie) return void this.issue("error", `${actor} cannot lie on mark "${on}": it is a seat, not a place to lie ("lie": true)`);
      return { x: m.x, h: m.seat };
    }
    const seats = Object.entries(this.setDef.marks).filter(([, mk]) => mk.seat !== undefined).map(([id]) => id);
    return void this.issue("error", `${actor} cannot ${kind} on "${on}": not furniture of the block nor a seat of set "${this.block.set}"${closest(on, [...this.furnitureOf.keys(), ...seats])}`);
  }
  /** Sits on furniture (`seat` anchor), a set seat (mark with `seat`) or the ground: hips down, knees up, feet on the floor. */
  sit(actor: string, on: string | null, at: number, view?: string) {
    if (this.ridingAt(actor, at)) return this.issue("error", `${actor} cannot sit: riding then (dismount first)`);
    const rest = this.restAt(actor, at);
    if (rest?.kind === "sit" && rest.on === on) return;
    const place = this.restPlace(actor, on, "sit");
    if (!place) return;
    if (rest) this.getUp(actor, at - 1.6);
    const rig = this.member(actor)?.rig;
    const s = this.scaleOf(actor);
    const hip = this.hipOf(actor);
    const thigh = ((rig?.legLength?.F ?? (rig?.height ?? 200) * 0.4) / 2) * s;
    const legs = rig?.legLength ? rig.legLength.F * s : undefined;
    const hipY = Math.abs(hip[1]) * s;
    // Facing the audience (a sofa in front of the TV, a school desk): front view, thighs towards the camera.
    const front = view === "front" || (view === undefined && this.viewAt(actor, at) === "front");
    // Someone already sitting there: the next seat (furniture `seat2`, `seat3`…; along a set seat).
    const taken = on && on !== "ground" ? this.rests.filter((r) => r.kind === "sit" && r.on === on && r.t0 <= at && r.t1 > at).length : 0;
    let sitX: number, seatY: number, floor: number, dir: number;
    if ("furniture" in place) {
      const anchor = taken ? `seat${taken + 1}` : "seat";
      const seat = this.furniturePoint(place.furniture, anchor);
      if (!seat) return this.issue("error", taken ? `"${place.furniture}" has no free seat for ${actor} (anchor "${anchor}" missing)` : `"${place.furniture}" has no "seat" anchor to sit on`);
      dir = this.facing(place.furniture, at) ? 1 : -1;
      if (Math.abs(this.xAt(actor, at - 0.9) - seat[0]) > 30) this.walk(actor, seat[0], at - 0.9, 0.8);
      this.face(actor, dir > 0 ? "right" : "left", at);
      if (front) this.view(actor, "front", at);
      this.push({ at: this.t(at), actor, action: "mount", on: place.furniture, anchor, point: hip, duration: 0.5 });
      this.shadow(actor, at, { hide: true }, 0.3);
      [sitX, seatY, floor] = [seat[0], seat[1], this.furnitureOf.get(place.furniture)!.y];
    } else {
      const x = place.x !== undefined ? place.x + taken * this.spacing(actor) * (front ? 0.7 : 1) : this.xAt(actor, at);
      if (Math.abs(this.xAt(actor, at - 0.9) - x) > 30) this.walk(actor, x, at - 0.9, 0.8);
      dir = this.facing(actor, at) ? 1 : -1;
      if (front) this.view(actor, "front", at);
      floor = this.groundY(actor, at);
      const h = place.h;
      // The body goes down until the hips are on the seat (or the ground); the shadow stays on the floor.
      const drop = Math.round(-h + hipY * (h > 0 ? 1 : 0.9));
      this.set(actor, "y", Math.round(floor + drop), at, 0.5, "easeOut");
      this.shadow(actor, at, { drop }, 0.5);
      [sitX, seatY] = [x, floor - (h > 0 ? h : hipY * 0.1)];
    }
    if (legs && floor - seatY > legs * 1.05) this.issue("warning", `${actor}'s feet do not reach the floor from "${on}" (seat ${Math.round(floor - seatY)} px high, legs ${Math.round(legs)} px): they dangle`);
    if (front) this.frontLegs(actor, sitX, seatY, floor, dir, at);
    // Feet on the floor ahead, or (seat too high) dangling: knees bent, shins hanging.
    else this.feetDown(actor, sitX + dir * thigh * (floor - seatY > hipY * 0.3 ? 0.95 : 1.3), dir, Math.min(floor, seatY + (legs ?? 0) * 0.6), at, 0.5);
    this.rests.push({ actor, kind: "sit", on, t0: at, t1: Infinity, y: floor, front });
  }
  /**
   * Sitting seen from the front: the thighs point at the camera (foreshortened: shorter and rounder),
   * the shins hang straight down to the floor under the knees; on the ground both are foreshortened.
   */
  private frontLegs(actor: string, x: number, seatY: number, floor: number, dir: number, at: number) {
    const doc = this.kit.characters[this.characterOf(actor)] as unknown as { skeleton: { id: string; from?: [number, number] }[]; meta?: { views?: { move?: { front?: Record<string, [number, number]> } } } };
    const bone = (id: string) => doc.skeleton.find((b) => b.id === id)?.from;
    const s = this.scaleOf(actor);
    const drop = floor - seatY;
    for (const side of ["F", "B"] as const) {
      const [hipJ, knee, ankle] = [bone(`leg${side}1`), bone(`leg${side}2`), bone(`foot${side}`)];
      if (!hipJ || !knee || !ankle || !this.hasChain(actor, `foot${side}`)) continue;
      const thigh = Math.hypot(knee[0] - hipJ[0], knee[1] - hipJ[1]) * s;
      const shin = Math.hypot(ankle[0] - knee[0], ankle[1] - knee[1]) * s;
      const ax = (ankle[0] + (doc.meta?.views?.move?.front?.[`leg${side}1`]?.[0] ?? 0)) * s;
      const footX = Math.round(x + dir * ax);
      // The thigh points at the camera (seen end-on: short); the shin hangs from the knee, foreshortened
      // too when the seat is low (knees up), and the foot rests on the floor or dangles.
      const fore = thigh * 0.4;
      const shinSq = Math.max(-0.6, Math.min(0, (drop - fore) / shin - 1));
      this.set(actor, `bones.leg${side}1.squash`, -0.6, at, 0.5, "easeOut");
      this.set(actor, `bones.leg${side}2.squash`, r3(shinSq), at, 0.5, "easeOut");
      const footY = Math.min(floor + (drop < fore + shin * 0.5 ? 8 * s : 0), seatY + fore + shin * (1 + shinSq));
      this.push({ at: this.t(at), actor, action: "reach", chain: `foot${side}`, target: [footX, Math.round(footY)], duration: 0.5 });
    }
  }

  /** Lies down face up on furniture (`bed` anchor, else `seat`), a set place (mark with `seat` and `lie`) or the ground; head towards the back. */
  lie(actor: string, on: string | null, at: number, sleep = false) {
    if (this.ridingAt(actor, at)) return this.issue("error", `${actor} cannot lie down: riding then (dismount first)`);
    const rest = this.restAt(actor, at);
    if (rest?.kind === "lie" && rest.on === on) {
      if (sleep && !rest.sleep) this.fallAsleep(actor, rest, at);
      return;
    }
    const place = this.restPlace(actor, on, "lie");
    if (!place) return;
    if (rest) this.getUp(actor, at - 1.6);
    // Characters that tuck in (a turtle into its shell, a hedgehog curling up) do that instead.
    if (this.tucks(actor)) {
      if ("furniture" in place) {
        const anchor = this.furniturePoint(place.furniture, "bed") ? "bed" : "seat";
        const bed = this.furniturePoint(place.furniture, anchor);
        if (!bed) return this.issue("error", `"${place.furniture}" has no "bed" or "seat" anchor to lie on`);
        if (Math.abs(this.xAt(actor, at - 0.9) - bed[0]) > 30) this.walk(actor, bed[0], at - 0.9, 0.8);
        this.push({ at: this.t(at), actor, action: "mount", on: place.furniture, anchor, point: [0, 0], duration: 0.5 });
        this.coverUp(place.furniture, at);
      } else {
        if (place.x !== undefined && Math.abs(this.xAt(actor, at - 0.9) - place.x) > 30) this.walk(actor, place.x, at - 0.9, 0.8);
        if (place.h) this.set(actor, "y", Math.round(this.groundY(actor, at) - place.h), at, 0.5, "sineInOut");
      }
      this.push({ at: this.t(at + 0.2), actor, action: "pose", control: "tuck", value: "in", duration: 0.4 });
      const r = { actor, kind: "lie" as const, on, t0: at, t1: Infinity, y: this.groundY(actor, at), tuck: true };
      this.rests.push(r);
      if (sleep) this.fallAsleep(actor, r, at);
      return;
    }
    const rig = this.member(actor)?.rig;
    const s = this.scaleOf(actor);
    const hip = this.hipOf(actor);
    // The back rests on the surface, not the spine: about half the body's depth.
    const back = this.depthOf(actor, "back");
    if ("furniture" in place) {
      // With a `pillow` anchor the head goes on it (any body length); else the hips go on `bed` / `seat`.
      const head = ((this.kit.characters[this.characterOf(actor)]?.anchors ?? {}) as Record<string, { at: [number, number] }>).head?.at;
      const anchor = this.furniturePoint(place.furniture, "pillow") && head ? "pillow" : this.furniturePoint(place.furniture, "bed") ? "bed" : "seat";
      const bed = this.furniturePoint(place.furniture, anchor);
      if (!bed) return this.issue("error", `"${place.furniture}" has no "bed" or "seat" anchor to lie on`);
      const dir = this.facing(place.furniture, at) ? 1 : -1;
      if (Math.abs(this.xAt(actor, at - 0.9) - bed[0]) > 30) this.walk(actor, bed[0], at - 0.9, 0.8);
      this.face(actor, dir > 0 ? "right" : "left", at);
      const g = this.lying(actor, dir, "back");
      this.set(actor, "rotation", g.rotation, at, 0.6, "sineInOut");
      // On the pillow: the back of the head; on the bed: the back at the hips.
      const point: [number, number] = anchor === "pillow" ? [g.head[0] + g.normal[0] * back, g.head[1] + g.normal[1] * back] : g.contact;
      this.bendNeck(actor, g.neck, at, 0.6);
      this.push({ at: this.t(at), actor, action: "mount", on: place.furniture, anchor, point, duration: 0.6 });
      this.shadow(actor, at, { hide: true }, 0.4);
      this.coverUp(place.furniture, at);
    } else {
      const dir = this.facing(actor, at) ? 1 : -1;
      const g = this.lying(actor, dir, "back");
      // Rotated about the feet, the back (at the hips) must land on the place.
      if (place.x !== undefined) {
        const x = place.x - g.offset[0];
        if (Math.abs(this.xAt(actor, at - 0.9) - x) > 30) this.walk(actor, x, at - 0.9, 0.8);
        this.face(actor, dir > 0 ? "right" : "left", at);
      }
      const y = this.groundY(actor, at);
      this.set(actor, "rotation", g.rotation, at, 0.6, "sineInOut");
      this.set(actor, "y", Math.round(y - place.h - g.offset[1]), at, 0.6, "sineInOut");
      this.bendNeck(actor, g.neck, at, 0.6);
      this.shadow(actor, at, { hide: true }, 0.4);
    }
    const r = { actor, kind: "lie" as const, on, t0: at, t1: Infinity, y: this.groundY(actor, at) };
    this.rests.push(r);
    if (sleep) this.fallAsleep(actor, r, at);
  }
  /** The blanket of a bed comes over whoever lies down (pulled up after they settle). */
  private coverUp(furniture: string, at: number) {
    const c = this.furnitureOf.get(furniture)?.cover;
    if (!c) return;
    // Pulled up from the foot of the bed: in quickly, sliding into place.
    const x = this.xAt(furniture, at), foot = this.facing(furniture, at) ? 1 : -1;
    this.set(c, "x", Math.round(x + foot * 70 * this.furnitureOf.get(furniture)!.scale), at + 0.4, 0);
    this.set(c, "opacity", 1, at + 0.4, 0.12, "easeOut");
    this.set(c, "x", Math.round(x), at + 0.4, 0.45, "easeOut");
  }
  /** …and goes when the last one gets up. */
  private uncover(furniture: string, actor: string, at: number) {
    const c = this.furnitureOf.get(furniture)?.cover;
    const others = this.rests.some((r) => r.kind === "lie" && r.on === furniture && r.actor !== actor && r.t0 <= at && r.t1 > at);
    if (c && !others) this.set(c, "opacity", 0, at, 0.3, "easeIn");
  }
  /** A rig with a `tuck` pose control (poses `out` / `in`) tucks in to lie down or sleep. */
  private tucks(actor: string) {
    const c = (this.kit.characters[this.characterOf(actor)]?.controls as Record<string, { type: string; poses?: Record<string, unknown> }> | undefined)?.tuck;
    return c?.type === "pose" && !!c.poses?.in;
  }
  /** Eyes closed ("sleep" emotion) and floating Zzz until they get up. */
  private fallAsleep(actor: string, rest: { actor: string; sleep?: boolean }, at: number) {
    rest.sleep = true;
    if ((this.kit.characters[this.characterOf(actor)]?.controls as Record<string, { poses?: Record<string, unknown> }> | undefined)?.emotion?.poses?.sleep)
      this.push({ at: this.t(at + 0.4), actor, action: "pose", control: "emotion", value: "sleep", duration: 0.5 });
  }
  /** Zzz over every sleeper, one after the other, while they sleep. */
  private snores() {
    for (const r of this.rests.filter((x) => x.sleep)) {
      const end = Math.min(r.t1, this.t1);
      // Tucked in: from the rig's `tuck` anchor, else just above the tucked body.
      const tuckAnchor = r.tuck && ((this.kit.characters[this.characterOf(r.actor)]?.anchors ?? {}) as Record<string, unknown>).tuck;
      for (let t = r.t0 + 0.9; t + 0.5 < end; t += 2.6) {
        if (!r.tuck || tuckAnchor) this.push({ at: this.t(t), action: "fx", type: "zzz", actor: r.actor, ...(tuckAnchor ? { anchor: "tuck" } : {}) });
        else this.push({ at: this.t(t), action: "fx", type: "zzz", x: Math.round(this.xAt(r.actor, t)), y: Math.round(this.groundY(r.actor, t) - (this.member(r.actor)?.rig.height ?? 200) * 0.35 * this.scaleOf(r.actor)) });
      }
    }
  }
  /** Trips and falls (standing), or falls off what they ride. */
  fallDown(actor: string, at: number, side: "front" | "back") {
    if (this.ridingAt(actor, at)) return this.fall(actor, at, side);
    if (this.restAt(actor, at)) return this.issue("warning", `${actor} cannot fall: already sitting or lying`);
    this.knockDown(actor, at, side, this.facing(actor, at) ? 1 : -1, 0.4);
  }
  /** Stands back up: from furniture, a set seat, the ground or after a fall. */
  getUp(actor: string, at: number) {
    const l = this.restAt(actor, at);
    if (!l) return this.issue("warning", `${actor} is not sitting or lying to get up`);
    l.t1 = at + 0.6;
    if (l.kind === "lie" && l.on) this.uncover(l.on, actor, at);
    if (l.sleep && this.hasControl(actor, "emotion")) this.push({ at: this.t(at), actor, action: "pose", control: "emotion", value: "happy", duration: 0.3 });
    if (l.tuck) {
      this.push({ at: this.t(at), actor, action: "pose", control: "tuck", value: "out", duration: 0.4 });
      if (l.on && this.furnitureOf.has(l.on)) {
        this.push({ at: this.t(at + 0.3), actor, action: "mount", on: null, duration: 0.5 });
        this.slide(actor, this.xAt(l.on, at) + (this.facing(l.on, at) ? 1 : -1) * 60 * this.scaleOf(actor), at + 0.3, 0.5);
      } else this.set(actor, "y", Math.round(l.y ?? this.groundY(actor, at)), at + 0.2, 0.4, "sineInOut");
      return;
    }
    this.shadow(actor, at, { drop: 0, hide: false }, 0.5);
    if (l.kind !== "sit") this.bendNeck(actor, this.lying(actor, 1, "back").neck && { bone: this.lying(actor, 1, "back").neck!.bone, rotation: 0 }, at, 0.5);
    if (l.kind === "fallen") {
      this.set(actor, "rotation", 0, at, 0.6, "backOut");
      return this.set(actor, "y", Math.round(l.y ?? this.groundY(actor, at)), at, 0.6, "backOut");
    }
    if (l.kind === "sit") for (const c of ["footF", "footB"]) if (this.hasChain(actor, c)) this.push({ at: this.t(at), actor, action: "reach", chain: c, target: null, duration: 0.45 });
    if (l.front) for (const b of ["legF1", "legF2", "legB1", "legB2"]) this.set(actor, `bones.${b}.squash`, 0, at, 0.45, "easeOut");
    if (l.on && this.furnitureOf.has(l.on)) {
      // Off the seat (or the bed), standing in front of it.
      const dir = this.facing(l.on, at) ? 1 : -1;
      this.push({ at: this.t(at), actor, action: "mount", on: null, duration: 0.5 });
      if (l.kind === "lie") this.set(actor, "rotation", 0, at, 0.5, "sineInOut");
      const rig = this.member(actor)?.rig;
      this.slide(actor, this.xAt(l.on, at) + dir * ((rig?.legLength?.F ?? 80) / 2) * this.scaleOf(actor), at, 0.5);
    } else {
      this.set(actor, "y", Math.round(l.y ?? this.groundY(actor, at)), at, 0.5, "backOut");
      if (l.kind === "lie") this.set(actor, "rotation", 0, at, 0.6, "backOut");
    }
  }
  /** Moves an actor without a walking clip (thrown, stepping off a vehicle). */
  private slide(actor: string, x: number, abs: number, dur: number) {
    this.walks.push({ actor, t0: abs, t1: abs + dur, x0: this.xAt(actor, abs), x1: x });
    this.set(actor, "x", Math.round(x), abs, dur, "easeOut");
  }
  /** The riding pose (torso into the ride) while mounted. */
  private ridePoses() {
    for (const r of this.rides) {
      const t1 = Math.min(r.t1, this.t1);
      if (t1 - r.t0 > 0.2 && this.hasClip(r.rider, "ride")) this.push({ at: this.t(r.t0), actor: r.rider, action: "play", clip: "ride", loop: true, duration: r3(t1 - r.t0), fadeIn: 0.3, fadeOut: 0.3 });
    }
  }

  /** Cross to the far ground walking away from the camera (back view), hand in hand. */
  cross(who: string[], to: string, at: number, until: number) {
    if (this.setDef.ground.far === undefined) return this.issue("error", `set "${this.block.set}" has no far ground to cross to`);
    const ds = this.setDef.depthScale ?? 0.6;
    const target = this.mark(to).x;
    // Hand in hand from behind: neighbours first step to holding distance (back-view shoulders).
    const order = [...who].sort((a, b) => this.xAt(a, at) - this.xAt(b, at));
    if (order.length > 1) this.gather(order, at - 0.15, "back");
    const centre = who.reduce((a, w) => a + this.xAt(w, at), 0) / who.length;
    for (const w of who) {
      this.crossed.set(w, at);
      this.view(w, "back", at - 0.15);
      const s0 = this.scaleOf(w);
      const x1 = target + (this.xAt(w, at) - centre) * ds;
      this.walk(w, x1, at, until - at, { clip: this.hasClip(w, "walkDepth") ? "walkDepth" : "walk", y: this.setDef.ground.far, ease: "linear" });
      this.set(w, "scale", r3(s0 * ds), at, until - at, "linear");
      this.push({ at: this.t(at), actor: w, action: "lookAt", target: null });
    }
    for (let i = 1; i < order.length; i++) this.holdPair(order[i - 1], order[i], at - 0.15, "back");
    this.camera({ type: "cross", who }, at);
  }

  // -------------------------------------------------- camera
  camera(c: { type: string; who?: string | string[]; mark?: string }, at: number) {
    const who = (c.who === undefined ? this.present : Array.isArray(c.who) ? c.who : [c.who]).filter((w) => this.present.includes(w) || this.actors.some((a) => a.id === w));
    const abs = this.t(at);
    switch (c.type) {
      case "follow":
        if (who[0] && !this.present.includes(who[0]) || (c.who === undefined && !who.length)) {
          // Following an object (ball, car): frame it together with the cast, nobody is cut off.
          const subject = Array.isArray(c.who) ? c.who : c.who ? [c.who] : [];
          this.push({ at: abs, action: "camera", frame: [...subject.filter((s) => this.propStates.has(s) || this.actors.some((a) => a.id === s)), ...this.present], padding: 200, minZoom: 1, maxZoom: 1.1, blend: 1 });
        } else this.push({ at: abs, action: "camera", follow: who[0], offset: [120, -40], lag: 0.6, axes: "x", blend: 0.8 });
        break;
      case "close":
        this.push({ at: abs, action: "camera", frame: who.slice(0, 1), padding: 300, minZoom: 1.2, maxZoom: 1.5, blend: 0.8 });
        break;
      case "two-shot":
        this.push({ at: abs, action: "camera", frame: who.slice(0, 2), padding: 260, minZoom: 1.05, maxZoom: 1.3, blend: 1 });
        break;
      case "reveal": {
        // Pan towards a mark, but never so far that the cast leaves the frame.
        const W = this.kit.width ?? 1920;
        const zoom = 1.05;
        const half = (W / 2 - 170) / zoom;
        const xs = this.present.map((p) => this.xAt(p, at));
        let x = this.mark(c.mark ?? "center").x;
        if (xs.length) x = Math.min(Math.max(x, Math.max(...xs) - half), Math.min(...xs) + half);
        this.push({ at: abs, action: "camera", x: Math.round(x), y: 520, zoom, duration: 2.5, ease: "sineInOut" });
        break;
      }
      case "cross": {
        const x = this.mark("crossing").x;
        this.push({ at: abs, action: "camera", x, y: 640, zoom: 1.25, duration: 3, ease: "sineInOut" });
        this.push({ at: r3(abs + 3), action: "camera", x, y: 600, zoom: 1.6, duration: 6, ease: "sineInOut" });
        break;
      }
      case "group":
      case "wide":
      default:
        this.push({ at: abs, action: "camera", frame: who.length ? who : this.present, padding: c.type === "wide" ? 260 : 220, minZoom: 1, maxZoom: 1.15, blend: 1.2, ...this.band(who.length ? who : this.present, at) });
    }
  }

  /**
   * Vertical extent of a group shot: from the tallest head to the ground. Framing follows the cast
   * sideways only, so a jump or a flight never moves the whole set up and down.
   */
  private band(who: string[], at: number): { band?: [number, number] } {
    const cast = who.filter((w) => this.kit.cast[w]);
    if (!cast.length || cast.some((w) => this.crossed.has(w))) return {};
    const ground = this.setDef.ground.near;
    const top = Math.min(...cast.map((w) => ground - (this.member(w)?.rig.height ?? 300) * this.scaleOf(w)));
    return { band: [Math.round(top), ground + 30] };
  }

  // -------------------------------------------------- continuity checks
  /** Two characters covering each other for more than half a second (not hand in hand). */
  private checkOverlaps() {
    const ids = this.present;
    const reported = new Set<string>();
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        let run = 0;
        for (let t = this.t0; t < this.t1; t += 0.25) {
          const a = ids[i], b = ids[j];
          const holding = this.holds.some((h) => (h.actor === a || h.actor === b) && h.t0 <= t && h.t1 > t);
          const [l, r] = this.xAt(a, t) <= this.xAt(b, t) ? [a, b] : [b, a];
          // On the far ground everyone is smaller (depthScale): they need less room.
          const far = (id: string) => (this.crossed.has(id) && t >= this.crossed.get(id)! ? (this.setDef.depthScale ?? 0.6) : 1);
          const need = (this.pairGap(l, r, this.facing(l, t), this.facing(r, t)) - 20) * Math.max(far(l), far(r));
          const gap = this.xAt(r, t) - this.xAt(l, t);
          // Walking past someone is fine; standing on top of each other is not.
          const moving = this.walks.some((w) => (w.actor === a || w.actor === b) && w.t0 <= t && w.t1 > t);
          // Side by side on the same sofa or bench is where they belong.
          const ra = this.restAt(a, t), rb = this.restAt(b, t);
          if (ra?.on && ra.on === rb?.on) {
            run = 0;
            continue;
          }
          run = !holding && !moving && gap < need * 0.7 ? run + 0.25 : 0;
          const key = `${a}|${b}`;
          if (run > 0.5 && !reported.has(key)) {
            reported.add(key);
            const line = this.time.lines.filter((x) => x.s <= t).pop()?.i ?? this.block.from;
            this.issue("error", `around line ${line}: ${l} and ${r} cover each other (${Math.round(gap)} px apart, need ${Math.round(need)}): send them to different places or use "near"`);
          }
        }
      }
  }

  // -------------------------------------------------- dialogue (automatic)
  private canTurn(actor: string, abs: number) {
    if (this.viewAt(actor, abs) !== "profile") return false;
    if (this.rides.some((r) => r.rider === actor && r.t0 - 0.3 <= abs && r.t1 + 0.3 > abs) || this.restAt(actor, abs)) return false;
    if (this.holds.some((h) => h.actor === actor && h.t0 <= abs + 0.3 && h.t1 > abs - 0.3)) return false;
    if (this.walks.some((w) => w.actor === actor && w.t0 - 0.3 <= abs && w.t1 + 0.2 > abs)) return false;
    if (this.faces.some((f) => f.actor === actor && Math.abs(f.t - abs) < 1.2)) return false;
    return true;
  }
  private turnTowards(actor: string, x: number, abs: number) {
    if (!this.canTurn(actor, abs)) return;
    const dx = x - this.xAt(actor, abs);
    if (Math.abs(dx) < 20) return;
    this.push({ at: this.t(abs), actor, action: "face", direction: dx > 0 ? "right" : "left" });
  }
  private speakerOf(l: Line): string[] {
    if (l.song || norm(l.speaker) === "song") return [...this.present];
    const id = Object.entries(this.kit.cast).find(([id, c]) => norm(c.name) === norm(l.speaker) || norm(id) === norm(l.speaker))?.[0];
    return id && this.present.includes(id) ? [id] : [];
  }
  private addressed(l: Line, speaker: string): string | undefined {
    const text = ` ${norm(l.text)} `;
    return this.present.find((id) => {
      if (id === speaker) return false;
      const c = this.kit.cast[id];
      return [c.name, ...(c.aliases ?? [])].some((n) => text.includes(` ${norm(n)} `));
    });
  }
  dialogue(noTurn: Set<number>) {
    for (const l of this.time.lines.filter((l) => l.s >= this.t0 && l.s < this.t1)) {
      const speakers = this.speakerOf(l);
      const at = this.t(l.s);
      for (const id of speakers) {
        this.push({ at, actor: id, action: "say", cues: lineCues(l) });
        const busy = this.busy.some((b) => b.actor === id && b.t0 <= l.s + 0.2 && b.t1 > l.s + 0.2);
        const clip = l.song || norm(l.speaker) === "song" ? "sing" : "talk";
        if (!busy && this.hasClip(id, clip)) this.push({ at: this.t(l.s - 0.15), actor: id, action: "play", clip, duration: r3(l.e - l.s + 0.2), fadeIn: 0.3, fadeOut: 0.4, weight: 0.7 });
      }
      if (speakers.length !== 1 || l.song || norm(l.speaker) === "song") continue;
      const sp = speakers[0];
      const turn = !noTurn.has(l.i);
      const named = this.addressed(l, sp);
      const others = this.present.filter((x) => x !== sp).sort((a, b) => Math.abs(this.xAt(a, l.s) - this.xAt(sp, l.s)) - Math.abs(this.xAt(b, l.s) - this.xAt(sp, l.s)));
      if (named) others.unshift(named);
      if (others[0] && this.viewAt(sp, l.s) === "profile") {
        this.push({ at: this.t(l.s - 0.2), actor: sp, action: "lookAt", target: others[0] });
        if (turn) this.turnTowards(sp, this.xAt(others[0], l.s), l.s - 0.3);
      }
      for (const id of this.present) {
        if (id === sp || this.viewAt(id, l.s) !== "profile") continue;
        this.push({ at: this.t(l.s - 0.1), actor: id, action: "lookAt", target: sp });
        if (turn) this.turnTowards(id, this.xAt(sp, l.s), l.s - 0.25);
      }
    }
  }

  // -------------------------------------------------- build
  build(): SceneDoc {
    this.placeCast();
    this.placeVehicles();
    this.placeFurniture();
    // Fixtures (traffic lights…).
    for (const f of this.setDef.fixtures ?? []) {
      const m = this.mark(f.mark);
      this.addActor(f.id, m.x, { character: f.character, y: f.y ?? m.y ?? this.setDef.ground.far ?? this.setDef.ground.near, scale: f.scale ?? 1, z: f.z ?? 0, flip: f.flip, parallax: f.parallax });
      if (f.value) this.set(f.id, f.channel ?? "parts.light.variant", f.value, this.t0);
      // Moving scenery (clock hands, a weather vane, a windmill): its clip loops from the start.
      const loop = f.clip ?? (this.kit.characters[f.character]?.clips?.loop ? "loop" : undefined);
      if (loop) {
        if (this.kit.characters[f.character]?.clips?.[loop]) this.push({ at: 0, actor: f.id, action: "play", clip: loop, loop: true, fadeIn: 0 });
        else this.issue("error", `fixture "${f.id}": its rig has no clip "${loop}"`);
      }
    }
    // Props.
    for (const p of this.block.props ?? []) {
      const holder = p.heldBy;
      const x = holder ? this.xAt(holder, this.t0) : this.placeX(p.at ?? "center", this.t0);
      const def = this.kit.props[p.kind];
      const markY = typeof p.at === "string" ? this.setDef.marks[p.at]?.y : undefined;
      this.addProp(p.id, p.kind, p.color, x, (markY ?? this.setDef.ground.near) - (def?.radius ?? 20), holder ? 4 : 3);
      if (holder) this.grab(holder, p.id, this.t0);
    }
    this.camera(this.block.camera ?? { type: "wide" }, this.t0);
    const noTurn = new Set<number>();
    // Walks of several characters to the same place at the same moment act as one group walk.
    const beats: Beat[] = [];
    for (const b of this.block.beats ?? []) {
      if (b.do !== "walk" && b.do !== "run") {
        beats.push(b);
        continue;
      }
      const key = (x: Beat) => JSON.stringify([x.do, x.line, x.word ?? null, !!x.end, x.offset ?? 0, x.to, x.until ?? null]);
      const same = beats.find((x) => (x.do === "walk" || x.do === "run") && key(x) === key(b));
      const list = (w: unknown) => (Array.isArray(w) ? w : [w]) as string[];
      if (same) same.who = [...list(same.who), ...list(b.who)];
      else beats.push({ ...b });
    }
    for (const b of [...beats].sort((a, b) => this.time.at(a) - this.time.at(b))) {
      try {
        this.beat(b);
      } catch (e) {
        this.issue("error", `line ${b.line} "${b.do}": ${(e as Error).message}`);
      }
      if (b.do === "look" || b.do === "face") noTurn.add(b.line);
    }
    this.ridePoses();
    this.snores();
    this.dialogue(noTurn);
    this.checkOverlaps();
    for (const st of this.propStates.values()) {
      for (const [ch, keys] of [["x", st.x], ["y", st.y], ["scale", st.scale], ["rotation", st.rotation]] as const)
        if (keys.length) this.tracks[`props.${st.id}.${ch}`] = [...keys].sort((a, b) => a[0] - b[0]);
    }
    const layers = typeof this.setDef.layers === "function" ? this.setDef.layers() : this.setDef.layers;
    const usedChars = new Set(this.actors.map((a) => a.character as string));
    return {
      format: "toon-scene",
      version: 1,
      width: this.kit.width ?? 1920,
      height: this.kit.height ?? 1080,
      fps: this.kit.fps ?? 30,
      duration: r3(this.t1 - this.t0),
      background: this.setDef.background ?? "#bfe6ff",
      characters: Object.fromEntries([...usedChars].map((c) => [c, c])),
      camera: this.cam,
      layers: layers.map((l) => ({ id: l.id, art: l.art, parallax: l.parallax ?? 1, z: -10 })),
      actors: this.actors,
      props: this.props,
      tracks: this.tracks,
      ...(this.setDef.lighting ? { lighting: this.setDef.lighting } : {}),
      script: [...this.script].sort((a, b) => a.at - b.at),
    } as unknown as SceneDoc;
  }
}

// ------------------------------------------------------------------ the episode

/**
 * Turns a staging (blocks of continuous action, beats timed to lines and words, cuts and texts)
 * into a toon-sequence with one scene per block. Pure: runs in the browser and in node.
 */
export function direct(staging: Staging, lines: Line[], kit: Kit): Directed {
  const time = new Timeline(lines);
  const issues: Issue[] = [];
  const scenes: Record<string, SceneDoc> = {};
  const starts: Record<string, number> = {};
  const blocks = [...staging.blocks].sort((a, b) => a.from - b.from);
  for (const [i, block] of blocks.entries()) {
    if (scenes[block.id]) issues.push({ severity: "error", where: `block ${block.id}`, message: "duplicate block id" });
    const bs = new BlockScene(block, kit, time, issues, i === 0);
    scenes[block.id] = bs.build();
    starts[block.id] = bs.t0;
  }
  // Coverage: blocks must follow each other.
  for (let i = 1; i < blocks.length; i++) if (blocks[i].from !== blocks[i - 1].to) issues.push({ severity: "warning", where: `block ${blocks[i].id}`, message: `starts at line ${blocks[i].from}, the previous block ends at ${blocks[i - 1].to}` });

  // Timeline: live blocks, with replay cuts spliced in.
  type Seg = { t0: number; t1: number; scene: string; from: number; mute?: boolean; transition?: string };
  const segs: Seg[] = blocks.map((b, i) => ({ t0: starts[b.id], t1: i + 1 < blocks.length ? starts[blocks[i + 1].id] : time.end, scene: b.id, from: 0, transition: i > 0 && blocks[i - 1].set !== b.set ? "fade" : undefined }));
  for (const c of [...(staging.cuts ?? [])].sort((a, b) => a.line - b.line)) {
    const t0 = time.at(c);
    const t1 = c.until ? time.at(c.until) : time.at({ line: c.line, end: true });
    const src = blocks.find((b) => b.id === c.replay.block);
    if (!src) {
      issues.push({ severity: "error", where: `cut at line ${c.line}`, message: `unknown block "${c.replay.block}"` });
      continue;
    }
    const from = time.at(c.replay) - starts[src.id];
    const cut: Seg = { t0, t1, scene: src.id, from: Math.max(0, from), mute: true, transition: c.transition ?? "flash" };
    const out: Seg[] = [];
    for (const s of segs) {
      if (s.t1 <= t0 || s.t0 >= t1) out.push(s);
      else {
        if (s.t0 < t0) out.push({ ...s, t1: t0 });
        if (s.t1 > t1) out.push({ ...s, t0: t1, from: s.from + (t1 - s.t0), transition: "flash", mute: s.mute });
      }
    }
    out.push(cut);
    segs.splice(0, segs.length, ...out.sort((a, b) => a.t0 - b.t0));
  }
  // Shots must tile the timeline: close the gaps (between lines, before the first block).
  segs.sort((a, b) => a.t0 - b.t0);
  if (segs.length) segs[0].t0 = 0;
  for (let i = 1; i < segs.length; i++) if (segs[i].t0 > segs[i - 1].t1) segs[i - 1].t1 = segs[i].t0;
  if (segs.length) segs[segs.length - 1].t1 = Math.max(segs[segs.length - 1].t1, time.end);
  const shots = segs
    .filter((s) => s.t1 - s.t0 > 0.02)
    .map((s) => ({
      scene: s.scene,
      from: r3(s.from),
      duration: r3(s.t1 - s.t0),
      ...(s.mute ? { muteSpeech: true } : {}),
      ...(s.transition ? { transition: { type: s.transition, duration: s.transition === "flash" ? 0.3 : 0.6, color: "#ffffff" } } : {}),
    }));
  const sequence = {
    format: "toon-sequence",
    version: 1,
    width: kit.width ?? 1920,
    height: kit.height ?? 1080,
    fps: kit.fps ?? 30,
    scenes: Object.fromEntries(Object.keys(scenes).map((id) => [id, id])),
    shots,
  } as unknown as SequenceDoc;

  // On-screen texts: fixed at the top, while their line plays.
  const overlays: Overlay[] = [];
  for (const t of staging.texts ?? []) {
    const from = time.at({ line: t.line });
    const to = t.until ? time.at(t.until) : Math.max(time.at({ line: t.line, end: true }), from + 1.6);
    overlays.push({ text: t.text, from: r3(from), to: r3(to), row: 0 });
  }
  overlays.sort((a, b) => a.from - b.from);
  const inCut = (t: number) => (staging.cuts ?? []).some((c) => time.at(c) <= t + 0.01 && (c.until ? time.at(c.until) : time.at({ line: c.line, end: true })) >= t);
  for (let i = 1; i < overlays.length; i++) {
    const prev = overlays[i - 1], cur = overlays[i];
    if (cur.from < prev.to) {
      cur.row = prev.row + 1;
      const max = inCut(cur.from) ? 2 : 1;
      if (cur.row + 1 > max)
        issues.push({ severity: "error", where: `text "${cur.text}" (line ${staging.texts!.find((t) => t.text === cur.text)?.line})`, message: `overlaps "${prev.text}": at most ${max === 1 ? "one text at a time (two only during a recap replay)" : "two texts at once"}` });
    }
  }
  return { sequence, scenes, overlays, issues };
}

/** Episode time where a block's scene starts (the first block starts at 0). */
function blocks0(staging: Staging, time: Timeline, block: Block) {
  const first = [...staging.blocks].sort((a, b) => a.from - b.from)[0];
  return block === first ? 0 : time.blockStart(block);
}

/** direct() + document validation + continuity checks. */
export function check(staging: Staging, lines: Line[], kit: Kit): Issue[] {
  let out: Directed;
  try {
    out = direct(staging, lines, kit);
  } catch (e) {
    return [{ severity: "error", where: "staging", message: (e as Error).message }];
  }
  const issues = [...out.issues];
  const assets = { characters: kit.characters };
  for (const [id, doc] of Object.entries(out.scenes)) {
    const v = validateScene(doc, assets as never);
    for (const i of v.issues) issues.push({ severity: i.severity === "warning" ? "warning" : "error", where: `scene ${id} ${i.path}`, message: i.message });
  }
  const sv = validateSequence(out.sequence);
  for (const i of sv.issues) issues.push({ severity: "error", where: `sequence ${i.path}`, message: i.message });
  // Every speaking cast member is in the block where they speak.
  const time = new Timeline(lines);
  for (const l of lines) {
    const id = Object.entries(kit.cast).find(([, c]) => norm(c.name) === norm(l.speaker))?.[0];
    if (!id) continue;
    const block = staging.blocks.find((b) => l.i >= b.from && l.i < b.to);
    const replayed = staging.cuts?.some((c) => time.at(c) <= l.s && (c.until ? time.at(c.until) : time.at({ line: c.line, end: true })) >= l.e);
    if (block && !replayed && !block.cast.some((c) => c.id === id)) issues.push({ severity: "error", where: `line ${l.i}`, message: `${l.speaker} speaks but is not in block "${block.id}"` });
  }
  // Whoever speaks must be in the frame (camera rigs are evaluated, not guessed).
  const W = kit.width ?? 1920, H = kit.height ?? 1080;
  const compiled = new Map<string, ReturnType<typeof compileScene>>();
  for (const l of lines) {
    const id = Object.entries(kit.cast).find(([, c]) => norm(c.name) === norm(l.speaker))?.[0];
    const block = staging.blocks.find((b) => l.i >= b.from && l.i < b.to);
    if (!id || !block || !block.cast.some((c) => c.id === id) || !out.scenes[block.id]) continue;
    const replayed = staging.cuts?.some((c) => time.at(c) <= l.s && (c.until ? time.at(c.until) : time.at({ line: c.line, end: true })) >= l.e);
    if (replayed) continue;
    try {
      if (!compiled.has(block.id)) compiled.set(block.id, compileScene(out.scenes[block.id], assets as never));
      const sc = compiled.get(block.id)!;
      const t0 = blocks0(staging, time, block);
      const [x, y] = screenPoint(sc, id, Math.max(0, (l.s + l.e) / 2 - t0));
      if (x < W * 0.06 || x > W * 0.94 || y < H * 0.03 || y > H)
        issues.push({ severity: "error", where: `line ${l.i}`, message: `${l.speaker} speaks out of the frame or at its edge (head at x ${Math.round(x)}, y ${Math.round(y)}): change the camera so the speaker is in shot` });
    } catch {
      // validation already reports scenes that do not compile
    }
  }
  return issues;
}
