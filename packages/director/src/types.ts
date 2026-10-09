import type { SceneDoc, SequenceDoc, ToonDoc } from "@animestudio/core";
import type { RigInfo } from "@animestudio/kit";

/** A spoken (or sung, or sound-effect) line with its timing in the episode audio. */
export interface Line {
  i: number;
  /** Start / end (s). */
  s: number;
  e: number;
  text: string;
  /** Cast name, a narrator name, "song" (everybody present sings) or "sfx". */
  speaker: string;
  words?: { w: string; s: number; e: number }[] | null;
  /** A sung line: everybody present sings it. */
  song?: boolean;
}

/** A moment in the episode, always relative to a line. */
export interface When {
  line: number;
  /** A word of that line (first occurrence, case and accents ignored). */
  word?: string;
  /** The end of the line instead of its start. */
  end?: boolean;
  /** Extra seconds. */
  offset?: number;
}

/** A place: a set mark, a mark plus an offset (px), someone (next to them), or a prop. */
export type Place = string | { mark: string; dx?: number } | { near: string; side?: "left" | "right" };

export interface CastEntry {
  id: string;
  /** Where they stand when the block starts (default: spread around the set's "center"). */
  at?: string;
  /** Slots to the left (−) or right (+) of `at`. */
  offset?: number;
  facing?: "left" | "right";
  emotion?: string;
  /** They enter later instead of being there from the start. */
  enter?: { line: number; word?: string; from: "left" | "right"; run?: boolean };
}

export interface PropEntry {
  id: string;
  kind: string;
  color?: string;
  heldBy?: string;
  at?: Place;
}

export type Beat = When & { do: string; until?: When; [k: string]: unknown };

export interface Block {
  id: string;
  set: string;
  /** First line of the block. */
  from: number;
  /** First line after the block (exclusive). */
  to: number;
  cast: CastEntry[];
  props?: PropEntry[];
  camera?: { type: string; who?: string | string[]; mark?: string };
  beats?: Beat[];
}

export interface Cut {
  line: number;
  word?: string;
  /** Show a window of an earlier block (muted speech) instead of the live action. */
  replay: { block: string; line: number; word?: string };
  /** Until this moment (default: the end of `line`). */
  until?: When;
  transition?: string;
}

export interface Text {
  line: number;
  text: string;
  until?: When;
}

/** What the AI writes (see docs/DIRECTOR.md). */
export interface Staging {
  blocks: Block[];
  cuts?: Cut[];
  texts?: Text[];
  /** What the story needed but the kit does not have (ignored by the director; a to-do list). */
  missing?: unknown[];
}

export interface Mark {
  x: number;
  y?: number;
}

export interface SetDef {
  layers: { id: string; art: string; parallax?: number }[] | (() => { id: string; art: string; parallax?: number }[]);
  /** Feet line of the near ground and (sets with depth) of the far side. */
  ground: { near: number; far?: number };
  /** Character scale multiplier on the far ground. */
  depthScale?: number;
  marks: Record<string, Mark>;
  /** Scenery rigs that are always there (traffic light…): a character placed at a mark. */
  fixtures?: { id: string; character: string; mark: string; y?: number; scale?: number; z?: number; flip?: boolean; channel?: string; value?: string }[];
  bounds?: [number, number, number, number];
  background?: string;
  lighting?: Record<string, unknown>;
}

export interface CastMember {
  /** Name used in the script ("Grandma Rose"). */
  name: string;
  /** Other ways the script addresses them ("grandma"). */
  aliases?: string[];
  scale: number;
  rig: RigInfo;
  /** Speed (px/s at scale 1) for walk and run. */
  speed?: { walk: number; run: number };
}

/** The pieces a series (or a one-off video) is made of. */
export interface Kit {
  /** Every rig used by the scenes: cast, vehicles, fixtures, birds… */
  characters: Record<string, ToonDoc>;
  cast: Record<string, CastMember>;
  /** Speaker names that are narration (no character speaks). */
  narrators?: string[];
  sets: Record<string, SetDef>;
  /** Props by kind: art drawn around the origin, and the radius (half height) so it rests on the ground. */
  props: Record<string, { art: (o: { color?: string }) => string; radius: number }>;
  vehicles?: Record<string, { character: string; scale: number; speed?: number }>;
  width?: number;
  height?: number;
  fps?: number;
}

export interface Overlay {
  text: string;
  from: number;
  to: number;
  row: number;
}

export interface Issue {
  severity: "error" | "warning";
  where: string;
  message: string;
}

export interface Directed {
  sequence: SequenceDoc;
  scenes: Record<string, SceneDoc>;
  overlays: Overlay[];
  issues: Issue[];
}
