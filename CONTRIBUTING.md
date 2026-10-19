# Contributing to animeStudio

Thanks for helping! animeStudio is a deterministic 2D/2.5D cartoon animation engine: every frame
is a pure function of the documents and the time (`pose = f(document, time)`). Contributions are
welcome as issues, discussions and pull requests. This guide explains how the repository is laid
out, how to work on it and what a change needs before it can be merged.

## Getting started

Requirements: a current Node.js LTS and [pnpm](https://pnpm.io) 9. Rendering videos without a browser (the
promo, CLI renders) also needs `rsvg-convert` (librsvg), `ffmpeg` and ImageMagick (`magick`). Lip
sync from audio needs [Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync/releases)
on your `PATH` (optional).

```bash
git clone https://github.com/denerFernandes/animeStudio.git
cd animeStudio
pnpm install
pnpm test          # all unit tests (vitest, from the repo root)
pnpm typecheck     # TypeScript, no emit
```

Useful commands:

| Command | What it does |
|---|---|
| `pnpm test` | Every package's tests. Run them from the root: the root config gives the slow 2.5D tests a 30 s timeout |
| `pnpm typecheck` | Type-checks packages and examples |
| `pnpm schemas` | Regenerates `schemas/*.schema.json` after a change to the format (`packages/core/src/format/schema.ts`) |
| `pnpm examples` | Rebuilds the example character, scene, audio and lip sync |
| `pnpm promo` | Renders the feature promo (`examples/promo`) |
| `pnpm --dir apps/playground dev` | Live playground |
| `pnpm --dir apps/editor dev` | Visual editor |
| `npx tsx packages/cli/src/bin.ts --help` | The `toon` CLI from source |

## Repository layout

| Path | Contents |
|---|---|
| `packages/core` | Format schemas and validation, rig, poses (2D and 2.5D), physics, scenes, camera, lighting, FX, rendering |
| `packages/kit` | Ready-made characters (`cartoonCharacter`, `humanCharacter`), their clips (walks, runs, gestures, knock-downs) and building blocks |
| `packages/director` | Stages whole episodes from a staging + timed lines + a kit |
| `packages/react`, `packages/remotion` | Renderers |
| `packages/rigid`, `packages/lipsync`, `packages/import-svg`, `packages/cli` | Rigid bodies, lip sync, SVG import, the `toon` CLI |
| `apps/` | Editor, playground, the Remotion video project |
| `examples/` | Example character and scene, the feature promo |
| `docs/` | Format spec, API reference, director and editor guides, AI authoring guide |

`apps/video/sandbox/` is git-ignored: use it for local experiments and throwaway render scripts.

## Principles

These are what reviews check first.

1. **The engine owns behaviour.** A motion, a gesture or a rule (a run, a fall, an arm kept out of the
   head) is implemented once in the library and works for every character and every view. Do not
   work around an engine problem in a scene or an example; fix it in `core`, `kit` or `director`.
2. **Determinism.** No `Math.random()`, `Date.now()` or wall-clock state in evaluation. Randomness is
   seeded (by actor id, by line), and physics is baked. The same documents always render the same
   frames, in any order and in parallel.
3. **Generic, never content-specific.** No names of shows, characters or sets in `packages/`. The
   library speaks of builds, looks, props and marks.
4. **Smooth by default.** Characters animate on ones; hand-drawn options (twos, line boil, smears)
   stay opt-in.
5. **Backwards compatibility of documents.** Existing `*.toon.json` / `*.scene.json` keep working:
   new fields are optional, with defaults that reproduce today's output. When a default changes, say
   so in the pull request and in the docs.

## Documentation is part of every change

A change is not done until it is documented, in English:

- New or changed **public functions and types** → [docs/API.md](docs/API.md). A test
  (`packages/core/test/docs.test.ts`) fails when a core export is missing from it.
- New **format fields, channels, script actions, clip options** → [docs/FORMAT.md](docs/FORMAT.md),
  then `pnpm schemas`.
- New **director beats or options** → [docs/DIRECTOR.md](docs/DIRECTOR.md); things an AI author
  should know → [docs/AI_GUIDE.md](docs/AI_GUIDE.md).
- User-visible features → a line in the [README](README.md) highlights.
- JSDoc on every export. Comments explain *why*, not just *what*, in the dense style of the existing
  code.

## Tests and visual checks

- Add tests next to the package you change (`packages/<name>/test/*.test.ts`). Prefer properties
  over snapshots: "the planted foot does not slide", "the arm is never inside the head in any view",
  "the back lands on the floor in both facings".
- Snapshots that pin existing output (e.g. `packages/kit/test/fixtures/walk-snapshot.json`) must only
  change on purpose; explain why in the pull request.
- **Look at what you change.** Anything that moves on screen (clips, gaits, poses, the 2.5D
  projection, lighting) needs renders checked by eye: several views (front, three-quarter, side,
  back), both facings, consecutive frames to catch pops. Render with `frameToSVG` and
  `rsvg-convert` (see `examples/promo/render.ts`), and attach before/after images to the pull
  request.

## Commits and pull requests

- Branch from `master`; keep a pull request to one topic.
- Commit messages: a short summary of what the change does for users of the library, in the present
  tense (look at `git log` for the style), with details in the body when needed.
- Before opening a pull request: `pnpm test` and `pnpm typecheck` pass, the docs are updated,
  schemas are regenerated if the format changed, and renders are attached for visual changes.
- Do not commit generated media other than the documented examples, local sandboxes, secrets
  (`.env*`) or editor settings.

## Reporting bugs and proposing features

Open an issue with:

- what you did: the smallest scene or character document that shows it (JSON or code);
- what you expected and what happened — a rendered frame or a short clip helps a lot;
- for render problems, the output of `toon debug <doc>` and, for flickers in a video,
  `toon doctor <video> <doc>`.

Feature proposals are easiest to discuss with a sketch of the format (the JSON an author would
write) and a reference (a drawing, a frame from an animation, an animator's guide).
