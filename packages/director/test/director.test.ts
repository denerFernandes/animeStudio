import { describe, expect, it } from "vitest";
import { evaluateSequence, compileSequence } from "@animestudio/core";
import { check, direct, type Kit, type Line, type Staging } from "../src";
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
