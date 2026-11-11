import { describe, expect, it } from "vitest";
import { packRows, PACK_GAP, runPackLayout } from "./pack";

const box = (id: string, width: number, height: number) => ({ id, width, height });

function bounds(graph: ReturnType<typeof packRows>): { width: number; height: number } {
  const children = graph.children ?? [];
  return {
    width: Math.max(...children.map((c) => (c.x ?? 0) + (c.width ?? 0))),
    height: Math.max(...children.map((c) => (c.y ?? 0) + (c.height ?? 0))),
  };
}

describe("packRows", () => {
  it("keeps the order, left to right then top to bottom, with a gap between boxes", () => {
    const packed = packRows(
      { id: "root", children: ["a", "b", "c", "d"].map((id) => box(id, 100, 100)) },
      1,
    );
    expect(packed.children?.map((c) => [c.id, c.x, c.y])).toEqual([
      ["a", 0, 0],
      ["b", 100 + PACK_GAP, 0],
      ["c", 0, 100 + PACK_GAP],
      ["d", 100 + PACK_GAP, 100 + PACK_GAP],
    ]);
  });

  it("fills a widescreen canvas instead of one long row", () => {
    const children = Array.from({ length: 12 }, (_, i) => box(`s${String(i)}`, 500, 250));
    const { width, height } = bounds(packRows({ id: "root", children }));
    expect(width / height).toBeGreaterThan(1);
    expect(width / height).toBeLessThan(2.6);
  });

  it("puts a single box at the origin and handles an empty graph", () => {
    expect(packRows({ id: "root", children: [box("a", 10, 10)] }).children?.[0]).toMatchObject({
      x: 0,
      y: 0,
    });
    expect(packRows({ id: "root", children: [] }).children).toEqual([]);
  });

  it("is deterministic and runs as a layout runner", async () => {
    const graph = {
      id: "root",
      children: [box("a", 300, 120), box("b", 700, 280), box("c", 300, 180)],
    };
    expect(await runPackLayout(graph)).toEqual(packRows(graph));
  });
});
