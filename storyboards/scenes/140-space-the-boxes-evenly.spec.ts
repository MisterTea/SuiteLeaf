import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { beat, caption, expect, test } from "./harness";

function boxOf(
  content: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  align: "left" | "center",
) {
  return {
    id: crypto.randomUUID(),
    type: "text",
    x,
    y,
    width,
    height,
    content,
    fontSize: 28,
    bold: true,
    align,
    color: "#202124",
    fill,
  };
}

function marketDeck() {
  const id = crypto.randomUUID();
  const acrossId = crypto.randomUUID();
  const downId = crypto.randomUUID();
  const now = new Date().toISOString();
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
      slideOrder: [acrossId, downId],
      slides: {
        [acrossId]: {
          id: acrossId,
          layout: "blank",
          notes: "",
          elements: [
            boxOf("Market", 36, 56, 250, 78, "#d2e3fc", "left"),
            boxOf("Saturday", 600, 56, 170, 78, "#ceead6", "center"),
            boxOf("Notes", 790, 56, 150, 78, "#feefc3", "left"),
            boxOf("Door", 36, 210, 170, 70, "#fad2cf", "left"),
          ],
        },
        [downId]: {
          id: downId,
          layout: "blank",
          notes: "",
          elements: [
            boxOf("Cedar", 64, 24, 230, 88, "#d2e3fc", "left"),
            boxOf("Maple", 380, 128, 150, 60, "#ceead6", "center"),
            boxOf("Plant", 150, 360, 200, 64, "#feefc3", "left"),
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

type Placed = {
  content?: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

async function place(page: Page, word: string): Promise<Placed> {
  const raw = await page
    .locator(".slides-editor")
    .getAttribute("data-deck-snapshot");
  const deck = JSON.parse(raw!) as {
    slides: Record<string, { elements: Placed[] }>;
  };
  for (const slide of Object.values(deck.slides)) {
    const found = slide.elements.find((el) => el.content === word);
    if (found) return found;
  }
  throw new Error(`No box named ${word}`);
}

const gapAcross = (left: Placed, right: Placed) => right.x - (left.x + left.width);
const gapDown = (upper: Placed, lower: Placed) =>
  lower.y - (upper.y + upper.height);

test("140-space-the-boxes-evenly", async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), "storyboard-140-"));
  const path = join(dir, "Saturday market.slslides");
  writeFileSync(path, JSON.stringify(marketDeck()));

  await page.goto("/");
  await caption(
    page,
    "Nia opens a deck. Market is on the left, Notes is on the right, and Saturday sits close to Notes. Door is below them.",
  );
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (await chooser).setFiles(path);
  await expect(page.locator(".slides-editor")).toBeVisible();
  await expect(page.getByLabel("File title")).toHaveValue("Saturday market");
  const market = await box(page, "Market");
  const saturday = await box(page, "Saturday");
  const notes = await box(page, "Notes");
  const door = await box(page, "Door");
  await expect(market).toBeVisible();
  await expect(saturday).toBeVisible();
  await expect(notes).toBeVisible();
  await expect(door).toBeVisible();
  const before = {
    market: await place(page, "Market"),
    saturday: await place(page, "Saturday"),
    notes: await place(page, "Notes"),
    door: await place(page, "Door"),
  };
  expect(before.market.width).not.toBe(before.saturday.width);
  expect(before.saturday.width).not.toBe(before.notes.width);
  expect(before.market.y).toBe(before.saturday.y);
  expect(before.notes.y).toBe(before.market.y);
  expect(gapAcross(before.market, before.saturday)).toBeGreaterThan(
    gapAcross(before.saturday, before.notes) + 100,
  );
  expect(before.door.y).toBeGreaterThan(before.market.y + before.market.height);
  const openingMarket = (await market.boundingBox())!;
  const openingSaturday = (await saturday.boundingBox())!;
  const openingNotes = (await notes.boundingBox())!;
  const openingDoor = (await door.boundingBox())!;
  expect(openingSaturday.x - (openingMarket.x + openingMarket.width)).toBeGreaterThan(
    openingNotes.x - (openingSaturday.x + openingSaturday.width) + 40,
  );
  expect(openingDoor.y).toBeGreaterThan(openingMarket.y + openingMarket.height);
  await beat(page, 800);

  await caption(
    page,
    "She Shift-clicks Market, Saturday, and Notes. Space evenly across appears, with Align still beside it.",
  );
  await market.locator("textarea").click();
  await beat(page, 400);
  await saturday.locator("textarea").click({ modifiers: ["Shift"] });
  await notes.locator("textarea").click({ modifiers: ["Shift"] });
  await expect(market).toHaveAttribute("data-selected", "true");
  await expect(saturday).toHaveAttribute("data-selected", "true");
  await expect(notes).toHaveAttribute("data-selected", "true");
  await expect(door).toHaveAttribute("data-selected", "false");
  const spaceAcross = page.getByRole("button", {
    name: "Space evenly across",
    exact: true,
  });
  const spaceDown = page.getByRole("button", {
    name: "Space evenly down",
    exact: true,
  });
  await expect(spaceAcross).toBeVisible();
  await expect(spaceDown).toBeVisible();
  await expect(page.getByRole("button", { name: "Align left", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Align right", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Align top", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Align bottom", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Arrange" })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const doorSelected = (await door.boundingBox())!;
  await beat(page, 900);

  await caption(
    page,
    "Space evenly across leaves Market and Notes where they are and moves Saturday so the gaps match. Door stays put.",
  );
  await spaceAcross.click();
  await expect
    .poll(async () => {
      const marketNow = await place(page, "Market");
      const saturdayNow = await place(page, "Saturday");
      const notesNow = await place(page, "Notes");
      return gapAcross(marketNow, saturdayNow) === gapAcross(saturdayNow, notesNow);
    })
    .toBe(true);
  const lined = {
    market: await place(page, "Market"),
    saturday: await place(page, "Saturday"),
    notes: await place(page, "Notes"),
    door: await place(page, "Door"),
  };
  expect(lined.market).toEqual(before.market);
  expect(lined.notes).toEqual(before.notes);
  expect(lined.door).toEqual(before.door);
  expect(lined.saturday.y).toBe(before.saturday.y);
  expect(lined.saturday.width).toBe(before.saturday.width);
  expect(lined.saturday.height).toBe(before.saturday.height);
  expect(lined.saturday.content).toBe("Saturday");
  expect(lined.saturday.x).not.toBe(before.saturday.x);
  expect(gapAcross(lined.market, lined.saturday)).toBe(
    gapAcross(lined.saturday, lined.notes),
  );
  await expect(market.locator("textarea")).toHaveValue("Market");
  await expect(saturday.locator("textarea")).toHaveValue("Saturday");
  await expect(notes.locator("textarea")).toHaveValue("Notes");
  await expect(door.locator("textarea")).toHaveValue("Door");
  const marketScreen = (await market.boundingBox())!;
  const saturdayScreen = (await saturday.boundingBox())!;
  const notesScreen = (await notes.boundingBox())!;
  const doorScreen = (await door.boundingBox())!;
  const screenGapLeft = saturdayScreen.x - (marketScreen.x + marketScreen.width);
  const screenGapRight = notesScreen.x - (saturdayScreen.x + saturdayScreen.width);
  expect(Math.abs(screenGapLeft - screenGapRight)).toBeLessThan(2);
  expect(Math.abs(marketScreen.x - openingMarket.x)).toBeLessThan(2);
  expect(Math.abs(notesScreen.x - openingNotes.x)).toBeLessThan(2);
  expect(Math.abs(saturdayScreen.x - openingSaturday.x)).toBeGreaterThan(40);
  expect(Math.abs(doorScreen.x - doorSelected.x)).toBeLessThan(2);
  expect(Math.abs(doorScreen.y - doorSelected.y)).toBeLessThan(2);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await beat(page, 1000);

  await caption(
    page,
    "On the next slide, Cedar, Maple, and Plant are stacked. The gap under Cedar is much smaller than the gap above Plant.",
  );
  await page.getByRole("option", { name: /Slide 2/ }).click();
  const cedar = await box(page, "Cedar");
  const maple = await box(page, "Maple");
  const birch = await box(page, "Plant");
  await expect(cedar).toBeVisible();
  await expect(maple).toBeVisible();
  await expect(birch).toBeVisible();
  const stacked = {
    cedar: await place(page, "Cedar"),
    maple: await place(page, "Maple"),
    birch: await place(page, "Plant"),
  };
  expect(gapDown(stacked.cedar, stacked.maple)).toBeLessThan(
    gapDown(stacked.maple, stacked.birch) - 80,
  );
  const openingMaple = (await maple.boundingBox())!;
  await beat(page, 800);

  await caption(
    page,
    "She Shift-clicks the three boxes and chooses Space evenly down. Cedar and Plant stay. Maple moves. Their horizontal positions stay.",
  );
  await cedar.locator("textarea").click();
  await beat(page, 300);
  await maple.locator("textarea").click({ modifiers: ["Shift"] });
  await birch.locator("textarea").click({ modifiers: ["Shift"] });
  await expect(page.getByRole("button", { name: "Space evenly down", exact: true })).toBeVisible();
  await beat(page, 600);
  await page.getByRole("button", { name: "Space evenly down", exact: true }).click();
  await expect
    .poll(async () => {
      const cedarNow = await place(page, "Cedar");
      const mapleNow = await place(page, "Maple");
      const birchNow = await place(page, "Plant");
      return gapDown(cedarNow, mapleNow) === gapDown(mapleNow, birchNow);
    })
    .toBe(true);
  const dropped = {
    cedar: await place(page, "Cedar"),
    maple: await place(page, "Maple"),
    birch: await place(page, "Plant"),
  };
  expect(dropped.cedar).toEqual(stacked.cedar);
  expect(dropped.birch).toEqual(stacked.birch);
  expect(dropped.maple.x).toBe(stacked.maple.x);
  expect(dropped.maple.width).toBe(stacked.maple.width);
  expect(dropped.maple.height).toBe(stacked.maple.height);
  expect(dropped.maple.content).toBe("Maple");
  expect(dropped.maple.y).not.toBe(stacked.maple.y);
  expect(gapDown(dropped.cedar, dropped.maple)).toBe(
    gapDown(dropped.maple, dropped.birch),
  );
  const mapleScreen = (await maple.boundingBox())!;
  const cedarScreen = (await cedar.boundingBox())!;
  const birchScreen = (await birch.boundingBox())!;
  const screenGapUpper = mapleScreen.y - (cedarScreen.y + cedarScreen.height);
  const screenGapLower = birchScreen.y - (mapleScreen.y + mapleScreen.height);
  expect(Math.abs(screenGapUpper - screenGapLower)).toBeLessThan(2);
  expect(Math.abs(mapleScreen.y - openingMaple.y)).toBeGreaterThan(20);
  expect(Math.abs(mapleScreen.x - openingMaple.x)).toBeLessThan(2);
  await expect(cedar.locator("textarea")).toHaveValue("Cedar");
  await expect(maple.locator("textarea")).toHaveValue("Maple");
  await expect(birch.locator("textarea")).toHaveValue("Plant");
  await beat(page, 1200);

  await page.getByRole("option", { name: /Slide 1/ }).click();
  const marketAgain = await box(page, "Market");
  const notesAgain = await box(page, "Notes");
  const saturdayAgain = await box(page, "Saturday");
  const doorAgain = await box(page, "Door");
  await marketAgain.locator("textarea").click();
  await beat(page, 300);
  await notesAgain.locator("textarea").click({ modifiers: ["Shift"] });
  await expect(marketAgain).toHaveAttribute("data-selected", "true");
  await expect(notesAgain).toHaveAttribute("data-selected", "true");
  await expect(saturdayAgain).toHaveAttribute("data-selected", "false");
  await expect(doorAgain).toHaveAttribute("data-selected", "false");
  await expect(page.getByRole("button", { name: "Space evenly across", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Space evenly down", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Align left", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Align right", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Arrange" })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await caption(
    page,
    "With only Market and Notes selected, Space evenly across and Space evenly down are not offered. Align left still is.",
  );
  expect(await place(page, "Market")).toEqual(lined.market);
  expect(await place(page, "Saturday")).toEqual(lined.saturday);
  expect(await place(page, "Notes")).toEqual(lined.notes);
  expect(await place(page, "Door")).toEqual(lined.door);
  await beat(page, 900);

  await caption(
    page,
    "She saves, goes home, and opens the deck again. The even gaps, the words, and Door are still there.",
  );
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await beat(page, 700);
  await page.getByRole("link", { name: "Saturday market", exact: true }).click();
  await expect(page.locator(".slides-editor")).toBeVisible();
  const reopenedMarket = await box(page, "Market");
  const reopenedSaturday = await box(page, "Saturday");
  const reopenedNotes = await box(page, "Notes");
  const reopenedDoor = await box(page, "Door");
  const again = {
    market: await place(page, "Market"),
    saturday: await place(page, "Saturday"),
    notes: await place(page, "Notes"),
    door: await place(page, "Door"),
    maple: await place(page, "Maple"),
    cedar: await place(page, "Cedar"),
    birch: await place(page, "Plant"),
  };
  expect(gapAcross(again.market, again.saturday)).toBe(
    gapAcross(again.saturday, again.notes),
  );
  expect(again.market).toEqual(lined.market);
  expect(again.saturday).toEqual(lined.saturday);
  expect(again.notes).toEqual(lined.notes);
  expect(again.door).toEqual(before.door);
  expect(again.maple.y).toBe(dropped.maple.y);
  expect(again.maple.x).toBe(dropped.maple.x);
  expect(again.cedar).toEqual(dropped.cedar);
  expect(again.birch).toEqual(dropped.birch);
  await expect(reopenedMarket.locator("textarea")).toHaveValue("Market");
  await expect(reopenedSaturday.locator("textarea")).toHaveValue("Saturday");
  await expect(reopenedNotes.locator("textarea")).toHaveValue("Notes");
  await expect(reopenedDoor.locator("textarea")).toHaveValue("Door");
  const reopenedMarketBox = (await reopenedMarket.boundingBox())!;
  const reopenedSaturdayBox = (await reopenedSaturday.boundingBox())!;
  const reopenedNotesBox = (await reopenedNotes.boundingBox())!;
  const reopenedDoorBox = (await reopenedDoor.boundingBox())!;
  expect(
    Math.abs(
      reopenedSaturdayBox.x -
        (reopenedMarketBox.x + reopenedMarketBox.width) -
        (reopenedNotesBox.x - (reopenedSaturdayBox.x + reopenedSaturdayBox.width)),
    ),
  ).toBeLessThan(2);
  expect(Math.abs(reopenedDoorBox.x - openingDoor.x)).toBeLessThan(2);
  expect(Math.abs(reopenedDoorBox.y - openingDoor.y)).toBeLessThan(2);
  expect(reopenedDoorBox.y).toBeGreaterThan(
    reopenedMarketBox.y + reopenedMarketBox.height,
  );
  await beat(page, 1200);
});
