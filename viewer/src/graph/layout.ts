import type { ElkNode } from "elkjs/lib/elk-api.js";
import type { Graph } from "./build";

/** Top-left position of each node, by React Flow node id. */
export type Positions = ReadonlyMap<string, { readonly x: number; readonly y: number }>;

/** Runs an ELK layout and resolves with the laid-out graph. */
export type LayoutRunner = (graph: ElkNode) => Promise<ElkNode>;

const LAYOUT_OPTIONS: Readonly<Record<string, string>> = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.spacing.nodeNode": "40",
  "elk.layered.spacing.nodeNodeBetweenLayers": "90",
  "elk.spacing.componentComponent": "60",
  "elk.separateConnectedComponents": "true",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  "elk.randomSeed": "1",
};

/** The ELK input for a graph: fixed node sizes, nodes and edges in their (stable) graph order. */
export function toElkGraph(graph: Graph): ElkNode {
  return {
    id: "root",
    layoutOptions: { ...LAYOUT_OPTIONS },
    children: graph.nodes.map((node) => ({
      id: node.id,
      width: node.width ?? 0,
      height: node.height ?? 0,
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  };
}

/** Identity of a view for the layout cache: which tables, their sizes, and which edges. */
export function layoutKey(graph: Graph): string {
  const nodes = graph.nodes.map(
    (node) => `${node.data.objectId}\u0000${String(node.width)}x${String(node.height)}`,
  );
  const edges = graph.edges.map((edge) => edge.data?.edgeId ?? edge.id);
  return `${nodes.join("\u0001")}\u0002${edges.join("\u0001")}`;
}

/** Read positions out of a laid-out ELK graph. */
export function positionsFrom(laidOut: ElkNode): Positions {
  const positions = new Map<string, { x: number; y: number }>();
  for (const child of laidOut.children ?? []) {
    positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
  }
  return positions;
}

const GRID_GAP = 40;

/** Fallback when the layout worker fails: a plain grid in graph order, so the map still shows. */
export function gridPositions(graph: Graph): Positions {
  const perRow = Math.max(1, Math.ceil(Math.sqrt(graph.nodes.length)));
  const positions = new Map<string, { x: number; y: number }>();
  let y = 0;
  for (let start = 0; start < graph.nodes.length; start += perRow) {
    const row = graph.nodes.slice(start, start + perRow);
    let x = 0;
    let rowHeight = 0;
    for (const node of row) {
      positions.set(node.id, { x, y });
      x += (node.width ?? 0) + GRID_GAP;
      rowHeight = Math.max(rowHeight, node.height ?? 0);
    }
    y += rowHeight + GRID_GAP;
  }
  return positions;
}

/** Positions of views laid out this session, by `layoutKey`. */
export const layoutCache = new Map<string, Positions>();
