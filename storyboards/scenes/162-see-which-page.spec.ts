import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import JSZip from "jszip";
import { beat, caption, expect, test, typeSlowly } from "./harness";

const editorOf = (page: Page) =>
  page.getByRole("textbox", { name: "Document content" });
const countOf = (page: Page) => page.locator("#live-word-count");
const pageOf = (page: Page) => page.locator("#caret-page");

const apples = "4 words, 25 characters, and 22 without spaces";
const both = "7 words, 40 characters, and 35 without spaces";

async function newDocument(page: Page, title: string) {
  await page.getByRole("button", { name: "New document" }).click();
  const box = page.getByLabel("File title");
  await expect(box).toBeVisible();
  await box.click();
  await box.press("ControlOrMeta+A");
  await typeSlowly(page, title);
  const editor = editorOf(page);
  await editor.click();
  return editor;
}

/** Keep the caption above the status bar so the page label stays in frame. */
async function liftCaption(page: Page) {
  await page.evaluate(() => {
    const bar = document.getElementById("storyboard-caption");
    if (bar) bar.style.bottom = "88px";
  });
}

async function phraseBox(page: Page, phrase: string) {
  const box = await page.locator(".document-content").evaluate((root, target) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: { node: Text; start: number }[] = [];
    let combined = "";
    let current: Node | null;
    while ((current = walker.nextNode())) {
      const text = current.textContent ?? "";
      nodes.push({ node: current as Text, start: combined.length });
      combined += text;
    }
    const index = combined.indexOf(target);
    if (index < 0) return null;
    const end = index + target.length;
    const startPart = [...nodes].reverse().find((part) => part.start <= index);
    const endPart = [...nodes].reverse().find((part) => part.start < end);
    if (!startPart || !endPart) return null;
    const range = document.createRange();
    range.setStart(startPart.node, index - startPart.start);
    range.setEnd(endPart.node, end - endPart.start);
    const rect = range.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }, phrase);
  if (!box) throw new Error(`missing ${phrase}`);
  return box;
}

/** Move the caret into a phrase without following it with the window. */
async function moveCaretKeepingScroll(page: Page, phrase: string) {
  const stage = page.locator(".document-stage");
  const top = await stage.evaluate((el) => el.scrollTop);
  await page.evaluate((target) => {
    const root = document.querySelector(".document-content");
    const scroller = document.querySelector(".document-stage");
    if (!(root instanceof HTMLElement) || !(scroller instanceof HTMLElement))
      throw new Error("no editor");
    const locked = scroller.scrollTop;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: { node: Text; start: number }[] = [];
    let combined = "";
    let current: Node | null;
    while ((current = walker.nextNode())) {
      const text = current.textContent ?? "";
      nodes.push({ node: current as Text, start: combined.length });
      combined += text;
    }
    const index = combined.indexOf(target);
    if (index >= 0) {
      const startPart = [...nodes].reverse().find((part) => part.start <= index);
      if (!startPart) throw new Error(`missing ${target}`);
      root.focus({ preventScroll: true });
      const range = document.createRange();
      range.setStart(startPart.node, index - startPart.start + 1);
      range.collapse(true);
      const selection = document.getSelection();
      if (!selection) throw new Error("no selection");
      selection.removeAllRanges();
      selection.addRange(range);
      scroller.scrollTop = locked;
      let frames = 0;
      const pin = () => {
        scroller.scrollTop = locked;
        frames += 1;
        if (frames < 10) requestAnimationFrame(pin);
      };
      requestAnimationFrame(pin);
      return;
    }
    throw new Error(`missing ${target}`);
  }, phrase);
  await expect
    .poll(() => page.evaluate(() => document.getSelection()?.anchorNode?.textContent ?? ""))
    .toContain(phrase.split(" ")[0]);
  await stage.evaluate((el, locked) => {
    el.scrollTop = locked;
  }, top);
  return top;
}

test("162-see-which-page", async ({ page }) => {
  await page.goto("/");
  await caption(
    page,
    "Nia opens a new document. The corner says Page 1 of 1, next to the word count.",
  );
  await liftCaption(page);
  const editor = await newDocument(page, "Market minutes");
  await expect(pageOf(page)).toHaveText("Page 1 of 1");
  await expect(countOf(page)).toHaveText("0 words, 0 characters, and 0 without spaces");
  await expect(page.getByRole("dialog", { name: "Word count" })).toHaveCount(0);
  await beat(page, 1200);

  await caption(
    page,
    "She types the first sentence. It is still Page 1 of 1, and the word count is beside it.",
  );
  await liftCaption(page);
  await typeSlowly(page, "Apples were four dollars.");
  await expect(pageOf(page)).toHaveText("Page 1 of 1");
  await expect(countOf(page)).toHaveText(apples);
  await expect(editor).toContainText("Apples were four dollars.");
  await expect(editor).not.toContainText("Page 1 of 1");
  await beat(page, 1200);

  await caption(
    page,
    "She inserts a page break and types on the second page. The corner says Page 2 of 2.",
  );
  await liftCaption(page);
  await page.getByRole("button", { name: "Page break", exact: true }).click();
  await typeSlowly(page, "Pears were ten.");
  await expect(pageOf(page)).toHaveText("Page 2 of 2");
  await expect(countOf(page)).toHaveText(both);
  await expect(page.locator(".editor-status")).toContainText("2 pages");
  await expect(editor).toContainText("Apples were four dollars.");
  await expect(editor).toContainText("Pears were ten.");
  await expect(editor).not.toContainText("Page 2 of 2");
  const pears = await phraseBox(page, "Pears were ten.");
  expect(pears.y).toBeGreaterThan(40);
  expect(pears.y).toBeLessThan(760);
  await beat(page, 1400);

  await caption(
    page,
    "She moves the caret back to Apples. The window stays on page 2, and the corner says Page 1 of 2.",
  );
  await liftCaption(page);
  const scrolled = await moveCaretKeepingScroll(page, "Apples were four dollars.");
  await expect(pageOf(page)).toHaveText("Page 1 of 2");
  await expect(countOf(page)).toHaveText(both);
  await expect(editor).toContainText("Apples were four dollars.");
  await expect(editor).toContainText("Pears were ten.");
  await expect(editor).not.toContainText("Page 1 of 2");
  const still = await page.locator(".document-stage").evaluate((el) => el.scrollTop);
  expect(Math.abs(still - scrolled)).toBeLessThan(8);
  const pearsStill = await phraseBox(page, "Pears were ten.");
  expect(pearsStill.y).toBeGreaterThan(40);
  expect(pearsStill.y).toBeLessThan(760);
  await beat(page, 1600);

  await caption(
    page,
    "She saves, returns home, and reopens, and puts the caret in “Pears were ten.” It says Page 2 of 2.",
  );
  await liftCaption(page);
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await page.getByRole("link", { name: "Market minutes" }).click();
  await expect(editorOf(page)).toContainText("Apples were four dollars.");
  await expect(editorOf(page)).toContainText("Pears were ten.");
  await page.getByText("Pears were ten.", { exact: true }).click();
  await expect(pageOf(page)).toHaveText("Page 2 of 2");
  await expect(countOf(page)).toHaveText(both);
  await expect(page.getByRole("dialog", { name: "Word count" })).toHaveCount(0);
  await beat(page, 1200);

  await caption(
    page,
    "She downloads Word. The file has both sentences and the page break, not “Page 2 of 2”.",
  );
  await liftCaption(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 500);
  await page.getByRole("menuitem", { name: "Export DOCX", exact: true }).click();
  const saved = readFileSync((await (await download).path())!);
  const xml = await (await JSZip.loadAsync(saved)).file("word/document.xml")!.async("string");
  expect(xml).toContain("Apples were four dollars.");
  expect(xml).toContain("Pears were ten.");
  expect(xml).toContain("<w:pageBreakBefore");
  expect(xml).not.toContain("Page 2 of 2");
  await expect(pageOf(page)).toHaveText("Page 2 of 2");
  await expect(countOf(page)).toHaveText(both);
  await beat(page, 1400);
});
