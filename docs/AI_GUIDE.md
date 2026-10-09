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

### Continuity (staging whole episodes)

Lessons from converting a 66-shot storyboard into an episode:

- **Stage continuous scenes, not one scene per storyboard shot.** Put a whole location and its
  action (walk, incident, conversation) in one scene and make cuts with `camera` actions
  (`duration: 0`, or `frame` / `follow` rigs). Characters, props and vehicles then keep their
  positions between cuts instead of vanishing, jumping sides or reappearing elsewhere.
- **Keep screen direction (the 180° rule).** Who stands left of whom must not change between
  cuts unless the audience sees them move.
- **Objects keep their history.** A ball held in a hand is grabbed from the first frame of the
  scene; once it rolls away it stays where it stopped until someone picks it up. Vehicles drive
  through and leave the frame — they never pop in parked.
- **Time actions to the audio.** If a narration describes a motion ("it rolled… down the kerb…
  across the street… and stopped by the flowers"), key the motion to those lines so it lasts as
  long as the narration.
- **Reuse footage for recaps and songs.** A sequence shot can show any window of an earlier scene
  (`from` + `duration`); prefer windows where nobody speaks (only narration or effects).
- **On-screen text belongs to the screen.** Captions and labels go in a screen-fixed layer
  (`parallax: 0` props, or an overlay on top of the composition), at a fixed place, only while
  their line plays.
- **Front view = looking at the camera.** Draw it truly frontal: everything symmetric about the
  body's centre line, eyes on that line with centred pupils (clear the gaze target with
  `lookAt: null`), snout/beak/moustache centred under the eyes, ears or hair symmetric, and the
  same heights as the profile (eye line, chin, shoulders). A 3/4 drawing does not read as
  "talking to you".
- **Views:** front views are for talking to the audience; walking away from the camera uses a
  back view with an in-place walk (legs foreshortened, not bent sideways).
- **Listeners face the speaker.** On every line, turn listeners towards whoever speaks and the
  speaker towards the one addressed (by name, else the closest) — unless they are walking,
  holding hands, in a front/back view, or a staged turn happens around that time. Characters
  facing away from the conversation read as a mistake.
- **Leave room for heads.** Profile heads reach far in front of the feet (snouts, beaks, cap
  brims) and shells behind them: space neighbours by those extents, not by their feet.
- **Hand-held props follow the hand.** When a character bounces or throws something, key the
  prop from the hand positions of the clip (measure the anchor at the clip's key times) so the
  palm actually touches it.
- **Vehicles exist only while they drive.** Hide them (`actors.<id>.opacity`) before they enter
  and after they leave, and start them so they enter the frame with their sound effect.
- **Tracks hold their first key before it.** A `pose`/`set` at t = 40 s also applies before
  40 s, so give every changing channel an explicit value at t = 0 (e.g. `view: "profile"`).

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
- Several views (profile, 3/4 front, 3/4 back) share one skeleton: add a hidden `switch` part
  (`view`) whose variants are empty, give view-specific parts `visibleWhen: { part: "view", … }`,
  and a `pose` control that sets `parts.view.variant` and moves bones (arms to the sides, eyes and
  mouth towards the middle of the face, `parts.<id>.opacity: -1` to hide the face from behind).
  When each view has its own mouth, list them all in the viseme control (`part: ["mouth", "mouthFront"]`).
  Hide the switch with a quick squash clip (e.g. `bones.root.scaleX` 1 → 0.8 → 1) at the change.

## Common validation errors

| Message | Fix |
|---|---|
| `unknown bone "x". Known bones: …` | Use one of the listed ids |
| `parent "x" is not declared before this bone` | Reorder `skeleton` so parents come first |
| `use either setup form (from/to) or local form …` | Pick one form per bone |
| `unknown clip "x"` | Check `toon describe` output |
| `Unrecognized key: "rotaton"` | Typo — the format rejects unknown fields |
