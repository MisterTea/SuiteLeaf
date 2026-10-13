import { test, expect, type Page } from "@playwright/test";

async function newDocument(page: Page, title: string, body?: string) {
  await page.getByRole("button", { name: "New document" }).click();
  const box = page.getByLabel("File title");
  await box.fill(title);
  if (body) {
    const editor = page.getByRole("textbox", { name: "Document content" });
    await editor.click();
    await editor.fill(body);
  }
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
}

async function ageTrash(page: Page, title: string, days: number) {
  const iso = new Date(Date.now() - (days * 24 + 2) * 60 * 60 * 1000).toISOString();
  await page.evaluate(
    async ({ title, iso }) => {
      const db = await new Promise<IDBDatabase>((ok, err) => {
        const req = indexedDB.open("SuiteLeaf");
        req.onsuccess = () => ok(req.result);
        req.onerror = () => err(req.error);
      });
      const rows = await new Promise<Record<string, unknown>[]>((ok, err) => {
        const req = db.transaction("encoded").objectStore("encoded").getAll();
        req.onsuccess = () => ok(req.result as Record<string, unknown>[]);
        req.onerror = () => err(req.error);
      });
      const row = rows.find((item) => item.title === title);
      if (!row) throw new Error(`No stored file named ${title}`);
      row.trashedAt = iso;
      await new Promise<void>((ok, err) => {
        const req = db.transaction("encoded", "readwrite").objectStore("encoded").put(row);
        req.onsuccess = () => ok();
        req.onerror = () => err(req.error);
      });
      db.close();
    },
    { title, iso },
  );
  await page.reload();
  await expect(page.getByLabel("Search files")).toBeVisible();
}

test("trash keeps a file for undo, restore, search, and starring", async ({ page }) => {
  test.setTimeout(90_000);
  page.on("dialog", (d) => {
    throw new Error(`Unexpected browser dialog: ${d.message()}`);
  });
  await page.goto("/");
  await newDocument(page, "Weekly shopping", "Milk and bread");
  await newDocument(page, "Lasagne", "Sunday lunch: pasta, ragu, and bechamel.");

  const row = page.locator(".file-row", { hasText: "Lasagne" });
  const edited = await row.locator("time").innerText();
  await page.getByRole("button", { name: "Move Lasagne to Trash", exact: true }).click();
  const toast = page.locator(".trash-toast");
  await expect(toast).toContainText("Moved “Lasagne” to Trash");
  await expect(toast.getByRole("button", { name: "Undo" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.waitForTimeout(8000);
  await expect(toast).toBeVisible();
  await expect(toast).toBeHidden({ timeout: 5000 });

  await ageTrash(page, "Lasagne", 7);
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Trash" })).toBeVisible();
  await expect(row).toContainText("Deleted 7 days ago · deleted forever in 23 days");
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await page.getByLabel("Search files").fill("lasagne");
  await expect(page.getByRole("heading", { name: "Results for “lasagne”" })).toBeVisible();
  const hit = page.locator(".file-row", { hasText: "Lasagne" });
  await expect(hit.locator(".in-trash-label")).toHaveText("In Trash");
  await expect(hit.getByRole("button", { name: "Restore Lasagne" })).toBeVisible();
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await page.getByRole("button", { name: "Restore Lasagne" }).click();
  await expect(page.getByRole("heading", { name: "Your files" })).toBeVisible();
  await expect(page.locator(".file-row", { hasText: "Lasagne" }).locator("time")).toHaveText(edited);

  await page.getByRole("link", { name: "Lasagne", exact: true }).click();
  await expect(page.getByLabel("File title")).toHaveValue("Lasagne");
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText("bechamel");
  await expect(page.getByRole("button", { name: "Star document" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.getByRole("button", { name: "Star document" }).click();
  await expect(page.getByRole("button", { name: "Starred" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("button", { name: "Star Weekly shopping", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unstar Weekly shopping" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.reload();
  await page.getByRole("button", { name: "Starred", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Starred" })).toBeVisible();
  const names = page.locator(".file-row a");
  await expect(names).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Unstar Lasagne" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Unstar Weekly shopping" })).toBeVisible();

  await page.getByRole("button", { name: "All files", exact: true }).click();
  await page.getByRole("button", { name: "Move Weekly shopping to Trash", exact: true }).click();
  await page.getByRole("button", { name: "Move Lasagne to Trash", exact: true }).click();
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await page.getByRole("button", { name: "Empty trash" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete 2 files forever?" });
  await expect(dialog).toContainText("This can't be undone.");
  await expect(dialog).toContainText("Weekly shopping");
  await expect(dialog).toContainText("Lasagne");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".file-row")).toHaveCount(2);
  await page.getByRole("button", { name: "Empty trash" }).click();
  await dialog.getByRole("button", { name: "Delete forever" }).click();
  await expect(page.getByRole("heading", { name: "Trash is empty" })).toBeVisible();
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await expect(page.getByRole("heading", { name: "A workspace waiting for you" })).toBeVisible();
});
