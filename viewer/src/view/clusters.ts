import type { Table } from "../generated/snapshot";
import { LAYOUT_LIMIT } from "../graph/layout";
import type { SnapshotIndexes } from "../snapshot/indexes";

/** A group of tables shown as one box in the overview. Names are untrusted text. */
export interface Cluster {
  /** `cluster:` followed by the smallest table id in the cluster. */
  readonly id: string;
  readonly schemaId: string;
  readonly schemaName: string;
  readonly name: string;
  /** Member table ids, sorted. */
  readonly tableIds: readonly string[];
  /** True for the tables of a schema that relate to no other table in that schema. */
  readonly isolated: boolean;
  /** Distinct foreign-key edges leaving the cluster for another cluster. */
  readonly outgoing: number;
  /** Distinct foreign-key edges arriving from another cluster. */
  readonly incoming: number;
}

/** Foreign-key edges from one cluster to another, counted once per edge id. */
export interface ClusterEdge {
  readonly source: string;
  readonly target: string;
  readonly count: number;
}

export interface Clustering {
  /** Ordered by schema name, related before isolated, larger first, then id. */
  readonly clusters: readonly Cluster[];
  readonly byId: ReadonlyMap<string, Cluster>;
  /** Cluster id of every table. */
  readonly clusterOf: ReadonlyMap<string, string>;
  /** Ordered by source cluster, then target cluster. */
  readonly edges: readonly ClusterEdge[];
}

interface Group {
  readonly schemaId: string;
  readonly schemaName: string;
  readonly tableIds: string[];
  readonly isolated: boolean;
  /** "(n of m)" for a chunk of unrelated tables split by the limit. */
  readonly part: string;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Tables in id order; the first of any duplicate id wins, as in the indexes. */
function uniqueTables(indexes: SnapshotIndexes): Table[] {
  const seen = new Set<string>();
  return [...(indexes.snapshot.tables ?? [])]
    .filter((table) => {
      const fresh = !seen.has(table.id);
      seen.add(table.id);
      return fresh;
    })
    .sort((a, b) => compareText(a.id, b.id));
}

/** Undirected neighbours of each table through keys to another table of the same schema. */
function schemaNeighbours(
  indexes: SnapshotIndexes,
  schemaOf: ReadonlyMap<string, string>,
): Map<string, string[]> {
  const sets = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    const set = sets.get(a);
    if (set === undefined) {
      sets.set(a, new Set([b]));
    } else {
      set.add(b);
    }
  };
  for (const relationship of indexes.snapshot.relationships ?? []) {
    const from = relationship.from_object;
    const to = relationship.to_object;
    const schema = schemaOf.get(from);
    if (from !== to && schema !== undefined && schema === schemaOf.get(to)) {
      link(from, to);
      link(to, from);
    }
  }
  const neighbours = new Map<string, string[]>();
  for (const [id, set] of sets) {
    neighbours.set(id, [...set].sort(compareText));
  }
  return neighbours;
}

/**
 * Split a connected component (`members`, sorted) into chunks of at most `limit` tables.
 *
 * A breadth-first spanning tree is rooted at the best-connected table (neighbours in id order).
 * Working up from the leaves, each table absorbs its children's subtrees, largest first, while
 * they fit; subtrees that do not fit are packed together into chunks of their own. Every chunk is
 * a subtree, or sibling subtrees that hang off one table, so a fan-out splits into a few large
 * chunks rather than many single tables.
 */
function splitComponent(
  members: readonly string[],
  neighbours: ReadonlyMap<string, readonly string[]>,
  limit: number,
): string[][] {
  const root = hubOf(members, neighbours);
  const order = [root];
  const children = new Map<string, string[]>();
  const seen = new Set(order);
  for (let head = 0; head < order.length; head += 1) {
    const id = order[head] ?? "";
    const kids: string[] = [];
    for (const other of neighbours.get(id) ?? []) {
      if (!seen.has(other)) {
        seen.add(other);
        kids.push(other);
        order.push(other);
      }
    }
    children.set(id, kids);
  }

  const chunks: string[][] = [];
  const pending = new Map<string, string[]>();
  // Reverse breadth-first order visits every child before its parent.
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const id = order[i] ?? "";
    const own = [id];
    const groups = (children.get(id) ?? [])
      .map((kid) => pending.get(kid) ?? [])
      .sort((a, b) => b.length - a.length || compareText(a[0] ?? "", b[0] ?? ""));
    let bin: string[] | null = null;
    for (const group of groups) {
      if (own.length + group.length <= limit) {
        own.push(...group);
      } else if (bin !== null && bin.length + group.length <= limit) {
        bin.push(...group);
      } else {
        bin = [...group];
        chunks.push(bin);
      }
    }
    for (const kid of children.get(id) ?? []) {
      pending.delete(kid);
    }
    pending.set(id, own);
  }
  chunks.push(pending.get(root) ?? []);
  return chunks.map((chunk) => chunk.sort(compareText));
}

/** Connected components of one schema's tables (sorted ids), each sorted. */
function components(
  ids: readonly string[],
  neighbours: ReadonlyMap<string, readonly string[]>,
): string[][] {
  const seen = new Set<string>();
  const found: string[][] = [];
  for (const start of ids) {
    if (seen.has(start)) {
      continue;
    }
    seen.add(start);
    const component = [start];
    for (let head = 0; head < component.length; head += 1) {
      for (const other of neighbours.get(component[head] ?? "") ?? []) {
        if (!seen.has(other)) {
          seen.add(other);
          component.push(other);
        }
      }
    }
    found.push(component.sort(compareText));
  }
  return found;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

/** The member with the most neighbours inside the group; ties go to the smallest id. */
function hubOf(
  tableIds: readonly string[],
  neighbours: ReadonlyMap<string, readonly string[]>,
): string {
  const members = new Set(tableIds);
  let best = tableIds[0] ?? "";
  let bestDegree = -1;
  for (const id of tableIds) {
    const degree = (neighbours.get(id) ?? []).filter((other) => members.has(other)).length;
    if (degree > bestDegree) {
      best = id;
      bestDegree = degree;
    }
  }
  return best;
}

function compareGroups(a: Group, b: Group): number {
  return (
    compareText(a.schemaName, b.schemaName) ||
    Number(a.isolated) - Number(b.isolated) ||
    b.tableIds.length - a.tableIds.length ||
    compareText(a.tableIds[0] ?? "", b.tableIds[0] ?? "")
  );
}

/**
 * Group the snapshot's tables for the overview: by schema, then by foreign-key-connected
 * component within the schema. Tables with no key to another table of their schema share one
 * cluster per schema. Anything larger than `limit` is split (see `splitComponent`). Pure and deterministic: the result
 * does not depend on the order of tables or relationships in the snapshot.
 */
export function clusterTables(indexes: SnapshotIndexes, limit: number = LAYOUT_LIMIT): Clustering {
  const tables = uniqueTables(indexes);
  const schemaOf = new Map(tables.map((table) => [table.id, table.schema_id]));
  const neighbours = schemaNeighbours(indexes, schemaOf);

  const bySchema = new Map<string, string[]>();
  for (const table of tables) {
    const ids = bySchema.get(table.schema_id);
    if (ids === undefined) {
      bySchema.set(table.schema_id, [table.id]);
    } else {
      ids.push(table.id);
    }
  }

  const groups: Group[] = [];
  for (const [schemaId, ids] of bySchema) {
    const entity = indexes.byId(ids[0] ?? "");
    const schemaName = entity?.kind === "table" ? entity.schemaName : schemaId;
    const isolated: string[] = [];
    for (const component of components(ids, neighbours)) {
      if (component.length === 1) {
        isolated.push(...component);
        continue;
      }
      const parts =
        component.length > limit ? splitComponent(component, neighbours, limit) : [component];
      for (const tableIds of parts) {
        groups.push({ schemaId, schemaName, tableIds, isolated: false, part: "" });
      }
    }
    const chunks = chunk(isolated.sort(compareText), limit);
    for (const [i, tableIds] of chunks.entries()) {
      const part = chunks.length > 1 ? ` (${String(i + 1)} of ${String(chunks.length)})` : "";
      groups.push({ schemaId, schemaName, tableIds, isolated: true, part });
    }
  }
  groups.sort(compareGroups);

  const perSchema = new Map<string, number>();
  for (const group of groups) {
    perSchema.set(group.schemaId, (perSchema.get(group.schemaId) ?? 0) + 1);
  }
  const clusterOf = new Map<string, string>();
  const named = groups.map((group) => {
    const id = `cluster:${group.tableIds[0] ?? ""}`;
    for (const tableId of group.tableIds) {
      clusterOf.set(tableId, id);
    }
    let name = group.schemaName;
    if ((perSchema.get(group.schemaId) ?? 0) > 1) {
      const hub = indexes.byId(hubOf(group.tableIds, neighbours));
      const label = group.isolated
        ? `no relationships${group.part}`
        : hub?.kind === "table"
          ? hub.item.name
          : "";
      name = `${group.schemaName} · ${label}`;
    }
    return { id, group, name };
  });

  // One count per distinct edge id, taken from its first relationship by id, as the graph does.
  const firstByEdge = new Map<string, { from: string; to: string }>();
  const relationships = [...(indexes.snapshot.relationships ?? [])].sort((a, b) =>
    compareText(a.id, b.id),
  );
  for (const relationship of relationships) {
    if (!firstByEdge.has(relationship.edge)) {
      firstByEdge.set(relationship.edge, {
        from: relationship.from_object,
        to: relationship.to_object,
      });
    }
  }
  const order = new Map(named.map((entry, i) => [entry.id, i]));
  const pairs = new Map<string, ClusterEdge>();
  const outgoing = new Map<string, number>();
  const incoming = new Map<string, number>();
  for (const { from, to } of firstByEdge.values()) {
    const source = clusterOf.get(from);
    const target = clusterOf.get(to);
    if (source === undefined || target === undefined || source === target) {
      continue;
    }
    const key = `${source}\u0000${target}`;
    pairs.set(key, { source, target, count: (pairs.get(key)?.count ?? 0) + 1 });
    outgoing.set(source, (outgoing.get(source) ?? 0) + 1);
    incoming.set(target, (incoming.get(target) ?? 0) + 1);
  }
  const rank = (id: string): number => order.get(id) ?? 0;
  const edges = [...pairs.values()].sort(
    (a, b) => rank(a.source) - rank(b.source) || rank(a.target) - rank(b.target),
  );

  const clusters: Cluster[] = named.map(({ id, group, name }) => ({
    id,
    schemaId: group.schemaId,
    schemaName: group.schemaName,
    name,
    tableIds: group.tableIds,
    isolated: group.isolated,
    outgoing: outgoing.get(id) ?? 0,
    incoming: incoming.get(id) ?? 0,
  }));
  return { clusters, byId: new Map(clusters.map((c) => [c.id, c])), clusterOf, edges };
}
