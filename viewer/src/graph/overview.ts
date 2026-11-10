import type { Edge, Node } from "@xyflow/react";
import type { Clustering } from "../view/clusters";

/** Data carried by a cluster node. Names are untrusted and must be rendered as text. */
export type ClusterNodeData = {
  readonly clusterId: string;
  readonly name: string;
  readonly schemaName: string;
  readonly tableCount: number;
  readonly outgoing: number;
  readonly incoming: number;
};

/** Data carried by an overview edge: how many foreign-key edges it stands for. */
export type ClusterEdgeData = { readonly count: number };

export type ClusterFlowNode = Node<ClusterNodeData, "cluster">;
export type ClusterFlowEdge = Edge<ClusterEdgeData>;

export interface OverviewGraph {
  readonly nodes: readonly ClusterFlowNode[];
  readonly edges: readonly ClusterFlowEdge[];
}

/** Fixed cluster box size, shared by the layout and the node CSS. */
export const CLUSTER_NODE_WIDTH = 260;
export const CLUSTER_NODE_HEIGHT = 110;

function tablesLabel(count: number): string {
  return count === 1 ? "1 table" : `${String(count)} tables`;
}

/** Accessible name of a cluster node; also what the e2e tests click. */
export function clusterLabel(data: Pick<ClusterNodeData, "name" | "tableCount">): string {
  return `Open cluster ${data.name}, ${tablesLabel(data.tableCount)}`;
}

/**
 * The overview graph: one node per cluster in the selected schemas (every schema when `schemas`
 * is empty), and one edge per pair of shown clusters joined by foreign keys, labelled with the
 * key count. Node and edge ids come from positions in the whole clustering, so they stay the
 * same whatever the schema filter.
 */
export function buildOverviewGraph(
  clustering: Clustering,
  schemas: readonly string[],
): OverviewGraph {
  const selected = new Set(schemas);
  const nodeIdOf = new Map<string, string>();
  const nodes: ClusterFlowNode[] = [];
  for (const [i, cluster] of clustering.clusters.entries()) {
    if (selected.size > 0 && !selected.has(cluster.schemaId)) {
      continue;
    }
    const id = `k${String(i)}`;
    nodeIdOf.set(cluster.id, id);
    const data: ClusterNodeData = {
      clusterId: cluster.id,
      name: cluster.name,
      schemaName: cluster.schemaName,
      tableCount: cluster.tableIds.length,
      outgoing: cluster.outgoing,
      incoming: cluster.incoming,
    };
    nodes.push({
      id,
      type: "cluster",
      position: { x: 0, y: 0 },
      width: CLUSTER_NODE_WIDTH,
      height: CLUSTER_NODE_HEIGHT,
      ariaLabel: clusterLabel(data),
      data,
    });
  }
  const edges: ClusterFlowEdge[] = [];
  for (const [i, edge] of clustering.edges.entries()) {
    const source = nodeIdOf.get(edge.source);
    const target = nodeIdOf.get(edge.target);
    if (source === undefined || target === undefined) {
      continue;
    }
    edges.push({
      id: `ke${String(i)}`,
      source,
      target,
      label: String(edge.count),
      data: { count: edge.count },
    });
  }
  return { nodes, edges };
}

/** Identity of an overview for the layout cache. Prefixed `c:`; table views use `t:`. */
export function overviewKey(graph: OverviewGraph): string {
  const nodes = graph.nodes.map((node) => node.data.clusterId);
  const edges = graph.edges.map((edge) => `${edge.source}>${edge.target}`);
  return `c:${nodes.join("\u0001")}\u0002${edges.join("\u0001")}`;
}
