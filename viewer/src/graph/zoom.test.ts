import { expect, test } from "vitest";
import { COMPACT_BELOW_ZOOM, isCompact, nameFitPx } from "./zoom";

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
