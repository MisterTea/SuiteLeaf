import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import JSZip from "jszip";
import { beat, caption, expect, test, typeSlowly } from "./harness";

async function pointOf(page: Page, phrase: string, atEnd = false) {
  const point = await page.locator(".document-content").evaluate(
    (root, { phrase, atEnd }) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = node.textContent ?? "";
        const start = text.indexOf(phrase);
        if (start < 0) continue;
        const range = document.createRange();
        range.setStart(node, atEnd ? start + phrase.length : start);
        range.collapse(true);
        const rect = range.getClientRects()[0];
        if (!rect) return null;
        return { x: rect.x + (atEnd ? -1 : 2), y: rect.y + rect.height / 2 };
      }
      return null;
    },
    { phrase, atEnd },
  );
  expect(point, phrase).toBeTruthy();
  return point!;
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

/** Move the pointer to a phrase and leave the caret there. */
async function caretAt(page: Page, phrase: string) {
  const point = await pointOf(page, phrase);
  await page.mouse.move(point.x, point.y, { steps: 14 });
  await beat(page, 180);
  const root = page.locator(".document-content");
  const box = await root.boundingBox();
  expect(box).toBeTruthy();
  await root.click({ position: { x: point.x - box!.x, y: point.y - box!.y } });
  // ProseMirror ignores a selection change for a moment after an edit.
  await page.waitForTimeout(120);
}

test("83-line-up-the-times", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Nia opens a new agenda. Each line is a name, then a time.");
  await page.getByRole("button", { name: "New document" }).click();
  const title = page.getByLabel("File title");
  await title.click();
  await beat(page, 200);
  await title.press("ControlOrMeta+A");
  await typeSlowly(page, "Saturday agenda");
  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.click();
  await beat(page, 300);
  await typeSlowly(page, "Plant sale 9:00");
  await page.keyboard.press("Enter");
  await typeSlowly(page, "Compost 10:30");
  await page.keyboard.press("Enter");
  await typeSlowly(page, "Officers 11:00");
  await beat(page, 500);

  const before = await Promise.all(
    ["9:00", "10:30", "11:00"].map((time) => timeLeft(page, time)),
  );
  expect(Math.abs(before[0]! - before[2]!)).toBeGreaterThan(4);
  await caption(
    page,
    "The times do not share a column. Tab, today, would only nudge them.",
  );

  const start = await pointOf(page, "Plant sale");
  const end = await pointOf(page, "11:00", true);
  await page.mouse.move(start.x, start.y, { steps: 12 });
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 18 });
  await page.mouse.up();
  await beat(page, 500);
  await caption(
    page,
    "She selects the three lines and types 3 in Tab stop. No ruler.",
  );
  const stop = page.getByRole("spinbutton", { name: "Tab stop in inches" });
  const stopBox = await stop.boundingBox();
  expect(stopBox).toBeTruthy();
  await page.mouse.move(
    stopBox!.x + stopBox!.width / 2,
    stopBox!.y + stopBox!.height / 2,
    { steps: 16 },
  );
  await stop.click();
  await beat(page, 300);
  await page.keyboard.type("3", { delay: 120 });
  await beat(page, 700);
  await expect(page.locator("p[data-tab-stop='3']")).toHaveCount(3);
  await expect(page.locator(".doc-tab-guide")).toHaveCount(3);
  await expect(page.locator("#doc-tab-stop-hint")).toContainText(
    "These 3 lines share a stop at 3 in.",
  );
  await page.keyboard.press("Enter");
  await beat(page, 600);

  await caption(page, "Tab after each name. The time jumps to that stop.");
  for (const time of ["9:00", "10:30", "11:00"]) {
    await caretAt(page, time);
    await beat(page, 250);
    await page.keyboard.press("Tab");
    await beat(page, 550);
  }
  await expect
    .poll(async () => {
      const left = await Promise.all(
        ["9:00", "10:30", "11:00"].map((time) => timeLeft(page, time)),
      );
      return Math.max(...(left as number[])) - Math.min(...(left as number[]));
    })
    .toBeLessThanOrEqual(2);
  await caption(page, "9:00, 10:30, and 11:00 share one column.");

  await caretAt(page, "Officers");
  await beat(page, 400);
  await caption(page, "Officers moves to 4 inches. The other two stay put.");
  await stop.click();
  await beat(page, 250);
  await page.keyboard.type("4", { delay: 140 });
  await beat(page, 800);
  await page.keyboard.press("Enter");
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
  await beat(page, 900);

  await caption(page, "She closes the agenda and opens it again.");
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await beat(page, 700);
  await page.getByRole("link", { name: "Saturday agenda", exact: true }).click();
  await expect(editor).toContainText("Plant sale");
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
  await caption(page, "The first two times are still at 3 inches. Officers is still at 4.");

  await caption(page, "Export DOCX. Word keeps each line's own stop.");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 450);
  await page.getByRole("menuitem", { name: "Export DOCX", exact: true }).click();
  const download = await downloadPromise;
  const zip = await JSZip.loadAsync(readFileSync((await download.path())!));
  const xml = await zip.file("word/document.xml")!.async("string");
  const paragraphs = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(
    (match) => match[0],
  );
  const stopAt = (paragraph: string) => {
    const found =
      /<w:tab\b[^>]*w:val="left"[^>]*w:pos="(\d+)"|<w:tab\b[^>]*w:pos="(\d+)"[^>]*w:val="left"/.exec(
        paragraph,
      );
    return found ? Number(found[1] ?? found[2]) : null;
  };
  const agenda = paragraphs.filter((paragraph) =>
    /9:00|10:30|11:00/.test(paragraph),
  );
  expect(agenda.map(stopAt)).toEqual([3 * 1440, 3 * 1440, 4 * 1440]);
  for (const paragraph of agenda) expect(paragraph).toContain("<w:tab/>");
  await beat(page, 800);
});
