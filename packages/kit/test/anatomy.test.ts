import { describe, expect, it } from "vitest";
import { type RenderNode, type ToonDoc, compileRig, evaluatePose, renderCharacter, rig3dPose, sampleTrack } from "@animestudio/core";
import { type CartoonAnatomy, type CartoonLook, cartoonAnatomy, cartoonCharacter, cartoonInfo, drawnBounds, humanCharacter, rigInfo, styledAnatomy, svgBounds } from "../src";

// What the kit guarantees for any anatomy, checked on a "chibi" (a big head on a small body: the
// head twice as big, a short torso and legs, big eyes) and on default looks.
const gringo: CartoonLook = {
  name: "Gringo", build: "man", heavy: 0.5, limbs: "normal", skin: "#f4c9a8", hair: "sidePart", hairColor: "#e0b25a", jaw: "square", nose: "button",
  top: "shirt", topColor: "#ffd23f", pattern: "checks", bottom: "bermuda", bottomColor: "#c9b48a", shoes: "sandals", hat: "cap", glasses: "sun",
};
const kid: CartoonLook = { name: "kid", build: "kid", skin: "#f6d3b5", hair: "bowl", hairColor: "#5a3a22", top: "tee", topColor: "#ff0000", bottom: "shorts", bottomColor: "#3a62b0", shoes: "sneakers" };

function chibi(look: CartoonLook): CartoonAnatomy {
  const a = structuredClone(styledAnatomy(cartoonAnatomy(look), "flat", look));
  a.body.head *= 2.05; a.body.torso *= 0.68; a.body.hip *= 0.55; a.body.neck *= 0.4;
  a.face.eye = [a.face.eye[0] * 1.5, a.face.eye[1] * 1.55]; a.face.eyeX = Math.max(a.face.eyeX, a.face.eye[0] + 0.1); a.face.pupil *= 0.8;
  return a;
}

const chibiA = chibi(gringo);
const chibiDoc = cartoonCharacter(gringo, { style: "flat", anatomy: chibiA });
const manDoc = cartoonCharacter(gringo);

/** The rendered parts of a doc at rest in a view, by part id. */
function rendered(doc: ToonDoc, view: string): Map<string, RenderNode> {
  const rig = compileRig(doc);
  const nodes = renderCharacter(rig, evaluatePose(rig, { time: 0, controls: { view } }));
  return new Map(nodes.map((n) => [n.key, n]));
}
/** Bounds of the shapes of a part's markup that pass `keep` (a test on the tag), through its transform. */
function partBounds(n: RenderNode | undefined, keep: (tag: string) => boolean = () => true) {
  if (!n) return undefined;
  if (n.kind === "path") return svgBounds(`<path d="${n.d}"/>`);
  if (n.kind !== "markup") return undefined;
  const tags = [...n.markup.matchAll(/<(path|ellipse|circle|rect)\b[^>]*>/g)].map((m) => m[0]).filter(keep);
  return tags.length ? svgBounds(tags.join(""), n.transform) : undefined;
}

describe("svgBounds / drawnBounds", () => {
  it("measures through nested transforms, curves exactly, and leaves out what is not drawn", () => {
    expect(svgBounds(`<g transform="translate(10,5) scale(2)"><rect x="1" y="1" width="2" height="3"/></g>`)).toEqual([12, 7, 16, 13]);
    expect(svgBounds(`<g transform="matrix(1 0 0 1 100 0)"><g transform="translate(0 50)"><circle cx="0" cy="0" r="4"/></g></g>`)).toEqual([96, 46, 104, 54]);
    // A curve's box is the curve's, not its control points' (those go to y = -10).
    const c = svgBounds(`<path d="M0 0 C0 -10 10 -10 10 0"/>`)!;
    expect(c[1]).toBeCloseTo(-7.5, 5);
    // Relative commands, rotation.
    expect(svgBounds(`<path d="m10 10 l5 0 l0 5 z"/>`)).toEqual([10, 10, 15, 15]);
    const rot = svgBounds(`<rect width="10" height="2" transform="rotate(90)"/>`)!;
    expect(rot.map((v) => Math.round(v))).toEqual([-2, 0, 0, 10]);
    // Clip paths, defs, unpainted shapes: not drawn.
    expect(svgBounds(`<clipPath id="c"><rect width="500" height="500"/></clipPath><defs><circle r="90"/></defs><rect width="1" height="1" fill="none"/><rect x="2" y="2" width="1" height="1"/>`)).toEqual([2, 2, 3, 3]);
  });
  it("rigInfo measures the extent and height of any rig as drawn when none is given", () => {
    const hero = humanCharacter({ name: "hero", skin: "#f6d3b5", hair: "spiky", hairColor: "#222", iris: "#36c", outfit: "hoodie", top: "#c33", pants: "#334", shoes: "#111" });
    const info = rigInfo(hero);
    const b = drawnBounds(hero, "profile", { arms: false })!;
    expect(info.extent.front).toBeCloseTo(b[2], 1);
    expect(info.extent.back).toBeCloseTo(-b[0], 1);
    expect(info.height).toBeCloseTo(-b[1], 1);
    expect(info.height).toBeGreaterThan(300);
    // Given, it is kept.
    expect(rigInfo(hero, { extent: { front: 85, back: 75 }, height: 470 }).extent).toEqual({ front: 85, back: 75 });
  });
});

describe("1. extent measured from the real drawing", () => {
  it("default looks keep about the measures they had (within 10 %)", () => {
    // Before the drawing was measured: kid 62.46 / 66.77, height 450.15; man 58 / 58, height 550.15.
    const k = cartoonInfo(cartoonCharacter(kid), kid), m = cartoonInfo(manDoc, gringo);
    for (const [got, was] of [[k.extent.front, 62.46], [k.extent.back, 66.77], [k.height, 450.15], [m.extent.front, 58], [m.extent.back, 58], [m.height, 550.15]]) {
      expect(Math.abs(got / was - 1), `${got} vs ${was}`).toBeLessThan(0.1);
    }
  });
  it("a big head reaches as far as it is drawn, in front and behind, and as high", () => {
    const info = cartoonInfo(chibiDoc, gringo, { anatomy: chibiA });
    const u = chibiA.body.head;
    for (const view of ["profile", "front"]) {
      const parts = rendered(chibiDoc, view);
      const head = [...parts.entries()].filter(([id]) => /^(head|hairBack|hairFront|over)[A-Z]?$/.test(id)).map(([, n]) => partBounds(n)!).filter(Boolean);
      const x0 = Math.min(...head.map((b) => b[0])), x1 = Math.max(...head.map((b) => b[2])), y0 = Math.min(...head.map((b) => b[1]));
      // The head's own drawn radius (half its width) and its reach.
      expect(info.extent.front).toBeGreaterThanOrEqual((x1 - x0) / 2);
      expect(info.extent.back).toBeGreaterThanOrEqual((x1 - x0) / 2 - 8);
      if (view === "profile") {
        expect(info.extent.front).toBeGreaterThanOrEqual(x1 - 0.5);
        expect(info.extent.back).toBeGreaterThanOrEqual(-x0 - 0.5);
        expect(info.height).toBeGreaterThanOrEqual(-y0 - 0.5);
      }
    }
    expect(info.extent.front).toBeGreaterThan(u);
    expect(info.extent.back).toBeGreaterThan(u);
  });
});

describe("2. gestures never cross the head", () => {
  type V3 = [number, number, number];
  const GESTURES = ["gamepad", "cue", "groove", "phone", "smoke", "drink", "think", "facepalm", "cry", "wave", "scared", "clap", "cheer", "pointUp", "shrug", "point", "present", "talk", "sing", "read", "laugh"];
  const TOUCH = ["facepalm", "think", "cry"];
  const mv = (m: number[], v: V3): V3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
  const mvT = (m: number[], v: V3): V3 => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
  /** The smallest distance (normalised by the radii) from the head's keep-out ellipsoids, over each gesture. */
  function clearance(doc: ToonDoc) {
    const rig = compileRig(doc);
    const keep = ((doc.rig3d as { keepOut: { bone: string; at: V3; radii: V3 }[] }).keepOut).filter((k) => k.bone === "head");
    const out: Record<string, number> = {};
    for (const name of GESTURES) {
      const clip = rig.clips[name];
      expect(clip, name).toBeDefined();
      let worst = Infinity;
      for (let i = 0; i <= 40; i++) {
        const values: Record<string, Record<string, number>> = {};
        for (const tr of clip.tracks) {
          const m = /^bones\.([^.]+)\.(rotation|turn|spread)$/.exec(tr.channel);
          const x = m ? sampleTrack(tr.track, (i / 40) * clip.duration) : undefined;
          if (m && typeof x === "number") (values[m[1]] ??= {})[m[2]] = x;
        }
        const pose = rig3dPose(doc as never, values);
        for (const side of ["F", "B"]) {
          const fore = pose[`arm${side}2`];
          const points: V3[] = [fore.to, [(fore.from[0] + fore.to[0]) / 2, (fore.from[1] + fore.to[1]) / 2, (fore.from[2] + fore.to[2]) / 2]];
          for (const p of points)
            for (const k of keep) {
              const b = pose[k.bone], at = mv(b.rot, k.at);
              const l = mvT(b.rot, [p[0] - b.from[0] - at[0], p[1] - b.from[1] - at[1], p[2] - b.from[2] - at[2]]);
              worst = Math.min(worst, Math.hypot(l[0] / k.radii[0], l[1] / k.radii[1], l[2] / k.radii[2]));
            }
        }
      }
      out[name] = worst;
    }
    return out;
  }
  it("the head's keep-out is the head as drawn (cranium with hair, face), for any head size", () => {
    for (const [doc, u] of [[chibiDoc, chibiA.body.head], [manDoc, (manDoc.meta as { anatomy: CartoonAnatomy }).anatomy.body.head]] as const) {
      const heads = (doc.rig3d as { keepOut: { bone: string; radii: number[] }[] }).keepOut.filter((k) => k.bone === "head");
      expect(heads.length).toBeGreaterThanOrEqual(2);
      // The cranium (radius u) with its hair and a hand's margin.
      for (const r of heads[0].radii) expect(r).toBeGreaterThan(u);
    }
  });
  for (const [label, doc] of [["chibi", chibiDoc], ["default man", manDoc]] as const) {
    it(`no hand or forearm passes through the head (${label})`, () => {
      const c = clearance(doc);
      for (const [name, q] of Object.entries(c)) expect(q, `${label} ${name}`).toBeGreaterThanOrEqual(TOUCH.includes(name) ? 0.95 : 1);
    });
  }
});

describe("3. accessories follow the head", () => {
  const pal = chibiDoc.palette as Record<string, string>;
  const fillOf = (keys: string[]) => (tag: string) => keys.some((k) => tag.includes(`fill="${pal[k]}"`));
  for (const view of ["profile", "front"]) {
    it(`on a big head the cap's crown spans the head and sits at the forehead; the glasses straddle both eyes (${view})`, () => {
      const s = view === "front" ? "F" : "";
      const parts = rendered(chibiDoc, view);
      const head = partBounds(parts.get(`head${s}`))!;
      // The cap: its crown (hat colour) and peak (hatDark), drawn in the hair's pieces.
      const hats = [`hairBack${s}`, `hairFront${s}`].map((id) => partBounds(parts.get(id), fillOf(["hat", "hatDark"]))).filter(Boolean) as number[][];
      const crowns = [`hairBack${s}`, `hairFront${s}`].map((id) => partBounds(parts.get(id), fillOf(["hat"]))).filter(Boolean) as number[][];
      const hx0 = Math.min(...hats.map((b) => b[0])), hx1 = Math.max(...hats.map((b) => b[2]));
      const crownBottom = Math.max(...crowns.map((b) => b[3]));
      expect(hx1 - hx0).toBeGreaterThanOrEqual(0.9 * (head[2] - head[0]));
      // Its bottom at the forehead line: above the eyes, not over the brows, not perched above them.
      const eyes = partBounds(parts.get(view === "front" ? "eyeF_open" : "eyes"), (t) => t.includes('fill="#fff"'))!;
      const brows = partBounds(parts.get(`brows${s}`))!;
      const u = chibiA.body.head;
      expect(crownBottom).toBeLessThan(eyes[1]);
      expect(crownBottom).toBeLessThanOrEqual(brows[1] + u * 0.03);
      expect(crownBottom).toBeGreaterThanOrEqual(brows[1] - u * 0.25);
      // The glasses (dark lenses) cover both eyes' centres.
      const eyeTags = [...((parts.get(view === "front" ? "eyeF_open" : "eyes") as { markup: string }).markup.matchAll(/<path\b[^>]*fill="#fff"[^>]*>/g))].map((m) => m[0]);
      expect(eyeTags.length).toBe(2);
      const lenses = partBounds(parts.get(`over${s}`), (t) => t.includes('fill="#1e2228"'))!;
      for (const tag of eyeTags) {
        const e = svgBounds(tag, (parts.get(view === "front" ? "eyeF_open" : "eyes") as { transform?: never }).transform)!;
        const cx = (e[0] + e[2]) / 2, cy = (e[1] + e[3]) / 2;
        expect(cx).toBeGreaterThanOrEqual(lenses[0]);
        expect(cx).toBeLessThanOrEqual(lenses[2]);
        expect(cy).toBeGreaterThanOrEqual(lenses[1]);
        expect(cy).toBeLessThanOrEqual(lenses[3]);
      }
    });
  }
});
