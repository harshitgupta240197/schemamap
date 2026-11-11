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
const AVERAGE_GLYPH = 0.6;

/**
 * The font size, in flow px, at which `name` just fills a node `width` px wide (less padding).
 * The compact form uses it as the size that keeps a name whole, within the readable range.
 */
export function nameFitPx(name: string, width: number): number {
  const chars = Math.max(1, name.length);
  return Math.floor((width - 20) / (chars * AVERAGE_GLYPH));
}
