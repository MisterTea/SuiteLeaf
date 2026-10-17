import { expect, test, type Locator, type Page } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 800 } });

const title = "Garden plan";

async function newDocument(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  const name = page.getByLabel("File title");
  await name.click();
  await name.press("ControlOrMeta+A");
  await name.fill(title);
  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.click({ position: { x: 100, y: 80 } });
  return editor;
}

async function openDrawing(page: Page) {
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await page.getByRole("menuitem", { name: "Drawing", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Drawing" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".excalidraw")).toBeVisible();
  return dialog;
}

/** Dark stroke pixels on the Excalidraw canvases. An empty canvas is only the pale grid. */
async function darkPixels(dialog: Locator) {
  return dialog.locator(".excalidraw").evaluate((root) => {
    let dark = 0;
    for (const canvas of root.querySelectorAll("canvas")) {
      const context = canvas.getContext("2d");
      if (!context || canvas.width < 2 || canvas.height < 2) continue;
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 0; i < data.length; i += 8) {
        const alpha = data[i + 3];
        if (alpha > 180 && data[i] < 90 && data[i + 1] < 90 && data[i + 2] < 90) dark += 1;
      }
    }
    return dark;
  });
}

async function drawRectangle(page: Page, dialog: Locator) {
  const insert = dialog.getByRole("button", { name: "Insert drawing" });
  await expect(insert).toBeDisabled();
  const surface = dialog.locator(".excalidraw");
  await surface.focus();
  await page.keyboard.press("r");
  const rectangle = dialog.getByRole("radio", { name: "Rectangle", exact: true });
  await expect(rectangle).toBeChecked();
  const canvas = dialog.locator("canvas.interactive");
  const box = (await canvas.boundingBox())!;
  const start = { x: box.x + box.width * 0.32, y: box.y + box.height * 0.34 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 200, start.y + 130, { steps: 16 });
  await page.mouse.up();
  await expect(insert).toBeEnabled();
  return insert;
}

test("insert a drawing, keep it after reopen, and open the saved scene", async ({ page }) => {
  test.setTimeout(90_000);
  const editor = await newDocument(page);
  const dialog = await openDrawing(page);
  const insert = await drawRectangle(page, dialog);
  await insert.click();
  await expect(dialog).toBeHidden();
  const drawing = editor.getByRole("img", { name: "Drawing" });
  await expect(drawing).toBeVisible();

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: title }).click();
  const reopened = page.getByRole("textbox", { name: "Document content" });
  const kept = reopened.getByRole("img", { name: "Drawing" });
  await expect(kept).toBeVisible();

  await kept.click();
  const again = await openDrawing(page);
  await expect
    .poll(async () => {
      if (await again.getByRole("button", { name: "Insert drawing" }).isEnabled()) return true;
      return (await darkPixels(again)) > 20;
    })
    .toBe(true);
  await again.getByRole("button", { name: "Cancel" }).click();
  await expect(again).toBeHidden();
  await expect(reopened.getByRole("img", { name: "Drawing" })).toBeVisible();
});
