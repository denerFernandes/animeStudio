# Authoring Guide for AI Agents

This guide explains how an AI agent (or a human) should write `toon` characters and scenes that
validate on the first try and animate fluidly. Read [FORMAT.md](FORMAT.md) for the full reference.

## Workflow

1. **Describe** the characters you will use: `toon describe pip.toon.json`. It lists controls,
   clips, anchors and every animatable channel.
2. **Write the scene** as JSON (`*.scene.json`), using the `script` for actions.
3. **Validate**: `toon validate my.scene.json`. Fix every reported path — messages name the
   unknown id and list the valid ones.
4. **Preview** a frame (`toon render my.scene.json --time 3 -o f.svg`) or open the playground.

## Writing scenes

Prefer high-level actions over raw tracks:

| Intent | Action |
|---|---|
| Move somewhere | `walkTo` (stride-matched, eased, faces the direction) |
| Talk | `say` with `audio` + `lipsync` (best), or `text` + `duration` |
| Emotion | `pose` with the character's pose control (e.g. `emotion: happy`) |
| Look at someone / something | `lookAt` with an actor or prop id |
| React | `fx` (`surprise`, `question`, `sweat`, `dust`, …) |
| Track a character | `camera` with `follow` |
| Gesture | `play` a clip with `duration`, `fadeIn`/`fadeOut` |
| Camera | `camera` (`x`, `y`, `zoom`) with `duration`; `shake` for impacts |
| Physics | props with `body`, then `impulse`, `grab`, `release` |

Rules of thumb for fluid results:

- Always give actors a looping base clip (`idle`) on `layer: -1` so they never freeze.
- Overlap actions: start a gesture slightly before the line it accompanies; let emotions
  transition (`duration: 0.3–0.5`).
- Use `lookAt` before and during dialogue — characters looking at each other reads as alive.
- Keep camera moves slow (`duration ≥ 1`) and use `sineInOut` (the default).
- Never put two `walkTo` actions for the same actor in overlapping time ranges.

### Cartoon effects and camera

- Punctuate beats with `fx`: `surprise` on a reaction, `question` when a character notices
  something, `sweat` for nervous laughs, `dust` (anchor `origin`) when landing a hop, `gloom` for
  exhaustion, `sparkle`/`hearts` for delight. Start them ~0.05 s before the reaction line.
- Use `camera` with `follow` to track a walking character; hide what the character hasn't seen
  yet by keeping it out of frame, then reveal it with a camera move when the character notices.
- Prefer `frame: [ids]` over hand-computed camera coordinates for two-shots — it keeps everyone
  in frame even when they move.
- Accent reactions with a small `punch` (0.1–0.2); use `dolly` only for big dramatic beats.
- A little `handheld` (3–6 px) makes static shots feel alive; `blur` + `focus` separates the
  subject from the background; `motionBlur: 0.5` smooths fast pans.
- Put characters on ground with `world.surfaces` + `ground` so they never float on slopes.
- Build episodes as a `toon-sequence` of scenes with transitions; end with an `iris` on the
  character who has the last beat.

### Lighting

- Give scenes a `lighting` block for mood: a `point` light with `glow` for visible light sources
  (sun, lamp) and a `directional` key light with `glow: 0` for character shading.
- Animate time of day with the `light` action or tracks: e.g. raise `lights.sun.intensity` and
  lower `lighting.ambient.opacity` for a sunrise; hex colors blend smoothly.
- Keep large glows away from characters — additive light lifts black outlines.

## Writing characters

- Declare bones in **setup form** (`from` / `to` in setup space, ground at `y = 0`, facing
  right). Parents first.
- Draw art in setup space (where it sits in the rest pose) and reference it from parts.
- Use `palette(name)` tokens for every color so scenes can recolor actors.
- Give legs a slight knee bend in the rest pose so IK never reaches full extension.
- Feet that must stay flat: add a zero-rotation-inheritance toe bone (`inheritRotation: false`).
- Use a `morph` mouth with shapes `A–H` (plus optional `smile` / `frown`) for fluid lip sync.
- Expose semantics through **controls** (`viseme`, `aim`, `pose`) — scenes should rarely touch
  bones directly.
- Clip keys without `ease` are smooth splines; use `"linear"` for contact phases (feet on the
  ground) and named easings for snappy cartoon accents (`backOut`, `easeOut`).
- Loop clips should start and end with the same values.
- Secondary motion: `spring` physics on ears, tails and hair; keep `squash` for intentional
  moments (jumps, impacts) authored in clips.

## Common validation errors

| Message | Fix |
|---|---|
| `unknown bone "x". Known bones: …` | Use one of the listed ids |
| `parent "x" is not declared before this bone` | Reorder `skeleton` so parents come first |
| `use either setup form (from/to) or local form …` | Pick one form per bone |
| `unknown clip "x"` | Check `toon describe` output |
| `Unrecognized key: "rotaton"` | Typo — the format rejects unknown fields |
