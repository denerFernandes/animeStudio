# animeStudio

A deterministic **2D cartoon animation engine** for the web. Characters are SVG art bound to
skeletons with IK, weighted secondary physics, squash & stretch, controls (emotions, look-at,
lip sync) and clips. Scenes add actors, props with rigid-body physics, camera moves and a
script. Everything renders to SVG and plugs straight into **Remotion** to produce full videos.

```
pose = f(document, time)   // every frame is a pure function → parallel, out-of-order rendering is safe
```

## Highlights

- **Open JSON format** (`*.toon.json`, `*.scene.json`) — written by humans, code or AI, validated
  with precise, actionable errors. See [docs/FORMAT.md](docs/FORMAT.md).
- **Both cartoon styles**: rigid cut-out parts (Peppa Pig style) and bending limbs (skinned paths,
  procedural rubber-hose limbs), mixable in one character.
- **Fluid by default**: smooth monotone splines between keys, eased cross-fades between clips,
  accelerate/decelerate locomotion, smooth look-at transitions, cross-faded morph mouths.
- **Skeleton**: forward kinematics, two-bone and FABRIK IK, rotation limits, local
  (non-inherited) squash & stretch.
- **Physics**: baked spring chains and jiggles with per-bone mass (ears, tails, hair), plus
  deterministic Rapier rigid bodies for props that collide with characters.
- **Cartoon FX**: surprise strokes, "!", "?", sweat drops, sparkles, dust puffs, hearts, "zzz",
  anger veins, impact bursts and gloom lines that follow, flip and scale with characters.
- **Cinematic camera**: moves and curved paths, follow with dead zone and look-ahead, automatic
  framing, punch-in zooms, handheld drift, vertigo dolly zoom, depth of field with rack focus,
  motion blur, scene bounds, shakes and parallax layers.
- **Shots & transitions**: sequences of scenes with cuts, crossfades, fades, cartoon irises,
  wipes and flashes (`*.sequence.json`), also available inside a scene.
- **Ground surfaces**: characters walk on curved, sloped ground with feet adapting to the slope;
  rigid bodies collide with it.
- **Lighting**: point and directional lights with additive glow, ambient darkness that lights
  cut through, automatic cel shading on characters (shadow + rim light that follow the pose),
  color grading and vignette — all animatable, all plain SVG.
- **Characters from volumes**: heads, hair and clothes modelled as simple 3D volumes and drawn
  flat at any angle — turnarounds that always match, cel shading from the volume and coloured
  lines. A TV-cartoon human builder (`cartoonCharacter`) turns through in-between drawings, with
  follow-through and hand-drawn timing (anticipation, overshoot).
- **Lip sync**: Preston Blair visemes from Rhubarb (any language via its phonetic recognizer),
  TTS timestamps, text + audio alignment, text only, or audio amplitude.
- **Visual editor**: rig bones over your art, animate by dragging bones and IK handles,
  keyframe timeline with smooth/eased keys, onion skin, undo/redo, live validation.
- **Remotion** adapter, React renderer, SVG string renderer, CLI and a live playground.

## Repository

| Path | Description |
|---|---|
| [`packages/core`](packages/core) | Format schemas, validation, rig, animation, IK, physics, scenes, render tree |
| [`packages/react`](packages/react) | `<ToonFrame>`, `<ToonScene>` React SVG renderer |
| [`packages/remotion`](packages/remotion) | `<ToonComposition>` and `toonMetadata()` for Remotion |
| [`packages/rigid`](packages/rigid) | Deterministic Rapier rigid bodies (`prepareScene`, `bakeRigidBodies`) |
| [`packages/lipsync`](packages/lipsync) | Lip sync helpers; `/node` adds WAV decoding and Rhubarb |
| [`packages/import-svg`](packages/import-svg) | Layered SVG drawing → character, by naming convention |
| [`packages/cli`](packages/cli) | `toon` command line |
| [`apps/editor`](apps/editor) | Visual editor: rig bones, edit parts, animate clips on a keyframe timeline ([guide](docs/EDITOR.md)) |
| [`apps/playground`](apps/playground) | Live preview: clips, emotions, say, look-at, skeleton overlay |
| [`apps/video`](apps/video) | Remotion project rendering the examples |
| [`examples`](examples) | "Pip" character (authored in code) and the "hello" scene |
| [`schemas`](schemas) | Generated JSON Schemas |
| [`docs`](docs) | Format specification and guides |

## Quick start

```bash
pnpm install
pnpm test                 # unit tests
pnpm examples             # rebuild example JSON, audio (macOS `say`) and lip sync cues
pnpm --dir apps/editor dev
pnpm --dir apps/playground dev
pnpm --dir apps/video studio
pnpm --dir apps/video exec remotion render Hello ../../out/hello.mp4
```

## Using it in a Remotion project

```tsx
import { ToonComposition, toonMetadata } from "@animestudio/remotion";
import scene from "./my.scene.json";
import pip from "./pip.toon.json";

export const Root = () => (
  <Composition
    id="MyScene"
    component={ToonComposition}
    {...toonMetadata(scene)}
    defaultProps={{ scene, assets: { characters: { pip }, lipsync: {} } }}
  />
);
```

Audio paths in a scene resolve with `staticFile()` by default (`resolveAudio` to customize).

## Using the core directly

```ts
import { compileScene, evaluateScene, frameToSVG } from "@animestudio/core";

const scene = compileScene(sceneDoc, { characters: { pip } });
const svg = frameToSVG(evaluateScene(scene, 2.5)); // frame at t = 2.5 s
```

## CLI

```bash
toon validate examples/scenes/hello.scene.json
toon describe examples/characters/pip.toon.json      # what can be animated — paste into AI prompts
toon lipsync line.wav --text "Hello there!" -o line.cues.json
toon lipsync fala.wav --lang pt -o fala.cues.json   # Rhubarb phonetic recognizer
toon import-svg drawing.svg --name hero -o hero.toon.json
toon render examples/scenes/hello.scene.json --time 3 -o frame.svg
toon schema --out schemas
toon debug my.sequence.json                         # library-side diagnostics (refs, ids, pops…)
toon doctor out/video.mp4 my.sequence.json          # flickers / unpainted nodes in a render
```

(Inside this repo: `npx tsx packages/cli/src/bin.ts <command>`.)

## Lip sync setup

Install [Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync/releases) and put
`rhubarb` on your PATH (or `~/.local/bin`, or set `RHUBARB_PATH`). Without it, lip sync falls back
to aligning the dialog text to the audio.

## Debugging renders

Render with `debug` (prop of `<ToonComposition>` / `<ToonSequenceComposition>`) to add an
instrumentation strip: every element paints a small colored sentinel inside its own content and
each frame carries a barcode with its index. `toon doctor video.mp4 doc.json` then reports
flickers, whether the library output changed at those frames, and exactly which elements the
browser failed to paint in which frames. Sentinels of transparent (opacity < 0.6) or strongly
blurred (≥ 2px) elements cannot be verified and are counted as skipped instead of reported.
Flickers with stable library output are browser capture glitches; they are usually
nondeterministic, so re-rendering the reported frames fixes them.

`toon debug doc.json` runs library-side checks without rendering: invalid numbers, broken
references, duplicate ids, nodes present for a single frame, camera/position jumps.

While rendering, the Remotion components mount a fresh SVG tree for every frame (in-place updates
occasionally left elements unpainted in Chrome's capture next to blurred layers).

## Rendering notes

On some macOS setups Remotion's bundled headless Chrome crashes at GPU initialization
("Navigation failed because browser has disconnected"). `apps/video/remotion.config.ts` therefore
uses a system Chrome when present, or the browser in `REMOTION_BROWSER`.

## Documentation

- [Format specification](docs/FORMAT.md)
- [API reference](docs/API.md)
- [Authoring guide for AI agents](docs/AI_GUIDE.md)
- [Director: staging whole episodes](docs/DIRECTOR.md)
- [Editor guide](docs/EDITOR.md)
- [Architecture & roadmap](PLAN.md)

## Contributing

Documentation is part of every change: new functions go in [docs/API.md](docs/API.md), new
format fields, channels and actions in [docs/FORMAT.md](docs/FORMAT.md). A test
(`packages/core/test/docs.test.ts`) fails when a public export is missing from the API reference.
