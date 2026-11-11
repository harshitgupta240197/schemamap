import type { Edge, Node } from "@xyflow/react";
import type { Cluster, Clustering } from "../view/clusters";
import type { Folding, SchemaGroup } from "../view/schemaGroups";

/** What a box on a schema's level opens: a cluster or a small group. */
export type BoxTarget = "cluster" | "group";

/** Data carried by a cluster or small-group box. Names are untrusted and must be rendered as text. */
export type ClusterNodeData = {
  readonly targetKind: BoxTarget;
  /** The cluster id or small-group id the box opens. */
  readonly targetId: string;
  readonly name: string;
  readonly schemaName: string;
  /** Palette slot of the schema (see schemaColors.ts). */
  readonly schemaColor: number;
  /** The most-connected table's name, or "<n> small groups"; what the node shows as its title. */
  readonly hubName: string;
  readonly tableCount: number;
  /** Clusters folded into a small-group box; 0 for a cluster. */
  readonly groupCount: number;
  readonly outgoing: number;
  readonly incoming: number;
};

/** One tile inside a schema container: a larger cluster, the small groups, or "+N more". */
export interface SchemaTile {
  readonly key: string;
  readonly kind: "cluster" | "group" | "more";
  readonly label: string;
  readonly tableCount: number;
}

/** Data carried by a schema container on the overview. Names are untrusted text. */
export type SchemaNodeData = {
  readonly schemaId: string;
  readonly schemaName: string;
  readonly schemaColor: number;
  readonly tableCount: number;
  readonly clusterCount: number;
  readonly tiles: readonly SchemaTile[];
  /** Grid columns for the tiles; the node's size follows from it. */
  readonly columns: number;
};

/** Data carried by an overview edge: how many foreign-key edges it stands for. */
export type ClusterEdgeData = { readonly count: number };

export type ClusterFlowNode = Node<ClusterNodeData, "cluster">;
export type SchemaFlowNode = Node<SchemaNodeData, "schema">;
export type BoxFlowNode = ClusterFlowNode | SchemaFlowNode;
export type ClusterFlowEdge = Edge<ClusterEdgeData>;

export interface BoxGraph<N extends BoxFlowNode> {
  readonly nodes: readonly N[];
  readonly edges: readonly ClusterFlowEdge[];
}

/** Fixed cluster box size, shared by the layout and the node CSS. */
export const CLUSTER_NODE_WIDTH = 260;
export const CLUSTER_NODE_HEIGHT = 110;
/** Full-size name sizes in flow px; must match `.sm-cluster__name` and `.sm-schema__name`. */
export const CLUSTER_NAME_PX = 17 * 1.2;
export const SCHEMA_NAME_PX = 20 * 1.4;

/** Schema container geometry, shared by the layout and the node CSS. */
export const SCHEMA_HEADER_HEIGHT = 96;
export const SCHEMA_TILE_WIDTH = 240;
export const SCHEMA_TILE_HEIGHT = 52;
export const SCHEMA_TILE_GAP = 8;
/** Padding around the tiles; the left side also clears the 6 px schema stripe. */
export const SCHEMA_PADDING = 16;
const SCHEMA_STRIPE = 6;
const SCHEMA_MIN_WIDTH = 300;
/** At most this many tiles in a container; past it the larger clusters give way to "+N more". */
export const SCHEMA_MAX_TILES = 12;

function count(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

/** Accessible name of a cluster or small-group box; also what the e2e tests click. */
export function clusterLabel(
  data: Pick<ClusterNodeData, "name" | "tableCount" | "groupCount" | "targetKind">,
): string {
  const tables = count(data.tableCount, "table", "tables");
  return data.targetKind === "group"
    ? `Open ${data.name}, ${tables} in ${count(data.groupCount, "group", "groups")}`
    : `Open cluster ${data.name}, ${tables}`;
}

/** Accessible name of a schema container; also what the e2e tests click. */
export function schemaLabel(data: Pick<SchemaNodeData, "schemaName" | "tableCount">): string {
  return `Open schema ${data.schemaName}, ${count(data.tableCount, "table", "tables")}`;
}

/** Tile columns for `tiles` tiles: a near-square grid, at most three wide. */
function columnsFor(tiles: number): number {
  return Math.max(1, Math.min(3, Math.ceil(Math.sqrt(tiles))));
}

/** Size of a schema container with `tiles` tiles in `columns` columns, in flow px. */
export function schemaNodeSize(
  tiles: number,
  columns: number,
): { readonly width: number; readonly height: number } {
  const rows = Math.max(1, Math.ceil(tiles / columns));
  const width = SCHEMA_STRIPE + 2 * SCHEMA_PADDING + columns * SCHEMA_TILE_WIDTH;
  return {
    width: Math.max(SCHEMA_MIN_WIDTH, width + (columns - 1) * SCHEMA_TILE_GAP),
    height:
      SCHEMA_HEADER_HEIGHT +
      rows * SCHEMA_TILE_HEIGHT +
      (rows - 1) * SCHEMA_TILE_GAP +
      2 * SCHEMA_PADDING,
  };
}

/**
 * A schema's tiles: its related clusters (largest first), then its small groups, then its
 * clusters of unrelated tables. Past `SCHEMA_MAX_TILES`, the smallest related clusters give way
 * to one "+N more" tile; small groups and unrelated tables always show.
 */
export function schemaTiles(schema: SchemaGroup): SchemaTile[] {
  const related = schema.tiles.filter((c) => !c.isolated);
  const isolated = schema.tiles.filter((c) => c.isolated);
  const fixed = schema.smallGroups.length + isolated.length;
  const room =
    related.length + fixed > SCHEMA_MAX_TILES ? SCHEMA_MAX_TILES - fixed - 1 : related.length;
  const shown = related.slice(0, Math.max(0, room));
  const hidden = related.slice(shown.length);
  const tile = (c: Cluster): SchemaTile => ({
    key: c.id,
    kind: "cluster",
    label: c.hubName,
    tableCount: c.tableIds.length,
  });
  const tiles = shown.map(tile);
  if (hidden.length > 0) {
    tiles.push({
      key: "more",
      kind: "more",
      label: `+${count(hidden.length, "cluster", "clusters")}`,
      tableCount: hidden.reduce((n, c) => n + c.tableIds.length, 0),
    });
  }
  for (const group of schema.smallGroups) {
    tiles.push({
      key: group.id,
      kind: "group",
      label: group.hubName,
      tableCount: group.tableIds.length,
    });
  }
  tiles.push(...isolated.map(tile));
  return tiles;
}

/**
 * The schema overview: one container per schema in the selected schemas (every schema when
 * `schemas` is empty), and one edge per pair of shown schemas joined by foreign keys, labelled
 * with the key count. Node and edge ids come from positions in the whole folding, so they stay
 * the same whatever the schema filter.
 */
export function buildSchemaOverviewGraph(
  folding: Folding,
  clustering: Clustering,
  schemas: readonly string[],
): BoxGraph<SchemaFlowNode> {
  const selected = new Set(schemas);
  const nodeIdOf = new Map<string, string>();
  const nodes: SchemaFlowNode[] = [];
  for (const [i, schema] of folding.schemas.entries()) {
    if (selected.size > 0 && !selected.has(schema.schemaId)) {
      continue;
    }
    const id = `s${String(i)}`;
    nodeIdOf.set(schema.schemaId, id);
    const tiles = schemaTiles(schema);
    const columns = columnsFor(tiles.length);
    const data: SchemaNodeData = {
      schemaId: schema.schemaId,
      schemaName: schema.schemaName,
      schemaColor: clustering.schemaColors.get(schema.schemaName) ?? 0,
      tableCount: schema.tableCount,
      clusterCount: schema.clusterCount,
      tiles,
      columns,
    };
    nodes.push({
      id,
      type: "schema",
      position: { x: 0, y: 0 },
      ...schemaNodeSize(tiles.length, columns),
      ariaLabel: schemaLabel(data),
      data,
    });
  }
  const edges: ClusterFlowEdge[] = [];
  for (const [i, edge] of folding.schemaEdges.entries()) {
    const source = nodeIdOf.get(edge.source);
    const target = nodeIdOf.get(edge.target);
    if (source !== undefined && target !== undefined) {
      // Straight: packed boxes sit side by side, where a curve would loop out of the box.
      edges.push({
        id: `se${String(i)}`,
        type: "straight",
        source,
        target,
        label: String(edge.count),
        data: { count: edge.count },
      });
    }
  }
  return { nodes, edges };
}

function boxNode(id: string, data: ClusterNodeData): ClusterFlowNode {
  return {
    id,
    type: "cluster",
    position: { x: 0, y: 0 },
    width: CLUSTER_NODE_WIDTH,
    height: CLUSTER_NODE_HEIGHT,
    ariaLabel: clusterLabel(data),
    data,
  };
}

/**
 * One schema's level: a box per cluster that is not folded and a box per small group, joined by
 * the foreign keys between them. Node ids come from positions in the whole clustering (`k`) and
 * folding (`g`), so they do not depend on which schema is shown.
 */
export function buildSchemaLevelGraph(
  folding: Folding,
  clustering: Clustering,
  schemaId: string,
): BoxGraph<ClusterFlowNode> {
  const schema = folding.schemaById.get(schemaId);
  if (schema === undefined) {
    return { nodes: [], edges: [] };
  }
  const color = clustering.schemaColors.get(schema.schemaName) ?? 0;
  const nodeIdOf = new Map<string, string>();
  const nodes: ClusterFlowNode[] = [];
  const tiles = new Set(schema.tiles.map((c) => c.id));
  for (const [i, cluster] of clustering.clusters.entries()) {
    if (!tiles.has(cluster.id)) {
      continue;
    }
    const id = `k${String(i)}`;
    nodeIdOf.set(cluster.id, id);
    nodes.push(
      boxNode(id, {
        targetKind: "cluster",
        targetId: cluster.id,
        name: cluster.name,
        schemaName: cluster.schemaName,
        schemaColor: color,
        hubName: cluster.hubName,
        tableCount: cluster.tableIds.length,
        groupCount: 0,
        outgoing: cluster.outgoing,
        incoming: cluster.incoming,
      }),
    );
  }
  const groupIndex = new Map([...folding.groups.keys()].map((id, i) => [id, i]));
  for (const group of schema.smallGroups) {
    const id = `g${String(groupIndex.get(group.id) ?? 0)}`;
    nodeIdOf.set(group.id, id);
    nodes.push(
      boxNode(id, {
        targetKind: "group",
        targetId: group.id,
        name: group.name,
        schemaName: group.schemaName,
        schemaColor: color,
        hubName: `${count(group.clusterIds.length, "small group", "small groups")}${group.part}`,
        tableCount: group.tableIds.length,
        groupCount: group.clusterIds.length,
        outgoing: group.outgoing,
        incoming: group.incoming,
      }),
    );
  }
  const edges: ClusterFlowEdge[] = [];
  for (const [i, edge] of folding.unitEdges.entries()) {
    const source = nodeIdOf.get(edge.source);
    const target = nodeIdOf.get(edge.target);
    if (source !== undefined && target !== undefined) {
      edges.push({
        id: `ke${String(i)}`,
        source,
        target,
        label: String(edge.count),
        data: { count: edge.count },
      });
    }
  }
  return { nodes, edges };
}

/**
 * Identity of a box graph for the layout cache. Prefixed `c:`; table views use `t:`. Node sizes
 * follow from their ids and data, so ids and edges are enough.
 */
export function overviewKey(graph: BoxGraph<BoxFlowNode>): string {
  const nodes = graph.nodes.map((node) =>
    node.type === "schema"
      ? `${node.data.schemaId}#${String(node.data.tiles.length)}`
      : node.data.targetId,
  );
  const edges = graph.edges.map((edge) => `${edge.source}>${edge.target}`);
  return `c:${nodes.join("\u0001")}\u0002${edges.join("\u0001")}`;
}
