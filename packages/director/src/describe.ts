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
    fx: [...FX_TYPES],
    cameras: CAMERAS,
    actions: ACTIONS,
    lightMoods: Object.keys(MOODS),
  };
}
