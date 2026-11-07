import { expect, test, type Page } from "@playwright/test";
import { createFile, serializeFile } from "../../packages/core/src/native-file";

async function openSlides(page: Page) {
  await page.goto("/");
  const file = createFile("slide", "Touch toolbar");
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({
    name: "touch.slslides",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  await expect(page.locator(".slides-editor")).toHaveAttribute(
    "data-deck-snapshot",
    /slides/,
  );
}

test("Mobile toolbar menus wait for release and allow a swipe starting on their button", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile);
  await openSlides(page);
  const bar = page.getByRole("toolbar", { name: "Slides toolbar" });
  const button = bar.getByRole("button", { name: "+ New slide", exact: true });
  await button.scrollIntoViewIfNeeded();
  const box = (await button.boundingBox())!;
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const before = await bar.evaluate((node) => node.scrollLeft);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [start],
  });
  await expect(button).toHaveAttribute("aria-expanded", "false");
  for (let step = 1; step <= 6; step++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: Math.max(5, start.x - step * 15), y: start.y }],
    });
    await page.waitForTimeout(25);
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(button).toHaveAttribute("aria-expanded", "false");
  expect(await bar.evaluate((node) => node.scrollLeft)).toBeGreaterThan(
    before + 10,
  );
  await button.scrollIntoViewIfNeeded();
  await button.tap();
  await expect(
    page.getByRole("menuitem", { name: "Blank slide", exact: true }),
  ).toBeVisible();
  await cdp.detach();
});

test("Mobile shape tools insert on release and never insert while swiping", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile);
  await openSlides(page);
  const bar = page.getByRole("toolbar", { name: "Slides toolbar" });
  const circle = bar.getByRole("button", { name: "Circle", exact: true });
  const count = () =>
    page.locator(".slides-editor").evaluate((node) => {
      const deck = JSON.parse((node as HTMLElement).dataset.deckSnapshot!);
      return deck.slides[deck.slideOrder[0]].elements.length;
    });
  const initial = await count();
  await circle.scrollIntoViewIfNeeded();
  const box = (await circle.boundingBox())!;
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [start],
  });
  expect(await count()).toBe(initial);
  for (let step = 1; step <= 5; step++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: start.x - step * 12, y: start.y }],
    });
    await page.waitForTimeout(25);
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  expect(await count()).toBe(initial);
  await circle.scrollIntoViewIfNeeded();
  const tapped = (await circle.boundingBox())!;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: tapped.x + tapped.width / 2, y: tapped.y + tapped.height / 2 },
    ],
  });
  expect(await count()).toBe(initial);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect.poll(count).toBe(initial + 1);
  await cdp.detach();
});
