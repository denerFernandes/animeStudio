import { type SceneDoc, type ToonDoc, compileScene, evaluateScene, frameToSVG } from "@animestudio/core";
import { ToonFrame } from "@animestudio/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const pip = JSON.parse(readFileSync(join(__dirname, "../../../examples/characters/pip.toon.json"), "utf8")) as ToonDoc;

/** One actor and one prop with line boil (and motion blur: a fast walk), as the React renderer draws it. */
const doc = {
  format: "toon-scene",
  version: 1,
  width: 800,
  height: 400,
  fps: 24,
  duration: 2,
  characters: { pip: "pip" },
  actors: [{ id: "a", character: "pip", x: 100, y: 350 }],
  props: [{ id: "cup", art: "<rect width='10' height='10'/>", x: 300, y: 350 }],
  animation: { boil: 1 },
  camera: { motionBlur: 1 },
  script: [{ at: 0, actor: "a", action: "walkTo", x: 700, duration: 0.5 }],
} as unknown as SceneDoc;

describe("line boil in the React renderer", () => {
  it("emits the boil filters in the defs and references them on the actor and prop elements, under the blur", () => {
    const frame = evaluateScene(compileScene(doc, { characters: { pip } }), 6 / 24);
    const html = renderToStaticMarkup(createElement(ToonFrame, { frame }));
    expect(html).toContain('<filter id="boil-actor-a"');
    expect(html).toContain('<filter id="boil-prop-cup"');
    expect(html).toMatch(/<g id="actor-art-a" transform="[^"]+" filter="url\(#boil-actor-a\)">/);
    expect(html).toMatch(/<g transform="[^"]+" filter="url\(#boil-prop-cup\)">/);
    // The motion blur is a CSS filter on the actor's layer (the SVG around it), the boil inside it.
    expect(html).toMatch(/<svg[^>]*style="[^"]*filter:blur\([\d.]+px\)"[^>]*>(?:(?!<\/svg>).)*filter="url\(#boil-actor-a\)"/);
    // Same references as the string renderer.
    const svg = frameToSVG(frame);
    for (const ref of ['filter="url(#boil-actor-a)"', 'filter="url(#boil-prop-cup)"']) expect(svg).toContain(ref);
  });
});
