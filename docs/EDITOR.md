# animeStudio Editor

A browser-based visual editor for `toon` characters: rigging (bones, parts, IK, physics) and
animation (clips on a keyframe timeline). It edits the same `*.toon.json` documents the engine
renders, so anything made here works in scenes, Remotion and AI pipelines unchanged.

Run it with `pnpm --dir apps/editor dev`.

## Layout

```
┌────────────┬──────────────────────────────────────────┬─────────────┐
│ Outliner   │ Viewport (pan / zoom, skeleton, handles) │ Inspector   │
│  bones     │                                          │  selection  │
│  parts     │                                          │  properties │
│            ├──────────────────────────────────────────┤             │
│            │ Timeline (clip, tracks, keys, playhead)  │             │
└────────────┴──────────────────────────────────────────┴─────────────┘
```

## Modes

| Mode | What dragging does | Notes |
|---|---|---|
| **Rig** | Drag a joint to move the bone's `from`, drag a tip to move its `to` (setup space) | Art stays in setup space (bind pose) |
| **Animate** | Drag a bone to rotate it, drag an IK handle to move its target — keys are written at the playhead in the current clip (auto-key) | Onion skin shows the pose before/after |

## Features

- **Documents**: new, open (file picker or drag & drop), save (download), autosave to the browser,
  undo / redo (Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z), live validation with the engine's messages.
- **Outliner**: bone hierarchy (select, add child, delete), parts in draw order (select,
  reorder).
- **Inspector**:
  - bone: id (rename updates every reference), parent, from/to, mass, rotation limits,
    inheritance;
  - part: bone, z, opacity, art markup, hose widths, style;
  - key: time, value, easing;
  - clip: name, duration, loop, stride;
  - JSON sections (palette, art, IK, physics, controls, behaviors, anchors, colliders) with
    validation before applying.
- **Timeline**: clip selector, new / duplicate / delete clip, tracks per channel, add a track for
  any channel, keyframe diamonds (click to select, drag to retime, Delete to remove, double-click
  a row to add a key), playhead scrubbing, play / pause / loop, speed.
- **Viewport**: pan (drag the background), zoom (wheel), skeleton overlay, click art to
  select its part, onion skin, ground line and origin.

## Shortcuts

| Key | Action |
|---|---|
| `1` / `2` | Rig / Animate mode |
| `Space` | Play / pause |
| `←` / `→` | Step one frame (1/60 s) |
| `K` | Key the selected bone's rotation at the playhead |
| `Delete` | Delete the selected keyframe |
| `F` | Fit the character in the viewport |
| `Ctrl/Cmd+Z`, `Shift+Ctrl/Cmd+Z` | Undo / redo |
| `Ctrl/Cmd+S` | Save (download) |

Editing a key on the loop seam (t = 0 or t = duration) of a looping clip also updates the key at
the other end, so cycles stay seamless. Keys snap to 1/60 s.

## Architecture

| File | Responsibility |
|---|---|
| `src/doc.ts` | Pure document operations (setup-form conversion, keys, tracks, bones, parts, rename) — unit tested |
| `src/store.ts` | Editor state, reducer, undo / redo history, autosave |
| `src/Viewport.tsx` | Rendering (via `@animestudio/react` render nodes), hit-testing, drag interactions |
| `src/Timeline.tsx` | Tracks and keys |
| `src/Outliner.tsx`, `src/Inspector.tsx` | Panels |

The editor never keeps a separate model: the `ToonDoc` is the single source of truth, compiled
with `compileRig` on every change; previews use the same scene pipeline as rendering (including
baked physics), so what you see is what Remotion renders.

## Next steps

- Mesh weight painting for `skinned` parts.
- Pose library and copy / paste poses.
- Curve editor for custom easing.
- Scene editing (actors, props, script) on a scene timeline.
