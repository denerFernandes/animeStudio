import { describe, expect, it } from "vitest";
import { type ToonDoc, compileRig, currentVariant, evaluatePose, makeTrack, resolveChannel } from "../src";
import { stick } from "./fixtures";

// A variant set by a direct track is what the scene asked for: an emotion pose does not take it back.
const doc: ToonDoc = {
  ...stick,
  parts: [...stick.parts, { id: "eyes", type: "switch", bone: "head", variants: { open: "<circle r='2'/>", closed: "<path d='M-2 0h4'/>", happy: "<path d='M-2 0q2 -2 4 0'/>" }, default: "open" }],
  controls: { ...stick.controls, emotion: { type: "pose", poses: { neutral: {}, happy: { "parts.eyes.variant": "happy" } } } },
} as ToonDoc;

describe("direct-track variants win over pose variants", () => {
  const rig = compileRig(doc);
  const eyes = rig.partIndex.get("eyes")!;
  const tr = (ch: string, keys: [number, string | null][]) => ({ channel: ch, ref: resolveChannel(rig, ch), track: makeTrack(keys.map(([t, v]) => ({ t, v }))) });
  it("an emotion sets the eyes when nothing else does", () => {
    const p = evaluatePose(rig, { time: 0, tracks: [tr("controls.emotion", [[0, "happy"]])] });
    expect(currentVariant(rig, p.state, eyes)).toBe("happy");
  });
  it("a blink closes the eyes over the emotion, and letting go (null) gives them back to it", () => {
    const tracks = [tr("controls.emotion", [[0, "happy"]]), tr("parts.eyes.variant", [[0, null], [1, "closed"], [1.1, null]])];
    expect(currentVariant(rig, evaluatePose(rig, { time: 0.5, tracks }).state, eyes)).toBe("happy");
    expect(currentVariant(rig, evaluatePose(rig, { time: 1.05, tracks }).state, eyes)).toBe("closed");
    expect(currentVariant(rig, evaluatePose(rig, { time: 1.5, tracks }).state, eyes)).toBe("happy");
  });
});
