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

async function seed(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).waitFor();
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
  await page.getByRole("link", { name: "Garden club news" }).click();
  await expect(page.getByRole("heading", { name: keepLinesHeading })).toBeVisible();
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

test("keep lines together moves a split paragraph onto one page", async ({ page }) => {
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
  const off = page.getByRole("button", { name: "Keep lines together, off" });
  await expect(off).toBeVisible();
  await expect(off).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Keep with next, off" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Don't leave one line, off" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const piled = await page.evaluate(() => {
    const mine = document.querySelector(".keep-lines-control");
    const others = [".keep-next-control", ".widow-control"]
      .map((selector) => document.querySelector(selector))
      .filter((el): el is HTMLElement => el instanceof HTMLElement);
    const reminder = [...document.querySelectorAll("p")].find((el) =>
      el.textContent?.includes("Bring gloves"),
    );
    if (!(mine instanceof HTMLElement) || !reminder || others.length !== 2) return "missing";
    const range = document.createRange();
    range.selectNodeContents(reminder);
    const textRects = [...range.getClientRects()].filter(
      (text) => text.height > 8 && text.height < 36 && text.width > 8,
    );
    const box = mine.getBoundingClientRect();
    const coversText = textRects.some(
      (text) =>
        box.right > text.left + 4 &&
        box.left < text.right - 4 &&
        box.bottom > text.top + 4 &&
        box.top < text.bottom - 4,
    );
    const hitsOther = others.some((other) => {
      const them = other.getBoundingClientRect();
      return (
        box.right > them.left + 2 &&
        box.left < them.right - 2 &&
        box.bottom > them.top + 2 &&
        box.top < them.bottom - 2
      );
    });
    return coversText ? "text" : hitsOther ? "control" : "clear";
  });
  expect(piled).toBe("clear");

  await off.click();
  await expect(page.getByRole("button", { name: "Keep lines together, on" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("p", { hasText: first })).toHaveAttribute("data-keep-lines", "true");
  await expect(page.getByRole("button", { name: "Keep with next, off" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Don't leave one line, off" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => lines(page)).toEqual({
    heading: 0,
    spacer: 0,
    first: 1,
    middle: 1,
    last: 1,
  });

  await page.getByRole("button", { name: "Keep lines together, on" }).click();
  await expect(page.getByRole("button", { name: "Keep lines together, off" })).toBeVisible();
  await expect.poll(() => lines(page)).toEqual({
    heading: 0,
    spacer: 0,
    first: 0,
    middle: 1,
    last: 1,
  });

  await page.getByRole("button", { name: "Keep lines together, off" }).click();
  await expect.poll(() => lines(page)).toEqual({
    heading: 0,
    spacer: 0,
    first: 1,
    middle: 1,
    last: 1,
  });
  await expect(page.locator(".save-status")).toContainText("Saved", { timeout: 5000 });
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Garden club news" }).click();
  await expect(page.getByRole("heading", { name: keepLinesHeading })).toBeVisible();
  await expect.poll(() => lines(page)).toEqual({
    heading: 0,
    spacer: 0,
    first: 1,
    middle: 1,
    last: 1,
  });
  await clickTextLine(page, reminderLines[2]);
  await expect(page.getByRole("button", { name: "Keep lines together, on" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

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
