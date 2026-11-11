import type { SnapshotIndexes } from "../snapshot/indexes";
import { better, matchText, type Match } from "./match";

export type SearchKind = "table" | "view" | "column";

/** One thing the palette can find. Names are untrusted: render them as text only. */
export interface SearchItem {
  readonly id: string;
  readonly kind: SearchKind;
  /** The name shown first: a table, view or column name. */
  readonly name: string;
  /** The schema-qualified owner shown beside it: `dbo.Order`, or for a column its table. */
  readonly context: string;
  /** Id of the table or view to focus: the item itself, or a column's owner. */
  readonly targetId: string;
  /** Kind of `targetId`. */
  readonly targetKind: "table" | "view";
  readonly nameText: string;
  readonly nameLower: string;
  readonly qualifiedText: string;
  readonly qualifiedLower: string;
}

export interface SearchResult {
  readonly item: SearchItem;
  readonly match: Match;
}

export const MAX_RESULTS = 50;

const KIND_ORDER: Readonly<Record<SearchKind, number>> = { table: 0, view: 1, column: 2 };

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function make(
  id: string,
  kind: SearchKind,
  name: string,
  context: string,
  qualified: string,
  targetId: string,
  targetKind: "table" | "view",
): SearchItem {
  return {
    id,
    kind,
    name,
    context,
    targetId,
    targetKind,
    nameText: name,
    nameLower: name.toLowerCase(),
    qualifiedText: qualified,
    qualifiedLower: qualified.toLowerCase(),
  };
}

/** Every table, view and column of the snapshot as search items, in id order. */
export function buildSearchItems(indexes: SnapshotIndexes): SearchItem[] {
  const schemaNames = new Map((indexes.snapshot.schemas ?? []).map((s) => [s.id, s.name]));
  const schemaOf = (schemaId: string): string => schemaNames.get(schemaId) ?? "";
  const items: SearchItem[] = [];
  const seen = new Set<string>();
  const addOwner = (
    kind: "table" | "view",
    owner: {
      id: string;
      name: string;
      schema_id: string;
      columns: readonly { id: string; name: string }[];
    },
  ): void => {
    if (seen.has(owner.id)) {
      return;
    }
    seen.add(owner.id);
    const qualified = `${schemaOf(owner.schema_id)}.${owner.name}`;
    items.push(
      make(owner.id, kind, owner.name, schemaOf(owner.schema_id), qualified, owner.id, kind),
    );
    for (const column of owner.columns) {
      if (!seen.has(column.id)) {
        seen.add(column.id);
        items.push(
          make(
            column.id,
            "column",
            column.name,
            qualified,
            `${qualified}.${column.name}`,
            owner.id,
            kind,
          ),
        );
      }
    }
  };
  for (const table of indexes.snapshot.tables ?? []) {
    addOwner("table", table);
  }
  for (const view of indexes.snapshot.views ?? []) {
    addOwner("view", view);
  }
  return items.sort((a, b) => compareText(a.id, b.id));
}

/**
 * Items matching `query`, best first, at most `limit`. Order is by tier (exact, prefix, word
 * boundary, fuzzy), then closeness, then tables before views before columns, then id. Each item is
 * tried by its name and by its qualified `schema.name`, so `dbo.ord` finds `dbo.Orders`.
 * Case-variant names (`dbo.Order`, `dbo.order`) are separate items and both appear.
 */
export function searchItems(
  items: readonly SearchItem[],
  query: string,
  limit: number = MAX_RESULTS,
): SearchResult[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return [];
  }
  const results: SearchResult[] = [];
  for (const item of items) {
    const byName = matchText(item.nameText, item.nameLower, needle);
    const byQualified = matchText(item.qualifiedText, item.qualifiedLower, needle);
    const match = better(byName, byQualified);
    if (match !== null) {
      results.push({ item, match });
    }
  }
  results.sort(
    (a, b) =>
      a.match.tier - b.match.tier ||
      a.match.closeness - b.match.closeness ||
      KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind] ||
      compareText(a.item.id, b.item.id),
  );
  return results.slice(0, limit);
}
