import { type Vec2, angleOf, apply, sub, wrapAngle } from "@animestudio/core";
import { Node } from "@animestudio/react";
import { type Dispatch, type PointerEvent, type WheelEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { clipValue, moveBoneHandle, setKeySeamless as setKey } from "./doc";
import type { Preview } from "./preview";
import type { Action, EditorState } from "./store";

type Drag =
  | { kind: "pan"; startClient: Vec2; startCam: Vec2 }
  | { kind: "joint" | "tip"; bone: string; gesture: string }
  | { kind: "rotate"; bone: string; gesture: string; pivot: Vec2; startAngle: number; startValue: number; flip: number }
  | { kind: "ik"; ik: number; gesture: string };

let gestureCounter = 0;
const newGesture = (name: string) => `${name}-${++gestureCounter}`;

export function Viewport({ state, dispatch, preview }: { state: EditorState; dispatch: Dispatch<Action>; preview: Preview }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [cam, setCam] = useState({ x: 0, y: -170, zoom: 1.4 });
  const drag = useRef<Drag | null>(null);
  const { rig, pose, nodes, onion } = preview;

  useLayoutEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Frame the character: on load (once the viewport is measured), on new documents and on "F".
  const fit = () => {
    if (!rig) return;
    const pts = rig.bones.flatMap((b) => [apply(b.setupWorld, [0, 0]), apply(b.setupWorld, [b.length, 0])]);
    const xs = pts.map((p) => p[0]);
    const ys = [0, ...pts.map((p) => p[1])];
    const pad = 80;
    const minX = Math.min(...xs) - pad;
    const maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad;
    const maxY = Math.max(...ys) + pad / 2;
    const zoom = Math.max(0.2, Math.min(4, Math.min(size.w / (maxX - minX), size.h / (maxY - minY))));
    setCam({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom });
  };
  const measured = useRef(false);
  const docName = state.doc.name;
  useEffect(() => {
    if (!measured.current) return;
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docName]);
  useEffect(() => {
    if (measured.current || !rig || size.w === 0) return;
    measured.current = true;
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, rig]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key.toLowerCase() === "f" && !["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) fit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const vb = { x: cam.x - size.w / 2 / cam.zoom, y: cam.y - size.h / 2 / cam.zoom, w: size.w / cam.zoom, h: size.h / cam.zoom };
  const px = (n: number) => n / cam.zoom;

  const toWorld = (e: { clientX: number; clientY: number }): Vec2 => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return [p.x, p.y];
  };

  const round = (v: Vec2): Vec2 => [Math.round(v[0] * 10) / 10, Math.round(v[1] * 10) / 10];

  // Pointer handling ------------------------------------------------------------------
  const startDrag = (e: PointerEvent, d: Drag) => {
    e.stopPropagation();
    svgRef.current?.setPointerCapture(e.pointerId);
    drag.current = d;
  };

  const onBoneDown = (e: PointerEvent, boneIndex: number, handle: "joint" | "tip" | "body") => {
    if (!rig || !pose) return;
    const bone = rig.bones[boneIndex];
    dispatch({ type: "select", selection: { kind: "bone", id: bone.id } });
    if (state.mode === "rig") {
      if (handle === "body") return;
      startDrag(e, { kind: handle, bone: bone.id, gesture: newGesture(handle) });
      return;
    }
    if (!state.clip) return;
    const m = pose.world[boneIndex];
    const pivot: Vec2 = [m[4], m[5]];
    const parent = bone.parent >= 0 ? pose.world[bone.parent] : null;
    const flip = parent && parent[0] * parent[3] - parent[1] * parent[2] < 0 ? -1 : 1;
    const startValue = Number(clipValue(state.doc, state.clip, `bones.${bone.id}.rotation`, state.time) ?? 0);
    startDrag(e, { kind: "rotate", bone: bone.id, gesture: newGesture("rotate"), pivot, startAngle: angleOf(sub(toWorld(e), pivot)), startValue, flip });
  };

  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === "pan") {
      const dx = (e.clientX - d.startClient[0]) / cam.zoom;
      const dy = (e.clientY - d.startClient[1]) / cam.zoom;
      setCam((c) => ({ ...c, x: d.startCam[0] - dx, y: d.startCam[1] - dy }));
      return;
    }
    const p = round(toWorld(e));
    if (d.kind === "joint" || d.kind === "tip") {
      dispatch({ type: "edit", doc: moveBoneHandle(state.doc, d.bone, d.kind === "joint" ? "from" : "to", p), gesture: d.gesture });
    } else if (d.kind === "rotate" && state.clip) {
      const delta = wrapAngle(angleOf(sub(p, d.pivot)) - d.startAngle) * d.flip;
      const value = Math.round((d.startValue + delta) * 10) / 10;
      dispatch({ type: "edit", doc: setKey(state.doc, state.clip, `bones.${d.bone}.rotation`, state.time, value), gesture: d.gesture });
    } else if (d.kind === "ik" && rig && state.clip) {
      const k = rig.ik[d.ik];
      const off: Vec2 = round([p[0] - k.restTarget[0], p[1] - k.restTarget[1]]);
      let doc = setKey(state.doc, state.clip, `ik.${k.id}.x`, state.time, off[0]);
      doc = setKey(doc, state.clip, `ik.${k.id}.y`, state.time, off[1]);
      dispatch({ type: "edit", doc, gesture: d.gesture });
    }
  };

  const onPointerUp = () => {
    if (drag.current && drag.current.kind !== "pan") dispatch({ type: "endGesture" });
    drag.current = null;
  };

  const onBackgroundDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    dispatch({ type: "select", selection: { kind: "none" } });
    startDrag(e, { kind: "pan", startClient: [e.clientX, e.clientY], startCam: [cam.x, cam.y] });
  };

  const onWheel = (e: WheelEvent) => {
    const before = toWorld(e);
    const zoom = Math.max(0.1, Math.min(12, cam.zoom * Math.exp(-e.deltaY * 0.0015)));
    // Keep the point under the cursor fixed.
    const rect = svgRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left - size.w / 2;
    const sy = e.clientY - rect.top - size.h / 2;
    setCam({ zoom, x: before[0] - sx / zoom, y: before[1] - sy / zoom });
  };

  // Overlay -------------------------------------------------------------------------------
  const selectedBone = state.selection.kind === "bone" ? state.selection.id : null;
  const selectedPart = state.selection.kind === "part" ? state.selection.id : null;

  return (
    <svg
      ref={svgRef}
      className="viewport"
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      onPointerDown={onBackgroundDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    >
      {rig?.defs ? <defs dangerouslySetInnerHTML={{ __html: rig.defs }} /> : null}
      <line x1={vb.x} x2={vb.x + vb.w} y1={0} y2={0} className="ground" strokeWidth={px(1.5)} />
      <path d={`M${-px(10)} 0H${px(10)}M0 ${-px(10)}V${px(10)}`} className="origin" strokeWidth={px(1.5)} />

      {onion.map((ghost, i) => (
        <g key={i} className={`onion onion-${i}`}>
          {ghost.map((n) => (
            <Node key={n.key} node={n} />
          ))}
        </g>
      ))}

      {nodes.map((n) => (
        <g
          key={n.key}
          className={n.key === selectedPart ? "part selected-part" : "part"}
          onPointerDown={(e) => {
            e.stopPropagation();
            dispatch({ type: "select", selection: { kind: "part", id: n.key } });
            startDrag(e, { kind: "pan", startClient: [e.clientX, e.clientY], startCam: [cam.x, cam.y] });
          }}
        >
          <Node node={n} />
        </g>
      ))}

      {state.showBones && rig && pose
        ? rig.bones.map((b, i) => {
            const m = pose.world[i];
            const a: Vec2 = [m[4], m[5]];
            const t = apply(m, [b.length, 0]);
            const sel = b.id === selectedBone;
            return (
              <g key={b.id} className={sel ? "bone selected" : "bone"}>
                {b.length > 0 ? (
                  <>
                    <line x1={a[0]} y1={a[1]} x2={t[0]} y2={t[1]} className="bone-line" strokeWidth={px(sel ? 4 : 3)} />
                    <line
                      x1={a[0]}
                      y1={a[1]}
                      x2={t[0]}
                      y2={t[1]}
                      className="hit"
                      strokeWidth={px(14)}
                      onPointerDown={(e) => onBoneDown(e, i, "body")}
                    />
                  </>
                ) : null}
                <circle cx={a[0]} cy={a[1]} r={px(sel ? 6 : 5)} className="joint" strokeWidth={px(2)} onPointerDown={(e) => onBoneDown(e, i, "joint")} />
                {state.mode === "rig" && b.length > 0 ? (
                  <circle cx={t[0]} cy={t[1]} r={px(4)} className="tip" strokeWidth={px(1.5)} onPointerDown={(e) => onBoneDown(e, i, "tip")} />
                ) : null}
              </g>
            );
          })
        : null}

      {state.mode === "animate" && state.clip && rig && pose
        ? rig.ik.map((k, i) => {
            const p: Vec2 = [k.restTarget[0] + pose.state.ikX[i], k.restTarget[1] + pose.state.ikY[i]];
            const s = px(7);
            return (
              <rect
                key={k.id}
                x={p[0] - s}
                y={p[1] - s}
                width={s * 2}
                height={s * 2}
                className="ik-handle"
                strokeWidth={px(2)}
                onPointerDown={(e) => startDrag(e, { kind: "ik", ik: i, gesture: newGesture("ik") })}
              >
                <title>IK {k.id}</title>
              </rect>
            );
          })
        : null}
    </svg>
  );
}
