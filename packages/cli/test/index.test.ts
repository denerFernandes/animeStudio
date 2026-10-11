import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as cli from "../src";

const examples = join(__dirname, "../../../examples");
const hello = join(examples, "scenes/hello.scene.json");
const bin = join(__dirname, "../src/bin.ts");
const tsx = createRequire(join(__dirname, "../package.json")).resolve("tsx/cli");

/** Runs `toon` with the given arguments. */
const toon = (...args: string[]) => {
  const r = spawnSync(process.execPath, [tsx, bin, ...args], { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};

describe("@animestudio/cli as a library (M25)", () => {
  it("exports what docs/API.md promises, without running the command line", () => {
    for (const name of ["debugDocument", "doctor", "loadEvaluable", "describeCharacter", "loadSceneAssets", "readJson"] as const) {
      expect(typeof cli[name], name).toBe("function");
    }
  });

  it("loads and diagnoses a scene", () => {
    const doc = cli.readJson(hello) as { format?: string; characters: Record<string, string> };
    expect(doc.format).toBe("toon-scene");
    const assets = cli.loadSceneAssets(hello, doc as never);
    expect(Object.keys(assets.characters)).toEqual(Object.keys(doc.characters));
    const ev = cli.loadEvaluable(hello);
    expect(ev.fps).toBeGreaterThan(0);
    expect(ev.frameAt(0).nodes.length).toBeGreaterThan(0);
    expect(Array.isArray(cli.debugDocument(hello, 0, 0.1))).toBe(true);
    expect(cli.describeCharacter(Object.values(assets.characters)[0])).toContain("# Character");
  });
});

describe("toon command line (M26, B40)", () => {
  it("prints the help and exits 0 for --help, -h and no command; an unknown command exits 1", () => {
    for (const args of [["--help"], ["-h"], [], ["validate", "--help"]]) {
      const r = toon(...args);
      expect(r.status, args.join(" ")).toBe(0);
      expect(r.stdout).toContain("Usage:");
    }
    const bad = toon("frobnicate");
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('unknown command "frobnicate"');
  });

  it("rejects an unknown --engine before touching the audio", () => {
    const r = toon("lipsync", "nowhere.wav", "--engine", "nope");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--engine must be one of auto, rhubarb, align, amplitude");
  });

  it("validates the schema first, reports unloadable assets per file and goes on with the next file", () => {
    const dir = mkdtempSync(join(tmpdir(), "toon-validate-"));
    const noCharacters = join(dir, "no-characters.scene.json");
    writeFileSync(noCharacters, JSON.stringify({ format: "toon-scene", version: 1, width: 10, height: 10, fps: 30, duration: 1 }));
    const missingFile = join(dir, "missing.scene.json");
    writeFileSync(
      missingFile,
      JSON.stringify({ format: "toon-scene", version: 1, width: 10, height: 10, fps: 30, duration: 1, characters: { pip: "nowhere.toon.json" }, actors: [{ id: "p", character: "pip", x: 0, y: 0 }] }),
    );
    const notJson = join(dir, "broken.scene.json");
    writeFileSync(notJson, "{ nope");
    const r = toon("validate", noCharacters, missingFile, notJson, hello);
    expect(r.status).toBe(1);
    expect(r.stderr).toBe("");
    const lines = r.stdout.split("\n");
    expect(lines.filter((l) => l.startsWith("✗ "))).toHaveLength(3);
    expect(lines.find((l) => l.startsWith("✓ "))).toContain("hello.scene.json");
    expect(r.stdout).toContain("error characters: ");
    expect(r.stdout).toMatch(/error characters\.pip: cannot load "nowhere\.toon\.json"/);
    expect(r.stdout).toMatch(/error \(file\): /);
  });

  it("debug --json exits with the findings' severity, like the text report", () => {
    const r = toon("debug", hello, "--to", "0.1", "--json");
    const issues = JSON.parse(r.stdout) as { severity: string }[];
    expect(Array.isArray(issues)).toBe(true);
    expect(r.status).toBe(issues.some((i) => i.severity === "error") ? 1 : 0);
  });
});
