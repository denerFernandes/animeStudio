import { describe, expect, it } from "vitest";
import { evaluateSequence, compileSequence } from "@animestudio/core";
import { check, describeKit, direct, type Kit, type Line, type Staging } from "../src";
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
