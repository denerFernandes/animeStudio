import { z } from "zod";
import { compileRig } from "../rig";
import { compileScene, type SceneAssets } from "../scene";
import { type SceneDoc, SceneSchema, type SequenceDoc, SequenceSchema, type ToonDoc, ToonSchema } from "./schema";

export interface Issue {
  /** JSON path of the problem, e.g. `parts[3].bone`. */
  path: string;
  message: string;
  severity: "error" | "warning";
}

export type ValidationResult<T> = { ok: true; value: T; issues: Issue[] } | { ok: false; issues: Issue[] };

function formatPath(path: PropertyKey[]): string {
  return path.reduce<string>((acc, seg) => {
    if (typeof seg === "number") return `${acc}[${seg}]`;
    return acc ? `${acc}.${String(seg)}` : String(seg);
  }, "");
}

function zodIssues(error: z.ZodError): Issue[] {
  return error.issues.map((i) => ({ path: formatPath(i.path) || "(root)", message: i.message, severity: "error" as const }));
}

function paletteWarnings(doc: ToonDoc): Issue[] {
  const palette = doc.palette ?? {};
  const issues: Issue[] = [];
  const scan = (text: string | undefined, path: string) => {
    if (!text) return;
    for (const m of text.matchAll(/palette\(\s*([\w-]+)\s*\)/g)) {
      if (!(m[1] in palette)) issues.push({ path, message: `unknown palette color "${m[1]}"`, severity: "warning" });
    }
  };
  scan(doc.defs, "defs");
  for (const [k, v] of Object.entries(doc.art ?? {})) scan(v, `art.${k}`);
  doc.parts.forEach((p, i) => scan(JSON.stringify(p), `parts[${i}]`));
  return issues;
}

/**
 * Validates a character document: schema, references, hierarchy and compilability.
 * Error messages are written to be actionable by humans and AI agents alike.
 */
export function validateToon(input: unknown): ValidationResult<ToonDoc> {
  const parsed = ToonSchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: zodIssues(parsed.error) };
  const issues = paletteWarnings(parsed.data);
  try {
    compileRig(parsed.data);
  } catch (e) {
    const err = e as Error & { path?: string };
    return { ok: false, issues: [...issues, { path: err.path ?? "(root)", message: err.message, severity: "error" }] };
  }
  return { ok: true, value: parsed.data, issues };
}

/** Validates a scene document. When assets are given, the whole scene is compiled. */
export function validateScene(input: unknown, assets?: SceneAssets): ValidationResult<SceneDoc> {
  const parsed = SceneSchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: zodIssues(parsed.error) };
  const issues: Issue[] = [];
  const doc = parsed.data;
  for (const [i, a] of (doc.actors ?? []).entries()) {
    if (!(a.character in doc.characters)) {
      issues.push({ path: `actors[${i}].character`, message: `"${a.character}" is not declared in "characters"`, severity: "error" });
    }
  }
  if (issues.length) return { ok: false, issues };
  if (assets) {
    try {
      compileScene(doc, assets);
    } catch (e) {
      const err = e as Error & { path?: string };
      return { ok: false, issues: [{ path: err.path ?? "(root)", message: err.message, severity: "error" }] };
    }
  }
  return { ok: true, value: doc, issues };
}

/** Validates a sequence document (shots must reference declared scenes). */
export function validateSequence(input: unknown): ValidationResult<SequenceDoc> {
  const parsed = SequenceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: zodIssues(parsed.error) };
  const issues: Issue[] = [];
  parsed.data.shots.forEach((shot, i) => {
    if (!(shot.scene in parsed.data.scenes)) {
      issues.push({ path: `shots[${i}].scene`, message: `"${shot.scene}" is not declared in "scenes"`, severity: "error" });
    }
  });
  return issues.length ? { ok: false, issues } : { ok: true, value: parsed.data, issues };
}

/** Parses and validates, throwing a readable error listing every issue. */
export function parseToon(input: unknown): ToonDoc {
  const r = validateToon(input);
  if (!r.ok) throw new Error(`Invalid toon document:\n${r.issues.map((i) => `  - ${i.path}: ${i.message}`).join("\n")}`);
  return r.value;
}

export function parseScene(input: unknown, assets?: SceneAssets): SceneDoc {
  const r = validateScene(input, assets);
  if (!r.ok) throw new Error(`Invalid scene document:\n${r.issues.map((i) => `  - ${i.path}: ${i.message}`).join("\n")}`);
  return r.value;
}

/** JSON Schemas (draft 2020-12) for editors and LLM structured output. */
export function jsonSchemas(): { toon: unknown; scene: unknown; sequence: unknown } {
  return {
    toon: z.toJSONSchema(ToonSchema, { io: "input", unrepresentable: "any" }),
    scene: z.toJSONSchema(SceneSchema, { io: "input", unrepresentable: "any" }),
    sequence: z.toJSONSchema(SequenceSchema, { io: "input", unrepresentable: "any" }),
  };
}
