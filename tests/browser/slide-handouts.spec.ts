import { test, expect, type Page } from "@playwright/test";

const titles = ["Intro", "Garden", "Budget", "Close"] as const;

const menuBar = (page: Page) => page.locator(".file-menu");

const named = (label: string) =>
  new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`);

async function choose(page: Page, menu: string, item: string) {
  await menuBar(page).getByRole("button", { name: menu, exact: true }).click();
  await page.getByRole("menuitem", { name: named(item) }).click();
}

async function fourSlideDeck(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New presentation" }).click();
  await expect(page.locator(".slides-editor")).toBeVisible();
  await page.locator(".slide-element textarea").first().fill(titles[0]);
  for (const title of titles.slice(1)) {
    await page.getByRole("button", { name: "+ New slide" }).click();
    await page.getByRole("menuitem", { name: "Title & body" }).click();
    await expect(page.locator(".thumbnail-row")).toHaveCount(
      titles.indexOf(title) + 1,
    );
    await page.locator(".slide-element textarea").first().fill(title);
  }
  await expect(page.locator(".thumbnail-row")).toHaveCount(4);
  for (const [index, title] of titles.entries()) {
    await expect(page.locator(".thumbnail-row").nth(index)).toHaveAttribute(
      "aria-label",
      new RegExp(`Slide ${index + 1}: ${title}`),
    );
  }
}

test("handouts lays the deck out by slides per page and close leaves it unchanged", async ({
  page,
}) => {
  await fourSlideDeck(page);
  const before = await page
    .locator(".slides-editor")
    .getAttribute("data-deck-snapshot");

  await choose(page, "View", "Handouts");
  const handouts = page.getByRole("dialog", { name: "Handouts" });
  await expect(handouts).toBeVisible();

  const perPage = handouts.getByLabel("Slides per page");
  await expect(perPage).toHaveValue("4");
  await expect(perPage.locator("option")).toHaveText(["2", "4", "6"]);

  const pages = handouts.locator(".handout-page");
  await expect(pages).toHaveCount(1);
  const fourUp = await pages.first().innerText();
  const fourUpAt = titles.map((title) => fourUp.indexOf(title));
  expect(fourUpAt.every((at) => at >= 0)).toBe(true);
  expect(fourUpAt).toEqual([...fourUpAt].sort((a, b) => a - b));
  for (const title of titles) {
    const text = pages.first().getByText(title, { exact: true });
    await text.scrollIntoViewIfNeeded();
    await expect(text).toBeVisible();
  }

  await perPage.selectOption("2");
  await expect(perPage).toHaveValue("2");
  await expect(pages).toHaveCount(2);

  const first = pages.nth(0);
  const second = pages.nth(1);
  await first.scrollIntoViewIfNeeded();
  await expect(first).toContainText("Intro");
  await expect(first).toContainText("Garden");
  await expect(first).not.toContainText("Budget");
  await expect(first).not.toContainText("Close");
  const firstText = await first.innerText();
  expect(firstText.indexOf("Garden")).toBeGreaterThan(firstText.indexOf("Intro"));

  await second.scrollIntoViewIfNeeded();
  await expect(second).toBeVisible();
  await expect(second).toContainText("Budget");
  await expect(second).toContainText("Close");
  await expect(second).not.toContainText("Intro");
  await expect(second).not.toContainText("Garden");
  const secondText = await second.innerText();
  expect(secondText.indexOf("Close")).toBeGreaterThan(secondText.indexOf("Budget"));

  await handouts.getByRole("button", { name: "Close", exact: true }).click();
  await expect(handouts).toHaveCount(0);
  await expect(page.locator(".slides-editor")).toBeVisible();
  await expect(page.locator(".slide-canvas")).toBeVisible();
  await expect(page.locator(".thumbnail-row")).toHaveCount(4);
  for (const [index, title] of titles.entries()) {
    await expect(page.locator(".thumbnail-row").nth(index)).toHaveAttribute(
      "aria-label",
      new RegExp(`Slide ${index + 1}: ${title}`),
    );
  }
  await expect(page.locator(".slide-canvas textarea").first()).toHaveValue("Close");
  expect(
    await page.locator(".slides-editor").getAttribute("data-deck-snapshot"),
  ).toBe(before);
});
