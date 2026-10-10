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
- **Wardrobe follows the place, not the previous scene.** Outfits and accessories are pose
  controls on the same rig (e.g. `outfit`, `backpack`); dress each block in its cast entry
  (`wear`) — swimsuits at the beach, backpacks at school — and change them on screen with a
  `wear` beat when the story does (taking the backpack off at home).
- **Riding, sitting, lying are staged, not drawn per shot.** Declare the bicycle or the sofa in the
  block and use `ride` / `fall` / `getUp` / `sit` / `lie`; the director seats the hips, puts the
  feet on the pedals or the floor and keeps the far leg behind the bicycle. A beginner wobbles
  (`wobble`) before falling; nobody walks while sitting. Watching TV or in class, sit facing the
  audience (`"view": "front"`).
- **Passing behind vs hiding.** Walking behind a table or a car needs nothing (the depth `z` draws
  it in front). Hiding on purpose is a `hide` beat (`behind` the object, `until` the reveal) plus
  `peek` beats: the director crouches the character until the head is under the object's top and
  keeps the body above its lower edge, so only the feet show under a tablecloth — never fake it by
  moving the character off screen or behind the set.
- **Time of day is one light beat.** `{"do": "light", "mood": "night"}` darkens the scene and swaps
  the set to its night version (sky, moon, lamps, clocks) — never stage a night scene in a day set
  without it. A block that happens at night starts with `"mood": "night"`.
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
- **People around a table: leave the camera side open.** Never stage a row of profiles along a
  table (everyone stares at the next one's neck and the table cuts them at the waist). Seat the
  group behind the table facing the camera (front view), with the table as a foreground layer —
  a tablecloth hides the laps and legs — and the tabletop at elbow height so the forearms rest on
  it, hands and papers on the top. Put the one they all address (a host, a game master) at the
  end of the table in profile, facing them, and let the others' eyes turn to them. Keep bottles
  and props on the table between people, never in front of a face.
- **Gestures in the front view are hand positions, not arm swings.** Clips rotate the arm in the
  picture plane, which reads as flapping from the front. Use IK reach targets instead: the hand
  on the forehead (a facepalm), on a cheek (despair), fists by the chin (excitement), the hand
  forward over the table (throwing dice). Aim at the centre of the face (a profile head anchor
  sits on the nose side), and use the near hand: in the front view the far arm is drawn behind
  the body.
- **Set bounds are the drawn world.** `SetDef.bounds` must match the extent of the drawn ground
  and background: `check` reports anyone whose body goes past it (thrown, falling, running off).
- **Tracks hold their first key before it.** A `pose`/`set` at t = 40 s also applies before
  40 s, so give every changing channel an explicit value at t = 0 (e.g. `view: "profile"`).

### Lighting

- Give scenes a `lighting` block for mood: a `point` light with `glow` for visible light sources
  (sun, lamp) and a `directional` key light with `glow: 0` for character shading.
- Animate time of day with the `light` action or tracks: e.g. raise `lights.sun.intensity` and
  lower `lighting.ambient.opacity` for a sunrise; hex colors blend smoothly.
- Keep large glows away from characters — additive light lifts black outlines.
- Character shading is the most expensive part of a frame on render farms without a GPU (about
  30 ms per lit character). On sets where the whole cast gathers, set `shading.crowd` (e.g. 4):
  crowd shots then drop the rim light.

## Writing characters

- **TV-cartoon humans: `cartoonCharacter(look)`** (kit) — the family-sitcom look: long thin
  limbs, big sneakers, oval eyes, thick brows, cel shading and coloured lines, six drawn angles
  (turns are in-betweened), follow-through and hand-drawn timing built in. Clothes, prints,
  hats and accessories are fields of the look; anything that belongs to one series (props, sets,
  names) stays in the series, never in the kit.
- **Rooms in perspective: one camera for everything.** Give the set a `RoomCamera` and build its
  furniture with `furnitureRig` (sofa, TV, table) instead of drawing it in perspective by hand: the
  furniture, the floor lines and the seated cast then agree. Seats tell the director which way to sit.
- **Drawing like a painted cartoon:** lines in a dark tone of the fill (colour holds), never
  black; one light direction; hard-edged shadow shapes inside the silhouette (no stroke on
  fills, lines on top); shadows multiplied by a dusty rose so skin shadows stay warm; shade
  curls as one mass (smooth the normals), not curl by curl.
- **Humans: start from `humanCharacter(look)`** (kit). A dozen fields — skin, hair style and
  colour, eyes, outfit and colours, glasses, headband, scarf, cape — give a complete character
  with a front view, hand shapes, every gesture and walk, the fighting set and the emotions. Draw
  a character by hand only for animals or a look the builder cannot make.

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
  A profile drawn with one eye needs its own front face: give the front eyes one rigid part per
  eye variant with `visibleWhen: { part: "eyes", variant }` (blinks and emotions then drive both
  views), hide them in the other views by opacity, and copy every `parts.mouth.*` / `parts.brows.*`
  channel of the emotion poses to the front mouth and brows. Draw the front face symmetric about
  one centre line (two mirrored eyes, centred mouth, both ears) and the hair from the front (the
  skull's top edge, then the bangs) rather than reusing profile spikes.
- Hands read better with shapes than as plain circles: give the hands a switch part with
  `handShapes` (open, fist, point, grip) and build the clips with `hands: true` — a pointing
  gesture then shows a finger, a punch a fist, a wave an open hand.
- A change of view (profile ↔ front/back) is hidden by the kit's `turn` clip (a quick squeeze);
  the director plays it automatically on every `view` change.
  Hide the switch with a quick squash clip (e.g. `bones.root.scaleX` 1 → 0.8 → 1) at the change.

## Common validation errors

| Message | Fix |
|---|---|
| `unknown bone "x". Known bones: …` | Use one of the listed ids |
| `parent "x" is not declared before this bone` | Reorder `skeleton` so parents come first |
| `use either setup form (from/to) or local form …` | Pick one form per bone |
| `unknown clip "x"` | Check `toon describe` output |
| `Unrecognized key: "rotaton"` | Typo — the format rejects unknown fields |
