import { readFileSync } from "node:fs";
import JSZip from "jszip";
import type { Page } from "@playwright/test";
import { sizeStoryDocx } from "../../tests/word-size-fixtures";
import { beat, caption, expect, test } from "./harness";

const docxMime =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const darkRed = "rgb(192, 0, 0)";
const bodyText = "rgb(0, 0, 0)";
const yellow = "rgb(255, 255, 0)";

function paragraph(page: Page, text: string) {
  return page.locator(".document-content p", { hasText: text });
}

async function openWord(page: Page, name: string, bytes: Uint8Array) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (
    await chooser
  ).setFiles({
    name,
    mimeType: docxMime,
    buffer: Buffer.from(bytes),
  });
  const editor = page.getByRole("textbox", { name: "Document content" });
  const same = page.getByRole("dialog", { name: /already/ });
  await expect(editor.or(same)).toBeVisible();
  if (await same.isVisible()) {
    await same.getByRole("button", { name: "Keep both" }).click();
  }
  await expect(editor).toContainText("urgent");
  await page.locator(".document-stage").evaluate((el) => el.scrollTo(0, 0));
}

async function wordLook(page: Page, word: string) {
  return page.evaluate((target) => {
    const root = document.querySelector(".document-content");
    if (!root) return null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.textContent ?? "";
      const at = text.indexOf(target);
      if (at < 0) continue;
      let background = "rgba(0, 0, 0, 0)";
      let el = node.parentElement;
      while (el && !el.classList.contains("document-content")) {
        const bg = getComputedStyle(el).backgroundColor;
        if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
          background = bg;
          break;
        }
        el = el.parentElement;
      }
      const style = node.parentElement
        ? getComputedStyle(node.parentElement)
        : null;
      return {
        color: style?.color ?? "",
        background,
        weight: style?.fontWeight ?? "400",
        fontSize: style?.fontSize ?? "",
        text,
      };
    }
    return null;
  }, word);
}

function px(value: string | undefined) {
  return Number.parseFloat(value ?? "");
}

const fontSize = (page: Page) =>
  page.getByRole("textbox", { name: "Font size" });

/** Font size sits on the second toolbar row until More tools is open. */
async function showFontSize(page: Page) {
  const size = fontSize(page);
  if (!(await size.isVisible())) {
    await page.getByRole("button", { name: "More tools" }).click();
  }
  await expect(size).toBeVisible();
  return size;
}

/** The open row covers the first line, so close it before placing the caret. */
async function hideFontSize(page: Page) {
  const size = fontSize(page);
  if (await size.isVisible()) {
    await page.getByRole("button", { name: "More tools" }).click();
  }
  await expect(size).toBeHidden();
}

async function clickWord(page: Page, word: string) {
  const point = await page.evaluate((target) => {
    const root = document.querySelector(".document-content");
    if (!root) return null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.textContent ?? "";
      const at = text.indexOf(target);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + target.length);
      const rect = range.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }
    return null;
  }, word);
  expect(point).not.toBeNull();
  await page.mouse.click(point!.x, point!.y);
}

test("135-keep-the-size-from-word", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Nia opens the minutes she received as a Word file.");
  await openWord(page, "Minutes.docx", await sizeStoryDocx());
  await expect(paragraph(page, "urgent")).toBeVisible();
  await expect(paragraph(page, "budget")).toBeVisible();
  await expect(paragraph(page, "urgent")).toHaveAttribute(
    "data-first-line-indent",
    "0.5",
  );

  const urgent = await wordLook(page, "urgent");
  const vote = await wordLook(page, "vote");
  const today = await wordLook(page, "today");
  const budget = await wordLook(page, "budget");
  const board = await wordLook(page, "board");
  expect(urgent?.text).toBe("urgent");
  expect(Number(urgent?.weight)).toBeGreaterThanOrEqual(600);
  expect(px(urgent?.fontSize)).toBeGreaterThan(px(today?.fontSize) + 4);
  expect(px(vote?.fontSize)).toBeCloseTo(px(today?.fontSize), 0);
  expect(vote?.text).not.toContain("urgent");
  expect(today?.text).not.toContain("urgent");
  expect(px(budget?.fontSize)).toBeCloseTo(px(today?.fontSize), 0);
  expect(budget?.color).toBe(darkRed);
  expect(budget?.text).toBe("budget");
  expect(budget?.background).not.toBe(yellow);
  expect(board?.background).toBe(yellow);
  expect(px(board?.fontSize)).toBeCloseTo(px(today?.fontSize), 0);
  expect(board?.color).toBe(bodyText);

  await caption(
    page,
    "Only urgent is 18 pt and bold. vote and today stay the body size. board stays highlighted yellow.",
  );
  await beat(page, 1600);

  await caption(page, "The caret is in urgent. The font-size control shows 18.");
  await hideFontSize(page);
  await clickWord(page, "urgent");
  const size = await showFontSize(page);
  await expect(size).toHaveValue("18");
  expect(px((await wordLook(page, "urgent"))?.fontSize)).toBeGreaterThan(
    px((await wordLook(page, "today"))?.fontSize) + 4,
  );
  await beat(page, 1600);

  await caption(
    page,
    "She moves to today. The control shows 11, the body size.",
  );
  await hideFontSize(page);
  await clickWord(page, "today");
  await expect(await showFontSize(page)).toHaveValue("11");
  expect(px((await wordLook(page, "today"))?.fontSize)).toBeLessThan(18);
  await beat(page, 1600);

  await caption(
    page,
    "budget stays dark red and body size. The size import did not make it 18 pt.",
  );
  await paragraph(page, "budget").scrollIntoViewIfNeeded();
  await hideFontSize(page);
  await clickWord(page, "budget");
  await expect(await showFontSize(page)).toHaveValue("11");
  expect((await wordLook(page, "budget"))?.color).toBe(darkRed);
  expect(px((await wordLook(page, "budget"))?.fontSize)).toBeCloseTo(
    px((await wordLook(page, "today"))?.fontSize),
    0,
  );
  await beat(page, 1600);

  await caption(
    page,
    "She saves, returns home, and reopens. urgent is still 18 pt and bold. budget is still dark red.",
  );
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await beat(page, 800);
  await page.getByRole("link", { name: /Minutes/ }).click();
  await expect(paragraph(page, "urgent")).toBeVisible();
  expect(px((await wordLook(page, "urgent"))?.fontSize)).toBeGreaterThan(
    px((await wordLook(page, "today"))?.fontSize) + 4,
  );
  expect(
    Number((await wordLook(page, "urgent"))?.weight),
  ).toBeGreaterThanOrEqual(600);
  expect((await wordLook(page, "budget"))?.color).toBe(darkRed);
  expect(px((await wordLook(page, "budget"))?.fontSize)).toBeCloseTo(
    px((await wordLook(page, "today"))?.fontSize),
    0,
  );
  expect((await wordLook(page, "board"))?.background).toBe(yellow);
  await hideFontSize(page);
  await clickWord(page, "urgent");
  await expect(await showFontSize(page)).toHaveValue("18");
  await beat(page, 1400);

  await caption(
    page,
    "File, Export DOCX. urgent is still w:sz 36 and bold. today has no w:sz. budget is still color C00000.",
  );
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 700);
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export DOCX" }).click();
  const xml = await JSZip.loadAsync(
    readFileSync((await (await download).path())!),
  ).then((zip) => zip.file("word/document.xml")!.async("string"));
  const exported = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(
    (match) => match[0],
  );
  const minutesXml = exported.find((item) => item.includes("urgent")) ?? "";
  const budgetXml = exported.find((item) => item.includes("budget")) ?? "";
  const runs = (paragraphXml: string) =>
    [...paragraphXml.matchAll(/<w:r\b[\s\S]*?<\/w:r>/g)].map(
      (match) => match[0],
    );
  const urgentRun =
    runs(minutesXml).find((item) => item.includes(">urgent<")) ?? "";
  const todayRun =
    runs(minutesXml).find((item) => item.includes("today")) ?? "";
  const budgetRun =
    runs(budgetXml).find((item) => item.includes(">budget<")) ?? "";
  expect(urgentRun).toMatch(/<w:sz\b[^>]*w:val="36"/);
  expect(urgentRun.toLowerCase()).toMatch(/<w:b(?:\s|>|\/>)/);
  expect(todayRun).not.toMatch(/<w:sz\b/);
  expect(budgetRun.toLowerCase()).toContain('w:val="c00000"');
  expect(budgetRun).not.toMatch(/<w:sz\b/);
  expect(minutesXml).toContain('w:firstLine="720"');
  await caption(
    page,
    "Word gets 18 pt back on urgent, the bold, and the dark red on budget.",
    2200,
  );
});
