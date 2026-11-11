import { readFileSync } from "node:fs";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ElkNode } from "elkjs/lib/elk-api.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildIndexes } from "../snapshot/indexes";
import { parseSnapshot } from "../snapshot/parse";
import { buildGraph } from "./build";
import { toggleExpanded } from "./expanded";
import {
  gridPositions,
  LAYOUT_LIMIT,
  layoutCache,
  layoutKey,
  layoutOptions,
  positionsFrom,
  toElkGraph,
} from "./layout";
import { useLayout } from "./useLayout";

const indexes = buildIndexes(
  parseSnapshot(readFileSync("../cli/tests/fixtures/adventureworks2022.snapshot.json", "utf8")),
);
const NONE: ReadonlySet<string> = new Set();
const graph = buildGraph(indexes, NONE);

/** A fake layout: every node in one row, so results are predictable. */
function fakeLayout(input: ElkNode): Promise<ElkNode> {
  return Promise.resolve({
    ...input,
    children: (input.children ?? []).map((child, i) => ({ ...child, x: i * 300, y: 10 })),
  });
}

afterEach(() => {
  cleanup();
  layoutCache.clear();
});

describe("toElkGraph", () => {
  it("passes fixed sizes and keeps graph order", () => {
    const elk = toElkGraph(graph);
    expect(elk.children?.map((c) => c.id)).toEqual(graph.nodes.map((n) => n.id));
    expect(elk.children?.[0]).toMatchObject({
      width: graph.nodes[0]?.width,
      height: graph.nodes[0]?.height,
    });
    expect(elk.edges).toHaveLength(graph.edges.length);
    expect(elk.layoutOptions?.["elk.algorithm"]).toBe("layered");
  });

  it("is deterministic", () => {
    expect(toElkGraph(buildGraph(indexes, NONE))).toEqual(toElkGraph(graph));
  });

  it("uses minimum-width layering up to the layout limit only", () => {
    const strategy = "elk.layered.layering.strategy";
    expect(toElkGraph(graph).layoutOptions?.[strategy]).toBe("MIN_WIDTH");
    expect(layoutOptions(LAYOUT_LIMIT)[strategy]).toBe("MIN_WIDTH");
    expect(layoutOptions(LAYOUT_LIMIT + 1)[strategy]).toBeUndefined();
    expect(layoutOptions(LAYOUT_LIMIT + 1)["elk.algorithm"]).toBe("layered");
  });
});

describe("layoutKey", () => {
  it("is prefixed so table views never share a cache entry with the overview", () => {
    expect(layoutKey(graph).startsWith("t:")).toBe(true);
  });

  it("is stable for the same view and changes when a node is expanded", () => {
    expect(layoutKey(buildGraph(indexes, NONE))).toBe(layoutKey(graph));
    expect(layoutKey(buildGraph(indexes, toggleExpanded(NONE, "object:Person.Person")))).not.toBe(
      layoutKey(graph),
    );
  });
});

describe("positions", () => {
  it("reads ELK output by node id", () => {
    expect(positionsFrom({ id: "root", children: [{ id: "t0", x: 5, y: 7 }] }).get("t0")).toEqual({
      x: 5,
      y: 7,
    });
  });

  it("grid fallback places every node without overlap in a row", () => {
    const positions = gridPositions(graph);
    expect(positions.size).toBe(graph.nodes.length);
    const first = positions.get("t0");
    const second = positions.get("t1");
    expect(second?.x ?? 0).toBeGreaterThanOrEqual((first?.x ?? 0) + (graph.nodes[0]?.width ?? 0));
  });
});

describe("useLayout", () => {
  it("lays out once per view and serves the cache afterwards", async () => {
    const runner = vi.fn(fakeLayout);
    const first = renderHook(() => useLayout(graph, layoutKey(graph), runner));
    expect(first.result.current.status).toBe("pending");
    await waitFor(() => {
      expect(first.result.current.status).toBe("done");
    });
    expect(first.result.current.positions?.get("t1")).toEqual({ x: 300, y: 10 });
    first.unmount();

    const same = buildGraph(indexes, NONE);
    const again = renderHook(() => useLayout(same, layoutKey(same), runner));
    expect(again.result.current.status).toBe("done");
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("keeps the previous positions while a new view is laid out", async () => {
    const runner = vi.fn(fakeLayout);
    const { result, rerender } = renderHook(({ g }) => useLayout(g, layoutKey(g), runner), {
      initialProps: { g: graph },
    });
    await waitFor(() => {
      expect(result.current.status).toBe("done");
    });
    const before = result.current.positions;
    rerender({ g: buildGraph(indexes, toggleExpanded(NONE, "object:Person.Person")) });
    expect(result.current).toEqual({ positions: before, status: "pending" });
    await waitFor(() => {
      expect(result.current.status).toBe("done");
    });
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("falls back to a grid when the layout fails, and does not cache the failure", async () => {
    const runner = vi.fn(() => Promise.reject(new Error("worker failed")));
    const { result } = renderHook(() => useLayout(graph, layoutKey(graph), runner));
    await waitFor(() => {
      expect(result.current.status).toBe("failed");
    });
    expect(result.current.positions).toEqual(gridPositions(graph));
    expect(layoutCache.size).toBe(0);
    await act(() => Promise.resolve());
  });
});
