import { createFile, serializeFile, type DocFile } from "@suiteleaf/core";
import type { Page } from "@playwright/test";
import { independenceEssayContent } from "../../../apps/web/src/editors/independence-essay";
import { askAgent, beat, caption, describeRun, expect, test } from "../harness";

const editorOf = (page: Page) => page.getByRole("textbox", { name: "Document content" });

const PROMPT =
  "The word limit for this essay leaves out the References section. Stop counting words at the References heading, leave footnotes uncounted, and save that choice in the file. Then check spelling and fix every real typo, including recieve to receive, movment to movement where it appears, and teh to the. Keep the bold formatting on separate. Add Danquah to the personal dictionary so it is not flagged, and do not change the spelling of Danquah.";

/** The same Independence essay the human storyboard opens. */
async function seedEssay(page: Page) {
  const file = createFile("doc", "Independence essay") as DocFile;
  file.content = independenceEssayContent();
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

async function closeProofingDialogs(page: Page) {
  const dialog = page.getByRole("dialog");
  if (!(await dialog.first().isVisible().catch(() => false))) return;
  for (const name of ["Done", "Close word count", "Close spelling", "Close personal dictionary"]) {
    const button = dialog.getByRole("button", { name, exact: true });
    if (await button.first().isVisible().catch(() => false)) {
      await button.first().click();
      return;
    }
  }
}

test("34-count-words-and-check-spelling-ai", async ({ page }) => {
  await seedEssay(page);
  await caption(page, "Amara asks the on-device assistant to count the essay without References and to fix the spelling.");
  await page.getByRole("link", { name: "Independence essay" }).click();
  const editor = editorOf(page);
  await expect(editor).toContainText("Introduction");
  await expect(page.locator(".word-count")).toHaveText("1,612 words");

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  await closeProofingDialogs(page);
  await page.locator(".document-content").click({ position: { x: 24, y: 24 } });
  await expect(page.locator(".word-count"), why).toHaveText("1,488 words (excludes References)");
  await expect(editor.locator("h1", { hasText: "References" }), why).toHaveCount(1);
  for (const typo of ["recieve", "movment", "seperate", "occured", "definately", "teh"])
    await expect(editor, why).not.toContainText(typo);
  await expect(editor, why).toContainText("receive");
  await expect(editor, why).toContainText("the movement grew");
  await expect(editor, why).toContainText("still said the");
  const names = await editor.evaluate((root) => root.textContent?.match(/Danquah/g)?.length ?? 0);
  expect(names, why).toBe(3);
  const bold = await editor.locator("strong").allTextContents();
  expect(bold.some((text) => text.trim() === "separate"), why).toBe(true);
  expect(bold.some((text) => text.includes("seperate")), why).toBe(false);
  await expect(page.locator(".spelling-misspelling"), why).toHaveCount(0);

  const dictionary = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("suiteleaf.personal-dictionary") || "{}") as {
      added?: string[];
      flagged?: string[];
    };
    return { added: raw.added ?? [], flagged: raw.flagged ?? [] };
  });
  expect(dictionary.added.some((word) => word.toLowerCase() === "danquah"), why).toBe(true);
  expect(dictionary.added.some((word) => word.toLowerCase() === "teh"), why).toBe(false);
  expect(dictionary.flagged.some((word) => word.toLowerCase() === "danquah"), why).toBe(false);

  await caption(page, "The count stops at References, the typos are fixed, and Danquah is in her dictionary.", 2000);
  await page.getByRole("button", { name: "Close assistant" }).click();
  await expect(page.getByRole("status"), why).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Independence essay" }).click();
  await expect(editor).toContainText("Introduction");
  await expect(page.locator(".word-count"), why).toHaveText("1,488 words (excludes References)");
  await expect(page.locator(".spelling-misspelling"), why).toHaveCount(0);
  await expect(editor.locator("strong", { hasText: "separate" }), why).toHaveCount(1);
  await beat(page, 600);
});
