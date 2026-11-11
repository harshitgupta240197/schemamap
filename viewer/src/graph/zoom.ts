import { createContext } from "react";

/**
 * Semantic zoom: below this zoom, nodes show only their name (see D-048). At 0.6 the 11 px
 * badge and column text of a full node renders at about 6.6 px, which nobody can read, so the
 * detail is dropped before it turns to noise.
 */
export const COMPACT_BELOW_ZOOM = 0.6;

/**
 * Views with at most this many tables (focus, a drilled cluster) never fit below the compact
 * zoom: the view keeps full nodes and pans instead (D-050).
 */
export const SMALL_VIEW_TABLES = 25;

/** Whether nodes draw their compact form at this zoom. */
export function isCompact(zoom: number): boolean {
  return zoom < COMPACT_BELOW_ZOOM;
}

/** The smallest font size, on screen, that a compact label may use. */
export const MIN_LABEL_PX = 10;

/**
 * Horizontal space inside a node, in flow px, that a compact label cannot use: the schema stripe,
 * the cluster's padding and its border.
 */
const LABEL_PADDING = 34;

/**
 * The zoom as nodes see it: floored to a step of 0.01 while compact, and 1 once the full form
 * shows. Nodes re-render only when this changes, not on every wheel tick.
 */
export function zoomBucket(zoom: number): number {
  return isCompact(zoom) ? Math.max(0.05, Math.floor(zoom * 100) / 100) : 1;
}

/** The zoom bucket the canvas is at; nodes read it to pick their compact label. */
export const ZoomBucketContext = createContext(1);

/**
 * How wide a line of a compact label may be, in em, in a node `width` flow px wide at `zoom`,
 * with text at the smallest readable size (10 px on screen).
 */
export function compactLimitEm(zoom: number, width: number): number {
  return ((width - LABEL_PADDING) * zoom) / MIN_LABEL_PX;
}

/**
 * The font size, in flow px, at which a line `em` wide just fills a node `width` px wide (less
 * padding). The compact form uses it as the size that keeps a label whole, within the readable
 * range.
 */
export function fitPx(em: number, width: number): number {
  return Math.floor((width - LABEL_PADDING) / Math.max(0.5, em));
}

/** Line height of a compact label, as a multiple of its font size. */
export const LABEL_LINE_HEIGHT = 1.1;

/** Vertical padding inside a compact node, in flow px, that a label cannot use. */
const LABEL_VERTICAL_PADDING = 6;

/**
 * How many lines of readable (10 px on screen) text fit in a node `height` flow px tall at the
 * zoom bucket. A node too short for two lines gets one, so no label is ever clipped.
 */
export function compactLineBudget(height: number, bucket: number): number {
  const lineHeight = (LABEL_LINE_HEIGHT * MIN_LABEL_PX) / bucket;
  return Math.max(0, Math.floor((height - LABEL_VERTICAL_PADDING) / lineHeight));
}

/** The largest font size, in flow px, at which `lines` lines fit in `height` flow px. */
export function heightFitPx(lines: number, height: number): number {
  return Math.floor((height - LABEL_VERTICAL_PADDING) / (LABEL_LINE_HEIGHT * Math.max(1, lines)));
}
