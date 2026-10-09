import { type Rig, apply } from "@animestudio/core";
import type { Dispatch, ReactElement } from "react";
import { addBone, deleteBone, deletePart, movePart } from "./doc";
import type { Action, EditorState } from "./store";

export function Outliner({ state, dispatch, rig }: { state: EditorState; dispatch: Dispatch<Action>; rig: Rig | null }) {
  const { doc, selection } = state;
  const selectedBone = selection.kind === "bone" ? selection.id : null;
  const selectedPart = selection.kind === "part" ? selection.id : null;

  const children = new Map<string | undefined, string[]>();
  for (const b of doc.skeleton) {
    const list = children.get(b.parent) ?? [];
    list.push(b.id);
    children.set(b.parent, list);
  }

  const renderBone = (id: string, depth: number): ReactElement[] => [
    <div
      key={id}
      className={id === selectedBone ? "item selected" : "item"}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={() => dispatch({ type: "select", selection: { kind: "bone", id } })}
    >
      <span className="glyph">{children.get(id)?.length ? "▾" : "•"}</span> {id}
    </div>,
    ...(children.get(id) ?? []).flatMap((c) => renderBone(c, depth + 1)),
  ];

  const addChild = () => {
    const parentId = selectedBone ?? doc.skeleton[0].id;
    const b = rig?.bones[rig.boneIndex.get(parentId) ?? 0];
    const from = b ? apply(b.setupWorld, [b.length, 0]) : ([0, 0] as [number, number]);
    const { doc: next, id } = addBone(doc, parentId, from, [from[0], from[1] - 40]);
    dispatch({ type: "edit", doc: next, select: { kind: "bone", id } });
  };

  const removeBone = () => {
    if (!selectedBone) return;
    const next = deleteBone(doc, selectedBone);
    if (next === doc) return alert("Root bones cannot be deleted.");
    dispatch({ type: "edit", doc: next, select: { kind: "none" } });
  };

  // Parts are listed front-most first (reverse draw order), like layer panels.
  const parts = [...doc.parts].reverse();

  return (
    <div className="outliner">
      <section>
        <header>
          <h3>Bones</h3>
          <div className="buttons">
            <button onClick={addChild} title="Add a child bone to the selected bone">
              + Bone
            </button>
            <button onClick={removeBone} disabled={!selectedBone} title="Delete the selected bone">
              Delete
            </button>
          </div>
        </header>
        <div className="list">{(children.get(undefined) ?? []).flatMap((id) => renderBone(id, 0))}</div>
      </section>
      <section>
        <header>
          <h3>Parts</h3>
          <div className="buttons">
            <button disabled={!selectedPart} onClick={() => selectedPart && dispatch({ type: "edit", doc: movePart(doc, selectedPart, 1) })} title="Bring forward">
              ↑
            </button>
            <button disabled={!selectedPart} onClick={() => selectedPart && dispatch({ type: "edit", doc: movePart(doc, selectedPart, -1) })} title="Send backward">
              ↓
            </button>
            <button
              disabled={!selectedPart}
              onClick={() => selectedPart && dispatch({ type: "edit", doc: deletePart(doc, selectedPart), select: { kind: "none" } })}
              title="Delete part"
            >
              Delete
            </button>
          </div>
        </header>
        <div className="list">
          {parts.map((p) => (
            <div key={p.id} className={p.id === selectedPart ? "item selected" : "item"} onClick={() => dispatch({ type: "select", selection: { kind: "part", id: p.id } })}>
              <span className="badge">{p.type}</span> {p.id}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
