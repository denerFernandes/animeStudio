#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  type SceneDoc,
  type ToonDoc,
  compileScene,
  evaluateScene,
  frameToSVG,
  jsonSchemas,
  previewScene,
  validateScene,
  validateSequence,
  validateToon,
} from "@animestudio/core";
import { importSvg } from "@animestudio/import-svg";
import { type LipsyncEngine, lipsyncFile } from "@animestudio/lipsync/node";
import { describeCharacter } from "./describe";
import { debugDocument, doctor } from "./doctor";
import { loadSceneAssets, readJson } from "./load";

const HELP = `toon — animeStudio command line

Usage:
  toon validate <file.toon.json|.scene.json|.sequence.json>...   Validate documents (exit 1 on errors)
  toon describe <file.toon.json>                      List controls, clips and channels (great for AI prompts)
  toon schema [--out dir]                             Write JSON Schemas (toon, scene, sequence)
  toon lipsync <audio.wav> [--text "..."] [--lang pt] [--engine auto|rhubarb|align|amplitude] [-o cues.json]
  toon import-svg <drawing.svg> [--name id] [-o out.toon.json]
  toon render <file> [--time 1.5] [--clip walk] [-o frame.svg]   Render one frame to SVG
  toon debug <scene|sequence> [--from s] [--to s] [--json]   Diagnose library output frame by frame
  toon doctor <video.mp4> <scene|sequence> [--json]           Find flickers / unpainted nodes in a render
`;

function out(path: string | undefined, content: string) {
  if (path) {
    writeFileSync(path, content);
    console.error(`wrote ${path}`);
  } else process.stdout.write(content + "\n");
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      out: { type: "string", short: "o" },
      text: { type: "string" },
      lang: { type: "string" },
      engine: { type: "string" },
      name: { type: "string" },
      time: { type: "string" },
      clip: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      json: { type: "boolean" },
    },
  });

  switch (cmd) {
    case "validate": {
      let failed = false;
      for (const file of positionals) {
        const doc = readJson(file) as { format?: string };
        const result =
          doc.format === "toon-scene"
            ? validateScene(doc, loadSceneAssets(file, doc as SceneDoc))
            : doc.format === "toon-sequence"
              ? validateSequence(doc)
              : validateToon(doc);
        const errors = result.issues.filter((i) => i.severity === "error");
        console.log(`${errors.length || !result.ok ? "✗" : "✓"} ${file}`);
        for (const i of result.issues) console.log(`  ${i.severity === "error" ? "error" : "warn "} ${i.path}: ${i.message}`);
        if (!result.ok) failed = true;
      }
      process.exit(failed ? 1 : 0);
    }
    case "describe": {
      const r = validateToon(readJson(positionals[0]));
      if (!r.ok) throw new Error(r.issues.map((i) => `${i.path}: ${i.message}`).join("\n"));
      out(values.out, describeCharacter(r.value));
      return;
    }
    case "schema": {
      const dir = values.out ?? "schemas";
      mkdirSync(dir, { recursive: true });
      const s = jsonSchemas();
      writeFileSync(join(dir, "toon.schema.json"), JSON.stringify(s.toon, null, 2) + "\n");
      writeFileSync(join(dir, "scene.schema.json"), JSON.stringify(s.scene, null, 2) + "\n");
      writeFileSync(join(dir, "sequence.schema.json"), JSON.stringify(s.sequence, null, 2) + "\n");
      console.error(`wrote ${dir}/toon.schema.json, ${dir}/scene.schema.json, ${dir}/sequence.schema.json`);
      return;
    }
    case "lipsync": {
      const cues = await lipsyncFile(positionals[0], {
        text: values.text,
        language: values.lang,
        engine: (values.engine as LipsyncEngine) ?? "auto",
      });
      out(values.out, JSON.stringify(cues, null, 2));
      return;
    }
    case "import-svg": {
      const { doc, warnings } = importSvg(readFileSync(positionals[0], "utf8"), { name: values.name });
      for (const w of warnings) console.error(`warn ${w}`);
      out(values.out, JSON.stringify(doc, null, 2));
      return;
    }
    case "render": {
      const doc = readJson(positionals[0]) as { format?: string };
      const t = Number(values.time ?? 0);
      const scene =
        doc.format === "toon-scene"
          ? compileScene(doc as SceneDoc, loadSceneAssets(positionals[0], doc as SceneDoc))
          : previewScene(doc as ToonDoc, { clip: values.clip });
      out(values.out, frameToSVG(evaluateScene(scene, t)));
      return;
    }
    case "debug": {
      const issues = debugDocument(positionals[0], values.from ? Number(values.from) : 0, values.to ? Number(values.to) : undefined);
      if (values.json) return out(values.out, JSON.stringify(issues, null, 2));
      // Group identical findings across frames into ranges.
      const groups = new Map<string, { d: (typeof issues)[number]; frames: number[] }>();
      for (const d of issues) {
        const id = `${d.severity}|${d.kind}|${d.key ?? ""}|${d.message}`;
        const g = groups.get(id) ?? { d, frames: [] };
        g.frames.push(d.frame);
        groups.set(id, g);
      }
      const ranges = (fs: number[]) => {
        const out: string[] = [];
        let start = fs[0];
        let prev = fs[0];
        for (const f of [...fs.slice(1), NaN]) {
          if (f === prev + 1) prev = f;
          else {
            out.push(start === prev ? `f${start}` : `f${start}–${prev}`);
            start = prev = f;
          }
        }
        return out.length > 6 ? `${out.slice(0, 6).join(", ")}, … (${fs.length} frames)` : out.join(", ");
      };
      console.log(issues.length ? `${issues.length} findings in ${groups.size} groups` : "✓ no findings");
      for (const { d, frames } of [...groups.values()].sort((a, b) => b.frames.length - a.frames.length)) {
        console.log(`  [${d.severity}] ${d.kind}${d.key ? ` ${d.key}` : ""}: ${d.message} — ${ranges(frames)}`);
      }
      process.exit(issues.some((d) => d.severity === "error") ? 1 : 0);
    }
    case "doctor": {
      const report = await doctor(positionals[0], positionals[1]);
      if (values.json) return out(values.out, JSON.stringify(report, null, 2));
      console.log(`${report.frames} frames analyzed`);
      console.log(`A→B→A flickers: ${report.flickers.length}`);
      for (const fl of report.flickers.slice(0, 30)) {
        console.log(`  f${fl.frame} ${fl.time.toFixed(3)}s — ${fl.libStable ? "library output stable → browser paint/capture problem" : "library node set changed → animation/logic"}`);
      }
      const capture = report.flickers.filter((f) => f.libStable).map((f) => f.frame);
      if (capture.length > 0)
        console.log(`  Capture glitches are usually nondeterministic: re-render those frames (e.g. \`remotion still … --frame=${capture[0]}\`) or the whole video.`);
      if (report.strip) {
        console.log(
          `Debug strip: ${report.strip.frameMismatches.length} barcode mismatches, ${report.strip.unpainted.length} unpainted node sentinels` +
            ` (${report.strip.unverifiable} skipped: transparent or strongly blurred nodes)`,
        );
        const byKey = new Map<string, number[]>();
        for (const u of report.strip.unpainted) byKey.set(u.key, [...(byKey.get(u.key) ?? []), u.frame]);
        for (const [key, frames] of [...byKey].sort((a, b) => b[1].length - a[1].length)) {
          const node = report.strip.unpainted.find((u) => u.key === key)!;
          console.log(`  ${key}: not painted in ${frames.length} frames (${frames.slice(0, 12).join(", ")}${frames.length > 12 ? ", …" : ""})${node.filter ? ` · filter ${node.filter}` : ""}`);
        }
        for (const m of report.strip.frameMismatches.slice(0, 10)) console.log(`  f${m.frame}: barcode says ${m.barcode} (stale or reordered capture)`);
      } else console.log("No debug strip found (render with `debug: true` to pinpoint unpainted nodes).");
      return;
    }
    default:
      console.log(HELP);
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});

export { readFileSync };
