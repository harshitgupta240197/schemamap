import { Handle, Position, type NodeProps } from "@xyflow/react";
import { memo, type CSSProperties } from "react";
import { CLUSTER_NODE_WIDTH, type ClusterFlowNode } from "./overview";
import { nameFitPx } from "./zoom";

function count(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

/** A cluster on the overview. Every name is rendered as React text, never as HTML. */
function ClusterNodeView({ data }: NodeProps<ClusterFlowNode>) {
  return (
    <div className="sm-cluster">
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <span className="sm-badge" title={data.schemaName}>
        {data.schemaName}
      </span>
      <div
        className="sm-cluster__name"
        title={data.name}
        style={
          {
            "--sm-name-fit": `${String(nameFitPx(data.name, CLUSTER_NODE_WIDTH))}px`,
          } as CSSProperties
        }
      >
        {data.name}
      </div>
      <div className="sm-cluster__count">{count(data.tableCount, "table", "tables")}</div>
      <div
        className="sm-cluster__links"
        title="Foreign keys to and from other clusters"
        aria-label={`${count(data.outgoing, "key", "keys")} to other clusters, ${count(data.incoming, "key", "keys")} from other clusters`}
      >
        <span aria-hidden="true">↗ {data.outgoing}</span>
        <span aria-hidden="true">↙ {data.incoming}</span>
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

export const ClusterNode = memo(ClusterNodeView);
