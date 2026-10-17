import { expect, test, type Locator, type Page } from "@playwright/test";

const SENTENCE =
  "The garden club meets every Thursday evening in the greenhouse to plan the spring fair, plant the borders, and welcome new neighbors from across town.";

type Fit = {
  fontSize: number;
  textBottom: number;
  boxBottom: number;
  width: number;
  height: number;
};

async function textBox(page: Page, text: string) {
  const boxes = page.locator(".slide-canvas .slide-text");
  const count = await boxes.count();
  for (let i = 0; i < count; i++) {
    const box = boxes.nth(i);
    const area = box.locator("textarea");
    if ((await area.count()) === 0) continue;
    if ((await area.inputValue()) === text) return box;
  }
  throw new Error("text box not found");
}

/** The textarea fills the box; its scroll height is the text block. */
async function metrics(box: Locator): Promise<Fit> {
  return box.evaluate((el) => {
    const area = el.querySelector("textarea");
    if (!(area instanceof HTMLTextAreaElement)) throw new Error("no textarea");
    const boxRect = el.getBoundingClientRect();
    const areaRect = area.getBoundingClientRect();
    return {
      fontSize: Number.parseFloat(getComputedStyle(area).fontSize),
      textBottom: areaRect.top + area.scrollHeight,
      boxBottom: boxRect.bottom,
      width: boxRect.width,
      height: boxRect.height,
    };
  });
}

function overflows(fit: Fit) {
  return fit.textBottom > fit.boxBottom + 2;
}

async function savedBox(page: Page, text: string) {
  const raw = await page.locator(".slides-editor").getAttribute("data-deck-snapshot");
  const deck = JSON.parse(raw ?? "{}") as {
    slideOrder: string[];
    slides: Record<
      string,
      { elements: Array<{ content?: string; autofit?: boolean; fontSize?: number }> }
    >;
  };
  for (const id of deck.slideOrder) {
    const found = deck.slides[id]?.elements.find((el) => el.content === text);
    if (found) return found;
  }
  throw new Error("saved text box not found");
}

test("autofit shrinks slide text into the box and keeps it after reopen", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await page.getByRole("button", { name: "New presentation" }).click();
  await expect(page.locator(".slides-editor")).toBeVisible();
  await page.getByLabel("File title").fill("Garden autofit");

  await page.getByRole("button", { name: "Insert text box" }).click();
  const box = page.locator(".slide-canvas .slide-text.selected");
  await box.locator("textarea").fill(SENTENCE);
  await expect(box).not.toHaveAttribute("data-autofit");

  const autofit = page.getByRole("button", { name: "Autofit", exact: true });
  await expect(autofit).toHaveAttribute("aria-pressed", "false");

  let before = await metrics(box);
  if (!overflows(before)) {
    const handle = box.locator(".resize-handle.handle-se");
    const start = await handle.boundingBox();
    expect(start).not.toBeNull();
    await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2);
    await page.mouse.down();
    await page.mouse.move(start!.x - 160, start!.y - 20, { steps: 12 });
    await page.mouse.up();
    before = await metrics(box);
  }
  expect(overflows(before)).toBe(true);
  const storedSize = (await savedBox(page, SENTENCE)).fontSize;

  await autofit.click();
  await expect(box).toHaveAttribute("data-autofit", "on");
  await expect(autofit).toHaveAttribute("aria-pressed", "true");
  const fitted = await metrics(box);
  expect(fitted.fontSize).toBeLessThan(before.fontSize);
  expect(fitted.textBottom).toBeLessThanOrEqual(fitted.boxBottom + 2);
  expect(fitted.height).toBeLessThanOrEqual(before.height + 1);
  expect(fitted.width).toBeLessThanOrEqual(before.width + 1);
  expect((await savedBox(page, SENTENCE)).autofit).toBe(true);
  expect((await savedBox(page, SENTENCE)).fontSize).toBe(storedSize);

  await autofit.click();
  await expect(box).not.toHaveAttribute("data-autofit");
  await expect(autofit).toHaveAttribute("aria-pressed", "false");
  const restored = await metrics(box);
  expect(restored.fontSize).toBe(before.fontSize);
  expect(overflows(restored)).toBe(true);

  await autofit.click();
  await expect(box).toHaveAttribute("data-autofit", "on");
  const fittedAgain = await metrics(box);
  expect(fittedAgain.fontSize).toBe(fitted.fontSize);
  expect(fittedAgain.textBottom).toBeLessThanOrEqual(fittedAgain.boxBottom + 2);

  await expect(page.locator(".save-status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Garden autofit" }).click();
  await expect(page.locator(".slides-editor")).toBeVisible();

  const reopened = await textBox(page, SENTENCE);
  await expect(reopened).toHaveAttribute("data-autofit", "on");
  const kept = await metrics(reopened);
  expect(kept.fontSize).toBe(fitted.fontSize);
  expect(kept.textBottom).toBeLessThanOrEqual(kept.boxBottom + 2);
  expect((await savedBox(page, SENTENCE)).autofit).toBe(true);
  expect((await savedBox(page, SENTENCE)).fontSize).toBe(storedSize);

  await reopened.locator("textarea").click();
  await expect(page.getByRole("button", { name: "Autofit", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(errors).toEqual([]);
});
