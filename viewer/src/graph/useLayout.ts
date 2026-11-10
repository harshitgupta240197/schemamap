import { useEffect, useState } from "react";
import {
  gridPositions,
  layoutCache,
  positionsFrom,
  toElkGraph,
  type LayoutGraph,
  type LayoutRunner,
  type Positions,
} from "./layout";

export type LayoutStatus = "pending" | "done" | "failed";

export interface LayoutState {
  /** Positions for the current view, or the previous view's while a new layout runs. */
  readonly positions: Positions | null;
  readonly status: LayoutStatus;
}

interface Result {
  readonly key: string;
  readonly positions: Positions;
  readonly status: "done" | "failed";
}

/**
 * Lay out `graph` with `runner`, once per view: results are cached by `key`, which must identify
 * the graph's nodes, sizes and edges (`layoutKey` for tables, `overviewKey` for clusters).
 */
export function useLayout(graph: LayoutGraph, key: string, runner: LayoutRunner): LayoutState {
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    if (layoutCache.has(key)) {
      return;
    }
    let cancelled = false;
    runner(toElkGraph(graph)).then(
      (laidOut) => {
        const positions = positionsFrom(laidOut);
        layoutCache.set(key, positions);
        if (!cancelled) {
          setResult({ key, positions, status: "done" });
        }
      },
      () => {
        if (!cancelled) {
          setResult({ key, positions: gridPositions(graph), status: "failed" });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, graph, runner]);

  const cached = layoutCache.get(key);
  if (cached !== undefined) {
    return { positions: cached, status: "done" };
  }
  if (result?.key === key) {
    return result;
  }
  return { positions: result?.positions ?? null, status: "pending" };
}
