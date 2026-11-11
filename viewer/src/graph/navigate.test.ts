import { expect, test } from "vitest";
import { nearestInDirection } from "./navigate";

const node = (id: string, x: number, y: number) => ({
  id,
  position: { x, y },
  width: 100,
  height: 100,
});
const grid = [node("a", 0, 0), node("b", 200, 0), node("c", 0, 200), node("d", 200, 200)];

test("moves to the neighbour in each direction", () => {
  expect(nearestInDirection(grid, "a", "right")).toBe("b");
  expect(nearestInDirection(grid, "a", "down")).toBe("c");
  expect(nearestInDirection(grid, "d", "left")).toBe("c");
  expect(nearestInDirection(grid, "d", "up")).toBe("b");
});

test("returns null at an edge or for an unknown node", () => {
  expect(nearestInDirection(grid, "a", "left")).toBeNull();
  expect(nearestInDirection(grid, "a", "up")).toBeNull();
  expect(nearestInDirection(grid, "zz", "right")).toBeNull();
});

test("prefers the node in line over a nearer one off to the side", () => {
  const nodes = [node("a", 0, 0), node("near", 150, 190), node("inline", 300, 0)];
  expect(nearestInDirection(nodes, "a", "right")).toBe("inline");
});

test("breaks ties by id", () => {
  const nodes = [node("a", 0, 100), node("z", 200, 0), node("b", 200, 200)];
  expect(nearestInDirection(nodes, "a", "right")).toBe("b");
});
