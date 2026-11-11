import type { ElkNode } from "elkjs/lib/elk-api.js";
import type { LayoutRunner } from "./layout";

/** Width over height that a packed overview aims for: a widescreen canvas (1400 × 880). */
export const PACK_ASPECT = 1.6;
/** Space between packed boxes, in flow px. */
export const PACK_GAP = 60;

interface Box {
  readonly id: string;
  readonly width: number;
  readonly height: number;
}

/** Greedy rows of at most `rowWidth` px, in order; returns positions and the bounding box. */
function rows(
  boxes: readonly Box[],
  rowWidth: number,
): { positions: Map<string, { x: number; y: number }>; width: number; height: number } {
  const positions = new Map<string, { x: number; y: number }>();
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let width = 0;
  for (const box of boxes) {
    if (x > 0 && x + box.width > rowWidth) {
      y += rowHeight + PACK_GAP;
      x = 0;
      rowHeight = 0;
    }
    positions.set(box.id, { x, y });
    width = Math.max(width, x + box.width);
    x += box.width + PACK_GAP;
    rowHeight = Math.max(rowHeight, box.height);
  }
  return { positions, width, height: y + rowHeight };
}

/**
 * Pack boxes into rows, keeping their order (left to right, top to bottom). Of every row width
 * that changes the result, the one whose bounding box is largest on a `PACK_ASPECT` screen at
 * fit view wins; ties go to the narrower. Edges are ignored. Pure and deterministic.
 */
export function packRows(graph: ElkNode, aspect: number = PACK_ASPECT): ElkNode {
  const boxes: Box[] = (graph.children ?? []).map((child) => ({
    id: child.id,
    width: child.width ?? 0,
    height: child.height ?? 0,
  }));
  const candidates = new Set<number>();
  let prefix = 0;
  for (const box of boxes) {
    prefix += (prefix > 0 ? PACK_GAP : 0) + box.width;
    candidates.add(prefix);
  }
  let best: ReturnType<typeof rows> | null = null;
  let bestCost = Infinity;
  for (const width of [...candidates].sort((a, b) => a - b)) {
    const packed = rows(boxes, width);
    // The fit-view scale is limited by whichever side fills the screen first.
    const cost = Math.max(packed.width / aspect, packed.height);
    if (cost < bestCost) {
      best = packed;
      bestCost = cost;
    }
  }
  const positions = best?.positions ?? new Map<string, { x: number; y: number }>();
  return {
    ...graph,
    children: (graph.children ?? []).map((child) => ({
      ...child,
      ...(positions.get(child.id) ?? { x: 0, y: 0 }),
    })),
  };
}

/** A layout runner that packs rows on the main thread; it is instant for the overview's boxes. */
export const runPackLayout: LayoutRunner = (graph) => Promise.resolve(packRows(graph));
