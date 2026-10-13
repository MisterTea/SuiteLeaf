import { expect, test, type Page } from "@playwright/test";
import { createFile, serializeFile, type DocFile } from "../../packages/core/src";

const inch = (n: number) => n * 96;

function preface(pages: string[]): DocFile {
  const file = createFile("doc", "Preface") as DocFile;
  const blocks: DocFile["content"]["content"] = [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Preface" }],
    },
  ];
  pages.forEach((text, index) => {
    if (index > 0) blocks.push({ type: "pageBreak" });
    blocks.push({
      type: "paragraph",
      content: [{ type: "text", text }],
    });
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
        pageNumberFormat: "roman",
        pageNumberPosition: "top-right",
        pageNumberPositionSet: true,
        pageNumberStart: 4,
      },
    },
    content: blocks,
  };
  return file;
}

async function openPreface(page: Page, pages: string[]) {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Preface.sldoc",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(preface(pages))),
  });
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
    pages[0]!,
  );
  await expect(page.locator(".editor-status")).toContainText(
    `${pages.length} page${pages.length === 1 ? "" : "s"}`,
  );
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

async function closeSetup(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Page setup" });
  await dialog.getByRole("button", { name: "Close page setup" }).click();
  await expect(dialog).toBeHidden();
}

function sheets(page: Page) {
  return page.locator(".page-setup-preview-page");
}

test("the page preview shows the roman ends and keeps them after reopen", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openPreface(page, [
    "The front matter starts here.",
    "Notes on the second page.",
    "Notes on the third page.",
    "Notes on the fourth page.",
    "The index ends the preface.",
  ]);

  let dialog = await openSetup(page);
  const preview = dialog.getByRole("group", { name: "Page preview" });
  await expect(dialog.getByRole("radio", { name: "iv … viii", exact: true })).toBeChecked();
  await expect(dialog.getByRole("radio", { name: "4 / 8", exact: true })).toBeVisible();
  await expect(sheets(page)).toHaveCount(2);
  await expect(sheets(page).nth(0).locator(".page-setup-preview-number")).toHaveText(
    "iv at the top right",
  );
  await expect(sheets(page).nth(1).locator(".page-setup-preview-number")).toHaveText(
    "viii at the top right",
  );
  await expect(preview.locator(".page-setup-preview-skip-label")).toHaveText(
    "Pages v\u2013vii skipped",
  );
  await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".save-status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Preface" }).click();
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
    "The front matter starts here.",
  );
  dialog = await openSetup(page);
  await expect(dialog.getByRole("radio", { name: "iv … viii", exact: true })).toBeChecked();
  await expect(dialog.getByRole("radio", { name: "4 / 8", exact: true })).toBeVisible();
  await expect(sheets(page)).toHaveCount(2);
  await expect(sheets(page).nth(0).locator(".page-setup-preview-number")).toHaveText(
    "iv at the top right",
  );
  await expect(sheets(page).nth(1).locator(".page-setup-preview-number")).toHaveText(
    "viii at the top right",
  );
  await expect(dialog.locator(".page-setup-preview-skip-label")).toHaveText(
    "Pages v\u2013vii skipped",
  );
  await closeSetup(page);
});

test("a two-page file previews two sheets and a three-page file previews the chip", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openPreface(page, [
    "The front matter starts here.",
    "Notes on the second page.",
  ]);
  let dialog = await openSetup(page);
  await expect(dialog.getByRole("radio", { name: "iv, v", exact: true })).toBeChecked();
  await expect(dialog.getByRole("radio", { name: "4 / 5", exact: true })).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "iv, v, vi", exact: true })).toHaveCount(0);
  await expect(sheets(page)).toHaveCount(2);
  await expect(dialog.locator(".page-setup-preview-skip")).toHaveCount(0);
  await expect(sheets(page).nth(0).locator(".page-setup-preview-number")).toHaveText(
    "iv at the top right",
  );
  await expect(sheets(page).nth(1).locator(".page-setup-preview-number")).toHaveText(
    "v at the top right",
  );
  await closeSetup(page);

  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.click();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End",
  );
  const button = page.getByRole("button", { name: "Page break", exact: true });
  if (!(await button.isVisible())) {
    await page.getByRole("button", { name: "More tools", exact: true }).click();
    await expect(button).toBeVisible();
  }
  await button.click();
  await page.keyboard.type("A third page.");
  await expect(page.locator(".editor-status")).toContainText("3 pages");
  dialog = await openSetup(page);
  await expect(dialog.getByRole("radio", { name: "iv, v, vi", exact: true })).toBeChecked();
  await expect(dialog.getByRole("radio", { name: "4 / 6", exact: true })).toBeVisible();
  await expect(sheets(page)).toHaveCount(3);
  await expect(dialog.locator(".page-setup-preview-skip")).toHaveCount(0);
  await expect(sheets(page).nth(0).locator(".page-setup-preview-number")).toHaveText(
    "iv at the top right",
  );
  await expect(sheets(page).nth(1).locator(".page-setup-preview-number")).toHaveText(
    "v at the top right",
  );
  await expect(sheets(page).nth(2).locator(".page-setup-preview-number")).toHaveText(
    "vi at the top right",
  );
});
