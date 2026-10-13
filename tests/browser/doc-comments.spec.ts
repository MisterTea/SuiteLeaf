import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const mod = process.platform === "darwin" ? "Meta" : "Control";

/** Place the selection in the document model. Pixel drags miss under Fit zoom. */
async function selectPhrase(page: Page, phrase: string) {
  const editor = page.getByRole("textbox", { name: "Document content" });
  const placed = await editor.evaluate((el: any, phrase: string) => {
    const doc = el.editor.state.doc;
    let from = -1;
    let to = -1;
    doc.descendants((node: { isText?: boolean; text?: string }, pos: number) => {
      if (from >= 0 || !node.isText || !node.text) return;
      const at = node.text.indexOf(phrase);
      if (at >= 0) {
        from = pos + at;
        to = pos + at + phrase.length;
      }
    });
    if (from < 0) return false;
    el.editor.chain().focus().setTextSelection({ from, to }).run();
    return true;
  }, phrase);
  expect(placed, phrase).toBe(true);
}

async function caret(page: Page, phrase: string, offset: number) {
  const editor = page.getByRole("textbox", { name: "Document content" });
  const placed = await editor.evaluate(
    (el: any, { phrase, offset }: { phrase: string; offset: number }) => {
      const doc = el.editor.state.doc;
      let at = -1;
      doc.descendants((node: { isText?: boolean; text?: string }, pos: number) => {
        if (at >= 0 || !node.isText || !node.text) return;
        const index = node.text.indexOf(phrase);
        if (index >= 0) at = pos + index + offset;
      });
      if (at < 0) return false;
      el.editor.chain().focus().setTextSelection(at).run();
      return true;
    },
    { phrase, offset },
  );
  expect(placed, phrase).toBe(true);
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
  // Fit zoom puts the highlight outside the viewport box Playwright can click.
  // Select each anchor in the document and delete it, as Backspace would.
  const deleteAnchor = async () => {
    const editor = page.getByRole("textbox", { name: "Document content" });
    await editor.evaluate((el: any) => {
      const doc = el.editor.state.doc;
      let from = -1;
      let to = -1;
      doc.descendants((node: any, pos: number) => {
        if (from >= 0 || !node.isText) return;
        if (!node.marks?.some((mark: any) => mark.type.name === "comment")) return;
        from = pos;
        to = pos + node.nodeSize;
      });
      if (from < 0) throw new Error("no comment anchor");
      el.editor.chain().focus().setTextSelection({ from, to }).run();
    });
    await page.keyboard.press("Backspace");
  };
  await deleteAnchor();
  await deleteAnchor();
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
