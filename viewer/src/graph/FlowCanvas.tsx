import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type DefaultEdgeOptions,
  type Edge,
  type Node,
  type NodeTypes,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./graph.css";
import { useEffect, useMemo, type KeyboardEvent } from "react";
import { LAYOUT_DONE_MARK, mark } from "../perf";
import type { LayoutRunner } from "./layout";
import { useLayout } from "./useLayout";

const EDGE_OPTIONS: DefaultEdgeOptions = {
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
  focusable: false,
};

interface FlowCanvasProps<N extends Node, E extends Edge> {
  readonly nodes: readonly N[];
  readonly edges: readonly E[];
  /** Cache identity of this graph's layout (`layoutKey` or `overviewKey`). */
  readonly layoutId: string;
  readonly runLayout: LayoutRunner;
  readonly nodeTypes: NodeTypes;
  /** React Flow node ids drawn as selected. */
  readonly selectedIds: ReadonlySet<string>;
  /** Called when a node is clicked, or Enter is pressed on a focused node. */
  readonly onActivate?: (node: N) => void;
  /** React Flow node id to centre on once laid out, instead of fitting the whole graph. */
  readonly centerOn?: string | null;
  /** Status text while the first layout runs, e.g. "Laying out 40 tables…". */
  readonly pendingText: string;
  /** Status text when the graph has no nodes. */
  readonly emptyText: string;
}

/**
 * Fits the view each time a layout lands, so a new view is never off screen; or, when `centerOn`
 * names a node, zooms to that node instead.
 */
function FitOnLayout({ layoutId, centerOn }: { layoutId: string; centerOn: string | null }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void fitView(
        centerOn === null
          ? { duration: 0 }
          : { duration: 0, nodes: [{ id: centerOn }], maxZoom: 1, padding: 0.4 },
      );
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [fitView, layoutId, centerOn]);
  return null;
}

/**
 * The canvas shell shared by the table map and the overview: lays the graph out with ELK off the
 * main thread (cached per view), draws only nodes the layout has placed and only elements inside
 * the viewport, and maps clicks and Enter back to nodes.
 */
export function FlowCanvas<N extends Node, E extends Edge>({
  nodes,
  edges,
  layoutId,
  runLayout,
  nodeTypes,
  selectedIds,
  onActivate,
  centerOn = null,
  pendingText,
  emptyText,
}: FlowCanvasProps<N, E>) {
  const graph = useMemo(() => ({ nodes, edges }), [nodes, edges]);
  const { positions, status } = useLayout(graph, layoutId, runLayout);

  // While a new view lays out, the previous positions linger; only nodes they cover are drawn.
  const placed = useMemo<N[]>(() => {
    if (positions === null) {
      return [];
    }
    const shown: N[] = [];
    for (const node of nodes) {
      const position = positions.get(node.id);
      if (position !== undefined) {
        shown.push({ ...node, position, selected: selectedIds.has(node.id) });
      }
    }
    return shown;
  }, [nodes, positions, selectedIds]);
  const drawnEdges = useMemo<E[]>(() => {
    const drawn = new Set(placed.map((node) => node.id));
    return edges.filter((edge) => drawn.has(edge.source) && drawn.has(edge.target));
  }, [edges, placed]);

  useEffect(() => {
    if (status === "done") {
      mark(LAYOUT_DONE_MARK);
    }
  }, [status, layoutId]);

  // React Flow focuses the node wrapper, so Enter is caught here and mapped back to its node.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const target = event.target;
    if (
      event.key !== "Enter" ||
      onActivate === undefined ||
      !(target instanceof HTMLElement) ||
      !target.classList.contains("react-flow__node")
    ) {
      return;
    }
    const node = nodes.find((candidate) => candidate.id === target.dataset.id);
    if (node !== undefined) {
      event.preventDefault();
      onActivate(node);
    }
  };

  return (
    <div className="sm-canvas" data-layout-status={status} onKeyDown={onKeyDown}>
      {status === "failed" ? (
        <p className="sm-notice" role="status">
          Automatic layout failed, so the map is shown in a grid.
        </p>
      ) : null}
      {nodes.length === 0 ? (
        <p className="sm-canvas__pending" role="status">
          {emptyText}
        </p>
      ) : positions === null ? (
        <p className="sm-canvas__pending" role="status">
          {pendingText}
        </p>
      ) : (
        <ReactFlow<N, E>
          nodes={placed}
          edges={drawnEdges}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={EDGE_OPTIONS}
          nodesConnectable={false}
          onNodeClick={(_event, node) => {
            onActivate?.(node);
          }}
          edgesFocusable={false}
          onlyRenderVisibleElements
          fitView
          minZoom={0.05}
          maxZoom={2}
        >
          <FitOnLayout layoutId={status === "pending" ? "pending" : layoutId} centerOn={centerOn} />
          <Background />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable ariaLabel="Map overview" />
        </ReactFlow>
      )}
    </div>
  );
}
