import { expect, test } from "vitest";
import {
  COMPACT_BELOW_ZOOM,
  compactChars,
  compactLineBudget,
  heightFitPx,
  isCompact,
  nameFitPx,
  zoomBucket,
} from "./zoom";

test("nodes go compact strictly below the threshold", () => {
  expect(isCompact(COMPACT_BELOW_ZOOM)).toBe(false);
  expect(isCompact(COMPACT_BELOW_ZOOM - 0.001)).toBe(true);
  expect(isCompact(1)).toBe(false);
  expect(isCompact(0.05)).toBe(true);
});

test("nameFitPx shrinks as names get longer and never reaches zero width", () => {
  expect(nameFitPx("Shift", 260)).toBeGreaterThan(nameFitPx("BusinessEntityAddress", 260));
  expect(nameFitPx("", 260)).toBe(nameFitPx("x", 260));
  expect(nameFitPx("Ünïcödé", 260)).toBe(nameFitPx("Unicode", 260));
});

test("the zoom bucket floors while compact and is constant once nodes are full", () => {
  expect(zoomBucket(0.199)).toBe(0.19);
  expect(zoomBucket(0.2)).toBe(0.2);
  expect(zoomBucket(0.01)).toBe(0.05);
  expect(zoomBucket(0.6)).toBe(1);
  expect(zoomBucket(1.7)).toBe(1);
});

test("fewer characters fit a line as the map zooms out", () => {
  expect(compactChars(0.4, 300)).toBeGreaterThan(compactChars(0.2, 300));
  expect(compactChars(0.01, 300)).toBe(1);
});

test("a node needs height for each readable line, and the font never overflows it", () => {
  expect(compactLineBudget(140, 0.19)).toBe(2);
  expect(compactLineBudget(140, 0.1)).toBe(1);
  expect(compactLineBudget(10, 0.5)).toBe(0);
  expect(heightFitPx(2, 100)).toBeLessThan(heightFitPx(1, 100));
});
