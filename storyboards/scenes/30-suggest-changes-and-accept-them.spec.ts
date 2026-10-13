import type { Download, Page } from "@playwright/test";
import JSZip from "jszip";
import { readFileSync } from "node:fs";
import { beat, caption, expect, test, typeSlowly } from "./harness";

const editorOf = (page: Page) => page.getByRole("textbox", { name: "Document content" });

async function placeSelection(page: Page, text: string, caret = false) {
  await editorOf(page).click();
  const found = await page.evaluate(
    ({ text, caret }) => {
      const root = document.querySelector(".document-content");
      if (!(root instanceof HTMLElement)) return false;
      root.focus();
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const value = node.textContent ?? "";
        const index = value.indexOf(text);
        if (index < 0) continue;
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, caret ? index : index + text.length);
        const selection = getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        return true;
      }
      return false;
    },
    { text, caret },
  );
  expect(found).toBe(true);
  await beat(page, 400);
}

async function fileMenu(page: Page, item: string) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 400);
  await page.getByRole("menuitem", { name: item, exact: true }).click();
  return download;
}

async function savedBytes(download: Download) {
  return readFileSync((await download.path())!);
}

/** The manager, in Word, accepts the deletion and adds one tracked insertion. */
async function managerCopy(bytes: Buffer) {
  const zip = await JSZip.loadAsync(bytes);
  let xml = await zip.file("word/document.xml")!.async("string");
  xml = xml.replace(/<w:del\b[\s\S]*?<\/w:del>/g, "");
  const insertion =
    '<w:ins w:id="90" w:author="Alex\'s manager" w:date="2026-10-12T18:04:00Z"><w:r><w:t xml:space="preserve"> (unaudited)</w:t></w:r></w:ins>';
  xml = xml.replace(/(on budget[\s\S]*?<\/w:p>)/, (paragraph) =>
    paragraph.replace("</w:p>", `${insertion}</w:p>`),
  );
  zip.file("word/document.xml", xml);
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

test("30-suggest-changes-and-accept-them", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Jordan is editing Alex's Quarterly Report. The changes should stay proposals.");
  await page.getByRole("button", { name: "New document" }).click();
  await beat(page, 400);
  const title = page.getByLabel("File title");
  await title.click();
  await title.press("ControlOrMeta+A");
  await typeSlowly(page, "Quarterly Report");
  const editor = editorOf(page);
  await editor.click();
  await page.getByRole("combobox", { name: "Zoom" }).selectOption("Fit");
  await caption(page, "The report opens in Editing. The mode switch stays at the right of the toolbar.", 1200);
  await typeSlowly(page, "Quarterly Report");
  await page.getByRole("combobox", { name: "Paragraph style" }).selectOption({ label: "Heading 1" });
  await page.keyboard.press("Enter");
  await typeSlowly(page, "We now serve very 40 customers and the project is on budget.");
  await beat(page, 500);
  await expect(page.getByRole("button", { name: "Editing", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await caption(page, "Suggestions are signed with Jordan's name. One click turns Suggesting on.", 1200);
  await page.getByLabel("Your name").fill("Jordan");
  await beat(page, 300);
  await page.getByRole("button", { name: "Suggesting", exact: true }).click();
  await expect(page.locator(".mode-switch.suggesting")).toBeVisible();
  await expect(page.locator(".suggesting-flag")).toBeVisible();
  await page.locator(".document-stage").evaluate((el) => el.scrollTo({ top: 240, behavior: "smooth" }));
  await beat(page, 700);
  await expect(page.locator(".suggesting-flag")).toBeVisible();
  await page.locator(".document-stage").evaluate((el) => el.scrollTo({ top: 0, behavior: "smooth" }));
  await beat(page, 500);

  await caption(page, "Jordan suggests “approximately” before 40. The new words are green and underlined.", 1000);
  await placeSelection(page, "40", true);
  await typeSlowly(page, "approximately ");
  await beat(page, 400);
  await expect(page.locator(".suggestion-insert")).toHaveText("approximately ");

  await caption(page, "Deleting “very” leaves it struck through in red, so Alex can still read it.", 1000);
  await placeSelection(page, "very ");
  await page.keyboard.press("Backspace");
  await beat(page, 500);
  await expect(page.locator(".suggestion-delete")).toHaveText("very ");

  await caption(page, "Bold is a suggestion too: “on budget” stays readable, with a dotted underline.", 1000);
  await placeSelection(page, "on budget");
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await beat(page, 600);
  await expect(page.locator(".suggestion-card")).toHaveCount(3);
  await expect(page.getByRole("button", { name: /Accept Add/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Accept Delete/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Accept Format/ })).toBeVisible();

  await caption(page, "Close the report and open it again. The three suggestions are still Jordan's.", 1200);
  await expect(page.locator(".save-status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await beat(page, 600);
  await page.getByRole("link", { name: "Quarterly Report", exact: true }).click();
  await expect(editorOf(page)).toContainText("approximately");
  await expect(page.locator(".suggestion-card")).toHaveCount(3);
  await expect(page.locator(".suggesting-flag")).toBeVisible();
  await beat(page, 800);

  await caption(
    page,
    "Exporting plain text asks which version to use. Nothing is chosen silently.",
    1200,
  );
  const textDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 300);
  await page.getByRole("menuitem", { name: "Export TXT", exact: true }).click();
  const pending = page.getByRole("dialog", { name: "Pending suggestions" });
  await expect(pending).toBeVisible();
  await beat(page, 1200);
  await pending.getByRole("button", { name: "Suggestions accepted" }).click();
  await textDownload;

  await caption(page, "File, Export DOCX. Word can open every pending change as a tracked change.", 1100);
  const docx = await fileMenu(page, "Export DOCX");
  const original = await savedBytes(await docx);
  const xml = await JSZip.loadAsync(original).then((zip) =>
    zip.file("word/document.xml")!.async("string"),
  );
  expect(xml).toContain("<w:ins ");
  expect(xml).toContain("<w:del ");
  expect(xml).toContain("<w:rPrChange ");
  expect(xml).toContain('w:author="Jordan"');
  await beat(page, 600);

  await caption(
    page,
    "In Word, Alex's manager accepts the deletion and suggests “(unaudited)”. The file comes back.",
    1600,
  );
  await page.getByRole("button", { name: "Back to files" }).click();
  await beat(page, 500);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (await chooser).setFiles({
    name: "Quarterly Report reviewed.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: await managerCopy(original),
  });
  await expect(page.locator(".import-notes")).toContainText("3 suggestions imported");
  await expect(page.locator(".suggestion-card")).toHaveCount(3);
  await expect(page.getByText("Alex's manager").first()).toBeVisible();
  await beat(page, 900);

  await caption(page, "Alex opens Tools, Review suggestions. Three proposals are waiting.", 1000);
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await beat(page, 300);
  await page.getByRole("menuitem", { name: "Review suggestions" }).click();
  const review = page.getByRole("dialog", { name: "Review suggestions" });
  await expect(review).toContainText("3 suggestions");
  await beat(page, 1100);
  await review.getByRole("button", { name: "Close review" }).click();
  await beat(page, 300);

  await caption(page, "Accepting “approximately” is one click. Rejecting the bold is one click.", 1000);
  await page.getByRole("button", { name: "Accept Add “approximately”" }).click();
  await beat(page, 600);
  await page.getByRole("button", { name: /Reject Format/ }).click();
  await beat(page, 700);
  await expect(page.locator(".suggestion-card")).toHaveCount(1);
  await expect(page.locator("strong")).toHaveCount(0);

  await caption(page, "Hover Accept all to preview the page with the markup hidden, then confirm.", 1000);
  const acceptAll = page.getByRole("button", { name: "Accept all" });
  await acceptAll.hover();
  await expect(page.locator(".suggestion-preview-banner")).toBeVisible();
  await beat(page, 1200);
  await acceptAll.click();
  await beat(page, 700);
  await expect(page.locator(".suggestion-card")).toHaveCount(0);
  await expect(editorOf(page)).toContainText("(unaudited)");

  await page.keyboard.press("ControlOrMeta+z");
  await beat(page, 500);
  await expect(page.locator(".suggestion-card")).toHaveCount(1);
  await caption(page, "Undo brings that accepted suggestion back. Alex accepts it again.", 1100);
  await page.getByRole("button", { name: "Accept Add “(unaudited)”" }).click();
  await beat(page, 600);
  await expect(page.locator(".suggestion-card")).toHaveCount(0);
  await expect(editorOf(page)).toContainText("approximately");
  await expect(editorOf(page)).not.toContainText("very");

  await caption(page, "Back to Editing. Reopening the file stays in Editing, which was the last mode used.", 1100);
  await page.getByRole("button", { name: "Editing", exact: true }).click();
  await expect(page.locator(".suggesting-flag")).toHaveCount(0);
  await expect(page.locator(".save-status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await beat(page, 500);
  await page.getByRole("link", { name: /Quarterly Report reviewed/ }).click();
  await expect(page.getByRole("button", { name: "Editing", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".suggestion-card")).toHaveCount(0);
  await expect(editorOf(page)).toContainText("approximately 40 customers");
  await expect(editorOf(page)).toContainText("(unaudited)");
  await caption(page, "The report has the accepted wording, and nothing the reviewers turned down.", 1800);
});
