/** How well a query matches a name, best first. Declared in rank order. */
export const TIER = { exact: 0, prefix: 1, wordBoundary: 2, fuzzy: 3 } as const;
export type Tier = (typeof TIER)[keyof typeof TIER];

/** A match: its tier, and a tie-break within the tier where lower is closer to the query. */
export interface Match {
  readonly tier: Tier;
  readonly closeness: number;
}

function isUpper(ch: string): boolean {
  return ch !== ch.toLowerCase() && ch === ch.toUpperCase();
}

function isLetterOrDigit(ch: string): boolean {
  return ch.toLowerCase() !== ch.toUpperCase() || (ch >= "0" && ch <= "9");
}

/** A word starts after a non-alphanumeric, at a lower-to-upper step (camelCase) or after a digit. */
function startsWord(text: string, at: number): boolean {
  if (at === 0) {
    return true;
  }
  const previous = text.charAt(at - 1);
  const current = text.charAt(at);
  if (!isLetterOrDigit(previous)) {
    return true;
  }
  return isUpper(current) && !isUpper(previous);
}

/** Position of the first occurrence of `needle` in `lower` that starts a word of `text`, or -1. */
function wordBoundaryAt(text: string, lower: string, needle: string): number {
  let from = lower.indexOf(needle);
  while (from !== -1) {
    if (startsWord(text, from)) {
      return from;
    }
    from = lower.indexOf(needle, from + 1);
  }
  return -1;
}

/** Gap of the leftmost subsequence match of `needle` in `lower`, or -1 if there is none. */
function subsequenceGap(lower: string, needle: string): number {
  let at = 0;
  let first = -1;
  let last = -1;
  for (let i = 0; i < needle.length; i += 1) {
    const found = lower.indexOf(needle.charAt(i), at);
    if (found === -1) {
      return -1;
    }
    if (first === -1) {
      first = found;
    }
    last = found;
    at = found + 1;
  }
  return last - first + 1 - needle.length;
}

/**
 * Match `needle` (already lowercased, non-empty) against `text` with its lowercase form `lower`.
 * Case never matters. Rank: exact, then prefix, then the start of a word, then characters in order.
 * The tie-break inside a tier is how far the name runs past the query (prefix), how late the word
 * starts (word boundary) or how spread out the characters are (fuzzy).
 */
export function matchText(text: string, lower: string, needle: string): Match | null {
  if (lower === needle) {
    return { tier: TIER.exact, closeness: 0 };
  }
  if (lower.startsWith(needle)) {
    return { tier: TIER.prefix, closeness: lower.length - needle.length };
  }
  const word = wordBoundaryAt(text, lower, needle);
  if (word !== -1) {
    return { tier: TIER.wordBoundary, closeness: word };
  }
  const gap = subsequenceGap(lower, needle);
  return gap === -1 ? null : { tier: TIER.fuzzy, closeness: gap };
}

/** The better of two matches, or whichever exists. */
export function better(a: Match | null, b: Match | null): Match | null {
  if (a === null || b === null) {
    return a ?? b;
  }
  return a.tier < b.tier || (a.tier === b.tier && a.closeness <= b.closeness) ? a : b;
}
