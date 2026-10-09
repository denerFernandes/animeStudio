import {
  type BoneDef,
  type ClipDef,
  type Ease,
  type Keyframe,
  type PartDef,
  type Rig,
  type ToonDoc,
  type Value,
  type Vec2,
  apply,
  compileRig,
  normalizeTrack,
  sampleTrack,
} from "@animestudio/core";

/** Pure, immutable operations on toon documents used by the editor. */

const clone = <T>(v: T): T => structuredClone(v);
const r2 = (v: number) => Math.round(v * 100) / 100;
const r2v = (v: Vec2): Vec2 => [r2(v[0]), r2(v[1])];

export function blankToon(name = "character"): ToonDoc {
  return {
    format: "toon",
    version: 1,
    name,
    palette: { body: "#8EC5FF", outline: "#3A6EA5" },
    art: {
      body: `<ellipse cx="0" cy="-90" rx="50" ry="70" fill="palette(body)" stroke="palette(outline)" stroke-width="4"/>`,
      head: `<circle cx="0" cy="-200" r="45" fill="palette(body)" stroke="palette(outline)" stroke-width="4"/>`,
    },
    skeleton: [
      { id: "root" },
      { id: "body", parent: "root", from: [0, -40], to: [0, -150] },
      { id: "head", parent: "body", from: [0, -150], to: [0, -240] },
    ],
    parts: [
      { id: "body", type: "rigid", bone: "body", art: "body" },
      { id: "head", type: "rigid", bone: "head", art: "head" },
    ],
    clips: { idle: { duration: 2, loop: true, tracks: { "bones.head.rotation": [[0, -4], [1, 4], [2, -4]] } } },
  };
}

/** Rewrites every bone in setup form (from / to in setup space) so it can be dragged directly. */
export function toSetupForm(doc: ToonDoc): ToonDoc {
  const rig = compileRig(doc);
  const out = clone(doc);
  out.skeleton = doc.skeleton.map((def, i) => {
    const b = rig.bones[i];
    const from = r2v(apply(b.setupWorld, [0, 0]));
    const { x: _x, y: _y, rotation: _r, length: _l, from: _f, to: _t, ...rest } = def;
    const next: BoneDef = { ...rest, from };
    if (b.length > 0) next.to = r2v(apply(b.setupWorld, [b.length, 0]));
    else {
      const dir = apply(b.setupWorld, [10, 0]);
      if (Math.abs(dir[1] - from[1]) > 1e-3 || dir[0] - from[0] < 0) {
        next.to = r2v(dir);
        next.length = 0;
      }
    }
    if (i === 0 && !def.parent && from[0] === 0 && from[1] === 0 && !next.to) delete next.from;
    return next;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Bones
// ---------------------------------------------------------------------------

export function uniqueId(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  let i = 2;
  while (set.has(`${base}${i}`)) i++;
  return `${base}${i}`;
}

export function updateBone(doc: ToonDoc, id: string, patch: Partial<BoneDef>): ToonDoc {
  const out = clone(doc);
  out.skeleton = out.skeleton.map((b) => (b.id === id ? cleanUndefined({ ...b, ...patch }) : b));
  return out;
}

export function addBone(doc: ToonDoc, parent: string, from: Vec2, to: Vec2, id = "bone"): { doc: ToonDoc; id: string } {
  const out = clone(doc);
  const newId = uniqueId(id, out.skeleton.map((b) => b.id));
  const idx = out.skeleton.findIndex((b) => b.id === parent);
  // Insert after the parent's last descendant to keep parents-before-children order.
  let insertAt = idx + 1;
  const descendants = new Set([parent]);
  for (let i = idx + 1; i < out.skeleton.length; i++) {
    const p = out.skeleton[i].parent;
    if (p && descendants.has(p)) {
      descendants.add(out.skeleton[i].id);
      insertAt = i + 1;
    }
  }
  out.skeleton.splice(insertAt, 0, { id: newId, parent, from: r2v(from), to: r2v(to) });
  return { doc: out, id: newId };
}

const channelBone = (channel: string) => (channel.startsWith("bones.") ? channel.split(".")[1] : undefined);

/** Deletes a bone: children are re-parented, parts move to the parent, references are removed. */
export function deleteBone(doc: ToonDoc, id: string): ToonDoc {
  const bone = doc.skeleton.find((b) => b.id === id);
  if (!bone || !bone.parent) return doc; // roots cannot be deleted
  const parent = bone.parent;
  let out = toSetupForm(doc);
  out.skeleton = out.skeleton.filter((b) => b.id !== id).map((b) => (b.parent === id ? { ...b, parent } : b));
  out.parts = out.parts.map((p) => {
    if ("bone" in p && p.bone === id) return { ...p, bone: parent };
    if ("bones" in p) {
      const bones = p.bones.filter((b) => b !== id);
      return { ...p, bones: bones.length ? bones : [parent] } as PartDef;
    }
    return p;
  });
  const removedIk = new Set((out.ik ?? []).filter((k) => k.bones.includes(id)).map((k) => k.id));
  out.ik = out.ik?.filter((k) => !removedIk.has(k.id));
  // Physics channels are addressed by index: remap them after filtering.
  const physicsMap = new Map<number, number>();
  const keptPhysics = (out.physics ?? []).filter((ph, i) => {
    const keep = ph.type === "spring" ? !ph.bones.includes(id) : ph.bone !== id;
    if (keep) physicsMap.set(i, physicsMap.size);
    return keep;
  });
  if (out.physics) out.physics = keptPhysics;
  out.colliders = out.colliders?.filter((c) => c.bone !== id);
  if (out.anchors) for (const a of Object.values(out.anchors)) if (a.bone === id) a.bone = parent;
  const removedBehaviors = new Set((out.behaviors ?? []).filter((b) => "bone" in b && b.bone === id).map((b) => b.id));
  out.behaviors = out.behaviors?.filter((b) => !removedBehaviors.has(b.id));

  /** Returns the channel to keep (possibly remapped) or null to drop it. */
  const mapChannel = (ch: string): string | null => {
    const seg = ch.split(".");
    if (seg[0] === "bones" && seg[1] === id) return null;
    if (seg[0] === "ik" && removedIk.has(seg[1])) return null;
    if (seg[0] === "behaviors" && removedBehaviors.has(seg[1])) return null;
    if (seg[0] === "physics") {
      const n = physicsMap.get(Number(seg[1]));
      return n === undefined ? null : `physics.${n}.${seg.slice(2).join(".")}`;
    }
    return ch;
  };
  const remap = <T>(rec: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(rec).flatMap(([k, v]) => {
      const m = mapChannel(k);
      return m ? [[m, v]] : [];
    }));
  for (const clip of Object.values(out.clips ?? {})) clip.tracks = remap(clip.tracks);
  for (const c of Object.values(out.controls ?? {})) {
    if (c.type === "aim") c.targets = c.targets.filter((t) => t.bone !== id);
    if (c.type === "pose") for (const [name, p] of Object.entries(c.poses)) c.poses[name] = remap(p);
  }
  // Behaviors / controls that lost all their targets are dropped.
  if (out.controls) {
    out.controls = Object.fromEntries(Object.entries(out.controls).filter(([, c]) => c.type !== "aim" || c.targets.length > 0));
  }
  out = pruneEmpty(out);
  return out;
}

/** Renames a bone and every reference to it (parts, IK, physics, anchors, controls, channels). */
export function renameBone(doc: ToonDoc, from: string, to: string): ToonDoc {
  if (from === to || !to) return doc;
  if (doc.skeleton.some((b) => b.id === to)) throw new Error(`A bone named "${to}" already exists`);
  const out = clone(doc);
  const rn = (id: string) => (id === from ? to : id);
  const rnChannel = (ch: string) => (channelBone(ch) === from ? ch.replace(`bones.${from}.`, `bones.${to}.`) : ch);
  const rnKeys = <T>(rec: Record<string, T>) => Object.fromEntries(Object.entries(rec).map(([k, v]) => [rnChannel(k), v]));
  out.skeleton = out.skeleton.map((b) => ({ ...b, id: rn(b.id), ...(b.parent ? { parent: rn(b.parent) } : {}) }));
  out.parts = out.parts.map((p) => {
    if ("bone" in p) return { ...p, bone: rn(p.bone) };
    return { ...p, bones: p.bones.map(rn) } as PartDef;
  });
  out.ik = out.ik?.map((k) => ({ ...k, bones: k.bones.map(rn) }));
  out.physics = out.physics?.map((ph) => (ph.type === "spring" ? { ...ph, bones: ph.bones.map(rn) } : { ...ph, bone: rn(ph.bone) }));
  out.colliders = out.colliders?.map((c) => ({ ...c, bone: rn(c.bone) }));
  if (out.anchors) for (const a of Object.values(out.anchors)) a.bone = rn(a.bone);
  out.behaviors = out.behaviors?.map((b) => ("bone" in b ? { ...b, bone: rn(b.bone) } : b));
  for (const clip of Object.values(out.clips ?? {})) clip.tracks = rnKeys(clip.tracks);
  for (const c of Object.values(out.controls ?? {})) {
    if (c.type === "aim") c.targets = c.targets.map((t) => ({ ...t, bone: rn(t.bone) }));
    if (c.type === "pose") for (const [name, p] of Object.entries(c.poses)) c.poses[name] = rnKeys(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

export function updatePart(doc: ToonDoc, id: string, patch: Record<string, unknown>): ToonDoc {
  const out = clone(doc);
  out.parts = out.parts.map((p) => (p.id === id ? (cleanUndefined({ ...p, ...patch }) as PartDef) : p));
  return out;
}

/** Moves a part in draw order by `delta` (positive = towards the front). */
export function movePart(doc: ToonDoc, id: string, delta: number): ToonDoc {
  const out = clone(doc);
  const i = out.parts.findIndex((p) => p.id === id);
  const j = Math.max(0, Math.min(out.parts.length - 1, i + delta));
  if (i < 0 || i === j) return doc;
  const [p] = out.parts.splice(i, 1);
  out.parts.splice(j, 0, p);
  return out;
}

export function deletePart(doc: ToonDoc, id: string): ToonDoc {
  const out = clone(doc);
  out.parts = out.parts.filter((p) => p.id !== id);
  for (const clip of Object.values(out.clips ?? {})) {
    for (const ch of Object.keys(clip.tracks)) if (ch.startsWith(`parts.${id}.`)) delete clip.tracks[ch];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Clips and keys
// ---------------------------------------------------------------------------

export type KeyTuple = [number, Value] | [number, Value, Ease];

export const keyTuple = (k: Keyframe): KeyTuple => {
  const n = Array.isArray(k) ? { t: k[0], v: k[1], ease: k[2] } : { t: k.t, v: k.v, ease: k.ease };
  return n.ease === undefined ? [n.t, n.v] : [n.t, n.v, n.ease as Ease];
};

function withClip(doc: ToonDoc, clip: string, fn: (c: ClipDef) => void): ToonDoc {
  const out = clone(doc);
  const c = out.clips?.[clip];
  if (!c) return doc;
  fn(c);
  return out;
}

/** Keys of a track, normalized to tuples and sorted by time. */
export function trackKeys(doc: ToonDoc, clip: string, channel: string): KeyTuple[] {
  return (doc.clips?.[clip]?.tracks[channel] ?? []).map(keyTuple).sort((a, b) => a[0] - b[0]);
}

const EPS = 1e-4;

/** Sets (or inserts) a key at time t. */
export function setKey(doc: ToonDoc, clip: string, channel: string, t: number, value: Value, ease?: Ease): ToonDoc {
  return withClip(doc, clip, (c) => {
    const keys = (c.tracks[channel] ?? []).map(keyTuple);
    const i = keys.findIndex((k) => Math.abs(k[0] - t) < EPS);
    const keepEase = ease ?? (i >= 0 ? keys[i][2] : undefined);
    const key: KeyTuple = keepEase === undefined ? [r3(t), roundValue(value)] : [r3(t), roundValue(value), keepEase];
    if (i >= 0) keys[i] = key;
    else keys.push(key);
    c.tracks[channel] = keys.sort((a, b) => a[0] - b[0]);
  });
}

export function setKeyEase(doc: ToonDoc, clip: string, channel: string, index: number, ease: Ease | undefined): ToonDoc {
  return withClip(doc, clip, (c) => {
    const keys = trackKeys(doc, clip, channel);
    const k = keys[index];
    if (!k) return;
    keys[index] = ease === undefined ? [k[0], k[1]] : [k[0], k[1], ease];
    c.tracks[channel] = keys;
  });
}

export function removeKey(doc: ToonDoc, clip: string, channel: string, index: number): ToonDoc {
  return withClip(doc, clip, (c) => {
    const keys = trackKeys(doc, clip, channel);
    keys.splice(index, 1);
    if (keys.length) c.tracks[channel] = keys;
    else delete c.tracks[channel];
  });
}

/** Moves key `index` to time `t` (clamped to the clip); returns the key's new index. */
export function moveKey(doc: ToonDoc, clip: string, channel: string, index: number, t: number): { doc: ToonDoc; index: number } {
  let newIndex = index;
  const out = withClip(doc, clip, (c) => {
    const keys = trackKeys(doc, clip, channel);
    const k = keys[index];
    if (!k) return;
    const time = r3(Math.max(0, Math.min(c.duration, t)));
    keys.splice(index, 1);
    const clash = keys.findIndex((o) => Math.abs(o[0] - time) < EPS);
    if (clash >= 0) keys.splice(clash, 1);
    const moved = [time, ...k.slice(1)] as KeyTuple;
    keys.push(moved);
    keys.sort((a, b) => a[0] - b[0]);
    newIndex = keys.indexOf(moved);
    c.tracks[channel] = keys;
  });
  return { doc: out, index: newIndex };
}

export function addTrack(doc: ToonDoc, clip: string, channel: string, value: Value): ToonDoc {
  if (doc.clips?.[clip]?.tracks[channel]) return doc;
  return setKey(doc, clip, channel, 0, value);
}

export function removeTrack(doc: ToonDoc, clip: string, channel: string): ToonDoc {
  return withClip(doc, clip, (c) => {
    delete c.tracks[channel];
  });
}

/** Value of a channel in a clip at time t (the clip's own track only), or undefined. */
export function clipValue(doc: ToonDoc, clip: string, channel: string, t: number): Value | undefined {
  const def = doc.clips?.[clip];
  const keys = def?.tracks[channel];
  if (!def || !keys?.length) return undefined;
  return sampleTrack(normalizeTrack(keys, def.loop ? { loop: { duration: def.duration } } : {}), t);
}

export function addClip(doc: ToonDoc, name = "clip", from?: string): { doc: ToonDoc; name: string } {
  const out = clone(doc);
  out.clips ??= {};
  const id = uniqueId(name, Object.keys(out.clips));
  out.clips[id] = from && out.clips[from] ? clone(out.clips[from]) : { duration: 1, loop: true, tracks: {} };
  return { doc: out, name: id };
}

export function deleteClip(doc: ToonDoc, name: string): ToonDoc {
  const out = clone(doc);
  if (out.clips) delete out.clips[name];
  return out;
}

export function renameClip(doc: ToonDoc, from: string, to: string): ToonDoc {
  if (!to || from === to || doc.clips?.[to]) return doc;
  const out = clone(doc);
  if (!out.clips?.[from]) return doc;
  out.clips = Object.fromEntries(Object.entries(out.clips).map(([k, v]) => [k === from ? to : k, v]));
  return out;
}

export function updateClip(doc: ToonDoc, name: string, patch: Partial<Omit<ClipDef, "tracks">>): ToonDoc {
  return withClip(doc, name, (c) => Object.assign(c, cleanUndefined(patch)));
}

/** Every channel that can be animated on this rig (for the "add track" menu). */
export function allChannels(rig: Rig): string[] {
  const out: string[] = [];
  for (const b of rig.bones) for (const p of ["rotation", "x", "y", "scaleX", "scaleY", "squash"]) out.push(`bones.${b.id}.${p}`);
  for (const p of rig.parts) {
    if (p.type === "switch") out.push(`parts.${p.id}.variant`);
    if (p.type === "morph") for (const s of Object.keys(p.shapes)) out.push(`parts.${p.id}.morph.${s}`);
    out.push(`parts.${p.id}.opacity`);
  }
  for (const k of rig.ik) out.push(`ik.${k.id}.x`, `ik.${k.id}.y`, `ik.${k.id}.mix`);
  for (const c of Object.values(rig.controls)) out.push(`controls.${c.name}`);
  for (const b of rig.behaviors) out.push(`behaviors.${b.id}.mix`);
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const r3 = (v: number) => Math.round(v * 1000) / 1000;

function roundValue(v: Value): Value {
  if (typeof v === "number") return r3(v);
  if (Array.isArray(v)) return [r3(v[0]), r3(v[1])];
  return v;
}

function cleanUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

function pruneEmpty(doc: ToonDoc): ToonDoc {
  const out = { ...doc } as Record<string, unknown>;
  for (const k of ["ik", "physics", "colliders", "behaviors"]) {
    if (Array.isArray(out[k]) && (out[k] as unknown[]).length === 0) delete out[k];
  }
  return out as ToonDoc;
}

const near = (a: Vec2 | undefined, b: Vec2 | undefined) => !!a && !!b && Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.5;

/**
 * Moves a bone's joint (`from`) or tip (`to`) in setup space. Connected bones follow:
 * moving a joint also moves the parent's tip if they coincide; moving a tip also moves the
 * joints of children that start there. Expects setup-form bones.
 */
export function moveBoneHandle(doc: ToonDoc, id: string, handle: "from" | "to", p: Vec2): ToonDoc {
  const out = clone(doc);
  const bone = out.skeleton.find((b) => b.id === id);
  if (!bone) return doc;
  const old = bone[handle];
  const point = r2v(p);
  if (handle === "from") {
    const parent = out.skeleton.find((b) => b.id === bone.parent);
    if (parent && near(parent.to, old ?? [0, 0])) {
      parent.to = point;
      delete parent.length;
    }
    // Siblings attached at the same joint move too.
    for (const b of out.skeleton) if (b !== bone && b.parent === bone.parent && near(b.from, old)) b.from = point;
    bone.from = point;
  } else {
    for (const b of out.skeleton) if (b.parent === id && near(b.from, old)) b.from = point;
    bone.to = point;
    delete bone.length;
  }
  return out;
}

/**
 * Like `setKey`, but for looping clips a key on the loop seam (t = 0 or t = duration) is
 * mirrored to the other end when a key exists there, so cycles stay seamless.
 */
export function setKeySeamless(doc: ToonDoc, clip: string, channel: string, t: number, value: Value): ToonDoc {
  let out = setKey(doc, clip, channel, t, value);
  const def = out.clips?.[clip];
  if (!def?.loop) return out;
  const keys = trackKeys(out, clip, channel);
  const other = Math.abs(t) < EPS ? def.duration : Math.abs(t - def.duration) < EPS ? 0 : null;
  if (other !== null && keys.some((k) => Math.abs(k[0] - other) < EPS)) out = setKey(out, clip, channel, other, value);
  return out;
}
