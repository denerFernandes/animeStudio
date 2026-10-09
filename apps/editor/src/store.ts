import type { ToonDoc } from "@animestudio/core";
import { toSetupForm } from "./doc";

export type Mode = "rig" | "animate";

export type Selection =
  | { kind: "none" }
  | { kind: "bone"; id: string }
  | { kind: "part"; id: string }
  | { kind: "key"; channel: string; index: number };

export interface EditorState {
  doc: ToonDoc;
  past: ToonDoc[];
  future: ToonDoc[];
  /** Id of the gesture (drag) that produced the last edit; repeated edits coalesce in history. */
  gesture: string | null;
  mode: Mode;
  selection: Selection;
  clip: string | null;
  time: number;
  playing: boolean;
  speed: number;
  onion: boolean;
  showBones: boolean;
  fileName: string;
}

export type Action =
  | { type: "edit"; doc: ToonDoc; gesture?: string; select?: Selection }
  | { type: "load"; doc: ToonDoc; fileName?: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "endGesture" }
  | { type: "select"; selection: Selection }
  | { type: "mode"; mode: Mode }
  | { type: "clip"; clip: string | null }
  | { type: "time"; time: number }
  | { type: "playing"; playing: boolean }
  | { type: "speed"; speed: number }
  | { type: "toggle"; key: "onion" | "showBones" };

const HISTORY = 200;

export function initialState(doc: ToonDoc, fileName = "character.toon.json"): EditorState {
  const prepared = toSetupForm(doc);
  return {
    doc: prepared,
    past: [],
    future: [],
    gesture: null,
    mode: "animate",
    selection: { kind: "none" },
    clip: Object.keys(prepared.clips ?? {})[0] ?? null,
    time: 0,
    playing: false,
    speed: 1,
    onion: false,
    showBones: true,
    fileName,
  };
}

export function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case "edit": {
      if (action.doc === state.doc) return action.select ? { ...state, selection: action.select } : state;
      const coalesce = action.gesture !== undefined && action.gesture === state.gesture;
      return {
        ...state,
        doc: action.doc,
        past: coalesce ? state.past : [...state.past, state.doc].slice(-HISTORY),
        future: [],
        gesture: action.gesture ?? null,
        selection: action.select ?? state.selection,
        clip: state.clip && action.doc.clips?.[state.clip] ? state.clip : (Object.keys(action.doc.clips ?? {})[0] ?? null),
      };
    }
    case "load": {
      const next = initialState(action.doc, action.fileName ?? state.fileName);
      return { ...next, past: [...state.past, state.doc].slice(-HISTORY), mode: state.mode, showBones: state.showBones };
    }
    case "undo": {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return { ...state, doc: prev, past: state.past.slice(0, -1), future: [state.doc, ...state.future], gesture: null, selection: { kind: "none" } };
    }
    case "redo": {
      const next = state.future[0];
      if (!next) return state;
      return { ...state, doc: next, past: [...state.past, state.doc], future: state.future.slice(1), gesture: null, selection: { kind: "none" } };
    }
    case "endGesture":
      return { ...state, gesture: null };
    case "select":
      return { ...state, selection: action.selection };
    case "mode":
      return { ...state, mode: action.mode, playing: false };
    case "clip":
      return { ...state, clip: action.clip, time: 0, selection: state.selection.kind === "key" ? { kind: "none" } : state.selection };
    case "time":
      return { ...state, time: action.time };
    case "playing":
      return { ...state, playing: action.playing };
    case "speed":
      return { ...state, speed: action.speed };
    case "toggle":
      return { ...state, [action.key]: !state[action.key] };
  }
}

const STORAGE_KEY = "animestudio.editor.v1";

export function loadAutosave(): { doc: ToonDoc; fileName: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as { doc: ToonDoc; fileName: string }) : null;
  } catch {
    return null;
  }
}

export function saveAutosave(doc: ToonDoc, fileName: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ doc, fileName }));
  } catch {
    // Storage may be unavailable (private mode, quota); autosave is best-effort.
  }
}
