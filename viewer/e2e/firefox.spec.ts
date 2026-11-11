import { expect, test } from "@playwright/test";
import { AW_MAP, flowUrl } from "./flow-maps";
import { settled } from "./helpers";

test("Firefox: the AdventureWorks map opens over file:// and the layout finishes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(flowUrl(AW_MAP));
  await settled(page);
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  expect(errors).toEqual([]);
});
