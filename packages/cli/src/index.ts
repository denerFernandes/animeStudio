/**
 * `@animestudio/cli` as a library: the parts of the `toon` command line that are useful on their
 * own (document loading, library-side diagnostics, the video doctor, character descriptions).
 * Importing this module runs nothing; the command line itself is `bin.ts`.
 */
export { describeCharacter } from "./describe";
export { type DoctorReport, type Evaluable, debugDocument, doctor, loadEvaluable } from "./doctor";
export { loadSceneAssets, readJson } from "./load";
