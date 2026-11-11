import { useContext, type CSSProperties } from "react";
import { compactLabel, longestLine } from "./labels";
import { measureEm } from "./measure";
import {
  compactLimitEm,
  compactLineBudget,
  fitPx,
  heightFitPx,
  isCompact,
  ZoomBucketContext,
} from "./zoom";

interface NodeLabelProps {
  readonly className: string;
  /** The name as it is in the snapshot: the title and the accessible name. */
  readonly name: string;
  /** Title text; defaults to the name. */
  readonly title?: string;
  /** Size of the node in flow px. */
  readonly width: number;
  readonly height: number;
  /** Lines of 10 px text the node shows above the name (a cluster's schema line). */
  readonly reservedLines?: number;
}

/**
 * A node's name. A full node shows it on one line, cut by CSS if it is very long. A compact
 * node shows up to two lines broken at word boundaries, as many as the node is tall enough
 * for, and sized so no line is clipped. The whole name is always in the title and, as hidden
 * text, in the accessible name. The name is React text, never HTML.
 */
export function NodeLabel({
  className,
  name,
  title,
  width,
  height,
  reservedLines = 0,
}: NodeLabelProps) {
  const bucket = useContext(ZoomBucketContext);
  if (!isCompact(bucket)) {
    return (
      <div className={className} title={title ?? name}>
        {name}
      </div>
    );
  }
  const room = Math.max(1, Math.min(2, compactLineBudget(height, bucket) - reservedLines));
  const lines = compactLabel(name, compactLimitEm(bucket, width), room, measureEm);
  const reserved = (reservedLines * 10) / bucket;
  const fit = Math.min(
    fitPx(longestLine(lines, measureEm), width),
    heightFitPx(lines.length, height - reserved),
  );
  const style = { "--sm-name-fit": `${String(fit)}px` };
  return (
    <div className={className} title={title ?? name} style={style as CSSProperties}>
      <span aria-hidden="true" data-label-lines={lines.length}>
        {lines.map((line, i) => (
          <span key={String(i)} className="sm-label__line">
            {line}
          </span>
        ))}
      </span>
      <span className="sm-visually-hidden">{name}</span>
    </div>
  );
}
