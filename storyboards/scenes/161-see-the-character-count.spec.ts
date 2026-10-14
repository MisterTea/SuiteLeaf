import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import JSZip from "jszip";
import { beat, caption, expect, test, typeSlowly } from "./harness";

const editorOf = (page: Page) =>
  page.getByRole("textbox", { name: "Document content" });
const countOf = (page: Page) => page.locator("#live-word-count");

const totals = "4 words, 25 characters, and 22 without spaces";
const selected = "2 of 4 words and 12 of 25 characters";

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

/** Keep the caption above the status bar so the character count stays in frame. */
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

test("161-see-the-character-count", async ({ page }) => {
  await page.goto("/");
  await caption(
    page,
    "Nia opens a new document. The corner says 0 words and 0 characters.",
  );
  await liftCaption(page);
  const editor = await newDocument(page, "Market minutes");
  await expect(countOf(page)).toHaveText("0 words, 0 characters, and 0 without spaces");
  await expect(page.getByRole("dialog", { name: "Word count" })).toHaveCount(0);
  await beat(page, 1200);

  await caption(
    page,
    "She types the sentence. The corner says 4 words, 25 characters, and 22 without spaces.",
  );
  await liftCaption(page);
  await typeSlowly(page, "Apples were four dollars.");
  await expect(countOf(page)).toHaveText(totals);
  await expect(editor).toContainText("Apples were four dollars.");
  await expect(page.getByRole("dialog", { name: "Word count" })).toHaveCount(0);
  await beat(page, 1200);

  await caption(
    page,
    "She selects “four dollars”. The corner says 2 of 4 words and 12 of 25 characters.",
  );
  await liftCaption(page);
  await selectPhrase(page, "four dollars");
  await expect(countOf(page)).toHaveText(selected);
  await expect(editor).toContainText("Apples were four dollars.");
  await expect(page.getByRole("dialog", { name: "Word count" })).toHaveCount(0);
  await beat(page, 1400);

  await caption(
    page,
    "She clicks away. The corner returns to 4 words, 25 characters, and 22 without spaces.",
  );
  await liftCaption(page);
  await editor.click({ position: { x: 8, y: 8 } });
  await expect(countOf(page)).toHaveText(totals);
  await expect(editor).toContainText("Apples were four dollars.");
  await beat(page, 1100);

  await caption(
    page,
    "She saves, returns home, and reopens. The corner still shows those counts.",
  );
  await liftCaption(page);
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await page.getByRole("link", { name: "Market minutes" }).click();
  await expect(editorOf(page)).toContainText("Apples were four dollars.");
  await expect(countOf(page)).toHaveText(totals);
  await expect(page.getByRole("dialog", { name: "Word count" })).toHaveCount(0);
  await beat(page, 1200);

  await caption(
    page,
    "She downloads Word. The file has the sentence, not the label “25 characters”.",
  );
  await liftCaption(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 500);
  await page.getByRole("menuitem", { name: "Export DOCX", exact: true }).click();
  const saved = readFileSync((await (await download).path())!);
  const xml = await (await JSZip.loadAsync(saved)).file("word/document.xml")!.async("string");
  expect(xml).toContain("Apples were four dollars.");
  expect(xml).not.toContain("25 characters");
  expect(xml).not.toContain("22 without spaces");
  await expect(countOf(page)).toHaveText(totals);
  await expect(editorOf(page)).toContainText("Apples were four dollars.");
  await beat(page, 1400);
});
