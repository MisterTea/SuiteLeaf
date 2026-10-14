import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { createFile, serializeFile, type DocFile } from "../../packages/core/src";

function report(restart = false): DocFile {
  const file = createFile("doc", restart ? "Field report restart" : "Field report") as DocFile;
  const paragraph = (text: string) => ({
    type: "paragraph",
    content: [{ type: "text", text }],
  });
  const heading = (text: string, startArabic = false) => ({
    type: "heading",
    attrs: startArabic ? { level: 1, startArabic: true } : { level: 1 },
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
        pageNumberFormat: restart ? "roman" : "page",
        pageNumberPosition: "bottom-center",
        pageNumberPositionSet: true,
      },
    },
    content: [
      heading("Contents"),
      paragraph("Maps and tables for the field season."),
      { type: "pageBreak" },
      heading("Figures"),
      paragraph("The site plan and the chart."),
      { type: "pageBreak" },
      heading("Chapter 1", restart),
      paragraph("The survey began in March along the north ridge."),
      { type: "pageBreak" },
      paragraph("The first chapter continues with the soil samples."),
    ],
  };
  return file;
}

async function openReport(page: Page, restart = false) {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Field report.sldoc",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(report(restart))),
  });
  await expect(page.locator(".editor-status")).toContainText("4 pages");
}

function face(page: Page, index: number) {
  return page.locator(".page-furniture-page").nth(index);
}

test("lowercase roman and an arabic restart survive save and Word export", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  await openReport(page);
  await expect(page.locator(".page-number")).toHaveText([
    "Page 1",
    "Page 2",
    "Page 3",
    "Page 4",
  ]);
  await expect(face(page, 0).locator(".page-footer-text")).toHaveText("Draft");

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Page setup" });
  await expect(setup.getByRole("radio", { name: "Page 1" })).toBeChecked();
  await expect(setup.getByRole("radio", { name: "i … iv", exact: true })).toBeVisible();
  await expect(setup.getByLabel("Start at")).toHaveValue("1");
  await expect(setup.getByRole("checkbox", { name: "Cover has no number" })).toBeVisible();
  await setup.getByRole("radio", { name: "i … iv", exact: true }).check();
  await expect(setup.locator("#page-numbers-hint")).toContainText("i");
  await expect(setup.locator(".page-setup-preview-number").first()).toContainText("i");
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".page-number")).toHaveText(["i", "ii", "iii", "iv"]);
  await expect(face(page, 0).locator(".page-footer-text")).toHaveText("Draft");
  await expect(face(page, 1).locator(".page-footer-text")).toHaveText("Draft");

  await expect(page.getByRole("button", { name: "Start Arabic numbers here" })).toHaveCount(0);
  await expect(page.locator(".arabic-start")).toHaveCount(0);

  await openReport(page, true);
  await expect(page.locator(".page-number")).toHaveText(["i", "ii", "1", "2"]);
  await expect(face(page, 2).locator(".page-footer-text")).toHaveText("Draft");
  await expect(face(page, 3).locator(".page-footer-text")).toHaveText("Draft");
  await expect(page.locator("h1[data-start-arabic='true']")).toHaveText("Chapter 1");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const saved = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  expect(saved.content.attrs.pageSettings).toMatchObject({
    pageNumberFormat: "roman",
    pageNumberPosition: "bottom-center",
    footer: "Draft",
    pageNumbers: true,
    pageNumberStart: 1,
    coverHasNoNumber: false,
  });
  const chapter = saved.content.content.find(
    (node: { type: string; attrs?: { startArabic?: boolean } }) =>
      node.type === "heading" && node.attrs?.startArabic === true,
  );
  expect(chapter.content[0].text).toBe("Chapter 1");

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Field report restart" }).click();
  await expect(page.locator(".editor-status")).toContainText("4 pages");
  await expect(page.locator(".page-number")).toHaveText(["i", "ii", "1", "2"]);
  await expect(face(page, 0).locator(".page-footer-text")).toHaveText("Draft");
  await expect(page.locator("h1[data-start-arabic='true']")).toHaveText("Chapter 1");

  const docxPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Export DOCX", exact: true }).click();
  const zip = await JSZip.loadAsync(await readFile((await (await docxPromise).path())!));
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
  expect(footers.some((item) => item.includes("Draft") && /PAGE(?!S)/.test(item))).toBe(
    true,
  );
  expect(footers.every((item) => !item.includes("Page "))).toBe(true);
  expect(errors).toEqual([]);
});
