import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { crc32, deflateSync } from "node:zlib";

test.use({ viewport: { width: 1280, height: 800 } });

/** A plain 200 × 100 PNG. */
function picture(width = 200, height = 100) {
  const raw = Buffer.alloc((width * 3 + 1) * height, 0x80);
  for (let y = 0; y < height; y++) raw[y * (width * 3 + 1)] = 0;
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function newDocument(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.click();
  return editor;
}

/**
 * Waits out the pagination pass that follows each edit; it restores the
 * editor's selection, which would undo a selection made in the same frame.
 */
const paginated = (page: Page) =>
  page.evaluate(
    () =>
      new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

async function savedContent(page: Page) {
  await expect(page.getByRole("status")).toContainText("Saved");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const file = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  return JSON.stringify(file.content);
}

test("tables get a header row and row/column commands from the right-click and Format menus", async ({
  page,
}) => {
  const editor = await newDocument(page);
  await page.keyboard.type("Sign-up");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Insert table", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Insert table" });
  await expect(dialog.getByRole("checkbox", { name: "Header row" })).toBeChecked();
  await dialog.getByRole("button", { name: "Create table" }).click();
  const table = editor.locator("table");
  const rows = table.locator("tr");
  await expect(rows).toHaveCount(3);
  await expect(rows.first().locator("th")).toHaveCount(3);
  await expect(rows.nth(1).locator("th")).toHaveCount(0);

  await rows.nth(1).locator("td").first().click();
  await page.keyboard.type("Asha");
  await table.getByText("Asha").click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Table options" });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Insert row above" }).click();
  await expect(menu).toBeHidden();
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(1)).toHaveText("");
  await expect(rows.nth(2).locator("td").first()).toHaveText("Asha");

  await table.getByText("Asha").click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Insert column right" }).click();
  await expect(rows.first().locator("th")).toHaveCount(4);
  await expect(rows.nth(2).locator("td").nth(1)).toHaveText("");

  await table.getByText("Asha").click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Insert column left" }).click();
  await expect(rows.nth(2).locator("td").nth(1)).toHaveText("Asha");
  await table.getByText("Asha").click({ button: "right" });
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  await page.getByRole("button", { name: "Format", exact: true }).click();
  await page.getByRole("menuitem", { name: "Table", exact: true }).click();
  await page.getByRole("menuitem", { name: "Insert row below" }).click();
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(3)).toHaveText("");

  await table.getByText("Asha").click({ button: "right" });
  const header = menu.getByRole("menuitemcheckbox", { name: "Header row" });
  await expect(header).toHaveAttribute("aria-checked", "true");
  await header.click();
  await expect(table.locator("th")).toHaveCount(0);
  await table.getByText("Asha").click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Delete row" }).click();
  await expect(table.getByText("Asha")).toHaveCount(0);
  await expect(rows).toHaveCount(4);

  await editor.getByText("Sign-up").click();
  await page.getByRole("button", { name: "Format", exact: true }).click();
  await page.getByRole("menuitem", { name: "Table", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Insert row above" })).toBeDisabled();
});

test("links use an in-app dialog that validates the address and can edit or remove the link", async ({
  page,
}) => {
  const browserDialogs: string[] = [];
  page.on("dialog", (d) => {
    browserDialogs.push(d.message());
    void d.dismiss();
  });
  const editor = await newDocument(page);
  await page.keyboard.type("Rules are on the club website");
  await paginated(page);
  for (let i = 0; i < "club website".length; i++) await page.keyboard.press("Shift+ArrowLeft");
  await paginated(page);
  await page.getByRole("button", { name: "Insert link", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Insert link" });
  await expect(dialog.getByLabel("Link text")).toHaveValue("club website");
  const address = dialog.getByLabel("Link address");
  await expect(address).toBeFocused();

  await address.fill("javascript:alert(1)");
  await address.press("Enter");
  await expect(dialog.getByRole("alert")).toContainText("web address");
  await expect(editor.locator("a")).toHaveCount(0);

  await address.fill("example.org/seed-swap");
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(dialog).toBeHidden();
  const link = editor.locator("a");
  await expect(link).toHaveText("club website");
  await expect(link).toHaveAttribute("href", "https://example.org/seed-swap");
  await page.keyboard.type(".");
  await expect(link).toHaveText("club website");
  await expect(editor).toHaveText("Rules are on the club website.");

  const linkButton = page.getByRole("button", { name: "Insert link", exact: true });
  await expect(linkButton).toHaveAttribute("aria-pressed", "false");
  await link.click();
  await expect(linkButton).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ControlOrMeta+k");
  const edit = page.getByRole("dialog", { name: "Edit link" });
  await expect(edit.getByLabel("Link address")).toHaveValue("https://example.org/seed-swap");
  await edit.getByLabel("Link text").fill("rules page");
  await edit.getByRole("button", { name: "Apply" }).click();
  await expect(editor).toHaveText("Rules are on the rules page.");
  await expect(link).toHaveText("rules page");

  await paginated(page);
  const line = editor.locator("p").first();
  const lineBox = (await line.boundingBox())!;
  await line.click({ position: { x: lineBox.width - 4, y: lineBox.height / 2 } });
  await paginated(page);
  await page.keyboard.press("Enter");
  await page.keyboard.press("ControlOrMeta+k");
  const fresh = page.getByRole("dialog", { name: "Insert link" });
  await expect(fresh.getByLabel("Link text")).toBeFocused();
  await page.keyboard.type("Email Asha");
  await fresh.getByLabel("Link address").fill("asha@example.org");
  await page.keyboard.press("Enter");
  await expect(editor.locator('a[href="mailto:asha@example.org"]')).toHaveText("Email Asha");
  expect(await savedContent(page)).toContain("mailto:asha@example.org");

  await editor.getByText("rules page").click();
  await expect(linkButton).toHaveAttribute("aria-pressed", "true");
  await linkButton.click();
  await page.getByRole("dialog", { name: "Edit link" }).getByRole("button", { name: "Remove link" }).click();
  await expect(editor.locator("a")).toHaveCount(1);
  await expect(editor).toContainText("Rules are on the rules page.");
  expect(browserDialogs).toEqual([]);
});

test("images can be resized from a corner handle and keep their proportions", async ({ page }) => {
  const editor = await newDocument(page);
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({
    name: "garden.png",
    mimeType: "image/png",
    buffer: picture(),
  });
  const image = editor.locator("img");
  await expect(image).toBeVisible();
  await expect.poll(async () => (await image.boundingBox())?.width).toBe(200);
  await paginated(page);
  await page.keyboard.type("Last year's swap");
  await expect(image).toBeVisible();
  await expect(editor.locator("[data-resize-container] + p")).toHaveText("Last year's swap");
  await image.click();
  const handle = editor.locator('[data-resize-handle="bottom-right"]');
  await expect(handle).toBeVisible();
  await expect(handle).toHaveCSS("opacity", "1");
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 50, {
    steps: 8,
  });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await image.boundingBox())!.width)).toBe(300);
  expect(Math.round((await image.boundingBox())!.height)).toBe(150);
  const saved = await savedContent(page);
  expect(saved).toContain('"width":300');
  expect(saved).toContain('"height":150');
});
