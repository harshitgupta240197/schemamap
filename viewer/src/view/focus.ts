import type { SnapshotIndexes } from "../snapshot/indexes";
import type { SearchItem } from "../search/searchIndex";
import type { ViewState } from "./viewState";

/**
 * Tables within `hops` foreign-key steps of `roots`, following keys in both directions.
 * Self-references and cycles are fine: each table is visited once, at its shortest distance.
 * `allowed`, when given, limits which tables the walk may pass through; roots are always kept.
 */
export function expandHops(
  indexes: SnapshotIndexes,
  roots: readonly string[],
  hops: number,
  allowed: ReadonlySet<string> | null = null,
): Set<string> {
  const reached = new Set(roots.filter((id) => indexes.byId(id)?.kind === "table"));
  let frontier = [...reached];
  for (let step = 0; step < hops && frontier.length > 0; step += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      const neighbours = [
        ...indexes.outgoingRelationships(id).map((r) => r.to_object),
        ...indexes.incomingRelationships(id).map((r) => r.from_object),
      ];
      for (const other of neighbours) {
        if (
          !reached.has(other) &&
          indexes.byId(other)?.kind === "table" &&
          (allowed === null || allowed.has(other))
        ) {
          reached.add(other);
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  return reached;
}

/**
 * The tables a view reads, from its resolved dependencies. A view over another view reads through
 * it to that view's tables. Unresolved and cross-database targets are not tables and are skipped.
 */
export function tablesReferencedBy(indexes: SnapshotIndexes, viewId: string): string[] {
  const tables = new Set<string>();
  const seen = new Set<string>([viewId]);
  const pending = [viewId];
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    for (const dependency of indexes.outgoingDependencies(id)) {
      const target = dependency.target.resolved;
      if (target === null || target === undefined || seen.has(target)) {
        continue;
      }
      seen.add(target);
      const kind = indexes.byId(target)?.kind;
      if (kind === "table") {
        tables.add(target);
      } else if (kind === "view") {
        pending.push(target);
      }
    }
  }
  return [...tables].sort();
}

/** The tables to focus for a search result: the table itself, or what a view references. */
export function focusTargets(indexes: SnapshotIndexes, item: SearchItem): string[] {
  return item.targetKind === "table" ? [item.targetId] : tablesReferencedBy(indexes, item.targetId);
}

/** Table ids shown for a view state, or `null` for every table. */
export function visibleTables(indexes: SnapshotIndexes, state: ViewState): Set<string> | null {
  if (state.focus.length === 0 && state.schemas.length === 0) {
    return null;
  }
  const schemaIds = new Set(state.schemas);
  const inSchema = (id: string): boolean => {
    const entity = indexes.byId(id);
    return (
      entity?.kind === "table" && (schemaIds.size === 0 || schemaIds.has(entity.item.schema_id))
    );
  };
  if (state.focus.length === 0) {
    const shown = new Set<string>();
    for (const table of indexes.snapshot.tables ?? []) {
      if (inSchema(table.id)) {
        shown.add(table.id);
      }
    }
    return shown;
  }
  const allowed = new Set<string>();
  for (const table of indexes.snapshot.tables ?? []) {
    if (inSchema(table.id)) {
      allowed.add(table.id);
    }
  }
  return expandHops(indexes, state.focus, state.hops, allowed);
}
