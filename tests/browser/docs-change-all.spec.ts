import { test, expect, type Page } from "@playwright/test";
import { createFile, serializeFile, type DocFile, type JsonNode } from "@suiteleaf/core";

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

async function seed(page: Page, file: ReturnType<typeof launchNotes>) {
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
  await page.getByRole("link", { name: file.title }).click();
  await expect(editorOf(page)).toContainText("signed form");
}

const typos = (page: Page) => page.locator(".spelling-misspelling", { hasText: "recieve" });

test("change all lists every copy, cancels, and undoes in one step", async ({ page }) => {
  await seed(page, launchNotes());
  const editor = editorOf(page);
  await expect(typos(page)).toHaveCount(4);
  await expect(page.locator(".spelling-misspelling", { hasText: "seperate" })).toHaveCount(1);
  await expect(editor.locator("strong")).toHaveText("recieve");

  await typos(page).first().click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Spelling for recieve" });
  await expect(menu.getByRole("menuitem", { name: "receive", exact: true })).toBeVisible();
  await menu.getByRole("menuitem", { name: "Change all to receive" }).click();
  const preview = page.getByRole("dialog", { name: "Change every copy?" });
  await expect(preview).toContainText("4 copies of “recieve”");
  await expect(preview.locator("mark")).toHaveCount(4);
  await expect(preview).not.toContainText("seperate");
  await preview.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(typos(page)).toHaveCount(4);

  await typos(page).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Change all to receive" }).click();
  await page.getByRole("button", { name: "Change 4 copies" }).click();
  await expect(typos(page)).toHaveCount(0);
  await expect(editor.locator("strong")).toHaveText("receive");
  await expect(page.locator(".spelling-misspelling", { hasText: "seperate" })).toHaveCount(1);

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(typos(page)).toHaveCount(4);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(typos(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(typos(page)).toHaveCount(4);

  await typos(page).nth(3).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Ignore this one" }).click();
  await expect(typos(page)).toHaveCount(3);
  await expect(editor).toContainText("Then recieve the signed form");

  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByRole("menuitem", { name: "Spelling", exact: true }).click();
  const spelling = page.getByRole("dialog", { name: "Spelling" });
  await expect(spelling.getByRole("button", { name: "Change all", exact: true })).toBeVisible();
  await spelling.getByRole("button", { name: "Change all", exact: true }).click();
  const again = page.getByRole("dialog", { name: "Change every copy?" });
  await expect(again).toContainText("3 copies of “recieve”");
  await expect(again).not.toContainText("seperate");
  await expect(again).not.toContainText("signed form");
  await again.getByRole("button", { name: "Change 3 copies" }).click();
  await expect(typos(page)).toHaveCount(0);
  await expect(editor).toContainText("Then recieve the signed form");
  await expect(editor.locator("strong")).toHaveText("receive");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(typos(page)).toHaveCount(3);
  await page.getByRole("button", { name: "Redo", exact: true }).click();

  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save now" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Launch notes" }).click();
  await expect(editor).toContainText("We will receive the keys");
  await expect(editor).toContainText("Then recieve the signed form");
  await expect(typos(page)).toHaveCount(0);
  await expect(page.locator(".spelling-misspelling", { hasText: "seperate" })).toHaveCount(1);
  await expect(editor.locator("strong")).toHaveText("receive");
});

test("find and replace still replaces every match in one undo", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  const editor = editorOf(page);
  await editor.click();
  await page.keyboard.type("alpha recieve recieve");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("menuitem", { name: /Find and replace/ }).click();
  const find = page.getByRole("search", { name: "Find and replace" });
  await find.getByLabel("Find text").fill("recieve");
  await find.getByLabel("Replacement text").fill("receive");
  await find.getByRole("button", { name: "Replace all", exact: true }).click();
  await expect(editor).toContainText("alpha receive receive");
  await expect(editor).not.toContainText("recieve");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(editor).toContainText("alpha recieve recieve");
});
