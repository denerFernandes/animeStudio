import {
  type CompiledScene,
  type RenderFrame,
  type RenderNode,
  type SceneAssets,
  type SceneDoc,
  compileScene,
  evaluateScene,
  isIdentity,
  matToString,
} from "@animestudio/core";
import { type CSSProperties, type ReactElement, memo, useMemo } from "react";

const toReactAttr = (k: string) => k.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());

/** Renders a list of render nodes (no <svg> wrapper) — for custom viewports and editors. */
export function RenderNodes({ nodes }: { nodes: RenderNode[] }) {
  return (
    <>
      {nodes.map((n) => (
        <Node key={n.key} node={n} />
      ))}
    </>
  );
}

export function Node({ node }: { node: RenderNode }) {
  const transform = "transform" in node && node.transform && !isIdentity(node.transform) ? matToString(node.transform) : undefined;
  // Filters are in screen space: a wrapper without transform (keeps the element tree stable).
  const wrap = (el: ReactElement) => <g style={"filter" in node && node.filter ? { filter: node.filter } : undefined}>{el}</g>;
  switch (node.kind) {
    case "group":
      return wrap(
        <g id={node.id} transform={transform} opacity={node.opacity}>
          {node.children.map((c) => (
            <Node key={c.key} node={c} />
          ))}
        </g>,
      );
    case "markup":
      return wrap(<MarkupNode transform={transform} opacity={node.opacity} markup={node.markup} />);
    case "path": {
      const attrs = Object.fromEntries(Object.entries(node.attrs).map(([k, v]) => [toReactAttr(k), v]));
      return <path d={node.d} opacity={node.opacity} {...attrs} />;
    }
  }
}

/** Static art is memoized on its markup so React only updates the transform. */
const MarkupNode = memo(function MarkupNode(props: { transform?: string; opacity?: number; markup: string }) {
  return <g transform={props.transform} opacity={props.opacity} dangerouslySetInnerHTML={{ __html: props.markup }} />;
});

export interface ToonFrameProps {
  frame: RenderFrame;
  style?: CSSProperties;
  className?: string;
  /** Rendered size (CSS); defaults to the frame size. Height follows the aspect ratio if omitted. */
  width?: number | string;
  height?: number | string;
}

interface Run {
  filter?: string;
  nodes: RenderNode[];
}

/** Markup that defines masks/filters which are rebuilt every frame (shading, lighting, transitions). */
const definesResources = (n: RenderNode) => n.kind === "markup" && /<(mask|filter)\b/.test(n.markup);

/**
 * Splits a frame into stacked `<svg>` layers:
 * - blurred nodes get their own layer with the blur applied as an HTML-level CSS filter;
 * - a node defining per-frame masks/filters ends its layer, so nothing is painted after it in the
 *   same SVG.
 * Chrome's frame-by-frame capture occasionally skipped painting elements that followed filtered
 * content or rebuilt definitions inside one SVG; separate layers paint reliably.
 */
export function splitRuns(nodes: RenderNode[]): Run[] {
  const runs: Run[] = [];
  let current: Run | null = null;
  let closed = false;
  for (const n of nodes) {
    const filter = "filter" in n ? n.filter : undefined;
    if (!current || closed || current.filter !== filter) {
      current = { filter, nodes: [] };
      runs.push(current);
      closed = false;
    }
    current.nodes.push(filter && n.kind !== "path" ? ({ ...n, filter: undefined } as RenderNode) : n);
    if (definesResources(n)) closed = true;
  }
  return runs;
}

/** Renders an evaluated frame (as stacked SVG layers in a positioned box). */
export function ToonFrame({ frame, style, className, width, height }: ToonFrameProps) {
  const runs = useMemo(() => splitRuns(frame.nodes), [frame.nodes]);
  const viewBox = `0 0 ${frame.width} ${frame.height}`;
  const layer: CSSProperties = { position: "absolute", left: 0, top: 0, width: "100%", height: "100%", overflow: "visible" };
  return (
    <div
      className={className}
      style={{
        position: "relative",
        overflow: "hidden",
        width: width ?? frame.width,
        height: height ?? (width === undefined ? frame.height : undefined),
        aspectRatio: `${frame.width} / ${frame.height}`,
        ...style,
      }}
    >
      {runs.length === 0 ? (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox={viewBox} style={layer}>
          {frame.defs ? <defs dangerouslySetInnerHTML={{ __html: frame.defs }} /> : null}
          {frame.background ? <rect width={frame.width} height={frame.height} fill={frame.background} /> : null}
        </svg>
      ) : (
        runs.map((run, i) => (
          <svg key={i} xmlns="http://www.w3.org/2000/svg" viewBox={viewBox} style={run.filter ? { ...layer, filter: run.filter } : layer}>
            {i === 0 && frame.defs ? <defs dangerouslySetInnerHTML={{ __html: frame.defs }} /> : null}
            {i === 0 && frame.background ? <rect width={frame.width} height={frame.height} fill={frame.background} /> : null}
            {run.nodes.map((n) => (
              <Node key={n.key} node={n} />
            ))}
          </svg>
        ))
      )}
    </div>
  );
}

/** Compiles a scene once per (doc, assets) identity. */
export function useCompiledScene(doc: SceneDoc, assets: SceneAssets): CompiledScene {
  return useMemo(() => compileScene(doc, assets), [doc, assets]);
}

export interface ToonSceneProps extends Omit<ToonFrameProps, "frame"> {
  scene: CompiledScene;
  /** Time in seconds. */
  time: number;
}

/** Renders a compiled scene at a given time. */
export function ToonScene({ scene, time, ...rest }: ToonSceneProps) {
  const frame = useMemo(() => evaluateScene(scene, time), [scene, time]);
  return <ToonFrame frame={frame} {...rest} />;
}
