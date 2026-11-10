import { Handle, Position, type NodeProps } from "@xyflow/react";
import { memo, useContext } from "react";
import { sourceHandleId, targetHandleId, type ColumnRow, type TableFlowNode } from "./build";
import { ToggleExpandedContext } from "./expanded";

function columnCountLabel(count: number): string {
  return count === 1 ? "1 column" : `${String(count)} columns`;
}

function ColumnItem({ row }: { row: ColumnRow }) {
  return (
    <li className="sm-col">
      <Handle
        type="target"
        position={Position.Left}
        id={targetHandleId(row.index)}
        isConnectable={false}
      />
      <span className="sm-col__keys">
        {row.isPrimaryKey ? <abbr title="Primary key">PK</abbr> : null}
        {row.isForeignKey ? <abbr title="Foreign key">FK</abbr> : null}
      </span>
      <span className="sm-col__name" title={row.name}>
        {row.name}
      </span>
      <span className="sm-col__type">{row.dataType}</span>
      <Handle
        type="source"
        position={Position.Right}
        id={sourceHandleId(row.index)}
        isConnectable={false}
      />
    </li>
  );
}

/** A table on the map. Every name is rendered as React text, never as HTML. */
function TableNodeView({ data }: NodeProps<TableFlowNode>) {
  const toggle = useContext(ToggleExpandedContext);
  const qualified = `${data.schemaName}.${data.name}`;
  const canExpand = data.keyColumnCount < data.columnCount;
  return (
    <div className="sm-table">
      <div className="sm-table__header">
        <div className="sm-table__name" title={qualified}>
          {data.name}
        </div>
        <div className="sm-table__meta">
          <span className="sm-badge" title={data.schemaName}>
            {data.schemaName}
          </span>
          <span className="sm-table__count">{columnCountLabel(data.columnCount)}</span>
          {canExpand ? (
            <button
              type="button"
              className="sm-table__toggle nodrag"
              aria-expanded={data.expanded}
              aria-label={
                data.expanded
                  ? `Show key columns only for ${qualified}`
                  : `Show all columns of ${qualified}`
              }
              onClick={(event) => {
                event.stopPropagation();
                toggle(data.objectId);
              }}
            >
              {data.expanded ? "Less" : "All"}
            </button>
          ) : null}
        </div>
      </div>
      <ul className="sm-table__columns">
        {data.rows.map((row) => (
          <ColumnItem key={row.index} row={row} />
        ))}
      </ul>
    </div>
  );
}

export const TableNode = memo(TableNodeView);
