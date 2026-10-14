import type { Locator, Page } from "@playwright/test";
import { beat, caption, expect, test, typeSlowly } from "./harness";

function text(content: string, y: number, width = 520) {
  return {
    id: crypto.randomUUID(),
    type: "text",
    x: 72,
    y,
    width,
    height: 64,
    content,
    fontSize: 40,
    bold: true,
    fontFamily: "Arial",
    color: "#1e293b",
    align: "left",
  };
}

function rectangle(content: string) {
  return {
    id: "welcome-rectangle",
    type: "shape",
    shapeType: "rect",
    x: 640,
    y: 20,
    width: 250,
    height: 72,
    content,
    fontSize: 28,
    bold: true,
    fontFamily: "Arial",
    color: "#1e293b",
    align: "center",
    fill: "#fff4cc",
    stroke: "#d97706",
    strokeWidth: 3,
  };
}

function amountTable() {
  return {
    id: "welcome-table",
    type: "table",
    x: 150,
    y: 120,
    width: 660,
    height: 260,
    fontSize: 32,
    rows: [
      ["Item", "Amount"],
      ["Apples", "2"],
      ["Pears", "10"],
    ],
  };
}

function slide(
  title: string,
  word: string,
  y: number,
  notes: string,
  extra: Array<ReturnType<typeof rectangle> | ReturnType<typeof amountTable>> = [],
) {
  return {
    id: crypto.randomUUID(),
    title,
    layout: "title",
    background: { color: "#ffffff" },
    notes,
    elements: [text(word, y), ...extra],
  };
}

/** Prices has no table. Welcome's Amount cell says 10 beside Pears. The text box says Market. */
function townHall() {
  const now = new Date().toISOString();
  const prices = slide("Prices", "Prices", 180, "Finish the draft later.");
  const welcome = slide("Welcome", "Market", 20, "Say hello.", [
    rectangle("Fresh"),
    amountTable(),
  ]);
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
const shape = (page: Page) => canvas(page).locator(".slide-shape");
const label = (page: Page) => shape(page).locator(".shape-label");
const table = (page: Page) => canvas(page).locator(".slide-table");
const cell = (page: Page, value: string) =>
  table(page).locator("td").filter({ hasText: new RegExp(`^${value}$`) });
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

/** The matched cell is on screen, and neither the find bar nor the caption covers it. */
async function cellStaysClear(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  const wordBox = await target.boundingBox();
  const barBox = await findBar(page).boundingBox();
  expect(wordBox).toBeTruthy();
  expect(barBox).toBeTruthy();
  expect(overlaps(wordBox!, barBox!)).toBe(false);
  const viewport = page.viewportSize()!;
  expect(wordBox!.y).toBeGreaterThanOrEqual(0);
  expect(wordBox!.height).toBeGreaterThan(24);
  expect(wordBox!.y + wordBox!.height).toBeLessThanOrEqual(viewport.height);
  const captionBar = page.locator("#storyboard-caption");
  if (await captionBar.count()) {
    const captionBox = await captionBar.boundingBox();
    if (captionBox) expect(overlaps(wordBox!, captionBox)).toBe(false);
  }
  const statusBox = await status(page).boundingBox();
  if (statusBox) {
    expect(overlaps(wordBox!, statusBox)).toBe(false);
    const viewportWidth = page.viewportSize()!.width;
    expect(statusBox.x).toBeGreaterThanOrEqual(0);
    expect(statusBox.x + statusBox.width).toBeLessThanOrEqual(viewportWidth);
  }
}

test("178-find-the-table", async ({ page }) => {
  await openDeck(page);
  await expect(rows(page)).toHaveCount(2);
  await expect(canvas(page).locator("textarea").first()).toHaveValue("Prices");
  await expect(table(page)).toHaveCount(0);
  await expect(shape(page)).toHaveCount(0);
  await expect(notes(page)).toHaveValue("Finish the draft later.");
  await expect(page.locator("select.zoom-select")).toHaveValue("100%");
  await expect(page.locator(".slide-number-chrome")).toHaveCount(0);
  await expect(rows(page).nth(0)).toHaveClass(/active/);

  await showCaption(
    page,
    "Nia is on Prices. The number 10 is in a table on Welcome, next to Pears.",
    1200,
  );

  await showCaption(
    page,
    "She finds 10. The table is selected, and the bar says the match is in the table.",
    700,
  );
  const find = page.getByRole("button", { name: "Find", exact: true });
  await find.scrollIntoViewIfNeeded();
  await pointAt(page, find);
  await find.click();
  const field = page.getByLabel("Find text");
  await expect(field).toBeVisible();
  await field.click();
  await typeSlowly(page, "10", 90);
  await expect(status(page)).toHaveText("1 of 1 in the table on Welcome");
  await expect(rows(page).nth(1)).toHaveClass(/active/);
  await expect(table(page)).toHaveCount(1);
  await expect(table(page)).toHaveClass(/selected/);
  await expect(table(page)).toHaveClass(/find-match/);
  await expect(table(page)).toHaveAttribute("data-selected", "true");
  const storedX = await table(page).getAttribute("data-x");
  const storedY = await table(page).getAttribute("data-y");
  expect(storedX).toBe("150");
  expect(storedY).toBe("120");
  await expect(cell(page, "10")).toHaveClass(/find-cell/);
  await expect(cell(page, "Pears")).toBeVisible();
  await expect(cell(page, "Item")).toBeVisible();
  await expect(cell(page, "Amount")).toBeVisible();
  await expect(cell(page, "Apples")).toBeVisible();
  await expect(cell(page, "2")).toBeVisible();
  await expect(word(page).locator("textarea")).toHaveValue("Market");
  await expect(canvas(page).locator(".slide-text.find-match")).toHaveCount(0);
  await expect(label(page)).toHaveText("Fresh");
  await expect(shape(page)).not.toHaveClass(/find-match/);
  await expect(shape(page)).not.toHaveClass(/selected/);
  await expect(notes(page)).toHaveValue("Say hello.");
  await expect(notes(page)).not.toHaveClass(/find-match/);
  await expect(page.getByRole("button", { name: "Replace", exact: true })).toHaveAttribute(
    "title",
    "Replace this table",
  );
  await expect(page.locator("select.zoom-select")).toHaveValue("100%");
  await expect(page.locator(".slide-number-chrome")).toHaveCount(0);
  await placeCaption(page);
  await cellStaysClear(page, cell(page, "10"));
  await cellStaysClear(page, cell(page, "Pears"));
  await cellStaysClear(page, word(page));
  await pointAt(page, status(page));
  await beat(page, 400);
  await pointAt(page, cell(page, "10"));
  await beat(page, 1100);

  await showCaption(
    page,
    "Market stays Market. Fresh and the notes stay. Pears stays beside 10.",
    1000,
  );
  await pointAt(page, word(page));
  await expect(word(page).locator("textarea")).toHaveValue("Market");
  await expect(cell(page, "Pears")).toBeVisible();
  await expect(cell(page, "10")).toBeVisible();
  await expect(label(page)).toHaveText("Fresh");
  await expect(notes(page)).toHaveValue("Say hello.");
  await expect(table(page)).toHaveAttribute("data-x", storedX!);
  await expect(table(page)).toHaveAttribute("data-y", storedY!);
  await cellStaysClear(page, cell(page, "10"));
  await beat(page, 500);

  await showCaption(page, "She replaces 10 with 12. That cell changes. Pears and Market stay.", 700);
  const replaceField = page.getByLabel("Replace with");
  await replaceField.click();
  await typeSlowly(page, "12", 90);
  const replace = page.getByRole("button", { name: "Replace", exact: true });
  await pointAt(page, replace);
  await beat(page, 400);
  await replace.click();
  await expect(cell(page, "12")).toBeVisible();
  await expect(cell(page, "10")).toHaveCount(0);
  await expect(cell(page, "Pears")).toBeVisible();
  await expect(cell(page, "Item")).toHaveText("Item");
  await expect(cell(page, "Amount")).toHaveText("Amount");
  await expect(cell(page, "Apples")).toHaveText("Apples");
  await expect(cell(page, "2")).toHaveText("2");
  await expect(word(page).locator("textarea")).toHaveValue("Market");
  await expect(label(page)).toHaveText("Fresh");
  await expect(notes(page)).toHaveValue("Say hello.");
  await expect(table(page)).toHaveAttribute("data-x", storedX!);
  await expect(table(page)).toHaveAttribute("data-y", storedY!);
  await expect(table(page)).toHaveAttribute("data-selected", "true");
  await expect(page.locator("select.zoom-select")).toHaveValue("100%");
  await expect(page.locator(".slide-number-chrome")).toHaveCount(0);
  await expect(status(page)).toHaveText("No matches");
  await placeCaption(page);
  await cellStaysClear(page, cell(page, "12"));
  await cellStaysClear(page, cell(page, "Pears"));
  await cellStaysClear(page, word(page));
  await pointAt(page, cell(page, "12"));
  await beat(page, 900);

  await showCaption(page, "She saves, returns home, and reopens. The Amount cell is still 12.", 700);
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await beat(page, 700);
  await page.getByRole("link", { name: "Town hall", exact: true }).click();
  await expect(page.locator(".slides-editor")).toBeVisible();
  await page.getByRole("option", { name: "Slide 2: Market" }).click();
  await expect(rows(page).nth(1)).toHaveClass(/active/);
  await expect(cell(page, "12")).toBeVisible();
  await expect(cell(page, "Pears")).toBeVisible();
  await expect(cell(page, "10")).toHaveCount(0);
  await expect(word(page).locator("textarea")).toHaveValue("Market");
  await expect(table(page)).toHaveAttribute("data-x", "150");
  await expect(table(page)).toHaveAttribute("data-y", "120");
  await expect(label(page)).toHaveText("Fresh");
  await expect(notes(page)).toHaveValue("Say hello.");
  await expect(page.locator("select.zoom-select")).toHaveValue("100%");
  await expect(page.locator(".slide-number-chrome")).toHaveCount(0);
  await beat(page, 1400);
});
