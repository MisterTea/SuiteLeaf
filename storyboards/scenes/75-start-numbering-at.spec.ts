import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { createFile, serializeFile, type DocFile } from "../../packages/core/src";
import { beat, caption, expect, test, typeSlowly } from "./harness";
import type { Page } from "@playwright/test";

function minutes(): DocFile {
  const file = createFile("doc", "October minutes") as DocFile;
  file.content = {
    type: "doc",
    attrs: {
      pageSettings: {
        size: "letter",
        landscape: false,
        margin: 72,
        header: "",
        footer: "Committee draft",
        pageNumbers: true,
        pageNumberFormat: "page",
        pageNumberPosition: "bottom-center",
        pageNumberPositionSet: true,
      },
    },
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "October minutes" }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "The committee met on Tuesday. These pages belong in a packet that already has a cover and two letters.",
          },
        ],
      },
      { type: "pageBreak" },
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Votes" }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "The budget passed. The next meeting is in November.",
          },
        ],
      },
    ],
  };
  return file;
}

function face(page: Page, index: number) {
  return page.locator(".page-furniture-page").nth(index);
}

/** Put a page footer in the upper-middle, clear of the status bar. */
async function showFooter(page: Page, index: number) {
  await page.evaluate((i) => {
    const stage = document.querySelector(".document-stage");
    const paper = document.querySelector(".paginated-paper");
    if (paper instanceof HTMLElement) paper.style.marginBottom = "70vh";
    if (!(stage instanceof HTMLElement)) return;
    const footer = document.querySelectorAll(".page-footer")[i];
    if (!(footer instanceof HTMLElement)) return;
    const stageRect = stage.getBoundingClientRect();
    const footerRect = footer.getBoundingClientRect();
    stage.scrollTop += footerRect.top - (stageRect.top + stage.clientHeight * 0.46);
  }, index);
  await beat(page, 500);
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

async function captionBelow(page: Page, text: string, hold = 1200) {
  await captionOnOutline(page, text, hold);
}

test("75-start-numbering-at", async ({ page }) => {
  await page.goto("/");
  await captionBelow(
    page,
    "Ben opens the minutes. They say Page 1 and Page 2, centered.",
    900,
  );
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (
    await chooser
  ).setFiles({
    name: "October minutes.sldoc",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(minutes())),
  });
  await expect(page.locator(".editor-status")).toContainText("2 pages");
  await expect(page.locator(".page-number")).toHaveText(["Page 1", "Page 2"]);
  await showFooter(page, 0);
  await expect(face(page, 0).locator(".page-footer-text")).toHaveText(
    "Committee draft",
  );
  await beat(page, 900);
  await showFooter(page, 1);
  await beat(page, 1000);

  await captionOnOutline(
    page,
    "Start at is in Page setup, beside format and position.",
    400,
  );
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Page setup" });
  await expect(setup.getByRole("radio", { name: "Page 1" })).toBeChecked();
  await expect(setup.getByRole("radio", { name: "Bottom center" })).toBeChecked();
  const start = setup.getByLabel("Start at");
  await start.scrollIntoViewIfNeeded();
  await beat(page, 500);
  await start.click();
  await page.keyboard.press("ControlOrMeta+A");
  await typeSlowly(page, "4", 160);
  await expect(start).toHaveValue("4");
  const hint = setup.locator("#page-numbers-hint");
  await hint.scrollIntoViewIfNeeded();
  await expect(hint).toContainText("Page 4");
  await expect(hint).toContainText("Page 5");
  await expect(setup.locator(".page-setup-preview-number").first()).toContainText(
    "Page 4",
  );
  await beat(page, 1200);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();

  await captionBelow(
    page,
    "The first page of the file says Page 4. The next says Page 5.",
    400,
  );
  await expect(page.locator(".page-number")).toHaveText(["Page 4", "Page 5"]);
  await showFooter(page, 0);
  await expect(face(page, 0).locator(".page-footer-text")).toHaveText(
    "Committee draft",
  );
  await expect(face(page, 0).locator(".page-number")).toHaveText("Page 4");
  await beat(page, 1100);
  await showFooter(page, 1);
  await expect(face(page, 1).locator(".page-footer-text")).toHaveText(
    "Committee draft",
  );
  await expect(face(page, 1).locator(".page-number")).toHaveText("Page 5");
  await captionBelow(
    page,
    "Committee draft stays in the footer. The number is separate.",
    1400,
  );

  await captionOnOutline(
    page,
    "A cover has no number. The next page is Page 1, not Page 2.",
    400,
  );
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const cover = setup.getByRole("checkbox", { name: "Cover has no number" });
  await cover.scrollIntoViewIfNeeded();
  await beat(page, 400);
  await cover.check();
  await expect(start).toBeDisabled();
  await expect(start).toHaveValue("4");
  await hint.scrollIntoViewIfNeeded();
  await expect(hint).toContainText("Page 1");
  await expect(hint).toContainText("Page 2");
  await beat(page, 1400);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await captionBelow(
    page,
    "The cover has no number. Committee draft is still in the footer.",
    300,
  );
  await showFooter(page, 0);
  await expect(face(page, 0).locator(".page-number")).toHaveCount(0);
  await expect(face(page, 0).locator(".page-footer-text")).toHaveText(
    "Committee draft",
  );
  await beat(page, 1000);
  await captionBelow(page, "The next page says Page 1, not Page 2.", 300);
  await showFooter(page, 1);
  await expect(face(page, 1).locator(".page-number")).toHaveText("Page 1");
  await expect(face(page, 1).locator(".page-footer-text")).toHaveText(
    "Committee draft",
  );
  await beat(page, 1200);

  await captionOnOutline(
    page,
    "Numbers off. The footer stays, and so do Start at and the cover.",
    400,
  );
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await setup.getByLabel("Page numbers").uncheck();
  await expect(start).toHaveValue("4");
  await expect(cover).toBeChecked();
  await beat(page, 1100);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await captionBelow(page, "Every page number is gone. The footer is still there.", 300);
  await showFooter(page, 0);
  await expect(page.locator(".page-number")).toHaveCount(0);
  await expect(face(page, 0).locator(".page-footer-text")).toHaveText(
    "Committee draft",
  );
  await beat(page, 900);

  await captionOnOutline(
    page,
    "Turning numbers on restores Start at 4 and the cover.",
    400,
  );
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await start.scrollIntoViewIfNeeded();
  await expect(start).toHaveValue("4");
  await expect(cover).toBeChecked();
  await beat(page, 1100);
  await setup.getByLabel("Page numbers").check();
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await captionBelow(page, "The cover is blank again. The next page is Page 1.", 300);
  await showFooter(page, 0);
  await expect(face(page, 0).locator(".page-number")).toHaveCount(0);
  await beat(page, 700);
  await showFooter(page, 1);
  await expect(face(page, 1).locator(".page-number")).toHaveText("Page 1");
  await beat(page, 900);

  await captionBelow(
    page,
    "He saves, then opens the file again.",
    700,
  );
  await expect(page.getByRole("status")).toContainText("Saved");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("October minutes.sldoc");
  const savedPath = join(
    mkdtempSync(join(tmpdir(), "storyboard-75-")),
    download.suggestedFilename(),
  );
  await download.saveAs(savedPath);
  const saved = JSON.parse(readFileSync(savedPath, "utf8"));
  expect(saved.content.attrs.pageSettings).toMatchObject({
    pageNumberStart: 4,
    coverHasNoNumber: true,
    pageNumberFormat: "page",
    pageNumberPosition: "bottom-center",
    footer: "Committee draft",
    pageNumbers: true,
  });
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  const openChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (await openChooser).setFiles(savedPath);
  const same = page.getByRole("dialog", { name: /already/ });
  await expect(same.or(page.locator(".editor-status"))).toBeVisible();
  if (await same.isVisible())
    await same.getByRole("button", { name: "Replace" }).click();
  await expect(page.locator(".editor-status")).toContainText("2 pages");
  await showFooter(page, 0);
  await expect(face(page, 0).locator(".page-number")).toHaveCount(0);
  await expect(face(page, 0).locator(".page-footer-text")).toHaveText(
    "Committee draft",
  );
  await showFooter(page, 1);
  await expect(face(page, 1).locator(".page-number")).toHaveText("Page 1");
  await captionBelow(
    page,
    "Still no number on the cover. The next page is still Page 1.",
    1400,
  );

  await captionBelow(page, "Word starts at 1 after the cover, not at 2.", 500);
  const docxPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 400);
  await page.getByRole("menuitem", { name: "Export DOCX", exact: true }).click();
  const docx = await docxPromise;
  const zip = await JSZip.loadAsync(readFileSync((await docx.path())!));
  const xml = await zip.file("word/document.xml")!.async("string");
  expect(xml).toContain('w:start="0"');
  expect(xml).toContain("w:titlePg");
  const footers = await Promise.all(
    Object.keys(zip.files)
      .filter((name) => /word\/footer\d+\.xml$/.test(name))
      .map((name) => zip.file(name)!.async("string")),
  );
  expect(
    footers.some(
      (item) => item.includes("Committee draft") && !/PAGE(?!S)/.test(item),
    ),
  ).toBe(true);
  expect(
    footers.some(
      (item) => item.includes("Committee draft") && /PAGE(?!S)/.test(item),
    ),
  ).toBe(true);
  await showFooter(page, 1);
  await captionBelow(
    page,
    "Word numbers that page 1. The footer is still Committee draft.",
    1600,
  );
});
