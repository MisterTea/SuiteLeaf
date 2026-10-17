import { expect, test, type Locator, type Page } from "@playwright/test";

const menuBar = (page: Page) => page.locator(".file-menu");

const GOLD = { fill: "#e6ac00", stroke: "#3a2504" };
const BLUE = { fill: "#1565c0", stroke: "#0a1840" };

function channels(color: string) {
  return (color.match(/\d+(?:\.\d+)?/g) ?? [])
    .slice(0, 3)
    .map((part) => Math.round(Number(part)));
}

function rgb(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

type SavedArt = {
  content?: string;
  wordArt?: string;
  color?: string;
  stroke?: string;
  fontSize?: number;
  x: number;
  y: number;
};

async function savedArts(page: Page): Promise<SavedArt[]> {
  const raw = await page.locator(".slides-editor").getAttribute("data-deck-snapshot");
  const deck = JSON.parse(raw ?? "{}") as {
    slideOrder: string[];
    slides: Record<string, { elements: SavedArt[] }>;
  };
  const slide = deck.slides[deck.slideOrder[0]];
  return slide.elements.filter((el) => el.wordArt);
}

async function painted(art: Locator) {
  return art.evaluate((el) => {
    const mirror = el.querySelector<HTMLElement>(".slide-spell-mirror");
    const area = el.querySelector<HTMLElement>("textarea");
    const node = mirror ?? area ?? el;
    const style = getComputedStyle(node);
    return {
      color: style.color,
      stroke: style.getPropertyValue("-webkit-text-stroke-color").trim(),
      fontSize: Number.parseFloat(getComputedStyle(el).fontSize),
    };
  });
}

async function openWordArt(page: Page) {
  await menuBar(page).getByRole("button", { name: "Insert", exact: true }).click();
  await page.getByRole("menuitem", { name: "Word art", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Word art" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("word art keeps its words, style, and position", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await page.getByRole("button", { name: "New presentation" }).click();
  await expect(page.locator(".slides-editor")).toBeVisible();
  await page.getByLabel("File title").fill("Garden word art");

  const onSlide = () => page.locator(".slide-canvas [data-word-art]");
  await expect(onSlide()).toHaveCount(0);

  const cancelled = await openWordArt(page);
  await cancelled.getByLabel("Text").fill("Nope");
  await cancelled.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(cancelled).toHaveCount(0);
  await expect(onSlide()).toHaveCount(0);

  const dialog = await openWordArt(page);
  const insert = dialog.getByRole("button", { name: "Insert", exact: true });
  await expect(insert).toBeDisabled();
  await dialog.getByLabel("Text").fill("   ");
  await expect(insert).toBeDisabled();
  await dialog.getByLabel("Text").fill("");
  await dialog.getByLabel("Text").press("Enter");
  await expect(dialog).toBeVisible();
  await expect(onSlide()).toHaveCount(0);
  expect(await savedArts(page)).toEqual([]);

  await dialog.getByLabel("Text").fill("Garden club");
  await dialog.getByLabel("Style").selectOption({ label: "Gold" });
  await expect(insert).toBeEnabled();
  await insert.click();
  await expect(dialog).toHaveCount(0);

  const gold = page.locator('.slide-canvas [data-word-art="gold"]');
  await expect(gold).toBeVisible();
  await expect(gold.locator("textarea")).toHaveValue("Garden club");
  const look = await painted(gold);
  expect(channels(look.color)).toEqual(rgb(GOLD.fill));
  expect(channels(look.stroke)).toEqual(rgb(GOLD.stroke));
  expect(look.fontSize).toBeGreaterThanOrEqual(36);
  const bodySize = await page
    .locator(".slide-canvas .slide-text:not([data-word-art])")
    .first()
    .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
  expect(look.fontSize).toBeGreaterThan(bodySize);

  const before = await gold.boundingBox();
  expect(before).not.toBeNull();
  const startX = await gold.getAttribute("data-x");
  const startY = await gold.getAttribute("data-y");
  await page.mouse.move(before!.x + before!.width / 2, before!.y + before!.height / 2);
  await page.mouse.down();
  await page.mouse.move(before!.x + before!.width / 2 + 90, before!.y + before!.height / 2 + 60, {
    steps: 12,
  });
  await page.mouse.up();
  await expect.poll(async () => gold.getAttribute("data-x")).not.toBe(startX);
  const after = await gold.boundingBox();
  expect(after).not.toBeNull();
  expect(Math.hypot(after!.x - before!.x, after!.y - before!.y)).toBeGreaterThan(20);
  const movedX = await gold.getAttribute("data-x");
  const movedY = await gold.getAttribute("data-y");
  expect(movedX).not.toBe(startX);
  expect(movedY).not.toBe(startY);

  let stored = (await savedArts(page)).find((el) => el.wordArt === "gold");
  expect(stored?.content).toBe("Garden club");
  expect(stored?.color?.toLowerCase()).toBe(GOLD.fill);
  expect(stored?.stroke?.toLowerCase()).toBe(GOLD.stroke);
  expect(stored?.fontSize).toBeGreaterThanOrEqual(36);
  expect(String(stored?.x)).toBe(movedX);
  expect(String(stored?.y)).toBe(movedY);

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Garden word art" }).click();
  await expect(page.locator(".slides-editor")).toBeVisible();
  await expect(gold.locator("textarea")).toHaveValue("Garden club");
  await expect(gold).toHaveAttribute("data-x", movedX!);
  await expect(gold).toHaveAttribute("data-y", movedY!);
  const reopened = await painted(gold);
  expect(channels(reopened.color)).toEqual(rgb(GOLD.fill));
  expect(channels(reopened.stroke)).toEqual(rgb(GOLD.stroke));
  expect(reopened.fontSize).toBeGreaterThanOrEqual(36);
  stored = (await savedArts(page)).find((el) => el.wordArt === "gold");
  expect(stored?.wordArt).toBe("gold");
  expect(stored?.content).toBe("Garden club");
  expect(stored?.color?.toLowerCase()).toBe(GOLD.fill);
  expect(stored?.stroke?.toLowerCase()).toBe(GOLD.stroke);
  expect(String(stored?.x)).toBe(movedX);
  expect(String(stored?.y)).toBe(movedY);

  const again = await openWordArt(page);
  await again.getByLabel("Text").fill("Spring");
  await again.getByLabel("Style").selectOption({ label: "Blue" });
  await again.getByRole("button", { name: "Insert", exact: true }).click();
  const blue = page.locator('.slide-canvas [data-word-art="blue"]');
  await expect(blue.locator("textarea")).toHaveValue("Spring");
  await expect(gold.locator("textarea")).toHaveValue("Garden club");
  const blueLook = await painted(blue);
  expect(channels(blueLook.color)).toEqual(rgb(BLUE.fill));
  expect(channels(blueLook.stroke)).toEqual(rgb(BLUE.stroke));
  expect(blueLook.fontSize).toBeGreaterThanOrEqual(36);

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Garden word art" }).click();
  await expect(page.locator(".slides-editor")).toBeVisible();
  await expect(onSlide()).toHaveCount(2);
  await expect(gold.locator("textarea")).toHaveValue("Garden club");
  await expect(blue.locator("textarea")).toHaveValue("Spring");
  await expect(gold).toHaveAttribute("data-x", movedX!);
  await expect(gold).toHaveAttribute("data-y", movedY!);
  const both = await savedArts(page);
  const savedGold = both.find((el) => el.wordArt === "gold");
  const savedBlue = both.find((el) => el.wordArt === "blue");
  expect(savedGold?.content).toBe("Garden club");
  expect(savedGold?.color?.toLowerCase()).toBe(GOLD.fill);
  expect(savedGold?.stroke?.toLowerCase()).toBe(GOLD.stroke);
  expect(String(savedGold?.x)).toBe(movedX);
  expect(String(savedGold?.y)).toBe(movedY);
  expect(savedBlue?.content).toBe("Spring");
  expect(savedBlue?.color?.toLowerCase()).toBe(BLUE.fill);
  expect(savedBlue?.stroke?.toLowerCase()).toBe(BLUE.stroke);
  expect(savedBlue?.fontSize).toBeGreaterThanOrEqual(36);
  const blueAgain = await painted(blue);
  const goldAgain = await painted(gold);
  expect(channels(blueAgain.color)).toEqual(rgb(BLUE.fill));
  expect(channels(goldAgain.color)).toEqual(rgb(GOLD.fill));
  expect(channels(goldAgain.stroke)).toEqual(rgb(GOLD.stroke));
  expect(errors).toEqual([]);
});
