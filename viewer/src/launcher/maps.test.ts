import { describe, expect, it } from "vitest";
import { initialForm } from "./form";
import {
  failedSection,
  formatElapsed,
  formatExtracted,
  formatSize,
  rerunTarget,
  sectionCount,
  sectionProgress,
  sectionTitle,
} from "./maps";
import type { JobStatus, MapEntry } from "./model";
import { capabilities } from "./testing";

const job = (sections: JobStatus["sections"]): JobStatus => ({
  id: "j",
  state: "running",
  sections,
  elapsedMs: 0,
  mapId: null,
  error: null,
});

describe("section wording", () => {
  it("titles known sections and passes unknown ones through", () => {
    expect(sectionTitle("row_counts")).toBe("Row counts");
    expect(sectionTitle("mystery")).toBe("mystery");
  });

  it("counts with the right noun, and shows nothing without a count", () => {
    expect(sectionCount({ name: "tables", state: "done", count: 71 })).toBe("71 tables");
    expect(sectionCount({ name: "schemas", state: "done", count: 1 })).toBe("1 schema");
    expect(sectionCount({ name: "tables", state: "done", count: 2000 })).toBe("2,000 tables");
    expect(sectionCount({ name: "tables", state: "running", count: null })).toBeNull();
  });

  it("counts finished sections and finds the one that failed", () => {
    const j = job([
      { name: "schemas", state: "done", count: null },
      { name: "tables", state: "skipped", count: null },
      { name: "views", state: "failed", count: null },
      { name: "routines", state: "pending", count: null },
    ]);
    expect(sectionProgress(j)).toEqual({ finished: 2, total: 4 });
    expect(failedSection(j)?.name).toBe("views");
    expect(failedSection(job([]))).toBeNull();
  });
});

describe("formatting", () => {
  it("formats elapsed time as m:ss", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(3_400)).toBe("0:03");
    expect(formatElapsed(62_000)).toBe("1:02");
    expect(formatElapsed(-5)).toBe("0:00");
  });

  it("formats sizes", () => {
    expect(formatSize(900)).toBe("900 B");
    expect(formatSize(2048)).toBe("2 KB");
    expect(formatSize(2_516_582)).toBe("2.4 MB");
  });

  it("says today, yesterday or the date, in local time", () => {
    const now = new Date(2026, 10, 15, 15, 0);
    expect(formatExtracted(new Date(2026, 10, 15, 12, 41).toISOString(), now)).toBe("Today, 12:41");
    expect(formatExtracted(new Date(2026, 10, 14, 18, 5).toISOString(), now)).toBe(
      "Yesterday, 18:05",
    );
    expect(formatExtracted(new Date(2026, 10, 12, 9, 0).toISOString(), now)).toBe("12 Nov 2026");
    expect(formatExtracted("not a date", now)).toBe("Unknown");
  });
});

describe("rerunTarget", () => {
  const caps = capabilities("macos");
  const map: MapEntry = {
    id: "a".repeat(32),
    database: "AdventureWorks2022",
    server: "db.example.test",
    extractedAt: "2026-11-15T12:41:00Z",
    tables: 71,
    bytes: 1,
  };
  const base = initialForm(caps);

  it("uses the form when it is for the same server, with its password dropped", () => {
    const form = {
      ...base,
      server: "DB.example.test ",
      user: "u",
      password: "secret",
      trust: true,
    };
    const target = rerunTarget(map, form, [], caps);
    expect(target).toMatchObject({
      server: "DB.example.test ",
      user: "u",
      password: "",
      trust: true,
    });
  });

  it("falls back to a remembered connection for that server", () => {
    const remembered = [
      { id: "b".repeat(32), server: "db.example.test", port: 14333, auth: "sql", user: "reader" },
    ];
    const target = rerunTarget(map, { ...base, server: "other", trust: true }, remembered, caps);
    expect(target).toMatchObject({
      server: "db.example.test",
      port: "14333",
      user: "reader",
      trust: true,
    });
  });

  it("is null when the server is unknown or the map has none", () => {
    expect(rerunTarget(map, { ...base, server: "other" }, [], caps)).toBeNull();
    expect(rerunTarget({ ...map, server: null }, base, [], caps)).toBeNull();
  });
});
