import { createFile, serializeFile, type DocFile } from "@suiteleaf/core";
import type { Page } from "@playwright/test";
import { grammarEssayContent } from "../../../apps/web/src/editors/grammar-essay";
import { askAgent, beat, caption, describeRun, expect, test } from "../harness";

const editorOf = (page: Page) => page.getByRole("textbox", { name: "Document content" });

const PROMPT =
  "Check the grammar in this essay and fix every grammar issue with the grammar tool, not find and replace. Change “the movement were” so it says “the movement was”, change “its the reason” so it says “it's the reason”, and change “they was ready” so it says “they were ready”. Keep the bold formatting on movement. Leave the spelling of Danquah and movment unchanged.";

/** The same Independence essay the human storyboard opens. */
async function seedEssay(page: Page) {
  const file = createFile("doc", "Independence essay") as DocFile;
  file.content = grammarEssayContent();
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).waitFor();
  await page.evaluate(async (record) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("SuiteLeaf");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
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
  await page.getByRole("link", { name: "Independence essay" }).waitFor();
}

test("45-check-grammar-on-the-device-ai", async ({ page }) => {
  await seedEssay(page);
  await caption(page, "Amara asks the on-device assistant to fix the grammar in the essay.");
  await page.getByRole("link", { name: "Independence essay" }).click();
  const editor = editorOf(page);
  await expect(editor).toContainText("the movement were");
  await expect(editor).toContainText("its the reason");
  await expect(editor).toContainText("they was ready");

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  await expect(editor, why).toContainText("the movement was");
  await expect(editor, why).toContainText("it's the reason");
  await expect(editor, why).toContainText("they were ready");
  await expect(editor, why).not.toContainText("the movement were");
  await expect(editor, why).not.toContainText("its the reason");
  await expect(editor, why).not.toContainText("they was");
  await expect(editor, why).toContainText("its future");
  await expect(editor, why).toContainText("movment");
  await expect(page.locator(".document-content strong"), why).toHaveText("movement");
  await expect(page.locator(".document-content em"), why).toHaveText("strong");
  await expect(editor, why).toContainText("as Danquah spoke");
  await expect(page.locator(".spelling-misspelling", { hasText: "Danquah" }), why).toHaveCount(1);
  await expect(page.locator(".spelling-misspelling", { hasText: "movment" }), why).toBeVisible();

  await caption(page, "The three grammar mistakes are fixed. Bold and Danquah stay.", 2000);
  await page.getByRole("button", { name: "Close assistant" }).click();
  await beat(page, 600);
});
