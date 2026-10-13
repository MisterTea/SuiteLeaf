import { beat, caption, expect, test, typeSlowly } from "./harness";
import type { Page } from "@playwright/test";

async function makeFile(
  page: Page,
  kind: "document" | "spreadsheet" | "presentation",
  title: string,
  body?: string,
) {
  await page.getByRole("button", { name: `New ${kind}` }).click();
  const box = page.getByLabel("File title");
  await expect(box).toBeVisible();
  await box.fill(title);
  await expect(box).toHaveValue(title);
  if (body) {
    const editor = page.getByRole("textbox", { name: "Document content" });
    await editor.click();
    await editor.fill(body);
  }
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
}

async function showRow(page: Page, title: string) {
  const row = page.locator(".file-row", { hasText: title });
  await row.evaluate((el) =>
    el.scrollIntoView({ behavior: "smooth", block: "start" }),
  );
  await beat(page, 500);
  return row;
}

test("40-trash-star-and-restore", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Grace keeps the family's paperwork in SuiteLeaf.", 1000);
  await makeFile(page, "document", "Lasagne", "Sunday lunch: pasta, ragu, and bechamel.");
  await makeFile(page, "document", "Weekly shopping");
  await makeFile(page, "spreadsheet", "Grandkids' birthdays");
  await makeFile(page, "document", "Medication times");
  await makeFile(page, "presentation", "Holiday slideshow");
  await makeFile(page, "document", "Old grocery list");
  await makeFile(page, "document", "2024 holiday cards");
  await makeFile(page, "document", "Expired coupons");

  await caption(
    page,
    "All files, Starred, and Trash are one click away in the sidebar.",
    1800,
  );
  await expect(page.getByRole("button", { name: "Starred", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Trash", exact: true })).toBeVisible();

  const lasagne = await showRow(page, "Lasagne");
  const lasagneEdited = await lasagne.locator("time").innerText();
  await caption(page, "She stars the lasagne recipe. One click, and it stays.", 1200);
  await lasagne.getByRole("button", { name: "Star Lasagne", exact: true }).click();
  await expect(lasagne.getByRole("button", { name: "Unstar Lasagne" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await beat(page, 800);

  const birthdays = await showRow(page, "Grandkids' birthdays");
  const edited = await birthdays.locator("time").innerText();
  await caption(page, "Tidying up, she hits the bin on Grandkids' birthdays by mistake.", 1400);
  await birthdays.getByRole("button", { name: "Move Grandkids' birthdays to Trash", exact: true }).click();
  const toast = page.locator(".trash-toast");
  await expect(toast).toContainText("Moved “Grandkids' birthdays” to Trash");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Grandkids' birthdays", exact: true })).toHaveCount(0);
  await caption(page, "It's in Trash immediately. Undo stays up, so the mistake isn't final.", 2000);
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(birthdays).toBeVisible();
  await expect(birthdays.locator("time")).toHaveText(edited);
  await caption(page, "Undo puts the sheet back, in the same place, with the same date.", 1800);

  await showRow(page, "Lasagne");
  await caption(page, "An old recipe she means to delete.", 1000);
  await page.getByRole("button", { name: "Move Lasagne to Trash", exact: true }).click();
  await expect(toast).toContainText("Moved “Lasagne” to Trash");
  await caption(page, "The notice stays long enough to undo. She lets this one go.", 1500);
  await page.waitForTimeout(7000);
  await expect(toast).toBeVisible();
  await expect(toast).toBeHidden({ timeout: 5000 });
  await beat(page, 600);

  await caption(page, "A week later, she wants that recipe after all.", 1200);
  const iso = new Date(Date.now() - (7 * 24 + 2) * 60 * 60 * 1000).toISOString();
  await page.evaluate(async (when) => {
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
    const row = rows.find((item) => item.title === "Lasagne");
    if (!row) throw new Error("Lasagne is not in the library");
    row.trashedAt = when;
    await new Promise<void>((ok, err) => {
      const req = db.transaction("encoded", "readwrite").objectStore("encoded").put(row);
      req.onsuccess = () => ok();
      req.onerror = () => err(req.error);
    });
    db.close();
  }, iso);
  await page.reload();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Trash" })).toBeVisible();
  const binned = page.locator(".file-row", { hasText: "Lasagne" });
  await expect(binned).toContainText("Deleted 7 days ago · deleted forever in 23 days");
  await caption(page, "Trash shows when it was deleted, and how many days are left.", 2200);

  await page.getByRole("button", { name: "All files", exact: true }).click();
  const search = page.getByLabel("Search files");
  await search.click();
  await typeSlowly(page, "lasagne", 80);
  await expect(page.getByRole("heading", { name: "Results for “lasagne”" })).toBeVisible();
  const hit = page.locator(".file-row", { hasText: "Lasagne" });
  await expect(hit.locator(".in-trash-label")).toHaveText("In Trash");
  await expect(hit.getByRole("button", { name: "Restore Lasagne" })).toBeVisible();
  await caption(page, "Search finds it too, labelled In Trash, with Restore beside it.", 2200);
  await page.getByRole("button", { name: "Clear search" }).click();

  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await caption(page, "Restore is one click. The recipe comes back unchanged.", 1200);
  await page.getByRole("button", { name: "Restore Lasagne" }).click();
  const restored = page.locator(".file-row", { hasText: "Lasagne" });
  await expect(restored.locator("time")).toHaveText(lasagneEdited);
  await restored.evaluate((el) =>
    el.scrollIntoView({ behavior: "smooth", block: "start" }),
  );
  await beat(page, 700);
  await restored.getByRole("link", { name: "Lasagne", exact: true }).click();
  await expect(page.getByLabel("File title")).toHaveValue("Lasagne");
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
    "pasta, ragu, and bechamel",
  );
  const star = page.getByRole("button", { name: "Starred", exact: true });
  await expect(star).toHaveAttribute("aria-pressed", "true");
  await caption(page, "Same recipe, same title, and the star is still filled.", 2200);
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();

  await caption(page, "She stars the three files she opens every week.", 1000);
  for (const title of ["Weekly shopping", "Grandkids' birthdays", "Medication times"]) {
    const row = await showRow(page, title);
    await row.getByRole("button", { name: `Star ${title}`, exact: true }).click();
    await expect(row.getByRole("button", { name: `Unstar ${title}` })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await beat(page, 400);
  }
  await page.getByRole("button", { name: "Starred", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Starred" })).toBeVisible();
  const starred = page.locator(".file-row a");
  await expect(starred.nth(0)).toContainText("Medication times");
  await expect(starred.nth(1)).toContainText("Grandkids' birthdays");
  await expect(starred.nth(2)).toContainText("Weekly shopping");
  await caption(page, "Starred lists them, most recently edited first.", 1800);

  await page.reload();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await page.getByRole("button", { name: "Starred", exact: true }).click();
  await expect(starred).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Unstar Medication times" })).toBeVisible();
  await caption(page, "She closes the browser and comes back. The stars are still saved.", 2000);

  await page.getByRole("button", { name: "All files", exact: true }).click();
  await caption(page, "Three old files can go. Empty trash asks before anything is permanent.", 1200);
  for (const title of ["Old grocery list", "2024 holiday cards", "Expired coupons"]) {
    const row = await showRow(page, title);
    await row.getByRole("button", { name: `Move ${title} to Trash`, exact: true }).click();
    await beat(page, 350);
  }
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await expect(page.locator(".file-row")).toHaveCount(3);
  await page.getByRole("button", { name: "Empty trash" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete 3 files forever?" });
  await expect(dialog).toContainText("This can't be undone.");
  await expect(dialog).toContainText("Old grocery list");
  await expect(dialog).toContainText("2024 holiday cards");
  await expect(dialog).toContainText("Expired coupons");
  await caption(page, "Delete 3 files forever? Only if she confirms.", 2000);
  await dialog.getByRole("button", { name: "Delete forever" }).click();
  await expect(page.getByRole("heading", { name: "Trash is empty" })).toBeVisible();
  await caption(page, "Trash is empty. The birthdays sheet, the recipe, and her stars are safe.", 2200);
});
