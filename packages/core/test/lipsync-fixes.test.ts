import { describe, expect, it } from "vitest";
import { type RigControl, type RigPart, cuesFromAmplitude, visemeVariant } from "../src";

// ---------------------------------------------------------------- B13: transitive viseme fallbacks

describe("viseme fallbacks", () => {
  const control = { type: "viseme", name: "mouth", parts: [0], map: {} } as Extract<RigControl, { type: "viseme" }>;
  const mouth = (...names: string[]): RigPart => ({ id: "mouth", index: 0, z: 0, opacity: 1, visible: true, type: "switch", bone: 0, variants: Object.fromEntries(names.map((n) => [n, ""])), default: names[0], space: "setup" });
  it("follow the chain until a drawn shape is found", () => {
    expect(visemeVariant(control, mouth("A", "B", "X"), "E")).toBe("B");
    expect(visemeVariant(control, mouth("D", "X"), "H")).toBe("D");
    expect(visemeVariant(control, mouth("X"), "E")).toBe("X");
    expect(visemeVariant(control, mouth("A", "X"), "G")).toBe("A");
  });
  it("prefer the viseme itself, then its own fallbacks in order", () => {
    expect(visemeVariant(control, mouth("A", "B", "C", "D", "E", "F", "X"), "E")).toBe("E");
    expect(visemeVariant(control, mouth("A", "B", "D", "F", "X"), "E")).toBe("F");
  });
  it("apply the control's map at every step", () => {
    const mapped = { ...control, map: { B: "closed" } };
    expect(visemeVariant(mapped, mouth("closed", "X"), "E")).toBe("closed");
  });
  it("give up only when nothing in the chain is drawn", () => {
    expect(visemeVariant(control, mouth("smile"), "E")).toBeUndefined();
  });
});

// ---------------------------------------------------------------- B10: loudness cues

describe("cuesFromAmplitude", () => {
  const tone = (seconds: number, rate: number, amp: number) => Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => amp * Math.sin((i / rate) * 2 * Math.PI * 220));
  const join = (...parts: Float32Array[]) => {
    const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  };
  it("survives very long audio (no spread of the samples onto the stack)", () => {
    // One sample per window: 200 000 windows.
    const cues = cuesFromAmplitude(new Float32Array(200000).fill(0.5), 30);
    expect(cues.length).toBeGreaterThan(1);
    expect(cues[cues.length - 1].end).toBeCloseTo(200000 / 30, 3);
  });
  it("keeps its variety after the merge: every cue lasts at least two frames", () => {
    const cues = cuesFromAmplitude(join(tone(1, 48000, 1), tone(1, 48000, 0.3), tone(1, 48000, 0.15), tone(0.5, 48000, 0)), 48000);
    const values = new Set(cues.map((c) => c.value));
    for (const v of ["D", "E", "C", "A", "B", "X"]) expect(values.has(v as never), `has ${v}`).toBe(true);
    for (const c of cues) expect(c.end - c.start).toBeGreaterThan(2 / 30 - 1e-6);
    for (let i = 1; i < cues.length; i++) expect(cues[i].start).toBe(cues[i - 1].end);
    expect(cues[0].start).toBe(0);
  });
  it("is deterministic and honours offset and window", () => {
    const a = cuesFromAmplitude(tone(1, 44100, 1), 44100, { offset: 2 });
    expect(a).toEqual(cuesFromAmplitude(tone(1, 44100, 1), 44100, { offset: 2 }));
    expect(a[0].start).toBe(2);
    // A shorter window still holds every shape for two frames; a longer one is its own hold.
    for (const c of cuesFromAmplitude(tone(1, 48000, 1), 48000, { window: 1 / 120 })) expect(c.end - c.start).toBeGreaterThan(2 / 30 - 1e-6);
    for (const c of cuesFromAmplitude(tone(1, 48000, 1), 48000, { window: 0.2 })) expect(c.end - c.start).toBeGreaterThan(0.2 - 1e-6);
  });
});
