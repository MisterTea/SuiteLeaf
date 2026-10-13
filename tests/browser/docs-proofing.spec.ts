import { test, expect, type Page } from "@playwright/test";
import { createFile, serializeFile, type DocFile } from "@suiteleaf/core";
import { independenceEssayContent } from "../../apps/web/src/editors/independence-essay";

const editorOf = (page: Page) => page.getByRole("textbox", { name: "Document content" });

async function seedEssay(page: Page) {
  const file = createFile("doc", "Independence essay") as DocFile;
  file.content = independenceEssayContent();
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).waitFor();
  await page.evaluate(async (record) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("SuiteLeaf");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("encoded", "readwrite");
        tx.objectStore("encoded").put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  }, {
    id: file.id,
    title: file.title,
    updatedAt: file.updatedAt,
    native: serializeFile(file),
  });
  await page.reload();
  await page.getByRole("link", { name: "Independence essay" }).click();
  await expect(editorOf(page)).toContainText("this ends the introduction");
}

test("word count is on by default, follows the selection, and stays hidden after reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  const editor = editorOf(page);
  await editor.click();
  await page.keyboard.type("one two three four");
  await expect(page.locator(".word-count")).toHaveText("4 words");
  await page.keyboard.press("ControlOrMeta+A");
  await expect(page.locator(".word-count")).toHaveText("4 of 4 words", { timeout: 200 });
  await page.keyboard.press("ControlOrMeta+Shift+C");
  const dialog = page.getByRole("dialog", { name: "Word count" });
  await expect(dialog).toBeVisible();
  for (const name of ["Words", "Characters (no spaces)", "Paragraphs", "Pages"])
    await expect(dialog.locator("tr", { hasText: name }).first()).toBeVisible();
  await expect(dialog.locator("tr", { hasText: "Characters" }).first()).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: "Count footnotes" })).not.toBeChecked();
  await dialog.getByRole("checkbox", { name: "Show word count while typing" }).uncheck();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".word-count")).toHaveText("");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save now" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.reload();
  await expect(editor).toContainText("one two three four");
  await expect(page.locator(".word-count")).toHaveText("");
  await page.keyboard.press("ControlOrMeta+Shift+C");
  await page.getByRole("checkbox", { name: "Show word count while typing" }).check();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".word-count")).toContainText("words");
});

test("spelling keeps formatting, stays on device, and the dictionary can be undone", async ({
  page,
  context,
}) => {
  const leaks: string[] = [];
  page.on("request", (request) => {
    const body = `${request.url()}\n${request.postData() ?? ""}`;
    if (/seperate|movment|Nkrumah|recieve/i.test(body)) leaks.push(request.url());
  });
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  const editor = editorOf(page);
  await editor.click();
  await page.keyboard.press("ControlOrMeta+B");
  await page.keyboard.type("seperate");
  await page.keyboard.press("ControlOrMeta+B");
  await page.keyboard.type(" were");
  await expect(page.locator(".spelling-misspelling")).toHaveText("seperate");
  await context.setOffline(true);
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByRole("menuitem", { name: "Spelling", exact: true }).click();
  const spelling = page.getByRole("dialog", { name: "Spelling" });
  await expect(spelling).toContainText("seperate → separate");
  await expect(editor.locator("strong")).toHaveText("seperate");
  await spelling.getByRole("button", { name: "Ignore", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(editor.locator("strong")).toHaveText("seperate");
  await expect(page.locator(".spelling-misspelling")).toHaveCount(0);
  await spelling.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByRole("menuitem", { name: "Personal dictionary" }).click();
  const dictionary = page.getByRole("dialog", { name: "Personal dictionary" });
  await dictionary.locator("li", { hasText: "seperate" }).getByRole("button", { name: "Remove" }).click();
  await expect(page.locator(".spelling-misspelling")).toHaveText("seperate");
  await dictionary.getByLabel("Word to flag").fill("were");
  await dictionary.getByRole("button", { name: "Flag word" }).click();
  await expect(page.locator(".spelling-misspelling", { hasText: "were" })).toBeVisible();
  await dictionary.getByRole("button", { name: "Done" }).click();
  await page.locator(".spelling-misspelling", { hasText: "seperate" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "separate", exact: true }).click();
  await expect(editor.locator("strong")).toHaveText("separate");
  await context.setOffline(false);
  expect(leaks).toEqual([]);
});

test("essay word count excludes a heading and is saved with the file", async ({ page }) => {
  await seedEssay(page);
  await expect(page.locator(".word-count")).toHaveText("1,612 words");
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByRole("menuitem", { name: /Word count/ }).click();
  const dialog = page.getByRole("dialog", { name: "Word count" });
  await dialog.getByLabel("Stop counting at heading").selectOption("References");
  await expect(dialog.locator("tr", { hasText: "Words" }).locator("td").nth(1)).toHaveText("1,488");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".word-count")).toHaveText("1,488 words (excludes References)");
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Independence essay" }).click();
  await expect(page.locator(".word-count")).toHaveText("1,488 words (excludes References)");
});
