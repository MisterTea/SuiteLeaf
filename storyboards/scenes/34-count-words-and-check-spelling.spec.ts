import { createFile, serializeFile, type DocFile } from "@suiteleaf/core";
import type { Page } from "@playwright/test";
import { independenceEssayContent } from "../../apps/web/src/editors/independence-essay";
import { beat, caption, expect, test, typeSlowly } from "./harness";

const editorOf = (page: Page) => page.getByRole("textbox", { name: "Document content" });

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

async function wordPoint(page: Page, word: string, edge: "center" | "end" = "center") {
  const point = await page.locator(".document-content").evaluate(
    (root, value) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      let found: { x: number; y: number } | null = null;
      while ((node = walker.nextNode())) {
        const text = node.textContent ?? "";
        let from = 0;
        while (from < text.length) {
          const at = text.indexOf(value.word, from);
          if (at < 0) break;
          const before = at > 0 ? text[at - 1] : "";
          const after = text[at + value.word.length] ?? "";
          if (!/[A-Za-z]/.test(before) && !/[A-Za-z]/.test(after)) {
            const range = document.createRange();
            range.setStart(node, at);
            range.setEnd(node, at + value.word.length);
            const rect = range.getBoundingClientRect();
            const stage = root.closest(".document-stage");
            const bounds = stage?.getBoundingClientRect();
            const visible =
              rect.width > 0 &&
              rect.height > 0 &&
              (!bounds ||
                (rect.top >= bounds.top &&
                  rect.bottom <= bounds.bottom &&
                  rect.left >= bounds.left &&
                  rect.right <= bounds.right));
            if (visible) {
              found = {
                x: value.edge === "end" ? rect.right + 4 : rect.x + rect.width / 2,
                y: rect.y + rect.height / 2,
              };
              if (value.which !== "last") return found;
            }
          }
          from = at + value.word.length;
        }
      }
      return found;
    },
    { word, edge, which: "first" as "first" | "last" },
  );
  if (!point) throw new Error(`Could not see “${word}”`);
  return point;
}

test("34-count-words-and-check-spelling", async ({ page }) => {
  await seedEssay(page);
  await caption(page, "Amara opens her history essay. The word count is already on.");
  await page.getByRole("link", { name: "Independence essay" }).click();
  await expect(editorOf(page)).toContainText("Introduction");
  await expect(page.locator(".word-count")).toHaveText("1,612 words");
  await beat(page, 1200);

  await caption(page, "She selects the introduction. The status bar counts just that, with no dialog.");
  const introHeading = page.locator("h1", { hasText: "Introduction" });
  await introHeading.scrollIntoViewIfNeeded();
  await introHeading.click({ position: { x: 12, y: 12 } });
  const introClose = page.getByText("this ends the introduction");
  await introClose.evaluate((el) => el.scrollIntoView({ block: "center", inline: "nearest" }));
  await beat(page, 400);
  const introEnd = await wordPoint(page, "introduction");
  await page.keyboard.down("Shift");
  await page.mouse.click(introEnd.x, introEnd.y);
  await page.keyboard.up("Shift");
  await expect(page.locator(".word-count")).toHaveText("318 of 1,612 words", { timeout: 2000 });
  await beat(page, 1400);

  await caption(page, "Tools › Word count lists words, characters, paragraphs, and pages.");
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await beat(page, 400);
  await page.getByRole("menuitem", { name: /Word count/ }).click();
  const wordCount = page.getByRole("dialog", { name: "Word count" });
  await expect(wordCount).toBeVisible();
  await expect(wordCount.locator("tr", { hasText: "Words" }).locator("td").nth(0)).toHaveText("318");
  await expect(wordCount.locator("tr", { hasText: "Words" }).locator("td").nth(1)).toHaveText("1,612");
  await expect(wordCount.getByRole("checkbox", { name: "Count footnotes" })).not.toBeChecked();
  await beat(page, 1600);

  await caption(page, "She stops the count at References. Footnotes stay off. The total drops to 1,488.");
  await wordCount.getByLabel("Stop counting at heading").selectOption("References");
  await expect(wordCount.locator("tr", { hasText: "Words" }).locator("td").nth(1)).toHaveText("1,488");
  await beat(page, 1400);
  await wordCount.getByRole("button", { name: "Done" }).click();
  await page.locator(".document-content").click({ position: { x: 24, y: 24 } });
  await expect(page.locator(".word-count")).toHaveText("1,488 words (excludes References)");
  await beat(page, 800);

  await caption(page, "She closes the essay and opens it again. The exclusion is still there.");
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Independence essay" }).click();
  await expect(page.locator(".word-count")).toHaveText("1,488 words (excludes References)");
  await beat(page, 1200);

  await caption(page, "She types “movment”. It is underlined on this computer, with no round trip.");
  await page.getByText("the movement grew").scrollIntoViewIfNeeded();
  const movement = await wordPoint(page, "movement");
  await page.mouse.dblclick(movement.x, movement.y);
  await typeSlowly(page, "movment", 70);
  const mistake = page.locator(".spelling-misspelling", { hasText: "movment" });
  await expect(mistake).toBeVisible();
  await beat(page, 600);
  await mistake.click({ button: "right" });
  const spellingMenu = page.getByRole("menu", { name: /Spelling for movment/ });
  await expect(spellingMenu.getByRole("menuitem", { name: "movement", exact: true })).toBeVisible();
  await expect(spellingMenu.getByRole("menuitem", { name: "Add to dictionary" })).toBeVisible();
  await expect(spellingMenu.getByRole("menuitem", { name: "Ignore", exact: true })).toBeVisible();
  await beat(page, 900);
  await spellingMenu.getByRole("menuitem", { name: "movement", exact: true }).click();
  await expect(mistake).toHaveCount(0);
  await expect(page.getByText("the movement grew")).toBeVisible();
  await beat(page, 800);

  await caption(page, "Nkrumah is a name, not a typo. Adding it clears every underline at once.");
  const names = page.locator(".spelling-misspelling", { hasText: "Nkrumah" });
  await expect(names).toHaveCount(3);
  await names.first().scrollIntoViewIfNeeded();
  await names.first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add to dictionary" }).click();
  await expect(names).toHaveCount(0);
  await beat(page, 1000);

  await caption(page, "Spelling steps through the essay. Enter accepts the suggestion, and bold stays bold.");
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await beat(page, 400);
  await page.getByRole("menuitem", { name: "Spelling", exact: true }).click();
  const spelling = page.getByRole("dialog", { name: "Spelling" });
  await expect(spelling).toContainText("1 of 5 · seperate → separate");
  await expect(page.locator("strong")).toContainText("seperate");
  await beat(page, 900);
  await page.keyboard.press("Enter");
  await expect(spelling).toContainText("2 of 5 · recieve → receive");
  await expect(page.locator("strong")).toContainText("separate");
  await beat(page, 1600);
  await page.keyboard.press("Enter");
  await expect(spelling).toContainText("3 of 5 · occured → occurred");
  await page.keyboard.press("Enter");
  await expect(spelling).toContainText("4 of 5 · definately → definitely");
  await page.keyboard.press("Enter");
  await expect(spelling).toContainText("5 of 5 · teh → the");
  await beat(page, 700);
  await caption(page, "She adds “teh” by mistake, then takes it back.");
  await spelling.getByRole("button", { name: "Add to dictionary" }).click();
  await expect(spelling).toContainText("Spelling check finished");
  await spelling.getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await beat(page, 400);
  await page.getByRole("menuitem", { name: "Personal dictionary" }).click();
  const dictionary = page.getByRole("dialog", { name: "Personal dictionary" });
  await expect(dictionary.locator("li", { hasText: "Nkrumah" })).toBeVisible();
  await expect(dictionary.locator("li", { hasText: "teh" })).toBeVisible();
  await beat(page, 1200);
  await dictionary.locator("li", { hasText: "teh" }).getByRole("button", { name: "Remove" }).click();
  await dictionary.getByRole("button", { name: "Done" }).click();
  const teh = page.locator(".spelling-misspelling", { hasText: "teh" });
  await teh.scrollIntoViewIfNeeded();
  await expect(teh).toBeVisible();
  await beat(page, 700);
  await teh.click({ button: "right" });
  await page.getByRole("menuitem", { name: "the", exact: true }).click();
  await expect(page.locator(".spelling-misspelling")).toHaveCount(0);
  await expect(page.locator(".word-count")).toHaveText("1,488 words (excludes References)");
  await caption(
    page,
    "No unknown words left. Nkrumah stays in her dictionary. Nothing was sent off this computer.",
    2200,
  );
});
