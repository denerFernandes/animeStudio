import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Documentation guard: every runtime export of the public packages must be mentioned in
 * docs/API.md. Add new functions to the docs in the same change.
 */
const api = readFileSync(join(__dirname, "../../../docs/API.md"), "utf8");

const packages: Record<string, () => Promise<Record<string, unknown>>> = {
  "@animestudio/core": () => import("../src"),
  "@animestudio/rigid": () => import("../../rigid/src"),
  "@animestudio/lipsync": () => import("../../lipsync/src"),
  "@animestudio/lipsync/node": () => import("../../lipsync/src/node"),
  "@animestudio/import-svg": () => import("../../import-svg/src"),
  "@animestudio/react": () => import("../../react/src"),
};

describe("docs/API.md", () => {
  for (const [name, load] of Object.entries(packages)) {
    it(`documents every export of ${name}`, async () => {
      const mod = await load();
      const missing = Object.keys(mod).filter((k) => !new RegExp(`\\b${k}\\b`).test(api));
      expect(missing, `Undocumented exports in ${name} — add them to docs/API.md`).toEqual([]);
    });
  }
});
