import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { alignTextToAudio } from "../src";
import { hasRhubarb, lipsyncFile, readWav, rhubarb } from "../src/node";

const wav = join(__dirname, "../../../examples/scenes/audio/l2.wav");

describe("lipsync (node)", () => {
  it("decodes WAV files", () => {
    const { samples, sampleRate } = readWav(wav);
    expect(sampleRate).toBe(44100);
    expect(samples.length / sampleRate).toBeGreaterThan(1);
  });

  it("aligns text to audio without external tools", () => {
    const { samples, sampleRate } = readWav(wav);
    const cues = alignTextToAudio("Oba! Chuta pra mim!", samples, sampleRate);
    expect(cues[cues.length - 1].value).toBe("X");
    for (let i = 1; i < cues.length; i++) expect(cues[i].start).toBeCloseTo(cues[i - 1].end, 6);
  });

  it.skipIf(!hasRhubarb())("runs Rhubarb with the phonetic recognizer for Portuguese", async () => {
    const doc = await rhubarb(wav, { language: "pt" });
    expect(doc.mouthCues.length).toBeGreaterThan(3);
    expect(doc.mouthCues.some((c) => c.value !== "X")).toBe(true);
    const auto = await lipsyncFile(wav, { language: "pt" });
    expect(auto.mouthCues).toEqual(doc.mouthCues.map((c) => ({ ...c, start: Math.round(c.start * 1000) / 1000, end: Math.round(c.end * 1000) / 1000 })));
  });
});
