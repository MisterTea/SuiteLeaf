import { createFile, serializeFile, type DocFile } from "@suiteleaf/core";
import type { Page } from "@playwright/test";
import { askAgent, beat, caption, describeRun, expect, test } from "../harness";

const editorOf = (page: Page) => page.getByRole("textbox", { name: "Document content" });

const PROMPT =
  'Switch to Suggesting as Jordan. Suggest inserting "approximately " immediately before "40 customers", suggest deleting "very", and suggest making "on budget" bold. Then, as the reviewer, accept the insertion "approximately", accept the deletion "very" so that word is gone, and reject the bold on "on budget". The report should show the accepted wording, with no suggestions left pending, and "on budget" not bold.';

const ACCEPTED = "We now serve approximately 40 customers and the project is on budget.";

/** The same Quarterly Report the human storyboard types, before any suggestion. */
async function seedReport(page: Page) {
  const file = createFile("doc", "Quarterly Report") as DocFile;
  file.content = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Quarterly Report" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "We now serve very 40 customers and the project is on budget." }],
      },
    ],
  };
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
  await page.getByRole("link", { name: "Quarterly Report", exact: true }).waitFor();
}

test("30-suggest-changes-and-accept-them-ai", async ({ page }) => {
  await seedReport(page);
  await caption(page, "Jordan asks the on-device assistant to suggest three edits, then accept the wording and reject the bold.");
  await page.getByRole("link", { name: "Quarterly Report", exact: true }).click();
  const editor = editorOf(page);
  await expect(editor.locator("h1")).toHaveText("Quarterly Report");
  await expect(editor).toContainText("We now serve very 40 customers and the project is on budget.");

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  const paragraph = editor.locator("p").filter({ hasText: "customers" });
  await expect(paragraph, why).toHaveText(ACCEPTED);
  const exact = await paragraph.evaluate((el) => el.textContent ?? "");
  expect(exact, why).toBe(ACCEPTED);
  await expect(editor, why).not.toContainText("very");
  await expect(paragraph.locator("strong"), why).toHaveCount(0);
  await expect(editor.locator("strong"), why).toHaveCount(0);
  await expect(editor.locator(".suggestion-insert"), why).toHaveCount(0);
  await expect(editor.locator(".suggestion-delete"), why).toHaveCount(0);
  await expect(editor.locator(".suggestion-format"), why).toHaveCount(0);
  await expect(editor.locator("h1"), why).toHaveText("Quarterly Report");
  await expect(page.locator(".suggestion-card"), why).toHaveCount(0);
  await expect(page.locator(".suggestion"), why).toHaveCount(0);
  await expect(page.getByLabel("Suggesting as"), why).toHaveValue("Jordan");

  await caption(page, "The report has the accepted wording: approximately 40 customers, very is gone, and on budget is not bold.", 2000);
  await page.getByRole("button", { name: "Close assistant" }).click();
  await expect(page.locator(".save-status"), why).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Quarterly Report", exact: true }).click();
  await expect(editor.locator("h1")).toHaveText("Quarterly Report");
  await expect(paragraph).toHaveText(ACCEPTED);
  const reopened = await paragraph.evaluate((el) => el.textContent ?? "");
  expect(reopened).toBe(ACCEPTED);
  await expect(paragraph.locator("strong")).toHaveCount(0);
  await expect(editor.locator(".suggestion-insert")).toHaveCount(0);
  await expect(editor.locator(".suggestion-delete")).toHaveCount(0);
  await expect(editor.locator(".suggestion-format")).toHaveCount(0);
  await expect(page.locator(".suggestion-card")).toHaveCount(0);
  await expect(editor).not.toContainText("very");
  await beat(page, 600);
});
