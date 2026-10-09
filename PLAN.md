# animeStudio — 2D Animation Engine Plan

A TypeScript 2D animation engine for cartoon/anime-style drawings (e.g. Peppa Pig),
with skeletons, IK, weighted physics, lip sync and SVG rendering — designed to be used
in Remotion to produce full videos.

## Decisions

| Topic | Decision |
|---|---|
| Dimension | 2D only |
| Rendering | SVG (React) — Remotion compatible |
| Character authoring | 3 paths: **code** (AI can generate on its own), **hand-drawn SVG** (higher visual quality), **visual editor** (later phase) |
| Style | **Both**: rigid cut-out and bending limbs — mixable within the same character |
| Who animates | **Both**: keyframe API (developers) + high-level script DSL (AI-generated) |
| Lip sync | **Both**: TTS with timestamps and recorded audio (Rhubarb) |
| Language | All code, comments and documentation in English |

## Core principle: determinism

Remotion renders each frame in isolation, in parallel and out of order. Therefore:

- **`pose = f(scene, frame)`** — a pure function. No state accumulated via `requestAnimationFrame`.
- Keyframes, IK and procedural animation (blink, breathe, look-at) are computed directly from time.
- Physics (which depends on the past) is **baked**: fixed-timestep simulation from 0→N, cached
  as JSON and sampled per frame. In Remotion, via `calculateMetadata` or a `bake` CLI.
- Randomness is always seeded (`random(seed)`), never `Math.random()`.

## Single intermediate format (the heart of the system)

Every authoring path produces the same **Rig JSON**, validated by a schema (zod):

```
TS code ──────────────────┐
SVG + naming convention ──┼──►  Rig JSON (validated)  ──►  engine  ──►  SVG
visual editor ────────────┘
```

Animations work the same way:

```
keyframes (low-level API) ──┐
script DSL (AI) ────────────┼──►  Timeline JSON  ──►  per-frame evaluation
clips / procedurals ────────┘
```

Schema validation yields clear error messages — essential for the AI to fix what it generates.

### Bone attachment types

They coexist in the same rig; this is what enables both styles:

| Type | Description | Style |
|---|---|---|
| `rigid` | SVG group attached to a bone (transform) | Peppa / South Park |
| `skinned` | SVG path whose control points are weighted across bones (linear blend skinning on béziers) | Bending limbs |
| `hose` | Procedurally generated limb (stroked path between joints, variable thickness) | Rubber hose / Cuphead |
| `switch` | Swaps between variants (mouths, hands, eyes, front/profile views) | All |
| `morph` | Interpolates between compatible shapes (expressions) | All |

## Architecture (pnpm monorepo + TypeScript)

```
packages/
  core/        2D math, skeleton (FK), IK (two-bone, FABRIK), constraints,
               timeline, keyframes, easing, clips, mixer (layers/blending), zod schemas
  physics/     springs and verlet chains (tails, ears, hair), mass/weight,
               squash & stretch, baking; deterministic Rapier 2D adapter for rigid bodies
  svg/         render tree, attachments (rigid/skinned/hose/switch/morph),
               SVG import via naming convention
  lipsync/     visemes (Preston Blair A–H, X), Rhubarb (Node), TTS alignment
  script/      high-level DSL: actors, actions (walkTo, say, lookAt, pickUp...), camera
  react/       <Scene>, <Character>, hooks
  remotion/    adapter: useCurrentFrame → engine, <Audio>, baking in calculateMetadata
  player/      development preview (foundation for the future editor)
apps/
  playground/  Vite — live rig testing
  video/       example Remotion project
```

## External libraries

| Area | Choice |
|---|---|
| Skeleton, FK, IK, skinning, secondary physics | Custom (Spine/DragonBones/Rive don't fit deterministic SVG output) |
| Rigid bodies | `@dimforge/rapier2d-deterministic` |
| Path morphing | `flubber` (or custom for compatible paths) |
| SVG path parsing | `svg-pathdata` |
| Schema validation | `zod` |
| Audio lip sync | Rhubarb Lip Sync (CLI) |
| TTS lip sync | Provider timestamps (e.g. ElevenLabs) → phonemes → visemes |
| Testing | Vitest (+ per-frame SVG snapshots) |

## Animation features

- Skeleton with per-bone mass, rotation limits and length
- Clips and mixer: `walk` + `wave` + `talk` as layers, crossfades
- Procedurals: blink, breathe, look-at, parametric walk cycle, foot planting (IK)
- Cartoon principles: squash & stretch, anticipation, overshoot, follow-through
- Views: swapping drawing sets (front / profile / 3/4)
- Scene: camera (pan, zoom, shake), layers, parallax, character ↔ object interaction

## SVG import convention (draft)

Named layers/groups in Figma/Illustrator/Inkscape:

- `bone:name` → bone (pivot = `pivot:name` element or the group's center)
- `part:name@bone` → rigid attachment on that bone
- `skin:name` → skinned path (weights defined in the companion rig JSON)
- `switch:mouth/A`, `switch:mouth/B` … → variants
- Extra metadata (limits, mass) lives in the companion rig JSON

## Roadmap & status

| Phase | Deliverable | Status |
|---|---|---|
| 0 | Monorepo, TS, Vitest, Vite playground, Remotion project | ✅ Done |
| 1 | Rig/Timeline schemas, FK, `rigid` + `switch` parts, keyframes + easing, React render, Remotion | ✅ Done |
| 2 | `skinned` + `hose` parts, IK (two-bone, FABRIK), rotation limits | ✅ Done |
| 3 | Clip mixer (layers, fades, additive), behaviors (blink, breathe, sway), aim / look-at | ✅ Done |
| 4 | Weighted secondary physics (springs, jiggles), baking, local squash & stretch | ✅ Done |
| 5 | Lip sync (Rhubarb, TTS timestamps, text+audio alignment, amplitude), morph mouths | ✅ Done |
| 6 | Script DSL (`walkTo`, `say`, `lookAt`, `pose`, `camera`, `shake`…) | ✅ Done |
| 7 | Rapier rigid bodies, character colliders, grab / release / impulse | ✅ Done |
| 8 | SVG import via naming convention, `morph` parts | ✅ Done |
| 9 | Visual editor (rig + timeline) — see [docs/EDITOR.md](docs/EDITOR.md) | ✅ Done (v1) |

Lip sync uses Rhubarb when installed (phonetic recognizer for non-English speech), falling
back to text + audio alignment.

Cinematic camera (framing, advanced follow, paths, punch-ins, handheld, dolly, depth of field,
motion blur, bounds), shots and transitions (`toon-sequence`), ground surfaces and cartoon FX were
added after the comic-strip test production.

Lighting (lights, ambient darkness, automatic cel shading, grading, vignette, smooth color
interpolation) was added after the first test production showed flat, effect-less light.

Implemented beyond the original plan: `toon` CLI (`validate`, `describe`, `schema`, `lipsync`,
`import-svg`, `render`), JSON Schemas, AI authoring guide, smooth monotone spline interpolation
as the default, trapezoidal locomotion profile, cross-faded visemes.

### Backlog

- Editor v2: weight painting for skinned parts, pose library, curve editor, scene timeline.
- `.toon` zip bundles and `.toon.svg` (SVG with the document embedded in `<metadata>`).
- Procedural walk-cycle generator from leg chains.
- Actor ↔ actor collisions and ragdoll mode.
- Per-actor `say` speech bubbles / subtitles.
- npm publishing (build step with tsup, versioning, changelog).
