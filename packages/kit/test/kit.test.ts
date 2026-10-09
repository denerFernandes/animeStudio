import { describe, expect, it } from "vitest";
import { type ToonDoc, compileRig, evaluatePose, validateToon } from "@animestudio/core";
import { blinkAndBreathe, characterClips, emotions, limbBones, limbIk, rigInfo, withProportions } from "../src";

/** A minimal kit character (stick figure with the kit bone layout). */
const doc = {
  format: "toon",
  version: 1,
  name: "kid",
  palette: { ink: "#222" },
  art: { head: "<circle cx='0' cy='-200' r='40'/>", eye: "<circle cx='10' cy='-205' r='5'/>" },
  skeleton: [
    { id: "root" },
    { id: "hips", parent: "root", from: [0, -60], to: [0, -66] },
    { id: "body", parent: "hips", from: [0, -60], to: [0, -150] },
    { id: "head", parent: "body", from: [0, -150], to: [0, -240] },
    { id: "pupils", parent: "head", from: [10, -205] },
    ...limbBones({
      shoulderF: [10, -140], elbowF: [14, -105], handF: [16, -70],
      shoulderB: [-10, -140], elbowB: [-14, -105], handB: [-16, -70],
      hipF: [8, -60], kneeF: [9, -30], footF: [8, -4], toeF: 10,
      hipB: [-8, -60], kneeB: [-7, -30], footB: [-8, -4], toeB: 10,
    }),
  ],
  parts: [
    { id: "head", type: "rigid", bone: "head", art: "head" },
    { id: "eyes", type: "switch", bone: "head", variants: { open: "eye", closed: "eye", happy: "eye", wide: "eye" }, default: "open" },
    { id: "mouth", type: "morph", bone: "head", base: "M-10 -180 L10 -180", shapes: { D: "M-10 -180 L10 -170", smile: "M-10 -182 L10 -182", frown: "M-10 -178 L10 -178", grin: "M-10 -182 L10 -176", E: "M-8 -180 L8 -176" } },
  ],
  anchors: { head: { bone: "head", at: [0, -200] }, hand: { bone: "handF", at: [16, -70] } },
  ik: limbIk,
  controls: { mouth: { type: "viseme", part: "mouth" }, emotion: { type: "pose", poses: { neutral: { "parts.eyes.variant": "open" } } } },
  behaviors: blinkAndBreathe().slice(1),
  clips: characterClips({ walk: { a: 10, lift: 8, dur: 0.6, bob: 2, lean: 2, armSwing: 10 }, run: { a: 16, lift: 14, dur: 0.4, bob: 3, lean: 4, armSwing: 20 }, jump: 40 }),
} as unknown as ToonDoc;

describe("kit", () => {
  it("builds valid characters with the shared clips", () => {
    expect(validateToon(doc).ok).toBe(true);
    expect(Object.keys(doc.clips!)).toContain("flap");
    expect(emotions().poses).toHaveProperty("angry");
  });

  it("re-proportions a character (smaller head, longer legs) and keeps it valid", () => {
    const adult = withProportions(doc, { head: 0.8, torso: 1.2, legs: 1.5, arms: 1.1 });
    expect(validateToon(adult).ok).toBe(true);
    const b = (d: ToonDoc, id: string) => (d.skeleton as { id: string; from: number[]; to?: number[] }[]).find((x) => x.id === id)!;
    expect(b(adult, "hips").from[1]).toBeCloseTo(-90); // legs × 1.5
    expect(b(adult, "head").from[1]).toBeCloseTo(-90 - 90 * 1.2); // the neck moved up with the torso
    const len = (d: ToonDoc) => Math.abs(b(d, "head").to![1] - b(d, "head").from[1]);
    expect(len(adult)).toBeCloseTo(len(doc) * 0.8);
    expect(rigInfo(adult, { extent: { front: 40, back: 40 }, height: 300 }).armLength.F).toBeCloseTo(rigInfo(doc, { extent: { front: 40, back: 40 }, height: 240 }).armLength.F * 1.1, 1);
    expect(() => evaluatePose(compileRig(adult), { time: 0.3 })).not.toThrow();
  });
});
