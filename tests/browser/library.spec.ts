import { test, expect, type Page } from "@playwright/test";

async function newFile(page: Page, kind: string, title: string, text?: string) {
  await page.getByRole("button", { name: `New ${kind}` }).click();
  const box = page.getByLabel("File title");
  await box.fill(title);
  if (text) await page.getByRole("textbox", { name: "Document content" }).fill(text);
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
}

test("a title typed while a new spreadsheet loads keeps every keystroke", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New spreadsheet" }).click();
  const title = page.getByLabel("File title");
  await title.click();
  await title.press("ControlOrMeta+A");
  await page.keyboard.type("Garden club budget", { delay: 35 });
  const nameBox = page.locator(".sheet-host input.univer-size-full");
  await nameBox.waitFor();
  await page.waitForTimeout(1500);
  await expect(title).toHaveValue("Garden club budget");
  await expect(title).toBeFocused();
  await expect(page.getByRole("status")).toContainText("Saved");

  // The grid still takes typing once someone clicks into it.
  await page
    .locator('.sheet-host canvas[id^="univer-sheet-main-canvas"]')
    .click({ position: { x: 300, y: 200 } });
  await page.keyboard.type("Seeds");
  await page.keyboard.press("Enter");
  await expect(title).toHaveValue("Garden club budget");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByRole("link", { name: "Garden club budget", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Untitled/ })).toHaveCount(0);
});

test("the library searches inside files, sorts, renames and deletes in place", async ({
  page,
}) => {
  await page.goto("/");
  await newFile(page, "document", "Garden club newsletter", "Harvest supper on Saturday.");
  await newFile(page, "document", "Allotment rota", "Bring compost on Sunday.");
  await newFile(page, "presentation", "Garden club talk");

  const rows = page.locator(".file-row");
  const names = () => rows.locator("a > span:last-child").allInnerTexts();
  await expect(rows).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Sample budget" })).toBeVisible();

  // Search replaces the welcome banner so results sit right under the box.
  const search = page.getByLabel("Search files");
  await search.fill("harvest");
  await expect(page.getByRole("heading", { name: "Results for “harvest”" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Good ideas start here." })).toHaveCount(0);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Garden club newsletter");
  await expect(rows.first().locator(".file-snippet")).toHaveText("Harvest supper on Saturday.");
  await expect(rows.first()).toBeInViewport();

  await search.fill("tomatoes");
  await expect(page.getByText("No files match “tomatoes”")).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(search).toHaveValue("");
  await expect(page.getByRole("heading", { name: "Good ideas start here." })).toBeVisible();
  await search.fill("garden");
  await search.press("Escape");
  await expect(rows).toHaveCount(3);

  // Newest first, then by name in either direction.
  expect(await names()).toEqual(["Garden club talk", "Allotment rota", "Garden club newsletter"]);
  await page.getByRole("button", { name: "Sort by name" }).click();
  expect(await names()).toEqual(["Allotment rota", "Garden club newsletter", "Garden club talk"]);
  await page.getByRole("button", { name: "Sort by name" }).click();
  expect(await names()).toEqual(["Garden club talk", "Garden club newsletter", "Allotment rota"]);
  await page.getByRole("button", { name: "Sort by last edited" }).click();
  expect(await names()).toEqual(["Garden club talk", "Allotment rota", "Garden club newsletter"]);

  // Rename from the list with an in-app dialog.
  await page.getByRole("button", { name: "Rename Allotment rota", exact: true }).click();
  const rename = page.getByRole("dialog", { name: "Rename" });
  await expect(rename.getByLabel("Name")).toHaveValue("Allotment rota");
  await rename.getByLabel("Name").fill("Allotment rota - spring");
  await rename.getByRole("button", { name: "OK" }).click();
  await expect(rename).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Allotment rota - spring", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Allotment rota - spring", exact: true }).click();
  await expect(page.getByLabel("File title")).toHaveValue("Allotment rota - spring");
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
    "Bring compost on Sunday.",
  );
  await page.getByRole("button", { name: "Back to files" }).click();

  // Delete asks in the page, and Cancel keeps the file.
  page.on("dialog", (d) => {
    throw new Error(`Unexpected browser dialog: ${d.message()}`);
  });
  await page.getByRole("button", { name: "Remove Garden club talk", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Delete this file?" });
  await expect(confirm).toContainText("“Garden club talk” will be deleted from this browser.");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(rows).toHaveCount(3);
  await page.getByRole("button", { name: "Remove Garden club talk", exact: true }).click();
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(rows).toHaveCount(2);
  await expect(page.getByRole("link", { name: "Garden club talk", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(rows).toHaveCount(2);
});
