import { deflateSync, crc32 } from "node:zlib";
import { beat, caption, expect, selectCells, test, typeSlowly } from "./harness";

/** A small green mark Tomás can drop on the invoice as the bakery logo. */
function logoPng() {
  const size = 64;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    for (let x = 0; x < size; x++) {
      const dx = x - 31.5,
        dy = y - 31.5;
      const i = row + 1 + x * 4;
      const inside = dx * dx + dy * dy < 26 * 26;
      raw[i] = inside ? 30 : 0;
      raw[i + 1] = inside ? 107 : 0;
      raw[i + 2] = inside ? 69 : 0;
      raw[i + 3] = inside ? 255 : 0;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function sheetReady(page: import("@playwright/test").Page) {
  await page.getByRole("toolbar", { name: "Spreadsheet formatting" }).waitFor();
  await beat(page, 400);
}

async function typeRow(page: import("@playwright/test").Page, ref: string, values: string[]) {
  await selectCells(page, ref);
  for (const [i, value] of values.entries()) {
    await typeSlowly(page, value, 28);
    await page.keyboard.press(i < values.length - 1 ? "Tab" : "Enter");
    await beat(page, 180);
  }
}

test("33-start-from-a-template", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.ready).active);

  await caption(
    page,
    "Tomás needs an invoice, notes for his landlord, and a pitch deck. Templates are already on the home screen — nothing to turn on.",
    1800,
  );
  for (const name of ["Invoice", "Budget", "Meeting notes", "Letter", "Pitch deck", "Announcement"])
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();

  await caption(page, "The whole gallery is one click away. He looks for an invoice.", 1200);
  await page.getByRole("button", { name: "Template gallery" }).click();
  await page.getByLabel("Search templates").click();
  await typeSlowly(page, "inv", 80);
  await expect(page.getByRole("button", { name: "Invoice", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Budget", exact: true })).toHaveCount(0);
  await beat(page, 700);

  await caption(
    page,
    "He previews the invoice first. The total is already a formula: $0.00. No file yet.",
    1400,
  );
  await page.getByRole("button", { name: "Invoice", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Preview Invoice" });
  await expect(preview.getByRole("cell", { name: "Total", exact: true })).toBeVisible();
  await expect(preview.getByText("$0.00")).toBeVisible();
  await beat(page, 1400);
  await caption(page, "Escape closes the preview. The library is still empty.", 1000);
  await page.keyboard.press("Escape");
  await expect(preview).toBeHidden();
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByText("A workspace waiting for you")).toBeVisible();

  await caption(
    page,
    "Two clicks from home: the template, then Use template. The new file's title is selected.",
    1400,
  );
  await page.getByRole("button", { name: "Invoice", exact: true }).click();
  await page.getByRole("button", { name: "Use template" }).click();
  const title = page.getByLabel("File title");
  await expect(title).toHaveValue("Invoice");
  await expect(title).toBeFocused();
  await beat(page, 400);
  await expect(title).toBeFocused();
  await title.press("ControlOrMeta+A");
  await typeSlowly(page, "Invoice · Café Lune · October");
  await sheetReady(page);

  await caption(page, "Two lines for the café. Quantity times price, and the total follows.", 1200);
  await typeRow(page, "A6", ["Sourdough", "24", "6.50"]);
  await typeRow(page, "A7", ["Rye loaf", "12", "7"]);
  await selectCells(page, "D9");
  await beat(page, 1200);

  await caption(page, "He adds the bakery's name and logo, then keeps this layout as his own template.", 1200);
  await selectCells(page, "B2");
  await typeSlowly(page, "Hearth & Rye");
  await page.keyboard.press("Enter");
  await beat(page, 400);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await page.getByRole("menuitem", { name: "Image", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "hearth-rye.png",
    mimeType: "image/png",
    buffer: logoPng(),
  });
  await beat(page, 1200);

  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save as template" }).click();
  const naming = page.getByRole("dialog", { name: "Save as template" });
  await expect(naming).toBeVisible();
  await beat(page, 600);
  const name = naming.getByLabel("Template name");
  await name.click();
  await name.press("ControlOrMeta+A");
  await typeSlowly(page, "Bakery invoice", 40);
  await naming.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Saved as template");
  await beat(page, 900);

  await caption(page, "Bakery invoice sits on the home screen. October's file is separate.", 1400);
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByRole("button", { name: "Bakery invoice", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Invoice · Café Lune · October" })).toBeVisible();

  await caption(
    page,
    "Next month he starts again from the template. A new file, with the logo and the layout.",
    1400,
  );
  await page.getByRole("button", { name: "Bakery invoice", exact: true }).click();
  await expect(page.getByRole("dialog").getByText("Hearth & Rye")).toBeVisible();
  await page.getByRole("button", { name: "Use template" }).click();
  await expect(title).toBeFocused();
  await beat(page, 400);
  await expect(title).toBeFocused();
  await page.getByLabel("File title").press("ControlOrMeta+A");
  await typeSlowly(page, "Invoice · Café Lune · November");
  await sheetReady(page);
  await caption(page, "He changes November's order. October, and the template, are left alone.", 1200);
  await selectCells(page, "B6");
  await typeSlowly(page, "40");
  await page.keyboard.press("Enter");
  await beat(page, 900);
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Invoice · Café Lune · October" }).click();
  await sheetReady(page);
  await selectCells(page, "B6");
  await beat(page, 800);
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("button", { name: "Bakery invoice", exact: true }).click();
  await expect(page.getByRole("dialog").getByText("24", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("$240.00")).toBeVisible();
  await beat(page, 1000);
  await page.getByRole("button", { name: "Cancel" }).click();

  await caption(page, "Writing the landlord notes, he wants a fresh agenda. File › New › From template.", 1400);
  await page.getByRole("button", { name: "Meeting notes", exact: true }).click();
  await page.getByRole("button", { name: "Use template" }).click();
  await expect(page.getByLabel("File title")).toBeFocused();
  await beat(page, 800);
  await page.getByLabel("File title").press("ControlOrMeta+A");
  await typeSlowly(page, "Landlord meeting");
  await page.getByRole("textbox", { name: "Document content" }).waitFor();
  await page.getByText("Who does what, and by when").click();
  await page.keyboard.press("Enter");
  await typeSlowly(page, "Rent is due Friday.");
  await beat(page, 500);
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "New", exact: true }).hover();
  await page.getByRole("menuitem", { name: "From template" }).click();
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Spreadsheets" })).toHaveCount(0);
  await expect(page.getByText("Showing documents")).toBeVisible();
  await beat(page, 900);
  await page.getByRole("button", { name: "Meeting notes", exact: true }).click();
  await page.getByRole("button", { name: "Use template" }).click();
  await expect(page.getByLabel("File title")).toHaveValue("Meeting notes");
  await beat(page, 700);

  await caption(page, "At the market, with no signal, the pitch deck template is still on this computer.", 1600);
  await page.context().setOffline(true);
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("button", { name: "Template gallery" }).click();
  await page.getByRole("button", { name: "Pitch deck", exact: true }).click();
  await page.getByRole("button", { name: "Use template" }).click();
  await expect(page.getByLabel("File title")).toHaveValue("Pitch deck");
  await expect(page.getByRole("complementary", { name: "Slide thumbnails" })).toBeVisible();
  await beat(page, 1200);

  await page.context().setOffline(false);
  await caption(page, "Back home, the ⋯ menu renames or removes a template. The invoices stay.", 1400);
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("button", { name: "Template gallery" }).click();
  await page.getByRole("button", { name: "Actions for Bakery invoice" }).click();
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Remove" })).toBeVisible();
  await beat(page, 700);
  await page.getByRole("menuitem", { name: "Remove" }).click();
  await beat(page, 500);
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByRole("button", { name: "Bakery invoice", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByRole("link", { name: "Invoice · Café Lune · October" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Invoice · Café Lune · November" })).toBeVisible();
  await page.getByRole("link", { name: "Invoice · Café Lune · October" }).evaluate((el) => {
    const top = el.getBoundingClientRect().top + window.scrollY - 340;
    window.scrollTo(0, Math.max(0, top));
  });
  await beat(page, 1400);
});
