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
            box("Notes", 36, 24, 168, 64, "#feefc3", "left"),
            box("Market", 72, 120, 540, 90, "#d2e3fc", "left"),
            box("Saturday", 500, 220, 240, 200, "#ceead6", "center"),
          ],
        },
      },
    },
  };
}

async function box(page: Page, word: string) {
  const id = await page
    .locator(".slide-canvas .slide-element")
    .evaluateAll((els, name) => {
      const match = els.find((el) => {
        const area = el.querySelector("textarea");
        return area instanceof HTMLTextAreaElement && area.value === name;
      });
      return match?.getAttribute("data-element-id") ?? "";
    }, word);
  if (!id) throw new Error(`No box named ${word}`);
  return page.locator(`.slide-canvas .slide-element[data-element-id="${id}"]`);
}

async function place(page: Page, word: string) {
  const raw = await page
    .locator(".slides-editor")
    .getAttribute("data-deck-snapshot");
  const deck = JSON.parse(raw!) as {
    slides: Record<
      string,
      {
        elements: {
          content?: string;
          x: number;
          y: number;
          width: number;
          height: number;
        }[];
      }
    >;
  };
  for (const slide of Object.values(deck.slides)) {
    const found = slide.elements.find((el) => el.content === word);
    if (found) return found;
  }
  throw new Error(`No box named ${word}`);
}

const rightOf = (box: { x: number; width: number }) => box.x + box.width;
const bottomOf = (box: { y: number; height: number }) => box.y + box.height;

test("139-line-up-the-right-edges", async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), "storyboard-139-"));
  const path = join(dir, "Saturday market.slslides");
  writeFileSync(path, JSON.stringify(marketDeck()));

  await page.goto("/");
  await caption(
    page,
    "Nia opens a deck. Market is wide. Saturday is narrower, and its right edge sticks out past Market. Notes sits aside.",
  );
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
  expect(before.market.width).toBeGreaterThan(before.saturday.width);
  expect(rightOf(before.saturday)).toBeGreaterThan(rightOf(before.market));
  expect(bottomOf(before.saturday)).toBeGreaterThan(bottomOf(before.market));
  const openingMarket = (await market.boundingBox())!;
  const openingSaturday = (await saturday.boundingBox())!;
  expect(openingMarket.width).toBeGreaterThan(openingSaturday.width);
  expect(openingSaturday.x + openingSaturday.width).toBeGreaterThan(
    openingMarket.x + openingMarket.width + 8,
  );
  expect(openingSaturday.y + openingSaturday.height).toBeGreaterThan(
    openingMarket.y + openingMarket.height + 8,
  );
  await beat(page, 800);

  await caption(
    page,
    "She Shift-clicks both boxes. Align right appears beside Align left.",
  );
  await market.locator("textarea").click();
  await beat(page, 500);
  await saturday.locator("textarea").click({ modifiers: ["Shift"] });
  await expect(market).toHaveAttribute("data-selected", "true");
  await expect(saturday).toHaveAttribute("data-selected", "true");
  await expect(notes).toHaveAttribute("data-selected", "false");
  const alignLeft = page.getByRole("button", {
    name: "Align left",
    exact: true,
  });
  const alignTop = page.getByRole("button", { name: "Align top", exact: true });
  const alignRight = page.getByRole("button", {
    name: "Align right",
    exact: true,
  });
  const alignBottom = page.getByRole("button", {
    name: "Align bottom",
    exact: true,
  });
  await expect(alignLeft).toBeVisible();
  await expect(alignTop).toBeVisible();
  await expect(alignRight).toBeVisible();
  await expect(alignBottom).toBeVisible();
  await expect(page.getByRole("button", { name: "Arrange" })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const notesSelected = (await notes.boundingBox())!;
  await beat(page, 900);

  await caption(
    page,
    "Align right moves Market to Saturday's right edge. Saturday stays put. The words and the widths stay.",
  );
  await alignRight.click();
  await expect
    .poll(async () => rightOf(await place(page, "Market")))
    .toBe(rightOf(before.saturday));
  const linedRight = {
    market: await place(page, "Market"),
    saturday: await place(page, "Saturday"),
    notes: await place(page, "Notes"),
  };
  expect(linedRight.saturday).toEqual(before.saturday);
  expect(linedRight.market.y).toBe(before.market.y);
  expect(linedRight.market.width).toBe(before.market.width);
  expect(linedRight.market.height).toBe(before.market.height);
  expect(linedRight.market.content).toBe("Market");
  expect(linedRight.saturday.content).toBe("Saturday");
  expect(linedRight.notes).toEqual(before.notes);
  expect(linedRight.market.x).toBeGreaterThan(before.market.x);
  expect(linedRight.market.x).not.toBe(linedRight.saturday.x);
  await expect(market.locator("textarea")).toHaveValue("Market");
  await expect(saturday.locator("textarea")).toHaveValue("Saturday");
  await expect(notes.locator("textarea")).toHaveValue("Notes");
  const marketRightScreen = (await market.boundingBox())!;
  const saturdayRightScreen = (await saturday.boundingBox())!;
  expect(
    Math.abs(
      marketRightScreen.x +
        marketRightScreen.width -
        (saturdayRightScreen.x + saturdayRightScreen.width),
    ),
  ).toBeLessThan(2);
  expect(saturdayRightScreen.x - marketRightScreen.x).toBeGreaterThan(40);
  const notesAfterRight = (await notes.boundingBox())!;
  expect(Math.abs(notesAfterRight.x - notesSelected.x)).toBeLessThan(2);
  expect(Math.abs(notesAfterRight.y - notesSelected.y)).toBeLessThan(2);
  await beat(page, 900);

  await caption(
    page,
    "Align bottom moves Market down to Saturday's bottom. The right edges stay together. Notes does not move.",
  );
  await alignBottom.click();
  const lined = {
    market: await place(page, "Market"),
    saturday: await place(page, "Saturday"),
    notes: await place(page, "Notes"),
  };
  expect(lined.saturday).toEqual(before.saturday);
  expect(bottomOf(lined.market)).toBe(bottomOf(before.saturday));
  expect(rightOf(lined.market)).toBe(rightOf(before.saturday));
  expect(lined.market.x).toBe(linedRight.market.x);
  expect(lined.market.width).toBe(before.market.width);
  expect(lined.market.height).toBe(before.market.height);
  expect(lined.market.content).toBe("Market");
  expect(lined.saturday.content).toBe("Saturday");
  expect(lined.notes).toEqual(before.notes);
  await expect(market.locator("textarea")).toHaveValue("Market");
  await expect(saturday.locator("textarea")).toHaveValue("Saturday");
  const marketBottomScreen = (await market.boundingBox())!;
  const saturdayBottomScreen = (await saturday.boundingBox())!;
  const notesBottomScreen = (await notes.boundingBox())!;
  expect(
    Math.abs(
      marketBottomScreen.y +
        marketBottomScreen.height -
        (saturdayBottomScreen.y + saturdayBottomScreen.height),
    ),
  ).toBeLessThan(2);
  expect(
    Math.abs(
      marketBottomScreen.x +
        marketBottomScreen.width -
        (saturdayBottomScreen.x + saturdayBottomScreen.width),
    ),
  ).toBeLessThan(2);
  expect(saturdayBottomScreen.x - marketBottomScreen.x).toBeGreaterThan(40);
  expect(Math.abs(notesBottomScreen.x - notesSelected.x)).toBeLessThan(2);
  expect(Math.abs(notesBottomScreen.y - notesSelected.y)).toBeLessThan(2);
  await beat(page, 900);

  await caption(
    page,
    "She clicks only Market. Align right and Align bottom go away, and Market stays put.",
  );
  // Saturday covers Market's right side, so the click lands on the visible word.
  await market.locator("textarea").click({ position: { x: 28, y: 22 } });
  await expect(market).toHaveAttribute("data-selected", "true");
  await expect(saturday).toHaveAttribute("data-selected", "false");
  await expect(page.locator("button", { hasText: "Align right" })).toHaveCount(
    0,
  );
  await expect(page.locator("button", { hasText: "Align bottom" })).toHaveCount(
    0,
  );
  await expect(page.locator("button", { hasText: "Align left" })).toHaveCount(
    0,
  );
  await expect(page.locator("button", { hasText: "Align top" })).toHaveCount(0);
  expect(await place(page, "Market")).toEqual(lined.market);
  expect(rightOf(await place(page, "Market"))).not.toBe(960);
  await beat(page, 800);

  await caption(
    page,
    "She saves, goes home, and opens the deck again. The shared right edge, the shared bottom, the words, and Notes are still there.",
  );
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await beat(page, 700);
  await page
    .getByRole("link", { name: "Saturday market", exact: true })
    .click();
  await expect(page.locator(".slides-editor")).toBeVisible();
  const reopenedMarketBox = await box(page, "Market");
  const reopenedSaturdayBox = await box(page, "Saturday");
  const reopenedNotesBox = await box(page, "Notes");
  const again = {
    market: await place(page, "Market"),
    saturday: await place(page, "Saturday"),
    notes: await place(page, "Notes"),
  };
  expect(rightOf(again.market)).toBe(rightOf(again.saturday));
  expect(bottomOf(again.market)).toBe(bottomOf(again.saturday));
  expect(again.market.x).not.toBe(again.saturday.x);
  expect(again.market.content).toBe("Market");
  expect(again.saturday.content).toBe("Saturday");
  expect(again.market.width).toBe(before.market.width);
  expect(again.saturday.width).toBe(before.saturday.width);
  expect(again.notes).toEqual(before.notes);
  const reopenedMarket = (await reopenedMarketBox.boundingBox())!;
  const reopenedSaturday = (await reopenedSaturdayBox.boundingBox())!;
  const reopenedNotes = (await reopenedNotesBox.boundingBox())!;
  expect(
    Math.abs(
      reopenedMarket.x +
        reopenedMarket.width -
        (reopenedSaturday.x + reopenedSaturday.width),
    ),
  ).toBeLessThan(2);
  expect(
    Math.abs(
      reopenedMarket.y +
        reopenedMarket.height -
        (reopenedSaturday.y + reopenedSaturday.height),
    ),
  ).toBeLessThan(2);
  expect(reopenedSaturday.x - reopenedMarket.x).toBeGreaterThan(40);
  expect(reopenedNotes.y).toBeLessThan(reopenedMarket.y);
  expect(reopenedNotes.x + reopenedNotes.width).toBeLessThan(
    reopenedSaturday.x,
  );
  await expect(reopenedMarketBox.locator("textarea")).toHaveValue("Market");
  await expect(reopenedSaturdayBox.locator("textarea")).toHaveValue("Saturday");
  await expect(reopenedNotesBox.locator("textarea")).toHaveValue("Notes");
  await beat(page, 1200);

  await caption(
    page,
    "She selects both again and chooses Align left. The left edges meet.",
  );
  // Saturday sits inside Market, and a selected Market covers it, so Saturday goes first.
  await reopenedSaturdayBox.locator("textarea").click();
  await beat(page, 400);
  await reopenedMarketBox.locator("textarea").click({
    modifiers: ["Shift"],
    position: { x: 28, y: 22 },
  });
  const notesWhileSelected = (await reopenedNotesBox.boundingBox())!;
  await expect(reopenedMarketBox).toHaveAttribute("data-selected", "true");
  await expect(reopenedSaturdayBox).toHaveAttribute("data-selected", "true");
  const alignLeftAgain = page.getByRole("button", {
    name: "Align left",
    exact: true,
  });
  const alignTopAgain = page.getByRole("button", {
    name: "Align top",
    exact: true,
  });
  await expect(alignLeftAgain).toBeVisible();
  await alignLeftAgain.click();
  await expect
    .poll(async () => (await place(page, "Saturday")).x)
    .toBe(again.market.x);
  const linedLeft = {
    market: await place(page, "Market"),
    saturday: await place(page, "Saturday"),
    notes: await place(page, "Notes"),
  };
  expect(linedLeft.market.x).toBe(again.market.x);
  expect(linedLeft.saturday.x).toBe(again.market.x);
  expect(linedLeft.saturday.width).toBe(before.saturday.width);
  expect(linedLeft.market.width).toBe(before.market.width);
  expect(linedLeft.saturday.content).toBe("Saturday");
  expect(linedLeft.notes).toEqual(before.notes);
  const leftMarket = (await reopenedMarketBox.boundingBox())!;
  const leftSaturday = (await reopenedSaturdayBox.boundingBox())!;
  expect(Math.abs(leftMarket.x - leftSaturday.x)).toBeLessThan(2);
  await beat(page, 800);

  await caption(
    page,
    "Align top still meets the tops. Notes stays where it was.",
  );
  await alignTopAgain.click();
  const linedTop = {
    market: await place(page, "Market"),
    saturday: await place(page, "Saturday"),
    notes: await place(page, "Notes"),
  };
  expect(linedTop.saturday.y).toBe(linedTop.market.y);
  expect(linedTop.saturday.x).toBe(linedLeft.saturday.x);
  expect(linedTop.saturday.width).toBe(before.saturday.width);
  expect(linedTop.saturday.content).toBe("Saturday");
  expect(linedTop.market.content).toBe("Market");
  expect(linedTop.notes).toEqual(before.notes);
  const topped = (await reopenedSaturdayBox.boundingBox())!;
  const toppedMarket = (await reopenedMarketBox.boundingBox())!;
  const notesLast = (await reopenedNotesBox.boundingBox())!;
  expect(Math.abs(topped.y - toppedMarket.y)).toBeLessThan(2);
  expect(Math.abs(topped.x - toppedMarket.x)).toBeLessThan(2);
  expect(Math.abs(notesLast.x - notesWhileSelected.x)).toBeLessThan(2);
  expect(Math.abs(notesLast.y - notesWhileSelected.y)).toBeLessThan(2);
  await beat(page, 1200);
});
