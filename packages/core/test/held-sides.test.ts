import { describe, expect, it } from "vitest";
import { type SceneDoc, type ToonDoc, anchorPosition, compileScene, evaluateScene, frameToSVG, propPlacement } from "../src";

// Holding a flat object (a phone): `fit` with `dir`, `face` and `fixed`. The long axis keeps its body
// direction however the wrist bends, the object shows its front (the screen) only while the front
// faces the camera and its `back` (the case) otherwise, it narrows to its edge seen side-on, and the
// holding hand wraps over its back but stays behind its front. Checked on the kit's cartoon character
// with the kit's `HOLD.phone` (screen towards the eyes) and its `texting` gesture.

const kit = await import("../../kit/src");
const look = { name: "bia", build: "woman", female: true, skin: "#a8704f", hair: "puffs", hairColor: "#2a1b14", top: "tank", topColor: "#e2584a", bottom: "pants", bottomColor: "#3b3f5c", shoes: "sneakers" } as const;
const doc: ToonDoc = kit.cartoonCharacter(look as never);

const FRONT = `<rect id="screen" x="-20" y="-110" width="40" height="120" fill="#9fd0f0"/>`;
const BACK = `<rect id="case" x="-20" y="-110" width="40" height="120" fill="#e2584a"/>`;

function scene(view: string, clip: string = kit.HOLD.phone.clip, extra: Partial<{ fixed: boolean; face: boolean }> = {}): SceneDoc {
  const fit = kit.holdFit("phone", [0, 0], [0, -100]) as Record<string, unknown>[];
  if (extra.fixed === false) delete fit[1].fixed;
  if (extra.face === false) delete fit[1].face;
  return {
    format: "toon-scene", version: 1, width: 400, height: 600, fps: 24, duration: 3, background: "#fff",
    characters: { c: "x" },
    actors: [{ id: "a", character: "c", x: 200, y: 580 }],
    props: [{ id: "phone", art: FRONT, back: BACK, x: 0, y: 0, scale: kit.HOLD.phone.scale }],
    script: [
      { at: 0, actor: "a", action: "pose", control: "view", value: view, duration: 0 },
      { at: 0, actor: "a", action: "play", clip, loop: true, fadeIn: 0 },
      { at: 0, actor: "a", action: "grab", prop: "phone", anchor: "hand", fit },
    ],
  } as unknown as SceneDoc;
}
const place = (sc: SceneDoc, t = 1) => {
  const c = compileScene(sc, { characters: { c: doc } });
  return { c, p: propPlacement(c, c.props[0], t) };
};

describe("holding a flat object", () => {
  it("shows the case from the front and the three-quarter views, the screen from behind", () => {
    for (const view of ["front", "half", "profile"]) expect(place(scene(view)).p.side, view).toBe("back");
    expect(place(scene("back")).p.side).toBe("front");
  });

  it("draws the matching side's art", () => {
    const svg = (v: string) => frameToSVG(evaluateScene(compileScene(scene(v), { characters: { c: doc } }), 1));
    expect(svg("front")).toContain('id="case"');
    expect(svg("front")).not.toContain('id="screen"');
    expect(svg("back")).toContain('id="screen"');
  });

  it("narrows to its edge seen side-on and is widest facing the camera", () => {
    const across = (v: string) => place(scene(v)).p.scale[0];
    expect(across("side")).toBeLessThan(across("front") * 0.4);
    expect(across("front")).toBeGreaterThan(kit.HOLD.phone.scale * 0.6);
  });

  it("keeps its long axis in the body's frame (fixed): the wrist's turn does not tip it over", () => {
    // Upright-ish in the picture from the front: the axis from the grip to the top points up.
    for (const view of ["front", "profile"]) {
      const { p } = place(scene(view));
      const r = (p.rotation * Math.PI) / 180;
      expect(Math.cos(r), view).toBeGreaterThan(0.5); // the art's −y (its top) points up on screen
    }
    // Without `fixed` it turns with the hand bone (the old behaviour): a different angle.
    expect(Math.abs(place(scene("profile", "texting", { fixed: false })).p.rotation - place(scene("profile")).p.rotation)).toBeGreaterThan(10);
  });

  it("is held in front of the lower chest, below the eyes, the head bent towards it", () => {
    const { c, p } = place(scene("profile"));
    const eye = anchorPosition(c, "a", "eye", 1), chest = anchorPosition(c, "a", "hand", 1);
    expect(p.y).toBeGreaterThan(eye[1]); // below the eyes
    expect(chest[0]).toBeGreaterThan(200); // in front of the body (facing right)
    expect(doc.clips?.texting?.tracks["bones.head.rotation"]).toBeTruthy();
  });

  it("the hand wraps over the case; from behind the phone is hidden behind the body", () => {
    // Top-level draw order: the holding hand gets its own node over the prop only on the case side.
    const keys = (v: string) => (evaluateScene(compileScene(scene(v), { characters: { c: doc } }), 1).nodes as { key: string }[]).map((n) => n.key);
    const f = keys("front");
    expect(f.indexOf("actor-a-hand")).toBeGreaterThan(f.indexOf("prop-phone"));
    // Seen from behind, the hand (and the phone in front of the chest) is behind the body: the phone is
    // drawn before her, hidden by her back — never pasted on it.
    const b = keys("back");
    expect(b).not.toContain("actor-a-hand");
    expect(b.indexOf("prop-phone")).toBeLessThan(b.indexOf("actor-a"));
  });

  it("two-handed (`also`): both hands wrap it", () => {
    const sc = scene("front", "textingTwo");
    const grab = (sc.script as Record<string, unknown>[]).find((a) => a.action === "grab")!;
    grab.also = kit.holdBoth;
    const nodes = evaluateScene(compileScene(sc, { characters: { c: doc } }), 1).nodes as { key: string; children?: { key: string }[] }[];
    const hand = nodes.find((n) => n.key === "actor-a-hand")!;
    const ids = JSON.stringify(hand.children?.map((c) => c.key));
    expect(ids).toContain("handF");
    expect(ids).toContain("handB");
  });

  it("without `face` it is drawn as before (one side, its `art`)", () => {
    expect(place(scene("front", "texting", { face: false })).p.side).toBeUndefined();
  });
});
