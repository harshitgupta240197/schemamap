import type { SnapshotIndexes } from "../snapshot/indexes";
import { LAYOUT_LIMIT } from "../graph/layout";
import type { Clustering } from "./clusters";
import { visibleTables } from "./focus";
import { makeViewState, type Hops, type ViewState } from "./viewState";

/** What the canvas shows: clusters, every table in view, one cluster's tables, or a focus. */
export type Level = "overview" | "map" | "cluster" | "focus";

/**
 * The level for a view. Focus wins, then a drilled cluster; otherwise the full map when the
 * tables in view (`rootCount`, after the schema filter) fit in one layout, else the overview.
 */
export function viewLevel(view: ViewState, rootCount: number, limit: number = LAYOUT_LIMIT): Level {
  if (view.focus.length > 0) {
    return "focus";
  }
  if (view.cluster !== null) {
    return "cluster";
  }
  return rootCount > limit ? "overview" : "map";
}

/** Number of tables in the selected schemas, or in the whole snapshot when none is selected. */
export function rootTableCount(indexes: SnapshotIndexes, schemas: readonly string[]): number {
  const tables = new Set<string>();
  const selected = new Set(schemas);
  for (const table of indexes.snapshot.tables ?? []) {
    if (selected.size === 0 || selected.has(table.schema_id)) {
      tables.add(table.id);
    }
  }
  return tables.size;
}

/** Into a cluster: no focus, same hops, schemas and selection. */
export function drillInto(view: ViewState, clusterId: string): ViewState {
  return makeViewState([], view.hops, view.schemas, view.selected, clusterId);
}

/** Focus one table, keeping the cluster so the breadcrumb can lead back to it. */
export function focusOn(view: ViewState, tableId: string): ViewState {
  return makeViewState([tableId], view.hops, view.schemas, view.selected, view.cluster);
}

/** Breadcrumb: back to the overview or full map, keeping the selection. */
export function backToRoot(view: ViewState): ViewState {
  return makeViewState([], view.hops, view.schemas, view.selected, null);
}

/** Breadcrumb: back from a focus to the cluster it was opened from. */
export function backToCluster(view: ViewState): ViewState {
  return makeViewState([], view.hops, view.schemas, view.selected, view.cluster);
}

/** A new schema filter; the drilled cluster may not be in it, so the view goes back to the root. */
export function withSchemas(view: ViewState, schemas: Iterable<string>): ViewState {
  return makeViewState(view.focus, view.hops, schemas, view.selected, null);
}

/**
 * Select an object for the detail panel. On the overview, or in a cluster that does not hold it,
 * a table is not on screen, so the view drills into the table's cluster. Elsewhere, and for views
 * and routines, only the selection changes.
 */
export function selectObject(
  view: ViewState,
  objectId: string,
  clustering: Clustering,
  level: Level,
): ViewState {
  const home = clustering.clusterOf.get(objectId);
  const offScreen = level === "overview" || (level === "cluster" && view.cluster !== home);
  if (home !== undefined && offScreen) {
    return makeViewState([], view.hops, view.schemas, objectId, home);
  }
  return makeViewState(view.focus, view.hops, view.schemas, objectId, view.cluster);
}

const HOP_CHOICES: readonly Hops[] = [3, 2];

/** The most hops (1 to 3) whose focus view stays within `limit` tables; 1 is always allowed. */
export function allowedHops(
  indexes: SnapshotIndexes,
  focus: readonly string[],
  schemas: readonly string[],
  limit: number = LAYOUT_LIMIT,
): Hops {
  for (const hops of HOP_CHOICES) {
    const shown = visibleTables(indexes, makeViewState(focus, hops, schemas));
    if (shown !== null && shown.size <= limit) {
      return hops;
    }
  }
  return 1;
}

/** The view with its hops lowered to what `allowedHops` offers; the same object if unchanged. */
export function clampHops(
  indexes: SnapshotIndexes,
  view: ViewState,
  limit: number = LAYOUT_LIMIT,
): ViewState {
  if (view.focus.length === 0 || view.hops === 1) {
    return view;
  }
  const most = allowedHops(indexes, view.focus, view.schemas, limit);
  return view.hops <= most
    ? view
    : makeViewState(view.focus, most, view.schemas, view.selected, view.cluster);
}
