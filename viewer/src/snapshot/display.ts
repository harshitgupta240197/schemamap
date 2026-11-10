/**
 * The capture time for display. The schema does not assert the `date-time` format (D-044), so
 * the value can be any string; an unparseable one is shown as written, never "Invalid Date".
 */
export function formatCapturedAt(capturedAt: string): string {
  const parsed = new Date(capturedAt);
  if (Number.isNaN(parsed.getTime())) {
    return capturedAt;
  }
  return parsed
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "Z");
}
