import { createFile, serializeFile, type DocFile } from "@suiteleaf/core";
import type { Page } from "@playwright/test";
import { grammarEssayContent } from "../../apps/web/src/editors/grammar-essay";
import { beat, caption, expect, test, typeSlowly } from "./harness";

const editorOf = (page: Page) => page.getByRole("textbox", { name: "Document content" });

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

async function clickAfter(page: Page, text: string) {
  const point = await page.locator(".document-content").evaluate((root, value) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    let found: { x: number; y: number } | null = null;
    while ((node = walker.nextNode())) {
      const content = node.textContent ?? "";
      const at = content.lastIndexOf(value);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at + value.length);
      range.setEnd(node, at + value.length);
      const rect = range.getBoundingClientRect();
      const stage = root.closest(".document-stage");
      const bounds = stage?.getBoundingClientRect();
      const visible =
        rect.height > 0 &&
        (!bounds || (rect.top >= bounds.top && rect.bottom <= bounds.bottom));
      if (visible) found = { x: rect.x + 1, y: rect.y + Math.max(rect.height, 8) / 2 };
    }
    return found;
  }, text);
  if (!point) throw new Error(`Could not click after “${text}”`);
  await page.mouse.click(point.x, point.y);
  await page.locator(".document-content").evaluate((root, value) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const content = node.textContent ?? "";
      const at = content.lastIndexOf(value);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at + value.length);
      range.collapse(true);
      const selection = root.ownerDocument.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      if (root instanceof HTMLElement) root.focus();
      return;
    }
  }, text);
}

test("45-check-grammar-on-the-device", async ({ page }) => {
  const leaks: string[] = [];
  page.on("request", (request) => {
    const body = `${request.url()}\n${request.postData() ?? ""}`;
    if (/movment|Danquah|movement were|its the reason|they was/i.test(body)) leaks.push(request.url());
  });
  await seedEssay(page);
  await caption(page, "Amara opens the essay. The word count is still here, on this computer.");
  await page.getByRole("link", { name: "Independence essay" }).click();
  await expect(editorOf(page)).toContainText("the movement were");
  await expect(page.locator(".word-count")).toHaveText("1,488 words (excludes References)");
  const lead = page.locator(".grammar-issue", { hasText: /^were$/ });
  await lead.scrollIntoViewIfNeeded();
  await expect(page.locator(".spelling-misspelling", { hasText: "movment" })).toBeVisible();
  await expect(page.locator(".grammar-issue", { hasText: /^its$/ })).toBeVisible();
  await expect(page.locator(".grammar-issue", { hasText: /^was$/ })).toBeVisible();
  await beat(page, 1400);

  await caption(page, "She right-clicks “were”. “was” is first. One click fixes that word, and the bold stays.");
  await lead.click({ button: "right" });
  const wereMenu = page.getByRole("menu", { name: "Grammar for were" });
  await expect(wereMenu.getByRole("menuitem").first()).toHaveText("was");
  await expect(wereMenu.getByRole("menuitem", { name: "Ignore" })).toBeVisible();
  await beat(page, 1200);
  await wereMenu.getByRole("menuitem", { name: "was", exact: true }).click();
  await expect(editorOf(page)).toContainText("the movement was");
  await expect(page.locator(".document-content strong")).toHaveText("movement");
  await expect(page.locator(".document-content em")).toHaveText("strong");
  await beat(page, 1000);

  await caption(page, "“its the reason” becomes “it's the reason”.");
  await page.locator(".grammar-issue", { hasText: /^its$/ }).click({ button: "right" });
  const itsMenu = page.getByRole("menu", { name: "Grammar for its" });
  await expect(itsMenu.getByRole("menuitem").first()).toHaveText("it's");
  await beat(page, 900);
  await itsMenu.getByRole("menuitem", { name: "it's", exact: true }).click();
  await expect(editorOf(page)).toContainText("it's the reason");
  await expect(page.locator(".document-content a")).toHaveText("Ghana");
  await beat(page, 900);

  await caption(page, "Danquah is a name. The red line is spelling. Grammar leaves it alone.");
  const name = page.locator(".spelling-misspelling", { hasText: "Danquah" });
  await name.scrollIntoViewIfNeeded();
  await expect(name).toHaveCount(1);
  await expect(page.locator(".grammar-issue", { hasText: "Danquah" })).toHaveCount(0);
  await beat(page, 1400);

  await caption(page, "Grammar steps through grammar only. Enter fixes “they was”. Spelling still has “movment”.");
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await beat(page, 400);
  await page.getByRole("menuitem", { name: "Grammar", exact: true }).click();
  const grammar = page.getByRole("dialog", { name: "Grammar" });
  await expect(grammar).toContainText("1 of 1 · was → were");
  await expect(grammar).not.toContainText("movment");
  await beat(page, 1600);
  await page.keyboard.press("Enter");
  await expect(editorOf(page)).toContainText("they were ready");
  await expect(page.locator(".document-content strong")).toHaveText("movement");
  await beat(page, 1000);
  await grammar.getByRole("button", { name: "Done" }).click();

  await caption(page, "Tools › Spelling still lists “movment”. Grammar is not in this list.");
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await beat(page, 400);
  await page.getByRole("menuitem", { name: "Spelling", exact: true }).click();
  const spelling = page.getByRole("dialog", { name: "Spelling" });
  await expect(spelling).toContainText("movment");
  await expect(spelling).not.toContainText("was →");
  await beat(page, 1400);
  await spelling.getByRole("button", { name: "Close spelling" }).click();

  await caption(page, "She ignores a second “they was”, brings it back, and fixes it.");
  await page.locator(".document-content em").scrollIntoViewIfNeeded();
  await clickAfter(page, "ready.");
  await typeSlowly(page, " They was late.", 55);
  const second = page.locator(".grammar-issue", { hasText: /^was$/ });
  await expect(second).toBeVisible();
  await beat(page, 700);
  await second.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Ignore" }).click();
  await expect(second).toHaveCount(0);
  await beat(page, 600);
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await beat(page, 400);
  await page.getByRole("menuitem", { name: "Ignored grammar" }).click();
  const ignored = page.getByRole("dialog", { name: "Ignored grammar" });
  await expect(ignored).toContainText("they was → were");
  await beat(page, 1200);
  await ignored.getByRole("button", { name: "Remove" }).click();
  await expect(page.locator(".grammar-issue", { hasText: /^was$/ })).toBeVisible();
  await beat(page, 900);
  await ignored.getByRole("button", { name: "Done" }).click();
  await page.locator(".grammar-issue", { hasText: /^was$/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "were", exact: true }).click();
  await expect(editorOf(page)).toContainText("They were late");
  await beat(page, 800);

  await caption(page, "The network is off. Grammar still underlines “they was”. The essay stays here.");
  await page.context().setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await clickAfter(page, "late.");
  await typeSlowly(page, " They was next.", 55);
  await expect(page.locator(".grammar-issue", { hasText: /^was$/ })).toBeVisible();
  await expect(page.locator(".spelling-misspelling", { hasText: "movment" })).toBeVisible();
  await expect(page.locator(".document-content strong")).toHaveText("movement");
  await expect(page.locator(".word-count")).toHaveText("1,494 words (excludes References)");
  expect(leaks).toEqual([]);
  await beat(page, 1600);
});
