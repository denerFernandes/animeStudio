import { validateToon } from "@animestudio/core";
import { describe, expect, it } from "vitest";
import { importSvg, parseTransform } from "../src";

const svg = (body: string, attrs = 'viewBox="0 0 200 300"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}><circle id="origin" cx="100" cy="300" r="1"/><line id="bone:arm" x1="100" y1="100" x2="150" y2="150"/>${body}</svg>`;

const skin = (doc: ReturnType<typeof importSvg>["doc"], id = "s") => {
  const p = doc.parts.find((x) => x.id === id);
  if (p?.type !== "skinned") throw new Error(`skin "${id}" missing`);
  return p;
};

describe("import-svg: skin paint (A8)", () => {
  it("reads fill / stroke / stroke-width from the style attribute", () => {
    const { doc, warnings } = importSvg(svg(`<path id="skin:s@arm" d="M100 100 L150 150" style="fill:#fc9;stroke:#000;stroke-width:3"/>`));
    expect(warnings).toEqual([]);
    expect(skin(doc)).toMatchObject({ fill: "#fc9", stroke: "#000", strokeWidth: 3 });
    expect(validateToon(doc).ok).toBe(true);
  });

  it("lets style win over presentation attributes (SVG precedence)", () => {
    const { doc } = importSvg(svg(`<path id="skin:s@arm" d="M100 100 L150 150" fill="#f00" stroke="#0f0" stroke-width="7" style="fill:#00f;stroke-width:2px"/>`));
    expect(skin(doc)).toMatchObject({ fill: "#00f", stroke: "#0f0", strokeWidth: 2 });
  });

  it("inherits paint from enclosing groups and defaults the fill to black", () => {
    const { doc } = importSvg(
      svg(`<g style="fill:#abc"><g stroke="#123"><path id="skin:s@arm" d="M100 100 L150 150"/></g></g><path id="skin:plain@arm" d="M100 100 L150 150"/>`),
    );
    expect(skin(doc)).toMatchObject({ fill: "#abc", stroke: "#123" });
    expect(skin(doc, "plain").fill).toBe("#000");
    expect(skin(doc, "plain").stroke).toBeUndefined();
  });

  it("keeps an explicit fill:none and warns about stylesheet classes", () => {
    const { doc, warnings } = importSvg(svg(`<path id="skin:s@arm" class="st0" d="M100 100 L150 150" style="fill:none;stroke:#000"/>`));
    expect(skin(doc).fill).toBe("none");
    expect(warnings.some((w) => w.includes('skin "s"') && w.includes("class"))).toBe(true);
  });
});

describe("import-svg: numbers and lengths (M27)", () => {
  it("tokenises transform arguments like SVG", () => {
    expect(parseTransform("translate(10-5)")).toEqual([1, 0, 0, 1, 10, -5]);
    expect(parseTransform("matrix(.5 0 0 .5-10 20)")).toEqual([0.5, 0, 0, 0.5, -10, 20]);
    expect(parseTransform("translate(1e3-2)")).toEqual([1, 0, 0, 1, 1000, -2]);
    expect(parseTransform("translate(.5.5)")).toEqual([1, 0, 0, 1, 0.5, 0.5]);
    // A trailing comma (Illustrator) is tolerated.
    expect(parseTransform("translate(1,)")).toEqual([1, 0, 0, 1, 1, 0]);
  });

  it("never yields NaN: unreadable functions are reported and skipped", () => {
    const warnings: string[] = [];
    const m = parseTransform("translate(10 abc) matrix(1 2 3) frob(1) scale(2)", (w) => warnings.push(w));
    expect(m).toEqual([2, 0, 0, 2, 0, 0]);
    expect(m.every(Number.isFinite)).toBe(true);
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toContain("translate(10 abc)");
    expect(warnings[1]).toContain("matrix(1 2 3)");
    expect(warnings[2]).toContain('"frob"');
    expect(parseTransform("translate(10 abc)")).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it("reads width / height with units when there is no viewBox", () => {
    const px = importSvg(svg("", 'width="200px" height="300px"'));
    expect(px.warnings).toEqual([]);
    expect(px.doc.skeleton[1].from).toEqual([0, -200]);
    const mm = importSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="200mm"><line id="bone:a" x1="0" y1="0" x2="10" y2="0"/></svg>`);
    expect(mm.warnings).toEqual([]);
    // 100mm = 377.95px wide → origin x at half of it.
    expect(mm.doc.skeleton[1].from?.[0]).toBeCloseTo(-188.98, 1);
    const pct = importSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="50em"><line id="bone:a" x1="0" y1="0" x2="10" y2="0"/></svg>`);
    expect(pct.warnings).toEqual(['cannot read width="100%"; using 100', 'cannot read height="50em"; using 100']);
    expect(pct.doc.skeleton.every((b) => (b.from ?? [0, 0]).every(Number.isFinite))).toBe(true);
  });

  it("warns and skips bones with unreadable coordinates, never writing null into the skeleton", () => {
    const { doc, warnings } = importSvg(svg(`<line id="bone:bad" x1="10em" y1="0" x2="10" y2="0"/>`));
    expect(warnings).toEqual(['bone "bad": cannot read x1="10em"']);
    expect(doc.skeleton.map((b) => b.id)).toEqual(["root", "arm"]);
    expect(JSON.stringify(doc)).not.toContain("null");
    expect(JSON.stringify(doc)).not.toContain("NaN");
  });

  it("falls back from an unreadable viewBox with a warning", () => {
    const { doc, warnings } = importSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200" width="400" height="600"><line id="bone:a" x1="100" y1="100" x2="10" y2="0"/></svg>`);
    expect(warnings).toEqual(['cannot read viewBox="0 0 200"; using width × height']);
    expect(doc.skeleton[1].from).toEqual([-100, -500]);
  });

  it("transform parse errors name the element", () => {
    const { warnings } = importSvg(svg(`<g id="part:p@arm" transform="translate(1 x)"><rect width="1" height="1"/></g>`));
    expect(warnings).toEqual(['part:p@arm: transform: cannot read "translate(1 x)"; ignored']);
  });
});

describe("import-svg: drawn root (B41)", () => {
  it("uses a drawn bone:root as the root bone", () => {
    const { doc, warnings } = importSvg(svg(`<line id="bone:root" x1="100" y1="250" x2="100" y2="200"/><line id="bone:hip@root" x1="100" y1="200" x2="100" y2="180"/>`));
    expect(warnings).toEqual([]);
    expect(doc.skeleton[0]).toEqual({ id: "root", from: [0, -50], to: [0, -100] });
    expect(doc.skeleton.find((b) => b.id === "hip")).toEqual({ id: "hip", parent: "root", from: [0, -100], to: [0, -120] });
    expect(validateToon(doc).ok).toBe(true);
  });

  it("ignores a parent on the root bone with a warning", () => {
    const { doc, warnings } = importSvg(svg(`<circle id="bone:root@arm" cx="100" cy="250" r="1"/>`));
    expect(warnings).toEqual(['bone "root" cannot have a parent; "@arm" ignored']);
    expect(doc.skeleton[0]).toEqual({ id: "root", from: [0, -50] });
  });
});
