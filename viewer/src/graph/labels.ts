/**
 * Where a name may break: after `_`, `.`, `-` or a space, before a capital that starts a word,
 * and between letters and digits.
 */
const BOUNDARY =
  /(?<=[_.\-\s])|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|(?<=[A-Za-z])(?=[0-9])/;

/** The size of a text against the limit it must fit: its length in characters, or its width. */
export type Measure = (text: string) => number;

/** The default measure: characters, counted as code points. */
export const countChars: Measure = (text) => Array.from(text).length;

/** The pieces of a name at its word boundaries (CamelCase, underscore, dot, dash, space). */
export function nameParts(name: string): string[] {
  return name.split(BOUNDARY).filter((part) => part !== "");
}

/**
 * `text` cut to fit `limit` by replacing its middle with an ellipsis, so both the start and the
 * end stay readable. Counts code points, so it never splits a surrogate pair. `measure` says how
 * big a text is; by default that is its number of characters.
 */
export function middleEllipsis(text: string, limit: number, measure: Measure = countChars): string {
  if (measure(text) <= limit) {
    return text;
  }
  const chars = Array.from(text);
  for (let keep = chars.length - 1; keep >= 1; keep--) {
    const head = Math.ceil(keep / 2);
    const tail = keep - head;
    const cut = `${chars.slice(0, head).join("")}…${tail === 0 ? "" : chars.slice(chars.length - tail).join("")}`;
    if (measure(cut) <= limit) {
      return cut;
    }
  }
  return "…";
}

/**
 * A name as one or two lines that each fit `limit`. A name that fits stays on one line, and
 * `maxLines` of 1 keeps it on one line whatever its length. Otherwise it breaks at the word
 * boundary that leaves the least text to cut, preferring balanced lines; a line that is still
 * too long, or a single long word, gets a middle ellipsis. The full name is for the title and
 * the accessible name, never this.
 */
export function compactLabel(
  name: string,
  limit: number,
  maxLines = 2,
  measure: Measure = countChars,
): string[] {
  const whole = name.trim();
  if (measure(whole) <= limit) {
    return [whole];
  }
  if (maxLines < 2) {
    return [middleEllipsis(whole, limit, measure)];
  }
  const parts = nameParts(whole);
  let best: { first: string; second: string; lost: number; spread: number } | null = null;
  for (let i = 1; i < parts.length; i++) {
    const first = parts.slice(0, i).join("").trim();
    const second = parts.slice(i).join("").trim();
    const lost = Math.max(0, measure(first) - limit) + Math.max(0, measure(second) - limit);
    const spread = Math.abs(measure(first) - measure(second));
    if (best === null || lost < best.lost || (lost === best.lost && spread < best.spread)) {
      best = { first, second, lost, spread };
    }
  }
  if (best === null) {
    return [middleEllipsis(whole, limit, measure)];
  }
  return [middleEllipsis(best.first, limit, measure), middleEllipsis(best.second, limit, measure)];
}

/** The size of the biggest line, in the unit of `measure`, for sizing the font. */
export function longestLine(lines: readonly string[], measure: Measure = countChars): number {
  return lines.reduce((most, line) => Math.max(most, measure(line)), 0);
}
