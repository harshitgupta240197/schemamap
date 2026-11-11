import type { Edge, Node } from "@xyflow/react";
import type { Column1, Relationship, Table } from "../generated/snapshot";
import type { SnapshotIndexes } from "../snapshot/indexes";
import { schemaColorsOf } from "../snapshot/schemaColors";
import { SMALL_VIEW_TABLES } from "./zoom";

/** One visible column row of a table node. `index` is the column's position by ordinal. */
export type ColumnRow = {
  readonly index: number;
  readonly name: string;
  readonly dataType: string;
  readonly isPrimaryKey: boolean;
  readonly isForeignKey: boolean;
};

/** Data carried by a table node. Names are untrusted and must be rendered as text. */
export type TableNodeData = {
  readonly objectId: string;
  readonly name: string;
  readonly schemaName: string;
  /** Palette slot of the schema (see schemaColors.ts). */
  readonly schemaColor: number;
  readonly columnCount: number;
  readonly keyColumnCount: number;
  readonly expanded: boolean;
  readonly rows: readonly ColumnRow[];
  /** Laid-out height of the node in flow px. */
  readonly height: number;
};

/** Data carried by an FK edge: every declared foreign key that shares this column mapping. */
export type FkEdgeData = {
  readonly edgeId: string;
  readonly foreignKeyIds: readonly string[];
  readonly foreignKeyNames: readonly string[];
};

export type TableFlowNode = Node<TableNodeData, "table">;
export type FkFlowEdge = Edge<FkEdgeData>;

export interface Graph {
  readonly nodes: readonly TableFlowNode[];
  readonly edges: readonly FkFlowEdge[];
}

/** Fixed geometry shared by the layout and the node CSS, so laid-out sizes are exact. */
export const NODE_WIDTH = 300;
export const NODE_HEADER_HEIGHT = 60;
export const NODE_ROW_HEIGHT = 24;
/** Column list padding (4 + 4) plus the 1px top and bottom border. */
export const NODE_PADDING = 10;

/** Tall enough for a two-line compact label at the zoom a typical map opens at. */
export const NODE_MIN_HEIGHT = 140;

/**
 * Size of a node with `rowCount` visible column rows. The compact two-line label needs
 * `NODE_MIN_HEIGHT`; a view small enough to stay above the compact zoom (`smallView`, D-050)
 * never shows it at fit view, so its nodes follow their content.
 */
export function nodeSize(rowCount: number, smallView = false): { width: number; height: number } {
  const content = NODE_HEADER_HEIGHT + rowCount * NODE_ROW_HEIGHT + NODE_PADDING;
  return {
    width: NODE_WIDTH,
    height: smallView ? content : Math.max(NODE_MIN_HEIGHT, content),
  };
}

/** Handle ids use the column's index, never its name, so untrusted text stays out of the DOM. */
export function sourceHandleId(columnIndex: number): string {
  return `c${String(columnIndex)}-s`;
}

export function targetHandleId(columnIndex: number): string {
  return `c${String(columnIndex)}-t`;
}

function byId<T extends { id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function orderedColumns(table: Table): Column1[] {
  return [...table.columns].sort((a, b) => a.ordinal - b.ordinal || byId(a, b));
}

/**
 * Build the React Flow graph for every table in the snapshot.
 *
 * Nodes are tables in id order; collapsed nodes show only key columns (primary key, outgoing FK
 * columns and columns referenced by incoming FKs), so every edge endpoint is always visible.
 * Edges are declared FKs grouped by their edge id: FKs with identical columns share one edge.
 * `visible` limits the view to those table ids (`null` is every table). Node ids come from the
 * table's position among all tables, so they stay the same from one view to the next, and FK
 * badges stay true even when the other end of a key is hidden.
 */
export function buildGraph(
  indexes: SnapshotIndexes,
  expanded: ReadonlySet<string>,
  visible: ReadonlySet<string> | null = null,
): Graph {
  // Duplicate ids are reported by the indexes; like them, the graph keeps the first occurrence.
  const seen = new Set<string>();
  const tables = [...(indexes.snapshot.tables ?? [])].sort(byId).filter((table) => {
    const fresh = !seen.has(table.id);
    seen.add(table.id);
    return fresh;
  });
  const relationships = [...(indexes.snapshot.relationships ?? [])].sort(byId);
  const schemaColors = schemaColorsOf(indexes);

  const nodeIdByObject = new Map<string, string>();
  const isShown = (objectId: string): boolean => visible === null || visible.has(objectId);
  const columnIndex = new Map<string, number>();
  const tableColumns = new Map<string, Column1[]>();
  for (const [i, table] of tables.entries()) {
    nodeIdByObject.set(table.id, `t${String(i)}`);
    const columns = orderedColumns(table);
    tableColumns.set(table.id, columns);
    for (const [index, column] of columns.entries()) {
      columnIndex.set(column.id, index);
    }
  }

  const fkColumns = new Set<string>();
  const referencedColumns = new Set<string>();
  const groups = new Map<string, Relationship[]>();
  for (const relationship of relationships) {
    if (
      !nodeIdByObject.has(relationship.from_object) ||
      !nodeIdByObject.has(relationship.to_object)
    ) {
      continue;
    }
    relationship.from_columns.forEach((id) => fkColumns.add(id));
    relationship.to_columns.forEach((id) => referencedColumns.add(id));
    if (!isShown(relationship.from_object) || !isShown(relationship.to_object)) {
      continue;
    }
    const group = groups.get(relationship.edge);
    if (group === undefined) {
      groups.set(relationship.edge, [relationship]);
    } else {
      group.push(relationship);
    }
  }

  const smallView = tables.filter((table) => isShown(table.id)).length <= SMALL_VIEW_TABLES;
  const nodes: TableFlowNode[] = [];
  for (const table of tables) {
    const nodeId = nodeIdByObject.get(table.id);
    const columns = tableColumns.get(table.id);
    if (nodeId === undefined || columns === undefined || !isShown(table.id)) {
      continue;
    }
    const primaryKey = new Set(
      (table.key_constraints ?? [])
        .filter((k) => k.kind === "primary_key")
        .flatMap((k) => k.columns),
    );
    const allRows: ColumnRow[] = columns.map((column, index) => ({
      index,
      name: column.name,
      dataType: column.data_type,
      isPrimaryKey: primaryKey.has(column.id),
      isForeignKey: fkColumns.has(column.id),
    }));
    const keyRows = allRows.filter((row, i) => {
      const id = columns[i]?.id ?? "";
      return row.isPrimaryKey || row.isForeignKey || referencedColumns.has(id);
    });
    const isExpanded = expanded.has(table.id);
    const rows = isExpanded ? allRows : keyRows;
    const size = nodeSize(rows.length, smallView);
    const entity = indexes.byId(table.id);
    const schemaName = entity?.kind === "table" ? entity.schemaName : "";
    nodes.push({
      id: nodeId,
      type: "table",
      position: { x: 0, y: 0 },
      width: size.width,
      height: size.height,
      data: {
        objectId: table.id,
        name: table.name,
        schemaName,
        schemaColor: schemaColors.get(schemaName) ?? 0,
        columnCount: columns.length,
        keyColumnCount: keyRows.length,
        expanded: isExpanded,
        rows,
        height: size.height,
      },
    });
  }

  const edges: FkFlowEdge[] = [];
  const edgeIds = [...groups.keys()].sort();
  for (const [i, edgeId] of edgeIds.entries()) {
    const group = groups.get(edgeId) ?? [];
    const first = group[0];
    if (first === undefined) {
      continue;
    }
    const source = nodeIdByObject.get(first.from_object);
    const target = nodeIdByObject.get(first.to_object);
    const fromIndex = columnIndex.get(first.from_columns[0]);
    const toIndex = columnIndex.get(first.to_columns[0]);
    if (source === undefined || target === undefined) {
      continue;
    }
    edges.push({
      id: `e${String(i)}`,
      source,
      target,
      ...(fromIndex === undefined ? {} : { sourceHandle: sourceHandleId(fromIndex) }),
      ...(toIndex === undefined ? {} : { targetHandle: targetHandleId(toIndex) }),
      data: {
        edgeId,
        foreignKeyIds: group.map((r) => r.id),
        foreignKeyNames: group.map((r) => r.name),
      },
    });
  }

  return { nodes, edges };
}
