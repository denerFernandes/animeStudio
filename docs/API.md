# API Reference

Public API of every animeStudio package. The JSON format itself is specified in
[FORMAT.md](FORMAT.md); this document covers the TypeScript functions and components.

> Convention: lengths in px, angles in degrees (clockwise, y down), time in seconds.
> Every evaluation function is pure — same inputs, same output — so frames can be computed in any
> order.

## Typical flows

```ts
import { compileScene, evaluateScene, frameToSVG, parseScene, parseToon } from "@animestudio/core";

// 1. Validate documents (throws a readable error listing every issue).
const pip = parseToon(pipJson);
const scene = compileScene(parseScene(sceneJson), { characters: { pip }, lipsync: { l1: cuesJson } });

// 2. Evaluate any frame.
const frame = evaluateScene(scene, 2.5); // RenderFrame
const svg = frameToSVG(frame);           // standalone SVG string
```

```tsx
// React / Remotion
import { ToonScene } from "@animestudio/react";
import { ToonComposition, toonMetadata } from "@animestudio/remotion";
```

---

## `@animestudio/core`

### Validation & schemas — `format/validate.ts`, `format/schema.ts`

| Function | Description |
|---|---|
| `validateToon(input: unknown): ValidationResult<ToonDoc>` | Schema + reference + compilability check of a character. `issues[]` have `path`, `message`, `severity` (`error` / `warning`, e.g. unknown palette colors) |
| `validateScene(input: unknown, assets?: SceneAssets): ValidationResult<SceneDoc>` | Validates a scene; with `assets` the whole scene (script, channels, lighting) is compiled |
| `validateSequence(input: unknown): ValidationResult<SequenceDoc>` | Validates a sequence (shots must reference declared scenes) |
| `parseToon(input)` / `parseScene(input, assets?)` | Same as above but return the document or throw an `Error` listing all issues |
| `jsonSchemas(): { toon, scene, sequence }` | JSON Schemas (draft 2020-12) for editors and LLM structured output |

Zod schemas are exported for every document part, each with a matching inferred type
(`…Schema` → `…Def` / `…Doc`):

| Area | Schemas |
|---|---|
| Documents | `ToonSchema` (`ToonDoc`), `SceneSchema` (`SceneDoc`), `SequenceSchema` (`SequenceDoc`), `LipsyncSchema` (`LipsyncDoc`), `MouthCueSchema` (`MouthCue`) |
| Character | `BoneSchema`, `PartSchema` (`RigidPartSchema`, `SwitchPartSchema`, `SkinnedPartSchema`, `HosePartSchema`, `MorphPartSchema`), `AnchorSchema`, `IkSchema`, `PhysicsSchema` (`SpringPhysicsSchema`, `JigglePhysicsSchema`), `ColliderSchema`, `ControlSchema` (`VisemeControlSchema`, `AimControlSchema`, `PoseControlSchema`), `BehaviorSchema`, `ClipSchema` |
| Scene | `ActorSchema`, `PropSchema`, `BodySchema`, `LayerSchema`, `ActionSchema`, `LightingSchema`, `LightSchema`, `SurfaceSchema` (`SurfaceDef`) |
| Sequence | `ShotTransitionSchema` (`ShotTransitionDef`) |
| Values | `ValueSchema` (`Value`), `Vec2Schema`, `KeyframeSchema` (`Keyframe`), `TracksSchema` (`Tracks`), `EaseSchema` |

`VISEMES` lists the viseme letters `A`–`H` and `X` (type `Viseme`).

### Rig — `rig.ts`

| Function | Description |
|---|---|
| `compileRig(doc: ToonDoc, options?: { palette?, idPrefix? }): Rig` | Compiles a character: bones (setup matrices), parts (art resolved, palette applied, SVG ids prefixed), IK, physics, colliders, controls, behaviors, clips (tracks resolved). Throws `RigError` with a JSON path |
| `resolveChannel(rig, channel: string): ChannelRef` | Parses a character channel (`bones.arm.rotation`, `parts.mouth.morph.A`, `ik.foot.x`, `controls.emotion`, …); errors list valid ids |
| `resolvePalette(markup, palette)` | Replaces `palette(name)` tokens |
| `namespaceIds(markup, prefix)` | Prefixes `id`s and rewrites `url(#…)` / `href="#…"` |
| `boneLocalMatrix(bone, dx?, dy?, drot?, msx?, msy?, squash?)` | Local matrix of a bone with offsets (squash stretches along the bone) |
| `composeWorld(bone, parentWorld, local, localRotation)` | World matrix honoring `inheritRotation` / `inheritScale` |
| `visemeVariant(control, part, viseme)` | Variant / shape for a viseme, with fallbacks for smaller mouth sets |

Types: `Rig`, `RigBone`, `RigPart`, `RigClip`, `RigIk`, `RigPhysics`, `RigControl`, `RigBehavior`,
`RigTrack`, `ChannelRef`, `BoneProp`, `PathStyle`, `CompileRigOptions`, `RigError`.

### Pose evaluation — `pose.ts`

| Function | Description |
|---|---|
| `evaluatePose(rig, input: CharacterInput, resolveAim?): EvaluatedPose` | Pipeline steps 1–7: clips (mixer), direct tracks, pose / viseme controls, behaviors, limits + FK, IK, aim. `input`: `time`, `clips`, `tracks`, `seed`, `aim` overrides, `ikOffset` (extra IK target offsets, e.g. feet on slopes) |
| `applyPhysicsSample(rig, pose, sample)` | Step 8: applies a baked physics sample in place |
| `computeWorld(rig, state, out?)` | Forward kinematics (squash is local: children are not distorted) |
| `createPoseState(rig)` | Empty channel state |
| `applyChannel(state, ref, value, weight, mode)` | Writes a channel value (`override` / `additive` blending) |
| `clipInstanceWeight(inst, t)`, `clipLocalTime(inst, duration, t)` | Mixer helpers (eased fades, looping) |
| `isLayeredChannel(ref)` | Whether direct tracks add on top of clips for this channel |
| `isBlinking(seed, interval, duration, t)` | Deterministic blink schedule |
| `currentVariant(rig, state, partIndex)` | Variant currently shown by a switch part |

Types: `PoseState`, `EvaluatedPose`, `CharacterInput`, `ClipInstance`, `BlendMode`, `PhysicsSample`.

### Physics — `physics.ts`

| Function | Description |
|---|---|
| `bakePhysics(rig, { duration, rate?, poseAt, placementAt }): PhysicsBake` | Fixed-step (default 120 Hz) simulation of springs and jiggles in scene space; returns per-step bone deltas. Restarts at rest when the placement flips |
| `samplePhysics(bake, t)` | Interpolated sample at time t (never interpolates across a restart, e.g. at a flip) |

### Keyframes & easing — `keyframes.ts`, `easing.ts`

| Function | Description |
|---|---|
| `normalizeTrack(keys, opts?: { loop? })` | Sorts keys and precomputes monotone spline tangents (`loop` makes cycles seamless) |
| `makeTrack(keys: Key[], opts?)` | Same, from normalized keys |
| `sampleTrack(track, t)` | Value at t — smooth spline by default, explicit `ease` per key |
| `interpolateValue(a, b, t)` | Numbers, `[x, y]`, weight records, **hex colors**; other strings step |
| `mixColor(a, b, t)` / `parseHex(color)` | Hex color blending / parsing |
| `normalizeKey(k)`, `trackEnd(track)` | Helpers |
| `getEasing(ease)` / `cubicBezier(x1, y1, x2, y2)` | Easing functions; `EASING_NAMES` lists the named ones |

### Paths — `paths.ts`

| Function | Description |
|---|---|
| `parsePath(d): CubicPath` | Any SVG path → absolute cubic subpaths |
| `pathToString(path)`, `pathPoints(path)`, `withPoints(path, points)` | Serialize / flatten / rebuild |
| `equalizePaths(paths)` | Makes shapes morph-compatible (same segment counts) |
| `sampleCenterline(joints, smooth, perSegment?)` | Catmull-Rom centerline |
| `hoseOutline(joints, widths, cap, smooth)` | Variable-width tube outline (rubber-hose limbs) |

### Scenes — `scene.ts`

| Function | Description |
|---|---|
| `compileScene(doc, assets: SceneAssets): CompiledScene` | Compiles actors, props, layers, camera, user tracks, script actions and lighting into tracks and clip instances. Throws `SceneError` with a path |
| `evaluateScene(scene, t): RenderFrame` | Full frame at time t: layers, actors (with baked physics and shading), props (rigid bodies, grabs), cartoon effects, lighting overlays, sorted by `z` |
| `actorPose(scene, actor, t)` | Final pose of an actor (including physics) |
| `actorBake(scene, actor)` | Lazily computed physics bake for an actor |
| `actorPlacement(actor, t)` | Character → scene matrix |
| `anchorPosition(scene, actorId, anchor, t, pose?)` | Scene position of an actor anchor |
| `propPlacement(scene, prop, t, poses?)` | Prop placement (tracks, rigid body sample or grab) |
| `cameraAt(scene, t): CameraState` | Camera at time t: base tracks → director segments (moves, paths, follows, frames, holds — each starting from the camera's actual pose) → punch-ins → handheld → shakes → bounds |
| `viewMatrix(scene, camera, parallax?)` | Scene → screen matrix for a depth (applies zoom, rotation, parallax and dolly) |
| `screenPoint(scene, target, t)` | Screen position of an actor (head anchor), prop or scene point |
| `CAMERA_CHANNELS` | Animatable camera channels: `x`, `y`, `zoom`, `rotation`, `handheld`, `dolly`, `focus`, `blur`, `focusRange`, `motionBlur` (type `CameraChannel`) |
| `defaultChannelValue(rig, ref)` | Rest value of a character channel |
| `cuesToVisemeKeys(cues, offset, blend?)` | Mouth cues → cross-faded viseme weight keys |
| `frameTime(scene, frame)`, `frameCount(scene)` | Frame ↔ seconds helpers |

Types: `CompiledScene`, `CompiledActor`, `CompiledProp`, `CompiledLayer`, `CompiledFx`,
`CompiledTransition`, `SceneAssets`, `AudioEvent`, `Shake`, `Grab`, `RigidBodySampler`,
`SceneError`.

### Camera — `camera.ts`

Used by `cameraAt` / `evaluateScene`; exported for tools and custom renderers.

| Function / class | Description |
|---|---|
| `bakeFollow(follow, duration, actorPosition)` / `sampleFollow(samples, start, t)` | Deterministic follow smoothing (dead zone, look-ahead, exponential lag) baked at 60 Hz / sampled |
| `bakeFrame(frame, duration, fitAt)` / `sampleFrame(samples, start, t)` | Smoothed automatic framing (exponential lag on position and log-zoom), so framing never pops when a target flips or jumps |
| `rigWeight(start, end, blend, t)` | Eased in/out weight of a timed camera rig (follow, frame) |
| `rigBounds(rig)` | Setup-space bounding box of a character (cached), used for framing |
| `fitBox(box, width, height, padding, minZoom, maxZoom)` | Camera center and zoom that fit a box |
| `pathPoint(points, u)` | Arc-length point on a smooth camera path |
| `punchFactor(punch, t)` | Zoom multiplier of a punch-in (fast attack, springy settle) |
| `handheldOffset(amount, t, seed?)` | Deterministic handheld drift (x, y, rotation) |
| `clampToBounds(state, bounds, width, height)` | Keeps the view inside scene bounds |
| `depthBlur(camera, depth)` | Depth-of-field blur (screen px) for a parallax depth |
| `cssBlur(screenX, screenY)` | CSS `blur(px)` value for depth of field + motion blur in screen pixels (or `undefined` when negligible). CSS blur is used instead of SVG filter references because browsers sometimes skipped painting elements whose `filter="url(#…)"` changed between frames |
| `matScale(m)` | Average scale of a matrix |

Types: `CameraState`, `CameraPose`, `CameraSegment` (`move`, `path`, `follow`, `frame`, `hold`), `CameraFollow`, `CameraFrame`, `CameraPath`, `CameraPunch`, `CameraBounds`.

### Ground surfaces — `surface.ts`

| Function | Description |
|---|---|
| `compileSurface(def): Surface` | Samples a surface path (top edge of the ground) into an x-sorted polyline |
| `surfaceY(surface, x)` | Ground height at x (clamped at the ends) |

### Transitions — `transitions.ts`

| Function | Description |
|---|---|
| `transitionCoverage(mode, u)` | Eased coverage 0..1 for `out` / `in` / `outIn` |
| `transitionMarkup(params)` | SVG overlay for `fade`, `iris`, `wipe`, `flash` at a coverage |

Types: `TransitionType`, `TransitionMode`, `WipeDirection`, `TransitionParams`.

### Sequences — `sequence.ts`

| Function | Description |
|---|---|
| `compileSequence(doc, { scenes }): CompiledSequence` | Compiles each shot's scene (documents + assets, or already-compiled scenes) and lays shots on the timeline |
| `evaluateSequence(seq, t): RenderFrame` | Frame at global time t: crossfades composite two shots (ids prefixed), through-color transitions overlay the cut |
| `layoutShots(doc, sceneDuration)` | Shot timing (crossfades overlap; other transitions happen at the cut) |
| `sequenceDuration(doc, scenes)` | Total length from scene documents (no compilation) |
| `sequenceAudio(seq)` | Every shot's audio on the global timeline, trimmed to the shot |

Types: `CompiledSequence`, `CompiledShot`, `SequenceAssets`, `SequenceAudioEvent`.

### Lighting — `lighting.ts`

Used by `evaluateScene`; exported for custom renderers and tools.

| Function / constant | Description |
|---|---|
| `baseLighting(def: LightingDef): LightingState` | Lighting state with defaults applied (no animation) |
| `lightingAt(def, tracks, t): LightingState` | Lighting state at time t (animated channels applied) |
| `lightingChannelDefault(def, channel): Value` | Validates a lighting channel and returns its rest value |
| `projectLights(state, view: (parallax) => Mat): ScreenLight[]` | Lights in screen space (position, radius) using the camera |
| `keyLight(state, lights)` | The light used for character shading (`shading.light` or the first light) |
| `shadingMarkup(state, key, actorId, artMarkup, center, scale, width, height): string` | SVG masks + overlays for one actor's shadow and rim crescents (eroded by `inset` to keep outlines crisp). Masks embed their own copy of the actor art (`artMarkup`) — no `<use>` references, which browsers mis-paint inside filtered groups |
| `overlayMarkup(state, lights, width, height): string` | Ambient darkness (with light holes), additive glows, grade, vignette |
| `LIGHTING_DEFS` | Static SVG filters required by shading (added to frame defs automatically) |

Types: `LightingState`, `LightState`, `ScreenLight`.

### Cartoon effects — `fx.ts`

Used by `evaluateScene` for the `fx` action; exported for custom renderers.

| Function / constant | Description |
|---|---|
| `fxMarkup(type, u, t, { color, fill?, seed }): string` | SVG of an effect at normalized progress `u` (0..1), `t` seconds in. Drawn around the origin (the anchor) in character-sized units |
| `FX_TYPES` | `surprise`, `exclaim`, `question`, `sweat`, `sparkle`, `dust`, `hearts`, `zzz`, `anger`, `impact`, `gloom`, `notes`, `stars`, `lightbulb`, `birds` (type `FxType`) |
| `FX_DURATIONS` | Default duration per effect (seconds) |

### Debug mode — `debug.ts`

Tools to find rendering problems, used by `toon debug` / `toon doctor` and the `debug` prop of the
Remotion components.

| Function / constant | Description |
|---|---|
| `diagnoseFrames(frames, times, { maxJump? }): Diagnostic[]` | Library-side checks per frame: NaN/Infinity, broken `url(#…)` / `href` references, duplicate ids, zero-axis blurs, nodes present (or missing) for a single frame, top-level nodes jumping more than `maxJump` px between frames (camera pops) |
| `withDebugOverlay(frame, { frameIndex, time, label? })` | Instruments a frame for a debug render: each top-level node paints a colored sentinel square inside its own content (in a strip at the bottom, `DEBUG_STRIP` px), and a barcode encodes the frame index |
| `sentinelLayout(frame)`, `sentinelColor(key)`, `barcodeLayout(frame)` | Sentinel and barcode geometry (shared by the renderer and the reader) |
| `readDebugStrip(raster, frame, tolerance?)` | Reads a captured frame: decoded frame index plus painted / missing sentinels (= nodes the browser did not paint) |
| `findFlickers(rasters, threshold?)` / `rasterDiff(a, b)` | A→B→A flicker detection on captured frames (a frame that differs from both neighbours while they match each other) |
| `DEBUG_STRIP` | Height of the instrumentation strip |

Types: `Diagnostic`, `DiagnosticKind`, `DiagnoseOptions`, `DebugOverlayOptions`, `Sentinel`, `Raster`, `StripReading`.

### Rendering — `render.ts`

| Function | Description |
|---|---|
| `renderCharacter(rig, pose, keyPrefix?): RenderNode[]` | Parts in draw order → render nodes (character space) |
| `frameToSVG(frame: RenderFrame): string` | Standalone SVG document |
| `nodeToString(node)` | One node as SVG markup |
| `prefixFrame(frame, prefix)` | Copy of a frame with every SVG id prefixed (to composite two frames) |

`RenderNode` kinds: `group` (`id?`, `transform?`, `opacity?`, `filter?`, `children`), `markup`
(static art, `filter?`), `path` (`d`, `attrs`). `filter` is a CSS filter value (e.g. `blur(2px)`)
applied in **screen space**: renderers wrap the node in a `<g style="filter:…">` without transform. `RenderFrame`: `width`, `height`, `background`, `defs`, `nodes`.

### Lip sync (pure) — `lipsync.ts`

| Function | Description |
|---|---|
| `cuesFromText(text, { start?, duration? })` | Text → visemes spread over a duration (English and Portuguese digraphs) |
| `cuesFromAlignment(alignment, offset?)` | TTS character timestamps (ElevenLabs `with-timestamps` shape) → cues |
| `cuesFromAmplitude(samples, sampleRate, { window?, silence?, offset? })` | Loudness-based cues from mono PCM |
| `textToUnits(text)`, `mergeCues(cues, minDuration?)` | Helpers |

### Previews — `preview.ts`

| Function | Description |
|---|---|
| `previewSceneDoc(toon, opts?)` / `previewScene(toon, opts?)` | One-character scene (looping clip, extra script) for previews, tests and thumbnails |

### Math — `math.ts`

`Vec2`, `Mat` (SVG order `[a, b, c, d, e, f]`), `identity`, `multiply`, `invert`, `fromTRS`,
`apply`, `applyLinear`, `matAngle`, `matScaleX`, `matScaleY`, `matToString`, `isIdentity`, `lerp`,
`clamp`, `wrapAngle`, `angleOf`, `add`, `sub`, `scale`, `length`, `dist`, `normalize`,
`distToSegment`, `hashString`, `seededRandom` (deterministic PRNG), `noise1` (smooth value noise),
`formatNumber`, `DEG`.

---

## `@animestudio/react`

| Export | Description |
|---|---|
| `<ToonScene scene time width? height? style? className?>` | Renders a compiled scene at `time` (seconds) as inline SVG |
| `<ToonFrame frame width? height? style? className?>` | Renders an evaluated `RenderFrame` as stacked `<svg>` layers in a positioned box (height follows the aspect ratio when omitted) |
| `splitRuns(nodes)` | How `ToonFrame` layers a frame: blurred nodes get their own layer with an HTML-level CSS blur, and nodes defining per-frame masks/filters (shading, lighting, transitions) end their layer. Chrome's frame-by-frame capture occasionally skipped painting elements that followed such content inside a single SVG |
| `<RenderNodes nodes>` / `<Node node>` | Render nodes without an `<svg>` wrapper (custom viewports, editors) |
| `useCompiledScene(doc, assets)` | Memoized `compileScene` |

## `@animestudio/remotion`

| Export | Description |
|---|---|
| `<ToonComposition scene assets resolveAudio? muted? debug?>` | Composition component: evaluates the scene at `useCurrentFrame() / fps`, plays scene audio in `<Sequence>`s, bakes rigid bodies with `delayRender`, holds each capture for a few animation frames so filtered/masked layers finish painting, and mounts a fresh SVG tree per frame while rendering (reuses it in the Studio/Player) |
| `toonMetadata(scene)` | `{ durationInFrames, fps, width, height }` for `<Composition>` / `calculateMetadata` |
| `<ToonSequenceComposition sequence scenes resolveAudio? muted? debug?>` | Multi-shot sequence with transitions; shot audio is cut at shot boundaries. `debug` renders the instrumentation strip read by `toon doctor` |
| `toonSequenceMetadata(sequence, scenes)` | Composition metadata for a sequence |
| `ToonCompositionProps`, `ToonSequenceCompositionProps` | Props types |

## `@animestudio/rigid`

| Export | Description |
|---|---|
| `prepareScene(doc, assets): Promise<CompiledScene>` | `compileScene` + rigid body bake |
| `bakeRigidBodies(scene): Promise<CompiledScene>` | Deterministic Rapier simulation of props (grabs, releases, impulses, character colliders, ground surfaces as polylines); sets `scene.rigid` |
| `sceneHasBodies(scene)` | Whether any prop has a `body` |
| `initRapier()` | Loads the WASM module once |

## `@animestudio/lipsync`

Re-exports the pure helpers from core, plus:

| Export | Description |
|---|---|
| `alignTextToAudio(text, samples, sampleRate, opts?)` | Known text distributed over the voiced segments of audio |
| `voicedSegments(samples, sampleRate, opts?)` | Voiced `[start, end]` ranges |

### `@animestudio/lipsync/node`

| Export | Description |
|---|---|
| `lipsyncFile(path, { text?, language?, engine? })` | One-stop lip sync: `rhubarb` (if installed; phonetic recognizer for non-English), `align`, `amplitude`, or `auto` |
| `rhubarb(path, { dialog?, recognizer?, language?, binary? })` | Runs Rhubarb Lip Sync |
| `findRhubarb(binary?)`, `hasRhubarb(binary?)` | Locates Rhubarb (`RHUBARB_PATH`, PATH, `~/.local/bin`) |
| `readWav(path)`, `decodeWav(bytes)`, `wavDuration(path)` | WAV decoding (8/16/24/32-bit PCM, float) |

## `@animestudio/import-svg`

| Export | Description |
|---|---|
| `importSvg(svg, { name? }): { doc, warnings }` | Layered drawing → character by naming convention (`bone:`, `part:`, `switch:`, `skin:`, `anchor:`, `origin`) |
| `parseTransform(attr)` | SVG `transform` attribute → matrix |

## `@animestudio/kit`

Building blocks for storybook cartoon characters that share one bone layout (hips, body, head,
pupils, armF1/armF2/handF, armB1/armB2/handB, legF1/legF2/footF, legB1/legB2/footB), so the
gesture clips, emotions and the director work for every character.

| Export | Description |
|---|---|
| `mouthPath(L, R, open, smile, round)`, `mouthShapes(L, R, scale?)` | Morph-compatible mouth (visemes A–H plus `smile`, `frown`, `grin`) |
| `eyeArt(spec)`, `eyeWhite`, `eyeArc`, `eyeLid`, `eyeSwitch(bone)` | Storybook eyes: open, wide, closed, happy, half-lidded, pupils |
| `browShapes(eyes, rad, lift?)` | Brow morph (up, sad, cross, smug) |
| `limbBones(o)`, `limbIk` | Arm and leg chains with flat feet; hand IK off by default (hand-holding) |
| `gait(g)`, `characterClips(o)` | Walk/run cycles and the shared gesture clips (idle, talk, wave, point, present, clap, cheer, dance, sing, think, shrug, laugh, cry, scared, jump, dribble, toss, teeter, pointUp, flap, hold, ride: torso leaning into the ride, head up) |
| `emotions(extra?)`, `blinkAndBreathe(period?)` | Emotion pose control (neutral, happy, joy, surprised, sad, smug, scared, angry) and behaviours |
| `withViews(doc, spec)`, `ViewSpec`, `STILL_MIX` | Front / back views on the same skeleton (`view` control, hidden `view` switch, far arm redrawn from behind); bones in `still` (default the head) keep only `STILL_MIX` of their rotation in those views; records the view moves in `meta.views` |
| `walkInPlace(dur, lift, bob, stride)` | `walkDepth` clip: walking towards/away from the camera with foreshortened legs |
| `rigInfo(doc, { extent, height })`, `RigInfo` | Measurements read from the skeleton for the director (hands, shoulders, arm lengths, `hip` joint, `legLength`) |
| `withProportions(doc, { head, torso, legs, arms })`, `proportionMeasure(measure, p, hipHeight)` | Build-time body proportions (e.g. a grown-up from a child template: smaller head, longer torso, legs and arms): remaps bones, setup-space art, morph paths, anchors and pose offsets; parts in bone space keep their size |

## `@animestudio/director`

See [DIRECTOR.md](DIRECTOR.md).

| Export | Description |
|---|---|
| `direct(staging, lines, kit)` | `{ sequence, scenes, overlays, issues }`: one continuous scene per block, cuts/replays, texts |
| `check(staging, lines, kit)` | Issues from directing, the continuity checklist and scene/sequence validation |
| `describeKit(kit)` | Catalogue of cast (clips, emotions, views, wardrobe `wear: { control: [poses] }`), sets (marks, depth, fixture values, `seats`), props, vehicles, `rides` (rideable vehicles and their wardrobe), `furniture` (sit / lie), fx, cameras, actions, light moods |
| `lineCues(line)` | Mouth cues from a line's word timings |
| `Timeline` | Line/word → seconds |
| `closest(word, options)` | "did you mean" helper used in messages |
| `wardrobeOf(doc)` | Wardrobe controls of a rig and their poses: the pose controls in `meta.wardrobe`, or every pose control except `view` / `emotion` |
| `ACTIONS`, `CAMERAS`, `MOODS` | Vocabulary |
| Types | `Staging`, `Block`, `Beat`, `CastEntry`, `PropEntry`, `VehicleEntry`, `FurnitureEntry`, `Cut`, `Text`, `When`, `Place`, `Line`, `Kit`, `SetDef`, `CastMember`, `Overlay`, `Issue`, `Directed` |

## `@animestudio/cli` (`toon`)

Commands: `validate`, `describe`, `schema`, `lipsync`, `import-svg`, `render`, `debug`
(library-side diagnostics over a frame range) and `doctor` (analyzes a rendered video: flickers,
whether the library output was stable at those frames, and — for `debug` renders — exactly which
nodes the browser did not paint; transparent or strongly blurred nodes are counted as
`strip.unverifiable` instead) — see the README. Library exports also include
`debugDocument(path, from?, to?)`, `doctor(video, docPath)` and `loadEvaluable(path)`.
Library exports: `describeCharacter(doc)` (AI-friendly summary of a character's animatable
surface), `loadSceneAssets(scenePath, scene)`, `readJson(path)`.
