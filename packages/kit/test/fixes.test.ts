import { describe, expect, it } from "vitest";
import { type ToonDoc, compileRig, evaluatePose, makeTrack, matAngle, parsePath, pathPoints, renderCharacter, resolveChannel, validateToon, type RenderNode } from "@animestudio/core";
import * as kit from "../src";
import { type CartoonLook, type HumanLook, THIGH_R, cartoonAnatomy, cartoonCharacter, cartoonInfo, checkAnatomy, furnitureRig, humanCharacter, sofaModel, withTones, withViews } from "../src";

type Doc = Record<string, any>;
type Bone = { id: string; from: [number, number]; to?: [number, number] };

const human: HumanLook = { name: "ana", skin: "#fc9", hair: "ponytail", hairColor: "#5a3a22", iris: "#3a7", outfit: "tee", top: "#e8414f", pants: "#345", shoes: "#222" };
const kid: CartoonLook = {
  name: "kid", build: "kid", skin: "#f6d3b5", hair: "ponytail", hairColor: "#5a3a22", accent: "#ff4fa0",
  top: "blazer", topColor: "#2b3a67", bottom: "pants", bottomColor: "#3a62b0", shoes: "sneakers", watch: "#d4af37", boutonniere: "#e23d5a",
};
const looks: CartoonLook[] = [
  kid,
  { name: "dad", build: "man", skin: "#e9c3a0", hair: "buzz", hairColor: "#333333", top: "shirt", topColor: "#ffffff", bottom: "pants", bottomColor: "#444a55", shoes: "dress", moustache: true },
  { name: "mum", build: "woman", female: true, skin: "#d9a57a", hair: "bun", hairColor: "#2a1a10", top: "blouse", topColor: "#f2c230", bottom: "skirt", bottomColor: "#8a1f2b", shoes: "heels" },
  { name: "gran", build: "elder", skin: "#f1d7c0", hair: "bald", hairColor: "#d8d4cc", top: "cardigan", topColor: "#6b8e5a", bottom: "pants", bottomColor: "#5a5a5a", shoes: "canvas" },
];

const bone = (doc: ToonDoc, id: string) => (doc.skeleton as Bone[]).find((b) => b.id === id)!;
const part = (doc: ToonDoc, id: string) => (doc.parts as Doc[]).find((p) => p.id === id);
const keys = (nodes: RenderNode[]): string[] => nodes.flatMap((n) => [n.key, ...(n.kind === "group" ? keys(n.children) : [])]);

/** The head's turn (degrees) that a `look` aim at `point` adds to the rest pose. */
function lookDelta(doc: ToonDoc, point: [number, number] | ((pivot: [number, number]) => [number, number])) {
  const rig = compileRig(doc);
  const head = rig.boneIndex.get("head")!;
  const rest = evaluatePose(rig, { time: 0 });
  const pivot: [number, number] = [rest.world[head][4], rest.world[head][5]];
  const aimed = evaluatePose(rig, { time: 0, aim: { look: { point: typeof point === "function" ? point(pivot) : point, weight: 1 } } });
  return matAngle(aimed.world[head]) - matAngle(rest.world[head]);
}

describe("A2: the look control follows its target", () => {
  const ana = humanCharacter(human);
  const doc = cartoonCharacter(kid);
  it("derives `forward` from the head bone's rest direction (facing +x)", () => {
    for (const d of [ana, doc]) {
      const h = bone(d, "head");
      const rest = (Math.atan2(h.to![1] - h.from[1], h.to![0] - h.from[0]) * 180) / Math.PI;
      expect((d.controls as Doc).look.targets[0].forward).toBeCloseTo(-rest, 1);
    }
    expect((doc.controls as Doc).look.targets[0].forward).toBeCloseTo(90, 1);
  });
  it("a level target in front turns nothing; above and below turn opposite ways", () => {
    for (const d of [ana, doc]) {
      expect(Math.abs(lookDelta(d, (p) => [p[0] + 3000, p[1]]))).toBeLessThan(0.3);
      const up = lookDelta(d, (p) => [p[0] + 3000, p[1] - 3000]), down = lookDelta(d, (p) => [p[0] + 3000, p[1] + 3000]);
      expect(up).toBeLessThan(-3);
      expect(down).toBeGreaterThan(3);
      expect(Math.abs(up + down)).toBeLessThan(0.3);
    }
  });
});

describe("A5: only the views a spec draws exist", () => {
  const ana = humanCharacter(human);
  it("the human has a profile and a front, no back", () => {
    expect(validateToon(ana).ok).toBe(true);
    expect(Object.keys((ana.controls as Doc).view.poses).sort()).toEqual(["front", "profile"]);
    expect(Object.keys(part(ana, "view")!.variants).sort()).toEqual(["front", "profile"]);
    expect(Object.keys((ana.meta as Doc).views.move)).toEqual(["front"]);
    expect((ana.parts as Doc[]).some((p) => p.visibleWhen?.variant === "back" || p.visibleWhen?.and?.variant === "back")).toBe(false);
    // Asking for a view that is not drawn leaves the profile (nothing hidden, nothing missing).
    const rig = compileRig(ana);
    const ids = keys(renderCharacter(rig, evaluatePose(rig, { time: 0, controls: { view: "back" } })));
    expect(ids).toContain("head");
    expect(ids).toContain("torso");
  });
  it("withViews makes a back view (and the far arm copy) only when the spec draws one", () => {
    const base = {
      format: "toon", version: 1, name: "t", palette: { ink: "#000" }, art: { a: "<g/>" },
      skeleton: [{ id: "root" }, { id: "body", parent: "root", from: [0, -50], to: [0, -100] }, { id: "head", parent: "body", from: [0, -100], to: [0, -140] }, { id: "armB1", parent: "body", from: [0, -95], to: [0, -60] }],
      parts: [{ id: "armB", type: "rigid", bone: "armB1", art: "a" }, { id: "head", type: "rigid", bone: "head", art: "a" }],
      controls: {},
    } as unknown as ToonDoc;
    const spec = { eyes: { center: [0, -120] as [number, number], parts: [] }, mouth: { center: [0, -110] as [number, number], parts: [] }, profileOnly: ["head"], hide: {}, parts: {}, move: {}, farArm: ["armB"] };
    const frontOnly = withViews(base, { ...spec, parts: { front: [{ part: { id: "headF", type: "rigid", bone: "head", art: "a" } }] } });
    expect(Object.keys((frontOnly.controls as Doc).view.poses).sort()).toEqual(["front", "profile"]);
    expect(part(frontOnly, "armBBack")).toBeUndefined();
    const withBack = withViews(base, { ...spec, hide: { back: ["head"] } });
    expect(Object.keys((withBack.controls as Doc).view.poses).sort()).toEqual(["back", "profile"]);
    expect(part(withBack, "armBBack")).toBeDefined();
    expect(validateToon(withBack).ok).toBe(true);
  });
});

describe("M9: the near ear is drawn over the head in three-quarter views", () => {
  it("earsFront is a drawing in the turned views of several looks, with no NaN anywhere", () => {
    for (const look of looks) {
      const doc = cartoonCharacter(look);
      const art = doc.art as Record<string, string>;
      for (const s of ["U", "V", "W", "S"]) expect(art[`earsFront${s}`], `${look.name} earsFront${s}`).toMatch(/<path/);
      for (const [k, v] of Object.entries(art)) expect(v, `${look.name} art ${k}`).not.toContain("NaN");
    }
  });
});

describe("M10: front irises keep the eyes' condition", () => {
  const ana = humanCharacter(human);
  it("pupilsF and the eye drawings show in the front view with the matching eyes only", () => {
    expect(part(ana, "pupilsF")!.visibleWhen).toEqual({ part: "eyes", variant: ["open", "wide", "half"], and: { part: "view", variant: "front" } });
    expect(part(ana, "eyeF_closed")!.visibleWhen).toEqual({ part: "eyes", variant: "closed", and: { part: "view", variant: "front" } });
    const rig = compileRig(ana);
    const shown = (view: string, eyes: string) => {
      const tr = (ch: string, v: unknown) => ({ channel: ch, ref: resolveChannel(rig, ch), track: makeTrack([{ t: 0, v: v as never }]) });
      return keys(renderCharacter(rig, evaluatePose(rig, { time: 0, tracks: [tr("controls.view", view), tr("parts.eyes.variant", eyes)] } as never)));
    };
    expect(shown("front", "closed")).toContain("eyeF_closed");
    expect(shown("front", "closed")).not.toContain("pupilsF");
    expect(shown("front", "open")).toContain("pupilsF");
    expect(shown("profile", "open")).not.toContain("pupilsF");
    expect(shown("profile", "open")).not.toContain("eyeF_open");
  });
});

describe("M11: tones never leave an undefined colour", () => {
  it("withTones defines a line tone for every shade; furnitureRig validates", () => {
    const p = withTones({ wood: "#8b5a2b", cloth: "#abc" });
    expect(Object.values(p).every((v) => typeof v === "string" && /^#[0-9a-f]{6}$/.test(v))).toBe(true);
    expect(p.woodShadeLine).toBe(p.woodLine);
    expect(p.cloth).toBe("#aabbcc");
    const sofa = furnitureRig(sofaModel({ fabric: "#6b8e5a" }), { horizon: 300, vpx: 960, y0: 900, dist: 900 }, { x: 0, z: 200 });
    const v = validateToon(sofa.doc);
    expect(v.ok, JSON.stringify(v)).toBe(true);
  });
});

describe("B17/B18: details that stay on the wearer's side", () => {
  const doc = cartoonCharacter(kid);
  it("a boutonniere is an asymmetric detail: the torso gets its mirrored drawing", () => {
    expect(validateToon(doc).ok).toBe(true);
    const torso = part(doc, "torso")!;
    expect(torso.type).toBe("switch");
    expect((doc.art as Doc).torsoM).toBeDefined();
    expect((doc.controls as Doc).side.poses.left["parts.torso.variant"]).toBe("l");
  });
  it("the watch is a solid on each wrist, shown by the side the character faces", () => {
    const F = part(doc, "watchF")!, B = part(doc, "watchB")!;
    expect(F.type).toBe("solid");
    expect(F.visibleWhen).toEqual({ part: "sideSwitch", variant: "r" });
    expect(B.visibleWhen).toEqual({ part: "sideSwitch", variant: "l" });
    expect(B.bodies.at(-1).shapes[0].from.bone).toBe("armB2");
    expect(part(doc, "arms")!.bodies.some((b: Doc) => b.fill === "palette(watch)")).toBe(false);
    const rig = compileRig(doc);
    const right = keys(renderCharacter(rig, evaluatePose(rig, { time: 0 })));
    expect(right).toContain("watchF");
    expect(right).not.toContain("watchB");
    const left = keys(renderCharacter(rig, evaluatePose(rig, { time: 0, controls: { side: "left" } })));
    expect(left).toContain("watchB");
    expect(left).not.toContain("watchF");
    // A watch alone (no mirrored drawings) still gets the side control.
    const plain = cartoonCharacter({ ...kid, name: "plain", top: "tee", boutonniere: undefined });
    expect((plain.controls as Doc).side).toBeDefined();
    expect((cartoonCharacter({ ...kid, name: "none", top: "tee", boutonniere: undefined, watch: undefined }).controls as Doc).side).toBeUndefined();
  });
});

describe("B19: head points follow the head's pitch correction", () => {
  const Q = (36 * Math.PI) / 180, HEAD_PITCH = 0.3;
  const expected = (doc: ToonDoc, pitchDeg: number) => {
    const p = (pitchDeg * Math.PI) / 180, pp = p * HEAD_PITCH;
    const head = bone(doc, "head"), neckTop = head.from[1], top = head.to![1];
    const u = (doc.meta as Doc).anatomy.body.head as number;
    const hy = neckTop - u * 0.92, eyeY = hy + u * 0.12;
    const dy = neckTop * (Math.cos(p) - Math.cos(pp));
    const proj = (y: number, z: number): [number, number] => [z * Math.sin(Q), y * Math.cos(pp) + z * Math.cos(Q) * Math.sin(pp) + dy];
    return { top: proj(top, 0), head: proj(eyeY - u * 0.1, u * 0.45), face: proj(eyeY + u * 0.2, u * 0.9), tail: proj(hy - u * 0.62, -u) };
  };
  it("top, the head and face anchors and the ponytail's pivot are where the drawn head puts them, at pitch 0 and 18", () => {
    for (const pitch of [0, 18]) {
      const doc = cartoonCharacter(kid, { pitch });
      const e = expected(doc, pitch);
      const a = doc.anchors as Record<string, { at: [number, number] }>;
      expect(a.top.at[0]).toBeCloseTo(e.top[0], 1);
      expect(a.top.at[1]).toBeCloseTo(e.top[1], 1);
      expect(a.head.at[0]).toBeCloseTo(e.head[0], 1);
      expect(a.head.at[1]).toBeCloseTo(e.head[1], 1);
      expect(a.face.at[0]).toBeCloseTo(e.face[0], 1);
      expect(a.face.at[1]).toBeCloseTo(e.face[1], 1);
      const tail = bone(doc, "tail");
      expect(tail.from[0]).toBeCloseTo(e.tail[0], 1);
      expect(tail.from[1]).toBeCloseTo(e.tail[1], 1);
    }
    // At pitch 18 the head sits lower on the screen than at 0 (nearly level, put back on the neck).
    const e0 = expected(cartoonCharacter(kid), 0), e18 = expected(cartoonCharacter(kid, { pitch: 18 }), 18);
    expect(e18.top[1] - e0.top[1]).toBeGreaterThan(10);
  });
  it("cartoonInfo measures the height of the head as drawn at the pitch", () => {
    const d0 = cartoonCharacter(kid), d18 = cartoonCharacter(kid, { pitch: 18 });
    const h0 = cartoonInfo(d0, kid).height, h18 = cartoonInfo(d18, kid, { pitch: 18 }).height;
    const shift = expected(d18, 18).top[1] - expected(d0, 0).top[1];
    expect(h18).toBeLessThan(h0);
    expect(Math.abs(h0 - h18 - shift)).toBeLessThan(6);
  });
});

describe("B20: legs-fit checks the thigh as drawn", () => {
  it("uses the drawn thigh radius; the default builds all pass", () => {
    const a = cartoonAnatomy({ ...kid, build: "child" });
    a.limbs.leg = [40, 20]; // 40 / 2 = 20 fits the hips (28); the drawn thigh (40 × THIGH_R = 32) does not
    expect(THIGH_R).toBe(0.8);
    expect(checkAnatomy(a).some((x) => x.rule === "legs-fit" && x.severity === "error")).toBe(true);
    for (const build of ["baby", "child", "kid", "teen", "woman", "man", "big", "elder"] as const)
      for (const limbs of ["thin", "normal", "thick"] as const) expect(checkAnatomy(cartoonAnatomy({ ...kid, build, limbs })).filter((x) => x.severity === "error")).toEqual([]);
  });
});

describe("B21/B22/B23: the human's front mouth, colours and dead code", () => {
  const ana = humanCharacter(human);
  it("the front mouth smiles symmetrically", () => {
    const pts = pathPoints(parsePath(part(ana, "mouthF")!.shapes.smile as string));
    const xs = pts.map((p) => p[0]);
    const l = pts[xs.indexOf(Math.min(...xs))], r = pts[xs.indexOf(Math.max(...xs))];
    expect(l[1]).toBeCloseTo(r[1], 5);
  });
  it("short hex colours shade correctly", () => {
    const p = ana.palette as Record<string, string>;
    expect(p.skinDark).toBe("#dbaf84");
    expect(p.irisDark).toBe("#174d36");
    expect(validateToon(ana).ok).toBe(true);
  });
  it("walkInPlace is gone; the builders stay valid", () => {
    expect((kit as Record<string, unknown>).walkInPlace).toBeUndefined();
    expect(validateToon(cartoonCharacter({ ...kid, name: "cap", hat: "capBack", top: "overalls", watch: undefined, boutonniere: undefined })).ok).toBe(true);
  });
});
