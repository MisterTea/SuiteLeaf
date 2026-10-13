import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import {
  keepLinesHeading,
  keepLinesLeftOff,
  keepLinesRecord,
  keepLinesSpacer,
  reminderLines,
} from "../../tests/keep-lines-doc";
import { beat, caption, expect, test } from "./harness";

async function seed(page: Page) {
  await page.goto("/");
  await expect(page.getByLabel("Search files")).toBeVisible();
  await page.evaluate(async (record) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("SuiteLeaf");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("encoded", "readwrite");
        tx.objectStore("encoded").put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  }, keepLinesRecord());
  await page.reload();
}

async function pageOfText(page: Page, text: string) {
  return page.evaluate((needle) => {
    const blocks = [
      ...document.querySelectorAll(
        ".document-content p, .document-content h1, .document-content h2, .document-content h3",
      ),
    ];
    const block = blocks.find((el) => el.textContent?.includes(needle));
    if (!block) return -1;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let combined = "";
    const parts: { node: Text; start: number }[] = [];
    let current: globalThis.Node | null;
    while ((current = walker.nextNode())) {
      if (!(current instanceof Text)) continue;
      parts.push({ node: current, start: combined.length });
      combined += current.textContent ?? "";
    }
    const at = combined.indexOf(needle);
    const part = [...parts].reverse().find((entry) => entry.start <= at);
    if (!part || at < 0) return -1;
    const range = document.createRange();
    const offset = at - part.start;
    range.setStart(part.node, offset);
    range.setEnd(part.node, Math.min(part.node.length, offset + 1));
    const rect = range.getBoundingClientRect();
    const mid = rect.top + Math.max(rect.height, 1) / 2;
    const pages = [...document.querySelectorAll(".page-furniture-page")];
    return pages.findIndex((paper) => {
      const box = paper.getBoundingClientRect();
      return mid >= box.top - 2 && mid < box.bottom + 2;
    });
  }, text);
}

async function showLine(page: Page, text: string, fraction = 0.32) {
  await page.evaluate(
    ({ needle, fraction: anchor }) => {
      const block = [...document.querySelectorAll(".document-content p, .document-content h2")].find(
        (el) => el.textContent?.includes(needle),
      );
      if (!block) return;
      const range = document.createRange();
      range.selectNodeContents(block);
      const rect = [...range.getClientRects()][0];
      const stage = document.querySelector(".document-stage");
      if (!rect || !(stage instanceof HTMLElement)) return;
      const stageRect = stage.getBoundingClientRect();
      stage.scrollTop += rect.top - stageRect.top - stageRect.height * anchor;
    },
    { needle: text, fraction },
  );
  await beat(page, 600);
}

async function clickLine(page: Page, text: string) {
  await showLine(page, text);
  const point = await page.evaluate((needle) => {
    const block = [...document.querySelectorAll(".document-content p")].find((el) =>
      el.textContent?.includes(needle),
    );
    if (!block) return null;
    const range = document.createRange();
    range.selectNodeContents(block);
    const rect = [...range.getClientRects()][0];
    if (!rect) return null;
    return { x: rect.left + 36, y: rect.top + rect.height / 2 };
  }, text);
  if (!point) throw new Error(`missing ${text}`);
  await page.mouse.move(point.x, point.y, { steps: 18 });
  await page.mouse.click(point.x, point.y);
  await beat(page, 500);
}

async function pressControl(page: Page, name: string) {
  const button = page.getByRole("button", { name });
  await expect(button).toBeVisible();
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 16 });
  await beat(page, 400);
  await button.click();
  await beat(page, 800);
}

test("92-keep-the-note-on-one-page", async ({ page }) => {
  const [first, middle, last] = reminderLines;
  await seed(page);
  await caption(page, "Nia opens Garden club news. The reminder starts on page 1 and finishes on page 2.", 1700);
  await page.getByRole("link", { name: "Garden club news" }).click();
  await expect(page.getByRole("heading", { name: keepLinesHeading })).toBeVisible();
  await showLine(page, first);
  await expect.poll(() => pageOfText(page, first)).toBe(0);
  await expect.poll(() => pageOfText(page, middle)).toBe(1);
  await expect.poll(() => pageOfText(page, last)).toBe(1);
  await expect.poll(() => pageOfText(page, keepLinesHeading)).toBe(0);
  await beat(page, 1400);

  await caption(
    page,
    "She clicks the reminder. Keep lines together is its own switch, beside the other two.",
    1800,
  );
  await clickLine(page, first);
  await expect(page.getByRole("button", { name: "Keep lines together, off" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep with next, off" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Don't leave one line, off" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await beat(page, 1100);

  await caption(page, "One click turns it on. There is no second dialog.", 700);
  await pressControl(page, "Keep lines together, off");
  await expect(page.getByRole("button", { name: "Keep lines together, on" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "Keep with next, off" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.getByRole("button", { name: "Don't leave one line, off" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await showLine(page, keepLinesHeading, 0.18);
  await caption(page, "The whole reminder moves to page 2. What to bring stays on page 1.", 2000);
  await expect.poll(() => pageOfText(page, keepLinesHeading)).toBe(0);
  await expect.poll(() => pageOfText(page, keepLinesSpacer)).toBe(0);
  await expect.poll(() => pageOfText(page, first)).toBe(1);
  await expect.poll(() => pageOfText(page, middle)).toBe(1);
  await expect.poll(() => pageOfText(page, last)).toBe(1);
  await beat(page, 1200);

  await caption(page, "She turns it off.", 600);
  await pressControl(page, "Keep lines together, on");
  await showLine(page, keepLinesHeading, 0.18);
  await caption(page, "The reminder splits across the page break again.", 1600);
  await expect.poll(() => pageOfText(page, first)).toBe(0);
  await expect.poll(() => pageOfText(page, middle)).toBe(1);
  await expect.poll(() => pageOfText(page, keepLinesHeading)).toBe(0);
  await beat(page, 1000);

  await caption(page, "She turns it on again and leaves the file.", 700);
  await pressControl(page, "Keep lines together, off");
  await expect.poll(() => pageOfText(page, first)).toBe(1);
  await expect(page.locator(".save-status")).toContainText("Saved", { timeout: 5000 });
  await beat(page, 700);
  await page.getByRole("button", { name: "Back to files" }).click();
  await beat(page, 900);
  await page.getByRole("link", { name: "Garden club news" }).click();
  await expect(page.getByRole("heading", { name: keepLinesHeading })).toBeVisible();
  await showLine(page, keepLinesHeading, 0.18);
  await expect.poll(() => pageOfText(page, first)).toBe(1);
  await expect.poll(() => pageOfText(page, middle)).toBe(1);
  await expect.poll(() => pageOfText(page, last)).toBe(1);
  await clickLine(page, first);
  await expect(page.getByRole("button", { name: "Keep lines together, on" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await beat(page, 900);

  await caption(page, "Word gets keep-lines on that reminder, and not on the other paragraphs.", 1700);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 500);
  await page.getByRole("menuitem", { name: "Export DOCX" }).click();
  const bytes = await readFile((await (await downloadPromise).path())!);
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")!.async("string");
  const paras = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].map((match) => match[0]);
  const reminder = paras.find((para) => para.includes("Bring gloves"));
  const heading = paras.find((para) => para.includes(keepLinesHeading));
  const later = paras.find((para) => para.includes(keepLinesLeftOff));
  expect(reminder).toContain("<w:keepLines");
  expect(heading).not.toContain("<w:keepLines");
  expect(later).not.toContain("<w:keepLines");
  await beat(page, 1400);
});
