import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { createFile, serializeFile, type DocFile } from "../../packages/core/src";

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
            text: "These pages are the minutes. The packet already has a cover and two letters.",
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
        content: [{ type: "text", text: "The budget passed." }],
      },
    ],
  };
  return file;
}

async function openMinutes(page: Page) {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "October minutes.sldoc",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(minutes())),
  });
  await expect(page.locator(".editor-status")).toContainText("2 pages");
}

function face(page: Page, index: number) {
  return page.locator(".page-furniture-page").nth(index);
}

test("start at and an unnumbered cover survive the page setup dialog", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  await openMinutes(page);
  await expect(page.locator(".page-number")).toHaveText(["Page 1", "Page 2"]);
  await expect(face(page, 0).locator(".page-footer-text")).toHaveText(
    "Committee draft",
  );

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Page setup" });
  const start = setup.getByLabel("Start at");
  const cover = setup.getByRole("checkbox", { name: "Cover has no number" });
  await expect(setup.getByRole("radio", { name: "Page 1" })).toBeChecked();
  await expect(setup.getByRole("radio", { name: "Bottom center" })).toBeChecked();
  await expect(start).toHaveValue("1");
  await expect(cover).not.toBeChecked();
  await start.fill("4");
  await expect(setup.locator("#page-numbers-hint")).toContainText("Page 4");
  await expect(setup.locator("#page-numbers-hint")).toContainText("Page 5");
  await expect(setup.locator(".page-setup-preview-number").nth(0)).toContainText(
    "Page 4",
  );
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".page-number")).toHaveText(["Page 4", "Page 5"]);
  await expect(face(page, 0).locator(".page-footer-text")).toHaveText(
    "Committee draft",
  );
  await expect(face(page, 1).locator(".page-footer-text")).toHaveText(
    "Committee draft",
  );

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await cover.check();
  await expect(start).toBeDisabled();
  await expect(start).toHaveValue("4");
  await expect(setup.locator("#page-numbers-hint")).toContainText("Page 1");
  await expect(setup.locator("#page-numbers-hint")).toContainText("not");
  await expect(setup.locator("#page-numbers-hint")).toContainText("Page 2");
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(face(page, 0).locator(".page-number")).toHaveCount(0);
  await expect(face(page, 1).locator(".page-number")).toHaveText("Page 1");
  await expect(face(page, 0).locator(".page-footer-text")).toHaveText(
    "Committee draft",
  );
  await expect(face(page, 1).locator(".page-footer-text")).toHaveText(
    "Committee draft",
  );

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await setup.getByLabel("Page numbers").uncheck();
  await expect(start).toHaveValue("4");
  await expect(cover).toBeChecked();
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".page-number")).toHaveCount(0);
  await expect(face(page, 0).locator(".page-footer-text")).toHaveText(
    "Committee draft",
  );
  await expect(face(page, 1).locator(".page-footer-text")).toHaveText(
    "Committee draft",
  );

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expect(start).toHaveValue("4");
  await expect(cover).toBeChecked();
  await setup.getByLabel("Page numbers").check();
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(face(page, 0).locator(".page-number")).toHaveCount(0);
  await expect(face(page, 1).locator(".page-number")).toHaveText("Page 1");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const saved = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  expect(saved.content.attrs.pageSettings).toMatchObject({
    pageNumbers: true,
    pageNumberFormat: "page",
    pageNumberPosition: "bottom-center",
    pageNumberStart: 4,
    coverHasNoNumber: true,
    footer: "Committee draft",
  });

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "October minutes" }).click();
  await expect(page.locator(".editor-status")).toContainText("2 pages");
  await expect(face(page, 0).locator(".page-number")).toHaveCount(0);
  await expect(face(page, 1).locator(".page-number")).toHaveText("Page 1");
  await expect(face(page, 1).locator(".page-footer-text")).toHaveText(
    "Committee draft",
  );

  const docxPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Export DOCX", exact: true }).click();
  const docx = await docxPromise;
  const zip = await JSZip.loadAsync(await readFile((await docx.path())!));
  const xml = await zip.file("word/document.xml")!.async("string");
  expect(xml).toContain('w:start="0"');
  expect(xml).toContain("w:titlePg");
  const footers = await Promise.all(
    Object.keys(zip.files)
      .filter((name) => /word\/footer\d+\.xml$/.test(name))
      .map((name) => zip.file(name)!.async("string")),
  );
  expect(footers.some((item) => item.includes("Committee draft") && !/PAGE(?!S)/.test(item))).toBe(
    true,
  );
  expect(footers.some((item) => item.includes("Committee draft") && /PAGE(?!S)/.test(item))).toBe(
    true,
  );
  expect(errors).toEqual([]);
});

test("start at and cover stay reachable on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await openMinutes(page);
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Page setup…" }).click();
  const setup = page.getByRole("dialog", { name: "Page setup" });
  const start = setup.getByLabel("Start at");
  const cover = setup.getByRole("checkbox", { name: "Cover has no number" });
  await start.scrollIntoViewIfNeeded();
  await expect(start).toBeVisible();
  await cover.scrollIntoViewIfNeeded();
  await expect(cover).toBeVisible();
  const apply = setup.getByRole("button", { name: "Apply", exact: true });
  await expect(apply).toBeVisible();
  const box = await start.boundingBox();
  expect(box).toBeTruthy();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
});
