import { readFileSync } from "node:fs";
import JSZip from "jszip";
import type { Page } from "@playwright/test";
import { fontStoryDocx } from "../../tests/word-font-fixtures";
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
        fontFamily: style?.fontFamily ?? "",
        text,
      };
    }
    return null;
  }, word);
}

function px(value: string | undefined) {
  return Number.parseFloat(value ?? "");
}

const fontMenu = (page: Page) =>
  page.getByRole("combobox", { name: "Font family" });

/** The face sits on the second toolbar row until More tools is open. */
async function showFontMenu(page: Page) {
  const menu = fontMenu(page);
  if (!(await menu.isVisible())) {
    await page.getByRole("button", { name: "More tools" }).click();
  }
  await expect(menu).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  return menu;
}

/** The open row covers the first line, so close it before placing the caret. */
async function hideFontMenu(page: Page) {
  const menu = fontMenu(page);
  if (await menu.isVisible()) {
    await page.getByRole("button", { name: "More tools" }).click();
  }
  await expect(menu).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
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

/** Paragraph switches sit beside the caret line and must not cover a proof word. */
async function coveredByControls(page: Page, word: string) {
  return page.evaluate((target) => {
    const root = document.querySelector(".document-content");
    if (!root) return true;
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
      const controls = [
        ...document.querySelectorAll(
          ".keep-next-control, .widow-control, .keep-lines-control",
        ),
      ].filter((el) => getComputedStyle(el).visibility !== "hidden");
      return controls.some((el) => {
        const box = el.getBoundingClientRect();
        if (box.width < 1 || box.height < 1) return false;
        return !(
          rect.right <= box.left ||
          rect.left >= box.right ||
          rect.bottom <= box.top ||
          rect.top >= box.bottom
        );
      });
    }
    return true;
  }, word);
}

async function expectClear(page: Page, word: string) {
  await expect.poll(async () => coveredByControls(page, word)).toBe(false);
}

test("137-keep-the-font-from-word", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Nia opens the minutes she received as a Word file.");
  await openWord(page, "Minutes.docx", await fontStoryDocx());
  await expect(paragraph(page, "urgent")).toBeVisible();
  await expect(paragraph(page, "budget")).toBeVisible();
  await expect(paragraph(page, "board")).toBeVisible();
  await expect(paragraph(page, "Friday")).toBeVisible();
  await expect(paragraph(page, "urgent")).toHaveAttribute(
    "data-first-line-indent",
    "0.5",
  );

  await hideFontMenu(page);
  await clickWord(page, "today");
  for (const word of ["vote", "urgent", "today", "budget", "board", "Friday"])
    await expectClear(page, word);

  const urgent = await wordLook(page, "urgent");
  const vote = await wordLook(page, "vote");
  const today = await wordLook(page, "today");
  const budget = await wordLook(page, "budget");
  const board = await wordLook(page, "board");
  const friday = await wordLook(page, "Friday");
  expect(urgent?.text).toBe("urgent");
  expect(urgent?.fontFamily).toContain("Georgia");
  expect(urgent?.fontFamily).not.toContain("Arial");
  expect(Number(urgent?.weight)).toBeGreaterThanOrEqual(600);
  expect(vote?.fontFamily).toContain("Arial");
  expect(vote?.fontFamily).not.toContain("Georgia");
  expect(vote?.text).not.toContain("urgent");
  expect(today?.fontFamily).toContain("Arial");
  expect(today?.fontFamily).not.toContain("Georgia");
  expect(today?.text).not.toContain("urgent");
  expect(Number(today?.weight)).toBeLessThan(600);
  expect(budget?.fontFamily).toContain("Arial");
  expect(budget?.fontFamily).not.toContain("Georgia");
  expect(budget?.color).toBe(darkRed);
  expect(budget?.text).toBe("budget");
  expect(budget?.background).not.toBe(yellow);
  expect(board?.background).toBe(yellow);
  expect(board?.fontFamily).not.toContain("Georgia");
  expect(board?.color).toBe(bodyText);
  expect(px(friday?.fontSize)).toBeGreaterThan(px(today?.fontSize) + 4);
  expect(friday?.fontFamily).not.toContain("Georgia");
  expect(friday?.text).toBe("Friday");

  await caption(
    page,
    "Only urgent is Georgia and bold. vote and today stay the body font. board stays highlighted yellow.",
  );
  await beat(page, 1600);

  await caption(page, "The caret is in urgent. The font menu shows Georgia.");
  await hideFontMenu(page);
  await clickWord(page, "urgent");
  const menu = await showFontMenu(page);
  await expect(menu).toHaveValue("Georgia");
  await expectClear(page, "urgent");
  expect((await wordLook(page, "urgent"))?.fontFamily).toContain("Georgia");
  expect((await wordLook(page, "today"))?.fontFamily).not.toContain("Georgia");
  expect((await wordLook(page, "vote"))?.fontFamily).not.toContain("Georgia");
  await beat(page, 1600);

  await caption(
    page,
    "She moves to today. The menu shows Arial, the body font.",
  );
  await hideFontMenu(page);
  await clickWord(page, "today");
  await expect(await showFontMenu(page)).toHaveValue("Arial");
  await expectClear(page, "today");
  await expectClear(page, "urgent");
  expect((await wordLook(page, "today"))?.fontFamily).toContain("Arial");
  expect((await wordLook(page, "today"))?.fontFamily).not.toContain("Georgia");
  await beat(page, 1600);

  await caption(
    page,
    "budget stays dark red and the body font. The font import did not make it Georgia.",
  );
  await hideFontMenu(page);
  await clickWord(page, "budget");
  await expect(await showFontMenu(page)).toHaveValue("Arial");
  await expectClear(page, "budget");
  expect((await wordLook(page, "budget"))?.color).toBe(darkRed);
  expect((await wordLook(page, "budget"))?.fontFamily).not.toContain("Georgia");
  await beat(page, 1400);

  await caption(
    page,
    "board stays yellow, and Friday stays 18 pt. The indent on the first line stays too.",
  );
  await hideFontMenu(page);
  await clickWord(page, "today");
  await expectClear(page, "board");
  await expectClear(page, "Friday");
  expect((await wordLook(page, "board"))?.background).toBe(yellow);
  expect(px((await wordLook(page, "Friday"))?.fontSize)).toBeGreaterThan(
    px((await wordLook(page, "today"))?.fontSize) + 4,
  );
  await beat(page, 1600);

  await caption(
    page,
    "She saves, returns home, and reopens. urgent is still Georgia and bold. budget is still dark red.",
  );
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await beat(page, 800);
  await page.getByRole("link", { name: /Minutes/ }).click();
  await expect(paragraph(page, "urgent")).toBeVisible();
  expect((await wordLook(page, "urgent"))?.fontFamily).toContain("Georgia");
  expect(
    Number((await wordLook(page, "urgent"))?.weight),
  ).toBeGreaterThanOrEqual(600);
  expect((await wordLook(page, "today"))?.fontFamily).not.toContain("Georgia");
  expect((await wordLook(page, "budget"))?.color).toBe(darkRed);
  expect((await wordLook(page, "budget"))?.fontFamily).not.toContain("Georgia");
  expect((await wordLook(page, "board"))?.background).toBe(yellow);
  await hideFontMenu(page);
  await clickWord(page, "urgent");
  await expect(await showFontMenu(page)).toHaveValue("Georgia");
  await expectClear(page, "urgent");
  await beat(page, 1400);

  await caption(
    page,
    "File, Export DOCX. urgent is still w:ascii Georgia and bold. today has no w:rFonts. budget is still color C00000.",
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
  expect(urgentRun).toContain('w:ascii="Georgia"');
  expect(urgentRun.toLowerCase()).toMatch(/<w:b(?:\s|>|\/>)/);
  expect(todayRun).not.toMatch(/<w:rFonts\b/);
  expect(budgetRun.toLowerCase()).toContain('w:val="c00000"');
  expect(budgetRun).not.toMatch(/<w:rFonts\b/);
  expect(minutesXml).toContain('w:firstLine="720"');
  await caption(
    page,
    "Word gets Georgia back on urgent, the bold, and the dark red on budget.",
    2200,
  );
});
