import { type ToonDoc, validateToon } from "@animestudio/core";
import { type DragEvent, useEffect, useReducer, useRef } from "react";
import pipJson from "../../../examples/characters/pip.toon.json";
import { blankToon, clipValue, removeKey, setKeySeamless as setKey } from "./doc";
import { Inspector } from "./Inspector";
import { Outliner } from "./Outliner";
import { usePreview } from "./preview";
import { initialState, loadAutosave, reducer, saveAutosave } from "./store";
import { Timeline } from "./Timeline";
import { Viewport } from "./Viewport";

const pip = pipJson as unknown as ToonDoc;

function boot() {
  const saved = loadAutosave();
  if (saved && validateToon(saved.doc).ok) return initialState(saved.doc, saved.fileName);
  return initialState(pip, "pip.toon.json");
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);

export function App() {
  const [state, dispatch] = useReducer(reducer, undefined, boot);
  const preview = usePreview(state.doc, state.mode, state.clip, state.time, state.onion);
  const fileInput = useRef<HTMLInputElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Autosave (debounced).
  useEffect(() => {
    const id = setTimeout(() => saveAutosave(state.doc, state.fileName), 400);
    return () => clearTimeout(id);
  }, [state.doc, state.fileName]);

  // Playback.
  const clipDef = state.clip ? state.doc.clips?.[state.clip] : undefined;
  useEffect(() => {
    if (!state.playing || !clipDef) return;
    let raf = 0;
    let last = performance.now();
    // Accumulate locally: renders can lag behind animation frames.
    let t = stateRef.current.time;
    const tick = (now: number) => {
      t += ((now - last) / 1000) * stateRef.current.speed;
      last = now;
      if (t > clipDef.duration) {
        if (clipDef.loop) t %= clipDef.duration;
        else {
          dispatch({ type: "time", time: clipDef.duration });
          dispatch({ type: "playing", playing: false });
          return;
        }
      }
      dispatch({ type: "time", time: t });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state.playing, clipDef]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = stateRef.current;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        dispatch({ type: "redo" });
        return;
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
        return;
      }
      if (isTyping(e.target)) return;
      if (e.key === " ") {
        e.preventDefault();
        dispatch({ type: "playing", playing: !s.playing });
      } else if ((e.key === "Delete" || e.key === "Backspace") && s.selection.kind === "key" && s.clip) {
        dispatch({ type: "edit", doc: removeKey(s.doc, s.clip, s.selection.channel, s.selection.index), select: { kind: "none" } });
      } else if (e.key.toLowerCase() === "k" && s.selection.kind === "bone" && s.clip) {
        const ch = `bones.${s.selection.id}.rotation`;
        dispatch({ type: "edit", doc: setKey(s.doc, s.clip, ch, s.time, Number(clipValue(s.doc, s.clip, ch, s.time) ?? 0)) });
      } else if (e.key === "1") dispatch({ type: "mode", mode: "rig" });
      else if (e.key === "2") dispatch({ type: "mode", mode: "animate" });
      else if (e.key === "ArrowLeft") dispatch({ type: "time", time: Math.max(0, s.time - 1 / 60) });
      else if (e.key === "ArrowRight") dispatch({ type: "time", time: s.time + 1 / 60 });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // File handling ---------------------------------------------------------------------
  const openText = (text: string, name: string) => {
    try {
      const r = validateToon(JSON.parse(text));
      if (!r.ok) return alert(`Invalid character:\n${r.issues.map((i) => `${i.path}: ${i.message}`).join("\n")}`);
      dispatch({ type: "load", doc: r.value, fileName: name });
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const save = () => {
    const s = stateRef.current;
    const blob = new Blob([JSON.stringify(s.doc, null, 2) + "\n"], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = s.fileName.endsWith(".toon.json") ? s.fileName : `${s.doc.name}.toon.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) openText(await file.text(), file.name);
  };

  return (
    <div className="editor" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <header className="toolbar">
        <strong className="brand">animeStudio</strong>
        <button onClick={() => confirm("Start a new character? Unsaved changes stay in undo history.") && dispatch({ type: "load", doc: blankToon(), fileName: "character.toon.json" })}>
          New
        </button>
        <button onClick={() => fileInput.current?.click()}>Open…</button>
        <button onClick={save} title="Download .toon.json (Ctrl/Cmd+S)">
          Save
        </button>
        <button onClick={() => dispatch({ type: "load", doc: pip, fileName: "pip.toon.json" })}>Example: Pip</button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) openText(await f.text(), f.name);
            e.target.value = "";
          }}
        />
        <span className="sep" />
        <button onClick={() => dispatch({ type: "undo" })} disabled={!state.past.length} title="Undo (Ctrl/Cmd+Z)">
          ↶
        </button>
        <button onClick={() => dispatch({ type: "redo" })} disabled={!state.future.length} title="Redo (Shift+Ctrl/Cmd+Z)">
          ↷
        </button>
        <span className="sep" />
        <div className="segmented">
          <button className={state.mode === "rig" ? "on" : ""} onClick={() => dispatch({ type: "mode", mode: "rig" })} title="Rig mode (1)">
            Rig
          </button>
          <button className={state.mode === "animate" ? "on" : ""} onClick={() => dispatch({ type: "mode", mode: "animate" })} title="Animate mode (2)">
            Animate
          </button>
        </div>
        <label className="check">
          <input type="checkbox" checked={state.showBones} onChange={() => dispatch({ type: "toggle", key: "showBones" })} /> Bones
        </label>
        <span className="spacer" />
        <span className="file">{state.fileName}</span>
      </header>

      <aside className="left">
        <Outliner state={state} dispatch={dispatch} rig={preview.rig} />
      </aside>

      <main className="center">
        <div className="stage">
          <Viewport state={state} dispatch={dispatch} preview={preview} />
          <div className="stage-hint">
            {state.mode === "rig"
              ? "Rig: drag joints (●) and tips (○) to place bones · wheel to zoom · drag background to pan · F to fit"
              : state.clip
                ? "Animate: drag a bone to rotate it, drag ■ IK handles — keys are set at the playhead · K keys the selected bone · F to fit"
                : "Create a clip in the timeline to animate"}
            {preview.error ? <span className="error"> · {preview.error}</span> : null}
          </div>
        </div>
        <Timeline state={state} dispatch={dispatch} rig={preview.rig} />
      </main>

      <aside className="right">
        <Inspector state={state} dispatch={dispatch} />
      </aside>
    </div>
  );
}
