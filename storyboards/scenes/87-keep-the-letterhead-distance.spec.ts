import { readFileSync } from "node:fs";
import JSZip from "jszip";
import type { Download, Page } from "@playwright/test";
import {
  councilLetterheadDocx,
  letterheadDocx,
} from "../../tests/letterhead-fixtures";
import { beat, caption, expect, test } from "./harness";

const docx =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function openFile(page: Page, name: string, bytes: Uint8Array, mime: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (await chooser).setFiles({
    name,
    mimeType: mime,
    buffer: Buffer.from(bytes),
  });
  const editor = page.getByRole("textbox", { name: "Document content" });
  const same = page.getByRole("dialog", { name: /already/ });
  await expect(editor.or(same)).toBeVisible();
  if (await same.isVisible()) {
    await caption(page, "That copy is already in the library, so she keeps both.", 1400);
    await same.getByRole("button", { name: "Keep both" }).click();
  }
  await expect(editor).toBeVisible();
}

async function home(page: Page) {
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Document content" })).toHaveCount(0);
}

async function places(page: Page) {
  return page.evaluate(() => {
    const paper = document.querySelector(".paginated-paper") as HTMLElement;
    const content = document.querySelector(".document-content") as HTMLElement;
    const header = paper.querySelector(".page-header") as HTMLElement;
    const footer = paper.querySelector(".page-footer") as HTMLElement;
    const sheet = footer.closest(".page-furniture-page") as HTMLElement;
    const first = content.querySelector("p") as HTMLElement;
    const pageBox = sheet.getBoundingClientRect();
    const zoom = paper.getBoundingClientRect().width / paper.offsetWidth || 1;
    const fromTop = (el: HTMLElement) =>
      (el.getBoundingClientRect().top - pageBox.top) / zoom / 96;
    const fromBottom = (el: HTMLElement) =>
      (pageBox.bottom - el.getBoundingClientRect().bottom) / zoom / 96;
    const style = getComputedStyle(content);
    return {
      headerTop: fromTop(header),
      textTop: fromTop(first),
      footerBottom: fromBottom(footer),
      padTop: parseFloat(style.paddingTop) / 96,
      padBottom: parseFloat(style.paddingBottom) / 96,
    };
  });
}

function near(actual: number, expected: number) {
  expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(0.1);
}

async function showTop(page: Page) {
  await page.locator(".document-stage").evaluate((el) => {
    el.scrollTo({ top: 0, behavior: "smooth" });
  });
  await beat(page, 600);
}

async function showFooter(page: Page) {
  await page.getByLabel("Zoom").selectOption("50%");
  await page.locator(".document-stage").evaluate((stage) => {
    stage.scrollTop = 0;
  });
  await beat(page, 400);
}

async function liftDialog(page: Page) {
  await page.locator(".page-setup-dialog").evaluate((dialog) => {
    dialog.style.maxHeight = "calc(100vh - 180px)";
    const body = dialog.querySelector(".page-setup-fields");
    const edge = dialog.querySelector(".header-edge-fields");
    if (!(body instanceof HTMLElement) || !(edge instanceof HTMLElement)) return;
    const height = edge.getBoundingClientRect().bottom - body.getBoundingClientRect().top;
    body.style.maxHeight = `${Math.ceil(height) + 2}px`;
    body.scrollTop = 0;
  });
  await beat(page, 250);
}

async function downloadBytes(download: Promise<Download>) {
  return readFileSync((await (await download).path())!);
}

test("87-keep-the-letterhead-distance", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Sam opens the council’s Word template.", 1500);
  await openFile(page, "Council letter.docx", await councilLetterheadDocx(), docx);
  await expect(page.locator(".page-header").first()).toHaveText("Town council");
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
    "notes start an inch in",
  );
  await showTop(page);
  const opened = await places(page);
  near(opened.headerTop, 0.5);
  near(opened.textTop, 1);
  near(opened.padTop, 1);
  const headerBox = await page.locator(".page-header").first().boundingBox();
  if (headerBox)
    await page.mouse.move(headerBox.x - 18, headerBox.y + headerBox.height + 20, { steps: 12 });
  await caption(
    page,
    "Town council is already half an inch from the top. The notes stay an inch in.",
    2200,
  );

  await showFooter(page);
  const footer = await places(page);
  near(footer.footerBottom, 0.5);
  near(footer.padBottom, 1);
  const footerBox = await page.locator(".page-footer-text").first().boundingBox();
  const sheetBox = await page.locator(".page-furniture-page").first().boundingBox();
  if (footerBox && sheetBox) {
    expect(
      footerBox.y,
      `footer y ${footerBox.y} sheet bottom ${sheetBox.y + sheetBox.height}`,
    ).toBeLessThan(700);
    expect(sheetBox.y + sheetBox.height).toBeLessThan(760);
    await page.mouse.move(
      footerBox.x + footerBox.width + 28,
      Math.min(footerBox.y + 24, sheetBox.y + sheetBox.height - 20),
      { steps: 14 },
    );
  }
  await caption(
    page,
    "Hearing notes is half an inch from the bottom edge. The lower margin stays an inch.",
    2400,
  );

  await page.getByLabel("Zoom").selectOption("100%");
  await showTop(page);
  await caption(
    page,
    "Page setup shows the distances Word asked for. The top margin is still 1 inch.",
    1000,
  );
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Page setup" });
  await expect(setup).toBeVisible();
  await liftDialog(page);
  await expect(setup.getByLabel("Header from edge")).toHaveValue("0.5");
  await expect(setup.getByLabel("Footer from edge")).toHaveValue("0.5");
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");
  await expect(setup.getByLabel("Bottom margin")).toHaveValue("1");
  await setup.getByLabel("Header from edge").hover();
  await beat(page, 1600);

  await caption(page, "She changes only the header, to 0.75 inches. The footer stays 0.5.", 900);
  const headerField = setup.getByLabel("Header from edge");
  await headerField.click();
  await beat(page, 250);
  await headerField.fill("0.75");
  await expect(setup.getByLabel("Footer from edge")).toHaveValue("0.5");
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");
  await beat(page, 900);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await showTop(page);
  const moved = await places(page);
  near(moved.headerTop, 0.75);
  near(moved.textTop, 1);
  near(moved.padTop, 1);
  near(moved.footerBottom, 0.5);
  const movedHeader = await page.locator(".page-header").first().boundingBox();
  if (movedHeader)
    await page.mouse.move(movedHeader.x + 36, movedHeader.y + movedHeader.height / 2, { steps: 10 });
  await caption(
    page,
    "The letterhead moved down. The notes are still an inch in, and the footer did not move.",
    2200,
  );

  await caption(page, "She sends the letter back to Word.", 900);
  const docxEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 900);
  await page.getByRole("menuitem", { name: "Export DOCX", exact: true }).click();
  const docxBytes = await downloadBytes(docxEvent);
  const xml = await (await JSZip.loadAsync(docxBytes)).file("word/document.xml")!.async("string");
  expect(xml).toContain('w:header="1080"');
  expect(xml).toContain('w:footer="720"');
  expect(xml).toContain('w:top="1440"');
  await beat(page, 600);

  await caption(page, "Opening that Word file again: the header is 0.75 in, and the footer is still 0.5.", 1200);
  await home(page);
  await openFile(page, "Council letter revised.docx", docxBytes, docx);
  await expect(page.locator(".page-header").first()).toHaveText("Town council");
  await showTop(page);
  const returned = await places(page);
  near(returned.headerTop, 0.75);
  near(returned.textTop, 1);
  near(returned.footerBottom, 0.5);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await liftDialog(page);
  await expect(setup.getByLabel("Header from edge")).toHaveValue("0.75");
  await expect(setup.getByLabel("Footer from edge")).toHaveValue("0.5");
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");
  await beat(page, 1600);
  await setup.getByRole("button", { name: "Cancel", exact: true }).click();

  await caption(page, "She keeps a SuiteLeaf copy of the same letter.", 900);
  const nativeEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const nativeBytes = await downloadBytes(nativeEvent);
  const saved = JSON.parse(nativeBytes.toString("utf8"));
  expect(saved.content.attrs.pageSettings).toMatchObject({
    headerFromEdge: 72,
    footerFromEdge: 48,
    marginTop: 96,
  });
  await beat(page, 700);

  await caption(page, "A second letter never set a header distance. It opens at the usual 0.75 inches.", 1200);
  await home(page);
  await openFile(
    page,
    "Workshop.docx",
    await letterheadDocx({
      header: null,
      footer: null,
      margins: null,
      headerTwips: null,
      footerTwips: null,
      body: "This letter set no header distance.",
    }),
    docx,
  );
  await showTop(page);
  const usual = await places(page);
  near(usual.headerTop, 0.75);
  near(usual.textTop, 0.75);
  near(usual.footerBottom, 0.75);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await liftDialog(page);
  await expect(setup.getByLabel("Header from edge")).toHaveValue("0.75");
  await expect(setup.getByLabel("Footer from edge")).toHaveValue("0.75");
  await expect(setup.getByLabel("Top margin")).toHaveValue("0.75");
  await beat(page, 1600);
  await setup.getByRole("button", { name: "Cancel", exact: true }).click();

  await caption(page, "Opening the SuiteLeaf copy, both distances are unchanged.", 1200);
  await home(page);
  await openFile(page, "Council letter revised.sldoc", nativeBytes, "application/json");
  await expect(page.locator(".page-header").first()).toHaveText("Town council");
  await showTop(page);
  const kept = await places(page);
  near(kept.headerTop, 0.75);
  near(kept.textTop, 1);
  near(kept.footerBottom, 0.5);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await liftDialog(page);
  await expect(setup.getByLabel("Header from edge")).toHaveValue("0.75");
  await expect(setup.getByLabel("Footer from edge")).toHaveValue("0.5");
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");
  await expect(setup.getByLabel("Bottom margin")).toHaveValue("1");
  await beat(page, 1800);
  await caption(
    page,
    "Header 0.75 inches, footer 0.5 inches, and the notes still an inch in.",
    2400,
  );
});
