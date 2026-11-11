/**
 * Where a name may break: after `_`, `.`, `-` or a space, before a capital that starts a word,
 * and between letters and digits.
 */
const BOUNDARY =
  /(?<=[_.\-\s])|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|(?<=[A-Za-z])(?=[0-9])/;

/** The pieces of a name at its word boundaries (CamelCase, underscore, dot, dash, space). */
export function nameParts(name: string): string[] {
  return name.split(BOUNDARY).filter((part) => part !== "");
}

function length(text: string): number {
  return Array.from(text).length;
}

/**
 * `text` cut to at most `max` characters by replacing its middle with an ellipsis, so both the
 * start and the end stay readable. Counts code points, so it never splits a surrogate pair.
 */
export function middleEllipsis(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) {
    return text;
  }
  if (max <= 1) {
    return "…";
  }
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return `${chars.slice(0, head).join("")}…${tail === 0 ? "" : chars.slice(chars.length - tail).join("")}`;
}

/**
 * A name as one or two lines of at most `maxChars` characters. A name that fits stays on one
 * line. Otherwise it breaks at the word boundary that leaves the least text to cut, preferring
 * balanced lines; a line that is still too long, or a single long word, gets a middle ellipsis.
 * The full name is for the title and the accessible name, never this.
 */
export function compactLabel(name: string, maxChars: number, maxLines = 2): string[] {
  const max = Math.max(1, Math.floor(maxChars));
  const whole = name.trim();
  if (length(whole) <= max) {
    return [whole];
  }
  if (maxLines < 2) {
    return [middleEllipsis(whole, max)];
  }
  const parts = nameParts(whole);
  let best: { first: string; second: string; lost: number; spread: number } | null = null;
  for (let i = 1; i < parts.length; i++) {
    const first = parts.slice(0, i).join("").trim();
    const second = parts.slice(i).join("").trim();
    const lost = Math.max(0, length(first) - max) + Math.max(0, length(second) - max);
    const spread = Math.abs(length(first) - length(second));
    if (best === null || lost < best.lost || (lost === best.lost && spread < best.spread)) {
      best = { first, second, lost, spread };
    }
  }
  if (best === null) {
    return [middleEllipsis(whole, max)];
  }
  return [middleEllipsis(best.first, max), middleEllipsis(best.second, max)];
}

/** The length of the longest line, for sizing the font. */
export function longestLine(lines: readonly string[]): number {
  return lines.reduce((most, line) => Math.max(most, length(line)), 0);
}
