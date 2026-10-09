import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type ToonDoc, apply, compileRig, validateToon } from "@animestudio/core";
import { describe, expect, it } from "vitest";
import {
  addBone,
  addClip,
  allChannels,
  blankToon,
  clipValue,
  deleteBone,
  moveKey,
  movePart,
  removeKey,
  renameBone,
  setKey,
  setKeySeamless,
  toSetupForm,
  trackKeys,
} from "../src/doc";

const pip = JSON.parse(readFileSync(join(__dirname, "../../../examples/characters/pip.toon.json"), "utf8")) as ToonDoc;
const valid = (doc: ToonDoc) => {
  const r = validateToon(doc);
  expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  return r.ok;
};

describe("editor document operations", () => {
  it("creates a valid blank character", () => {
    expect(valid(blankToon())).toBe(true);
  });

  it("converts local-form bones to setup form without moving them", () => {
    const local: ToonDoc = {
      ...blankToon(),
      skeleton: [
        { id: "root" },
        { id: "a", parent: "root", x: 10, y: -20, rotation: -90, length: 50 },
        { id: "b", parent: "a", x: 50, y: 0, rotation: 30, length: 20 },
      ],
      parts: [],
      clips: {},
    };
    const before = compileRig(local);
    const after = compileRig(toSetupForm(local));
    before.bones.forEach((b, i) => {
      const p = apply(b.setupWorld, [b.length, 0]);
      const q = apply(after.bones[i].setupWorld, [after.bones[i].length, 0]);
      expect(q[0]).toBeCloseTo(p[0], 1);
      expect(q[1]).toBeCloseTo(p[1], 1);
    });
  });

  it("sets, moves and removes keys", () => {
    let doc = setKey(pip, "wave", "bones.head.rotation", 0.5, 12);
    expect(trackKeys(doc, "wave", "bones.head.rotation").some((k) => k[0] === 0.5 && k[1] === 12)).toBe(true);
    // Overwrites an existing key at the same time and keeps its easing.
    doc = setKey(doc, "wave", "bones.head.rotation", 0.5, 20);
    expect(trackKeys(doc, "wave", "bones.head.rotation").filter((k) => k[0] === 0.5)).toHaveLength(1);
    const keys = trackKeys(doc, "wave", "bones.head.rotation");
    const i = keys.findIndex((k) => k[0] === 0.5);
    const moved = moveKey(doc, "wave", "bones.head.rotation", i, 0.7);
    expect(trackKeys(moved.doc, "wave", "bones.head.rotation")[moved.index][0]).toBe(0.7);
    const removed = removeKey(moved.doc, "wave", "bones.head.rotation", moved.index);
    expect(trackKeys(removed, "wave", "bones.head.rotation").some((k) => k[0] === 0.7)).toBe(false);
    expect(valid(removed)).toBe(true);
  });

  it("keeps loop seams seamless", () => {
    const doc = setKeySeamless(pip, "wave", "bones.armNear1.rotation", 0, -70);
    const keys = trackKeys(doc, "wave", "bones.armNear1.rotation");
    expect(keys[0][1]).toBe(-70);
    expect(keys[keys.length - 1][1]).toBe(-70);
  });

  it("samples clip values", () => {
    expect(clipValue(pip, "wave", "bones.armNear1.rotation", 0)).toBeCloseTo(-60);
    expect(clipValue(pip, "wave", "bones.nope.rotation", 0)).toBeUndefined();
  });

  it("renames bones everywhere", () => {
    const doc = renameBone(pip, "head", "noggin");
    expect(valid(doc)).toBe(true);
    const rig = compileRig(doc);
    expect(rig.boneIndex.has("noggin")).toBe(true);
    expect(rig.boneIndex.has("head")).toBe(false);
    expect(JSON.stringify(doc)).not.toMatch(/bones\.head\./);
    expect(doc.anchors?.head.bone).toBe("noggin");
    expect(doc.parts.find((p) => p.id === "head")).toMatchObject({ bone: "noggin" });
  });

  it("adds and deletes bones keeping the document valid", () => {
    const { doc, id } = addBone(pip, "head", [0, -350], [0, -380], "antenna");
    expect(valid(doc)).toBe(true);
    expect(doc.skeleton.findIndex((b) => b.id === id)).toBeGreaterThan(doc.skeleton.findIndex((b) => b.id === "head"));
    for (const bone of ["armNear1", "tail2", "head", "legFar1"]) {
      expect(valid(deleteBone(pip, bone))).toBe(true);
    }
  });

  it("reorders parts and manages clips", () => {
    const doc = movePart(pip, "tail", 3);
    expect(doc.parts.findIndex((p) => p.id === "tail")).toBe(pip.parts.findIndex((p) => p.id === "tail") + 3);
    const { doc: d2, name } = addClip(pip, "wave", "wave");
    expect(name).toBe("wave2");
    expect(valid(d2)).toBe(true);
  });

  it("lists channels", () => {
    const channels = allChannels(compileRig(pip));
    expect(channels).toContain("bones.head.rotation");
    expect(channels).toContain("parts.mouth.morph.D");
    expect(channels).toContain("controls.emotion");
  });
});
