import { describe, expect, it } from "vitest";
import { evaluateSequence, compileSequence } from "@animestudio/core";
import { check, describeKit, direct, type Kit, type Line, type Staging, volumeAt } from "../src";
import { stick } from "../../core/test/fixtures";

const rig = { hand: { F: [80, -110], B: [80, -110] }, shoulder: { F: [0, -110], B: [0, -110] }, armLength: { F: 80, B: 80 }, backShoulder: { F: [0, 0], B: [0, 0] }, extent: { front: 60, back: 40 }, height: 160 } as const;
const kit: Kit = {
  characters: { a: stick, b: stick },
  cast: { a: { name: "Ana", scale: 1, rig: rig as never }, b: { name: "Bia", aliases: ["bibi"], scale: 1, rig: rig as never } },
  sets: {
    room: { layers: [{ id: "bg", art: "<rect width='1920' height='1080' fill='#eee'/>" }], ground: { near: 900 }, marks: { door: { x: 1500 } } },
    yard: { layers: [], ground: { near: 900, far: 700 }, depthScale: 0.6, marks: { crossing: { x: 900 } } },
  },
  props: { ball: { art: () => "<circle r='20'/>", radius: 20 } },
  width: 1920,
  height: 1080,
};
const lines: Line[] = [
  { i: 0, s: 0.2, e: 1.4, text: "Oi, Bia!", speaker: "Ana", words: [{ w: "Oi,", s: 0.2, e: 0.6 }, { w: "Bia!", s: 0.7, e: 1.4 }] },
  { i: 1, s: 1.8, e: 3.0, text: "Oi, Ana.", speaker: "Bia" },
  { i: 2, s: 3.4, e: 4.6, text: "Vamos lá fora?", speaker: "Ana" },
  { i: 3, s: 5.0, e: 6.2, text: "Vamos!", speaker: "Bia" },
];
const staging: Staging = {
  blocks: [
    {
      id: "inside", set: "room", from: 0, to: 2,
      cast: [{ id: "a" }, { id: "b" }],
      props: [{ id: "bola", kind: "ball", heldBy: "a" }],
      beats: [{ line: 1, do: "walk", who: "b", to: "door", until: { line: 1, end: true } }],
    },
    { id: "outside", set: "yard", from: 2, to: 4, cast: [{ id: "a" }, { id: "b" }], beats: [{ line: 3, do: "cross", who: ["a", "b"], to: "crossing", until: { line: 3, end: true } }] },
  ],
  cuts: [{ line: 3, word: "vamos", replay: { block: "inside", line: 0 } }],
  texts: [{ line: 2, text: "Lá fora" }],
};

describe("director", () => {
  it("stages blocks as continuous scenes and tiles the timeline", () => {
    const out = direct(staging, lines, kit);
    expect(Object.keys(out.scenes)).toEqual(["inside", "outside"]);
    const total = out.sequence.shots.reduce((a, s) => a + (s.duration ?? 0), 0);
    expect(total).toBeCloseTo(lines[3].e + 0.6, 1);
    expect(out.sequence.shots.some((s) => s.muteSpeech)).toBe(true);
    expect(out.overlays[0]).toMatchObject({ text: "Lá fora", from: 3.4 });
    const seq = compileSequence(out.sequence, { scenes: Object.fromEntries(Object.entries(out.scenes).map(([id, doc]) => [id, { doc, assets: { characters: kit.characters } }])) });
    expect(() => evaluateSequence(seq, 4)).not.toThrow();
  });

  it("lip-syncs the speaker and turns listeners towards them", () => {
    const scene = direct(staging, lines, kit).scenes.inside;
    const script = scene.script as { action: string; actor?: string; at: number }[];
    expect(script.some((a) => a.action === "say" && a.actor === "a")).toBe(true);
    expect(script.some((a) => a.action === "lookAt" && a.actor === "b")).toBe(true);
  });

  it("extends a chain of held hands instead of breaking it", () => {
    const holder = { ...stick, ik: [{ id: "handF", bones: ["arm1", "arm2"], mix: 0 }, { id: "handB", bones: ["arm1", "arm2"], mix: 0 }] } as typeof stick;
    const k: Kit = { ...kit, characters: { a: holder, b: holder, c: holder }, cast: { ...kit.cast, c: { name: "Caio", scale: 1.3, rig: rig as never } } };
    const s: Staging = {
      blocks: [{
        id: "x", set: "room", from: 0, to: 4,
        cast: [{ id: "a" }, { id: "b" }, { id: "c" }],
        beats: [{ line: 1, do: "hold", who: ["a", "b"] }, { line: 2, do: "hold", who: ["b", "c"] }],
      }],
    };
    const out = direct(s, lines, k);
    expect(out.issues.filter((i) => i.severity === "error")).toEqual([]);
    const script = out.scenes.x.script as { action: string; actor?: string; channel?: string }[];
    // a's arm is re-aimed when b steps towards c, so a and b stay hand in hand.
    expect(script.filter((x) => x.action === "set" && x.actor === "a" && x.channel === "ik.handF.x").length).toBe(2);
  });

  it("dresses the cast per block and mid-block (wardrobe controls)", () => {
    const dressed = {
      ...stick,
      meta: { ...(stick as { meta?: object }).meta, wardrobe: ["outfit", "backpack"] },
      controls: { ...stick.controls, outfit: { type: "pose", poses: { tee: {}, swim: {} } }, backpack: { type: "pose", poses: { on: {}, off: {} } }, mood: { type: "pose", poses: { a: {} } } },
    } as unknown as typeof stick;
    const k: Kit = { ...kit, characters: { a: dressed, b: stick } };
    expect(describeKit(k).cast.a.wear).toEqual({ outfit: ["tee", "swim"], backpack: ["on", "off"] });
    const s: Staging = {
      blocks: [{
        id: "x", set: "room", from: 0, to: 4,
        cast: [{ id: "a", wear: { outfit: "swim" } }, { id: "b" }],
        beats: [{ line: 2, do: "wear", who: "a", wear: { backpack: "off" } }, { line: 3, do: "wear", who: "a", control: "outfit", value: "swimm" }],
      }],
    };
    const out = direct(s, lines, k);
    const poses = (out.scenes.x.script as { action: string; actor?: string; control?: string; value?: string; at: number }[]).filter((x) => x.action === "pose" && x.actor === "a" && x.control !== "emotion" && x.control !== "view");
    expect(poses.map((p) => [p.control, p.value])).toEqual([["outfit", "swim"], ["backpack", "off"]]);
    expect(poses[1].at).toBeCloseTo(lines[2].s, 2);
    const msgs = check(s, lines, k).map((i) => i.message).join("\n");
    expect(msgs).toContain(`a's "outfit" has no "swimm" (did you mean "swim"`);
    const bad = check({ blocks: [{ ...s.blocks[0], cast: [{ id: "a", wear: { hat: "on" } }, { id: "b", wear: { outfit: "tee" } }], beats: [] }] }, lines, k).map((i) => i.message).join("\n");
    expect(bad).toContain('a has no wardrobe control "hat"');
    expect(bad).toContain("(the rig has none)");
  });

  it("rides, falls, gets up, sits and lies down", () => {
    const bike = {
      format: "toon", version: 1, name: "bike",
      skeleton: [{ id: "root" }, { id: "frame", parent: "root", from: [0, -20], to: [40, -20] }],
      parts: [{ id: "frame", type: "rigid", bone: "frame", art: "<rect x='-40' y='-50' width='80' height='40'/>" }],
      anchors: { seat: { bone: "frame", at: [-10, -60] }, handlebar: { bone: "frame", at: [30, -90] } },
      clips: { drive: { duration: 1, loop: true, stride: 200, tracks: { "bones.frame.y": [[0, 0], [1, 0]] } } },
    };
    const chair = { format: "toon", version: 1, name: "chair", skeleton: [{ id: "root" }], parts: [{ id: "c", type: "rigid", bone: "root", art: "<rect x='-20' y='-50' width='40' height='50'/>" }], anchors: { seat: { bone: "root", at: [0, -50] } } };
    const holder = { ...stick, ik: [{ id: "handF", bones: ["arm1", "arm2"], mix: 0 }, { id: "handB", bones: ["arm1", "arm2"], mix: 0 }] } as typeof stick;
    const k: Kit = {
      ...kit,
      characters: { a: holder, b: stick, bike: bike as never, chair: chair as never },
      sets: { ...kit.sets, room: { ...kit.sets.room, marks: { ...kit.sets.room.marks, bench: { x: 400, seat: 60 } } } },
      vehicles: { bike: { character: "bike", scale: 1 } },
      furniture: { chair: { character: "chair", scale: 1 } },
    };
    const s: Staging = {
      blocks: [{
        id: "x", set: "room", from: 0, to: 4,
        cast: [{ id: "a" }, { id: "b" }],
        vehicles: [{ id: "bike1", kind: "bike", at: "door" }],
        furniture: [{ id: "chair1", kind: "chair", at: { mark: "door", dx: -400 } }],
        beats: [
          { line: 0, do: "ride", who: "a", vehicle: "bike1", to: { mark: "door", dx: 200 }, until: { line: 0, end: true } },
          { line: 1, do: "fall", who: "a" },
          { line: 2, do: "getUp", who: "a" },
          { line: 2, do: "sit", who: "b", on: "bench" },
          { line: 3, do: "sit", who: "a", on: "chair1" },
          { line: 3, do: "lie", who: "b", on: "ground" },
        ],
      }],
    };
    // Facing the audience on the set's own sofa (two seats), side by side without overlap errors.
    const sofa = { ...chair, name: "sofa", anchors: { seat: { bone: "root", at: [0, -50] }, seat2: { bone: "root", at: [-90, -50] } } };
    const k2: Kit = { ...k, characters: { ...k.characters, a: stick, sofa: sofa as never }, furniture: { ...k.furniture, sofa: { character: "sofa", scale: 1 } }, sets: { ...k.sets, room: { ...k.sets.room, furniture: [{ id: "couch", kind: "sofa", at: "door" }] } } };
    const front = direct({ blocks: [{ id: "x", set: "room", from: 0, to: 4, cast: [{ id: "a" }, { id: "b" }], beats: [{ line: 0, do: "sit", who: ["a", "b"], on: "couch", view: "front" }] }] }, lines, k2);
    expect(front.issues.filter((i) => i.severity === "error")).toEqual([]);
    const fs = front.scenes.x.script as { action: string; actor?: string; anchor?: string; value?: string; control?: string }[];
    expect(fs.filter((x) => x.action === "mount").map((x) => x.anchor)).toEqual(["seat", "seat2"]);
    expect(describeKit(k2).sets.room.furniture).toEqual({ couch: "sofa" });
    const out = direct(s, lines, k);
    expect(out.issues.filter((i) => i.severity === "error")).toEqual([]);
    const script = out.scenes.x.script as { action: string; actor?: string; on?: string | null; chain?: string; channel?: string }[];
    expect(script.filter((x) => x.action === "mount" && x.actor === "a").map((x) => x.on)).toEqual(["bike1", null, "chair1"]);
    expect(script.some((x) => x.action === "reach" && x.actor === "a" && x.chain === "handF")).toBe(true);
    expect(script.some((x) => x.action === "walkTo" && x.actor === "bike1")).toBe(true);
    expect(script.some((x) => x.action === "set" && x.actor === "b" && x.channel === "rotation")).toBe(true);
    expect(describeKit(k).rides).toEqual({ bike: { wear: {} } });
    expect(describeKit(k).sets.room.seats).toEqual({ bench: { seat: 60 } });
    const bad = check({ blocks: [{ ...s.blocks[0], beats: [{ line: 0, do: "sit", who: "a", on: "door" }, { line: 1, do: "dismount", who: "b" }] }] }, lines, k).map((i) => i.message).join("\n");
    expect(bad).toContain('cannot sit on mark "door": it has no "seat" height');
    expect(bad).toContain("b cannot dismount: not riding anything then");
    const compiled = compileSequence(out.sequence, { scenes: { x: { doc: out.scenes.x, assets: { characters: k.characters } } } });
    expect(() => evaluateSequence(compiled, 2.5)).not.toThrow();
  });

  it("sleeps: lying with Zzz, or tucked in for rigs with a tuck control", () => {
    const shell = { ...stick, controls: { ...stick.controls, tuck: { type: "pose", poses: { out: {}, in: { "parts.arm.opacity": -1 } } } } } as unknown as typeof stick;
    const k: Kit = { ...kit, characters: { a: shell, b: stick } };
    const out = direct({ blocks: [{ id: "x", set: "room", from: 0, to: 4, cast: [{ id: "a" }, { id: "b" }], beats: [{ line: 0, do: "sleep", who: ["a", "b"] }, { line: 3, do: "getUp", who: ["a", "b"] }] }] }, lines, k);
    expect(out.issues.filter((i) => i.severity === "error")).toEqual([]);
    const script = out.scenes.x.script as { action: string; actor?: string; control?: string; value?: unknown; channel?: string; type?: string }[];
    expect(script.filter((x) => x.action === "pose" && x.control === "tuck").map((x) => x.value)).toEqual(["in", "out"]);
    expect(script.some((x) => x.actor === "a" && x.channel === "rotation")).toBe(false);
    expect(script.some((x) => x.actor === "b" && x.channel === "rotation")).toBe(true);
    expect(script.filter((x) => x.action === "fx" && x.type === "zzz").length).toBeGreaterThan(2);
  });

  it("flies in, flies to a place and away; only rigs that fly", () => {
    const bird = { ...stick, meta: { canFly: true } } as unknown as typeof stick;
    const k: Kit = { ...kit, characters: { a: bird, b: stick } };
    const s: Staging = {
      blocks: [{
        id: "x", set: "room", from: 0, to: 4,
        cast: [{ id: "a", enter: { line: 0, from: "top", fly: true } }, { id: "b" }],
        beats: [{ line: 2, do: "fly", who: "a", to: "door" }, { line: 3, do: "fly", who: "a", to: "offRight" }, { line: 3, do: "fly", who: "b", to: "up" }],
      }],
    };
    const out = direct(s, lines, k);
    expect(out.issues.map((i) => i.message)).toContain('b cannot fly (no "fly" clip nor meta.canFly on the rig)');
    const script = out.scenes.x.script as { action: string; actor?: string; channel?: string; value?: unknown }[];
    const ys = script.filter((x) => x.actor === "a" && x.channel === "y").map((x) => x.value as number);
    expect(Math.min(...ys)).toBeLessThan(0); // comes from above the frame
    expect(ys).toContain(900); // lands on the ground
    expect(describeKit(k).cast.a.canFly).toBe(true);
  });

  it("covers sleepers with the bed's blanket; fixtures loop their clip at their parallax", () => {
    const bedRig = { format: "toon", version: 1, name: "bed", meta: { cover: { character: "blanket" } }, skeleton: [{ id: "root" }], parts: [{ id: "b", type: "rigid", bone: "root", art: "<rect width='200' height='40'/>" }], anchors: { bed: { bone: "root", at: [0, -40] } } };
    const blanket = { format: "toon", version: 1, name: "blanket", skeleton: [{ id: "root" }], parts: [{ id: "c", type: "rigid", bone: "root", art: "<rect width='150' height='30'/>" }] };
    const clock = { format: "toon", version: 1, name: "clock", skeleton: [{ id: "root" }, { id: "hand", parent: "root", from: [0, 0], to: [0, -20] }], parts: [{ id: "h", type: "rigid", bone: "hand", art: "<path d='M0 0V-20'/>" }], clips: { loop: { duration: 60, loop: true, tracks: { "bones.hand.rotation": [[0, 0, "linear"], [60, 360]] } } } };
    const k: Kit = {
      ...kit,
      characters: { ...kit.characters, bed: bedRig as never, blanket: blanket as never, clock: clock as never },
      furniture: { bed: { character: "bed", scale: 1 } },
      sets: { ...kit.sets, room: { ...kit.sets.room, fixtures: [{ id: "tower", character: "clock", mark: "door", parallax: 0.6 }] } },
    };
    const out = direct({ blocks: [{ id: "x", set: "room", from: 0, to: 4, cast: [{ id: "a" }, { id: "b" }], furniture: [{ id: "bed1", kind: "bed", at: "door" }], beats: [{ line: 1, do: "sleep", who: "a", on: "bed1" }, { line: 3, do: "getUp", who: "a" }] }] }, lines, k);
    expect(out.issues.filter((i) => i.severity === "error")).toEqual([]);
    const script = out.scenes.x.script as { action: string; actor?: string; channel?: string; value?: unknown; clip?: string }[];
    expect(script.filter((x) => x.actor === "bed1Cover" && x.channel === "opacity").map((x) => x.value)).toEqual([0, 1, 0]);
    expect(script.some((x) => x.actor === "tower" && x.action === "play" && x.clip === "loop")).toBe(true);
    // The blanket lies over the sleeper's face area without a "covered face" report.
    expect(check({ blocks: [{ id: "x", set: "room", from: 0, to: 4, cast: [{ id: "a" }, { id: "b" }], furniture: [{ id: "bed1", kind: "bed", at: "door" }], beats: [{ line: 1, do: "sleep", who: "a", on: "bed1" }] }] }, lines, k).map((i) => i.message).join("\n")).not.toContain("drawn over");
    expect((out.scenes.x.actors as { id: string; parallax?: number }[]).find((x) => x.id === "tower")?.parallax).toBe(0.6);
    // A clock showing the time of day follows the light mood.
    const dial = { ...clock, meta: { timeOfDay: true }, parts: [...clock.parts, { id: "light", type: "switch", bone: "root", variants: { morning: "<g/>", noon: "<g/>", night: "<g/>" }, default: "morning" }] };
    const k2: Kit = { ...k, characters: { ...k.characters, clock: dial as never } };
    const lit = direct({ blocks: [{ id: "x", set: "room", from: 0, to: 4, cast: [{ id: "a" }], beats: [{ line: 1, do: "light", mood: "day" }, { line: 2, do: "light", mood: "night" }, { line: 3, do: "light", mood: "evening" }] }] }, lines, k2);
    const sets = (lit.scenes.x.script as { actor?: string; channel?: string; value?: unknown }[]).filter((x) => x.actor === "tower" && x.channel === "parts.light.variant").map((x) => x.value);
    expect(sets).toEqual(["noon", "noon", "night"]); // the block starts in "day"
    expect(lit.issues.map((i) => i.message).join("\n")).toContain('has nothing for "evening"');
  });

  it("keeps those who enter later invisible until they come in", () => {
    const out = direct({ blocks: [{ id: "x", set: "room", from: 0, to: 4, cast: [{ id: "a" }, { id: "b", enter: { line: 2, from: "left", run: true } }] }] }, lines, kit);
    const op = (out.scenes.x.tracks as Record<string, [number, number][]>)["actors.b.opacity"];
    expect(op[0]).toEqual([0, 0]);
    expect(op[op.length - 1]).toEqual([lines[2].s, 1]);
  });

  it("hits: dash, punch, the target thrown inside the set and knocked out", () => {
    const fighter = { ...stick, controls: { ...stick.controls, emotion: { type: "pose", poses: { scared: {}, dead: {} } } }, clips: { ...stick.clips, punch: { duration: 0.9, tracks: {} }, knocked: { duration: 0.6, tracks: {} } } } as unknown as typeof stick;
    const k: Kit = { ...kit, characters: { a: fighter, b: fighter }, sets: { ...kit.sets, room: { ...kit.sets.room, bounds: [0, 0, 1920, 1080] } } };
    const out = direct({ blocks: [{ id: "x", set: "room", from: 0, to: 4, cast: [{ id: "a", at: "door", offset: -6 }, { id: "b", at: "door" }], beats: [{ line: 1, do: "hit", who: "a", target: "b", ko: true }] }] }, lines, k);
    expect(out.issues.filter((i) => i.severity === "error")).toEqual([]);
    const script = out.scenes.x.script as { action: string; actor?: string; type?: string; clip?: string; value?: unknown; channel?: string }[];
    expect(script.some((x) => x.action === "play" && x.actor === "a" && x.clip === "punch")).toBe(true);
    expect(script.filter((x) => x.action === "fx").map((x) => x.type)).toEqual(expect.arrayContaining(["impactFrame", "burst", "caption", "ghost"]));
    expect(script.some((x) => x.action === "pose" && x.actor === "b" && x.value === "dead")).toBe(true);
    const xs = script.filter((x) => x.actor === "b" && x.channel === "x").map((x) => x.value as number);
    expect(Math.max(...xs)).toBeLessThan(1920);
  });

  it("plays front gestures as hand positions and comes back to the table", () => {
    const front = { ...stick, anchors: { ...stick.anchors, face: { bone: "head", at: [0, -150] } }, ik: [{ id: "handF", bones: ["arm1", "arm2"], mix: 0 }], controls: { ...stick.controls, view: { type: "pose", poses: { profile: {}, front: {} } } } } as unknown as typeof stick;
    const tableRig = { format: "toon", version: 1, name: "t", skeleton: [{ id: "root" }], parts: [{ id: "t", type: "rigid", bone: "root", art: "<rect width='300' height='20'/>" }], anchors: { top: { bone: "root", at: [0, -90] } } };
    const k: Kit = { ...kit, characters: { a: front, b: stick, t: tableRig as never }, sets: { ...kit.sets, room: { ...kit.sets.room, fixtures: [{ id: "tbl", character: "t", mark: "door" }] } } };
    const out = direct({ blocks: [{ id: "x", set: "room", from: 0, to: 4, cast: [{ id: "a" }, { id: "b" }], beats: [
      { line: 0, do: "view", who: "a", value: "front" },
      { line: 0, offset: 0.2, do: "hands", who: "a", on: "tbl" },
      { line: 1, do: "gesture", who: "a", clip: "facepalm" },
      { line: 2, do: "camera", type: "close", who: "a" },
    ] }] }, lines, k);
    expect(out.issues.filter((i) => i.severity === "error")).toEqual([]);
    const reaches = (out.scenes.x.script as { action: string; actor?: string; target?: unknown }[]).filter((x) => x.action === "reach" && x.actor === "a").map((x) => x.target);
    // On the table, up to the face, back on the table.
    expect(reaches.length).toBe(3);
    expect(reaches[2]).toEqual(reaches[0]);
    expect((out.scenes.x.script as { action: string; on?: string }[]).some((x) => x.action === "camera" && x.on === "face")).toBe(true);
  });

  it("checks the picture: a face covered by scenery, a character past the edge of the set", () => {
    const withHead = { ...stick } as typeof stick;
    // A bottle on a table, standing right in front of where "a" stands.
    const tableRig = { format: "toon", version: 1, name: "t", skeleton: [{ id: "root" }], parts: [{ id: "t", type: "rigid", bone: "root", art: "<rect x='-300' y='-90' width='600' height='90'/><rect x='-200' y='-190' width='400' height='110'/>" }] };
    const k: Kit = { ...kit, characters: { a: withHead, b: withHead, t: tableRig as never }, sets: { ...kit.sets, room: { ...kit.sets.room, bounds: [0, 0, 1920, 1080], fixtures: [{ id: "tbl", character: "t", mark: "door", z: 5 }] } } };
    const msgs = check({ blocks: [{ id: "x", set: "room", from: 0, to: 4, cast: [{ id: "a", at: "door" }, { id: "b", at: "door", offset: 4 }], beats: [{ line: 2, do: "walk", who: "b", to: { mark: "door", dx: 900 } }] }] }, lines, k).map((i) => i.message).join("\n");
    expect(msgs).toContain("tbl is drawn over a's face");
    expect(msgs).toContain("b goes past the edge of set");
  });

  it("plays the kit's sounds on actions and ducks the music under the dialogue", () => {
    const k: Kit = { ...kit, sounds: { whip: "whoosh.mp3", pop: { src: "pop.mp3", volume: 0.5 } } };
    const s: Staging = {
      blocks: [{ id: "x", set: "room", from: 0, to: 4, cast: [{ id: "a" }, { id: "b" }], beats: [{ line: 1, do: "camera", type: "whip", who: "b" }, { line: 2, do: "sound", name: "pop" }] }],
      music: [{ src: "theme.mp3", volume: 0.6, duck: 0.2 }],
    };
    const out = direct(s, lines, k);
    const sounds = (out.scenes.x.script as { action: string; audio?: string; volume?: number }[]).filter((x) => x.action === "sound");
    expect(sounds.map((x) => x.audio)).toEqual(["whoosh.mp3", "pop.mp3"]);
    expect(sounds[1].volume).toBe(0.5);
    const m = out.music[0];
    expect(volumeAt(m.volume, (lines[1].s + lines[1].e) / 2)).toBeCloseTo(0.2);
    expect(volumeAt(m.volume, m.start + 0.5)).toBeGreaterThan(0);
    expect(volumeAt(m.volume, m.end)).toBe(0);
  });

  it("gives, high-fives, hugs and carries", () => {
    const person = { ...stick, ik: [{ id: "handF", bones: ["arm1", "arm2"], mix: 0 }, { id: "handB", bones: ["arm1", "arm2"], mix: 0 }] } as unknown as typeof stick;
    const k: Kit = { ...kit, characters: { a: person, b: person }, props: { ball: kit.props.ball } };
    const out = direct({ blocks: [{ id: "x", set: "room", from: 0, to: 4, cast: [{ id: "a" }, { id: "b", at: "door" }], props: [{ id: "bola", kind: "ball", heldBy: "a" }], beats: [
      { line: 0, do: "give", who: "a", to: "b", prop: "bola" },
      { line: 1, do: "highFive", who: ["a", "b"] },
      { line: 2, do: "hug", who: ["a", "b"] },
      { line: 3, do: "carry", who: "a", target: "b", until: { line: 3, end: true } },
    ] }] }, lines, k);
    expect(out.issues.filter((i) => i.severity === "error")).toEqual([]);
    const script = out.scenes.x.script as { action: string; actor?: string; prop?: string; on?: string | null }[];
    expect(script.filter((x) => x.action === "grab").map((x) => x.actor)).toEqual(["a", "b"]);
    expect(script.filter((x) => x.action === "reach" && x.actor === "b").length).toBeGreaterThan(4);
    expect(script.filter((x) => x.action === "mount" && x.actor === "b").map((x) => x.on)).toEqual(["a", null]);
  });

  it("does not report overlaps of characters still waiting to enter", () => {
    const out = direct({ blocks: [{ id: "x", set: "room", from: 0, to: 4, cast: [{ id: "a", at: "door" }, { id: "b", at: "door", enter: { line: 2, from: "left" } }] }] }, lines, kit);
    expect(out.issues.map((i) => i.message).join("\n")).not.toContain("cover each other");
  });

  it("reports staging problems", () => {
    const bad: Staging = { blocks: [{ id: "x", set: "room", from: 0, to: 4, cast: [{ id: "zed" }, { id: "a" }], beats: [{ line: 1, do: "walk", who: "a", to: "nowhere" }] }] };
    const issues = check(bad, lines, kit).map((i) => i.message).join("\n");
    expect(issues).toContain('"zed" is not in the cast');
    expect(issues).toContain('unknown mark "nowhere"');
    expect(issues).toContain("speaks but is not in block");
    const more: Staging = {
      blocks: [{ id: "x", set: "room", from: 0, to: 4, cast: [{ id: "a" }, { id: "b" }], props: [{ id: "ball", kind: "ball" }], beats: [{ line: 1, do: "gesture", who: "bento", clip: "wave" }, { line: 2, do: "pick", who: "a", prop: "ballX" }] }],
      texts: [{ line: 1, text: "one" }, { line: 1, text: "two" }],
      missing: [{ kind: "set", name: "beach", why: "story at the beach" }],
    };
    const more2 = check(more, lines, kit).map((i) => i.message).join("\n");
    expect(more2).toContain('"bento" is not in block "x" and not in the kit');
    expect(more2).toContain('unknown prop "ballX" (did you mean "ball"');
    expect(more2).toContain("at most one text at a time");
  });
});
