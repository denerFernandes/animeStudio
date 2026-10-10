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
| Scene | `ActorSchema`, `PropSchema`, `CordSchema` (a prop's cord or string), `BodySchema`, `LayerSchema`, `ActionSchema`, `LightingSchema`, `LightSchema`, `SurfaceSchema` (`SurfaceDef`) |
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

### 2.5D rigs — `pose3d.ts`

| Function | Description |
|---|---|
| `compileRig3d(rig, def)`, `CompiledRig3d` | Compiles a document's `rig3d` (done by `compileRig`) |
| `applyRig3d(rig, r3, state, world, ikTargets)`, `Rig3dFrame` | Run by `evaluatePose` for a rig with `rig3d`: poses the listed bones in 3D (a 2D `rotation` = about the body's sideways axis, plus `turn` and `spread`), solves leg IK in the side plane, projects for the current view's yaw and the rig's pitch and writes the matching 2D offsets, rotations and squash |
| `rig3dDrawOrder(rig, r3, frame)` | The frame's draw order: limbs nearer than the body before the `front` part (in the chains' order), farther ones after the `back` part (farthest first); `EvaluatedPose.drawOrder` |
| `viewPoint(p, yaw, pitch)`, `V3` | Body space → view space (screen x, y, depth) |
| `rig3d.keepOut` (FORMAT) | Ellipsoids on bones a hand reached by `reach3d` never goes into: a target inside is moved out to their surface (the torso, the head of `cartoonCharacter`) |
| `rig3dPoint(doc, values, name)` | Where a named point of `rig3d.points` (the mouth, the chest) is in a pose (body space) |
| `rig3dPose(doc, values)`, `Rig3dValues` | Forward kinematics of a document's `rig3d` for channel values (`{ bone: { rotation?, turn?, spread? } }`, degrees): each 3D bone's joint, tip and rotation in body space (the hips at rest) — where a pose puts the knees, the hands… |
| `reach3d(doc, upper, lower, target, values, pole, near?)` | Two-bone reach in 3D (`near`: the pose before — the solution nearest it, never an equivalent turn of the shoulder far from it): the channel values (`upper`: `rotation`, `spread`; `lower`: `rotation`, `turn`) putting the limb's tip on a body-space `target`, the middle joint bent towards `pole`, the rest of the pose in `values`. The director rests hands on knees, in the lap, around the shins with it |
| `EvaluatedPose.frame3d` | The frame's projection (`Rig3dFrame`: posed 3D bones `pos` / `rot`, `yaw`, `pitch`, screen `off`): solids are drawn from it |

### Solids — `solid.ts`, `field.ts`

| Function | Description |
|---|---|
| `drawSolid(bodies, step, r3, frame)`, `SolidBody`, `SolidShape`, `SolidPoint`, `SolidPath` | The paths of a `solid` part for a frame (run by `renderCharacter`): its bodies' shapes posed on the 3D bones, ray cast on a screen grid, composited per cell by depth (the nearest wins; a body without a fill is an occluder), each drawn as a fill, a cel shadow (light from the upper left) and an outline. Cached by pose: a held pose is drawn once |
| `solidBounds(bodies, r3, frame)` | Screen box of a solid this frame |
| `occluderDepthAt(bodies, r3, frame, x, y)` | Depth of the nearest occluder surface of a solid at a point of the picture (−Infinity: none): whether something there is hidden by the body (a `rig3d` chain's `behind` uses it for hands) |
| `SolidPartSchema`, `SolidShapeSchema` | Schemas of a `solid` part and of its shapes (see FORMAT) |
| `fieldStroke(val, grid, keep)` | Open outline pieces of a field, kept only where `keep(x, y)` holds (a line left out where a shape meets another drawing) |
| `contours(val, w, h)`, `fieldPath(val, grid, minArea?)`, `smoothPath(points)`, `Grid`, `P2` | Outlines of a field sampled on a grid (negative inside): marching squares, smoothed closed curves (also re-exported by the kit's volumes) |

### Physics — `physics.ts`

| Function | Description |
|---|---|
| `grab` with `fit`, `reach` to `{ prop, point }` | Props fitted to the body by contact points, held by their grip (see FORMAT) |
| `anchorTurn(scene, actor, anchor, t)` | How much a prop held at an anchor turns (degrees): the bone's rotation from rest × the anchor's `turn` |
| `bakePhysics(rig, { duration, rate?, poseAt, placementAt }): PhysicsBake` | Fixed-step (default 120 Hz) simulation of springs and jiggles in scene space; returns per-step bone deltas. Restarts at rest when the placement flips |
| `HullPartSchema` | Schema of a `hull` part (see FORMAT) |
| `samplePhysics(bake, t)` | Interpolated sample at time t (never interpolates across a restart, e.g. at a flip) |

A spring on bones of an IK chain gives way while the chain is placed by IK (holding a hand,
reaching): its mix is multiplied by `1 − ik mix`.

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
| `evaluateSequence(seq, t): RenderFrame` | Frame at global time t: crossfades composite two shots (ids prefixed), through-color transitions overlay the cut; a shot's `speed` (negative: backwards) and `overlay` apply |
| `vhsOverlay(t, width, height)` | A tape rewinding drawn over a frame (scanlines, a rolling tracking band with colour fringes, noise, ◀◀ REW), deterministic by time — the `overlay: "vhs"` of a shot |
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
| `FX_TYPES` | `surprise`, `exclaim`, `question`, `sweat`, `sparkle`, `dust`, `hearts`, `zzz`, `anger`, `impact`, `gloom`, `notes`, `stars`, `lightbulb`, `birds`, and the anime effects `focusLines`, `speedLines`, `impactFrame`, `burst`, `aura`, `ghost`, `caption` (type `FxType`) |
| `SCREEN_FX`, `BEHIND_FX` | Effects drawn in screen space (fixed to the frame) / just behind their actor |
| `CAPTION_STYLES` | `caption` looks: `title`, `impact`, `ko`, `place` |
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
| `<ToonComposition scene assets resolveAudio? muted? debug? paintSettle?>` | Composition component: evaluates the scene at `useCurrentFrame() / fps`, plays scene audio in `<Sequence>`s, bakes rigid bodies with `delayRender`, holds each capture for a few animation frames so filtered/masked layers finish painting (`paintSettle: { frames: 4, ms: 60 }`; heavy SVG rendered with high concurrency may need more — the director warns about heavy graphics: rasterize them), and mounts a fresh SVG tree per frame while rendering (reuses it in the Studio/Player) |
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
| `mouthPath(L, R, open, smile, round, style?)`, `mouthShapes(L, R, scale?, style?)`, `MouthStyle` | Morph-compatible mouth (visemes A–H plus `smile`, `frown`, `grin`); `style.symmetric` lifts both corners alike (a face seen from the front; by default the far corner lifts more, a profile), `style.lift` scales how high they go (small mouths) |
| `eyeArt(spec)`, `eyeWhite`, `eyeArc`, `eyeLid`, `eyeSwitch(bone)` | Storybook eyes: open, wide, closed, happy, half-lidded, pupils |
| `browShapes(eyes, rad, lift?)` | Brow morph (up, sad, cross, smug) |
| `limbBones(o)`, `limbIk` | Arm and leg chains with flat feet; hand IK off by default (hand-holding) |
| `humanCharacter(look)`, `HumanLook`, `HumanHair`, `HumanOutfit` | A complete human character from a short description — `name`, `skin`, `hair` (`spiky`, `mane`, `messy`, `ponytail`, `cap`, `short`, `curly`, `hood`), `hairColor`, `hairTip?`, `iris`, `outfit` (`tee`, `hoodie`, `gi`, `coat`, `armor`), `top`, `topDark?`, `pants`, `shoes`, `accent?`, `glasses?`, `glow?` (glowing villain eyes), `headband?`, `scarf?`, `cape?`, `bulk?`: anime-style, with a generated front view, switch hands, every kit clip, emotions (plus `dead`, `determined`, `calm`, `excited`), `face` anchor, flowing hair/cape physics |
| `cartoonCharacter(look, { pitch? })`, `cartoonInfo(doc, look, opts?)`, `CartoonOptions`, `CartoonLook`, `CartoonBuild`, `CartoonHair`, `CartoonHat`, `CartoonTop`, `CartoonBottom`, `CartoonShoes`, `CartoonPattern` | A TV-cartoon human (long thin limbs, big sneakers, oval eyes with small pupils, thick filled brows, a nose with volume) from a description: `build` (`child`, `kid`, `teen`, `woman`, `man`, `big`, `elder`), `heavy?`, `tall?`, `female?`, `skin`, `hair` (`bowl`, `sidePart`, `afro`, `puffs`, `ponytail`, `long`, `perm`, `mullet`, `buzz`, `bald`, `bun`, `braids`, `rollers`, `tuft`, `receding`, `slick`, `bob`, `curtains`, `spiky`), `hairColor`, `jaw?`, `nose?`, `top` (`tee`, `stripes`, `polo`, `shirt`, `tank`, `jersey`, `blouse`, `dress`, `overalls`, `jacket`, `cardigan`, `blazer`), `topColor`, `top2?`, `pattern?` (`stripes`, `pinstripes`, `checks`), `bottom` (`pants`, `shorts`, `bermuda`, `skirt`, `longSkirt`), `shoes`, accessories (`hat`, `glasses` / `"sun"`, `tie`, `sweater` over the shoulders, `necklace`, `suspenders`, `watch`, `apron`, `pocketItem`, `earItem`, `earrings`) and face details (`moustache`, `goatee`, `freckles`, `wrinkles`, `stubble`, `flushed`, `lipstick`). A 2.5D rig (`rig3d`): heads, hair and torsos are volumes drawn at twelve angles — `front`, `half`, `q24`, `profile` (three-quarter, the main view), `q50`, `q64`, `q77`, `side`, `q112`, `away`, `q158`, `back` — seen from `pitch` (degrees: the room camera's), the limbs posed in 3D and projected for the view (a sitting pose reads from any side), the legs, hips, skirt and shoes as a `solid` part (`legs`: thighs and shins as cones with round knees, shorts and socks over them, a seat between the hip joints, a skirt hugging both thighs to just above the knees (`longSkirt`: down the shins), shoes as volumes on 3D feet — an upper on a sole, heels, flip-flops and sandals with straps; the torso an occluder — drawn over the torso only where nearer: a lap facing the camera, legs hidden behind a body turned away; cel shaded from every angle and pose), gestures in 3D (phone, smoke, drink, think, facepalm, cry, wave, scared, clap, cheer, pointUp, shrug, point, present, talk, sing, read, laugh: the arm tracks are 3D reaches to body points — the ear, the mouth, the eyes, above the head, in front of the chest — for the rig's own proportions, never a 2D swing going round the front), a head turned on its own carrying the points props fit to (ear, mouth, eye, top: the `head` control sets them), teeth and tongue clipped by the mouth, a narrower mouth (`face.mouthW` 0.28) clear of the nose in every expression and viseme and every combination of them, a dress or skirt carrying on from the torso with no seam (`seamless`), heads and faces drawn nearly level (30% of `pitch`: seen from above, the nose would come down over the mouth) and put back on the neck, the nose drawn over the mouth (seen from three-quarters it hides the far corner), stubble on the chin, jaw and upper lip only, a head that turns on its own (`head` control: any drawn angle or a mirrored one, `~q50` looks the other way; `null` follows the body's `view`), sleeves and a watch as hulls wrapping the limb; with cel shading and coloured lines; follow-through springs on the forearms and head, a ponytail on a spring, bouncing big hair; gestures through `fluid`. `cartoonInfo` measures it for the director |
| Wardrobe and builds (`cartoonCharacter`) | `build: "baby"` (a big head on a small round body); `hat`: `top`, `bowler`, `cowboy` besides the caps; `veil` (a bridal veil from the top of the head down the back), `boutonniere` (a flower in the lapel), `cape` (from the shoulders down the back to the knees), `pattern: "polka"`; short hex colours (`#333`) work. Gestures `gamepad` (a controller in both hands, thumbs busy), `cue` (leaning over a pool table, the far hand stroking), `groove` (dancing: hips swaying with a bounce, hands up in turn) |
| `cartoonAnatomy(look)`, `checkAnatomy(anatomy)`, `CartoonAnatomy`, `AnatomyIssue` | A character's anatomy as one document: `body` (hip height, torso, neck, head radius; shoulders, waist, hips, depth), `limbs` (arm and leg diameters, hand, shoe, `calf`: the swell at the back of the shin), `face` (in head radii from the head's centre: eye height, spacing and size, pupil, brow gap, nose height, size and how far it stands out, mouth height and half width, `mouthMargin`, ear height, chin), `physics` ([stiffness, damping] of the body, forearms, head, ponytail, big hair). `cartoonAnatomy` derives it from a look; `cartoonCharacter(look, { anatomy })` builds from an edited one and keeps it in `meta.anatomy`; `cartoonInfo` reads it back. `checkAnatomy` lists broken rules (`error` / `warning`, with the rule's id): the mouth below the nose with room for a smile (`mouth-nose`), a chin under the mouth (`chin`), the nose below the eyes, eyes apart and inside the face, mouth width, pupil inside the eye, legs inside the hips, hands that reach the lap seated (`reach`), physics in range; `cartoonCharacter` refuses an anatomy with errors. Every drawn angle is checked too: each mouth shape (expressions and the visemes of speech) stays on the face and clear of the nose as drawn — the corner on the nose's side shortened, the smile flattened, the mouth opened less or lowered until it does; what still breaks is listed in `meta.anatomyIssues` (`mouth-nose-view`), with the anatomy's warnings. A far eye turned well away is left out (no sliver on the face's edge); the nose is drawn over the mouth and over hair at the sides of the face |
| Sitting (`cartoonCharacter`) | Posed in 3D by the director's `sit` (thighs forward, shins down, hands on the knees or in the lap, crossed legs), drawn from whatever angle the seat is turned to. `limbs` (`thin` default, `normal`, `thick`) sets arm and leg thickness; the hand anchors have `turn: 1` (held props turn with the hand); anchors `ear`, `mouth`, `eye`, `top` move with each drawn angle (props fit to them); asymmetric details (a breast pocket and what is in it, something behind an ear, a side part, a shaved line, a wristwatch) stay on the same side of the body facing left: a `side` control (`right` / `left`) swaps in their mirrored drawings, set by the scene from the actor's facing |
| `fluid(clips, { anticipation?, overshoot?, min? })` | Hand-drawn timing for gesture clips: a small move the other way before every big rotation (anticipation) and past the pose before settling (overshoot); loops and `turn` untouched |
| `mouthInside(L, R, scale?)` | Teeth and tongue morphs with the same shape names as `mouthShapes` (they morph together, hidden when the mouth is closed) |
| `cartoonHands(at, { r, fill, line?, stroke?, dir?, shade? })` | Hands with four fingers and a thumb, as `open` / `fist` / `point` / `grip` variants (same names as `handShapes`) |
| `RoomCamera`, `roomPoint(cam, x, z, h?)`, `floorDepth(cam, y)`, `viewAt(cam, x, z, turn?)` | A room seen by one camera (2.5D, one-point perspective): `{ horizon, vpx, y0, dist }` — the horizon, the vanishing point, the floor line where 1 world unit = 1 px, the camera distance. World x right, z into the room, h up; `roomPoint` gives the screen point and scale, `viewAt` the yaw and pitch the camera sees something at (its own `turn` in degrees plus being off-axis) |
| `floorLines(cam, o)`, `floorEllipse(cam, x, z, rx, rz, attrs)`, `floorPolygon(cam, pts)` | Floors in perspective (screen-space SVG): boards or tiles converging on the vanishing point, a rug |
| `sofaModel(o)`, `crtTvModel(o?)`, `tableModel(o?)`, `FurnitureModel`, `drawModel(model, view)` | Furniture modelled as volumes (a sofa or armchair with cushions, arms and doilies; a CRT TV with its bulge and antenna; a table or stand), drawn like the cartoon characters (cel shading, coloured lines), parts composited per pixel by depth |
| `furnitureRig(model, cam, { x, z, turn? }, name?)` | A piece of furniture placed in a room: its rig drawn from the camera's angle (anchors `seat`, `seat2`… on the projected seats, `top`, `screen`…; `meta.seat.yaw`), and its mark `{ x, y }` and `scale` for the set (`kit.furniture`) |
| `sphere`, `ellipsoid`, `capsule`, `box`, `taper`, `union`, `blend`, `intersect`, `subtract`, `grow`, `above`, `below`, `bumpy` | Volumes (signed distance functions; model space = the front view: x right, y down, z towards the camera) |
| `View` (`{ yaw, pitch }`), `toCam`, `fromCam`, `gridFor(boxes, view, step)`, `cast(sdf, grid, view)`, `contours`, `fieldPath`, `smoothPath`, `project`, `depthOf`, `surfaceZ`, `normal(sdf, p, e?)`, `onSurface(sdf, theta)` | Drawing a volume turned by a yaw around the vertical axis and seen from a pitch above (a number is a yaw): ray marching on a grid (silhouette field, depth, hit points), marching-squares outlines smoothed into curves, points drawn on a surface projected to the view (`visible` when facing the camera) |
| `handShapes(at, { r, fill, ink?, stroke?, dir? })` | Hand variants `open`, `fist`, `point`, `grip` drawn around the wrist, fingers along the forearm (`dir`, default 90 = down): use them as a `handF` / `handB` switch part and pass `hands: true` to `characterClips` |
| `gait(g)`, `characterClips(o)` | Walk/run cycles and the shared gesture clips (idle, talk, wave, point, present, clap, cheer, dance, sing, drink (the near hand to the mouth, the wrist tips the bottle, the head tips back), smoke (the hand to the mouth for a puff and back), phone (looped: the phone at the ear, along the jaw), think, shrug, laugh, cry, scared, jump, dribble, toss, teeter, pointUp, flap, hold, ride: torso leaning into the ride, head up, the fighting set stance, power, punch, knocked, and `turn`, a quick squeeze that hides a change of view); with `hands: true` the gestures shape switch hands (point, fist, open, grip) |
| `emotions(extra?)`, `blinkAndBreathe(period?)` | Emotion pose control (neutral, sleep, happy, joy, surprised, sad, smug, scared, angry) and behaviours |
| `withViews(doc, spec)`, `ViewSpec`, `STILL_MIX` | Views on the same skeleton (`view` control, hidden `view` switch, far arm redrawn from behind): `front`, `back` or any in-between angle a rig draws; bones in `still` (default the head, in front and back) keep only `STILL_MIX` of their rotation; records the view moves (and `order`, the views in turning order, for in-between turns) in `meta.views` |
| `humanClips()` | The extra clips of the human characters (stance, power, punch, knocked, read, facepalm, roll) |
| `walkInPlace(dur, lift, bob, stride)` | `walkDepth` clip: walking towards/away from the camera with foreshortened legs |
| `rigInfo(doc, { extent, height })`, `RigInfo` | Measurements read from the skeleton for the director (hands, shoulders, arm lengths, `hip` joint, `legLength`, optional `depth`: half torso thickness for lying) |
| `withProportions(doc, { head, torso, legs, arms })`, `proportionMeasure(measure, p, hipHeight)` | Build-time body proportions (e.g. a grown-up from a child template: smaller head, longer torso, legs and arms): remaps bones, setup-space art, morph and skinned paths (hair locks, capes), anchors and pose offsets; parts in bone space keep their size |

## `@animestudio/director`

See [DIRECTOR.md](DIRECTOR.md).

| Export | Description |
|---|---|
| `direct(staging, lines, kit)` | `{ sequence, scenes, overlays, issues }`: one continuous scene per block, cuts/replays, texts |
| `photoMarkup(frame, style, id)`, `sideMarkup(side, page, left, photos, id)`, `luminance(hex)`, `HANDWRITING`, `Album`, `AlbumPhoto`, `AlbumSide`, `PhotoStyle`, `PhotoFrame`, `PhotoLook` | A frozen frame as a photo on paper (cropped, aged — colours towards sepia, a warm yellow, a vignette, or a flash — on a print with photo corners or a Polaroid, a handwritten caption kept within the picture's width) and an album page side with its photos, clipped to the page; `luminance` (0…1) picks an ink that shows on a paper; the director's `album` uses them |
| `check(staging, lines, kit, { strict? })`, `CheckOptions` | Issues from directing, the continuity checklist and scene/sequence validation, and the picture and motion checks sampled over every block (`strict`: every frame — run it before a render): someone appearing inside the frame, walking backwards (not when carried: lifted onto or set down from someone) or with the head turned, a speaker standing still for more than 2 s, a limb going round (faster than ~2500°/s), a held object jumping in the hands, a hand over the face outside a face gesture, someone standing across the set's edge, a face covered by scenery |
| `describeKit(kit)` | Catalogue of cast (clips, emotions, views, `canFly`, wardrobe `wear: { control: [poses] }`), sets (marks, depth, fixture values, `seats`, set `furniture`), props, vehicles, `rides` (rideable vehicles and their wardrobe), `furniture` (sit / lie), fx, cameras, actions, light moods |
| `lineCues(line)` | Mouth cues from a line's word timings |
| `Timeline` | Line/word → seconds |
| `closest(word, options)` | "did you mean" helper used in messages |
| `wardrobeOf(doc)` | Wardrobe controls of a rig and their poses: the pose controls in `meta.wardrobe`, or every pose control except `view` / `emotion` |
| `ACTIONS`, `CAMERAS`, `MOODS` | Vocabulary |
| `volumeAt(keys, t)` | Volume of a music envelope (`Directed.music[i].volume`) at a time |
| `FRONT_GESTURES` | Gestures played as hand positions on the face in the front view (`facepalm`, `despair`, `think`, `cover`, `excited`, `shout`) |
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
