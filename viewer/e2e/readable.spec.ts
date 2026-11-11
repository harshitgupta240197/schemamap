import { expect, test, type Page } from "@playwright/test";
import { buildIndexes } from "../src/snapshot/indexes";
import { syntheticSnapshot } from "../src/testing/synthetic";
import { clusterTables } from "../src/view/clusters";
import { AW, mapFile, mapUrl, settled, WWI } from "./helpers";

interface LabelFacts {
  /** What a person reads: the schema line (clusters) then the name lines. */
  readonly text: string;
  /** Rendered size of the text on screen, in px. */
  readonly screenPx: number;
  readonly clipped: boolean;
}

/** Facts about every label of `kind` that is drawn on the canvas right now. */
async function labels(page: Page, kind: "table" | "cluster"): Promise<LabelFacts[]> {
  return page.evaluate((nodeKind) => {
    const facts: {
      text: string;
      screenPx: number;
      clipped: boolean;
    }[] = [];
    for (const node of document.querySelectorAll(`.react-flow__node-${nodeKind}`)) {
      const name = node.querySelector<HTMLElement>(`.sm-${nodeKind}__name`);
      if (name === null) {
        continue;
      }
      const lines = [...name.querySelectorAll<HTMLElement>(".sm-label__line")];
      const schema = node.querySelector<HTMLElement>(".sm-cluster__schema");
      const viewport = document.querySelector(".react-flow__viewport");
      const scale = new DOMMatrixReadOnly(
        viewport === null ? "none" : getComputedStyle(viewport).transform,
      ).a;
      const parts = [schema, ...lines].filter((part): part is HTMLElement => part !== null);
      const sizes = parts.map((part) => parseFloat(getComputedStyle(part).fontSize) * scale);
      const box = node.querySelector<HTMLElement>(`.sm-${nodeKind}`);
      const clipped =
        lines.some((line) => line.scrollWidth > name.clientWidth + 1) ||
        (box !== null &&
          parts.some((part) => {
            const inner = part.getBoundingClientRect();
            const outer = box.getBoundingClientRect();
            return (
              inner.left < outer.left - 1 ||
              inner.right > outer.right + 1 ||
              inner.top < outer.top - 1 ||
              inner.bottom > outer.bottom + 1
            );
          }));
      facts.push({
        text: parts.map((part) => part.textContent.trim()).join(" / "),
        screenPx: Math.min(...sizes),
        clipped,
      });
    }
    return facts;
  }, kind);
}

function expectReadable(found: readonly LabelFacts[]): void {
  expect(found.length).toBeGreaterThan(10);
  expect(found.filter((label) => label.screenPx < 10).map((label) => label.text)).toEqual([]);
  expect(found.filter((label) => label.clipped).map((label) => label.text)).toEqual([]);
  const seen = new Map<string, number>();
  for (const label of found) {
    seen.set(label.text, (seen.get(label.text) ?? 0) + 1);
  }
  expect([...seen].filter(([, n]) => n > 1).map(([text]) => text)).toEqual([]);
}

for (const [name, file] of [
  ["AdventureWorks", AW],
  ["WideWorldImporters", WWI],
] as const) {
  test(`${name} at fit view: labels are at least 10 px, not clipped and all different`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto(mapUrl(testInfo.outputPath("fit.html"), "", file));
    await settled(page);
    await expect(page.locator(".react-flow")).toHaveAttribute("data-compact", "true");
    expectReadable(await labels(page, "table"));
  });
}

test("2,000 tables: overview cluster labels are readable, not clipped and all different", async ({
  page,
}, testInfo) => {
  const snapshot = syntheticSnapshot({ tables: 2000, seed: 2000 });
  const clusters = clusterTables(buildIndexes(snapshot)).clusters.length;
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(mapFile(testInfo.outputPath("overview.html"), JSON.stringify(snapshot)));
  await settled(page);
  await expect(page.locator(".react-flow__node-cluster")).toHaveCount(clusters);
  expectReadable(await labels(page, "cluster"));
});

test("a table node carries its schema stripe and the schema name as text", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(mapUrl(testInfo.outputPath("stripe.html"), "#focus=object%3APerson.Person"));
  await settled(page);
  const table = page.locator(".react-flow__node-table .sm-table").first();
  const stripe = await table.evaluate((element) => {
    const style = getComputedStyle(element, "::before");
    return {
      width: style.width,
      color: style.backgroundColor,
      badge: getComputedStyle(element.querySelector(".sm-badge") ?? element).borderLeftColor,
    };
  });
  expect(stripe.width).toBe("6px");
  expect(stripe.color).not.toBe("rgba(0, 0, 0, 0)");
  expect(stripe.color).toBe(stripe.badge);
  await expect(table.locator(".sm-badge")).not.toBeEmpty();
  await expect(table.locator(".sm-table__name")).toHaveAttribute("title", /^\w+\./);
});

const panel = (page: Page) => page.getByRole("complementary", { name: "Details: Person.Person" });

test("panel: wide, single-line header and type cells, names break only at word boundaries", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(mapUrl(testInfo.outputPath("panel.html"), "#select=object%3APerson.Person"));
  await settled(page);
  const aside = panel(page);
  await expect(aside).toBeVisible();
  expect((await aside.boundingBox())?.width).toBe(440);
  await expect(aside.getByRole("columnheader", { name: "Null" })).toBeVisible();
  await expect(aside.getByRole("columnheader", { name: "Key", exact: true })).toBeVisible();

  const result = await aside.evaluate((element) => {
    const lineCount = (cell: Element): number => {
      const range = document.createRange();
      range.selectNodeContents(cell);
      return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
    };
    const wrapped: string[] = [];
    for (const cell of element.querySelectorAll(
      ".sm-detail__table thead th, .sm-detail__table .sm-nowrap",
    )) {
      if (lineCount(cell) > 1) {
        wrapped.push(cell.textContent);
      }
    }
    const isBoundary = (before: string, after: string, next: string): boolean =>
      /[\s_.-]/.test(before) ||
      (/[a-z0-9]/.test(before) && /[A-Z]/.test(after)) ||
      (/[A-Z]/.test(before) && /[A-Z]/.test(after) && /[a-z]/.test(next)) ||
      (/[A-Za-z]/.test(before) && /[0-9]/.test(after));
    const midWord: string[] = [];
    const names = element.querySelectorAll(".sm-detail__table tbody th, .sm-detail__name");
    for (const cell of names) {
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      const chars: { char: string; top: number }[] = [];
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const text = node.textContent ?? "";
        for (let i = 0; i < text.length; i++) {
          const range = document.createRange();
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          chars.push({ char: text.charAt(i), top: Math.round(range.getBoundingClientRect().top) });
        }
      }
      chars.forEach((entry, i) => {
        const previous = chars[i - 1];
        if (previous !== undefined && entry.top > previous.top + 2) {
          if (!isBoundary(previous.char, entry.char, chars[i + 1]?.char ?? "")) {
            midWord.push(`${cell.textContent} @${String(i)}`);
          }
        }
      });
    }
    return {
      wrapped,
      midWord,
      rows: element.querySelectorAll(".sm-detail__table tbody tr").length,
    };
  });
  expect(result.rows).toBeGreaterThan(10);
  expect(result.wrapped).toEqual([]);
  expect(result.midWord).toEqual([]);
});

test("panel: a mouse open shows no ring, a keyboard open rings the heading", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(mapUrl(testInfo.outputPath("ring.html"), "#focus=object%3APerson.Person"));
  await settled(page);

  const ring = (): Promise<{
    focused: boolean;
    visible: boolean;
    style: string;
    width: string;
    aside: string;
  }> =>
    page.evaluate(() => {
      const heading = document.querySelector<HTMLElement>("[data-panel-heading]");
      const aside = document.querySelector<HTMLElement>(".sm-detail");
      return {
        focused: document.activeElement === heading,
        visible: heading?.matches(":focus-visible") ?? false,
        style: heading === null ? "" : getComputedStyle(heading).outlineStyle,
        width: heading === null ? "" : getComputedStyle(heading).outlineWidth,
        aside: aside === null ? "" : getComputedStyle(aside).outlineStyle,
      };
    });

  const node = page.locator('.react-flow__node-table:has(.sm-table__name[title="Person.Person"])');
  await node.locator(".sm-table__name").click();
  await expect(panel(page)).toBeVisible();
  const mouse = await ring();
  expect(mouse.focused).toBe(true);
  expect(mouse.visible).toBe(false);
  expect(mouse.style).toBe("none");
  expect(mouse.aside).toBe("none");

  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await node.focus();
  await page.keyboard.press("Enter");
  await expect(panel(page)).toBeVisible();
  const keyboard = await ring();
  expect(keyboard.focused).toBe(true);
  expect(keyboard.visible).toBe(true);
  expect(keyboard.style).toBe("solid");
  expect(keyboard.width).toBe("2px");
  expect(keyboard.aside).toBe("none");
});

test("a narrow window keeps the panel inside the page", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 600, height: 800 });
  await page.goto(mapUrl(testInfo.outputPath("narrow.html"), "#select=object%3APerson.Person"));
  await settled(page);
  const box = await panel(page).boundingBox();
  expect(box).not.toBeNull();
  expect((box?.x ?? -1) + (box?.width ?? 0)).toBeLessThanOrEqual(600);
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
});

test("the load error says what happened plainly and keeps the technical text under Details", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto(mapFile(testInfo.outputPath("bad.html"), '{"not":"a snapshot"}'));
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("That file does not look like a Schema Map snapshot.");
  const details = alert.locator("details");
  await expect(details.locator("summary")).toHaveText("Details");
  await expect(alert.getByText("format_version")).toBeHidden();
  await details.locator("summary").click();
  await expect(alert.getByText("format_version")).toBeVisible();
});

test("labels are measured, not guessed: a wide font still clips nothing", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent =
        ":root, body, .react-flow { --sm-font: 'Courier New', monospace !important; font-family: 'Courier New', monospace !important; }";
      document.head.append(style);
    });
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(mapUrl(testInfo.outputPath("wide-font.html")));
  await settled(page);
  const found = await labels(page, "table");
  expect(found.length).toBeGreaterThan(10);
  expect(found.filter((label) => label.screenPx < 10).map((label) => label.text)).toEqual([]);
  expect(found.filter((label) => label.clipped).map((label) => label.text)).toEqual([]);
});
