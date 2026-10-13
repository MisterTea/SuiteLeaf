import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { beat, caption, expect, test } from "./harness";

function boxOf(
  content: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
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
    align: "left",
    color: "#202124",
    fill,
  };
}

function marketDeck() {
  const id = crypto.randomUUID();
  const slideId = crypto.randomUUID();
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
      slideOrder: [slideId],
      slides: {
        [slideId]: {
          id: slideId,
          layout: "blank",
          notes: "",
          elements: [
            boxOf("Market", 56, 140, 240, 78, "#d2e3fc"),
            boxOf("Saturday", 360, 140, 190, 78, "#ceead6"),
            boxOf("Notes", 680, 340, 200, 72, "#feefc3"),
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
  groupId?: string;
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

async function onCanvas(page: Page, target: Locator) {
  const canvas = (await page.locator(".slide-canvas").boundingBox())!;
  const box = (await target.boundingBox())!;
  return {
    x: box.x - canvas.x,
    y: box.y - canvas.y,
    width: box.width,
    height: box.height,
  };
}

async function drag(page: Page, target: Locator, dx: number, dy: number) {
  const box = (await target.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: 8 });
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 24 });
  await page.mouse.up();
}

const groupButton = (page: Page) =>
  page.getByRole("button", { name: "Group", exact: true });
const ungroupButton = (page: Page) =>
  page.getByRole("button", { name: "Ungroup", exact: true });

test("142-move-the-pair-together", async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), "storyboard-142-"));
  const path = join(dir, "Saturday market.slslides");
  writeFileSync(path, JSON.stringify(marketDeck()));

  await page.goto("/");
  await caption(
    page,
    "Nia opens a deck. Market and Saturday are separate boxes. Notes sits apart.",
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
  const opening = {
    market: await place(page, "Market"),
    saturday: await place(page, "Saturday"),
    notes: await place(page, "Notes"),
  };
  expect(opening.market.groupId).toBeUndefined();
  expect(opening.saturday.groupId).toBeUndefined();
  expect(opening.notes.groupId).toBeUndefined();
  expect(opening.saturday.x).toBeGreaterThan(
    opening.market.x + opening.market.width,
  );
  expect(opening.notes.y).toBeGreaterThan(
    opening.market.y + opening.market.height,
  );
  await beat(page, 700);

  await caption(
    page,
    "She selects all three. Space evenly across and the align commands are still here. They are not a group.",
  );
  await market.locator("textarea").click();
  await beat(page, 200);
  await saturday.locator("textarea").click({ modifiers: ["Shift"] });
  await notes.locator("textarea").click({ modifiers: ["Shift"] });
  await expect(market).toHaveAttribute("data-selected", "true");
  await expect(saturday).toHaveAttribute("data-selected", "true");
  await expect(notes).toHaveAttribute("data-selected", "true");
  await expect(groupButton(page)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Space evenly across", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Space evenly down", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Align left", exact: true }),
  ).toBeVisible();
  await beat(page, 500);
  await page
    .getByRole("button", { name: "Space evenly across", exact: true })
    .click();
  const spacedSaturday = await place(page, "Saturday");
  expect(spacedSaturday.x).not.toBe(opening.saturday.x);
  expect(spacedSaturday.y).toBe(opening.saturday.y);
  expect(spacedSaturday.width).toBe(opening.saturday.width);
  expect(spacedSaturday.content).toBe("Saturday");
  expect(await place(page, "Market")).toEqual(opening.market);
  expect(await place(page, "Notes")).toEqual(opening.notes);
  await beat(page, 700);
  await caption(page, "Undo puts Saturday back.");
  await page.getByRole("button", { name: "Undo (Cmd+Z)" }).click();
  expect(await place(page, "Market")).toEqual(opening.market);
  expect(await place(page, "Saturday")).toEqual(opening.saturday);
  expect(await place(page, "Notes")).toEqual(opening.notes);
  await beat(page, 400);

  await caption(page, "With only Market selected, Group is not offered.");
  await market.locator("textarea").click();
  await expect(market).toHaveAttribute("data-selected", "true");
  await expect(saturday).toHaveAttribute("data-selected", "false");
  await expect(notes).toHaveAttribute("data-selected", "false");
  await expect(groupButton(page)).toHaveCount(0);
  await expect(ungroupButton(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Arrange" })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await beat(page, 800);

  await caption(
    page,
    "She Shift-clicks Notes. Align left is here, with the other align commands. Group is one click. There is no Arrange menu.",
  );
  await notes.locator("textarea").click({ modifiers: ["Shift"] });
  await expect(market).toHaveAttribute("data-selected", "true");
  await expect(notes).toHaveAttribute("data-selected", "true");
  await expect(saturday).toHaveAttribute("data-selected", "false");
  await expect(groupButton(page)).toBeVisible();
  await expect(ungroupButton(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Align left", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Align right", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Align top", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Align bottom", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Arrange" })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await beat(page, 800);

  await caption(
    page,
    "Align left lines Notes up with Market. Saturday stays where it is, and every word stays the same.",
  );
  await page.getByRole("button", { name: "Align left", exact: true }).click();
  const aligned = {
    market: await place(page, "Market"),
    saturday: await place(page, "Saturday"),
    notes: await place(page, "Notes"),
  };
  expect(aligned.market).toEqual(opening.market);
  expect(aligned.saturday).toEqual(opening.saturday);
  expect(aligned.notes.x).toBe(aligned.market.x);
  expect(aligned.notes.y).toBe(opening.notes.y);
  expect(aligned.notes.width).toBe(opening.notes.width);
  expect(aligned.notes.height).toBe(opening.notes.height);
  expect(aligned.notes.content).toBe("Notes");
  expect(aligned.notes.groupId).toBeUndefined();
  await expect(market.locator("textarea")).toHaveValue("Market");
  await expect(saturday.locator("textarea")).toHaveValue("Saturday");
  await expect(notes.locator("textarea")).toHaveValue("Notes");
  const notesScreen = (await notes.boundingBox())!;
  const marketScreen = (await market.boundingBox())!;
  expect(Math.abs(notesScreen.x - marketScreen.x)).toBeLessThan(2);
  await beat(page, 900);

  await caption(
    page,
    "She Shift-clicks Market and Saturday. Group joins them. The control then reads Ungroup.",
  );
  await market.locator("textarea").click();
  await beat(page, 250);
  await saturday.locator("textarea").click({ modifiers: ["Shift"] });
  await expect(market).toHaveAttribute("data-selected", "true");
  await expect(saturday).toHaveAttribute("data-selected", "true");
  await expect(notes).toHaveAttribute("data-selected", "false");
  await expect(groupButton(page)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await beat(page, 500);
  await groupButton(page).click();
  await expect(ungroupButton(page)).toBeVisible();
  await expect(groupButton(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Arrange" })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const grouped = {
    market: await place(page, "Market"),
    saturday: await place(page, "Saturday"),
    notes: await place(page, "Notes"),
  };
  expect(grouped.market.groupId).toBeTruthy();
  expect(grouped.market.groupId).toBe(grouped.saturday.groupId);
  expect(grouped.notes.groupId).toBeUndefined();
  expect(grouped.market.x).toBe(aligned.market.x);
  expect(grouped.market.y).toBe(aligned.market.y);
  expect(grouped.saturday).toMatchObject({
    x: aligned.saturday.x,
    y: aligned.saturday.y,
    width: aligned.saturday.width,
    height: aligned.saturday.height,
    content: "Saturday",
  });
  await beat(page, 700);

  await caption(
    page,
    "She drags Market. Saturday moves by the same amount. The gap stays. Notes does not move.",
  );
  await page.locator(".slide-canvas").click({ position: { x: 16, y: 16 } });
  await market.locator("textarea").click();
  await expect(market).toHaveAttribute("data-selected", "true");
  await expect(saturday).toHaveAttribute("data-selected", "true");
  await expect(notes).toHaveAttribute("data-selected", "false");
  await expect(ungroupButton(page)).toBeVisible();
  const beforeDragMarket = await onCanvas(page, market);
  const beforeDragSaturday = await onCanvas(page, saturday);
  const beforeDragNotes = await onCanvas(page, notes);
  await beat(page, 400);
  await drag(page, market, 170, 0);
  await expect
    .poll(async () => (await place(page, "Saturday")).x)
    .toBe(
      grouped.saturday.x + ((await place(page, "Market")).x - grouped.market.x),
    );
  const slid = {
    market: await place(page, "Market"),
    saturday: await place(page, "Saturday"),
    notes: await place(page, "Notes"),
  };
  const pairDx = slid.market.x - grouped.market.x;
  const pairDy = slid.market.y - grouped.market.y;
  expect(pairDx).not.toBe(0);
  expect(slid.saturday.x - grouped.saturday.x).toBe(pairDx);
  expect(slid.saturday.y - grouped.saturday.y).toBe(pairDy);
  expect(slid.saturday.x - slid.market.x).toBe(
    grouped.saturday.x - grouped.market.x,
  );
  expect(slid.market.width).toBe(grouped.market.width);
  expect(slid.market.height).toBe(grouped.market.height);
  expect(slid.saturday.width).toBe(grouped.saturday.width);
  expect(slid.saturday.height).toBe(grouped.saturday.height);
  expect(slid.market.content).toBe("Market");
  expect(slid.saturday.content).toBe("Saturday");
  expect(slid.market.groupId).toBe(grouped.market.groupId);
  expect(slid.saturday.groupId).toBe(grouped.saturday.groupId);
  expect(slid.notes).toEqual(grouped.notes);
  await expect(market.locator("textarea")).toHaveValue("Market");
  await expect(saturday.locator("textarea")).toHaveValue("Saturday");
  await expect(notes.locator("textarea")).toHaveValue("Notes");
  const slidMarket = await onCanvas(page, market);
  const slidSaturday = await onCanvas(page, saturday);
  const slidNotes = await onCanvas(page, notes);
  const screenDx = slidMarket.x - beforeDragMarket.x;
  expect(Math.abs(screenDx)).toBeGreaterThan(60);
  expect(
    Math.abs(slidSaturday.x - beforeDragSaturday.x - screenDx),
  ).toBeLessThan(2);
  expect(Math.abs(slidSaturday.y - beforeDragSaturday.y)).toBeLessThan(2);
  expect(Math.abs(slidNotes.x - beforeDragNotes.x)).toBeLessThan(2);
  expect(Math.abs(slidNotes.y - beforeDragNotes.y)).toBeLessThan(2);
  await beat(page, 900);

  await caption(
    page,
    "Ungroup leaves the boxes where the pair landed. The next drag moves only Market. Saturday stays.",
  );
  await ungroupButton(page).click();
  await expect(groupButton(page)).toBeVisible();
  await expect(ungroupButton(page)).toHaveCount(0);
  const ungrouped = {
    market: await place(page, "Market"),
    saturday: await place(page, "Saturday"),
    notes: await place(page, "Notes"),
  };
  expect(ungrouped.market.groupId).toBeUndefined();
  expect(ungrouped.saturday.groupId).toBeUndefined();
  expect(ungrouped.market.x).toBe(slid.market.x);
  expect(ungrouped.market.y).toBe(slid.market.y);
  expect(ungrouped.saturday.x).toBe(slid.saturday.x);
  expect(ungrouped.saturday.y).toBe(slid.saturday.y);
  expect(ungrouped.notes).toEqual(slid.notes);
  const parkedSaturday = await onCanvas(page, saturday);
  const parkedNotes = await onCanvas(page, notes);
  await beat(page, 600);
  await drag(page, market, 0, -90);
  const alone = {
    market: await place(page, "Market"),
    saturday: await place(page, "Saturday"),
    notes: await place(page, "Notes"),
  };
  expect(alone.market.y).toBeLessThan(ungrouped.market.y);
  expect(alone.market.x).toBe(ungrouped.market.x);
  expect(alone.saturday).toMatchObject({
    x: ungrouped.saturday.x,
    y: ungrouped.saturday.y,
    width: ungrouped.saturday.width,
    height: ungrouped.saturday.height,
    content: "Saturday",
  });
  expect(alone.saturday.groupId).toBeUndefined();
  expect(alone.notes).toEqual(ungrouped.notes);
  expect(alone.market.content).toBe("Market");
  await expect(saturday.locator("textarea")).toHaveValue("Saturday");
  await expect(notes.locator("textarea")).toHaveValue("Notes");
  const aloneSaturday = await onCanvas(page, saturday);
  const aloneNotes = await onCanvas(page, notes);
  const aloneMarket = await onCanvas(page, market);
  expect(Math.abs(aloneSaturday.x - parkedSaturday.x)).toBeLessThan(2);
  expect(Math.abs(aloneSaturday.y - parkedSaturday.y)).toBeLessThan(2);
  expect(Math.abs(aloneNotes.x - parkedNotes.x)).toBeLessThan(2);
  expect(Math.abs(aloneNotes.y - parkedNotes.y)).toBeLessThan(2);
  expect(aloneMarket.y).toBeLessThan(parkedSaturday.y - 20);
  await beat(page, 800);

  await caption(page, "She groups Market and Saturday again.");
  await saturday.locator("textarea").click({ modifiers: ["Shift"] });
  await expect(market).toHaveAttribute("data-selected", "true");
  await expect(saturday).toHaveAttribute("data-selected", "true");
  await expect(notes).toHaveAttribute("data-selected", "false");
  await expect(groupButton(page)).toBeVisible();
  await groupButton(page).click();
  await expect(ungroupButton(page)).toBeVisible();
  const again = {
    market: await place(page, "Market"),
    saturday: await place(page, "Saturday"),
    notes: await place(page, "Notes"),
  };
  expect(again.market.groupId).toBeTruthy();
  expect(again.market.groupId).toBe(again.saturday.groupId);
  expect(again.market.groupId).not.toBe(grouped.market.groupId);
  expect(again.notes.groupId).toBeUndefined();
  expect(again.market.x).toBe(alone.market.x);
  expect(again.market.y).toBe(alone.market.y);
  expect(again.saturday.x).toBe(alone.saturday.x);
  expect(again.saturday.y).toBe(alone.saturday.y);
  await beat(page, 600);

  await caption(
    page,
    "She saves, goes home, and opens the deck again. The pair is still one group.",
  );
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await beat(page, 700);
  await page
    .getByRole("link", { name: "Saturday market", exact: true })
    .click();
  await expect(page.locator(".slides-editor")).toBeVisible();
  const reopenedMarket = await box(page, "Market");
  const reopenedSaturday = await box(page, "Saturday");
  const reopenedNotes = await box(page, "Notes");
  const reopened = {
    market: await place(page, "Market"),
    saturday: await place(page, "Saturday"),
    notes: await place(page, "Notes"),
  };
  expect(reopened.market).toEqual(again.market);
  expect(reopened.saturday).toEqual(again.saturday);
  expect(reopened.notes).toEqual(again.notes);
  expect(reopened.market.groupId).toBe(reopened.saturday.groupId);
  await expect(reopenedMarket.locator("textarea")).toHaveValue("Market");
  await expect(reopenedSaturday.locator("textarea")).toHaveValue("Saturday");
  await expect(reopenedNotes.locator("textarea")).toHaveValue("Notes");
  await beat(page, 500);

  await caption(
    page,
    "Dragging Market still moves Saturday with it. Notes stays put.",
  );
  await reopenedMarket.locator("textarea").click();
  await expect(reopenedMarket).toHaveAttribute("data-selected", "true");
  await expect(reopenedSaturday).toHaveAttribute("data-selected", "true");
  await expect(reopenedNotes).toHaveAttribute("data-selected", "false");
  await expect(ungroupButton(page)).toBeVisible();
  await expect(groupButton(page)).toHaveCount(0);
  const reopenMarketBox = await onCanvas(page, reopenedMarket);
  const reopenSaturdayBox = await onCanvas(page, reopenedSaturday);
  const reopenNotesBox = await onCanvas(page, reopenedNotes);
  await beat(page, 400);
  await drag(page, reopenedMarket, 120, 0);
  const followed = {
    market: await place(page, "Market"),
    saturday: await place(page, "Saturday"),
    notes: await place(page, "Notes"),
  };
  const againDx = followed.market.x - reopened.market.x;
  expect(againDx).not.toBe(0);
  expect(followed.saturday.x - reopened.saturday.x).toBe(againDx);
  expect(followed.saturday.y).toBe(reopened.saturday.y);
  expect(followed.market.y).toBe(reopened.market.y);
  expect(followed.market.width).toBe(reopened.market.width);
  expect(followed.saturday.width).toBe(reopened.saturday.width);
  expect(followed.saturday.height).toBe(reopened.saturday.height);
  expect(followed.market.content).toBe("Market");
  expect(followed.saturday.content).toBe("Saturday");
  expect(followed.notes).toEqual(reopened.notes);
  expect(followed.market.groupId).toBe(reopened.market.groupId);
  await expect(reopenedMarket.locator("textarea")).toHaveValue("Market");
  await expect(reopenedSaturday.locator("textarea")).toHaveValue("Saturday");
  await expect(reopenedNotes.locator("textarea")).toHaveValue("Notes");
  const followedMarket = await onCanvas(page, reopenedMarket);
  const followedSaturday = await onCanvas(page, reopenedSaturday);
  const followedNotes = await onCanvas(page, reopenedNotes);
  const reopenDx = followedMarket.x - reopenMarketBox.x;
  expect(Math.abs(reopenDx)).toBeGreaterThan(40);
  expect(
    Math.abs(followedSaturday.x - reopenSaturdayBox.x - reopenDx),
  ).toBeLessThan(2);
  expect(Math.abs(followedSaturday.y - reopenSaturdayBox.y)).toBeLessThan(2);
  expect(Math.abs(followedNotes.x - reopenNotesBox.x)).toBeLessThan(2);
  expect(Math.abs(followedNotes.y - reopenNotesBox.y)).toBeLessThan(2);
  await beat(page, 1200);
});
