/**
 * The promo's sound: Maya's English line (ElevenLabs, with character timestamps → lip sync cues),
 * the effects and the music bed, cached on disk. Run: npx tsx examples/promo/sound.ts [--force]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type CharacterAlignment, cuesFromAlignment } from "@animestudio/core";

const API = "https://api.elevenlabs.io/v1";
const dir = import.meta.dirname;
const key = () => readFileSync(join(dir, "../../.env.test"), "utf8").match(/^ELEVENLABS_API_SECRET=(.+)$/m)![1].trim();
async function post(path: string, body: unknown): Promise<Response> {
  const res = await fetch(`${API}${path}`, { method: "POST", headers: { "xi-api-key": key(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`ElevenLabs ${path} → ${res.status}: ${await res.text()}`);
  return res;
}
const duration = (f: string) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim());

/** English voices (ElevenLabs premade). */
const LINES = {
  maya: { voice: "cgSgspJ2msm6clMCkdW9", text: "[excited] Hi! I'm made of pure JSON... [laughs] and I can talk!" },
};
const SFX: Record<string, { text: string; seconds: number; influence?: number }> = {
  music: { text: "Upbeat bouncy cartoon promo music, playful pizzicato, ukulele, claps and glockenspiel, bright and catchy, energetic, instrumental, no vocals", seconds: 30, influence: 0.4 },
  whoosh: { text: "Quick clean swoosh transition whoosh", seconds: 0.6, influence: 0.6 },
  pop: { text: "Cartoon bubble pop, short and bright", seconds: 0.5, influence: 0.7 },
  sparkle: { text: "Magical sparkle chime twinkle, short", seconds: 1, influence: 0.6 },
  punch: { text: "Cartoon punch impact, comedic whack", seconds: 0.6, influence: 0.7 },
  bell: { text: "Boxing ring bell ding ding", seconds: 1.2, influence: 0.7 },
  birdie: { text: "Cartoon dizzy birds tweeting, comedic", seconds: 1.5, influence: 0.6 },
  crickets: { text: "Night crickets in a quiet park", seconds: 4, influence: 0.5 },
  sting: { text: "Bright triumphant logo sting, short orchestral hit with chimes", seconds: 2, influence: 0.5 },
  steps: { text: "Cartoon tiptoe sneaking footsteps, plucked strings", seconds: 3, influence: 0.5 },
};

const adir = join(dir, "audio"), ddir = join(dir, "data");
mkdirSync(adir, { recursive: true });
mkdirSync(ddir, { recursive: true });
const force = process.argv.includes("--force");
/** File names in `audio/`, durations, lip sync cues and word starts, for shots.ts. */
const out = { durations: {} as Record<string, number>, cues: {} as Record<string, unknown>, files: {} as Record<string, string>, words: {} as Record<string, [string, number][]> };
/** Audio tags (`[laughs]`) blanked in the alignment: acted, not spoken (no mouth shapes). */
const untagged = (a: CharacterAlignment): CharacterAlignment => {
  let inTag = false;
  return { ...a, characters: a.characters.map((c) => { if (c === "[") inTag = true; const o = inTag ? " " : c; if (c === "]") inTag = false; return o; }) };
};
for (const [id, l] of Object.entries(LINES)) {
  const mp3 = join(adir, `${id}.mp3`), al = join(ddir, `${id}.align.json`);
  if (force || !existsSync(mp3)) {
    console.log(`TTS ${id}…`);
    const res = await post(`/text-to-speech/${l.voice}/with-timestamps?output_format=mp3_44100_128`, {
      text: l.text, model_id: "eleven_v4", voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.6, use_speaker_boost: true },
    });
    const json = (await res.json()) as { audio_base64: string; alignment: CharacterAlignment };
    writeFileSync(mp3, Buffer.from(json.audio_base64, "base64"));
    writeFileSync(al, JSON.stringify(json.alignment));
  }
  const a = untagged(JSON.parse(readFileSync(al, "utf8")));
  out.cues[id] = cuesFromAlignment(a);
  // Each word's start (for timing reactions on words).
  const text = a.characters.join("");
  out.words[id] = [...text.matchAll(/[A-Za-z']+/g)].map((m) => [m[0].toLowerCase(), a.character_start_times_seconds[m.index!]]);
  out.durations[id] = duration(mp3);
  out.files[id] = `${id}.mp3`;
}
for (const [id, s] of Object.entries(SFX)) {
  const mp3 = join(adir, `${id}.mp3`);
  if (force || !existsSync(mp3)) {
    console.log(`SFX ${id}…`);
    const res = await post("/sound-generation", { text: s.text, duration_seconds: s.seconds, prompt_influence: s.influence ?? 0.5 });
    writeFileSync(mp3, Buffer.from(await res.arrayBuffer()));
  }
  out.durations[id] = duration(mp3);
  out.files[id] = `${id}.mp3`;
}
writeFileSync(join(ddir, "audio.json"), JSON.stringify(out, null, 1));
console.log(Object.fromEntries(Object.entries(out.durations).map(([k, v]) => [k, v.toFixed(2)])), out.words);
