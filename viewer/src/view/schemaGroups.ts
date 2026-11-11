import { LAYOUT_LIMIT } from "../graph/layout";
import type { Cluster, ClusterEdge, Clustering } from "./clusters";

/** Clusters of this many tables or fewer are folded into a schema's small groups. */
export const SMALL_CLUSTER_MAX = 3;

/** A schema's small clusters, folded into one box. Names are untrusted text. */
export interface SmallGroup {
  /** `group:` followed by the smallest table id in the group. */
  readonly id: string;
  readonly schemaId: string;
  readonly schemaName: string;
  /** "<schema> · small groups", with "(n of m)" when the schema needs more than one. */
  readonly name: string;
  /** "Small groups", with the same part suffix; what the overview tile shows. */
  readonly hubName: string;
  /** " (n of m)" when the schema needs more than one small group, else "". */
  readonly part: string;
  /** Folded cluster ids, in cluster order. */
  readonly clusterIds: readonly string[];
  /** Member table ids, sorted. */
  readonly tableIds: readonly string[];
  /** Distinct foreign-key edges leaving the group for another tile or group. */
  readonly outgoing: number;
  /** Distinct foreign-key edges arriving from another tile or group. */
  readonly incoming: number;
}

/** One schema on the overview: its counts, its larger clusters and its small groups. */
export interface SchemaGroup {
  readonly schemaId: string;
  readonly schemaName: string;
  readonly tableCount: number;
  readonly clusterCount: number;
  /** Clusters that are not folded, in cluster order. */
  readonly tiles: readonly Cluster[];
  readonly smallGroups: readonly SmallGroup[];
}

/** Foreign-key edges from one schema to another, counted once per edge id. */
export interface SchemaEdge {
  readonly source: string;
  readonly target: string;
  readonly count: number;
}

export interface Folding {
  /** In cluster order, so by schema name. */
  readonly schemas: readonly SchemaGroup[];
  readonly schemaById: ReadonlyMap<string, SchemaGroup>;
  readonly groups: ReadonlyMap<string, SmallGroup>;
  /** Small group id of every table in a small group. */
  readonly groupOf: ReadonlyMap<string, string>;
  /** The box each cluster is shown in: its own id, or its small group's id. */
  readonly unitOf: ReadonlyMap<string, string>;
  /** Ordered by source schema, then target schema. */
  readonly schemaEdges: readonly SchemaEdge[];
  /** Edges between boxes (tiles and small groups), ordered by source box, then target box. */
  readonly unitEdges: readonly ClusterEdge[];
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Pack clusters, in order and kept whole, into parts of at most `limit` tables. */
function pack(clusters: readonly Cluster[], limit: number): Cluster[][] {
  const parts: Cluster[][] = [];
  let current: Cluster[] = [];
  let size = 0;
  for (const cluster of clusters) {
    if (current.length > 0 && size + cluster.tableIds.length > limit) {
      parts.push(current);
      current = [];
      size = 0;
    }
    current.push(cluster);
    size += cluster.tableIds.length;
  }
  if (current.length > 0) {
    parts.push(current);
  }
  return parts;
}

/** Sum edges by (source, target) after mapping their ends; drops edges inside one box. */
function mergeEdges(
  edges: readonly ClusterEdge[],
  map: (clusterId: string) => string | undefined,
  rank: (id: string) => number,
): ClusterEdge[] {
  const merged = new Map<string, ClusterEdge>();
  for (const edge of edges) {
    const source = map(edge.source);
    const target = map(edge.target);
    if (source === undefined || target === undefined || source === target) {
      continue;
    }
    const key = `${source}\u0000${target}`;
    merged.set(key, { source, target, count: (merged.get(key)?.count ?? 0) + edge.count });
  }
  return [...merged.values()].sort(
    (a, b) =>
      rank(a.source) - rank(b.source) ||
      rank(a.target) - rank(b.target) ||
      compareText(a.source, b.source) ||
      compareText(a.target, b.target),
  );
}

/**
 * Fold a clustering for the schema overview. Every schema becomes one box. Inside it, clusters of
 * more than `SMALL_CLUSTER_MAX` tables stay as tiles, and when a schema has two or more smaller
 * clusters they are folded into "small groups", packed in cluster order into parts of at most
 * `limit` tables. Cluster ids are untouched. Pure and deterministic.
 */
export function foldSchemas(clustering: Clustering, limit: number = LAYOUT_LIMIT): Folding {
  const bySchema = new Map<string, Cluster[]>();
  for (const cluster of clustering.clusters) {
    const list = bySchema.get(cluster.schemaId);
    if (list === undefined) {
      bySchema.set(cluster.schemaId, [cluster]);
    } else {
      list.push(cluster);
    }
  }

  const unitOf = new Map<string, string>();
  const groupOf = new Map<string, string>();
  const drafts: { schema: Omit<SchemaGroup, "smallGroups">; parts: Cluster[][] }[] = [];
  for (const [schemaId, clusters] of bySchema) {
    const small = clusters.filter((c) => c.tableIds.length <= SMALL_CLUSTER_MAX);
    const folded = small.length >= 2 ? new Set(small) : new Set<Cluster>();
    const tiles = clusters.filter((c) => !folded.has(c));
    for (const tile of tiles) {
      unitOf.set(tile.id, tile.id);
    }
    const parts = pack(
      clusters.filter((c) => folded.has(c)),
      limit,
    );
    for (const part of parts) {
      const tableIds = part.flatMap((c) => c.tableIds).sort(compareText);
      const id = `group:${tableIds[0] ?? ""}`;
      for (const cluster of part) {
        unitOf.set(cluster.id, id);
      }
      for (const tableId of tableIds) {
        groupOf.set(tableId, id);
      }
    }
    const schemaName = clusters[0]?.schemaName ?? schemaId;
    drafts.push({
      schema: {
        schemaId,
        schemaName,
        tableCount: clusters.reduce((n, c) => n + c.tableIds.length, 0),
        clusterCount: clusters.length,
        tiles,
      },
      parts,
    });
  }

  const unitRank = new Map<string, number>();
  for (const cluster of clustering.clusters) {
    const unit = unitOf.get(cluster.id);
    if (unit !== undefined && !unitRank.has(unit)) {
      unitRank.set(unit, unitRank.size);
    }
  }
  const unitEdges = mergeEdges(
    clustering.edges,
    (id) => unitOf.get(id),
    (id) => unitRank.get(id) ?? 0,
  );
  const outgoing = new Map<string, number>();
  const incoming = new Map<string, number>();
  for (const edge of unitEdges) {
    outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + edge.count);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + edge.count);
  }

  const groups = new Map<string, SmallGroup>();
  const schemas: SchemaGroup[] = drafts.map(({ schema, parts }) => {
    const smallGroups = parts.map((part, i): SmallGroup => {
      const suffix = parts.length > 1 ? ` (${String(i + 1)} of ${String(parts.length)})` : "";
      const tableIds = part.flatMap((c) => c.tableIds).sort(compareText);
      const id = `group:${tableIds[0] ?? ""}`;
      const group: SmallGroup = {
        id,
        schemaId: schema.schemaId,
        schemaName: schema.schemaName,
        name: `${schema.schemaName} · small groups${suffix}`,
        hubName: `Small groups${suffix}`,
        part: suffix,
        clusterIds: part.map((c) => c.id),
        tableIds,
        outgoing: outgoing.get(id) ?? 0,
        incoming: incoming.get(id) ?? 0,
      };
      groups.set(id, group);
      return group;
    });
    return { ...schema, smallGroups };
  });

  const schemaOfCluster = (id: string): string | undefined => clustering.byId.get(id)?.schemaId;
  const schemaRank = new Map(schemas.map((s, i) => [s.schemaId, i]));
  const schemaEdges = mergeEdges(
    clustering.edges,
    schemaOfCluster,
    (id) => schemaRank.get(id) ?? 0,
  );

  return {
    schemas,
    schemaById: new Map(schemas.map((s) => [s.schemaId, s])),
    groups,
    groupOf,
    unitOf,
    schemaEdges,
    unitEdges,
  };
}
