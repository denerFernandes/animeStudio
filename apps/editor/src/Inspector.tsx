import { type BoneDef, type Ease, EASING_NAMES, type PartDef, type ToonDoc, type Value, validateToon } from "@animestudio/core";
import { type Dispatch, type ReactNode, useEffect, useMemo, useState } from "react";
import { moveKey, removeKey, renameBone, setKey, setKeyEase, trackKeys, updateBone, updatePart } from "./doc";
import type { Action, EditorState } from "./store";

// ---------------------------------------------------------------------------
// Small inputs that commit on blur / Enter (so typing doesn't spam history)
// ---------------------------------------------------------------------------

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function TextInput({ value, onCommit, mono }: { value: string; onCommit: (v: string) => void; mono?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      className={mono ? "mono" : undefined}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

function NumberInput({ value, onCommit, step = 1 }: { value: number | undefined; onCommit: (v: number | undefined) => void; step?: number }) {
  const [v, setV] = useState(value === undefined ? "" : String(value));
  useEffect(() => setV(value === undefined ? "" : String(value)), [value]);
  return (
    <input
      type="number"
      step={step}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onCommit(v === "" ? undefined : Number(v))}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

function TextArea({ value, onCommit, rows = 6 }: { value: string; onCommit: (v: string) => void; rows?: number }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <textarea className="mono" rows={rows} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onCommit(v)} />;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function BoneInspector({ doc, id, dispatch }: { doc: ToonDoc; id: string; dispatch: Dispatch<Action> }) {
  const index = doc.skeleton.findIndex((b) => b.id === id);
  const bone = doc.skeleton[index];
  if (!bone) return null;
  const edit = (patch: Partial<BoneDef>) => dispatch({ type: "edit", doc: updateBone(doc, id, patch) });
  const vec = (v: [number, number] | undefined, which: 0 | 1, key: "from" | "to") => (
    <NumberInput
      value={v?.[which]}
      step={0.5}
      onCommit={(n) => {
        const cur: [number, number] = [...(v ?? [0, 0])] as [number, number];
        cur[which] = n ?? 0;
        edit({ [key]: cur });
      }}
    />
  );
  // Only bones declared earlier (and not descendants) can become the parent.
  const descendants = new Set([id]);
  for (const b of doc.skeleton) if (b.parent && descendants.has(b.parent)) descendants.add(b.id);
  const parents = doc.skeleton.slice(0, index).filter((b) => !descendants.has(b.id));
  const limits = bone.limits?.rotation;
  return (
    <>
      <h3>Bone</h3>
      <Field label="Id">
        <TextInput
          value={bone.id}
          onCommit={(v) => {
            try {
              dispatch({ type: "edit", doc: renameBone(doc, id, v.trim()), select: { kind: "bone", id: v.trim() } });
            } catch (e) {
              alert((e as Error).message);
            }
          }}
        />
      </Field>
      <Field label="Parent">
        <select value={bone.parent ?? ""} disabled={!bone.parent} onChange={(e) => edit({ parent: e.target.value })}>
          {!bone.parent ? <option value="">(root)</option> : null}
          {parents.map((p) => (
            <option key={p.id}>{p.id}</option>
          ))}
        </select>
      </Field>
      <div className="grid2">
        <Field label="From x">{vec(bone.from, 0, "from")}</Field>
        <Field label="From y">{vec(bone.from, 1, "from")}</Field>
        <Field label="To x">{vec(bone.to, 0, "to")}</Field>
        <Field label="To y">{vec(bone.to, 1, "to")}</Field>
        <Field label="Mass">
          <NumberInput value={bone.mass} step={0.1} onCommit={(n) => edit({ mass: n && n > 0 ? n : undefined })} />
        </Field>
        <Field label="Length (override)">
          <NumberInput value={bone.length} step={1} onCommit={(n) => edit({ length: n })} />
        </Field>
        <Field label="Limit min°">
          <NumberInput value={limits?.[0]} onCommit={(n) => edit({ limits: n === undefined ? undefined : { rotation: [n, limits?.[1] ?? 180] } })} />
        </Field>
        <Field label="Limit max°">
          <NumberInput value={limits?.[1]} onCommit={(n) => edit({ limits: n === undefined ? undefined : { rotation: [limits?.[0] ?? -180, n] } })} />
        </Field>
      </div>
      <label className="check">
        <input type="checkbox" checked={bone.inheritRotation ?? true} onChange={(e) => edit({ inheritRotation: e.target.checked ? undefined : false })} /> Inherit
        rotation
      </label>
      <label className="check">
        <input type="checkbox" checked={bone.inheritScale ?? true} onChange={(e) => edit({ inheritScale: e.target.checked ? undefined : false })} /> Inherit scale
      </label>
    </>
  );
}

function ArtEditor({ doc, artRef, onChangeRef, dispatch, label }: { doc: ToonDoc; artRef: string; onChangeRef: (ref: string) => void; dispatch: Dispatch<Action>; label: string }) {
  const inline = artRef.trimStart().startsWith("<") || artRef === "";
  const markup = inline ? artRef : (doc.art?.[artRef] ?? "");
  return (
    <>
      <Field label={`${label} (art id or inline SVG)`}>
        <select value={inline ? "(inline)" : artRef} onChange={(e) => onChangeRef(e.target.value === "(inline)" ? markup : e.target.value)}>
          <option value="(inline)">(inline)</option>
          {Object.keys(doc.art ?? {}).map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </Field>
      <TextArea
        value={markup}
        onCommit={(v) => {
          if (inline) onChangeRef(v);
          else dispatch({ type: "edit", doc: { ...doc, art: { ...doc.art, [artRef]: v } } });
        }}
      />
    </>
  );
}

function PartInspector({ doc, id, dispatch }: { doc: ToonDoc; id: string; dispatch: Dispatch<Action> }) {
  const part = doc.parts.find((p) => p.id === id);
  const [variant, setVariant] = useState<string | null>(null);
  if (!part) return null;
  const edit = (patch: Record<string, unknown>) => dispatch({ type: "edit", doc: updatePart(doc, id, patch) });
  const bones = doc.skeleton.map((b) => b.id);
  const style = (p: PartDef) =>
    "fill" in p || p.type === "hose" || p.type === "skinned" || p.type === "morph" ? (
      <div className="grid2">
        <Field label="Fill">
          <TextInput value={(p as { fill?: string }).fill ?? ""} onCommit={(v) => edit({ fill: v || undefined })} />
        </Field>
        <Field label="Stroke">
          <TextInput value={(p as { stroke?: string }).stroke ?? ""} onCommit={(v) => edit({ stroke: v || undefined })} />
        </Field>
        <Field label="Stroke width">
          <NumberInput value={(p as { strokeWidth?: number }).strokeWidth} step={0.5} onCommit={(n) => edit({ strokeWidth: n })} />
        </Field>
      </div>
    ) : null;
  return (
    <>
      <h3>
        Part <span className="badge">{part.type}</span>
      </h3>
      <Field label="Id">
        <input value={part.id} readOnly />
      </Field>
      {"bone" in part ? (
        <Field label="Bone">
          <select value={part.bone} onChange={(e) => edit({ bone: e.target.value })}>
            {bones.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </Field>
      ) : (
        <Field label="Bones (comma separated)">
          <TextInput value={part.bones.join(", ")} onCommit={(v) => edit({ bones: v.split(",").map((s) => s.trim()).filter(Boolean) })} />
        </Field>
      )}
      <div className="grid2">
        <Field label="Opacity">
          <NumberInput value={part.opacity} step={0.05} onCommit={(n) => edit({ opacity: n })} />
        </Field>
        <Field label="Z">
          <NumberInput value={part.z} onCommit={(n) => edit({ z: n })} />
        </Field>
      </div>
      {part.type === "rigid" ? <ArtEditor doc={doc} artRef={part.art} label="Art" dispatch={dispatch} onChangeRef={(art) => edit({ art })} /> : null}
      {part.type === "switch" ? (
        <>
          <Field label="Default variant">
            <select value={part.default} onChange={(e) => edit({ default: e.target.value })}>
              {Object.keys(part.variants).map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
          <Field label="Edit variant">
            <select value={variant ?? part.default} onChange={(e) => setVariant(e.target.value)}>
              {Object.keys(part.variants).map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
          <ArtEditor
            doc={doc}
            artRef={part.variants[variant ?? part.default] ?? ""}
            label="Variant art"
            dispatch={dispatch}
            onChangeRef={(art) => edit({ variants: { ...part.variants, [variant ?? part.default]: art } })}
          />
        </>
      ) : null}
      {part.type === "hose" ? (
        <>
          <Field label="Width (number or comma list)">
            <TextInput
              value={Array.isArray(part.width) ? part.width.join(", ") : String(part.width)}
              onCommit={(v) => {
                const nums = v.split(",").map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n));
                if (nums.length) edit({ width: nums.length === 1 ? nums[0] : nums });
              }}
            />
          </Field>
          <Field label="Smooth (0–1)">
            <NumberInput value={part.smooth} step={0.1} onCommit={(n) => edit({ smooth: n })} />
          </Field>
          {style(part)}
        </>
      ) : null}
      {part.type === "skinned" || part.type === "morph" ? (
        <>
          {style(part)}
          <Field label={part.type === "skinned" ? "Path (setup space)" : "Base path"}>
            <TextArea value={part.type === "skinned" ? part.path : part.base} onCommit={(v) => edit(part.type === "skinned" ? { path: v } : { base: v })} rows={4} />
          </Field>
          {part.type === "morph" ? <JsonValue label="Shapes" value={part.shapes} onCommit={(shapes) => edit({ shapes })} /> : null}
        </>
      ) : null}
    </>
  );
}

const EASES = ["(auto)", ...EASING_NAMES];

function KeyInspector({ state, dispatch }: { state: EditorState; dispatch: Dispatch<Action> }) {
  const { doc, clip, selection } = state;
  if (selection.kind !== "key" || !clip) return null;
  const { channel, index } = selection;
  const keys = trackKeys(doc, clip, channel);
  const key = keys[index];
  if (!key) return null;
  const [t, v, ease] = key;
  const commitValue = (value: Value) => dispatch({ type: "edit", doc: setKey(doc, clip, channel, t, value, ease) });
  return (
    <>
      <h3>Keyframe</h3>
      <Field label="Channel">
        <input value={channel} readOnly className="mono" />
      </Field>
      <div className="grid2">
        <Field label="Time (s)">
          <NumberInput
            value={t}
            step={1 / 60}
            onCommit={(n) => {
              if (n === undefined) return;
              const moved = moveKey(doc, clip, channel, index, n);
              dispatch({ type: "edit", doc: moved.doc, select: { kind: "key", channel, index: moved.index } });
            }}
          />
        </Field>
        {typeof v === "number" ? (
          <Field label="Value">
            <NumberInput value={v} step={0.5} onCommit={(n) => n !== undefined && commitValue(n)} />
          </Field>
        ) : null}
      </div>
      {typeof v !== "number" ? <JsonValue label="Value (JSON)" value={v} onCommit={(nv) => commitValue(nv as Value)} /> : null}
      <Field label="Ease (into this key)">
        <select
          value={typeof ease === "string" ? ease : ease ? "(bezier)" : "(auto)"}
          onChange={(e) =>
            dispatch({ type: "edit", doc: setKeyEase(doc, clip, channel, index, e.target.value === "(auto)" ? undefined : (e.target.value as Ease)) })
          }
        >
          {EASES.map((name) => (
            <option key={name}>{name}</option>
          ))}
          {Array.isArray(ease) ? <option>(bezier)</option> : null}
        </select>
      </Field>
      <p className="hint">(auto) = smooth spline through neighbouring keys.</p>
      <button
        onClick={() => dispatch({ type: "edit", doc: removeKey(doc, clip, channel, index), select: { kind: "none" } })}
      >
        Delete key
      </button>
    </>
  );
}

function JsonValue({ label, value, onCommit }: { label: string; value: unknown; onCommit: (v: never) => void }) {
  const text = JSON.stringify(value, null, 2) ?? "";
  const [error, setError] = useState("");
  return (
    <Field label={label}>
      <TextArea
        value={text}
        rows={Math.min(14, text.split("\n").length + 1)}
        onCommit={(v) => {
          try {
            onCommit(JSON.parse(v) as never);
            setError("");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      />
      {error ? <span className="error">{error}</span> : null}
    </Field>
  );
}

const SECTIONS = ["palette", "art", "anchors", "ik", "physics", "colliders", "controls", "behaviors", "meta"] as const;

function DocumentInspector({ doc, dispatch }: { doc: ToonDoc; dispatch: Dispatch<Action> }) {
  const [section, setSection] = useState<(typeof SECTIONS)[number]>("palette");
  const [issues, setIssues] = useState<string[]>([]);
  return (
    <>
      <h3>Character</h3>
      <Field label="Name">
        <TextInput value={doc.name} onCommit={(name) => dispatch({ type: "edit", doc: { ...doc, name } })} />
      </Field>
      {doc.palette ? (
        <div className="palette">
          {Object.entries(doc.palette).map(([k, c]) => (
            <label key={k} title={k}>
              <input
                type="color"
                value={/^#[0-9a-f]{6}$/i.test(c) ? c : "#000000"}
                onChange={(e) => dispatch({ type: "edit", doc: { ...doc, palette: { ...doc.palette, [k]: e.target.value } }, gesture: `palette-${k}` })}
              />
              <span>{k}</span>
            </label>
          ))}
        </div>
      ) : null}
      <Field label="Section (JSON)">
        <select value={section} onChange={(e) => (setSection(e.target.value as typeof section), setIssues([]))}>
          {SECTIONS.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </Field>
      <JsonValue
        key={section}
        label={section}
        value={doc[section] ?? (section === "ik" || section === "physics" || section === "colliders" || section === "behaviors" ? [] : {})}
        onCommit={(v) => {
          const next = { ...doc, [section]: v } as ToonDoc;
          const r = validateToon(next);
          if (!r.ok) return setIssues(r.issues.map((i) => `${i.path}: ${i.message}`));
          setIssues([]);
          dispatch({ type: "edit", doc: r.value });
        }}
      />
      {issues.map((i) => (
        <div key={i} className="error">
          {i}
        </div>
      ))}
    </>
  );
}

export function Inspector({ state, dispatch }: { state: EditorState; dispatch: Dispatch<Action> }) {
  const { doc, selection } = state;
  const validation = useMemo(() => validateToon(doc), [doc]);
  return (
    <div className="inspector">
      {selection.kind === "bone" ? <BoneInspector doc={doc} id={selection.id} dispatch={dispatch} /> : null}
      {selection.kind === "part" ? <PartInspector key={selection.id} doc={doc} id={selection.id} dispatch={dispatch} /> : null}
      {selection.kind === "key" ? <KeyInspector state={state} dispatch={dispatch} /> : null}
      {selection.kind === "none" ? <DocumentInspector doc={doc} dispatch={dispatch} /> : null}
      <div className={validation.ok ? "validation ok" : "validation"}>
        <h4>Validation</h4>
        {validation.issues.length === 0 ? <span>✓ Valid</span> : null}
        {validation.issues.map((i, k) => (
          <div key={k} className={i.severity}>
            {i.severity === "error" ? "✗" : "!"} {i.path}: {i.message}
          </div>
        ))}
      </div>
    </div>
  );
}
