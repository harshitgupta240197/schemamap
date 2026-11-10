import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type DefaultEdgeOptions,
  useReactFlow,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./graph.css";
import { useEffect, useMemo } from "react";
import type { SnapshotIndexes } from "../snapshot/indexes";
import { buildGraph, type FkFlowEdge, type TableFlowNode } from "./build";
import { runElkLayout } from "./elkClient";
import { ToggleExpandedContext, useExpanded } from "./expanded";
import { layoutKey, type LayoutRunner } from "./layout";
import { TableNode } from "./TableNode";
import { useLayout } from "./useLayout";

const NODE_TYPES: NodeTypes = { table: TableNode };
const EDGE_OPTIONS: DefaultEdgeOptions = {
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
  focusable: false,
};

interface GraphCanvasProps {
  readonly indexes: SnapshotIndexes;
  /** Table ids to show; `null` is every table. */
  readonly visible?: ReadonlySet<string> | null;
  /** Table ids drawn as selected: the focused tables. */
  readonly highlighted?: ReadonlySet<string>;
  /** Injectable for tests; defaults to the ELK Web Worker. */
  readonly runLayout?: LayoutRunner;
}

const NO_TABLES: ReadonlySet<string> = new Set();

/** Fits the view to the nodes each time a layout lands, so a new view is never off screen. */
function FitOnLayout({ layoutId }: { layoutId: string }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void fitView({ duration: 0 });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [fitView, layoutId]);
  return null;
}

/** The map: the visible tables and their declared FKs, laid out by ELK off the main thread. */
export function GraphCanvas({
  indexes,
  visible = null,
  highlighted = NO_TABLES,
  runLayout = runElkLayout,
}: GraphCanvasProps) {
  const [expanded, toggle] = useExpanded();
  const graph = useMemo(() => buildGraph(indexes, expanded, visible), [indexes, expanded, visible]);
  const { positions, status } = useLayout(graph, runLayout);
  const layoutId = useMemo(() => layoutKey(graph), [graph]);

  // While a new view lays out, the previous positions linger; only nodes they cover are drawn.
  const nodes = useMemo<TableFlowNode[]>(() => {
    if (positions === null) {
      return [];
    }
    const placed: TableFlowNode[] = [];
    for (const node of graph.nodes) {
      const position = positions.get(node.id);
      if (position !== undefined) {
        placed.push({ ...node, position, selected: highlighted.has(node.data.objectId) });
      }
    }
    return placed;
  }, [graph, positions, highlighted]);
  const edges = useMemo<FkFlowEdge[]>(() => {
    const drawn = new Set(nodes.map((node) => node.id));
    return graph.edges.filter((edge) => drawn.has(edge.source) && drawn.has(edge.target));
  }, [graph, nodes]);

  return (
    <div className="sm-canvas" data-layout-status={status}>
      {status === "failed" ? (
        <p className="sm-notice" role="status">
          Automatic layout failed, so tables are shown in a grid.
        </p>
      ) : null}
      {graph.nodes.length === 0 ? (
        <p className="sm-canvas__pending" role="status">
          No tables match this view.
        </p>
      ) : positions === null ? (
        <p className="sm-canvas__pending" role="status">
          Laying out {String(graph.nodes.length)} tables…
        </p>
      ) : (
        <ToggleExpandedContext.Provider value={toggle}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            defaultEdgeOptions={EDGE_OPTIONS}
            nodesConnectable={false}
            edgesFocusable={false}
            fitView
            minZoom={0.05}
            maxZoom={2}
          >
            <FitOnLayout layoutId={status === "pending" ? "pending" : layoutId} />
            <Background />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable ariaLabel="Map overview" />
          </ReactFlow>
        </ToggleExpandedContext.Provider>
      )}
    </div>
  );
}
