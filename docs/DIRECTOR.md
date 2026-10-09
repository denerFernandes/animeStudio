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
  vehicles?: Record<string, { character: string; scale: number; speed? }>;   // drive-bys and vehicles to ride
  furniture?: Record<string, { character: string; scale: number }>;          // chairs, benches, sofas, beds
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
| `mount` / `dismount` | `who`, `vehicle` (a block vehicle) | Gets on (walks to it, sits on the seat, feet on the pedals, hands on the handlebar) / gets off and stands beside it |
| `ride` | `who`, `to`, `until?`, `vehicle?`, `wobble?` (0..1) | Rides to a place (mounts first if needed; `vehicle` defaults to the last one ridden). Pedals turn in step with the ground (`drive` clip `stride`). `wobble` rocks it like a beginner |
| `fall` | `who`, `side?` (`back` default, `front`) | Riding: the vehicle tips and lies on its side, the rider is thrown clear and lands on the back (or face down). Standing: trips and falls. Stars over the head; until `getUp` |
| `sit` | `who`, `on?` (furniture id, set mark with `seat`, or `"ground"`), `view?` (`"front"`) | Walks there if needed and sits: hips on the seat, feet on the floor (dangling when the seat is too high), knees up on the ground. `view: "front"` sits facing the audience (sofa in front of the TV, school desk): thighs foreshortened towards the camera, shins hanging. The next one on the same furniture takes `seat2`, `seat3`…; on a set seat they sit side by side |
| `lie` | `who`, `on?` (furniture id, set mark with `seat` and `lie`, or `"ground"`) | Lies face up, head towards the back of the furniture (on its `pillow`); the ground shadow hides |
| `getUp` | `who` | Stands back up (from a seat, a bed, the ground or a fall). Walking while sitting or lying stands up first automatically |

### Riding, sitting, lying

Vehicles to ride and furniture stand in the block, declared next to the cast:

```jsonc
"vehicles": [{ "id": "bike", "kind": "bike", "at": "gate", "wear": { "trainingWheels": "on" } }],
"furniture": [{ "id": "sofa", "kind": "sofa", "at": "wall", "facing": "right" }]
```

A **rideable** vehicle rig (any kind: bicycle, scooter, horse…) has the anchors `seat` (where the
rider's hip joint goes), `pedalF` / `pedalB` (ankles; on pedal bones that do not inherit the crank's
rotation, so they stay level), `gripF` / `gripB` or `handlebar` (wrists), and a looping `drive`
clip (one crank turn per loop) with a `stride` (ground distance per loop) so the pedals keep pace.
Put the seat behind and above the crank (as on a real bicycle) so the rider reads as sitting, and
make the crank long enough (about a third of the leg) for the two legs to read apart. Its `scale`
is for a cast member of scale 1 and is multiplied by its first rider's scale; `check` reports legs
too short for the pedals. The rider's far leg (parts on `legB1`, `legB2`, `footB`) is drawn behind
the vehicle, so its frame passes between the legs. For falls, give the rig a `view` pose control
with a `lying` pose (the vehicle drawn on its side, with its own ground shadow) and an upright pose;
without it the vehicle is flattened as a fallback. Its wardrobe (e.g. training wheels on/off) works
with `wear` like a character's.

**Furniture** rigs have a `seat` anchor (where the hip joint goes when sitting; more seats as
`seat2`, `seat3`… for sofas and benches), and to lie on them
`bed` (hips) or better `pillow` (the head rests there, any body length). They face right (seat
front / foot of the bed on the right; a sofa drawn facing the audience is fine). Furniture that is
part of the place goes in the set, always there: `SetDef.furniture: [{ id, kind, at, facing? }]`
(standing on its mark's `y`, e.g. against the back wall); `on` takes its id like block furniture.
**Set seats** are marks with a height in scene px: `{ "x": 700, "seat": 90 }` (a seat drawn in the
background art), plus `"lie": true` for places to lie on (grass bank).

Characters need the kit's IK chains (`footF`, `footB`, `handF`, `handB`) and `RigInfo.hip` /
`legLength` (from `rigInfo`); without leg chains they still sit (legs not bent) and ride. A
`ground` bone carrying the `shadow` part keeps the shadow on the floor while sitting.

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
unknown actions/marks/props/vehicles/fixtures/furniture, riding or sitting problems (not a
vehicle of the block, no `seat` anchor, legs that do not reach the pedals, a mark without `seat`,
dismount/fall when not riding, feet dangling from a high seat as a warning), unknown wardrobe controls or poses (and `view` /
`emotion` given as wardrobe), a speaker missing from the block where they
speak, blocks that do not follow each other, overlapping texts (one at a time; two only during a
replay cut), and every
`validateScene` / `validateSequence` issue.
