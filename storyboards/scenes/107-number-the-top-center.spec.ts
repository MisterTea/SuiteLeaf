import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import type { Page } from "@playwright/test";
import { createFile, serializeFile, type DocFile } from "../../packages/core/src";
import { beat, caption, expect, test } from "./harness";

function report(): DocFile {
  const file = createFile("doc", "Short report") as DocFile;
  file.content = {
    type: "doc",
    attrs: {
      pageSettings: {
        size: "letter",
        landscape: false,
        margin: 96,
        marginTop: 96,
        marginBottom: 96,
        marginLeft: 96,
        marginRight: 96,
        headerFromEdge: 48,
        footerFromEdge: 72,
        header: "Field report",
        footer: "Draft",
        pageNumbers: false,
      },
    },
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Short report" }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Nia is finishing the report today.",
          },
        ],
      },
    ],
  };
  return file;
}

/** Keep the caption on the outline so it never covers a page number. */
async function say(page: Page, text: string, hold = 1500) {
  await caption(page, text, 0);
  await page.evaluate(() => {
    const bar = document.getElementById("storyboard-caption");
    if (!bar) return;
    bar.style.left = "16px";
    bar.style.right = "auto";
    bar.style.top = "auto";
    bar.style.bottom = "16px";
    bar.style.transform = "none";
    bar.style.maxWidth = "280px";
    bar.style.textAlign = "left";
  });
  await beat(page, hold);
}

function face(page: Page, index: number) {
  return page.locator(".page-furniture-page").nth(index);
}

async function showTop(page: Page, index: number) {
  await face(page, index).evaluate((el) => {
    const stage = el.closest(".document-stage") as HTMLElement;
    const stageBox = stage.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const top = stage.scrollTop + (box.top - stageBox.top) - 8;
    stage.scrollTo({ top: Math.max(0, top), behavior: "auto" });
  });
  await beat(page, 450);
}

async function showFooter(page: Page, index: number) {
  const footer = face(page, index).locator(".page-footer");
  await footer.evaluate((el) => {
    const stage = el.closest(".document-stage") as HTMLElement;
    const stageBox = stage.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const top = stage.scrollTop + (box.top - stageBox.top) - stageBox.height * 0.45;
    stage.scrollTo({ top: Math.max(0, top), behavior: "auto" });
  });
  await beat(page, 450);
}

/** The number sits in the horizontal center of this page's top margin. */
async function expectTopCenter(page: Page, index: number) {
  const sheet = face(page, index);
  await expect(sheet).toHaveAttribute("data-number-side", "top-center");
  const number = sheet.locator(".page-number");
  await expect(number).toHaveCount(1);
  await expect(sheet.locator(".page-footer .page-number")).toHaveCount(0);
  await expect(sheet.locator(".page-footer-text")).toHaveText("Draft");
  const paper = page.locator(".paginated-paper");
  const paperBox = await paper.boundingBox();
  const numberBox = await number.boundingBox();
  const sheetBox = await sheet.boundingBox();
  expect(paperBox && numberBox && sheetBox).toBeTruthy();
  const pageMid = paperBox!.x + paperBox!.width / 2;
  const numberMid = numberBox!.x + numberBox!.width / 2;
  expect(Math.abs(pageMid - numberMid)).toBeLessThan(14);
  expect(numberBox!.y).toBeGreaterThan(sheetBox!.y);
  expect(numberBox!.y).toBeLessThan(sheetBox!.y + sheetBox!.height * 0.2);
}

test("107-number-the-top-center", async ({ page }) => {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Short report.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(report())),
  });
  await expect(page.locator(".editor-status")).toContainText("1 page");
  await page.locator(".paper-container").evaluate((el) => {
    el.style.paddingBottom = "48vh";
  });
  await expect(page.locator(".page-number")).toHaveCount(0);
  await showTop(page, 0);
  await say(
    page,
    "Nia’s report is one page. Page numbers are off. She turns them on.",
    1600,
  );

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Page setup" });
  await expect(page.getByRole("dialog")).toHaveCount(1);
  const bottomRight = setup.getByRole("radio", { name: "Bottom right" });
  const bottomCenter = setup.getByRole("radio", { name: "Bottom center" });
  const topRight = setup.getByRole("radio", { name: "Top right" });
  const topCenter = setup.getByRole("radio", { name: "Top center" });
  await setup.getByLabel("Page numbers").check();
  await topCenter.scrollIntoViewIfNeeded();
  await expect(bottomRight).toBeChecked();
  await expect(bottomCenter).toBeVisible();
  await expect(topRight).toBeVisible();
  await expect(topCenter).toBeVisible();
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");
  await expect(setup.getByLabel("Header from edge")).toHaveValue("0.5");
  await beat(page, 700);
  await say(
    page,
    "Bottom right, Bottom center, Top right, and Top center are in this page setup. No second dialog.",
    1800,
  );
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await expect(face(page, 0)).toHaveAttribute("data-number-side", "right");
  await expect(face(page, 0).locator(".page-footer .page-number")).toHaveText("1 / 1");
  await expect(page.locator(".page-number-top")).toHaveCount(0);
  await showFooter(page, 0);
  await say(page, "The number starts at the bottom right: “1 / 1”.", 1700);

  await say(page, "She chooses Top center in the same page setup.", 700);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await topCenter.scrollIntoViewIfNeeded();
  await beat(page, 400);
  await topCenter.check();
  await expect(topCenter).toBeChecked();
  await expect(setup.locator("#page-numbers-hint")).toContainText("Top center");
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");
  await expect(setup.getByLabel("Bottom margin")).toHaveValue("1");
  await expect(setup.getByLabel("Left margin")).toHaveValue("1");
  await expect(setup.getByLabel("Right margin")).toHaveValue("1");
  await expect(setup.getByLabel("Header from edge")).toHaveValue("0.5");
  await beat(page, 800);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await expect(page.locator(".editor-status")).toContainText("1 page");
  await showTop(page, 0);
  await expectTopCenter(page, 0);
  await expect(face(page, 0).locator(".page-number")).toHaveText("1 / 1");
  await say(
    page,
    "On this one page, “1 / 1” is centered in the top margin. The footer has no number.",
    2000,
  );

  await say(page, "She adds a second page. That number is centered at the top too.", 800);
  await page.getByText("Nia is finishing the report today.").click();
  await page.keyboard.press("End");
  await page.getByRole("button", { name: "Page break", exact: true }).click();
  await page.keyboard.type("The second page.", { delay: 40 });
  await expect(page.locator(".editor-status")).toContainText("2 pages");
  await expect(page.locator(".page-number")).toHaveText(["1 / 2", "2 / 2"]);
  await showTop(page, 0);
  await expectTopCenter(page, 0);
  await say(page, "Page 1 is “1 / 2”, still centered at the top.", 1600);
  await showTop(page, 1);
  await expectTopCenter(page, 1);
  await say(page, "Page 2 is “2 / 2”, centered in the top margin. The footer is only “Draft”.", 1800);

  await say(page, "Bottom right puts the number back in the corner and clears the top.", 800);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await bottomRight.scrollIntoViewIfNeeded();
  await bottomRight.check();
  await beat(page, 500);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(face(page, 0)).toHaveAttribute("data-number-side", "right");
  await expect(face(page, 1)).toHaveAttribute("data-number-side", "right");
  await expect(page.locator(".page-number-top")).toHaveCount(0);
  await expect(face(page, 0).locator(".page-footer .page-number")).toHaveText("1 / 2");
  await showFooter(page, 0);
  await say(page, "“1 / 2” is at the bottom right again. Nothing is left at the top.", 1800);

  await say(page, "She chooses Top center again, then saves and reopens.", 800);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await topCenter.scrollIntoViewIfNeeded();
  await topCenter.check();
  await expect(setup.getByLabel("Header from edge")).toHaveValue("0.5");
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");
  await beat(page, 500);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await showTop(page, 0);
  await expectTopCenter(page, 0);
  await expect(page.getByRole("status")).toContainText("Saved");
  await beat(page, 600);
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await beat(page, 700);
  await page.getByRole("link", { name: "Short report" }).click();
  await expect(page.locator(".editor-status")).toContainText("2 pages");
  await showTop(page, 0);
  await expectTopCenter(page, 0);
  await showTop(page, 1);
  await expectTopCenter(page, 1);
  await expect(face(page, 0).locator(".page-footer-text")).toHaveText("Draft");
  await say(page, "Reopened. Both pages still center the number at the top.", 1800);

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expect(topCenter).toBeChecked();
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");
  await expect(setup.getByLabel("Header from edge")).toHaveValue("0.5");
  await setup.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(setup).toBeHidden();

  await say(page, "Word keeps that number in the header, centered, and not in the footer.", 900);
  const docxPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 400);
  await page.getByRole("menuitem", { name: "Export DOCX", exact: true }).click();
  const docx = await docxPromise;
  const zip = await JSZip.loadAsync(readFileSync((await docx.path())!));
  const header = await zip.file("word/header1.xml")!.async("string");
  const footer = await zip.file("word/footer1.xml")!.async("string");
  const numbered = header
    .split(/<w:p[\s>]/)
    .slice(1)
    .find((paragraph) => /PAGE(?!S)/.test(paragraph));
  expect(numbered).toBeTruthy();
  expect(numbered).toMatch(/w:val="center"/);
  expect(footer).toContain("Draft");
  expect(footer).not.toMatch(/PAGE(?!S)/);
  const section = await zip.file("word/document.xml")!.async("string");
  expect(section).toContain('w:header="720"');
  expect(section).toContain('w:top="1440"');
  await showTop(page, 0);
  await say(page, "The Word file numbers the header at the center. The footer stays “Draft”.", 1800);
});
