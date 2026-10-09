import { FX_TYPES } from "@animestudio/core";
import { ACTIONS, CAMERAS, MOODS, wardrobeOf } from "./direct";
import type { Kit } from "./types";

type Doc = { clips?: Record<string, unknown>; controls?: Record<string, { type: string; poses?: Record<string, unknown> }>; parts?: { id: string; type: string; variants?: Record<string, unknown> }[] };

/** A compact catalogue of what a staging can use (for an AI prompt). */
export function describeKit(kit: Kit) {
  const doc = (id: string) => kit.characters[id] as unknown as Doc;
  return {
    cast: Object.fromEntries(
      Object.entries(kit.cast).map(([id, c]) => {
        const d = doc(id);
        return [
          id,
          {
            name: c.name,
            ...(c.aliases?.length ? { aliases: c.aliases } : {}),
            clips: Object.keys(d?.clips ?? {}).filter((k) => !["idle", "turn", "walkDepth"].includes(k)),
            emotions: Object.keys(d?.controls?.emotion?.poses ?? {}),
            views: Object.keys(d?.controls?.view?.poses ?? { profile: 1 }),
            canFly: !!(d as { meta?: { canFly?: boolean } } | undefined)?.meta?.canFly || !!d?.clips?.fly,
            wear: wardrobeOf(d),
          },
        ];
      }),
    ),
    sets: Object.fromEntries(
      Object.entries(kit.sets).map(([id, s]) => [
        id,
        {
          marks: Object.keys(s.marks),
          // Places to sit drawn in the set (height above the ground), and the ones to lie on.
          // Furniture that is part of the set (id → kind): sit / lie on it with `on: id`.
          furniture: Object.fromEntries((s.furniture ?? []).map((f) => [f.id, f.kind])),
          seats: Object.fromEntries(Object.entries(s.marks).filter(([, m]) => m.seat !== undefined).map(([id, m]) => [id, m.lie ? { seat: m.seat, lie: true } : { seat: m.seat }])),
          depth: s.ground.far !== undefined,
          fixtures: Object.fromEntries(
            (s.fixtures ?? []).map((f) => {
              const part = (f.channel ?? "parts.light.variant").split(".")[1];
              const variants = doc(f.character)?.parts?.find((p) => p.id === part)?.variants;
              return [f.id, variants ? Object.keys(variants) : []];
            }),
          ),
        },
      ]),
    ),
    props: Object.keys(kit.props),
    vehicles: Object.keys(kit.vehicles ?? {}),
    /** Furniture kinds: can one sit (seat anchor) and/or lie (bed anchor) on it, and its wardrobe. */
    furniture: Object.fromEntries(
      Object.entries(kit.furniture ?? {}).map(([kind, f]) => {
        const anchors = (doc(f.character) as { anchors?: Record<string, unknown> } | undefined)?.anchors ?? {};
        return [kind, { sit: !!anchors.seat, lie: !!(anchors.bed ?? anchors.seat), wear: wardrobeOf(doc(f.character)) }];
      }),
    ),
    /** Vehicles the cast can ride (rig with a "seat" anchor) and their wardrobe (e.g. training wheels). */
    rides: Object.fromEntries(
      Object.entries(kit.vehicles ?? {})
        .filter(([, v]) => (doc(v.character) as { anchors?: Record<string, unknown> } | undefined)?.anchors?.seat)
        .map(([kind, v]) => [kind, { wear: wardrobeOf(doc(v.character)) }]),
    ),
    fx: [...FX_TYPES],
    cameras: CAMERAS,
    actions: ACTIONS,
    lightMoods: Object.keys(MOODS),
  };
}
