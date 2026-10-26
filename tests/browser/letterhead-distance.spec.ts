import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import JSZip from "jszip";
import {
  councilLetterheadDocx,
  letterheadDocx,
} from "../letterhead-fixtures";

const docxType =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function openBytes(page: Page, name: string, bytes: Uint8Array, mime: string) {
  await expect(page.getByLabel("Search files")).toBeVisible();
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({
    name,
    mimeType: mime,
    buffer: Buffer.from(bytes),
  });
  const keep = page.getByRole("button", { name: "Keep both", exact: true });
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor.or(keep)).toBeVisible();
  if (await keep.isVisible()) await keep.click();
  await expect(editor).toBeVisible();
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

test("a Word letterhead keeps its distance from the edge", async ({ page }) => {
  test.setTimeout(90000);
  await page.goto("/");
  await openBytes(page, "Council letter.docx", await councilLetterheadDocx(), docxType);
  await expect(page.locator(".page-header").first()).toHaveText("Town council");
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
    "notes start an inch in",
  );
  await expect(page.locator(".import-notes summary")).toContainText(
    "Letterhead: header 0.5 in, footer 0.5 in from the edge",
  );
  const opened = await places(page);
  near(opened.headerTop, 0.5);
  near(opened.textTop, 1);
  near(opened.padTop, 1);
  near(opened.footerBottom, 0.5);
  near(opened.padBottom, 1);

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Page setup" });
  await expect(setup.getByLabel("Header from edge")).toHaveValue("0.5");
  await expect(setup.getByLabel("Footer from edge")).toHaveValue("0.5");
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");
  await expect(setup.getByLabel("Bottom margin")).toHaveValue("1");
  await setup.getByLabel("Header from edge").fill("0.75");
  await expect(setup.getByLabel("Footer from edge")).toHaveValue("0.5");
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  const moved = await places(page);
  near(moved.headerTop, 0.75);
  near(moved.textTop, 1);
  near(moved.padTop, 1);
  near(moved.footerBottom, 0.5);

  const docxEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Export DOCX", exact: true }).click();
  const xml = await (
    await JSZip.loadAsync(await readFile((await (await docxEvent).path())!))
  )
    .file("word/document.xml")!
    .async("string");
  expect(xml).toContain('w:header="1080"');
  expect(xml).toContain('w:footer="720"');
  expect(xml).toContain('w:top="1440"');

  const nativeEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const saved = JSON.parse(await readFile((await (await nativeEvent).path())!, "utf8"));
  expect(saved.content.attrs.pageSettings).toMatchObject({
    headerFromEdge: 72,
    footerFromEdge: 48,
    marginTop: 96,
    header: "Town council",
    footer: "Hearing notes",
  });

  await page.getByRole("button", { name: "Back to files" }).click();
  await openBytes(
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
    docxType,
  );
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
    "no header distance",
  );
  const usual = await places(page);
  near(usual.textTop, 0.75);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expect(setup.getByLabel("Header from edge")).toHaveValue("0.75");
  await expect(setup.getByLabel("Footer from edge")).toHaveValue("0.75");
  await expect(setup.getByLabel("Top margin")).toHaveValue("0.75");
  await setup.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.getByRole("button", { name: "Back to files" }).click();
  await openBytes(
    page,
    "Council letter.sldoc",
    Buffer.from(JSON.stringify(saved)),
    "application/json",
  );
  await expect(page.locator(".page-header").first()).toHaveText("Town council");
  const kept = await places(page);
  near(kept.headerTop, 0.75);
  near(kept.textTop, 1);
  near(kept.footerBottom, 0.5);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expect(setup.getByLabel("Header from edge")).toHaveValue("0.75");
  await expect(setup.getByLabel("Footer from edge")).toHaveValue("0.5");
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");
});
