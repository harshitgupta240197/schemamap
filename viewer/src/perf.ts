/**
 * Performance marks for the e2e speed tests and browser devtools. Diagnostics only: they never
 * leave the page, and a browser without the User Timing API still works.
 */

/** Set each time a layout lands on screen. */
export const LAYOUT_DONE_MARK = "schemamap:layout-done";
/** Set when the search query changes. */
export const SEARCH_INPUT_MARK = "schemamap:search-input";
/** Measured from `SEARCH_INPUT_MARK` to the moment the results are on screen. */
export const SEARCH_MEASURE = "schemamap:search";

export function mark(name: string): void {
  try {
    performance.mark(name);
  } catch {
    // No User Timing API: nothing to record.
  }
}

/** Measure `name` from the latest `start` mark to now, then clear `start`; no-op if unset. */
export function measureFrom(name: string, start: string): void {
  try {
    if (performance.getEntriesByName(start, "mark").length > 0) {
      performance.measure(name, start);
      performance.clearMarks(start);
    }
  } catch {
    // No User Timing API: nothing to record.
  }
}
