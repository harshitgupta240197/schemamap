import { expect, test } from "vitest";
import {
  COMPACT_BELOW_ZOOM,
  compactLimitEm,
  compactLineBudget,
  heightFitPx,
  isCompact,
  fitPx,
  zoomBucket,
} from "./zoom";

test("nodes go compact strictly below the threshold", () => {
  expect(isCompact(COMPACT_BELOW_ZOOM)).toBe(false);
  expect(isCompact(COMPACT_BELOW_ZOOM - 0.001)).toBe(true);
  expect(isCompact(1)).toBe(false);
  expect(isCompact(0.05)).toBe(true);
});

test("fitPx shrinks as lines get wider and never divides by zero", () => {
  expect(fitPx(3, 300)).toBeGreaterThan(fitPx(12, 300));
  expect(fitPx(0, 300)).toBe(fitPx(0.5, 300));
  expect(fitPx(10, 300) * 10).toBeLessThanOrEqual(266);
});

test("the zoom bucket floors while compact and is constant once nodes are full", () => {
  expect(zoomBucket(0.199)).toBe(0.19);
  expect(zoomBucket(0.2)).toBe(0.2);
  expect(zoomBucket(0.01)).toBe(0.05);
  expect(zoomBucket(0.6)).toBe(1);
  expect(zoomBucket(1.7)).toBe(1);
});

test("less width fits a line as the map zooms out", () => {
  expect(compactLimitEm(0.4, 300)).toBeGreaterThan(compactLimitEm(0.2, 300));
  expect(compactLimitEm(0.2, 300)).toBeCloseTo(5.32, 5);
});

test("a node needs height for each readable line, and the font never overflows it", () => {
  expect(compactLineBudget(140, 0.19)).toBe(2);
  expect(compactLineBudget(140, 0.1)).toBe(1);
  expect(compactLineBudget(10, 0.5)).toBe(0);
  expect(heightFitPx(2, 100)).toBeLessThan(heightFitPx(1, 100));
});
