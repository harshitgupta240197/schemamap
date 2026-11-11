/** Width of one character, in em, when text cannot be measured (no canvas, e.g. in unit tests). */
const FALLBACK_EM_PER_CHAR = 0.7;

/** Measured widths are padded by this much, so sub-pixel rounding never clips a line. */
const SAFETY = 1.04;

let context: CanvasRenderingContext2D | null | undefined;
const widths = new Map<string, number>();

function canvasContext(): CanvasRenderingContext2D | null {
  if (context !== undefined) {
    return context;
  }
  context = null;
  if (typeof document === "undefined" || navigator.userAgent.includes("jsdom")) {
    return context;
  }
  try {
    const found = document.createElement("canvas").getContext("2d");
    if (found !== null) {
      const family = getComputedStyle(document.body).fontFamily;
      found.font = `600 100px ${family === "" ? "sans-serif" : family}`;
      context = found;
    }
  } catch {
    context = null;
  }
  return context;
}

/**
 * The width of `text`, in em, in the page's font at the weight node names use. Measuring beats
 * guessing per character: fonts differ between systems, and wide letters (m, W) and the ellipsis
 * would clip a line sized by an average.
 */
export function measureEm(text: string): number {
  const known = widths.get(text);
  if (known !== undefined) {
    return known;
  }
  const canvas = canvasContext();
  const em =
    canvas === null
      ? Array.from(text).length * FALLBACK_EM_PER_CHAR
      : (canvas.measureText(text).width / 100) * SAFETY;
  widths.set(text, em);
  return em;
}
