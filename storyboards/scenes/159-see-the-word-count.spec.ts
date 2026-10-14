import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import JSZip from "jszip";
import { beat, caption, expect, test, typeSlowly } from "./harness";

const editorOf = (page: Page) =>
  page.getByRole("textbox", { name: "Document content" });
const countOf = (page: Page) => page.locator("#live-word-count");

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

/** Keep the caption above the status bar so the word count stays in frame. */
async function liftCaption(page: Page) {
  await page.evaluate(() => {
    const bar = document.getElementById("storyboard-caption");
    if (bar) bar.style.bottom = "72px";
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

async function selectPhrase(page: Page, phrase: string) {
  const box = await phraseBox(page, phrase);
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 1, y);
  await beat(page, 200);
  await page.mouse.down();
  await page.mouse.move(box.x + Math.max(8, box.width - 2), y, { steps: 16 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const selected = await page.evaluate(
        () => document.getSelection()?.toString() ?? "",
      );
      if (
        selected.length > 0 &&
        selected.length < phrase.length &&
        phrase.startsWith(selected)
      )
        await page.keyboard.press("Shift+ArrowRight");
      return page.evaluate(() => document.getSelection()?.toString() ?? "");
    })
    .toBe(phrase);
}

test("159-see-the-word-count", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Nia opens a new document. The corner already says 0 words.");
  await liftCaption(page);
  const editor = await newDocument(page, "Market minutes");
  await expect(countOf(page)).toHaveText("0 words");
  await expect(page.getByRole("dialog", { name: "Word count" })).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", { name: "Show word count while typing" }),
  ).toHaveCount(0);
  await beat(page, 1200);

  await caption(page, "She types the first sentence. The count updates to 4 words.");
  await liftCaption(page);
  await typeSlowly(page, "Apples were four dollars.");
  await expect(countOf(page)).toHaveText("4 words");
  await expect(editor).toContainText("Apples were four dollars.");
  await beat(page, 1000);

  await caption(page, "She adds “Pears were ten.” Ten is one word, so the corner says 7.");
  await liftCaption(page);
  await page.keyboard.press("Enter");
  await typeSlowly(page, "Pears were ten.");
  await expect(countOf(page)).toHaveText("7 words");
  await expect(editor).toContainText("Pears were ten.");
  await beat(page, 1100);

  await caption(page, "She selects “four dollars”. The corner says 2 of 7 words.");
  await liftCaption(page);
  await selectPhrase(page, "four dollars");
  await expect(countOf(page)).toHaveText("2 of 7 words");
  await expect(editor).toContainText("Apples were four dollars.");
  await expect(editor).toContainText("Pears were ten.");
  await beat(page, 1400);

  await caption(page, "She clicks away. The corner says 7 words again.");
  await liftCaption(page);
  await editor.getByText("Pears were ten.").click();
  await expect(countOf(page)).toHaveText("7 words");
  await beat(page, 1000);

  await caption(page, "She saves, returns home, and reopens. The corner still says 7 words.");
  await liftCaption(page);
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await page.getByRole("link", { name: "Market minutes" }).click();
  await expect(editorOf(page)).toContainText("Apples were four dollars.");
  await expect(editorOf(page)).toContainText("Pears were ten.");
  await expect(countOf(page)).toHaveText("7 words");
  await beat(page, 1200);

  await caption(page, "Search for word count finds the live count, not a missing-feature note.");
  await liftCaption(page);
  await page.keyboard.press("Alt+/");
  const search = page.getByRole("dialog", { name: "Search the menus" });
  await expect(search).toBeVisible();
  await typeSlowly(page, "word count", 70);
  const top = search.getByRole("option").first();
  await expect(top).toContainText("Tools › Word count");
  await expect(top).not.toContainText("doesn't have");
  await expect(countOf(page)).toHaveText("7 words");
  await beat(page, 1500);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Word count" })).toHaveCount(0);
  await expect(countOf(page)).toHaveText("7 words");

  await caption(page, "She downloads Word. The file has the sentences, not the label “7 words”.");
  await liftCaption(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 500);
  await page.getByRole("menuitem", { name: "Export DOCX", exact: true }).click();
  const saved = readFileSync((await (await download).path())!);
  const xml = await (await JSZip.loadAsync(saved)).file("word/document.xml")!.async("string");
  expect(xml).toContain("Apples were four dollars.");
  expect(xml).toContain("Pears were ten.");
  expect(xml).not.toContain("7 words");
  await expect(countOf(page)).toHaveText("7 words");
  await expect(editorOf(page)).toContainText("Apples were four dollars.");
  await beat(page, 1400);
});
