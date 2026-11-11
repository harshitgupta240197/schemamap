import { createContext } from "react";

/**
 * Semantic zoom: below this zoom, nodes show only their name (see D-048). At 0.6 the 11 px
 * badge and column text of a full node renders at about 6.6 px, which nobody can read, so the
 * detail is dropped before it turns to noise.
 */
export const COMPACT_BELOW_ZOOM = 0.6;

/** Whether nodes draw their compact form at this zoom. */
export function isCompact(zoom: number): boolean {
  return zoom < COMPACT_BELOW_ZOOM;
}

/** Average glyph width of a system UI font, as a multiple of its font size. */
export const AVERAGE_GLYPH = 0.7;

/** The smallest font size, on screen, that a compact label may use. */
export const MIN_LABEL_PX = 10;

/** Horizontal padding inside a node, in flow px, that a compact label cannot use. */
const LABEL_PADDING = 20;

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
 * How many characters of a compact label fit on one line of a node `width` flow px wide at
 * `zoom`, with text at the smallest readable size (10 px on screen).
 */
export function compactChars(zoom: number, width: number): number {
  const fontInFlowPx = MIN_LABEL_PX / zoom;
  return Math.max(1, Math.floor((width - LABEL_PADDING) / (fontInFlowPx * AVERAGE_GLYPH)));
}

/**
 * The font size, in flow px, at which `chars` characters just fill a node `width` px wide (less
 * padding). The compact form uses it as the size that keeps a label whole, within the readable
 * range.
 */
export function fitPx(chars: number, width: number): number {
  return Math.floor((width - LABEL_PADDING) / (Math.max(1, chars) * AVERAGE_GLYPH));
}

/** `fitPx` for a whole name on one line. */
export function nameFitPx(name: string, width: number): number {
  return fitPx(Array.from(name).length, width);
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
