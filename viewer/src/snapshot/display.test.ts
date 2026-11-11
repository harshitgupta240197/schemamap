import { describe, expect, it } from "vitest";
import { formatCapturedAt } from "./display";

describe("formatCapturedAt", () => {
  it("formats a valid timestamp in UTC", () => {
    expect(formatCapturedAt("2026-11-08T12:00:00+01:00")).toBe("2026-11-08 11:00:00Z");
  });

  it.each(["yesterday", "", "2026-13-45T99:00:00Z"])("shows %j as written", (raw) => {
    const shown = formatCapturedAt(raw);
    expect(shown).toBe(raw);
    expect(shown).not.toContain("Invalid Date");
  });
});
