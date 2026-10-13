import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { createFile, serializeFile, type DocFile } from "../../packages/core/src";

const inch = (n: number) => n * 96;

function preface(): DocFile {
  const file = createFile("doc", "Preface") as DocFile;
  const paragraph = (text: string) => ({
    type: "paragraph",
    content: [{ type: "text", text }],
  });
  file.content = {
    type: "doc",
    attrs: {
      pageSettings: {
        size: "letter",
        landscape: false,
        margin: inch(1),
        marginTop: inch(1),
        marginBottom: inch(1),
        marginLeft: inch(1),
        marginRight: inch(1),
        header: "",
        footer: "",
        headerFromEdge: inch(0.5),
        footerFromEdge: inch(0.5),
        pageNumbers: true,
        pageNumberFormat: "page",
        pageNumberPosition: "top-right",
        pageNumberPositionSet: true,
        pageNumberStart: 1,
        differentOddEven: true,
        coverHasNoNumber: false,
      },
    },
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Preface" }],
      },
      paragraph("The front matter starts here."),
      { type: "pageBreak" },
      paragraph("Notes on the second page."),
      { type: "pageBreak" },
      paragraph("Notes on the third page."),
    ],
  };
  return file;
}

async function openPreface(page: Page) {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Preface.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(preface())),
  });
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
    "Notes on the third page.",
  );
  await expect(page.locator(".editor-status")).toContainText("3 pages");
}

async function openSetup(page: Page) {
  const button = page.getByRole("button", { name: "Page setup", exact: true });
  if (!(await button.isVisible())) {
    await page.getByRole("button", { name: "More tools", exact: true }).click();
    await expect(button).toBeVisible();
  }
  await button.click();
  const dialog = page.getByRole("dialog", { name: "Page setup" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function savedCover(page: Page) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const file = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  return file.content.attrs.pageSettings.coverHasNoNumber === true;
}

test("a cover drops its number before apply and stays blank after reopen", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openPreface(page);
  const faces = page.locator(".page-furniture-page");
  await expect(faces.nth(0).locator(".page-number")).toHaveText("Page 1");
  await expect(faces.nth(1)).toHaveAttribute("data-number-side", "top-left");
  await expect(faces.nth(1).locator(".page-number")).toHaveText("Page 2");
  await expect(faces.nth(2)).toHaveAttribute("data-number-side", "top-right");

  const dialog = await openSetup(page);
  const cover = dialog.getByRole("checkbox", { name: "Cover has no number" });
  const preview = dialog.getByRole("group", { name: "Page preview" });
  await expect(cover).not.toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "Different odd and even pages" })).toBeChecked();
  await expect(preview.locator(".page-setup-preview-number")).toHaveText(["Page 2", "Page 3"]);
  await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toBeEnabled();

  await cover.check();
  await expect(dialog).toBeVisible();
  await expect(faces.nth(0).locator(".page-number")).toHaveCount(0);
  await expect(faces.nth(1).locator(".page-number")).toHaveText("Page 1");
  await expect(faces.nth(1)).toHaveAttribute("data-number-side", "top-right");
  await expect(faces.nth(2).locator(".page-number")).toHaveText("Page 2");
  await expect(faces.nth(2)).toHaveAttribute("data-number-side", "top-left");
  await expect(preview.locator("[data-preview-role='cover']")).toContainText("Cover");
  await expect(preview.locator("[data-preview-role='cover'] .page-setup-preview-number")).toHaveText(
    "No number",
  );
  await expect(preview.locator("[data-preview-role='next'] .page-setup-preview-number")).toHaveText(
    "Page 1",
  );
  await expect(
    preview.locator("[data-preview-role='next'] .page-setup-preview-sheet"),
  ).toHaveAttribute("data-number-corner", "top-right");
  expect(await savedCover(page)).toBe(false);

  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(faces.nth(0).locator(".page-number")).toHaveText("Page 1");
  await expect(faces.nth(1).locator(".page-number")).toHaveText("Page 2");
  await expect(faces.nth(1)).toHaveAttribute("data-number-side", "top-left");
  await expect(faces.nth(2)).toHaveAttribute("data-number-side", "top-right");

  const again = await openSetup(page);
  await again.getByRole("checkbox", { name: "Cover has no number" }).check();
  await expect(faces.nth(0).locator(".page-number")).toHaveCount(0);
  await again.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(again).toBeHidden();
  await expect(page.locator(".save-status")).toContainText("Saved");
  await expect(faces.nth(0).locator(".page-number")).toHaveCount(0);
  await expect(faces.nth(1).locator(".page-number")).toHaveText("Page 1");
  await expect(faces.nth(2).locator(".page-number")).toHaveText("Page 2");
  await expect(faces.nth(2)).toHaveAttribute("data-number-side", "top-left");

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Preface" }).click();
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
    "The front matter starts here.",
  );
  await expect(faces.nth(0).locator(".page-number")).toHaveCount(0);
  await expect(faces.nth(1).locator(".page-number")).toHaveText("Page 1");
  await expect(faces.nth(1)).toHaveAttribute("data-number-side", "top-right");
  await expect(faces.nth(2).locator(".page-number")).toHaveText("Page 2");
  await expect(faces.nth(2)).toHaveAttribute("data-number-side", "top-left");
  const reopened = await openSetup(page);
  await expect(reopened.getByRole("checkbox", { name: "Cover has no number" })).toBeChecked();
  await expect(reopened.getByRole("checkbox", { name: "Different odd and even pages" })).toBeChecked();
  await expect(
    reopened.locator("[data-preview-role='cover'] .page-setup-preview-number"),
  ).toHaveText("No number");
  await expect(
    reopened.locator("[data-preview-role='next'] .page-setup-preview-number"),
  ).toHaveText("Page 1");
});
