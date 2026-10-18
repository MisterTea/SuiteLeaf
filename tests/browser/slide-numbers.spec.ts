import { test, expect, type Page } from "@playwright/test";

const titles = ["Intro", "Garden", "Close"] as const;

const menuBar = (page: Page) => page.locator(".file-menu");

const named = (label: string) =>
  new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`);

async function choose(page: Page, menu: string, item: string) {
  await menuBar(page).getByRole("button", { name: menu, exact: true }).click();
  const name = named(item);
  await page
    .getByRole("menuitem", { name })
    .or(page.getByRole("menuitemcheckbox", { name }))
    .click();
}

async function threeSlideDeck(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New presentation" }).click();
  await expect(page.locator(".slides-editor")).toBeVisible();
  await page.getByLabel("File title").fill("Numbered deck");
  await page.locator(".slide-element textarea").first().fill(titles[0]);
  for (const title of titles.slice(1)) {
    await page.getByRole("button", { name: "+ New slide" }).click();
    await page.getByRole("menuitem", { name: "Title & body" }).click();
    await expect(page.locator(".thumbnail-row")).toHaveCount(
      titles.indexOf(title) + 1,
    );
    await page.locator(".slide-element textarea").first().fill(title);
  }
  await expect(page.locator(".thumbnail-row")).toHaveCount(3);
  await page.getByRole("option", { name: /Slide 1: Intro/ }).click();
  await expect(page.locator(".slide-canvas textarea").first()).toHaveValue(
    "Intro",
  );
}

async function expectNumber(page: Page, title: string, n: number) {
  const canvas = page.locator(".slide-canvas");
  const number = canvas.locator(".slide-number");
  await expect(canvas.locator("textarea").first()).toHaveValue(title);
  await expect(number).toBeVisible();
  await expect(number).toHaveText(String(n));
  await expect(number).toHaveAttribute("aria-label", `Slide number ${n}`);
  expect(
    await number.evaluate((el) => !!el.closest(".slide-element, textarea")),
  ).toBe(false);
}

async function savedFlag(page: Page): Promise<unknown> {
  const raw = await page.locator(".slides-editor").getAttribute("data-deck-snapshot");
  return JSON.parse(raw ?? "{}").slideNumbers;
}

test("slide numbers follow the deck, stay out of the text, and persist", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await threeSlideDeck(page);

  await expect(page.locator(".slide-number")).toHaveCount(0);

  await menuBar(page).getByRole("button", { name: "View", exact: true }).click();
  const toggle = page.getByRole("menuitemcheckbox", {
    name: "Slide numbers",
    exact: true,
  });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(toggle.locator(".menu-item-check")).toHaveText("");
  await toggle.click();

  await expectNumber(page, "Intro", 1);
  await page.locator(".slide-canvas textarea").first().fill("Intro revised");
  await expect(page.locator(".slide-canvas .slide-number")).toHaveText("1");
  await page.locator(".slide-canvas textarea").first().fill("Intro");
  await expectNumber(page, "Intro", 1);
  expect(await savedFlag(page)).toBe(true);

  await page.getByRole("button", { name: "Slideshow", exact: true }).click();
  const show = page.locator(".presenter-overlay");
  const box = show.locator(".presenter-slide-box");
  await expect(show).toBeVisible();
  await expect(box.getByText("Intro", { exact: true })).toBeVisible();
  await expect(box.locator(".slide-number")).toBeVisible();
  await expect(box.locator(".slide-number")).toHaveText("1");
  await page.keyboard.press("Escape");
  await expect(show).toHaveCount(0);

  await page.getByRole("option", { name: /Slide 2: Garden/ }).click();
  await expectNumber(page, "Garden", 2);
  await page.getByRole("option", { name: /Slide 3: Close/ }).click();
  await expectNumber(page, "Close", 3);

  await choose(page, "Slide", "Move to start");
  await expect(page.locator(".thumbnail-row").nth(0)).toHaveAttribute(
    "aria-label",
    /Slide 1: Close/,
  );
  await expectNumber(page, "Close", 1);
  await page.getByRole("option", { name: /Slide 2: Intro/ }).click();
  await expectNumber(page, "Intro", 2);
  await page.getByRole("option", { name: /Slide 3: Garden/ }).click();
  await expectNumber(page, "Garden", 3);

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Numbered deck" }).click();
  await expect(page.locator(".slides-editor")).toBeVisible();
  await expect(page.locator(".thumbnail-row").nth(0)).toHaveAttribute(
    "aria-label",
    /Slide 1: Close/,
  );
  await expectNumber(page, "Close", 1);
  await page.getByRole("option", { name: /Slide 2: Intro/ }).click();
  await expectNumber(page, "Intro", 2);
  expect(await savedFlag(page)).toBe(true);

  await menuBar(page).getByRole("button", { name: "View", exact: true }).click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(toggle.locator(".menu-item-check")).toHaveText("✓");
  await toggle.click();
  await expect(page.locator(".slide-number")).toHaveCount(0);
  await expect(page.locator(".slide-canvas textarea").first()).toHaveValue("Intro");
  expect(await savedFlag(page)).toBeUndefined();
  await page.getByRole("option", { name: /Slide 1: Close/ }).click();
  await expect(page.locator(".slide-canvas textarea").first()).toHaveValue("Close");
  await expect(page.locator(".slide-number")).toHaveCount(0);

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Numbered deck" }).click();
  await expect(page.locator(".slides-editor")).toBeVisible();
  await expect(page.locator(".slide-number")).toHaveCount(0);
  await expect(page.locator(".slide-canvas textarea").first()).toHaveValue("Close");
  await page.getByRole("option", { name: /Slide 2: Intro/ }).click();
  await expect(page.locator(".slide-canvas textarea").first()).toHaveValue("Intro");
  await expect(page.locator(".slide-number")).toHaveCount(0);
  expect(await savedFlag(page)).toBeUndefined();

  await menuBar(page).getByRole("button", { name: "View", exact: true }).click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Escape");
  await expect(page.locator(".slide-number")).toHaveCount(0);
  expect(errors).toEqual([]);
});
