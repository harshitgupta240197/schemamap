import type { NodeTypes } from "@xyflow/react";
import { useMemo } from "react";
import type { Clustering } from "../view/clusters";
import type { Folding } from "../view/schemaGroups";
import { ClusterNode } from "./ClusterNode";
import { runElkLayout } from "./elkClient";
import { FlowCanvas } from "./FlowCanvas";
import type { LayoutRunner } from "./layout";
import {
  buildSchemaLevelGraph,
  buildSchemaOverviewGraph,
  overviewKey,
  type BoxFlowNode,
  type BoxGraph,
  type ClusterFlowEdge,
} from "./overview";
import { runPackLayout } from "./pack";
import { SchemaNode } from "./SchemaNode";

const NODE_TYPES: NodeTypes = { cluster: ClusterNode, schema: SchemaNode };
const NONE: ReadonlySet<string> = new Set();

/** What a box opens when it is clicked, or Enter is pressed on it. */
export type DrillTarget = { readonly kind: "schema" | "cluster" | "group"; readonly id: string };

interface OverviewCanvasProps {
  readonly clustering: Clustering;
  readonly folding: Folding;
  /**
   * The schema whose clusters and small groups to show, or `null` for the schema overview of
   * `schemas` (every schema when empty).
   */
  readonly schema: string | null;
  readonly schemas: readonly string[];
  readonly onDrill: (target: DrillTarget) => void;
  /**
   * Injectable for tests. Defaults to row packing for the schema overview (its boxes are few, and
   * a layered layout strings connected schemas into one long row) and to the ELK Web Worker for a
   * schema's boxes.
   */
  readonly runLayout?: LayoutRunner;
}

/** Where a box leads. */
function drillTarget(node: BoxFlowNode): DrillTarget {
  return node.type === "schema"
    ? { kind: "schema", id: node.data.schemaId }
    : { kind: node.data.targetKind, id: node.data.targetId };
}

/**
 * The overview: one container per schema, or one schema's clusters and small groups, joined by
 * foreign-key counts. A click drills in.
 */
export function OverviewCanvas({
  clustering,
  folding,
  schema,
  schemas,
  onDrill,
  runLayout,
}: OverviewCanvasProps) {
  const graph = useMemo<BoxGraph<BoxFlowNode>>(
    () =>
      schema === null
        ? buildSchemaOverviewGraph(folding, clustering, schemas)
        : buildSchemaLevelGraph(folding, clustering, schema),
    [folding, clustering, schema, schemas],
  );
  const layoutId = useMemo(() => overviewKey(graph), [graph]);
  const noun = schema === null ? "schemas" : "groups";
  return (
    <FlowCanvas<BoxFlowNode, ClusterFlowEdge>
      nodes={graph.nodes}
      edges={graph.edges}
      layoutId={layoutId}
      runLayout={runLayout ?? (schema === null ? runPackLayout : runElkLayout)}
      nodeTypes={NODE_TYPES}
      selectedIds={NONE}
      onActivate={(node) => {
        onDrill(drillTarget(node));
      }}
      pendingText={`Laying out ${String(graph.nodes.length)} ${noun}…`}
      emptyText="No tables match this view."
    />
  );
}
