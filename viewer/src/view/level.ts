import type { SnapshotIndexes } from "../snapshot/indexes";
import { LAYOUT_LIMIT } from "../graph/layout";
import type { Clustering } from "./clusters";
import { visibleTables } from "./focus";
import type { Folding } from "./schemaGroups";
import { makeViewState, type Hops, type ViewState } from "./viewState";

/**
 * What the canvas shows: one box per schema (`overview`), one schema's clusters and small groups
 * (`schema`), a table map (`map`: every table in view, or a drilled schema that fits one
 * layout), one cluster's or small group's tables (`cluster`), or a focus.
 */
export type Level = "overview" | "schema" | "map" | "cluster" | "focus";

/** The table counts a level is chosen by. */
export interface LevelSizes {
  /** Tables in view at the root, after the schema filter. */
  readonly root: number;
  /** Schemas that have tables in view at the root. */
  readonly rootSchemas: number;
  /** Tables in the drilled schema; 0 when no schema is drilled into. */
  readonly drill: number;
}

/**
 * The level for a view. Focus wins, then a drilled cluster or small group, then a drilled schema
 * (its table map when it fits one layout, else its boxes). At the root: the full map when the
 * tables in view fit one layout; otherwise the schema overview, or, when only one schema is in
 * view, that schema's boxes.
 */
export function viewLevel(view: ViewState, sizes: LevelSizes, limit: number = LAYOUT_LIMIT): Level {
  if (view.focus.length > 0) {
    return "focus";
  }
  if (view.cluster !== null || view.group !== null) {
    return "cluster";
  }
  if (view.drill !== null) {
    return sizes.drill > limit ? "schema" : "map";
  }
  if (sizes.root <= limit) {
    return "map";
  }
  return sizes.rootSchemas > 1 ? "overview" : "schema";
}

/** Distinct table ids in the selected schemas, or in the whole snapshot when none is selected. */
function rootTables(indexes: SnapshotIndexes, schemas: readonly string[]): Map<string, string> {
  const tables = new Map<string, string>();
  const selected = new Set(schemas);
  for (const table of indexes.snapshot.tables ?? []) {
    if (!tables.has(table.id) && (selected.size === 0 || selected.has(table.schema_id))) {
      tables.set(table.id, table.schema_id);
    }
  }
  return tables;
}

/** The sizes `viewLevel` needs for `view`. */
export function levelSizes(indexes: SnapshotIndexes, view: ViewState): LevelSizes {
  const root = rootTables(indexes, view.schemas);
  const drill = view.drill === null ? 0 : rootTables(indexes, [view.drill]).size;
  return { root: root.size, rootSchemas: new Set(root.values()).size, drill };
}

/** The level the breadcrumb's first crumb leads to: the view with no place and no focus. */
export function rootLevel(indexes: SnapshotIndexes, view: ViewState): Level {
  const root = backToRoot(view);
  return viewLevel(root, levelSizes(indexes, root));
}

/**
 * The schema a schema-level view is about: the drilled schema, else the only schema with tables
 * at the root, else `null`.
 */
export function levelSchema(indexes: SnapshotIndexes, view: ViewState): string | null {
  if (view.drill !== null) {
    return view.drill;
  }
  const schemas = new Set(rootTables(indexes, view.schemas).values());
  return schemas.size === 1 ? ([...schemas][0] ?? null) : null;
}

/** Into a cluster: no focus, same hops, schemas and selection. */
export function drillInto(view: ViewState, clusterId: string): ViewState {
  return makeViewState([], view.hops, view.schemas, view.selected, clusterId);
}

/** Into a small group: no focus, same hops, schemas and selection. */
export function drillGroup(view: ViewState, groupId: string): ViewState {
  return makeViewState([], view.hops, view.schemas, view.selected, null, null, groupId);
}

/** Into a schema from the schema overview: no focus, same hops, schemas and selection. */
export function drillSchema(view: ViewState, schemaId: string): ViewState {
  return makeViewState([], view.hops, view.schemas, view.selected, null, schemaId);
}

/** Focus one table, keeping the place so the breadcrumb can lead back to it. */
export function focusOn(view: ViewState, tableId: string): ViewState {
  return makeViewState(
    [tableId],
    view.hops,
    view.schemas,
    view.selected,
    view.cluster,
    view.drill,
    view.group,
  );
}

/** Breadcrumb: back to the overview or full map, keeping the selection. */
export function backToRoot(view: ViewState): ViewState {
  return makeViewState([], view.hops, view.schemas, view.selected);
}

/** Breadcrumb: back from a focus to the cluster, small group or schema it was opened from. */
export function backToCluster(view: ViewState): ViewState {
  return makeViewState(
    [],
    view.hops,
    view.schemas,
    view.selected,
    view.cluster,
    view.drill,
    view.group,
  );
}

/** Breadcrumb: back to a schema from one of its clusters or small groups (or a focus in them). */
export function backToSchema(view: ViewState, schemaId: string): ViewState {
  return drillSchema(view, schemaId);
}

/** A new schema filter; the place may not be in it, so the view goes back to the root. */
export function withSchemas(view: ViewState, schemas: Iterable<string>): ViewState {
  return makeViewState(view.focus, view.hops, schemas, view.selected);
}

/** What `selectObject` needs to find where a table lives. */
export interface Places {
  readonly clustering: Clustering;
  readonly folding: Folding;
  /** The level of the view with no place and no focus (see `rootLevel`). */
  readonly rootLevel: Level;
}

/**
 * The deepest view that shows a table: its schema's table map when the root is the schema
 * overview and the schema fits one layout, else its small group, else its cluster. `null` for
 * anything that is not a table.
 */
function homeOf(view: ViewState, tableId: string, places: Places, limit: number): ViewState | null {
  const clusterId = places.clustering.clusterOf.get(tableId);
  const schemaId =
    clusterId === undefined ? undefined : places.clustering.byId.get(clusterId)?.schemaId;
  if (clusterId === undefined || schemaId === undefined) {
    return null;
  }
  const { hops, schemas } = view;
  const selected = tableId;
  const schemaSize = places.folding.schemaById.get(schemaId)?.tableCount ?? 0;
  if (places.rootLevel === "overview" && schemaSize <= limit) {
    return makeViewState([], hops, schemas, selected, null, schemaId);
  }
  const groupId = places.folding.groupOf.get(tableId);
  if (groupId !== undefined) {
    return makeViewState([], hops, schemas, selected, null, null, groupId);
  }
  return makeViewState([], hops, schemas, selected, clusterId);
}

/** Whether `tableId` is among the tables a cluster, small group or schema-map view shows. */
function onScreen(view: ViewState, tableId: string, places: Places): boolean {
  const clusterId = places.clustering.clusterOf.get(tableId);
  if (view.cluster !== null) {
    return clusterId === view.cluster;
  }
  if (view.group !== null) {
    return places.folding.groupOf.get(tableId) === view.group;
  }
  if (view.drill !== null) {
    const schemaId =
      clusterId === undefined ? undefined : places.clustering.byId.get(clusterId)?.schemaId;
    return schemaId === view.drill;
  }
  return true;
}

/**
 * Select an object for the detail panel. On the schema overview or a schema's boxes, or in a
 * cluster, small group or schema map that does not hold it, a table is not on screen, so the view
 * moves to the deepest view that shows it (see `homeOf`). Elsewhere, and for views and routines,
 * only the selection changes.
 */
export function selectObject(
  view: ViewState,
  objectId: string,
  places: Places,
  level: Level,
  limit: number = LAYOUT_LIMIT,
): ViewState {
  const offScreen =
    level === "overview" ||
    level === "schema" ||
    ((level === "cluster" || level === "map") && !onScreen(view, objectId, places));
  const home = offScreen ? homeOf(view, objectId, places, limit) : null;
  if (home !== null) {
    return home;
  }
  return makeViewState(
    view.focus,
    view.hops,
    view.schemas,
    objectId,
    view.cluster,
    view.drill,
    view.group,
  );
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
    : makeViewState(
        view.focus,
        most,
        view.schemas,
        view.selected,
        view.cluster,
        view.drill,
        view.group,
      );
}
