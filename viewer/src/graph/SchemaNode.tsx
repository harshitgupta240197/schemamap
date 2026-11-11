import { Handle, Position, type NodeProps } from "@xyflow/react";
import { memo, useContext, type CSSProperties } from "react";
import { NodeLabel } from "./NodeLabel";
import {
  SCHEMA_HEADER_HEIGHT,
  SCHEMA_TILE_GAP,
  SCHEMA_TILE_HEIGHT,
  SCHEMA_TILE_WIDTH,
  schemaNodeSize,
  type SchemaFlowNode,
} from "./overview";
import { compactLineBudget, isCompact, ZoomBucketContext } from "./zoom";

function count(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

/**
 * A schema on the overview: its name and table count, and a grid of tiles for its larger
 * clusters and its small groups. Only the container is interactive; the tiles show the schema's
 * shape and are hidden from assistive technology, which hears the container's label. Every name
 * is rendered as React text, never as HTML.
 */
function SchemaNodeView({ data }: NodeProps<SchemaFlowNode>) {
  const bucket = useContext(ZoomBucketContext);
  const compact = isCompact(bucket);
  const { width } = schemaNodeSize(data.tiles.length, data.columns);
  // A compact container shows its count under the name when the header is tall enough for both.
  const showCount = !compact || compactLineBudget(SCHEMA_HEADER_HEIGHT, bucket) >= 2;
  // Tile names show while a readable line fits in a tile; below that, only the counts.
  const tileNames = !compact || compactLineBudget(SCHEMA_TILE_HEIGHT, bucket) >= 1;
  const style = {
    "--sm-schema": `var(--sm-schema-${String(data.schemaColor)})`,
    "--sm-schemabox-columns": String(data.columns),
    "--sm-schemabox-tile-width": `${String(SCHEMA_TILE_WIDTH)}px`,
    "--sm-schemabox-tile-height": `${String(SCHEMA_TILE_HEIGHT)}px`,
    "--sm-schemabox-tile-gap": `${String(SCHEMA_TILE_GAP)}px`,
    "--sm-schemabox-header": `${String(SCHEMA_HEADER_HEIGHT)}px`,
  } as CSSProperties;
  return (
    <div className="sm-schema" style={style}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="sm-schema__header">
        <NodeLabel
          className="sm-schema__name"
          name={data.schemaName}
          width={width}
          height={SCHEMA_HEADER_HEIGHT}
          reservedLines={compact && showCount ? 1 : 0}
        />
        {showCount ? (
          <div className="sm-schema__count">
            {count(data.tableCount, "table", "tables")} ·{" "}
            {count(data.clusterCount, "cluster", "clusters")}
          </div>
        ) : null}
      </div>
      <div className="sm-schema__tiles" aria-hidden="true">
        {data.tiles.map((tile) => (
          <div key={tile.key} className="sm-schema__tile" data-kind={tile.kind}>
            {tileNames ? <span className="sm-schema__tile-name">{tile.label}</span> : null}
            <span className="sm-schema__tile-count">{tile.tableCount}</span>
          </div>
        ))}
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

export const SchemaNode = memo(SchemaNodeView);
