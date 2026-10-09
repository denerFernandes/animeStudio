import { type Rig, type Value, defaultChannelValue, resolveChannel } from "@animestudio/core";
import { type Dispatch, type PointerEvent, useLayoutEffect, useRef, useState } from "react";
import { addClip, addTrack, allChannels, clipValue, deleteClip, moveKey, removeTrack, renameClip, setKey, trackKeys, updateClip } from "./doc";
import type { Action, EditorState } from "./store";

const LABEL = 210;

function initialValue(rig: Rig, channel: string): Value {
  const ref = resolveChannel(rig, channel);
  if (ref.kind === "control") {
    const c = rig.controls[ref.name];
    if (c.type === "pose") return Object.keys(c.poses)[0] ?? null;
    if (c.type === "viseme") return "X";
    return null;
  }
  return defaultChannelValue(rig, ref) ?? 0;
}

const fmtValue = (v: Value | undefined) =>
  typeof v === "number" ? v.toFixed(1) : Array.isArray(v) ? `${v[0].toFixed(0)}, ${v[1].toFixed(0)}` : v === null || v === undefined ? "—" : typeof v === "object" ? "blend" : String(v);

export function Timeline({ state, dispatch, rig }: { state: EditorState; dispatch: Dispatch<Action>; rig: Rig | null }) {
  const { doc, clip } = state;
  const clipDef = clip ? doc.clips?.[clip] : undefined;
  const lanesRef = useRef<HTMLDivElement>(null);
  const [laneWidth, setLaneWidth] = useState(600);
  const [renaming, setRenaming] = useState<string | null>(null);
  const keyDrag = useRef<{ channel: string; index: number; gesture: string } | null>(null);

  useLayoutEffect(() => {
    const el = lanesRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setLaneWidth(Math.max(100, e.contentRect.width - LABEL - 16)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const duration = clipDef?.duration ?? 1;
  const xOf = (t: number) => (t / duration) * laneWidth;
  const tOf = (clientX: number) => {
    const rect = lanesRef.current!.getBoundingClientRect();
    const t = ((clientX - rect.left - LABEL) / laneWidth) * duration;
    return Math.max(0, Math.min(duration, Math.round(t * 60) / 60)); // snap to 1/60 s
  };

  const tracks = clipDef ? Object.keys(clipDef.tracks).sort() : [];
  const available = rig ? allChannels(rig).filter((c) => !tracks.includes(c)) : [];

  // Scrubbing ------------------------------------------------------------------------
  const scrub = (e: PointerEvent) => {
    dispatch({ type: "playing", playing: false });
    dispatch({ type: "time", time: tOf(e.clientX) });
  };

  const onKeyDown = (e: PointerEvent, channel: string, index: number) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dispatch({ type: "select", selection: { kind: "key", channel, index } });
    keyDrag.current = { channel, index, gesture: `key-${Date.now()}` };
  };

  const onKeyMove = (e: PointerEvent) => {
    const d = keyDrag.current;
    if (!d || !clip) return;
    const t = tOf(e.clientX);
    const keys = trackKeys(doc, clip, d.channel);
    if (!keys[d.index] || Math.abs(keys[d.index][0] - t) < 1e-6) return;
    const moved = moveKey(doc, clip, d.channel, d.index, t);
    keyDrag.current = { ...d, index: moved.index };
    dispatch({ type: "edit", doc: moved.doc, gesture: d.gesture, select: { kind: "key", channel: d.channel, index: moved.index } });
  };

  const onKeyUp = () => {
    if (keyDrag.current) dispatch({ type: "endGesture" });
    keyDrag.current = null;
  };

  const addKeyAt = (channel: string, clientX: number) => {
    if (!clip || !rig) return;
    const t = tOf(clientX);
    const v = clipValue(doc, clip, channel, t) ?? initialValue(rig, channel);
    const next = setKey(doc, clip, channel, t, v);
    dispatch({ type: "edit", doc: next, select: { kind: "key", channel, index: trackKeys(next, clip, channel).findIndex((k) => Math.abs(k[0] - t) < 1e-4) } });
  };

  // Header actions -------------------------------------------------------------------------
  const newClip = (from?: string) => {
    const { doc: next, name } = addClip(doc, from ? from : "clip", from);
    dispatch({ type: "edit", doc: next });
    dispatch({ type: "clip", clip: name });
  };

  const ticks = Array.from({ length: Math.floor(duration * 10) + 1 }, (_, i) => i / 10);

  return (
    <div className="timeline">
      <div className="timeline-header">
        <select value={clip ?? ""} onChange={(e) => dispatch({ type: "clip", clip: e.target.value || null })}>
          {Object.keys(doc.clips ?? {}).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          {!clip ? <option value="">(no clips)</option> : null}
        </select>
        <button onClick={() => newClip()} title="New clip">
          + Clip
        </button>
        {clip ? (
          <>
            <button onClick={() => newClip(clip)} title="Duplicate clip">
              Duplicate
            </button>
            {renaming !== null ? (
              <input
                autoFocus
                value={renaming}
                onChange={(e) => setRenaming(e.target.value)}
                onBlur={() => {
                  const next = renameClip(doc, clip, renaming.trim());
                  if (next !== doc) {
                    dispatch({ type: "edit", doc: next });
                    dispatch({ type: "clip", clip: renaming.trim() });
                  }
                  setRenaming(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                style={{ width: 90 }}
              />
            ) : (
              <button onClick={() => setRenaming(clip)}>Rename</button>
            )}
            <button
              onClick={() => {
                if (confirm(`Delete clip "${clip}"?`)) dispatch({ type: "edit", doc: deleteClip(doc, clip) });
              }}
            >
              Delete
            </button>
            <label>
              Duration
              <input
                type="number"
                step={0.05}
                min={0.05}
                value={duration}
                onChange={(e) => Number(e.target.value) > 0 && dispatch({ type: "edit", doc: updateClip(doc, clip, { duration: Number(e.target.value) }), gesture: "clip-duration" })}
                style={{ width: 64 }}
              />
            </label>
            <label>
              <input type="checkbox" checked={clipDef?.loop ?? false} onChange={(e) => dispatch({ type: "edit", doc: updateClip(doc, clip, { loop: e.target.checked }) })} /> Loop
            </label>
            <span className="spacer" />
            <button className="primary" onClick={() => dispatch({ type: "playing", playing: !state.playing })}>
              {state.playing ? "❚❚ Pause" : "▶ Play"}
            </button>
            <span className="time">
              {state.time.toFixed(2)}s / {duration.toFixed(2)}s
            </span>
            <select value={state.speed} onChange={(e) => dispatch({ type: "speed", speed: Number(e.target.value) })}>
              <option value={0.1}>0.1×</option>
              <option value={0.25}>0.25×</option>
              <option value={0.5}>0.5×</option>
              <option value={1}>1×</option>
            </select>
            <label>
              <input type="checkbox" checked={state.onion} onChange={() => dispatch({ type: "toggle", key: "onion" })} /> Onion skin
            </label>
          </>
        ) : null}
      </div>

      {clip && clipDef ? (
        <div className="timeline-body" ref={lanesRef} onPointerMove={onKeyMove} onPointerUp={onKeyUp}>
          <div className="ruler" style={{ paddingLeft: LABEL }} onPointerDown={(e) => (e.currentTarget.setPointerCapture(e.pointerId), scrub(e))} onPointerMove={(e) => e.buttons === 1 && scrub(e)}>
            <div className="ruler-lane" style={{ width: laneWidth }}>
              {ticks.map((t) => (
                <span key={t} className={Math.abs(t - Math.round(t)) < 1e-6 ? "tick major" : "tick"} style={{ left: xOf(t) }}>
                  {Math.abs(t * 2 - Math.round(t * 2)) < 1e-6 ? t.toFixed(1) : ""}
                </span>
              ))}
            </div>
          </div>
          <div className="rows">
            {tracks.map((channel) => {
              const keys = trackKeys(doc, clip, channel);
              const current = clipValue(doc, clip, channel, state.time);
              return (
                <div key={channel} className="row">
                  <div className="row-label" style={{ width: LABEL }} title={channel}>
                    <span className="channel">{channel}</span>
                    <span className="value">{fmtValue(current)}</span>
                    <button className="icon" title="Remove track" onClick={() => dispatch({ type: "edit", doc: removeTrack(doc, clip, channel) })}>
                      ×
                    </button>
                  </div>
                  <div className="lane" style={{ width: laneWidth }} onDoubleClick={(e) => addKeyAt(channel, e.clientX)}>
                    {keys.map((k, i) => {
                      const sel = state.selection.kind === "key" && state.selection.channel === channel && state.selection.index === i;
                      return (
                        <div
                          key={i}
                          className={sel ? "key selected" : "key"}
                          style={{ left: xOf(k[0]) }}
                          title={`${k[0].toFixed(3)}s → ${fmtValue(k[1])}${k[2] ? ` (${typeof k[2] === "string" ? k[2] : "bezier"})` : ""}`}
                          onPointerDown={(e) => onKeyDown(e, channel, i)}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
            <div className="row add-row">
              <div className="row-label" style={{ width: LABEL }}>
                <select
                  value=""
                  onChange={(e) => {
                    if (!rig || !e.target.value) return;
                    dispatch({ type: "edit", doc: addTrack(doc, clip, e.target.value, initialValue(rig, e.target.value)) });
                  }}
                >
                  <option value="">+ Add track…</option>
                  {available.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="lane hint-lane" style={{ width: laneWidth }}>
                Double-click a lane to add a key · drag keys to retime · Delete removes the selected key
              </div>
            </div>
          </div>
          <div className="playhead" style={{ left: LABEL + xOf(state.time) }} />
        </div>
      ) : (
        <div className="empty">Create a clip to start animating.</div>
      )}
    </div>
  );
}
