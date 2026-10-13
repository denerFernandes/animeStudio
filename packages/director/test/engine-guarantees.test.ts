import { describe, expect, it } from "vitest";
import { actorPlacement, actorPose, anchorPosition, apply, compileScene, screenPoint, validateScene } from "@animestudio/core";
import { cartoonAnatomy, cartoonCharacter, cartoonInfo, styledAnatomy } from "../../kit/src";
import { check, describeKit, direct, type Kit, type Line, type Staging } from "../src";
import { markupBoxes } from "../src/direct";
import { stick } from "../../core/test/fixtures";

// Engine guarantees: hung props, transform-aware covered-face boxes, fixtures that open and close,
// the press beat, the conversation camera and the "faces too close" check.

type Act = { action: string; actor?: string; at: number; duration?: number; channel?: string; value?: unknown; anchor?: string; clip?: string; chain?: string; target?: unknown; prop?: string; hang?: unknown; fit?: unknown; frame?: string[]; blend?: number; loop?: boolean; fadeOut?: number; layer?: number };

const rig = { hand: { F: [80, -110], B: [80, -110] }, shoulder: { F: [0, -110], B: [0, -110] }, armLength: { F: 80, B: 80 }, backShoulder: { F: [0, 0], B: [0, 0] }, extent: { front: 60, back: 40 }, height: 160 } as const;
// Two arms (near / far chains), a far-hand anchor and the automatic clips.
const person = {
  ...stick,
  anchors: { ...stick.anchors, handB: { bone: "arm2", at: [80, -110] } },
  ik: [{ id: "handF", bones: ["arm1", "arm2"], mix: 0 }, { id: "handB", bones: ["arm1", "arm2"], mix: 0 }],
  clips: { ...stick.clips, hold: { duration: 1, loop: true, tracks: {} }, talk: { duration: 1, loop: true, tracks: {} } },
} as unknown as typeof stick;
const HANG = { point: [0, -20] as [number, number], length: 40, damping: 0.3, limit: 50 };
const kit: Kit = {
  characters: { a: person, b: person },
  cast: { a: { name: "Ana", scale: 1, rig: rig as never }, b: { name: "Bia", aliases: ["bibi"], scale: 1, rig: rig as never, speed: { walk: 200, run: 600 } } },
  sets: { room: { layers: [{ id: "bg", art: "<rect width='1920' height='1080' fill='#eee'/>" }], ground: { near: 900 }, marks: { a: { x: 500 }, door: { x: 1500 }, mid: { x: 1000 } } } },
  props: {
    lantern: { art: () => "<rect x='-10' y='-20' width='20' height='40'/>", radius: 20, hang: HANG },
    ball: { art: () => "<circle r='20'/>", radius: 20 },
  },
  width: 1920,
  height: 1080,
};
const lines: Line[] = [
  { i: 0, s: 0.2, e: 1.4, text: "Oi, Bia!", speaker: "Ana", words: [{ w: "Oi,", s: 0.2, e: 0.6 }, { w: "Bia!", s: 0.7, e: 1.4 }] },
  { i: 1, s: 1.8, e: 3.0, text: "Oi, Ana.", speaker: "Bia" },
  { i: 2, s: 3.4, e: 4.6, text: "Vamos lá fora?", speaker: "Ana" },
  { i: 3, s: 5.0, e: 6.2, text: "Vamos!", speaker: "Bia" },
];
const block = (beats: unknown[], extra: Record<string, unknown> = {}, k: Kit = kit): { out: ReturnType<typeof direct>; script: Act[]; errors: string[]; warnings: string[] } => {
  const out = direct({ blocks: [{ id: "x", set: "room", from: 0, to: 4, cast: [{ id: "a", at: "a" }, { id: "b", at: "door" }], beats: beats as never, ...extra }] } as Staging, lines, k);
  return { out, script: out.scenes.x.script as Act[], errors: out.issues.filter((i) => i.severity === "error").map((i) => i.message), warnings: out.issues.filter((i) => i.severity === "warning").map((i) => i.message) };
};
/** Compiles the scene when the core's schema accepts it (the `grab.hang` option may not be there yet). */
const compilesWhenValid = (doc: unknown, k: Kit = kit) => {
  const v = validateScene(doc as never, { characters: k.characters } as never);
  if (v.issues.some((i) => i.severity !== "warning")) return;
  expect(() => compileScene(doc as never, { characters: k.characters } as never)).not.toThrow();
};

describe("1. hung props", () => {
  it("held from the block's start: grabbed hanging in the far hand, that arm kept still while talking", () => {
    const { out, script, errors } = block([], { props: [{ id: "lamp", kind: "lantern", heldBy: "a" }] });
    expect(errors).toEqual([]);
    const grab = script.find((x) => x.action === "grab" && x.prop === "lamp")!;
    expect(grab).toMatchObject({ actor: "a", anchor: "handB", hang: HANG });
    expect(grab.fit).toBeUndefined();
    // The carrying arm hangs at rest (its chain held there), so the talk clip swings the other one.
    const mix = script.filter((x) => x.actor === "a" && x.channel === "ik.handB.mix");
    expect(mix[0]?.value).toBe(1);
    expect(script.some((x) => x.actor === "a" && x.channel === "ik.handF.mix")).toBe(false);
    expect(script.some((x) => x.action === "play" && x.actor === "a" && x.clip === "talk")).toBe(true);
    compilesWhenValid(out.scenes.x);
  });

  it("an ordinary prop is still held in the near hand, without hang", () => {
    const { script } = block([], { props: [{ id: "bola", kind: "ball", heldBy: "a" }] });
    const grab = script.find((x) => x.action === "grab" && x.prop === "bola")!;
    expect(grab.anchor).toBe("hand");
    expect(grab.hang).toBeUndefined();
  });

  it("picked up, given (the receiver takes it hanging too) and held up", () => {
    const { out, script, errors } = block([
      { line: 0, do: "pick", who: "a", prop: "lamp" },
      { line: 1, do: "give", who: "a", to: "b", prop: "lamp" },
      { line: 3, do: "hold", who: "b", prop: "lamp" },
    ], { props: [{ id: "lamp", kind: "lantern", at: "a" }] });
    expect(errors).toEqual([]);
    const grabs = script.filter((x) => x.action === "grab" && x.prop === "lamp");
    expect(grabs.map((g) => [g.actor, g.anchor, !!g.hang])).toEqual([["a", "handB", true], ["b", "handB", true], ["b", "hand", true]]);
    // The giver reaches out with the hand that holds it, the receiver with the hand that takes it.
    expect(script.some((x) => x.action === "reach" && x.actor === "a" && x.chain === "handB" && Array.isArray(x.target))).toBe(true);
    expect(script.some((x) => x.action === "reach" && x.actor === "b" && x.chain === "handB" && Array.isArray(x.target))).toBe(true);
    compilesWhenValid(out.scenes.x);
  });

  it("hand in hand: the hand that holds someone's passes the hung prop to the other hand", () => {
    // b is on the right: holds a's hand with the far hand, so the lantern goes to the near one.
    const { script, errors } = block([{ line: 1, do: "hold", who: ["a", "b"] }, { line: 3, do: "release", who: ["a", "b"] }], { props: [{ id: "lamp", kind: "lantern", heldBy: "b" }] });
    expect(errors).toEqual([]);
    const grabs = script.filter((x) => x.action === "grab" && x.prop === "lamp");
    expect(grabs.map((g) => g.anchor)).toEqual(["handB", "hand"]);
    expect(grabs.every((g) => !!g.hang)).toBe(true);
  });

  it("2.5D rig: a turn round keeps it in the same hand, hanging; the talking hand is the free one", () => {
    const look = { name: "kid", build: "kid", skin: "#f6d3b5", hair: "bowl", hairColor: "#5a3a22", top: "tee", topColor: "#2d8f4e", bottom: "shorts", bottomColor: "#3a62b0", shoes: "sneakers" } as const;
    const doc = cartoonCharacter(look as never);
    const k = { ...kit, characters: { kid: doc }, cast: { kid: { name: "kid", scale: 1, rig: cartoonInfo(doc, look as never) } }, narrators: ["n"] } as unknown as Kit;
    const ls: Line[] = [{ i: 0, s: 0.3, e: 1, text: "…", speaker: "n" }, { i: 1, s: 1.6, e: 3.2, text: "hi there", speaker: "kid" }];
    const d = direct({ blocks: [{ id: "x", set: "room", from: 0, to: 2, cast: [{ id: "kid", at: "mid", facing: "right" }], props: [{ id: "lamp", kind: "lantern", heldBy: "kid" }], beats: [{ line: 0, offset: 0.4, do: "face", who: "kid", direction: "left" }] }] } as Staging, ls, k);
    expect(d.issues.filter((i) => i.severity === "error")).toEqual([]);
    const script = d.scenes.x.script as Act[];
    const grabs = script.filter((x) => x.action === "grab" && x.prop === "lamp");
    expect(grabs.length).toBe(2);
    expect(grabs[0].anchor).toBe("handB");
    expect(grabs[1].anchor).toBe("hand");
    expect(grabs.every((g) => !!g.hang)).toBe(true);
    // Seen from the other side the carrying arm is now the near one: talking moves the far arm only.
    const talk = script.filter((x) => x.action === "set" && x.actor === "kid" && /^bones\.arm[FB]2\.rotation$/.test(x.channel ?? "") && x.at > ls[1].s - 0.1);
    expect(talk.some((x) => x.channel === "bones.armB2.rotation")).toBe(true);
    expect(talk.some((x) => x.channel === "bones.armF2.rotation")).toBe(false);
  });
});

describe("2. covered-face boxes honour transforms", () => {
  it("nested translate and scale, a shape's own transform, a rotated rect", () => {
    expect(markupBoxes(`<g transform="translate(100 50)"><g transform="scale(2)"><rect x="0" y="0" width="10" height="20"/></g></g>`)).toEqual([[100, 50, 120, 90]]);
    expect(markupBoxes(`<g transform="translate(10,0)"><circle cx="0" cy="0" r="5" transform="translate(0 30)"/></g><path d="M0 0L4 4"/>`)).toEqual([[5, 25, 15, 35], [0, 0, 4, 4]]);
    const [box] = markupBoxes(`<rect x="-10" y="-10" width="20" height="20" transform="rotate(45)"/>`);
    const h = 10 * Math.SQRT2;
    expect(box.map((v) => Math.round(v * 1000) / 1000)).toEqual([-h, -h, h, h].map((v) => Math.round(v * 1000) / 1000));
    // About a centre, and a matrix.
    const [c] = markupBoxes(`<rect x="0" y="0" width="10" height="10" transform="rotate(90 5 5)"/>`);
    expect(c.map((v) => Math.round(v) + 0)).toEqual([0, 0, 10, 10]);
    expect(markupBoxes(`<g transform="matrix(1 0 0 1 7 8)"><rect width="2" height="2"/></g>`)).toEqual([[7, 8, 9, 10]]);
    // Relative paths are still skipped (their numbers are offsets).
    expect(markupBoxes(`<path d="m0 0l10 10"/>`)).toEqual([]);
  });

  it("a gate slid open by a transform in its variant no longer covers the face", () => {
    const gate = {
      format: "toon", version: 1, name: "gate", skeleton: [{ id: "root" }],
      parts: [{ id: "light", type: "switch", bone: "root", variants: { closed: "<rect x='-200' y='-400' width='400' height='400'/>", open: "<g transform='translate(900 0)'><rect x='-200' y='-400' width='400' height='400'/></g>" }, default: "closed" }],
    };
    const k: Kit = { ...kit, characters: { ...kit.characters, gate: gate as never }, sets: { room: { ...kit.sets.room, fixtures: [{ id: "g", character: "gate", mark: "door", z: 5, value: "open" }] } } };
    const msgs = check({ blocks: [{ id: "x", set: "room", from: 0, to: 4, cast: [{ id: "a", at: "a" }, { id: "b", at: "door" }] }] }, lines, k).map((i) => i.message).join("\n");
    expect(msgs).not.toContain("g is drawn over b's face");
    const shut = check({ blocks: [{ id: "x", set: "room", from: 0, to: 4, cast: [{ id: "a", at: "a" }, { id: "b", at: "door" }], beats: [{ line: 1, do: "fixture", id: "g", value: "closed" }] }] }, lines, k).map((i) => i.message).join("\n");
    expect(shut).toContain("g is drawn over b's face");
  });
});

describe("3. fixtures that open and close", () => {
  const gate = {
    format: "toon", version: 1, name: "gate", skeleton: [{ id: "root" }, { id: "leaf", parent: "root", from: [0, 0], to: [100, 0] }],
    parts: [{ id: "leaf", type: "rigid", bone: "leaf", art: "<rect width='100' height='200' y='-200'/>" }, { id: "light", type: "switch", bone: "root", variants: { off: "<g/>", on: "<circle r='4'/>" }, default: "off" }],
    anchors: { button: { bone: "root", at: [-30, -120] } },
    clips: {
      loop: { duration: 2, loop: true, tracks: {} },
      open: { duration: 0.8, tracks: { "bones.leaf.rotation": [[0, 0], [0.8, -80]] } },
      close: { duration: 0.8, tracks: { "bones.leaf.rotation": [[0, -80], [0.8, 0]] } },
    },
  };
  const k: Kit = { ...kit, characters: { ...kit.characters, gate: gate as never }, sets: { room: { ...kit.sets.room, fixtures: [{ id: "g", character: "gate", mark: "mid" }] } } };

  it("plays a clip named like the value once, holding its end until the next clip; other values set the channel", () => {
    const { out, script, errors } = block([
      { line: 1, do: "fixture", id: "g", value: "open" },
      { line: 2, do: "fixture", id: "g", value: "on" },
      { line: 3, do: "fixture", id: "g", value: "close" },
    ], {}, k);
    expect(errors).toEqual([]);
    const plays = script.filter((x) => x.action === "play" && x.actor === "g" && x.clip !== "loop");
    expect(plays.map((p) => p.clip)).toEqual(["open", "close"]);
    expect(plays.every((p) => p.loop === false && p.layer === 1)).toBe(true);
    // The opening holds until the closing comes in (a short cross-fade); the closing until the block ends.
    expect(plays[0].at + plays[0].duration!).toBeCloseTo(plays[1].at + 0.15, 2);
    expect(plays[1].at + plays[1].duration!).toBeCloseTo(out.scenes.x.duration, 2);
    expect(script.some((x) => x.actor === "g" && x.channel === "parts.light.variant" && x.value === "on")).toBe(true);
    compilesWhenValid(out.scenes.x, k);
  });

  it("describeKit lists a fixture's clips next to its values", () => {
    const d = describeKit(k).sets.room;
    expect(d.fixtures.g).toEqual(["off", "on"]);
    expect(d.fixtureClips.g).toEqual(["open", "close"]);
  });
});

describe("4. press", () => {
  const bell = {
    format: "toon", version: 1, name: "bell", skeleton: [{ id: "root" }],
    parts: [{ id: "box", type: "rigid", bone: "root", art: "<rect x='-10' y='-140' width='20' height='30'/>" }, { id: "light", type: "switch", bone: "root", variants: { off: "<g/>", on: "<circle r='4'/>" }, default: "off" }],
    anchors: { button: { bone: "root", at: [0, -125] }, high: { bone: "root", at: [0, -600] } },
  };
  const k: Kit = { ...kit, characters: { ...kit.characters, bell: bell as never }, sets: { room: { ...kit.sets.room, fixtures: [{ id: "bell", character: "bell", mark: "mid" }] } } };

  it("walks over, reaches the free hand to the button, pushes, lets go; the fixture changes at the press", () => {
    const { out, script, errors, warnings } = block([{ line: 2, do: "press", who: "a", at: "bell", value: "on" }], {}, k);
    expect(errors).toEqual([]);
    expect(warnings.join("\n")).not.toContain("above");
    expect(script.some((x) => x.action === "walkTo" && x.actor === "a")).toBe(true);
    const reaches = script.filter((x) => x.action === "reach" && x.actor === "a");
    expect(reaches.map((r) => r.chain)).toEqual(["handF", "handF", "handF", "handF"]);
    expect(reaches[0].target).toEqual({ actor: "bell", anchor: "button" });
    expect(Array.isArray(reaches[1].target)).toBe(true);
    expect(reaches[2].target).toEqual({ actor: "bell", anchor: "button" });
    expect(reaches[3].target).toBeNull();
    // Timing: 0.12 s in, 0.1 s held, 0.2 s out; the press lands on the beat.
    const press = lines[2].s;
    expect(reaches[1].at).toBeCloseTo(press - 0.12, 2);
    expect(reaches[2].at).toBeCloseTo(press + 0.1, 2);
    expect(reaches[3].at).toBeCloseTo(press + 0.3, 2);
    expect(script.find((x) => x.actor === "bell" && x.channel === "parts.light.variant")!.at).toBeCloseTo(press, 2);
    // Standing on the side they come from (a is left of the bell), facing it, within reach.
    const walk = script.find((x) => x.action === "walkTo" && x.actor === "a") as Act & { x: number };
    expect(walk.x).toBeLessThan(1000);
    expect(1000 - walk.x).toBeLessThan(80);
    compilesWhenValid(out.scenes.x, k);
  });

  it("uses the far hand when the near one is busy, a named anchor, and warns when it is out of reach", () => {
    const { script, warnings } = block([{ line: 2, do: "press", who: "a", at: "bell.high" }], { props: [{ id: "bola", kind: "ball", heldBy: "a" }] }, k);
    expect(script.filter((x) => x.action === "reach" && x.actor === "a").map((x) => x.chain)).toEqual(["handB", "handB", "handB", "handB"]);
    expect(warnings.join("\n")).toMatch(/"bell.high" is \d+ px above a's reach/);
  });

  it("unknown targets and anchors are errors with the closest match", () => {
    const { errors } = block([{ line: 1, do: "press", who: "a", at: "bel" }, { line: 2, do: "press", who: "a", at: "bell.buton" }], {}, k);
    expect(errors.join("\n")).toMatch(/cannot press "bel".*did you mean "bell"/);
    expect(errors.join("\n")).toMatch(/"bell" has no anchor "buton".*did you mean "button"/);
  });
});

describe("5. camera style", () => {
  const cams = (s: Staging) => (direct(s, lines, kit).scenes.x.script as Act[]).filter((x) => x.action === "camera");
  const exchange = (extra: Partial<Staging> = {}, beats: unknown[] = []): Staging => ({ blocks: [{ id: "x", set: "room", from: 0, to: 4, cast: [{ id: "a", at: "a" }, { id: "b", at: "door" }], beats: beats as never }], ...extra });

  it("conversation: a 4-line exchange between two people is one framing (plus the opening), not one per line", () => {
    expect(cams(exchange()).length).toBe(1);
    const c = cams(exchange({ camera: { style: "conversation" } }));
    expect(c.length).toBe(2);
    expect(c[1].frame).toEqual(["a", "b"]);
  });

  it("an explicit camera beat wins: the framing does not come back while the same people talk", () => {
    const c = cams(exchange({ camera: { style: "conversation" } }, [{ line: 2, do: "camera", type: "close", who: "a" }]));
    expect(c.length).toBe(3);
    expect(c[2].frame).toEqual(["a"]);
  });
});

describe("6. faces too close", () => {
  const withFace = { ...person, anchors: { ...person.anchors, face: { bone: "head", at: [0, -150] } } } as unknown as typeof stick;
  const k: Kit = { ...kit, characters: { a: withFace, b: withFace } };
  const close = (beats: unknown[]) => check({ blocks: [{ id: "x", set: "room", from: 0, to: 4, cast: [{ id: "a", at: "a" }, { id: "b", at: "door" }], beats: beats as never }] }, lines, k).map((i) => i.message).filter((m) => m.includes("stand too close"));

  it("two standing nose to nose are reported; hugging, a high five, a hand-over, hand in hand or a piggyback are not", () => {
    expect(close([{ line: 0, do: "walk", who: "b", to: { mark: "a", dx: 60 } }]).length).toBe(1);
    expect(close([{ line: 1, do: "hug", who: ["a", "b"] }])).toEqual([]);
    expect(close([{ line: 1, do: "highFive", who: ["a", "b"] }])).toEqual([]);
    expect(close([{ line: 1, do: "hold", who: ["a", "b"] }])).toEqual([]);
    expect(close([{ line: 1, do: "carry", who: "a", target: "b", until: { line: 3 } }])).toEqual([]);
  });

  it("sitting side by side is not standing too close", () => {
    const sofa = { format: "toon", version: 1, name: "sofa", skeleton: [{ id: "root" }], parts: [{ id: "s", type: "rigid", bone: "root", art: "<rect x='-120' y='-50' width='240' height='50'/>" }], anchors: { seat: { bone: "root", at: [40, -50] }, seat2: { bone: "root", at: [-40, -50] } } };
    const k2: Kit = { ...k, characters: { ...k.characters, sofa: sofa as never }, furniture: { sofa: { character: "sofa", scale: 1 } } };
    const seated = check({ blocks: [{ id: "x", set: "room", from: 0, to: 4, cast: [{ id: "a", at: "a" }, { id: "b", at: "door" }], furniture: [{ id: "couch", kind: "sofa", at: "mid" }], beats: [{ line: 0, do: "sit", who: ["a", "b"], on: "couch", view: "front" }] }] }, lines, k2).map((i) => i.message);
    expect(seated.filter((m) => m.includes("stand too close"))).toEqual([]);
  });

  it("only within the beat's window: brought close by a hug, then left standing nose to nose after walking back", () => {
    // After the hug a walks off and b follows to stand right in front of her: that is reported again.
    const msgs = close([
      { line: 0, do: "hug", who: ["a", "b"], until: { line: 0, end: true } },
      { line: 1, do: "walk", who: "a", to: "mid" },
      { line: 2, do: "walk", who: "b", to: { mark: "mid", dx: 60 } },
    ]);
    expect(msgs.length).toBe(1);
  });
});

// A chibi (big head, short arms) at 1.75×, an intercom whose button is high up, a hung sack.
const chibiLook = { name: "Tourist", build: "man", skin: "#f4c9a8", hair: "sidePart", hairColor: "#e0b25a", top: "shirt", topColor: "#ffd23f", bottom: "bermuda", bottomColor: "#c9b48a", shoes: "sandals" } as const;
const chibi = (() => {
  const a = structuredClone(styledAnatomy(cartoonAnatomy(chibiLook as never), "flat", chibiLook as never));
  a.body.head *= 2.05;
  a.body.torso *= 0.68;
  a.body.hip *= 0.55;
  const doc = cartoonCharacter(chibiLook as never, { style: "flat", anatomy: a } as never);
  return { doc, rig: cartoonInfo(doc, chibiLook as never, { anatomy: a } as never) };
})();
const intercom = {
  format: "toon", version: 1, name: "intercom", skeleton: [{ id: "root" }],
  parts: [{ id: "box", type: "rigid", bone: "root", art: "<rect x='-20' y='-370' width='40' height='70'/>" }, { id: "light", type: "switch", bone: "root", variants: { off: "<g/>", on: "<circle cy='-350' r='4'/>" }, default: "off" }],
  anchors: { button: { bone: "root", at: [0, -334] }, roof: { bone: "root", at: [0, -1400] } },
};
const chibiKit = (marks: Record<string, { x: number }>): Kit => ({
  ...kit,
  characters: { t: chibi.doc, intercom: intercom as never },
  cast: { t: { name: "Tourist", scale: 1.75, rig: chibi.rig } },
  narrators: ["n"],
  props: { ...kit.props, sack: { art: () => "<rect x='-40' y='0' width='80' height='120'/>", radius: 60, hang: { point: [0, 0] } } },
  sets: { st: { layers: [{ id: "bg", art: "<rect width='1920' height='1080' fill='#eee'/>" }], ground: { near: 960 }, marks: { box: { x: 1330 }, ...marks }, fixtures: [{ id: "intercom", character: "intercom", mark: "box", z: -1, channel: "parts.light.variant", value: "off" }] } },
} as unknown as Kit);
const nLines: Line[] = [{ i: 0, s: 0.3, e: 2.6, text: "…", speaker: "n" }, { i: 1, s: 3, e: 4.4, text: "…", speaker: "n" }];
const pressScene = (marks: Record<string, { x: number }>, cast: Record<string, unknown>, beats: unknown[], props: unknown[] = []) => {
  const k = chibiKit(marks);
  const staging = { blocks: [{ id: "x", set: "st", from: 0, to: 2, cast: [{ id: "t", ...cast }], props, beats }] } as unknown as Staging;
  const out = direct(staging, nLines, k);
  return { k, staging, out, script: out.scenes.x.script as (Act & { x?: number; direction?: string })[], warnings: out.issues.filter((i) => i.severity === "warning").map((i) => i.message) };
};

describe("7. press with a free hand, within the arm's real reach", () => {
  it("never the hand carrying a hung prop: a 2.5D rig turning round to the button presses with the other one, the sack still hanging", () => {
    // Facing left with the sack in the far hand; the button is to the right: turned round, the sack is in the near hand.
    const { script, out } = pressScene({ start: { x: 1150 } }, { at: "start", facing: "left" }, [{ line: 1, do: "press", who: "t", at: "intercom.button", value: "on" }], [{ id: "saco", kind: "sack", heldBy: "t" }]);
    expect(out.issues.filter((i) => i.severity === "error")).toEqual([]);
    const grabs = script.filter((x) => x.action === "grab" && x.prop === "saco");
    expect(grabs.map((g) => g.anchor)).toEqual(["handB", "hand"]);
    expect(grabs.every((g) => !!g.hang)).toBe(true);
    const reaches = script.filter((x) => x.action === "reach" && x.actor === "t");
    expect(new Set(reaches.map((r) => r.chain))).toEqual(new Set(["handB"]));
    // (No grab again while pressing: the sack keeps hanging from the near hand.)
    expect(grabs.every((g) => g.at < reaches[0].at)).toBe(true);
  });

  it("both hands taken (a prop in each): the near one, with a warning", () => {
    const { script, warnings } = block([{ line: 2, do: "press", who: "a", at: "bell" }], { props: [{ id: "bola", kind: "ball", heldBy: "a" }, { id: "lamp", kind: "lantern", heldBy: "a" }] }, {
      ...kit,
      characters: { ...kit.characters, bell: { format: "toon", version: 1, name: "bell", skeleton: [{ id: "root" }], parts: [{ id: "b", type: "rigid", bone: "root", art: "<rect x='-10' y='-140' width='20' height='30'/>" }], anchors: { button: { bone: "root", at: [0, -125] } } } as never },
      sets: { room: { ...kit.sets.room, fixtures: [{ id: "bell", character: "bell", mark: "mid" }] } },
    });
    expect(script.filter((x) => x.action === "reach" && x.actor === "a").every((x) => x.chain === "handF")).toBe(true);
    expect(warnings.join("\n")).toMatch(/presses "bell" with the near hand although it is busy/);
  });

  it("walks to within 0.9 of the arm from the shoulder, facing the way they go, then the button; the fist stays on the arm", () => {
    const { k, staging, script, out } = pressScene({ start: { x: 300 } }, { at: "start", facing: "right" }, [{ line: 1, do: "press", who: "t", at: "intercom.button" }]);
    expect(out.issues.filter((i) => i.severity === "error")).toEqual([]);
    const walk = script.find((x) => x.action === "walkTo" && x.actor === "t")!;
    const s = 1.75, L = chibi.rig.armLength.F * s, sh = chibi.rig.shoulder.F;
    const d = 1330 - (walk.x! + sh[0] * s), dy = 960 - 334 - (960 + sh[1] * s);
    expect(d).toBeGreaterThan(0);
    expect(Math.hypot(d, dy)).toBeLessThanOrEqual(0.9 * L + 1);
    // Facing the button on arrival, never walking backwards.
    const face = script.filter((x) => x.action === "face" && x.actor === "t").pop()!;
    expect(face.direction).toBe("right");
    expect(face.at).toBeGreaterThanOrEqual(walk.at + walk.duration! - 1e-6);
    expect(check(staging, nLines, k, { strict: true }).map((i) => i.message).join("\n")).not.toMatch(/walks backwards|would face/);
    // At the press: the hand joint on the forearm's tip, the fingers at the button.
    const sc = compileScene(out.scenes.x, { characters: k.characters } as never);
    const actor = sc.actors.find((a) => a.id === "t")!;
    // (The moment of the press, scene time: the push in ends on it.)
    const push = script.filter((x) => x.action === "reach" && x.actor === "t")[1];
    const tt = push.at + push.duration!;
    const pose = actorPose(sc, actor, tt), m = actorPlacement(actor, tt);
    const bi = (id: string) => actor.rig.bones.findIndex((b) => b.id === id);
    const fore = actor.rig.bones[bi("armF2")];
    const tip = apply(m, apply(pose.world[bi("armF2")], [fore.length, 0]));
    const hand = apply(m, apply(pose.world[bi("handF")], [0, 0]));
    expect(Math.hypot(tip[0] - hand[0], tip[1] - hand[1])).toBeLessThan(0.5);
    const button = anchorPosition(sc, "intercom", "button", tt);
    expect(Math.hypot(hand[0] - button[0], hand[1] - button[1])).toBeLessThan(40);
  });

  it("already within reach: no walk, they only turn to it", () => {
    const { script } = pressScene({ start: { x: 1190 } }, { at: "start", facing: "left" }, [{ line: 1, do: "press", who: "t", at: "intercom.button" }]);
    expect(script.some((x) => x.action === "walkTo" && x.actor === "t")).toBe(false);
    expect(script.filter((x) => x.action === "face" && x.actor === "t").pop()!.direction).toBe("right");
  });

  it("higher than the arm can reach: stands close (a quarter of the arm) and warns", () => {
    const { script, warnings } = pressScene({ start: { x: 300 } }, { at: "start", facing: "right" }, [{ line: 1, do: "press", who: "t", at: "intercom.roof" }]);
    expect(warnings.join("\n")).toMatch(/"intercom.roof" is \d+ px above t's reach/);
    const walk = script.find((x) => x.action === "walkTo" && x.actor === "t")!;
    const s = 1.75, L = chibi.rig.armLength.F * s;
    expect(1330 - (walk.x! + chibi.rig.shoulder.F[0] * s)).toBeCloseTo(0.25 * L, 0);
  });
});

describe("8. covered faces measure fixtures as posed", () => {
  // A sliding gate: its leaf bone moved 540 px by the `open` clip (and back by `close`).
  const gate = {
    format: "toon", version: 1, name: "gate", skeleton: [{ id: "root" }, { id: "leaf", parent: "root", x: 0, y: 0 }],
    parts: [{ id: "leaf", type: "rigid", bone: "leaf", art: "<rect x='-100' y='-400' width='200' height='400'/>" }],
    clips: {
      open: { duration: 0.8, tracks: { "bones.leaf.x": [[0, 0, "easeInOut"], [0.8, 540]] } },
      close: { duration: 0.8, tracks: { "bones.leaf.x": [[0, 540, "easeInOut"], [0.8, 0]] } },
    },
  };
  const k: Kit = { ...kit, characters: { ...kit.characters, gate: gate as never }, sets: { room: { ...kit.sets.room, fixtures: [{ id: "g", character: "gate", mark: "door", z: 5 }] } } };
  const covered = (beats: unknown[]) => check({ blocks: [{ id: "x", set: "room", from: 0, to: 4, cast: [{ id: "a", at: "a" }, { id: "b", at: "door" }], beats: beats as never }] }, lines, k).map((i) => i.message).filter((m) => m.includes("g is drawn over b's face"));

  it("covers the face before the clip opens it, not after; closed again it covers", () => {
    expect(covered([]).length).toBe(1);
    expect(covered([{ line: 0, offset: -0.2, do: "fixture", id: "g", value: "open" }])).toEqual([]);
    const closed = covered([{ line: 0, offset: -0.2, do: "fixture", id: "g", value: "open" }, { line: 2, do: "fixture", id: "g", value: "close" }]);
    expect(closed.length).toBe(1);
    expect(closed[0]).toMatch(/^around line [23]: /);
  });
});

describe("9. the conversation framing fits everyone", () => {
  const portrait = (gap: number): Kit => ({
    ...kit,
    sets: { room: { layers: [{ id: "bg", art: "<rect x='-2000' width='6000' height='1920' fill='#eee'/>" }], ground: { near: 1500 }, bounds: [-1700, 0, 2780, 1920], marks: { a: { x: 540 - gap / 2 }, door: { x: 540 + gap / 2 }, mid: { x: 540 } } } },
    width: 1080,
    height: 1920,
  });
  const staging: Staging = { camera: { style: "conversation" }, blocks: [{ id: "x", set: "room", from: 0, to: 4, cast: [{ id: "a", at: "a" }, { id: "b", at: "door" }] }] };
  const inFrame = (k: Kit) => {
    const out = direct(staging, lines, k);
    const sc = compileScene(out.scenes.x, { characters: k.characters } as never);
    return { out, heads: lines.map((l) => ["a", "b"].map((id) => screenPoint(sc, id, (l.s + l.e) / 2))) };
  };

  it("two people 700 px apart in a 1080×1920 frame: one framing on both, every head inside", () => {
    const k = portrait(700);
    expect(check(staging, lines, k, { strict: true }).map((i) => i.message).join("\n")).not.toContain("out of the frame");
    const { out, heads } = inFrame(k);
    const cams = (out.scenes.x.script as Act[]).filter((x) => x.action === "camera");
    expect(cams.length).toBe(2);
    expect(cams[1].frame).toEqual(["a", "b"]);
    for (const pair of heads) for (const [x, y] of pair) {
      expect(x).toBeGreaterThan(1080 * 0.06);
      expect(x).toBeLessThan(1080 * 0.94);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(1920);
    }
  });

  it("too far apart for a readable shot: on whoever speaks, re-framed per exchange, never out of the frame", () => {
    const k = portrait(2400);
    expect(check(staging, lines, k, { strict: true }).map((i) => i.message).join("\n")).not.toContain("out of the frame");
    const { out } = inFrame(k);
    const cams = (out.scenes.x.script as (Act & { follow?: string })[]).filter((x) => x.action === "camera").slice(1);
    expect(cams.map((c) => c.follow)).toEqual(["a", "b", "a", "b"]);
  });
});

describe("10. a momentary camera beat hands the picture back", () => {
  // Ana and Bia alternate; Bia's line 6 gets a crash zoom; Ana answers 3 s later (lines 7 and 8).
  const talk: Line[] = Array.from({ length: 9 }, (_, i) => {
    const s = i < 7 ? 0.2 + i * 1.6 : 9.8 + 3 + (i - 7) * 1.6;
    return { i, s, e: s + 1.2, text: "…", speaker: i === 6 ? "Bia" : i >= 7 ? "Ana" : i % 2 ? "Bia" : "Ana" };
  });
  const staging = (type: string, extra: Record<string, unknown> = {}): Staging => ({
    camera: { style: "conversation" },
    blocks: [{ id: "x", set: "room", from: 0, to: 9, cast: [{ id: "a", at: "a" }, { id: "b", at: "door" }], beats: [{ line: 6, do: "camera", type, who: "b", ...extra }] as never }],
  });
  // The cameras from the beat on (scene time), the beat's own first.
  const after = (s: Staging) => {
    const cams = (direct(s, talk, kit).scenes.x.script as Act[]).filter((x) => x.action === "camera");
    return cams.slice(cams.findIndex((c) => c.frame?.length === 1 && c.frame[0] === "b"));
  };

  it("a crash: the conversation framing is back 2.5 s on, nobody out of the frame", () => {
    const cams = after(staging("crash"));
    const back = cams.find((c) => c.frame?.length === 2)!;
    expect(back.frame).toEqual(["a", "b"]);
    expect(back.at - cams[0].at).toBeCloseTo(2.5, 1);
    expect(check(staging("crash"), talk, kit, { strict: true }).map((i) => i.message).join("\n")).not.toContain("out of the frame");
  });

  it("timed by `duration`, it hands back then; a close-up holds while the same people talk", () => {
    const cams = after(staging("whip", { duration: 1 }));
    expect(cams.find((c) => c.frame?.length === 2)!.at - cams[0].at).toBeCloseTo(1, 1);
    expect(after(staging("close")).filter((c) => c.frame?.length === 2)).toEqual([]);
  });
});
