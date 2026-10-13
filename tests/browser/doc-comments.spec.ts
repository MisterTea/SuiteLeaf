import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const mod = process.platform === "darwin" ? "Meta" : "Control";

async function phraseBox(page: Page, phrase: string, offset = 0, collapse = false) {
  const box = await page.locator(".document-content").evaluate(
    (root, { phrase, offset, collapse }) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = node.textContent ?? "";
        const start = text.indexOf(phrase);
        if (start < 0) continue;
        const range = document.createRange();
        range.setStart(node, start + offset);
        if (collapse) range.collapse(true);
        else range.setEnd(node, start + phrase.length);
        const end = document.createRange();
        end.setStart(node, start + (collapse ? offset : phrase.length));
        end.collapse(true);
        const startRect = range.getClientRects()[0];
        const endRect = end.getClientRects()[0];
        if (!startRect || !endRect) return null;
        return {
          x: startRect.x,
          y: startRect.y,
          width: Math.max(4, endRect.x - startRect.x),
          height: startRect.height,
          startX: startRect.x,
          endX: endRect.x,
          startW: startRect.width,
          endW: endRect.width,
          text,
        };
      }
      return null;
    },
    { phrase, offset, collapse },
  );
  expect(box, phrase).toBeTruthy();
  return box!;
}

async function selectPhrase(page: Page, phrase: string) {
  const box = await phraseBox(page, phrase);
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + Math.max(2, box.width - 1), box.y + box.height / 2, {
    steps: 6,
  });
  await page.mouse.up();
}

async function caret(page: Page, phrase: string, offset: number) {
  const box = await phraseBox(page, phrase, offset, true);
  await page.mouse.click(box.x + 1, box.y + box.height / 2);
}

test("document comments post from the keyboard and stay linked to the text", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.click();
  await page.keyboard.type("Revenue grew 12% in the quarter.");
  await selectPhrase(page, "grew 12%");
  await page.keyboard.press(`${mod}+Alt+KeyM`);
  const comment = page.getByRole("textbox", { name: "Comment" });
  await expect(comment).toBeFocused();
  await comment.fill("Is 12% right?");
  await page.keyboard.press(`${mod}+Enter`);
  const name = page.getByRole("textbox", { name: "Your name" });
  await expect(name).toBeFocused();
  await name.fill("Jordan");
  await page.keyboard.press(`${mod}+Enter`);
  await expect(page.locator(".comment-anchor")).toHaveText("grew 12%");
  await expect(page.locator(".doc-comment-card")).toContainText("Jordan");
  await expect(page.locator(".doc-comment-card")).toContainText("Is 12% right?");
  await expect(page.locator(".doc-comment-card")).not.toContainText("Owner");

  await page.waitForTimeout(600);
  await caret(page, "Revenue ", 8);
  await page.keyboard.type("X");
  await expect(page.locator(".comment-anchor")).toHaveText("grew 12%");
  await page.keyboard.press(`${mod}+z`);
  await caret(page, "grew 12%", 5);
  await page.keyboard.type("Y");
  await expect(page.locator(".comment-anchor")).toContainText("Y");
  await page.keyboard.press("Enter");
  await expect(page.locator(".comment-anchor")).toHaveCount(2);
  await page.locator(".comment-anchor").first().click({ clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.locator(".comment-anchor").click({ clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.getByRole("button", { name: "Comments", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Open" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".doc-comment-panel")).toContainText("Original text deleted");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const saved = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  expect(saved.content.attrs.commentThreads[0].messages[0].authorName).toBe("Jordan");
  expect(saved.content.attrs.commentThreads[0].orphaned).toBe(true);
  expect(saved.content.attrs.commentThreads[0].quote).toBe("grew 12%");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Untitled document" }).click();
  await page.getByRole("button", { name: "Comments", exact: true }).click();
  await expect(page.locator(".doc-comment-panel")).toContainText("Original text deleted");
  await expect(page.locator(".doc-comment-panel")).toContainText("Jordan");
});
