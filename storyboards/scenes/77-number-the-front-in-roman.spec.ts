import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { createFile, serializeFile, type DocFile } from "../../packages/core/src";
import { beat, caption, expect, test } from "./harness";
import type { Page } from "@playwright/test";

function report(): DocFile {
  const file = createFile("doc", "Field report") as DocFile;
  const paragraph = (text: string) => ({
    type: "paragraph",
    content: [{ type: "text", text }],
  });
  const heading = (text: string) => ({
    type: "heading",
    attrs: { level: 1 },
    content: [{ type: "text", text }],
  });
  file.content = {
    type: "doc",
    attrs: {
      pageSettings: {
        size: "letter",
        landscape: false,
        margin: 72,
        header: "",
        footer: "Draft",
        pageNumbers: true,
        pageNumberFormat: "page",
        pageNumberPosition: "bottom-center",
        pageNumberPositionSet: true,
      },
    },
    content: [
      heading("Contents"),
      paragraph("Maps and tables for the field season."),
      { type: "pageBreak" },
      heading("Figures"),
      paragraph("The site plan and the rain chart."),
      { type: "pageBreak" },
      heading("Chapter 1"),
      paragraph("The survey began in March."),
      { type: "pageBreak" },
      paragraph("The first chapter continues with the soil samples."),
    ],
  };
  return file;
}

function face(page: Page, index: number) {
  return page.locator(".page-furniture-page").nth(index);
}

/** Put a page footer in the upper third, above the caption. */
async function showFooter(page: Page, index: number) {
  await page.evaluate((i) => {
    const stage = document.querySelector(".document-stage");
    const paper = document.querySelector(".paginated-paper");
    if (!(stage instanceof HTMLElement) || !(paper instanceof HTMLElement)) return;
    paper.style.paddingBottom = "90vh";
    const footer = document.querySelectorAll(".page-furniture .page-footer")[i];
    if (!(footer instanceof HTMLElement)) return;
    const stageRect = stage.getBoundingClientRect();
    const footerRect = footer.getBoundingClientRect();
    stage.scrollTop = Math.max(
      0,
      stage.scrollTop + footerRect.top - stageRect.top - stage.clientHeight * 0.22,
    );
  }, index);
  await beat(page, 700);
}

async function captionTop(page: Page, text: string, hold = 1200) {
  await caption(page, text, 0);
  await page.evaluate(() => {
    const bar = document.getElementById("storyboard-caption");
    if (!bar) return;
    bar.style.top = "152px";
    bar.style.bottom = "auto";
    bar.style.left = "50%";
    bar.style.transform = "translateX(-50%)";
    bar.style.maxWidth = "720px";
    bar.style.textAlign = "center";
  });
  await page.waitForTimeout(hold);
}

async function captionBottom(page: Page, text: string, hold = 1200) {
  await caption(page, text, 0);
  await page.evaluate(() => {
    const bar = document.getElementById("storyboard-caption");
    if (!bar) return;
    bar.style.top = "auto";
    bar.style.bottom = "24px";
    bar.style.left = "50%";
    bar.style.transform = "translateX(-50%)";
    bar.style.maxWidth = "760px";
    bar.style.textAlign = "center";
  });
  await page.waitForTimeout(hold);
}

/** Keep the caption on the outline while Page setup is open, so Apply stays visible. */
async function captionOnOutline(page: Page, text: string, hold = 1100) {
  await caption(page, text, 0);
  await page.evaluate(() => {
    const bar = document.getElementById("storyboard-caption");
    if (!bar) return;
    bar.style.top = "168px";
    bar.style.bottom = "auto";
    bar.style.left = "12px";
    bar.style.transform = "none";
    bar.style.maxWidth = "220px";
    bar.style.textAlign = "left";
  });
  await page.waitForTimeout(hold);
}

test("77-number-the-front-in-roman", async ({ page }) => {
  await page.goto("/");
  await captionBottom(
    page,
    "Amara opens her report. The pages say Page 1 through Page 4.",
    800,
  );
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (
    await chooser
  ).setFiles({
    name: "Field report.sldoc",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(report())),
  });
  await expect(page.locator(".editor-status")).toContainText("4 pages");
  await expect(page.locator(".page-number")).toHaveText([
    "Page 1",
    "Page 2",
    "Page 3",
    "Page 4",
  ]);
  await page.locator(".document-content p").first().click();
  await showFooter(page, 0);
  await expect(face(page, 0).locator(".page-footer-text")).toHaveText("Draft");
  await expect(face(page, 0).locator(".page-number")).toHaveText("Page 1");
  await beat(page, 900);
  await captionTop(
    page,
    "Amara opens her report. The pages say Page 1 through Page 4.",
    200,
  );
  await showFooter(page, 3);
  await expect(face(page, 3).locator(".page-number")).toHaveText("Page 4");
  await beat(page, 1100);

  await captionOnOutline(
    page,
    "Lowercase roman is in Page setup, next to Page 1 and Start at.",
    500,
  );
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Page setup" });
  const format = setup.getByRole("group", { name: "Format" });
  await format.scrollIntoViewIfNeeded();
  await beat(page, 400);
  await expect(setup.getByRole("radio", { name: "Page 1" })).toBeChecked();
  const roman = setup.getByRole("radio", { name: /^i … / });
  const start = setup.getByLabel("Start at");
  await expect(roman).toBeVisible();
  await expect(start).toBeVisible();
  await expect(start).toHaveValue("1");
  await roman.check();
  await expect(roman).toBeChecked();
  const hint = setup.locator("#page-numbers-hint");
  await hint.scrollIntoViewIfNeeded();
  await expect(hint).toContainText("i");
  await expect(setup.locator(".page-setup-preview-number").first()).toContainText(
    "i",
  );
  await beat(page, 1200);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await captionBottom(page, "The front pages say i and ii. Draft stays in the footer.", 400);
  await expect(page.locator(".page-number")).toHaveText(["i", "ii", "iii", "iv"]);
  await showFooter(page, 0);
  await expect(face(page, 0).locator(".page-number")).toHaveText("i");
  await expect(face(page, 0).locator(".page-footer-text")).toHaveText("Draft");
  await beat(page, 1000);
  await showFooter(page, 1);
  await expect(face(page, 1).locator(".page-number")).toHaveText("ii");
  await expect(face(page, 1).locator(".page-footer-text")).toHaveText("Draft");
  await beat(page, 1000);

  await captionBottom(
    page,
    "She marks Chapter 1: Start Arabic numbers here. No second dialog.",
    500,
  );
  const chapter = page.getByRole("heading", { name: "Chapter 1" });
  await chapter.scrollIntoViewIfNeeded();
  await chapter.click();
  const mark = page.getByRole("button", { name: "Start Arabic numbers here" });
  await expect(mark).toBeEnabled();
  await expect(page.locator(".outline .arabic-start-hint")).toContainText("Chapter 1");
  await beat(page, 700);
  await mark.click();
  await page.mouse.move(640, 280);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".page-number")).toHaveText(["i", "ii", "1", "2"]);
  await captionTop(page, "Chapter 1 is page 1. The next page is 2.", 400);
  await showFooter(page, 2);
  await expect(face(page, 2).locator(".page-number")).toHaveText("1");
  await expect(face(page, 2).locator(".page-footer-text")).toHaveText("Draft");
  await beat(page, 1100);
  await showFooter(page, 3);
  await expect(face(page, 3).locator(".page-number")).toHaveText("2");
  await expect(face(page, 3).locator(".page-footer-text")).toHaveText("Draft");
  await beat(page, 1500);
  await captionBottom(page, "The front pages are still i and ii. Draft is still there.", 300);
  await showFooter(page, 0);
  await expect(face(page, 0).locator(".page-number")).toHaveText("i");
  await expect(face(page, 0).locator(".page-footer-text")).toHaveText("Draft");
  await beat(page, 800);
  await showFooter(page, 1);
  await expect(face(page, 1).locator(".page-number")).toHaveText("ii");
  await beat(page, 1000);

  await captionBottom(page, "She saves, then opens the file again.", 700);
  await expect(page.getByRole("status")).toContainText("Saved");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("Field report.sldoc");
  const savedPath = join(
    mkdtempSync(join(tmpdir(), "storyboard-77-")),
    download.suggestedFilename(),
  );
  await download.saveAs(savedPath);
  const saved = JSON.parse(readFileSync(savedPath, "utf8"));
  expect(saved.content.attrs.pageSettings.pageNumberFormat).toBe("roman");
  expect(saved.content.attrs.pageSettings.footer).toBe("Draft");
  expect(
    saved.content.content.some(
      (node: { type: string; attrs?: { startArabic?: boolean }; content?: { text?: string }[] }) =>
        node.type === "heading" &&
        node.attrs?.startArabic === true &&
        node.content?.[0]?.text === "Chapter 1",
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  const openChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (await openChooser).setFiles(savedPath);
  const same = page.getByRole("dialog", { name: /already/ });
  await expect(same.or(page.locator(".editor-status"))).toBeVisible();
  if (await same.isVisible())
    await same.getByRole("button", { name: "Replace" }).click();
  await expect(page.locator(".editor-status")).toContainText("4 pages");
  await expect(page.locator(".page-number")).toHaveText(["i", "ii", "1", "2"]);
  await page.getByRole("heading", { name: "Chapter 1" }).click();
  await page.mouse.move(640, 280);
  await showFooter(page, 2);
  await expect(face(page, 2).locator(".page-number")).toHaveText("1");
  await expect(face(page, 2).locator(".page-footer-text")).toHaveText("Draft");
  await captionBottom(
    page,
    "Still roman in front. Chapter 1 is still page 1.",
    1400,
  );

  await captionBottom(page, "Word uses roman numerals, then starts the chapter at 1.", 500);
  const docxPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 400);
  await page.getByRole("menuitem", { name: "Export DOCX", exact: true }).click();
  const docx = await docxPromise;
  const zip = await JSZip.loadAsync(readFileSync((await docx.path())!));
  const xml = await zip.file("word/document.xml")!.async("string");
  expect(xml).toContain('w:fmt="lowerRoman"');
  expect(xml).toContain('w:start="1"');
  expect(xml).toContain('w:fmt="decimal"');
  expect(xml).toContain('w:val="nextPage"');
  const chapterAt = xml.indexOf("Chapter 1");
  expect(xml.indexOf('w:fmt="lowerRoman"')).toBeLessThan(chapterAt);
  expect(xml.indexOf('w:fmt="decimal"')).toBeGreaterThan(chapterAt);
  const footers = await Promise.all(
    Object.keys(zip.files)
      .filter((name) => /word\/footer\d+\.xml$/.test(name))
      .map((name) => zip.file(name)!.async("string")),
  );
  expect(footers.every((item) => item.includes("Draft"))).toBe(true);
  expect(footers.every((item) => !item.includes("Page "))).toBe(true);
  await showFooter(page, 2);
  await captionBottom(
    page,
    "The chapter starts at 1. Draft is still in the footer.",
    1600,
  );
});
