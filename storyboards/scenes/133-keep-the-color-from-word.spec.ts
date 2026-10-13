import { readFileSync } from "node:fs";
import JSZip from "jszip";
import type { Page } from "@playwright/test";
import { colorStoryDocx } from "../../tests/word-color-fixtures";
import { beat, caption, expect, test } from "./harness";

const docxMime =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const darkRed = "rgb(192, 0, 0)";
const normalSwatch = "rgb(32, 33, 36)";
const yellow = "rgb(255, 255, 0)";
const bodyText = "rgb(0, 0, 0)";

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
        text,
      };
    }
    return null;
  }, word);
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

test("133-keep-the-color-from-word", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Nia opens the minutes she received as a Word file.");
  await openWord(page, "Minutes.docx", await colorStoryDocx());
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
  expect(urgent?.color).toBe(darkRed);
  expect(Number(urgent?.weight)).toBeGreaterThanOrEqual(600);
  expect(urgent?.text).toBe("urgent");
  expect(urgent?.background).not.toBe(yellow);
  expect(vote?.color).toBe(bodyText);
  expect(vote?.text).not.toContain("urgent");
  expect(today?.color).toBe(bodyText);
  expect(today?.text).not.toContain("urgent");
  expect(budget?.background).toBe(yellow);
  expect(budget?.color).toBe(bodyText);
  expect(budget?.text).toBe("budget");
  expect(Number(budget?.weight)).toBeLessThan(600);

  await caption(
    page,
    "Only urgent is dark red, and it is still bold. vote and today stay black. budget is highlighted yellow.",
  );
  await beat(page, 1600);

  const swatch = page.locator(".text-color-picker");
  await expect(swatch).toBeVisible();

  await caption(
    page,
    "The caret is in urgent. The text-color swatch shows that dark red.",
  );
  await clickWord(page, "urgent");
  await expect(swatch).toHaveAttribute("data-text-color", "#c00000");
  await expect(swatch.locator(".color-bar")).toHaveCSS(
    "background-color",
    darkRed,
  );
  await expect(swatch.locator(".text-color-letter")).toHaveCSS("color", darkRed);
  await beat(page, 1600);

  await caption(
    page,
    "She moves to today. The swatch returns to the normal text color, and today is not red.",
  );
  await clickWord(page, "today");
  await expect(swatch).toHaveAttribute("data-text-color", "#202124");
  await expect(swatch.locator(".color-bar")).toHaveCSS(
    "background-color",
    normalSwatch,
  );
  await expect(swatch.locator(".text-color-letter")).toHaveCSS(
    "color",
    normalSwatch,
  );
  expect((await wordLook(page, "today"))?.color).toBe(bodyText);
  await beat(page, 1600);

  await caption(
    page,
    "budget stays a yellow highlight on normal-colored text. The font color did not turn it red.",
  );
  await paragraph(page, "budget").scrollIntoViewIfNeeded();
  await clickWord(page, "budget");
  await expect(swatch).toHaveAttribute("data-text-color", "#202124");
  await expect(page.locator(".highlight-color-picker")).toHaveAttribute(
    "data-highlight",
    "#ffff00",
  );
  expect((await wordLook(page, "budget"))?.background).toBe(yellow);
  expect((await wordLook(page, "budget"))?.color).toBe(bodyText);
  await beat(page, 1600);

  await caption(
    page,
    "She saves, returns home, and reopens. urgent is still dark red and bold. budget is still highlighted yellow.",
  );
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await beat(page, 800);
  await page.getByRole("link", { name: /Minutes/ }).click();
  await expect(paragraph(page, "urgent")).toBeVisible();
  expect((await wordLook(page, "urgent"))?.color).toBe(darkRed);
  expect(
    Number((await wordLook(page, "urgent"))?.weight),
  ).toBeGreaterThanOrEqual(600);
  expect((await wordLook(page, "today"))?.color).toBe(bodyText);
  expect((await wordLook(page, "budget"))?.background).toBe(yellow);
  expect((await wordLook(page, "budget"))?.color).toBe(bodyText);
  await clickWord(page, "urgent");
  await expect(swatch).toHaveAttribute("data-text-color", "#c00000");
  await beat(page, 1400);

  await caption(
    page,
    "File, Export DOCX. urgent is still color C00000 and bold. today has no font color. budget keeps the yellow highlight.",
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
  expect(urgentRun.toLowerCase()).toContain('w:val="c00000"');
  expect(urgentRun.toLowerCase()).toMatch(/<w:b(?:\s|>|\/>)/);
  expect(todayRun.toLowerCase()).not.toMatch(/<w:color\b/);
  expect(budgetRun.toLowerCase()).toContain('w:fill="ffff00"');
  expect(budgetRun.toLowerCase()).not.toMatch(/<w:color\b/);
  expect(minutesXml).toContain('w:firstLine="720"');
  await caption(
    page,
    "Word gets the dark red back on urgent, the bold, and the yellow highlight on budget.",
    2200,
  );
});
