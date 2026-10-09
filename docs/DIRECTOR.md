# Director — staging whole episodes

`@animestudio/director` turns a **staging** (what happens, written by a person or an AI) plus the
**timed lines** of the soundtrack and a **kit** (characters, sets, props) into a `toon-sequence`
with one continuous scene per block, the on-screen texts and a list of problems. It is generic:
nothing in it knows a particular series.

```ts
import { check, describeKit, direct } from "@animestudio/director";

const issues = check(staging, lines, kit);              // validation + continuity checklist
const { sequence, scenes, overlays } = direct(staging, lines, kit);
const catalogue = describeKit(kit);                      // what a staging may use (for prompts; cast[id].wear lists the wardrobe)
```

`direct` and `check` are pure: they run in node and inside a Remotion bundle.

## Lines

The soundtrack, already timed (seconds), one entry per line:

```jsonc
{ "i": 25, "speaker": "Ana", "text": "Higher? Here it goes!", "s": 80.0, "e": 81.9,
  "words": [{ "w": "Higher?", "s": 80.0, "e": 80.5 }, …], "song": false }
```

`speaker` is a cast name (or alias), a narrator, `"sfx"`, or `"song"` / `song: true` (everybody
present sings). Lip sync comes from the word timings; the last word lasts until `voiceEnd` (when
the voice really stops, measured from the line's audio) or, without it, until the line end minus
its usual trailing silence (0.22 s), because aligners tend to end drawn-out last words early.

## Kit

```ts
interface Kit {
  characters: Record<string, ToonDoc>;        // every rig: cast, vehicles, fixtures…
  cast: Record<string, { name; aliases?; scale; rig: RigInfo; speed? }>;
  narrators?: string[];
  sets: Record<string, SetDef>;               // layers, ground {near, far?}, depthScale, marks, fixtures, bounds, lighting
  props: Record<string, { art(o: { color? }): string; radius: number }>;
  vehicles?: Record<string, { character: string; scale: number; speed? }>;
}
```

`RigInfo` (hands, shoulders, arm lengths, back-view shoulders, extents, height) comes from
`rigInfo(doc, …)` in `@animestudio/kit`. Cast rigs are expected to follow the kit's bone names and
to have the clips `idle walk run talk sing dance wave point cheer laugh cry scared jump clap
present shrug turn hold walkDepth`, the controls `emotion`, `view` and a viseme control, and a
`hand` anchor. Missing automatic clips are skipped; staged ones are reported.

**Wardrobe.** A character can carry every outfit and accessory in one rig, each shown or hidden by
a pose control (like `view`: poses that set `parts.<id>.opacity`), e.g. `outfit` {`tee`, `polo`,
`swim`} and `backpack` {`on`, `off`}. List them in the rig's `meta.wardrobe` (`["outfit",
"backpack"]`); without that list every pose control except `view` and `emotion` counts as wardrobe.
`wardrobeOf(doc)` returns `{ control: [poses] }`.

## Staging

Times are always **relative to a line**: `{ "line": 25 }` (its start), `{ "line": 25, "word":
"goes" }`, `{ "line": 25, "end": true }`, plus an optional `offset` (s). Places are **set marks**
(`"kerb"`, `{ "mark": "kerb", "dx": -300 }`) or **someone** (`{ "near": "ana", "side": "left" }`),
never coordinates.

```jsonc
{
  "blocks": [
    {
      "id": "street", "set": "street", "from": 16, "to": 85,      // lines [from, to)
      "cast": [                                                  // left → right
        { "id": "grandma", "at": "start", "facing": "right", "wear": { "outfit": "coat" } },
        { "id": "ana", "at": "start" },
        { "id": "max", "enter": { "line": 20, "from": "left", "run": true } }
      ],
      "props": [{ "id": "ball", "kind": "ball", "color": "#e8414f", "heldBy": "ana" }],
      "camera": { "type": "follow", "who": "ana" },
      "beats": [
        { "line": 21, "do": "dribble", "who": "ana", "prop": "ball", "until": { "line": 25, "word": "goes" } },
        { "line": 25, "word": "goes", "do": "throw", "who": "ana", "prop": "ball" },
        { "line": 26, "do": "roll", "prop": "ball", "to": "flowers", "until": { "line": 33, "end": true } }
      ]
    }
  ],
  "cuts": [{ "line": 95, "replay": { "block": "street", "line": 36 }, "transition": "flash" }],
  "texts": [{ "line": 63, "text": "Red means wait" }]
}
```

### Beats (`do`)

| Action | Fields | Effect |
|---|---|---|
| `walk`, `run` | `who`, `to`, `until?` | Walk/run to a place (speed from the cast, or over `until`). Several going to the same place at the same moment (one beat with a list, or separate beats) stand side by side around it, keeping their left → right order; `near` stops beside someone, never on top |
| `enter` | `who`, `from`, `run?` | Same as `enter` on the cast entry: comes in from off screen |
| `exit` | `who`, `to` (`left`/`right`), `run?` | Leaves the frame |
| `face` | `who`, `direction` | Turns around |
| `look` | `who`, `target` (id, prop, mark, `null`) | Gaze |
| `emotion` | `who`, `value` | Emotion pose |
| `wear` | `who`, `wear` (`{ control: pose }`), or `control` + `value` | Changes outfit/accessories instantly (takes the backpack off on arriving home…). The starting wardrobe of a block goes in its cast entry: `"wear": { "outfit": "swim" }`. Every block starts from the rig's defaults plus its own `wear` |
| `gesture` | `who`, `clip`, `until?` | A clip (looped until `until`, else once) |
| `fx` | `type`, `who` or `at` (mark) | Cartoon effect |
| `view` | `who`, `value` (`profile`/`front`/`back`) | Front = looking at the camera (gaze cleared) |
| `hold` / `release` | `who` (left → right) | Hand in hand: they step to holding distance (heads side by side, each arm scaled by its own character) and the hands meet between them; held objects change hands. Holding someone already hand in hand with another extends the chain (everyone steps together). On `release` they step back to their usual spacing |
| `cross` | `who`, `to` (mark), `until` | Cross to the far ground: back view, hand in hand, foreshortened walk, smaller with depth, camera goes along |
| `pick`, `drop` | `who`, `prop` | Walks to the prop if needed and takes it / puts it down |
| `throw` | `who`, `prop`, `to?` | Throws it up; it lands in front (or at `to`) |
| `roll` | `prop`, `to`, `until` | Rolls with small bounces; reaches the far ground if `to` is there |
| `dribble` | `who`, `prop`, `until` | Bounces the prop in sync with the hand of the `dribble` clip |
| `vehicle` | `kind`, `lane` (`near`/`far`), `color`, `dir?` | Drives through and leaves (invisible before and after); ids are `<kind><n>` |
| `fixture` | `id`, `value` | Changes a fixture (traffic light `red`/`green`) |
| `camera` | `type` (`wide`, `group`, `two-shot`, `close`, `follow`, `reveal`), `who?`, `mark?` | Camera rig from that moment. `follow` of an object (ball, car) frames it with the cast; `reveal` pans towards a mark without losing the cast |
| `light` | `mood` (`day`, `afternoon`, `evening`, `night`) or `channel` + `value`, `until?` | Lighting change |

### Automatic (never written in a staging)

Idle loops, lip sync per word, talking/singing gestures, listeners turning towards the speaker
and looking at them (whoever is addressed by name or alias first), the speaker turning to the
one addressed, spacing by head extents, `profile` as the initial view, the gaze cleared in front
views, vehicles hidden outside their drive, the dribble synchronised with the hand, replays with
muted speech, contiguous shots.

### Cuts

A cut shows a window of an earlier block (from the moment of `replay`) during a line (until
`until`, default the end of the line), with `muteSpeech` so mouths stay still under other audio.
Use them for cold opens, recaps and songs.

### Missing pieces

A staging may list what the story needed but the kit lacks — `"missing": [{ "kind": "set" |
"character" | "prop" | "gesture" | "fx", "name", "why" }]` — after staging it with the closest
pieces available. The director ignores it; it is the to-do list for the shared library.

### Texts

Shown at the top of the frame (screen space, `overlays` with `from`/`to`/`row`) while their line
plays (at least 1.6 s), or `until` a moment.

## Checks

`check()` returns `{ severity, where, message }`: anyone acting in a block they are not in (with
who is present), characters standing on top of each other for more than half a second (not hand
in hand, not walking past; depth-aware), a hold whose hands cannot meet (an arm would stretch
more than 60%), a speaker out of the frame or at its edge (the camera is
evaluated), unknown ids (with the closest valid one),
unknown actions/marks/props/vehicles/fixtures, unknown wardrobe controls or poses (and `view` /
`emotion` given as wardrobe), a speaker missing from the block where they
speak, blocks that do not follow each other, overlapping texts (one at a time; two only during a
replay cut), and every
`validateScene` / `validateSequence` issue.
