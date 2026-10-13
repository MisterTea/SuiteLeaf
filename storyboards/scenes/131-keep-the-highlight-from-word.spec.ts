import { readFileSync } from "node:fs";
import JSZip from "jszip";
import type { Page } from "@playwright/test";
import { highlightStoryDocx } from "../../tests/word-highlight-fixtures";
import { beat, caption, expect, test } from "./harness";

const docxMime =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const yellow = "rgb(255, 255, 0)";
const blue = "rgb(26, 115, 232)";

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
      const weight = node.parentElement
        ? getComputedStyle(node.parentElement).fontWeight
        : "400";
      return { background, weight, text };
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

test("131-keep-the-highlight-from-word", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Nia opens the minutes she received as a Word file.");
  await openWord(page, "Minutes.docx", await highlightStoryDocx());
  await expect(paragraph(page, "urgent")).toBeVisible();
  await expect(paragraph(page, "budget")).toBeVisible();

  const urgent = await wordLook(page, "urgent");
  const vote = await wordLook(page, "vote");
  const today = await wordLook(page, "today");
  const budget = await wordLook(page, "budget");
  expect(urgent?.background).toBe(yellow);
  expect(Number(urgent?.weight)).toBeGreaterThanOrEqual(600);
  expect(urgent?.text).toBe("urgent");
  expect(vote?.background).not.toBe(yellow);
  expect(vote?.text).not.toContain("urgent");
  expect(today?.background).not.toBe(yellow);
  expect(today?.text).not.toContain("urgent");
  expect(budget?.background).toBe(blue);
  expect(budget?.text).toBe("budget");
  expect(Number(budget?.weight)).toBeLessThan(600);

  await caption(
    page,
    "Only urgent is yellow, and it is still bold. vote and today are plain. budget is blue.",
  );
  await beat(page, 1600);

  const swatch = page.locator(".highlight-color-picker");
  await expect(swatch).toBeVisible();

  await caption(
    page,
    "The caret is in urgent. The highlight swatch shows yellow.",
  );
  await clickWord(page, "urgent");
  await expect(swatch).toHaveAttribute("data-highlight", "#ffff00");
  await expect(swatch.locator(".color-bar")).toHaveCSS(
    "background-color",
    yellow,
  );
  await beat(page, 1600);

  await caption(
    page,
    "She moves to today. The swatch no longer claims that word is highlighted.",
  );
  await clickWord(page, "today");
  await expect(swatch).toHaveAttribute("data-highlight", "none");
  await expect(swatch.locator(".color-bar")).not.toHaveCSS(
    "background-color",
    yellow,
  );
  expect((await wordLook(page, "today"))?.background).not.toBe(yellow);
  await beat(page, 1600);

  await caption(
    page,
    "In budget, the swatch shows the blue from the Word shading.",
  );
  await paragraph(page, "budget").scrollIntoViewIfNeeded();
  await clickWord(page, "budget");
  await expect(swatch).toHaveAttribute("data-highlight", "#1a73e8");
  await expect(swatch.locator(".color-bar")).toHaveCSS(
    "background-color",
    blue,
  );
  await beat(page, 1600);

  await caption(
    page,
    "She saves, returns home, and reopens. urgent is still yellow and bold. budget is still blue.",
  );
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await beat(page, 800);
  await page.getByRole("link", { name: /Minutes/ }).click();
  await expect(paragraph(page, "urgent")).toBeVisible();
  expect((await wordLook(page, "urgent"))?.background).toBe(yellow);
  expect(
    Number((await wordLook(page, "urgent"))?.weight),
  ).toBeGreaterThanOrEqual(600);
  expect((await wordLook(page, "today"))?.background).not.toBe(yellow);
  expect((await wordLook(page, "budget"))?.background).toBe(blue);
  await clickWord(page, "urgent");
  await expect(swatch).toHaveAttribute("data-highlight", "#ffff00");
  await beat(page, 1400);

  await caption(
    page,
    "File, Export DOCX. urgent is still yellow and bold. budget still has the blue fill.",
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
  expect(urgentRun.toLowerCase()).toContain('w:fill="ffff00"');
  expect(urgentRun.toLowerCase()).toMatch(/<w:b(?:\s|>|\/>)/);
  expect(todayRun.toLowerCase()).not.toContain("w:shd");
  expect(budgetRun.toLowerCase()).toContain('w:fill="1a73e8"');
  expect(minutesXml).toContain('w:firstLine="720"');
  await caption(
    page,
    "Word gets the yellow back on urgent, the bold, and the blue fill on budget.",
    2200,
  );
});
