import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 800 } });

async function clickPhrase(page: Page, phrase: string) {
  const point = await page.locator(".document-content").evaluate((root, phrase) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.textContent ?? "";
      const start = text.indexOf(phrase);
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(node, start);
      range.collapse(true);
      const rect = range.getClientRects()[0];
      if (!rect) return null;
      return {
        x: rect.x + 2,
        y: rect.y + Math.min(rect.height / 2, 8),
        text: text.slice(0, 24),
      };
    }
    return null;
  }, phrase);
  expect(point, phrase).toBeTruthy();
  // An edit suppresses selection changes for a moment. Wait, or the click
  // is undone and Tab still sees the previous selection.
  await page.waitForTimeout(80);
  const root = page.locator(".document-content");
  const box = await root.boundingBox();
  expect(box).toBeTruthy();
  await root.click({
    position: { x: point!.x - box!.x, y: point!.y - box!.y },
  });
  await page.waitForTimeout(100);
  const selection = await page.evaluate(() => {
    const current = document.getSelection();
    const active = document.activeElement;
    return {
      collapsed: current?.isCollapsed ?? false,
      text: current?.anchorNode?.textContent?.slice(0, 40) ?? "",
      offset: current?.anchorOffset ?? -1,
      active: active instanceof HTMLElement ? active.className : "",
    };
  });
  expect(selection, phrase).toMatchObject({
    collapsed: true,
    text: expect.stringContaining(phrase),
    active: expect.stringContaining("document-content"),
  });
}

async function timeLeft(page: Page, time: string) {
  return page.locator(".document-content").evaluate((root, time) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.textContent ?? "";
      const start = text.indexOf(time);
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + 1);
      return range.getClientRects()[0]?.left ?? null;
    }
    return null;
  }, time);
}

test("a left tab stop lines up times, and one line can move on its own", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  const title = page.getByLabel("File title");
  await title.fill("Saturday agenda");
  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.click();
  await page.keyboard.type("Plant sale 9:00");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Compost 10:30");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Officers 11:00");

  const before = await Promise.all(
    ["9:00", "10:30", "11:00"].map((time) => timeLeft(page, time)),
  );
  expect(Math.abs(before[0]! - before[1]!)).toBeGreaterThan(4);

  await page.keyboard.press("ControlOrMeta+A");
  const stop = page.getByRole("spinbutton", { name: "Tab stop in inches" });
  await stop.click();
  await stop.fill("3");
  await stop.press("Enter");
  await expect(page.locator("p[data-tab-stop='3']")).toHaveCount(3);

  for (const time of ["9:00", "10:30", "11:00"]) {
    await clickPhrase(page, time);
    await page.keyboard.press("Tab");
  }

  await expect(page.locator(".doc-tab")).toHaveCount(3);
  await expect
    .poll(async () => {
      const left = await Promise.all(
        ["9:00", "10:30", "11:00"].map((time) => timeLeft(page, time)),
      );
      return Math.max(...(left as number[])) - Math.min(...(left as number[]));
    })
    .toBeLessThanOrEqual(2);
  expect(errors).toEqual([]);

  await clickPhrase(page, "Officers");
  await stop.click();
  await stop.fill("4");
  await stop.press("Enter");
  await expect(page.locator("p[data-tab-stop='3']")).toHaveCount(2);
  await expect(page.locator("p[data-tab-stop='4']")).toHaveCount(1);
  await expect
    .poll(async () => {
      const [nine, ten, eleven] = await Promise.all(
        ["9:00", "10:30", "11:00"].map((time) => timeLeft(page, time)),
      );
      return Math.abs(nine! - ten!) <= 2 && eleven! - nine! > 70;
    })
    .toBe(true);

  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Saturday agenda", exact: true }).click();
  await expect(editor).toContainText("11:00");
  await expect(page.locator("p[data-tab-stop='3']")).toHaveCount(2);
  await expect(page.locator("p[data-tab-stop='4']")).toHaveCount(1);
  await expect
    .poll(async () => {
      const left = await Promise.all(
        ["9:00", "10:30"].map((time) => timeLeft(page, time)),
      );
      return Math.abs(left[0]! - left[1]!);
    })
    .toBeLessThanOrEqual(2);
});
