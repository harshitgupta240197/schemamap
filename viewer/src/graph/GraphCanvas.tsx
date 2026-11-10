import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type DefaultEdgeOptions,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./graph.css";
import { useMemo } from "react";
import type { SnapshotIndexes } from "../snapshot/indexes";
import { buildGraph, type FkFlowEdge, type TableFlowNode } from "./build";
import { runElkLayout } from "./elkClient";
import { ToggleExpandedContext, useExpanded } from "./expanded";
import type { LayoutRunner } from "./layout";
import { TableNode } from "./TableNode";
import { useLayout } from "./useLayout";

const NODE_TYPES: NodeTypes = { table: TableNode };
const EDGE_OPTIONS: DefaultEdgeOptions = {
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
  focusable: false,
};

interface GraphCanvasProps {
  readonly indexes: SnapshotIndexes;
  /** Injectable for tests; defaults to the ELK Web Worker. */
  readonly runLayout?: LayoutRunner;
}

/** The map: every table and declared FK, laid out by ELK off the main thread. */
export function GraphCanvas({ indexes, runLayout = runElkLayout }: GraphCanvasProps) {
  const [expanded, toggle] = useExpanded();
  const graph = useMemo(() => buildGraph(indexes, expanded), [indexes, expanded]);
  const { positions, status } = useLayout(graph, runLayout);

  const nodes = useMemo<TableFlowNode[]>(
    () =>
      positions === null
        ? []
        : graph.nodes.map((node) => ({
            ...node,
            position: positions.get(node.id) ?? node.position,
          })),
    [graph, positions],
  );
  const edges = useMemo<FkFlowEdge[]>(() => [...graph.edges], [graph]);

  return (
    <div className="sm-canvas" data-layout-status={status}>
      {status === "failed" ? (
        <p className="sm-notice" role="status">
          Automatic layout failed, so tables are shown in a grid.
        </p>
      ) : null}
      {positions === null ? (
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
            <Background />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable ariaLabel="Map overview" />
          </ReactFlow>
        </ToggleExpandedContext.Provider>
      )}
    </div>
  );
}
