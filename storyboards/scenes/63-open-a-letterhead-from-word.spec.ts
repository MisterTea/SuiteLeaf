import type { Locator, Page } from "@playwright/test";
import { councilMinutesDocx } from "../../tests/word-letterhead-fixture";
import { beat, caption, expect, test } from "./harness";

const editorOf = (page: Page) =>
  page.getByRole("textbox", { name: "Document content" });

/** Bring a page's top margin, where the header sits, into the document stage. */
async function showPage(page: Page, index: number) {
  await page
    .locator(".page-furniture-page")
    .nth(index)
    .evaluate((el) => {
      const stage = el.closest(".document-stage");
      if (!(stage instanceof HTMLElement)) return;
      const top =
        stage.scrollTop +
        el.getBoundingClientRect().top -
        stage.getBoundingClientRect().top -
        12;
      stage.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    });
  await beat(page, 900);
}

async function pointAt(page: Page, target: Locator) {
  const box = await target.boundingBox();
  if (!box) return;
  await page.mouse.move(
    box.x + Math.min(box.width / 2, 72),
    box.y + box.height / 2,
    { steps: 12 },
  );
}

test("63-open-a-letterhead-from-word", async ({ page }) => {
  await page.goto("/");
  await caption(
    page,
    "Ben receives the town council minutes as a Word file. Page 1 is their letterhead.",
    1800,
  );
  await caption(page, "He uses Open / import and chooses council-minutes.docx.", 1100);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (
    await chooser
  ).setFiles({
    name: "council-minutes.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(await councilMinutesDocx()),
  });

  const editor = editorOf(page);
  await expect(editor.locator("h1").first()).toContainText("October minutes");
  await expect(page.locator(".editor-status")).toContainText("3 pages");
  const faces = page.locator(".page-furniture-page");
  await expect(faces).toHaveCount(3);
  await expect(editor).toContainText("The council agreed the budget");
  await expect(editor).not.toContainText("Town Council");

  const notes = page.locator(".import-notes");
  await expect(notes.locator("summary")).toContainText("council-minutes.docx");
  await expect(notes).not.toContainText(
    /flatten|merged|header\/footer text is retained/i,
  );
  await caption(
    page,
    "The compatibility note does not say the headers were flattened.",
    1200,
  );
  await notes.locator("summary").click();
  const noteText = (await notes.locator("li").allTextContents()).join("\n");
  expect(noteText.length).toBeGreaterThan(0);
  expect(noteText).not.toMatch(/header|footer|flatten|merged/i);
  await beat(page, 1800);
  await notes.locator("summary").click();

  const page1 = faces.nth(0);
  await showPage(page, 0);
  await expect(page1).toHaveAttribute("data-letterhead", "true");
  await expect(page1).toHaveAttribute("data-number-side", "none");
  await expect(page1.locator(".page-header-text")).toHaveText("Town Council");
  await expect(page1.locator(".page-number")).toHaveCount(0);
  await pointAt(page, page1.locator(".page-header-text"));
  await caption(
    page,
    "Page 1 shows the letterhead, Town Council, and no page number.",
    2400,
  );

  const page2 = faces.nth(1);
  await showPage(page, 1);
  await expect(page2).toHaveAttribute("data-header-align", "left");
  await expect(page2).toHaveAttribute("data-number-side", "left");
  await expect(page2.locator(".page-header-text")).toHaveText("Minutes");
  await expect(page2.locator(".page-number")).toHaveText("2 / 3");
  await pointAt(page, page2.locator(".page-header"));
  await caption(
    page,
    "The back of the sheet: Minutes on the left, and the number on the left.",
    2400,
  );

  const page3 = faces.nth(2);
  await showPage(page, 2);
  await expect(page3).toHaveAttribute("data-header-align", "right");
  await expect(page3).toHaveAttribute("data-number-side", "right");
  await expect(page3.locator(".page-header-text")).toHaveText("Council");
  await expect(page3.locator(".page-number")).toHaveText("3 / 3");
  await pointAt(page, page3.locator(".page-header"));
  await caption(
    page,
    "The next face: Council on the right, and the number on the right.",
    2400,
  );

  await caption(page, "File, Page setup already matches the Word file.", 1000);
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 450);
  await page.getByRole("menuitem", { name: "Page setup…", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Page setup" });
  const firstPage = setup.getByRole("checkbox", { name: "Different first page" });
  const oddEven = setup.getByRole("checkbox", {
    name: "Different odd and even pages",
  });
  await expect(firstPage).toBeChecked();
  await expect(oddEven).toBeChecked();
  const firstHeader = setup.getByLabel("First page header");
  const evenHeader = setup.getByLabel("Even page header");
  const oddHeader = setup.getByLabel("Odd page header");
  await expect(firstHeader).toHaveValue("Town Council");
  await expect(evenHeader).toHaveValue("Minutes");
  await expect(oddHeader).toHaveValue("Council");
  await oddHeader.scrollIntoViewIfNeeded();
  await pointAt(page, firstHeader);
  await caption(
    page,
    "Different first page and different odd and even pages are both ticked. The three headers match.",
    2800,
  );
  await setup.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(setup).toBeHidden();

  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await caption(page, "He reopens the SuiteLeaf file.", 900);
  await page.getByRole("link", { name: "council-minutes", exact: true }).click();
  await expect(editorOf(page).locator("h1").first()).toContainText(
    "October minutes",
  );
  const reopened = page.locator(".page-furniture-page");
  await expect(reopened).toHaveCount(3);
  await expect(reopened.nth(0).locator(".page-header-text")).toHaveText(
    "Town Council",
  );
  await expect(reopened.nth(0).locator(".page-number")).toHaveCount(0);
  await expect(reopened.nth(1).locator(".page-header-text")).toHaveText(
    "Minutes",
  );
  await expect(reopened.nth(1).locator(".page-number")).toHaveText("2 / 3");
  await expect(reopened.nth(2).locator(".page-header-text")).toHaveText(
    "Council",
  );
  await expect(reopened.nth(2).locator(".page-number")).toHaveText("3 / 3");
  await showPage(page, 0);
  await pointAt(page, reopened.nth(0).locator(".page-header-text"));
  await caption(
    page,
    "The letterhead, Minutes, and Council are unchanged.",
    2400,
  );
});
