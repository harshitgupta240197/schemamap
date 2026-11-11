import type { NodeTypes } from "@xyflow/react";
import { useMemo } from "react";
import type { SnapshotIndexes } from "../snapshot/indexes";
import { buildGraph, type FkFlowEdge, type TableFlowNode } from "./build";
import { runElkLayout } from "./elkClient";
import { ToggleExpandedContext, useExpanded } from "./expanded";
import { FlowCanvas } from "./FlowCanvas";
import { layoutKey, type LayoutRunner } from "./layout";
import { TableNode } from "./TableNode";
import { SMALL_VIEW_TABLES } from "./zoom";

const NODE_TYPES: NodeTypes = { table: TableNode };

interface GraphCanvasProps {
  readonly indexes: SnapshotIndexes;
  /** Table ids to show; `null` is every table. */
  readonly visible?: ReadonlySet<string> | null;
  /** Table ids drawn as selected: the focused tables. */
  readonly highlighted?: ReadonlySet<string>;
  /** Called with a table id when a node is clicked, or Enter is pressed on a focused node. */
  readonly onOpen?: (objectId: string) => void;
  /** Table id to centre on once laid out, instead of fitting every table. */
  readonly centerOn?: string | null;
  /** Injectable for tests; defaults to the ELK Web Worker. */
  readonly runLayout?: LayoutRunner;
}

const NO_TABLES: ReadonlySet<string> = new Set();

/** The table map: the visible tables and their declared FKs, laid out by ELK off the main thread. */
export function GraphCanvas({
  indexes,
  visible = null,
  highlighted = NO_TABLES,
  onOpen,
  centerOn = null,
  runLayout = runElkLayout,
}: GraphCanvasProps) {
  const [expanded, toggle] = useExpanded();
  const graph = useMemo(() => buildGraph(indexes, expanded, visible), [indexes, expanded, visible]);
  const layoutId = useMemo(() => layoutKey(graph), [graph]);
  const selectedIds = useMemo(
    () =>
      new Set(
        graph.nodes.filter((node) => highlighted.has(node.data.objectId)).map((node) => node.id),
      ),
    [graph, highlighted],
  );
  const centerNode =
    centerOn === null
      ? null
      : (graph.nodes.find((node) => node.data.objectId === centerOn)?.id ?? null);

  return (
    <ToggleExpandedContext.Provider value={toggle}>
      <FlowCanvas<TableFlowNode, FkFlowEdge>
        nodes={graph.nodes}
        edges={graph.edges}
        layoutId={layoutId}
        runLayout={runLayout}
        nodeTypes={NODE_TYPES}
        selectedIds={selectedIds}
        onActivate={(node) => {
          onOpen?.(node.data.objectId);
        }}
        centerOn={centerNode}
        keepReadable={graph.nodes.length <= SMALL_VIEW_TABLES}
        pendingText={`Laying out ${String(graph.nodes.length)} tables…`}
        emptyText="No tables match this view."
      />
    </ToggleExpandedContext.Provider>
  );
}
