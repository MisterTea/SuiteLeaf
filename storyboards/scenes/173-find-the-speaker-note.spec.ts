import type { Locator, Page } from "@playwright/test";
import { beat, caption, expect, test, typeSlowly } from "./harness";

function text(content: string) {
  return {
    id: crypto.randomUUID(),
    type: "text",
    x: 72,
    y: 168,
    width: 800,
    height: 140,
    content,
    fontSize: 72,
    bold: true,
    fontFamily: "Arial",
    color: "#1e293b",
    align: "center",
  };
}

function slide(title: string, word: string, notes?: string) {
  return {
    id: crypto.randomUUID(),
    title,
    layout: "title",
    background: { color: "#ffffff" },
    notes,
    elements: [text(word)],
  };
}

/** Prices has no pears. Welcome's speaker notes say "mention the pears". */
function townHall() {
  const now = new Date().toISOString();
  const prices = slide("Prices", "Prices", "Finish the draft later.");
  const welcome = slide("Welcome", "Market", "mention the pears");
  const id = crypto.randomUUID();
  return JSON.stringify({
    format: "suiteleaf",
    version: 1,
    id,
    title: "Town hall",
    createdAt: now,
    updatedAt: now,
    kind: "slide",
    content: {
      id,
      width: 960,
      height: 540,
      slideOrder: [prices.id, welcome.id],
      slides: {
        [prices.id]: prices,
        [welcome.id]: welcome,
      },
    },
  });
}

async function pointAt(page: Page, target: Locator, dx = 0.5, dy = 0.5) {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width * dx, box.y + box.height * dy, { steps: 12 });
}

async function openDeck(page: Page) {
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (await chooser).setFiles({
    name: "Town hall.slslides",
    mimeType: "application/json",
    buffer: Buffer.from(townHall()),
  });
  await expect(page.getByLabel("File title")).toHaveValue("Town hall");
}

const rows = (page: Page) => page.locator(".thumbnail-row");
const canvas = (page: Page) => page.locator(".slide-canvas");
const word = (page: Page) => canvas(page).locator(".slide-text").first();
const notes = (page: Page) => page.locator(".notes-textarea");
const findBar = (page: Page) => page.locator(".slide-find-bar");
const status = (page: Page) => page.locator(".slide-find-status");

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

/** Park the caption in the thumbnail column, below the find bar. */
async function placeCaption(page: Page) {
  await page.evaluate(() => {
    const bar = document.getElementById("storyboard-caption");
    if (!bar) return;
    const find = document.querySelector(".slide-find-bar");
    const findBottom = find instanceof HTMLElement ? find.getBoundingClientRect().bottom : 96;
    bar.style.left = "8px";
    bar.style.right = "auto";
    bar.style.transform = "none";
    bar.style.bottom = "auto";
    bar.style.top = `${Math.ceil(findBottom + 10)}px`;
    bar.style.width = "184px";
    bar.style.maxWidth = "184px";
  });
}

async function showCaption(page: Page, text: string, hold = 1400) {
  await caption(page, text, 250);
  await placeCaption(page);
  await beat(page, hold);
}

/** The note is on screen, and neither the find bar nor the caption covers it. */
async function notesStayClear(page: Page, value: string) {
  const area = notes(page);
  await expect(area).toBeVisible();
  await expect(area).toHaveValue(value);
  await expect(area).toHaveClass(/find-match/);
  const shown = await area.evaluate((el) => {
    const box = el as HTMLTextAreaElement;
    return {
      scrollTop: box.scrollTop,
      clientHeight: box.clientHeight,
      scrollHeight: box.scrollHeight,
    };
  });
  expect(shown.clientHeight).toBeGreaterThan(24);
  expect(shown.scrollTop).toBeLessThan(8);
  expect(shown.scrollHeight).toBeLessThanOrEqual(shown.clientHeight + 2);
  const noteBox = await area.boundingBox();
  const barBox = await findBar(page).boundingBox();
  expect(noteBox).toBeTruthy();
  expect(barBox).toBeTruthy();
  expect(overlaps(noteBox!, barBox!)).toBe(false);
  const viewport = page.viewportSize()!;
  expect(noteBox!.y).toBeGreaterThanOrEqual(0);
  expect(noteBox!.y + noteBox!.height).toBeLessThanOrEqual(viewport.height);
  const captionBar = page.locator("#storyboard-caption");
  if (await captionBar.count()) {
    const captionBox = await captionBar.boundingBox();
    if (captionBox) {
      expect(overlaps(noteBox!, captionBox)).toBe(false);
      const statusBox = await status(page).boundingBox();
      if (statusBox) expect(overlaps(statusBox, captionBox)).toBe(false);
    }
  }
}

test("173-find-the-speaker-note", async ({ page }) => {
  await openDeck(page);
  await expect(rows(page)).toHaveCount(2);
  await expect(canvas(page).locator("textarea").first()).toHaveValue("Prices");
  const storedX = await word(page).getAttribute("data-x");
  const storedY = await word(page).getAttribute("data-y");
  expect(storedX).toBeTruthy();
  expect(storedY).toBeTruthy();
  await expect(page.locator("select.zoom-select")).toHaveValue("100%");
  await expect(page.locator(".slide-number-chrome")).toHaveCount(0);
  await expect(rows(page).nth(0)).toHaveClass(/active/);

  await showCaption(
    page,
    "Nia is on Prices. The word pears is only in the Welcome speaker notes.",
    1200,
  );
  await page.getByTitle("Collapse speaker notes").click();
  await expect(notes(page)).toHaveCount(0);
  await beat(page, 600);

  await showCaption(
    page,
    "She finds pears. The deck opens the Welcome notes, and the bar says the match is in the notes.",
    700,
  );
  const find = page.getByRole("button", { name: "Find", exact: true });
  await find.scrollIntoViewIfNeeded();
  await pointAt(page, find);
  await find.click();
  const field = page.getByLabel("Find text");
  await expect(field).toBeVisible();
  await field.click();
  await typeSlowly(page, "pears", 90);
  await expect(status(page)).toHaveText("1 of 1 in the notes on Welcome");
  const statusBox = await status(page).boundingBox();
  expect(statusBox).toBeTruthy();
  expect(statusBox!.x).toBeGreaterThanOrEqual(0);
  expect(statusBox!.x + statusBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await expect(rows(page).nth(1)).toHaveClass(/active/);
  await expect(canvas(page).locator("textarea").first()).toHaveValue("Market");
  await expect(word(page)).toHaveAttribute("data-x", storedX!);
  await expect(word(page)).toHaveAttribute("data-y", storedY!);
  await expect(page.locator("select.zoom-select")).toHaveValue("100%");
  await expect(page.locator(".slide-number-chrome")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Replace all 1" })).toBeVisible();
  await placeCaption(page);
  await notesStayClear(page, "mention the pears");
  await pointAt(page, status(page));
  await beat(page, 400);
  await pointAt(page, notes(page), 0.18, 0.4);
  await beat(page, 1200);

  await showCaption(
    page,
    "The canvas still says Market. The note is still mention the pears.",
    1100,
  );
  await pointAt(page, word(page));
  await notesStayClear(page, "mention the pears");
  await beat(page, 500);

  await showCaption(
    page,
    "She searches for zzzz. There are no matches, and the note does not change.",
    700,
  );
  await field.click();
  await field.press("ControlOrMeta+A");
  await typeSlowly(page, "zzzz", 90);
  await expect(status(page)).toHaveText("No matches");
  await expect(rows(page).nth(1)).toHaveClass(/active/);
  await expect(notes(page)).toHaveValue("mention the pears");
  await expect(canvas(page).locator("textarea").first()).toHaveValue("Market");
  await expect(word(page)).toHaveAttribute("data-x", storedX!);
  await expect(word(page)).toHaveAttribute("data-y", storedY!);
  await expect(page.locator("select.zoom-select")).toHaveValue("100%");
  await expect(page.locator(".slide-number-chrome")).toHaveCount(0);
  await placeCaption(page);
  await pointAt(page, status(page));
  await beat(page, 1100);

  await showCaption(
    page,
    "Closing Find leaves her on Welcome. The note is still mention the pears.",
    600,
  );
  const close = page.getByRole("button", { name: "Close find" });
  await pointAt(page, close);
  await close.click();
  await expect(findBar(page)).toHaveCount(0);
  await expect(rows(page).nth(1)).toHaveClass(/active/);
  await expect(notes(page)).toHaveValue("mention the pears");
  await expect(canvas(page).locator("textarea").first()).toHaveValue("Market");
  await expect(page.locator("select.zoom-select")).toHaveValue("100%");
  await expect(page.locator(".slide-number-chrome")).toHaveCount(0);
  await beat(page, 1000);
});
