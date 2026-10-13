import { createFile, serializeFile, type DocFile, type JsonNode } from "@suiteleaf/core";
import type { Page } from "@playwright/test";
import { beat, caption, expect, test } from "./harness";

const editorOf = (page: Page) => page.getByRole("textbox", { name: "Document content" });

function launchNotes() {
  const file = createFile("doc", "Launch notes") as DocFile;
  const line = (text: string, boldAt?: string): JsonNode => {
    if (!boldAt) return { type: "paragraph", content: [{ type: "text", text }] };
    const at = text.indexOf(boldAt);
    return {
      type: "paragraph",
      content: [
        { type: "text", text: text.slice(0, at) },
        { type: "text", text: boldAt, marks: [{ type: "bold" }] },
        { type: "text", text: text.slice(at + boldAt.length) },
      ],
    };
  };
  file.content = {
    type: "doc",
    content: [
      line("We will recieve the keys on Monday.", "recieve"),
      line("The team will recieve a note."),
      line("Please recieve the guest at noon."),
      line("Ask them to seperate the name tags."),
      line("Then recieve the signed form."),
    ],
  };
  return file;
}

async function seed(page: Page) {
  const file = launchNotes();
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
  await page.getByRole("link", { name: "Launch notes" }).click();
  await expect(editorOf(page)).toContainText("signed form");
}

const typos = (page: Page) => page.locator(".document-content .spelling-misspelling", { hasText: "recieve" });

test("64-change-every-copy-of-a-typo", async ({ page }) => {
  await seed(page);
  await caption(page, "Sam's launch notes say “recieve” four times. One is bold. “seperate” stays.", 1600);
  await expect(typos(page)).toHaveCount(4);
  await caption(page, "The suggestion can fix every copy, not just this word.", 500);
  await typos(page).first().click({ button: "right" });
  await beat(page, 1400);
  const menu = page.getByRole("menu", { name: "Spelling for recieve" });
  await expect(menu.getByRole("menuitem", { name: "receive", exact: true })).toBeVisible();
  await menu.getByRole("menuitem", { name: "Change all to receive" }).click();
  const preview = page.getByRole("dialog", { name: "Change every copy?" });
  await expect(preview).toContainText("4 copies of “recieve”");
  await expect(preview.locator("mark")).toHaveCount(4);
  await caption(page, "Four copies are listed. “seperate” is not. Nothing has changed yet.", 2000);
  await preview.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(typos(page)).toHaveCount(4);
  await caption(page, "Cancel leaves the notes alone.", 1200);

  await typos(page).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Change all to receive" }).click();
  await beat(page, 500);
  await page.getByRole("button", { name: "Change 4 copies" }).click();
  await expect(typos(page)).toHaveCount(0);
  await expect(editorOf(page).locator("strong")).toHaveText("receive");
  await caption(page, "One confirm fixes every copy. The bold word is still bold.", 1600);

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(typos(page)).toHaveCount(4);
  await caption(page, "One Undo puts every copy back.", 1400);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(typos(page)).toHaveCount(0);
  await caption(page, "Redo fixes them again.", 1200);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(typos(page)).toHaveCount(4);
  await caption(page, "Back to the typos, so Sam can keep one on purpose.", 1400);

  await typos(page).nth(3).click({ button: "right" });
  await beat(page, 300);
  await page.getByRole("menuitem", { name: "Ignore this one" }).click();
  await expect(typos(page)).toHaveCount(3);
  await expect(editorOf(page)).toContainText("Then recieve the signed form");
  await caption(page, "Ignore this one leaves that copy and clears its underline.", 1600);

  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await beat(page, 300);
  await page.getByRole("menuitem", { name: "Spelling", exact: true }).click();
  const spelling = page.getByRole("dialog", { name: "Spelling" });
  await expect(spelling.getByRole("button", { name: "Change all", exact: true })).toBeVisible();
  await caption(page, "Tools › Spelling can change all of the rest.", 1400);
  await spelling.getByRole("button", { name: "Change all", exact: true }).click();
  const again = page.getByRole("dialog", { name: "Change every copy?" });
  await expect(again).toContainText("3 copies of “recieve”");
  await caption(page, "The ignored copy and “seperate” stay off the list.", 1800);
  await again.getByRole("button", { name: "Change 3 copies" }).click();
  await expect(typos(page)).toHaveCount(0);
  await expect(editorOf(page)).toContainText("Then recieve the signed form");
  await caption(page, "Three copies change. The one he ignored stays “recieve”.", 1600);

  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save now" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  await beat(page, 600);
  await page.getByRole("button", { name: "Back to files" }).click();
  await beat(page, 500);
  await page.getByRole("link", { name: "Launch notes" }).click();
  await expect(editorOf(page)).toContainText("We will receive the keys");
  await expect(editorOf(page)).toContainText("Then recieve the signed form");
  await expect(page.locator(".document-content .spelling-misspelling", { hasText: "seperate" })).toHaveCount(1);
  await caption(page, "Reopened: three corrections remain, and the ignored copy is still not underlined.", 2000);
});
