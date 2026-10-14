import type { Locator, Page } from "@playwright/test";
import { beat, caption, expect, test, typeSlowly } from "./harness";

const slideZoom = (page: Page) =>
  page.getByRole("toolbar", { name: "Slides toolbar" }).locator("select.zoom-select");
const docZoom = (page: Page) =>
  page
    .getByRole("toolbar", { name: "Document formatting" })
    .locator("select.zoom-select");
const canvas = (page: Page) => page.locator(".slide-canvas");
const titleBox = (page: Page) => canvas(page).locator(".slide-text").first();
const titleText = (page: Page) => canvas(page).locator("textarea").first();

async function ready(page: Page) {
  await expect(page.getByRole("button", { name: "Slideshow", exact: true })).toBeVisible();
  await expect(slideZoom(page)).toBeVisible();
  await beat(page, 600);
}

async function goHome(page: Page) {
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
}

async function nameFile(page: Page, title: string) {
  const box = page.getByLabel("File title");
  await expect(box).toBeVisible();
  await box.click();
  await box.press("ControlOrMeta+A");
  await typeSlowly(page, title);
}

async function pointAt(page: Page, target: Locator, dx = 0.5, dy = 0.5) {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width * dx, box.y + box.height * dy, { steps: 12 });
}

async function canvasWidth(page: Page) {
  const box = await canvas(page).boundingBox();
  expect(box).toBeTruthy();
  return box!.width;
}

/** The show is the whole slide, not the 150% editing crop. */
async function expectFullSlide(page: Page) {
  const show = page.locator(".presenter-overlay");
  const slide = show.locator(".presenter-slide-box");
  await expect(slide.getByText("Market", { exact: true })).toBeVisible();
  await expect(slide).not.toContainText("150%");
  const metrics = await slide.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const title = el.querySelector(".show-text");
    const titleRect = title?.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      zoom: getComputedStyle(el).zoom,
      titleTop: titleRect?.top ?? -1,
      titleBottom: titleRect?.bottom ?? -1,
      titleLeft: titleRect?.left ?? -1,
      titleRight: titleRect?.right ?? -1,
      titleText: title?.textContent ?? "",
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
  });
  expect(metrics.titleText).toBe("Market");
  expect(["1", "normal", ""]).toContain(metrics.zoom);
  expect(metrics.width).toBeGreaterThan(metrics.vw * 0.75);
  expect(metrics.width).toBeLessThanOrEqual(metrics.vw + 2);
  expect(metrics.height).toBeLessThanOrEqual(metrics.vh + 2);
  const aspect = metrics.width / metrics.height;
  expect(aspect).toBeGreaterThan(1.7);
  expect(aspect).toBeLessThan(1.85);
  expect(metrics.titleTop).toBeGreaterThanOrEqual(metrics.top - 1);
  expect(metrics.titleBottom).toBeLessThanOrEqual(metrics.bottom + 1);
  expect(metrics.titleLeft).toBeGreaterThanOrEqual(metrics.left - 1);
  expect(metrics.titleRight).toBeLessThanOrEqual(metrics.right + 1);
  const topFraction = (metrics.titleTop - metrics.top) / metrics.height;
  expect(topFraction).toBeGreaterThan(0.24);
  expect(topFraction).toBeLessThan(0.36);
}

test("169-zoom-the-deck", async ({ page }) => {
  await page.addInitScript(() => {
    let current: Element | null = null;
    const change = (el: Element | null) => {
      current = el;
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    };
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => current,
    });
    Element.prototype.requestFullscreen = function () {
      return change(this);
    };
    document.exitFullscreen = () => change(null);
  });

  await page.goto("/");
  await caption(
    page,
    "Nia opens a deck called Market. The zoom says 100%. She chooses 150% so the edges are easier to see.",
  );
  await page.getByRole("button", { name: "New presentation" }).click();
  await ready(page);
  await expect(slideZoom(page)).toHaveValue("100%");
  const fitted = await canvasWidth(page);
  const storedX = await titleBox(page).getAttribute("data-x");
  const storedY = await titleBox(page).getAttribute("data-y");
  expect(storedX).toBeTruthy();
  expect(storedY).toBeTruthy();
  await nameFile(page, "Market");
  await titleText(page).click();
  await typeSlowly(page, "Market");
  await expect(titleText(page)).toHaveValue("Market");
  await expect(titleBox(page)).toHaveAttribute("data-x", storedX!);
  await expect(titleBox(page)).toHaveAttribute("data-y", storedY!);
  await slideZoom(page).scrollIntoViewIfNeeded();
  await pointAt(page, slideZoom(page));
  await slideZoom(page).selectOption("150%");
  await expect(slideZoom(page)).toHaveValue("150%");
  await expect
    .poll(async () => canvasWidth(page), { timeout: 5000 })
    .toBeGreaterThan(fitted * 1.4);
  await expect(titleText(page)).toHaveValue("Market");
  await expect(titleBox(page)).toHaveAttribute("data-x", storedX!);
  await expect(titleBox(page)).toHaveAttribute("data-y", storedY!);
  await expect(canvas(page)).not.toContainText("150%");
  await expect(canvas(page)).toHaveAttribute("data-zoom", "150%");
  await beat(page, 1400);

  await caption(
    page,
    "She saves, returns home, and reopens the deck. It is still at 150%.",
  );
  await goHome(page);
  await page.getByRole("link", { name: "Market", exact: true }).click();
  await ready(page);
  await expect(slideZoom(page)).toHaveValue("150%");
  expect(await canvasWidth(page)).toBeGreaterThan(fitted * 1.4);
  await expect(titleText(page)).toHaveValue("Market");
  await expect(titleBox(page)).toHaveAttribute("data-x", storedX!);
  await expect(titleBox(page)).toHaveAttribute("data-y", storedY!);
  await beat(page, 1400);

  await caption(page, "She creates a new presentation. Its zoom is 100%.");
  await goHome(page);
  await page.getByRole("button", { name: "New presentation" }).click();
  await ready(page);
  await expect(slideZoom(page)).toHaveValue("100%");
  await expect(slideZoom(page)).not.toHaveValue("150%");
  const fresh = await canvasWidth(page);
  expect(fresh).toBeLessThan(fitted * 1.2);
  expect(fresh).toBeGreaterThan(fitted * 0.8);
  await nameFile(page, "Outline");
  await expect(slideZoom(page)).toHaveValue("100%");
  await beat(page, 1200);

  await caption(
    page,
    "She opens the minutes, a document left at 100%. The document zoom stays 100%.",
  );
  await goHome(page);
  await page.getByRole("button", { name: "New document" }).click();
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toBeVisible();
  await expect(docZoom(page)).toHaveValue("100%");
  await expect(docZoom(page)).not.toHaveValue("150%");
  await nameFile(page, "Minutes");
  await editor.click();
  await typeSlowly(page, "The market opens at seven.");
  await expect(editor).toContainText("The market opens at seven.");
  await expect(editor).not.toContainText("150%");
  await expect(docZoom(page)).toHaveValue("100%");
  await beat(page, 1200);

  await caption(
    page,
    "She returns to the deck. It is still at 150%. She presents, and the show is the full slide.",
  );
  await goHome(page);
  await page.getByRole("link", { name: "Market", exact: true }).click();
  await ready(page);
  await expect(slideZoom(page)).toHaveValue("150%");
  expect(await canvasWidth(page)).toBeGreaterThan(fitted * 1.4);
  await expect(titleText(page)).toHaveValue("Market");
  const showButton = page.getByRole("button", { name: "Slideshow", exact: true });
  await showButton.scrollIntoViewIfNeeded();
  await pointAt(page, showButton);
  await showButton.click();
  await expect(page.locator(".presenter-overlay")).toBeVisible();
  await expectFullSlide(page);
  await pointAt(page, page.locator(".presenter-slide-box"));
  await beat(page, 2200);
});
