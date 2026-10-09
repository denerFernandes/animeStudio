import { compileScene, evaluateScene, frameToSVG, validateToon } from "@animestudio/core";
import { describe, expect, it } from "vitest";
import { importSvg } from "../src";

const drawing = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 200 300">
  <defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs>
  <circle id="origin" cx="100" cy="290" r="2"/>
  <line id="bone:body" x1="100" y1="250" x2="100" y2="150"/>
  <line inkscape:label="bone:head@body" x1="100" y1="150" x2="100" y2="100"/>
  <line id="bone_x3A_arm_x40_body" x1="100" y1="170" x2="150" y2="200"/>
  <g id="part:torso@body"><rect x="70" y="150" width="60" height="100" fill="url(#g)"/></g>
  <g transform="translate(0 -10)">
    <g id="part:face@head"><circle cx="100" cy="110" r="40" fill="#fc9"/></g>
  </g>
  <path id="skin:arm@body,arm" d="M100 170 L125 185 L150 200" stroke="#fc9" stroke-width="10" fill="none"/>
  <g id="switch:mouth/closed@head"><path d="M90 120h20" stroke="#000"/></g>
  <g id="switch:mouth/open@head"><ellipse cx="100" cy="122" rx="8" ry="6"/></g>
  <circle id="anchor:hand@arm" cx="150" cy="200" r="3"/>
  <rect x="0" y="290" width="200" height="10" fill="#6b4"/>
</svg>`;

describe("import-svg", () => {
  it("converts a named drawing into a valid character", () => {
    const { doc, warnings } = importSvg(drawing, { name: "drawn" });
    expect(warnings).toEqual([]);
    const r = validateToon(doc);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.ok).toBe(true);
    expect(doc.skeleton.map((b) => b.id)).toEqual(["root", "body", "head", "arm"]);
    const body = doc.skeleton[1];
    expect(body.from).toEqual([0, -40]);
    expect(doc.parts.map((p) => p.id)).toEqual(["torso", "face", "arm", "mouth", "art0"]);
    const mouth = doc.parts.find((p) => p.id === "mouth");
    expect(mouth?.type === "switch" && mouth.default).toBe("closed");
    expect(doc.anchors?.hand.at).toEqual([50, -90]);
    expect(doc.defs).toContain("linearGradient");
  });

  it("renders in a scene", () => {
    const { doc } = importSvg(drawing, { name: "drawn" });
    const scene = compileScene(
      {
        format: "toon-scene",
        version: 1,
        width: 400,
        height: 400,
        fps: 30,
        duration: 1,
        characters: { drawn: "x" },
        actors: [{ id: "a", character: "drawn", x: 200, y: 380 }],
      },
      { characters: { drawn: doc } },
    );
    const svg = frameToSVG(evaluateScene(scene, 0));
    expect(svg).toContain('id="a-g"');
    expect(svg).toContain("url(#a-g)");
  });
});
