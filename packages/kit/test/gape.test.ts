import { describe, expect, it } from "vitest";
import { type ToonDoc, compileRig, evaluatePose, makeTrack, parsePath, renderCharacter, resolveChannel, validateToon } from "@animestudio/core";
import { type CartoonAnatomy, type CartoonLook, GAPE_FULL, cartoonAnatomy, cartoonCharacter } from "../src";

// The cartoon gape: the mouth opened to swallow something whole (`morph.gape`: 1 a big gape, 2 the
// jaw unhinged), the lower head following it.

const kid: CartoonLook = {
  name: "kid", build: "kid", skin: "#f6d3b5", hair: "ponytail", hairColor: "#5a3a22", accent: "#ff4fa0",
  top: "shirt", topColor: "#ffffff", pattern: "pinstripes", pocketItem: { color: "#ffffff" }, earItem: "cigarette",
  bottom: "bermuda", bottomColor: "#3a62b0", shoes: "sneakers", glasses: "sun", hat: "capBack", tie: "#a8202f",
};
const man: CartoonLook = {
  name: "man", build: "man", heavy: 0.95, skin: "#f0c7a5", hair: "receding", hairColor: "#3d2b20", top: "shirt", topColor: "#e3edf5",
  bottom: "pants", bottomColor: "#4a4f63", shoes: "dress", moustache: true, nose: "round",
};
const chibiLook: CartoonLook = { ...man, name: "chibi", heavy: 0, moustache: false };
/** A big head (the chibi recipe). */
const bigHead = (look: CartoonLook): CartoonAnatomy => {
  const a = cartoonAnatomy(look);
  a.body.head *= 2.05;
  a.body.torso *= 0.68;
  a.body.hip *= 0.55;
  a.body.neck *= 0.4;
  a.face.eye = [a.face.eye[0] * 1.5, a.face.eye[1] * 1.55];
  a.face.pupil *= 0.8;
  return a;
};

const cast: [string, ToonDoc][] = [
  ["kid", cartoonCharacter(kid)],
  ["man", cartoonCharacter(man)],
  ["chibi", cartoonCharacter(chibiLook, { anatomy: bigHead(chibiLook) })],
];

type Part = { id: string; type: string; base?: string; shapes?: Record<string, string>; art?: string };
const partOf = (doc: ToonDoc, id: string) => (doc.parts as unknown as Part[]).find((p) => p.id === id);
const unit = (doc: ToonDoc) => (doc.meta as { anatomy: CartoonAnatomy }).anatomy.body.head;

/** Points along a path (its cubic curves sampled). */
function sample(d: string): [number, number][] {
  return parsePath(d).flatMap((sp) => {
    const out: [number, number][] = [];
    let p0 = sp.start;
    for (const [c1, c2, e] of sp.segments) {
      for (let k = 0; k <= 10; k++) {
        const t = k / 10, mt = 1 - t;
        out.push([mt ** 3 * p0[0] + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t ** 3 * e[0], mt ** 3 * p0[1] + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t ** 3 * e[1]]);
      }
      p0 = e;
    }
    return out;
  });
}
const bbox = (pts: [number, number][]) => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};
/** A morph part's path at some weights (base + Σ w·(shape − base), point by point, as the engine does). */
function morphAt(p: Part, weights: Record<string, number>): [number, number][] {
  const base = sample(p.base!);
  const out = base.map((q): [number, number] => [q[0], q[1]]);
  for (const [k, w] of Object.entries(weights)) {
    const s = sample(p.shapes![k]);
    out.forEach((q, i) => {
      q[0] += (s[i][0] - base[i][0]) * w;
      q[1] += (s[i][1] - base[i][1]) * w;
    });
  }
  return out;
}
/** The drawn views that have a face: the profile (no suffix) and the others by their suffix. */
const FACE_VIEWS: [string, string][] = [["front", "F"], ["half", "H"], ["q24", "T"], ["profile", ""], ["q50", "U"], ["q64", "V"], ["q77", "W"], ["side", "S"]];

describe("cartoon gape", () => {
  for (const [name, doc] of cast) {
    describe(name, () => {
      const u = unit(doc);
      it("is a valid rig with no anatomy issues", () => {
        expect(validateToon(doc).ok).toBe(true);
        expect((doc.meta as { anatomyIssues: unknown[] }).anatomyIssues).toEqual([]);
      });

      it("has a gape on the mouth, teeth, tongue and jaw of every view with a face (and their mirrors)", () => {
        for (const [, s] of FACE_VIEWS) {
          for (const k of ["mouth", "teeth", "tongue", "jaw", "jawLine"]) {
            expect(partOf(doc, `${k}${s}`)?.shapes?.gape, `${k}${s}`).toBeTruthy();
            if (s !== "F") expect(partOf(doc, `${k}${s}~`)?.shapes?.gape, `${k}${s}~`).toBeTruthy();
          }
        }
        // No face from behind: no mouth there.
        expect(partOf(doc, "mouthK")).toBeUndefined();
      });

      it("opens far beyond viseme D, below the nose, the same flipped", () => {
        for (const [view, s] of FACE_VIEWS) {
          const mouth = partOf(doc, `mouth${s}`)!;
          const D = bbox(morphAt(mouth, { D: 1 })), G = bbox(morphAt(mouth, { gape: 1 }));
          expect(G.h, `${view} height`).toBeGreaterThanOrEqual(2 * D.h);
          expect(G.w, `${view} width`).toBeGreaterThanOrEqual(1.25 * D.w);
          // The top lip under the nose's drawing (where the face's nose is: its nostrils, in the
          // views that draw them; else the nose's height on the face).
          const nose = partOf(doc, `over${s}`)?.art ?? "";
          const nostrils = [...nose.matchAll(/<ellipse cx="[-\d.]+" cy="([-\d.]+)" rx="[-\d.]+" ry="([-\d.]+)"/g)].map((m) => Number(m[1]) + Number(m[2]));
          for (const w of [1, GAPE_FULL]) {
            const top = bbox(morphAt(mouth, { gape: w })).y0;
            if (nostrils.length) expect(top, `${view} gape ${w} below the nose`).toBeGreaterThan(Math.max(...nostrils));
          }
          if (s !== "F") {
            const mirrored = bbox(morphAt(partOf(doc, `mouth${s}~`)!, { gape: 1 }));
            expect(mirrored.w).toBeCloseTo(G.w, 1);
            expect(mirrored.h).toBeCloseTo(G.h, 1);
            expect(mirrored.x0).toBeCloseTo(-G.x1, 1);
          }
        }
      });

      it("unhinges at 2: the mouth as wide as the head, the chin a head radius lower, the outline following", () => {
        for (const [view, s] of [["front", "F"], ["half", "H"], ["profile", ""]] as const) {
          const head = bbox(sample(/d="([^"]+)"/.exec(doc.art![`head${s}`] as string)![1]));
          const mouth = bbox(morphAt(partOf(doc, `mouth${s}`)!, { gape: GAPE_FULL }));
          expect(mouth.w, `${view} mouth width`).toBeGreaterThanOrEqual((view === "profile" ? 0.75 : 0.9) * head.w);
          const line = partOf(doc, `jawLine${s}`)!;
          const rest = sample(line.base!), open = morphAt(line, { gape: GAPE_FULL });
          // The chin drops (≥ 0.8 head radius), the lower outline starts and ends on the head's.
          expect(bbox(open).y1 - bbox(rest).y1, `${view} chin drop`).toBeGreaterThanOrEqual(0.8 * u);
          for (const i of [0, rest.length - 1]) {
            expect(open[i][0]).toBeCloseTo(rest[i][0], 1);
            expect(open[i][1]).toBeCloseTo(rest[i][1], 1);
          }
          // At rest the jaw's outline is the head's chin (on its outline: inside its box).
          expect(bbox(rest).y1).toBeLessThanOrEqual(head.y1 + 2);
          expect(bbox(rest).y1).toBeGreaterThan(head.y1 - u * 0.15);
          // The open mouth inside the dropped jaw, a chin under it.
          expect(mouth.y1).toBeLessThan(bbox(open).y1 - u * 0.08);
          // The jaw's skin has no area at rest (nothing drawn), the full lower head open.
          expect(bbox(sample(partOf(doc, `jaw${s}`)!.base!)).h).toBeLessThanOrEqual(bbox(rest).h + 0.5);
        }
      });

      it("grows steadily from 0 to 2 (every in-between a valid shape: a close from 2 to 0 does not pop)", () => {
        for (const [, s] of FACE_VIEWS) {
          for (const k of ["mouth", "jaw", "jawLine"]) {
            const p = partOf(doc, `${k}${s}`)!;
            let last = { w: -1, h: -1 };
            for (const w of [0, 0.5, 1, 1.5, 2]) {
              const b = bbox(morphAt(p, { gape: w }));
              expect(b.w, `${k}${s} ${w}`).toBeGreaterThanOrEqual(last.w - 0.01);
              expect(b.h, `${k}${s} ${w}`).toBeGreaterThanOrEqual(last.h - 0.01);
              last = b;
            }
          }
          // The mouth never crosses itself: its top lip stays above its bottom along the way.
          const m = partOf(doc, `mouth${s}`)!;
          for (const w of [0.25, 0.5, 1, 1.5, 2]) {
            const pts = morphAt(m, { gape: w }), half = pts.length / 2;
            expect(pts[Math.floor(half / 2)][1]).toBeLessThan(pts[Math.floor(half + half / 2)][1]);
          }
        }
      });

      it("is driven by the emotion, the jaw control (weighted) and the mouth control", () => {
        const rig = compileRig(doc);
        const weight = (pose: ReturnType<typeof evaluatePose>, id: string) => pose.state.morph[rig.partIndex.get(id)!]?.gape ?? 0;
        const emotion = evaluatePose(rig, { controls: { emotion: "gape" } } as never);
        for (const id of ["mouth", "teeth", "tongue", "jaw", "jawLine", "mouthF", "teethF", "tongueF", "jawF", "mouth~", "jawH~"]) expect(weight(emotion, id), id).toBe(1);
        expect(emotion.state.variant[rig.partIndex.get("eyes")!]).toBe("wide");
        const unhinged = evaluatePose(rig, { controls: { jaw: { gape: 2 } } } as never);
        for (const id of ["mouth", "teeth", "tongue", "jaw", "jawLine", "mouthH", "jawLineF"]) expect(weight(unhinged, id), id).toBe(2);
        const viseme = evaluatePose(rig, { controls: { mouth: { gape: 1.5 } } } as never);
        for (const id of ["mouth", "teeth", "tongueF", "jawLineH"]) expect(weight(viseme, id), id).toBe(1.5);
        // `shut`: the mouth at rest.
        const shut = evaluatePose(rig, { controls: { jaw: "shut", mouth: "shut" } } as never);
        expect(weight(shut, "mouth")).toBe(0);
      });

      it("draws the open mouth on the dropped jaw with the head thrown back or down, in profile, half and front", () => {
        const rig = compileRig(doc);
        for (const [view, s] of [["profile", ""], ["half", "H"], ["front", "F"]] as const) {
          for (const rot of [20, -20]) {
            const tr = (ch: string, v: unknown) => ({ channel: ch, ref: resolveChannel(rig, ch), track: makeTrack([{ t: 0, v: v as never }]) });
            const posed = evaluatePose(rig, { time: 0, tracks: [tr("controls.view", view), tr("controls.jaw", { gape: 2 }), tr("bones.head.rotation", rot)] } as never);
            const nodes = renderCharacter(rig, posed);
            const d = (id: string) => {
              const n = nodes.find((x) => x.key === id);
              if (!n) return undefined;
              return n.kind === "path" ? n.d : /<path d="([^"]+)"[^>]*clip-path/.exec((n as { markup: string }).markup)?.[1];
            };
            const mouth = bbox(sample(d(`mouth${s}`)!)), jaw = bbox(sample(d(`jawLine${s}`)!));
            // Inside the jaw's outline box: the jaw turned with the head.
            expect(mouth.x0, `${view} ${rot}`).toBeGreaterThan(jaw.x0 - 1);
            expect(mouth.x1, `${view} ${rot}`).toBeLessThan(jaw.x1 + 1);
            expect(mouth.h, `${view} ${rot}`).toBeGreaterThan(u * 0.8);
          }
        }
      });
    });
  }
});
