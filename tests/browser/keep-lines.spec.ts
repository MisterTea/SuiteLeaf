import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import {
  keepLinesHeading,
  keepLinesLeftOff,
  keepLinesRecord,
  keepLinesSpacer,
  reminderLines,
} from "../keep-lines-doc";

function withKeepLines(record: ReturnType<typeof keepLinesRecord>) {
  const file = JSON.parse(record.native) as {
    content: { content: Array<{ type: string; attrs?: Record<string, unknown> }> };
  };
  const reminder = file.content.content.find(
    (node) => node.type === "paragraph" && JSON.stringify(node).includes("Bring gloves"),
  );
  if (!reminder) throw new Error("missing reminder");
  reminder.attrs = { ...reminder.attrs, keepLines: true };
  return { ...record, native: JSON.stringify(file) };
}

async function seed(page: Page, record = keepLinesRecord()) {
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).waitFor();
  await page.evaluate(async (stored) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("SuiteLeaf");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("encoded", "readwrite");
        tx.objectStore("encoded").put(stored);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  }, record);
  await page.reload();
  await page.getByRole("link", { name: "Garden club news" }).click();
  await expect(page.getByRole("heading", { name: keepLinesHeading })).toBeVisible();
}

async function expectNoPaginationSwitches(page: Page) {
  await expect(page.getByRole("button", { name: /Keep with next/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Don't leave one line/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Keep lines together/ })).toHaveCount(0);
}

/** Page index of a phrase, using the paragraph's text even when marks split it. */
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
    const end = Math.min(part.node.length, offset + 1);
    range.setStart(part.node, offset);
    range.setEnd(part.node, Math.max(end, offset));
    const rect = range.getBoundingClientRect();
    const mid = rect.top + Math.max(rect.height, 1) / 2;
    const pages = [...document.querySelectorAll(".page-furniture-page")];
    return pages.findIndex((paper) => {
      const box = paper.getBoundingClientRect();
      return mid >= box.top - 2 && mid < box.bottom + 2;
    });
  }, text);
}

async function lines(page: Page) {
  const [first, middle, last] = reminderLines;
  return {
    heading: await pageOfText(page, keepLinesHeading),
    spacer: await pageOfText(page, keepLinesSpacer),
    first: await pageOfText(page, first),
    middle: await pageOfText(page, middle),
    last: await pageOfText(page, last),
  };
}

async function clickTextLine(page: Page, text: string) {
  const place = (needle: string) => {
    const block = [...document.querySelectorAll(".document-content p")].find((el) =>
      el.textContent?.includes(needle),
    );
    if (!block) return null;
    const range = document.createRange();
    range.selectNodeContents(block);
    const rects = [...range.getClientRects()];
    const rect = rects[0];
    if (!rect) return null;
    const stage = document.querySelector(".document-stage");
    if (stage instanceof HTMLElement) {
      const stageRect = stage.getBoundingClientRect();
      stage.scrollTop += rect.top - stageRect.top - stageRect.height * 0.45;
    }
    const next = [...range.getClientRects()][0];
    if (!next) return null;
    return { x: next.left + Math.min(24, next.width / 2), y: next.top + next.height / 2 };
  };
  await page.evaluate(place, text);
  await page.waitForTimeout(400);
  const point = await page.evaluate(place, text);
  if (!point) throw new Error(`missing ${text}`);
  await page.mouse.click(point.x, point.y);
}

function paragraphsOf(xml: string) {
  return [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].map((match) => match[0]);
}

test("typing in a reminder does not show pagination switches", async ({ page }) => {
  await seed(page);
  const [first] = reminderLines;
  await expect.poll(() => lines(page)).toEqual({
    heading: 0,
    spacer: 0,
    first: 0,
    middle: 1,
    last: 1,
  });
  await clickTextLine(page, first);
  await page.keyboard.type("x");
  await expectNoPaginationSwitches(page);
});

test("a saved keep-lines paragraph stays on one page", async ({ page }) => {
  await seed(page, withKeepLines(keepLinesRecord()));
  const [first] = reminderLines;
  await expect(page.locator("p", { hasText: first })).toHaveAttribute("data-keep-lines", "true");
  await expect.poll(() => lines(page)).toEqual({
    heading: 0,
    spacer: 0,
    first: 1,
    middle: 1,
    last: 1,
  });
  await clickTextLine(page, first);
  await expectNoPaginationSwitches(page);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Export DOCX" }).click();
  const bytes = await readFile((await (await downloadPromise).path())!);
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")!.async("string");
  const paras = paragraphsOf(xml);
  const reminder = paras.find((para) => para.includes("Bring gloves"));
  const heading = paras.find((para) => para.includes(keepLinesHeading));
  const spacer = paras.find((para) => para.includes(keepLinesSpacer));
  const later = paras.find((para) => para.includes(keepLinesLeftOff));
  expect(reminder).toContain("<w:keepLines");
  expect(heading).not.toContain("<w:keepLines");
  expect(spacer).not.toContain("<w:keepLines");
  expect(later).not.toContain("<w:keepLines");
});
