import type { NodeTypes } from "@xyflow/react";
import { useMemo } from "react";
import type { Clustering } from "../view/clusters";
import { ClusterNode } from "./ClusterNode";
import { runElkLayout } from "./elkClient";
import { FlowCanvas } from "./FlowCanvas";
import type { LayoutRunner } from "./layout";
import {
  buildOverviewGraph,
  overviewKey,
  type ClusterFlowEdge,
  type ClusterFlowNode,
} from "./overview";

const NODE_TYPES: NodeTypes = { cluster: ClusterNode };
const NONE: ReadonlySet<string> = new Set();

interface OverviewCanvasProps {
  readonly clustering: Clustering;
  /** Schema ids to show; empty is every schema. */
  readonly schemas: readonly string[];
  /** Called with a cluster id when a cluster is clicked, or Enter is pressed on it. */
  readonly onDrill: (clusterId: string) => void;
  /** Injectable for tests; defaults to the ELK Web Worker. */
  readonly runLayout?: LayoutRunner;
}

/** The overview: one box per cluster, joined by foreign-key counts. A click drills in. */
export function OverviewCanvas({
  clustering,
  schemas,
  onDrill,
  runLayout = runElkLayout,
}: OverviewCanvasProps) {
  const graph = useMemo(() => buildOverviewGraph(clustering, schemas), [clustering, schemas]);
  const layoutId = useMemo(() => overviewKey(graph), [graph]);
  return (
    <FlowCanvas<ClusterFlowNode, ClusterFlowEdge>
      nodes={graph.nodes}
      edges={graph.edges}
      layoutId={layoutId}
      runLayout={runLayout}
      nodeTypes={NODE_TYPES}
      selectedIds={NONE}
      onActivate={(node) => {
        onDrill(node.data.clusterId);
      }}
      pendingText={`Laying out ${String(graph.nodes.length)} clusters…`}
      emptyText="No tables match this view."
    />
  );
}
