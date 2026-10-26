import { expect, test, type Page } from "@playwright/test";
import { createFile, serializeFile, type DocFile } from "../../packages/core/src";

const inch = (n: number) => n * 96;

function preface(): DocFile {
  const file = createFile("doc", "Preface") as DocFile;
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
        pageNumberStart: 4,
      },
    },
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Introduction" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "The front matter fits on this page." }],
      },
      { type: "pageBreak" },
      {
        type: "paragraph",
        content: [{ type: "text", text: "The notes end here." }],
      },
    ],
  };
  return file;
}

async function openPreface(page: Page) {
  await page.goto("/");
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({
    name: "Preface.sldoc",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(preface())),
  });
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
    "The notes end here.",
  );
  await expect(page.locator(".editor-status")).toContainText("2 pages");
}

async function numbers(page: Page) {
  return page.locator(".paginated-paper .page-number").allTextContents();
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

async function addPage(page: Page, text: string) {
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
  await page.keyboard.type(text);
}

test("the roman chip lists only the pages that exist", async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openPreface(page);
  await expect.poll(() => numbers(page)).toEqual(["Page 4", "Page 5"]);

  let dialog = await openSetup(page);
  await expect(dialog.getByRole("spinbutton", { name: "Start at" })).toHaveValue("4");
  const roman = dialog.getByRole("radio", { name: "iv, v", exact: true });
  await expect(roman).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "iv, v, vi", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("radio", { name: "4 / 5", exact: true })).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "Page 4", exact: true })).toBeChecked();

  await roman.check();
  await expect(roman).toBeChecked();
  await expect(dialog).toBeVisible();
  await expect.poll(() => numbers(page)).toEqual(["iv", "v"]);

  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => numbers(page)).toEqual(["iv", "v"]);
  await expect(page.locator(".save-status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Preface" }).click();
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
    "The front matter fits on this page.",
  );
  await expect.poll(() => numbers(page)).toEqual(["iv", "v"]);
  dialog = await openSetup(page);
  await expect(dialog.getByRole("radio", { name: "iv, v", exact: true })).toBeChecked();
  await expect(dialog.getByRole("radio", { name: "4 / 5", exact: true })).toBeVisible();
  await closeSetup(page);

  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.locator(":scope > p").last().click({ clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await expect(page.locator(".editor-status")).toContainText("1 page");
  await expect.poll(() => numbers(page)).toEqual(["iv"]);
  dialog = await openSetup(page);
  await expect(dialog.getByRole("radio", { name: "iv", exact: true })).toBeChecked();
  await expect(dialog.getByRole("radio", { name: "iv, v", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("radio", { name: "4 / 4", exact: true })).toBeVisible();
  await expect(dialog.locator("#page-numbers-hint")).toContainText("only page");
  await expect(dialog.locator("#page-numbers-hint")).not.toContainText("next page");
  await closeSetup(page);

  await addPage(page, "A third page.");
  await addPage(page, "More notes.");
  await expect(page.locator(".editor-status")).toContainText("3 pages");
  await expect.poll(() => numbers(page)).toEqual(["iv", "v", "vi"]);
  dialog = await openSetup(page);
  await expect(dialog.getByRole("radio", { name: "iv, v, vi", exact: true })).toBeChecked();
  await expect(dialog.getByRole("radio", { name: "4 / 6", exact: true })).toBeVisible();
  await expect(dialog).toBeVisible();
  await closeSetup(page);

  await addPage(page, "The sources.");
  await addPage(page, "The index.");
  await expect(page.locator(".editor-status")).toContainText("5 pages");
  await expect.poll(() => numbers(page)).toEqual(["iv", "v", "vi", "vii", "viii"]);
  dialog = await openSetup(page);
  await expect(dialog.getByRole("radio", { name: "iv … viii", exact: true })).toBeChecked();
  await expect(dialog.getByRole("radio", { name: "4 / 8", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toBeVisible();
  await expect.poll(() => numbers(page)).toEqual(["iv", "v", "vi", "vii", "viii"]);
});
