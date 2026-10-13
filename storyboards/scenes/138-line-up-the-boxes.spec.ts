import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { beat, caption, expect, test } from "./harness";

function marketDeck() {
  const id = crypto.randomUUID();
  const slideId = crypto.randomUUID();
  const now = new Date().toISOString();
  const box = (
    content: string,
    x: number,
    y: number,
    width: number,
    height: number,
    fill: string,
    align: "left" | "center",
  ) => ({
    id: crypto.randomUUID(),
    type: "text",
    x,
    y,
    width,
    height,
    content,
    fontSize: 32,
    bold: true,
    align,
    color: "#202124",
    fill,
  });
  return {
    format: "suiteleaf",
    version: 1,
    id,
    title: "Saturday market",
    createdAt: now,
    updatedAt: now,
    kind: "slide",
    content: {
      id,
      width: 960,
      height: 540,
      slideOrder: [slideId],
      slides: {
        [slideId]: {
          id: slideId,
          layout: "blank",
          notes: "",
          elements: [
            box("Saturday", 360, 310, 640, 88, "#ceead6", "center"),
            box("Notes", 760, 40, 160, 64, "#feefc3", "left"),
            box("Market", 64, 160, 180, 72, "#d2e3fc", "left"),
          ],
        },
      },
    },
  };
}

async function box(page: Page, word: string) {
  const id = await page.locator(".slide-canvas .slide-element").evaluateAll(
    (els, name) => {
      const match = els.find((el) => {
        const area = el.querySelector("textarea");
        return area instanceof HTMLTextAreaElement && area.value === name;
      });
      return match?.getAttribute("data-element-id") ?? "";
    },
    word,
  );
  if (!id) throw new Error(`No box named ${word}`);
  return page.locator(`.slide-canvas .slide-element[data-element-id="${id}"]`);
}

async function place(page: Page, word: string) {
  const raw = await page.locator(".slides-editor").getAttribute("data-deck-snapshot");
  const deck = JSON.parse(raw!) as {
    slides: Record<string, { elements: { content?: string; x: number; y: number; width: number }[] }>;
  };
  for (const slide of Object.values(deck.slides)) {
    const found = slide.elements.find((el) => el.content === word);
    if (found) return found;
  }
  throw new Error(`No box named ${word}`);
}

test("138-line-up-the-boxes", async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), "storyboard-138-"));
  const path = join(dir, "Saturday market.slslides");
  writeFileSync(path, JSON.stringify(marketDeck()));

  await page.goto("/");
  await caption(page, "Nia opens a title slide. Market is further left. Saturday is lower. Notes stays on the right.");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (await chooser).setFiles(path);
  await expect(page.locator(".slides-editor")).toBeVisible();
  await expect(page.getByLabel("File title")).toHaveValue("Saturday market");
  const market = await box(page, "Market");
  const saturday = await box(page, "Saturday");
  const notes = await box(page, "Notes");
  await expect(market).toBeVisible();
  await expect(saturday).toBeVisible();
  await expect(notes).toBeVisible();
  const before = {
    market: await place(page, "Market"),
    saturday: await place(page, "Saturday"),
    notes: await place(page, "Notes"),
  };
  expect(before.market.x).toBeLessThan(before.saturday.x);
  expect(before.market.y).toBeLessThan(before.saturday.y);
  expect(before.notes.x).toBeGreaterThan(before.saturday.x);
  await beat(page, 800);

  await caption(page, "She clicks Market, then Shift-clicks Saturday. Both boxes are selected, so Align left appears.");
  await market.locator("textarea").click();
  await beat(page, 500);
  await saturday.locator("textarea").click({ modifiers: ["Shift"] });
  await expect(market).toHaveAttribute("data-selected", "true");
  await expect(saturday).toHaveAttribute("data-selected", "true");
  await expect(notes).toHaveAttribute("data-selected", "false");
  const alignLeft = page.getByRole("button", { name: "Align left", exact: true });
  const alignTop = page.getByRole("button", { name: "Align top", exact: true });
  await expect(alignLeft).toBeVisible();
  await expect(alignTop).toBeVisible();
  await expect(page.getByRole("button", { name: "Arrange" })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await beat(page, 900);

  await caption(page, "Align left moves Saturday to Market's left edge. The words and the widths stay.");
  await alignLeft.click();
  await expect.poll(async () => (await place(page, "Saturday")).x).toBe(before.market.x);
  const linedLeft = {
    market: await place(page, "Market"),
    saturday: await place(page, "Saturday"),
    notes: await place(page, "Notes"),
  };
  expect(linedLeft.market).toEqual(before.market);
  expect(linedLeft.saturday.y).toBe(before.saturday.y);
  expect(linedLeft.saturday.width).toBe(before.saturday.width);
  expect(linedLeft.saturday.content).toBe("Saturday");
  expect(linedLeft.notes).toEqual(before.notes);
  await expect(market.locator("textarea")).toHaveValue("Market");
  await expect(saturday.locator("textarea")).toHaveValue("Saturday");
  await expect(notes.locator("textarea")).toHaveValue("Notes");
  const marketScreen = (await market.boundingBox())!;
  const saturdayScreen = (await saturday.boundingBox())!;
  expect(Math.abs(marketScreen.x - saturdayScreen.x)).toBeLessThan(2);
  await beat(page, 900);

  await caption(page, "Align top lifts Saturday to Market's top. The left edges stay together. Notes does not move.");
  await alignTop.click();
  const lined = {
    market: await place(page, "Market"),
    saturday: await place(page, "Saturday"),
    notes: await place(page, "Notes"),
  };
  expect(lined.market).toEqual(before.market);
  expect(lined.saturday.x).toBe(before.market.x);
  expect(lined.saturday.y).toBe(before.market.y);
  expect(lined.saturday.width).toBe(before.saturday.width);
  expect(lined.saturday.content).toBe("Saturday");
  expect(lined.notes).toEqual(before.notes);
  await expect(saturday.locator("textarea")).toHaveValue("Saturday");
  const topped = (await saturday.boundingBox())!;
  expect(Math.abs(topped.x - marketScreen.x)).toBeLessThan(2);
  expect(Math.abs(topped.y - marketScreen.y)).toBeLessThan(2);
  const notesScreen = (await notes.boundingBox())!;
  const notesBeforeTop = notesScreen;
  expect(notesBeforeTop.x).toBeGreaterThan(topped.x + 200);
  await beat(page, 900);

  await caption(page, "She clicks only Market. Align left and Align top go away, and Market stays put.");
  await market.locator("textarea").click();
  await expect(market).toHaveAttribute("data-selected", "true");
  await expect(saturday).toHaveAttribute("data-selected", "false");
  await expect(page.locator("button", { hasText: "Align left" })).toHaveCount(0);
  await expect(page.locator("button", { hasText: "Align top" })).toHaveCount(0);
  expect(await place(page, "Market")).toEqual(before.market);
  expect((await place(page, "Market")).x).not.toBe(0);
  await beat(page, 800);

  await caption(page, "She goes home and opens the deck again. The shared edges, the words, and Notes are still there.");
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await beat(page, 700);
  await page.getByRole("link", { name: "Saturday market", exact: true }).click();
  await expect(page.locator(".slides-editor")).toBeVisible();
  const reopenedMarketBox = await box(page, "Market");
  const reopenedSaturdayBox = await box(page, "Saturday");
  const reopenedNotesBox = await box(page, "Notes");
  const again = {
    market: await place(page, "Market"),
    saturday: await place(page, "Saturday"),
    notes: await place(page, "Notes"),
  };
  expect(again.market.x).toBe(again.saturday.x);
  expect(again.market.y).toBe(again.saturday.y);
  expect(again.market.content).toBe("Market");
  expect(again.saturday.content).toBe("Saturday");
  expect(again.saturday.width).toBe(before.saturday.width);
  expect(again.notes).toEqual(before.notes);
  const reopenedMarket = (await reopenedMarketBox.boundingBox())!;
  const reopenedSaturday = (await reopenedSaturdayBox.boundingBox())!;
  const reopenedNotes = (await reopenedNotesBox.boundingBox())!;
  expect(Math.abs(reopenedMarket.x - reopenedSaturday.x)).toBeLessThan(2);
  expect(Math.abs(reopenedMarket.y - reopenedSaturday.y)).toBeLessThan(2);
  expect(reopenedNotes.x).toBeGreaterThan(reopenedSaturday.x + 200);
  expect(reopenedNotes.y).toBeLessThan(reopenedMarket.y);
  await beat(page, 1600);
});
