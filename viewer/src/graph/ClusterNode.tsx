import { Handle, Position, type NodeProps } from "@xyflow/react";
import { memo, useContext, type CSSProperties } from "react";
import {
  CLUSTER_NAME_PX,
  CLUSTER_NODE_HEIGHT,
  CLUSTER_NODE_WIDTH,
  type ClusterFlowNode,
} from "./overview";
import { middleEllipsis } from "./labels";
import { measureEm } from "./measure";
import { NodeLabel } from "./NodeLabel";
import { compactLimitEm, compactLineBudget, isCompact, ZoomBucketContext } from "./zoom";

function count(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

/**
 * A cluster or small-group box on a schema's level. Every name is rendered as React text, never
 * as HTML.
 */
function ClusterNodeView({ data }: NodeProps<ClusterFlowNode>) {
  const bucket = useContext(ZoomBucketContext);
  const compact = isCompact(bucket);
  // A compact cluster shows its schema above the name when the box is tall enough for both.
  const showSchema = !compact || compactLineBudget(CLUSTER_NODE_HEIGHT, bucket) >= 2;
  const schema = compact
    ? middleEllipsis(data.schemaName, compactLimitEm(bucket, CLUSTER_NODE_WIDTH), measureEm)
    : data.schemaName;
  return (
    <div
      className="sm-cluster"
      style={{ "--sm-schema": `var(--sm-schema-${String(data.schemaColor)})` } as CSSProperties}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      {showSchema ? (
        <span className="sm-badge sm-cluster__schema" title={data.schemaName}>
          {schema}
        </span>
      ) : null}
      <NodeLabel
        className="sm-cluster__name"
        name={data.hubName}
        title={data.name}
        width={CLUSTER_NODE_WIDTH}
        height={CLUSTER_NODE_HEIGHT}
        reservedLines={compact && showSchema ? 1 : 0}
        fullPx={CLUSTER_NAME_PX}
      />
      <div className="sm-cluster__meta">
        <div className="sm-cluster__count">{count(data.tableCount, "table", "tables")}</div>
        <div className="sm-cluster__links" title="Foreign keys to and from other clusters">
          <span aria-hidden="true">↗ {data.outgoing}</span>
          <span aria-hidden="true">↙ {data.incoming}</span>
          <span className="sm-visually-hidden">
            {`${count(data.outgoing, "key", "keys")} to other clusters, ${count(data.incoming, "key", "keys")} from other clusters`}
          </span>
        </div>
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

export const ClusterNode = memo(ClusterNodeView);
