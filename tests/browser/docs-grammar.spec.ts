import { test, expect, type Page } from "@playwright/test";
import { createFile, serializeFile, type DocFile } from "@suiteleaf/core";
import { grammarEssayContent } from "../../apps/web/src/editors/grammar-essay";

const editorOf = (page: Page) => page.getByRole("textbox", { name: "Document content" });

async function seedEssay(page: Page) {
  const file = createFile("doc", "Independence essay") as DocFile;
  file.content = grammarEssayContent();
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
  await expect(editorOf(page)).toContainText("the movement were");
}

test("grammar underlines a different way from spelling and leaves formatting alone", async ({
  page,
}) => {
  await seedEssay(page);
  await expect(page.locator(".word-count")).toHaveText("1,488 words (excludes References)");
  const grammar = page.locator(".grammar-issue");
  const spelling = page.locator(".spelling-misspelling");
  await expect(grammar).toHaveCount(3);
  await expect(spelling.filter({ hasText: "movment" })).toBeVisible();
  await expect(spelling.filter({ hasText: "Nkrumah" })).toHaveCount(1);
  await expect(grammar.filter({ hasText: "Nkrumah" })).toHaveCount(0);
  const grammarStyle = await grammar.first().evaluate((el) => getComputedStyle(el).textDecorationStyle);
  const spellingStyle = await spelling.first().evaluate((el) => getComputedStyle(el).textDecorationStyle);
  expect(grammarStyle).toBe("dotted");
  expect(spellingStyle).toBe("wavy");

  const were = grammar.filter({ hasText: /^were$/ });
  await were.scrollIntoViewIfNeeded();
  await were.click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Grammar for were" });
  await expect(menu.getByRole("menuitem").first()).toHaveText("was");
  await expect(menu.getByRole("menuitem", { name: "Ignore" })).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveCount(2);
  await menu.getByRole("menuitem", { name: "was", exact: true }).click();
  await expect(editorOf(page)).toContainText("the movement was");
  await expect(page.locator(".document-content strong")).toHaveText("movement");
  await expect(page.locator(".document-content em")).toHaveText("strong");
  await expect(page.locator(".document-content a")).toHaveAttribute("href", "https://example.com/ghana");

  await page.locator(".grammar-issue").filter({ hasText: /^its$/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "it's", exact: true }).click();
  await expect(editorOf(page)).toContainText("it's the reason");
  await expect(page.locator(".document-content strong")).toHaveText("movement");

  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByRole("menuitem", { name: "Grammar", exact: true }).click();
  const grammarDialog = page.getByRole("dialog", { name: "Grammar" });
  await expect(grammarDialog).toContainText("1 of 1 · was → were");
  await expect(grammarDialog).not.toContainText("movment");
  await page.keyboard.press("Enter");
  await expect(editorOf(page)).toContainText("they were ready");
  await expect(page.locator(".document-content em")).toHaveText("strong");
  await grammarDialog.getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByRole("menuitem", { name: "Spelling", exact: true }).click();
  const spellingDialog = page.getByRole("dialog", { name: "Spelling" });
  await expect(spellingDialog).toContainText("movment");
  await expect(spellingDialog).not.toContainText("was →");
  await spellingDialog.getByRole("button", { name: "Close spelling" }).click();
  await expect(page.locator(".spelling-misspelling", { hasText: "movment" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("suiteleaf.personal-dictionary"))).toBeNull();
});

test("ignored grammar comes back, stays in the file, and still runs offline", async ({
  page,
  context,
}) => {
  const leaks: string[] = [];
  page.on("request", (request) => {
    const body = `${request.url()}\n${request.postData() ?? ""}`;
    if (/they was|movment|Nkrumah/i.test(body)) leaks.push(request.url());
  });
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  const editor = editorOf(page);
  await editor.click();
  await page.keyboard.press("ControlOrMeta+B");
  await page.keyboard.type("Note");
  await page.keyboard.press("ControlOrMeta+B");
  await page.keyboard.press("ControlOrMeta+I");
  await page.keyboard.type(" please");
  await page.keyboard.press("ControlOrMeta+I");
  await page.keyboard.type(" they was ready");
  await expect(page.locator(".grammar-issue")).toHaveText("was");
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByRole("menuitem", { name: "Grammar", exact: true }).click();
  const grammar = page.getByRole("dialog", { name: "Grammar" });
  await grammar.getByRole("button", { name: "Ignore", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".grammar-issue")).toHaveCount(0);
  await expect(editor.locator("strong")).toHaveText("Note");
  await expect(editor.locator("em")).toHaveText(" please");
  await grammar.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.reload();
  await expect(editor).toContainText("they was ready");
  await expect(page.locator(".grammar-issue")).toHaveCount(0);
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByRole("menuitem", { name: "Ignored grammar" }).click();
  const ignored = page.getByRole("dialog", { name: "Ignored grammar" });
  await expect(ignored).toContainText("they was → were");
  await ignored.getByRole("button", { name: "Remove" }).click();
  await expect(page.locator(".grammar-issue")).toHaveText("was");
  await ignored.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByRole("menuitem", { name: "Grammar", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Grammar" })).toContainText("was → were");
  await page.keyboard.press("Enter");
  await expect(editor).toContainText("they were ready");
  await expect(editor.locator("strong")).toHaveText("Note");
  await expect(editor.locator("em")).toHaveText(" please");
  await page.getByRole("button", { name: "Done" }).click();

  await context.setOffline(true);
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" They was next");
  await expect(page.locator(".grammar-issue")).toHaveText("was");
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  expect(leaks).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("suiteleaf.personal-dictionary"))).toBeNull();
});
