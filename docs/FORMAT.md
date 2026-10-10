# The `toon` Format — Specification v1

`toon` is an open, JSON-based format describing **2D cartoon characters** (art + skeleton +
physics + controls + animations) and **scenes** (actors, props, camera, script) that render
deterministically to SVG.

It is designed to be:

- **Writable by AI** — plain JSON, semantic names, setup-space coordinates, forgiving defaults
  and precise validation errors.
- **Writable by artists** — art is plain SVG; characters can be imported from drawing tools.
- **Deterministic** — every frame is a pure function of `(document, time)`, so frames can be
  rendered in any order and in parallel (as Remotion does).

Two document kinds exist:

| Kind | Extension | Root `format` |
|---|---|---|
| Character | `*.toon.json` | `"toon"` |
| Scene | `*.scene.json` | `"toon-scene"` |
| Sequence | `*.sequence.json` | `"toon-sequence"` |

JSON Schemas are generated from the reference implementation and live in [`schemas/`](../schemas).

---

## 1. Conventions

| Quantity | Unit / convention |
|---|---|
| Length | SVG user units (px) |
| Axes | x → right, **y → down** (SVG convention) |
| Angle | **Degrees**, positive = clockwise on screen |
| Time | Seconds |
| Color | Any CSS color, or a palette token `palette(name)` |

### Spaces

- **Setup space** — the character's own coordinate system in its rest pose ("bind pose").
  By convention the origin `(0, 0)` is on the ground, between the feet. All character art is
  drawn in setup space unless stated otherwise.
- **Bone space** — local frame of a bone: origin at the bone's joint, +x along the bone.
- **Scene space** — the scene's coordinate system (`0..width`, `0..height`).

### Offsets, not absolutes

All animatable **character channels are offsets from the setup pose**: a rotation track value
of `30` means "30° more than the rest pose". This makes clips reusable and mixable.
Scene-level placement channels (actor `x`, `y`, camera, …) are absolute.

---

## 2. Character document (`*.toon.json`)

```jsonc
{
  "$schema": "../schemas/toon.schema.json",
  "format": "toon",
  "version": 1,
  "name": "pip",
  "meta": { "author": "…", "description": "…" },
  "palette": { "skin": "#F4A6C0", "dress": "#E4473B" },
  "defs": "<linearGradient id='shine'>…</linearGradient>",
  "art": { "head": "<ellipse cx='0' cy='-160' rx='60' ry='50' fill='palette(skin)'/>" },
  "skeleton": [ /* Bone */ ],
  "parts": [ /* Part — drawn in array order */ ],
  "anchors": { /* named points */ },
  "ik": [ /* IkChain */ ],
  "physics": [ /* PhysicsDef */ ],
  "colliders": [ /* Collider */ ],
  "controls": { /* name → Control */ },
  "behaviors": [ /* Behavior */ ],
  "clips": { /* name → Clip */ }
}
```

### 2.1 `palette`

Map of color tokens. Any `palette(name)` occurrence inside art, `defs`, or part colors is
replaced with the color. Scenes may override palette entries per actor (recoloring).

### 2.2 `defs`

Raw SVG `<defs>` content (gradients, patterns, filters, clip paths). Ids are automatically
namespaced per actor, and `url(#id)` / `href="#id"` references are rewritten accordingly.

### 2.3 `art`

Map of reusable SVG fragments (markup string, without an outer `<svg>`). Coordinates are in
**setup space** by default. Wherever a part accepts an art reference, the value may be either an
art id (`"head"`) or inline markup (any string starting with `<`).

### 2.4 `skeleton`

An array of bones. Parents must be declared before children. Bones without `parent` are roots.
Each bone can be declared in **one** of two forms:

**Setup form** (recommended for AI and imported art) — joint and tip in setup space:

```json
{ "id": "upperArmR", "parent": "body", "from": [20, -110], "to": [45, -70] }
```

**Local form** — relative to the parent bone:

```json
{ "id": "upperArmR", "parent": "body", "x": 20, "y": 10, "rotation": 58, "length": 47 }
```

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | string | — | Unique |
| `parent` | string | none | Parent bone id |
| `from`, `to` | `[x, y]` | — | Setup form. `to` omitted → length 0, world rotation 0 |
| `x`, `y`, `rotation`, `length` | number | 0 | Local form |
| `scaleX`, `scaleY` | number | 1 | Rest scale |
| `mass` | number | 1 | Used by physics (heavier = more inertia, slower response) |
| `limits.rotation` | `[min, max]` | none | Clamp of the rotation offset (degrees) after animation and IK |
| `inheritRotation` | boolean | true | |
| `inheritScale` | boolean | true | |

### 2.5 `parts`

Visual elements bound to bones. **Draw order = array order** (later parts are on top), unless
`z` is given (stable sort by `z`, default 0). Common fields: `id`, `type`, `z`, `opacity`
(default 1), `visible` (default true).

| `type` | Purpose | Fields |
|---|---|---|
| `rigid` | Art rigidly attached to a bone (cut-out style) | `bone`, `art`, `space` |
| `switch` | Swappable variants (mouths, eyes, hands, views) | `bone`, `variants: {name → art}`, `default`, `space` |
| `skinned` | Path whose points are deformed by several bones (bending limbs) | `path`, `bones`, `weights?`, `falloff`, style |
| `hose` | Procedural "rubber hose" limb through a bone chain | `bones`, `width`, `cap`, `smooth`, style |
| `hull` | A soft shape stretched over points of the skeleton: the rounded convex hull of circles (a skirt over the waist and the knees, a cape) | `points: [{ bone, at, r }]` (setup space), style |
| `morph` | Blend shapes on a path (expressions, squish) | `bone`, `base`, `shapes: {name → path}`, `space`, style |

Style fields (for path-based parts): `fill`, `stroke`, `strokeWidth`, `attrs` (extra SVG
attributes).

`space` is `"setup"` (default: art drawn where it sits in the rest pose) or `"bone"` (art drawn
in the bone's local frame, origin at the joint, +x along the bone).

**`skinned`** — `bones` lists influencing bones. Without `weights`, each path point is weighted
automatically by inverse distance to each bone segment (`weight ∝ 1 / distance^falloff`,
default `falloff: 2`, top 2 influences). `weights` may give explicit per-point weights:
one array per point (in path order, after normalization to absolute cubic Béziers), each with
one entry per bone.

**`hose`** — the limb's centerline passes through each bone's joint and the last bone's tip,
smoothed with Catmull-Rom (`smooth`, 0..1, default 1). `width` is a number, `[start, end]`,
or one value per joint, scaled with the first bone's scale but not its squash (a squashed,
foreshortened thigh does not thin the limb). `cap`: `"round"` (default) or `"butt"`.

**`morph`** — every shape must describe the same figure; paths are normalized to cubic Béziers
and resampled to matching segment counts. Result = `base + Σ weightᵢ · (shapeᵢ − base)`.

### 2.6 `anchors`

Named points attached to bones, used by the script (`lookAt` targets, `grab`, speech bubbles):

```json
"anchors": { "head": { "bone": "head", "at": [10, -170] }, "handR": { "bone": "forearmR", "at": [60, -40] } }
```

`at` is in setup space. If a character has a `head` anchor, other actors looking at it aim there.
A rig with a pose control named `side` (`right` / `left`) gets it from the actor's facing every frame
(`left` when the actor is mirrored): use it to keep asymmetric details on the same side of the body.
A held prop is drawn just above its holder, and the parts on the holding anchor's bone (the hand)
above the prop: the fingers wrap around it. A `grab` action may `fit` the prop to the body: `fit: [{ point, anchor }, { point, anchor }?]` puts the
prop's first point (its art's coordinates) on the first anchor, turned so its second point points at the
second anchor, every frame; with one point it turns with that anchor's bone. A `reach` target can be a
prop's point (`{ prop, point, from? }`), even on a prop fitted to the reaching actor's own body (a hand
holding the phone at its ear); `from` (degrees in the actor's frame: 0 forward, 90 from below) is where
the forearm comes from — the elbow goes there, the upper arm foreshortened when the hand is close to
the shoulder (the elbow points at the camera).
`turn` (0..1, optional) makes a prop held at the anchor turn with the bone: 1 turns it as much as
the hand turns from its rest pose (a phone at the ear, a bottle tipped to the mouth), 0 keeps it
upright. Draw held props the way they look in the hand at rest (arm hanging).

### 2.6b `rig3d` (2.5D rigs)

A rig whose bones are posed in 3D and drawn from any angle:

```json
"rig3d": {
  "bones": { "legF1": { "from": [-20, -250, 0], "to": [-20, -125, 6] }, "...": {} },
  "views": { "front": 0, "profile": 36, "side": 90, "back": 180 },
  "pitch": 18,
  "chains": [{ "bones": ["legF1", "legF2"], "parts": ["legF", "shoeF"] }],
  "front": "armF", "back": "hairBack"
}
```

`bones` gives each 3D bone's rest joint and tip in body space (the front view: x right, y down,
z towards the viewer). Every frame, before IK, the bones are posed in 3D — a bone's `rotation` turns
it about the body's sideways axis (the plane of a side view: what a clip authored in profile means),
`turn` about the vertical axis, `spread` about the forward axis — and projected with the yaw of the
current `view` (`views`, degrees: 0 faces the camera) and `pitch`; the 2D bones are set to match
(place, direction, foreshortening as a squash). Leg IK (feet planted while walking) is solved in the
side plane first, so walks foreshorten from the front. Limbs (`chains`) clearly nearer than the body
are drawn just before the `front` part (in the chains' order: legs, then arms resting on them),
clearly farther ones just after the `back` part.

### 2.7 `ik`

```json
{ "id": "handR", "bones": ["upperArmR", "forearmR"], "bend": 1, "mix": 1 }
```

| Field | Default | Notes |
|---|---|---|
| `bones` | — | Chain root → end. 2 bones: analytic two-bone solver. 3+: FABRIK |
| `bend` | `1` | Bend direction for two-bone chains: `1` or `-1` |
| `mix` | `1` | 0 = FK only, 1 = full IK |

The target is the chain tip in the rest pose plus the `ik.<id>.x` / `ik.<id>.y` offsets.

### 2.8 `physics`

Secondary motion, simulated at a fixed rate (default 120 Hz) and baked — fully deterministic.

| `type` | Fields | Use |
|---|---|---|
| `spring` | `bones` (chain), `stiffness` (0..1, 0.5), `damping` (0..1, 0.3), `gravity` (`[x,y]` px/s², `[0,0]`), `inertia` (0..1, 1), `mix` (0..1, 1) | Tails, ears, hair, antennae |
| `jiggle` | `bone`, `stiffness`, `damping`, `translate` (0..1, 0.5), `squash` (0..1, 0.3), `mix` | Bellies, cheeks — follow-through with volume-preserving squash & stretch |

Each bone's `mass` scales the response: heavier bones lag more and settle slower.
`stiffness` maps to a natural frequency of 0.5–5 Hz (quadratically, for finer control of loose
parts); `damping` maps to a damping ratio of 0.04–1. Jiggle squash only reacts to lag **along the
bone's own axis**, so sideways motion (walking, stopping) never deforms the bone. When an actor
flips (`face`, `walkTo` turning around), the simulation restarts at rest: an instant turn is a
cartoon cut, not a physical motion, so tails and ears don't whip across the screen.

### 2.8b `colliders`

Capsules along bones (circles for zero-length bones) that scene rigid bodies collide with.
They follow the animation as kinematic bodies.

```json
"colliders": [{ "bone": "body", "radius": 46 }, { "bone": "head", "radius": 50 }]
```

### 2.9 `controls`

High-level, semantic parameters. **Animate controls instead of bones whenever possible** — this
is the main interface for AI-driven animation.

| `type` | Fields | Channel value |
|---|---|---|
| `viseme` | `part` (switch **or morph** part id, or a list of them — e.g. one mouth per view, all driven together), `map?` (viseme → variant/shape) | Viseme letter `A B C D E F G H X`, or a weight blend `{ "C": 0.3, "D": 0.7 }` |
| `aim` | `targets: [{ bone, weight=1, mode="rotate", forward=0, maxAngle=60, radius=0 }]` | `[x, y]` setup-space point, an actor/prop id (in scenes), or `null` (off) |
| `pose` | `poses: { name → { channel → value } }` | Pose name, or `{ name → weight }` blend |

`aim` modes: `rotate` turns the bone so its `forward` direction (degrees, relative to the bone)
points at the target, limited by `maxAngle` and scaled by `weight`; `translate` moves the bone
towards the target by at most `radius` (pupils).

`pose` entries may contain any character channel, including `parts.<id>.variant`, so poses
can also express **views** (front / profile) and **emotions**. Numeric pose values are **added**
on top of the current animation (an emotion layers over a walk); variants override.

**Fluid lip sync:** with a `morph` mouth, the `say` action cross-fades visemes (~60 ms) so the
mouth flows between shapes. With a `switch` mouth the strongest viseme is shown (classic cut-out).
Missing visemes fall back to the closest available shape (e.g. `H → C`, `G → B`, `X → A`).

### 2.10 `behaviors`

Procedural, seeded, deterministic motion layered on top of everything else.

| `type` | Fields |
|---|---|
| `blink` | `id`, `part` (switch), `open`, `closed`, `interval` (`[min, max]` s, `[2, 5]`), `duration` (0.15) |
| `breathe` | `id`, `bone`, `amount` (squash ratio, 0.02), `period` (s, 3.5) |
| `sway` | `id`, `bone`, `angle` (degrees, 2), `period` (s, 4) |

`blink` only closes the eyes when the part currently shows the `open` variant.
Each behavior has a `behaviors.<id>.mix` channel (default 1).

### 2.11 `clips`

```json
"wave": {
  "duration": 1.2,
  "loop": true,
  "stride": 0,
  "tracks": {
    "bones.upperArmR.rotation": [[0, 0], [0.3, -120, "easeOut"], [0.6, -100, "easeInOut"], [0.9, -120], [1.2, 0]]
  }
}
```

- `duration` (s), `loop` (default `false`), `stride` (px of travel per cycle for locomotion
  clips; used by `walkTo` to avoid foot sliding).
- `tracks`: `channel → keyframes`. A keyframe is `[t, value]`, `[t, value, ease]` or
  `{ "t": …, "v": …, "ease": … }`, sorted by `t`.
- **The `ease` of a key shapes the segment arriving at that key.**
- **Without `ease`, numeric and vector keys use a smooth monotone spline ("auto")**: motion flows
  through intermediate keys without stopping, eases in/out at the first and last key and at
  extremes, and never overshoots the key values. Looping clips whose first and last values match
  are smooth across the loop seam. Use `"linear"` explicitly for constant speed (e.g. a foot in
  contact with the ground).
- Values: number, string (always stepped), or `[x, y]` (component-wise).
- Before the first key the first value holds; after the last key the last value holds.

**Easings:** `linear`, `step`, `easeIn`, `easeOut`, `easeInOut` (cubic), `sineIn`, `sineOut`,
`sineInOut`, `backIn`, `backOut`, `backInOut` (anticipation / overshoot), `elasticOut`,
`bounceOut`, or `[x1, y1, x2, y2]` (CSS cubic-bezier).

### 2.12 Character channels

| Channel | Value |
|---|---|
| `bones.<id>.rotation` | degrees offset |
| `bones.<id>.x`, `bones.<id>.y` | px offset in parent space |
| `bones.<id>.scaleX`, `bones.<id>.scaleY` | multiplier (1 = rest) |
| `bones.<id>.rotationMix` | multiplier of the bone's rotation offset and aim (rest 1; e.g. `-0.85` in a pose keeps a head nearly straight) |
| `bones.<id>.turn`, `bones.<id>.spread` | 2.5D rigs (`rig3d`) only: degrees about the vertical axis (+ turns the front towards +x) and about the forward axis (+ swings a hanging limb towards +x); `rotation` is about the body's sideways axis |
| `bones.<id>.squash` | volume-preserving, relative to the bone: `> 0` stretches along the bone (`×(1+v)`) and thins it (`÷(1+v)`), `< 0` squashes. **Local:** it deforms the bone's own art and moves where children attach, but never scales or shears children |
| `parts.<id>.variant` | variant name (switch) |
| `parts.<id>.opacity` | 0..1 multiplier; pose values multiply and never go below 0 (`-1` or `0` hides, and two controls hiding the same part keep it hidden) |
| `parts.<id>.morph.<shape>` | blend weight |
| `ik.<id>.x`, `ik.<id>.y` | target offset from rest tip |
| `ik.<id>.mix` | 0..1 |
| `ik.<id>.bend` | `1` (the chain's `bend`) or `-1` (the other way): which side a two-bone chain folds to (elbows out when seen from the front) |
| `controls.<id>` | see controls |
| `behaviors.<id>.mix` | 0..1 |
| `physics.<index>.mix` | 0..1 |

### 2.13 Evaluation order (per frame)

1. Setup pose.
2. Clip layers (mixer), in layer order. `override` layers blend towards the clip value by their
   (smoothly faded) weight; `additive` layers add on top.
3. Direct tracks (scene `tracks` and `set` actions). Numeric offset channels (bones, IK targets,
   morphs, opacity) are **added** on top of clips; other channels override.
4. `pose` controls, `viseme` controls.
5. Behaviors.
6. Rotation limits, forward kinematics.
7. IK, `aim` controls.
8. Baked physics (springs, jiggles).
9. Parts → render tree.

---

## 3. Scene document (`*.scene.json`)

```jsonc
{
  "$schema": "../schemas/scene.schema.json",
  "format": "toon-scene",
  "version": 1,
  "width": 1920, "height": 1080, "fps": 30, "duration": 8,
  "background": "#BDE6F5",
  "characters": { "pip": "./pip.toon.json" },
  "audio": { "hello": "./audio/hello.wav" },
  "lipsync": { "hello": "./audio/hello.cues.json" },
  "world": { "gravity": [0, 1800], "ground": 900 },
  "camera": { "x": 960, "y": 540, "zoom": 1, "rotation": 0 },
  "layers": [ /* Layer — background art */ ],
  "actors": [ { "id": "pip", "character": "pip", "x": 700, "y": 900, "scale": 1.6 } ],
  "props": [ { "id": "ball", "art": "<circle r='30' fill='#3A7'/>", "x": 1200, "y": 600,
               "body": { "type": "dynamic", "shape": { "circle": 30 }, "restitution": 0.6 } } ],
  "tracks": { "camera.zoom": [[0, 1], [8, 1.2, "sineInOut"]] },
  "script": [
    { "at": 0.5, "actor": "pip", "action": "play", "clip": "wave", "duration": 2 },
    { "at": 1.0, "actor": "pip", "action": "say", "audio": "hello", "lipsync": "hello" },
    { "at": 3.0, "actor": "pip", "action": "walkTo", "x": 1100, "duration": 2 }
  ]
}
```

- `characters`, `audio`, `lipsync`: id → path/URL, resolved by the loader. Loaders may also
  receive already-parsed documents.
- `camera`: the scene point at the center of the frame (`x`, `y`), `zoom`, `rotation`, plus the
  advanced settings in 3.5 (`handheld`, `dolly`, `focus`, `blur`, `focusRange`, `motionBlur`,
  `bounds`).
- `world`: physics settings for rigid bodies (`gravity` px/s², `ground` y, optional `walls`) and
  walkable `surfaces` (see 3.6).

### 3.0 Lighting

Optional `lighting` gives scenes light and shadow, rendered with plain SVG (masks, filters and
blend modes), so it works in browsers and Remotion and stays deterministic.

```jsonc
"lighting": {
  "ambient": { "color": "#2A1C5E", "opacity": 0.5 },          // darkness over everything (multiply)
  "lights": [
    { "id": "sun", "type": "point", "x": 960, "y": 780, "radius": 1100, "glow": 0.9, "color": "#FFC46B" },
    { "id": "key", "type": "directional", "angle": 145, "glow": 0 }
  ],
  "shading": { "light": "key", "color": "#5B3F86", "opacity": 0.26, "rimOpacity": 0.6, "offset": 6, "inset": 3.5 },
  "grade": { "color": "#FFB86B", "opacity": 0.14, "blend": "soft-light" },
  "vignette": { "color": "#000", "opacity": 0.25 }
}
```

| Element | Effect |
|---|---|
| `ambient` | Multiply layer over the frame; **point lights cut through it** (radial falloff) |
| `lights[]` (`point`) | Additive radial glow (`glow` × `intensity`, `screen` blend) at `x`, `y` with `radius`; `parallax` like layers |
| `lights[]` (`directional`) | `angle` = direction the light travels (degrees, 90 = from above). No glow; used as a key light |
| `shading` | **Automatic cel shading on actors**: a shadow crescent on the side away from the key light (`color`, `opacity`) and a rim light on the lit side (`rim` uses the light color, `rimOpacity`). `offset` is the crescent size; `inset` keeps it inside the outline so line art stays crisp. Follows poses and motion. Point lights fade the shading with distance |
| `grade` | Full-frame color grading (`blend`: `multiply`, `screen`, `overlay`, `soft-light`, …) |
| `vignette` | Darkened frame edges |

Shading follows the actor's opacity (a hidden actor casts no shading). It costs one extra copy
of each lit actor's art (referenced by its masks) and two blended fills limited to the actor's
screen box; without a GPU (headless render farms) it is still the most expensive part of a frame,
so keep `shading` for scenes that need it. Actors shorter than `shading.minHeight` on screen
(default 90 px) get none (too small to see it), and with more lit actors on screen than
`shading.crowd` only the shadow crescent is drawn, without the rim light (about a third cheaper
in crowd shots: set it on sets where the whole cast gathers). Screen blending lifts blacks, so keep big glows away from line art (or use a separate
directional key light with `glow: 0` for shading, as above). Actors opt out with `"shading": false`.

**Animating lighting:** channels `lights.<id>.(x|y|angle|color|intensity|radius|glow)` and
`lighting.ambient.(color|opacity)`, `lighting.shading.(color|opacity|rim|rimOpacity|offset|inset)`,
`lighting.grade.(color|opacity)`, `lighting.vignette.(color|opacity)` — in scene `tracks` or with the
`light` action. **Hex colors interpolate smoothly** (in any track, not only lighting).

### 3.1 Layers, actors and props

All three share placement fields: `x`, `y`, `rotation`, `scale` (number or `[sx, sy]`), `z`
(draw order, default 0), `parallax` (camera influence, 1 = normal, 0 = fixed to screen,
<1 = far away), `opacity`.

| Kind | Extra fields |
|---|---|
| Layer | `id`, `art` |
| Actor | `id`, `character`, `flip` (face left), `palette` overrides, `seed`, `shading` (receive cel shading, default true), `ground?` (3.6) |
| Prop | `id`, `art`, `body?`, `ground?` (3.6) |

`body`: `type` (`dynamic` / `static` / `kinematic`), `shape` (`{ "circle": r }` or
`{ "box": [w, h] }`), `restitution` (0.3), `friction` (0.5), `density` (1),
`velocity` (`[vx, vy]`), `angularVelocity`.

### 3.2 Scene channels (`tracks`)

| Channel | Value |
|---|---|
| `camera.x`, `camera.y`, `camera.zoom`, `camera.rotation` | absolute |
| `camera.handheld`, `camera.dolly`, `camera.focus`, `camera.blur`, `camera.focusRange`, `camera.motionBlur` | see 3.5 |
| `actors.<id>.x` / `.y` / `.rotation` / `.scale` / `.opacity` | absolute |
| `actors.<id>.flip` | boolean (stepped) |
| `actors.<id>.<character channel>` | e.g. `actors.pip.controls.emotion` |
| `props.<id>.x` / `.y` / `.rotation` / `.scale` / `.opacity` | absolute (non-dynamic props) |
| `layers.<id>.x` / `.y` / `.opacity` | absolute |
| `lights.<id>.<prop>`, `lighting.<section>.<prop>` | see Lighting |

### 3.3 Script actions

Every action has `at` (seconds). Actor actions have `actor`.
Actions are compiled into clip instances and tracks before rendering.

| `action` | Fields | Effect |
|---|---|---|
| `play` | `clip`, `duration?`, `loop?`, `speed` (1), `fadeIn` (0.2), `fadeOut` (0.2), `layer` (0), `blend` (`override` \| `additive`), `weight` (1) | Plays a character clip |
| `set` | `channel` (character channel or `x`, `y`, `flip`, …), `value`, `duration` (0), `ease` | Animates one channel to a value |
| `pose` | `control`, `value`, `duration` (0.3), `ease` | Shortcut for `set controls.<control>` |
| `walkTo` | `x`, `y?`, `duration` or `speed` (px/s, 220), `clip` (`"walk"`), `ease?` | Moves the actor with a smooth accelerate–cruise–decelerate profile, plays the locomotion clip stride-matched (`stride × actor scale`, no foot sliding) and faces the direction |
| `face` | `direction` (`left` \| `right`) | Flips the actor |
| `lookAt` | `target` (actor id, prop id, `[x, y]` scene point, or `null`), `control` (first `aim` control) | Aims eyes/head until the next `lookAt`; target changes blend smoothly (0.35 s) and moving targets are tracked |
| `mount` | `on` (actor id, or `null` to get off), `anchor` (`"seat"`), `point` (this actor's point, character space, placed on the anchor; default the origin — e.g. the hip joint), `duration` (blend, 0.3), `behind?` (part ids) | Rides another actor (a bicycle, a horse, a chair): this actor's `point` follows the ridden actor's **posed** anchor every frame, with its rotation added and its facing; its own `x`/`y` are kept for when it gets off (blended back over `duration`). Parts in `behind` are drawn just under the ridden actor (the far leg behind a bicycle's frame) |
| `reach` | `chain` (IK chain id), `target` (`{ actor, anchor }`, `[x, y]` scene point, or `null`), `duration` (blend, 0.3) | Holds an IK chain's tip on another actor's anchor, followed every frame (feet on turning pedals, hands on a handlebar), or on a scene point (feet on the floor while sitting); `null` lets go. The chain's mix is raised to the blend weight |
| `say` | `audio?`, `lipsync?` (cues id), `cues?` (inline), `text?` + `duration?`, `control` (first `viseme` control) | Plays audio and lip syncs |
| `grab` | `prop`, `anchor` | Attaches a prop to an actor anchor |
| `release` | `prop`, `velocity?` | Releases a grabbed prop |
| `impulse` | `prop`, `vector` | Changes a dynamic prop's velocity by `vector` (px/s) |
| `camera` | `x?`, `y?`, `zoom?`, `rotation?`, `duration` (1), `ease` (`sineInOut`) | Camera move |
| `camera` (rigs, paths, effects) | `follow`, `frame`, `path`, `punch`, `handheld`, `dolly`, `focus`, `blur`, `motionBlur`, … | See 3.5 |
| `transition` | `type` (`fade` \| `iris` \| `wipe` \| `flash`), `duration`, `mode` (`outIn` default, `out`, `in`), `color`, `direction` (wipe), `target` (iris center: actor/prop id or scene point) | Screen transition inside a scene (e.g. an iris closing on a character at the end) |
| `fx` | `type`, `actor?`, `anchor?` (`head` default, `origin` = feet), `offset?`, `x?`/`y?` (scene point), `duration?`, `scale` (1), `color?`, `fill?` | Cartoon effect (see 3.4) |
| `shake` | `duration` (0.5), `amount` (px, 10), `frequency` (Hz, 12) | Seeded camera shake |
| `sound` | `audio`, `volume` (1) | Plays a sound effect |
| `light` | `channel` (lighting channel), `value`, `duration` (0), `ease` (`sineInOut`) | Animates lighting (sunrise, lamp switching on, flash) |

### 3.4 Cartoon effects (`fx`)

Procedural "emanata" drawn in front of an actor (following, flipping and scaling with it) or at a
scene point. Glyph-like effects (`question`, `exclaim`, `zzz`, `notes`) never mirror: on a flipped
actor they move to the other side but stay readable. Each pops in, animates and fades out on its own; all are deterministic.

| `type` | Look | Typical use | Default duration |
|---|---|---|---|
| `surprise` | Strokes shooting out above the head ("\ \| /") | Surprise, realization | 0.7 s |
| `exclaim` | Wobbling "!" | Alarm, sudden idea | 0.9 s |
| `question` | Bobbing "?" | Confusion, hearing something | 1.2 s |
| `sweat` | Drop sliding down the back of the head | Nervousness, awkwardness | 1.4 s |
| `sparkle` | Twinkling four-point stars | Admiration, magic, cleanliness | 1.2 s |
| `dust` | Puffs expanding from the feet (use `anchor: "origin"`) | Landing, braking, running off | 0.6 s |
| `hearts` | Hearts floating up | Love, delight | 1.6 s |
| `zzz` | Rising "Z"s | Sleep, boredom | 2.4 s |
| `anger` | Pulsing cross vein | Annoyance | 1.0 s |
| `impact` | Burst of rays | Hits, bumps | 0.35 s |
| `gloom` | Wavy lines hanging over the head | Exhaustion, sadness | 1.8 s |
| `notes` | Music notes drifting up | Singing, humming | 2.0 s |
| `stars` | Stars circling above the head | Dizziness, being starstruck | 1.6 s |
| `lightbulb` | Glowing bulb popping up | An idea | 1.2 s |
| `birds` | Little birds flying across (left → right), wings flapping | A sunny day, birdsong | 3.2 s |

**Anime effects.** `focusLines`, `speedLines`, `impactFrame` and `caption` are drawn in **screen
space** (fixed to the frame, never moved by the camera; `x`/`y` are screen coordinates, default
the centre). `aura` is drawn just **behind** its actor.

| `type` | Look | Typical use | Default duration |
|---|---|---|---|
| `focusLines` | Wedges converging on the centre of the frame, a new pattern every two frames (`color`, e.g. `#ffffff` or ink) | A shock, a reveal, a shout | 1.2 s |
| `speedLines` | Streaks across the frame (`angle`: direction, `fill`: colour) | A dash, a fast move | 0.8 s |
| `impactFrame` | The whole frame white, then black (`fill`, `color`) | The instant a hit lands | 0.14 s |
| `burst` | Jagged yellow star with a red heart and a white core, growing and flickering | A punch landing (at the target's head or the fist) | 0.35 s |
| `aura` | Three layers of flames behind the actor, flickering (`fill`: base colour; use `anchor: "origin"`) | Powering up, a fighting spirit | 3 s |
| `ghost` | A little ghost with a halo floating up from the actor (use `anchor: "origin"`) | A comic death, a knock-out | 4 s |
| `caption` | Screen text with `text` and `style`: `title` (big, yellow, ink outline), `impact` (red, white outline, shaking), `ko` (huge, yellow, red outline), `place` (italic name sliding in at the bottom left) | Title cards, "CRITICAL FAIL!", "K.O.", place names | 2 s |

```json
{ "at": 7.8, "actor": "azul", "action": "fx", "type": "surprise" }
{ "at": 8.3, "actor": "azul", "action": "fx", "type": "dust", "anchor": "origin" }
```

### 3.5 Camera

The camera follows a **director model**: each `camera` action starts a segment that begins from
wherever the camera actually is at that moment — a move or `path` eases from the current pose to
its target, a `follow` / `frame` blends in over `blend` and keeps tracking, and `follow: null` /
`frame: null` holds the current pose. So switching between moves and rigs never jumps. Scene
`tracks` on `camera.x/y/zoom/rotation` are the base before the first action. On top of the
segments come `punch`, handheld drift, `shake` and `bounds`. All of it is deterministic.

| Feature | How | Notes |
|---|---|---|
| Move / zoom / rotate | `camera` action with `x`, `y`, `zoom`, `rotation`, `duration`, `ease` | `duration: 0` is a cut |
| Curved move | `path: [[x, y], …]`, `duration`, `ease` | Smooth curve from the current position through the points, constant speed along the curve |
| Follow an actor | `follow: id`, `offset`, `lag` (0.3 s), `axes` (`x` \| `xy`), `deadZone` (`[w, h]` half size), `lookAhead` (s), `blend` (0.6 s), `zoom?`, `duration?` | Smoothing is baked (deterministic). The actor can move inside the dead zone without moving the camera; look-ahead frames the space it moves into. Lasts until the next camera action (or `duration`, then holds); `follow: null` holds |
| Frame targets | `frame: [ids]`, `padding` (80), `minZoom`, `maxZoom`, `lag` (0.4 s), `blend`, `duration?`, `band?` (`[top, bottom]` scene y), `on?` (`body` \| `face`: the posed `face`/`head` anchors, for close-ups) | Position and zoom keep all targets in shot (smoothed, so a target turning around never makes the camera pop), until the next camera action; `frame: null` holds. With `band` the vertical extent is fixed: targets are framed sideways only, so a jump or a flight never moves the camera up and down |
| Punch-in | `punch: 0.15`, `duration` (0.4) | Quick zoom pulse with a springy settle (impacts, reactions) |
| Handheld | `handheld: px` (scene camera or action) | Continuous organic drift (position + slight roll). A roll turns every depth by the same angle; screen-fixed items (parallax 0) stay upright |
| Vertigo / dolly zoom | `dolly: value` | Scales depths relative to the subject plane (parallax 1): `> 0` pushes the background away while the subject keeps its size; combine with a zoom-in for the classic effect |
| Depth of field | `blur` (max px), `focus` (parallax depth or an actor/prop/layer id), `focusRange` (0.5) | Items blur by their depth distance from the focus; animate `focus` for a rack focus |
| Motion blur | `motionBlur: 0..1` (shutter) | Blur proportional to each item's on-screen motion between frames (fast pans, hops) |
| Bounds | scene `camera.bounds: [minX, minY, maxX, maxY]` | The view never shows outside this area |
| Shake | `shake` action | Seeded noise that fades out |

```jsonc
{ "at": 0,   "action": "camera", "follow": "pip", "offset": [120, 0], "deadZone": [60, 0], "lookAhead": 0.3 },
{ "at": 5,   "action": "camera", "frame": ["pip", "bia"], "padding": 120, "blend": 1.2 },
{ "at": 7.2, "action": "camera", "punch": 0.15 },
{ "at": 9,   "action": "camera", "path": [[900, 500], [1300, 560]], "duration": 2.5 },
{ "at": 12,  "action": "camera", "focus": "bia", "blur": 5, "duration": 0.8 },
{ "at": 15,  "action": "camera", "zoom": 1.6, "dolly": 0.8, "duration": 1.5 }
```

### 3.6 Ground surfaces

`world.surfaces` declares walkable ground lines as SVG paths of the top edge, in scene space,
drawn left to right:

```json
"world": { "surfaces": [{ "id": "branch", "path": "M-300 900 C200 820 900 826 1500 822" }] }
```

- An actor (or prop) with `"ground": { "surface": "branch", "offset": 9 }` always stands on it:
  its `y` follows the surface at its current `x` (walking up and down slopes); `offset` sinks the
  feet slightly into the surface.
- `"feet": ["footL", "footR"]` lists IK chains whose targets adapt to the slope, so each foot
  touches the ground.
- Rigid bodies collide with every surface (static polylines).

### 3.7 Lip sync cues

Mouth cues use the [Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync) JSON
shape and the Preston Blair viseme set:

```json
{ "mouthCues": [ { "start": 0.0, "end": 0.12, "value": "X" }, { "start": 0.12, "end": 0.3, "value": "D" } ] }
```

| Viseme | Mouth | Sounds |
|---|---|---|
| `A` | Closed | M, B, P |
| `B` | Slightly open, teeth | K, S, T, EE, most consonants |
| `C` | Open | EH, AE |
| `D` | Wide open | AA |
| `E` | Rounded | AO, ER |
| `F` | Puckered | UW, OO, W |
| `G` | Teeth on lip | F, V |
| `H` | Tongue up | L |
| `X` | Rest / silence | — |

Cues can come from Rhubarb (recorded audio), TTS character timestamps, text with a duration,
or audio amplitude — see `@animestudio/lipsync`.

---

## 4. Sequence document (`*.sequence.json`)

A sequence strings scenes together as **shots** with transitions — the whole episode in one
document, rendered by `evaluateSequence` / `<ToonSequenceComposition>`.

```json
{
  "format": "toon-sequence",
  "version": 1,
  "width": 1920, "height": 1080, "fps": 60,
  "scenes": { "dawn": "./dawn.scene.json", "branch": "./branch.scene.json" },
  "shots": [
    { "scene": "dawn" },
    { "scene": "branch", "transition": { "type": "crossfade", "duration": 0.8 } },
    { "scene": "branch", "from": 12, "duration": 4, "transition": { "type": "iris", "target": "pip" } }
  ]
}
```

| Shot field | Meaning |
|---|---|
| `scene` | Scene id from `scenes` |
| `from` | Start time inside the scene (default 0) |
| `duration` | Shot length (default: rest of the scene) |
| `muteSpeech` | Show the scene without its speech (no lip sync, no voice audio) — for recaps and songs that replay a window under different audio |
| `transition` | Into this shot: `cut`, `crossfade` (shots overlap by `duration`), `fade` / `iris` / `wipe` / `flash` (through `color`, half before and half after the cut), with `duration`, `color`, `direction` (wipe), `target` (iris center: actor id of the scene or screen point) |

Each shot's audio plays on the global timeline and is cut at the end of the shot.

## 5. Packaging

| Form | Description |
|---|---|
| `*.toon.json` / `*.scene.json` | Canonical source of truth |
| `*.toon` | Zip bundle: `character.toon.json` plus referenced files (future) |
| `*.toon.svg` | Valid SVG of the rest pose with the document embedded in `<metadata>` (future) |

## 6. Versioning

`version` is an integer. Additive, backwards-compatible changes keep the version; breaking
changes increment it, and the reference implementation ships migrations.
