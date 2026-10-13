import type { Download, Page } from "@playwright/test";
import JSZip from "jszip";
import { readFileSync } from "node:fs";
import { beat, caption, expect, test, typeSlowly } from "./harness";

const editorOf = (page: Page) =>
  page.getByRole("textbox", { name: "Document content" });

async function newDocument(page: Page, title: string) {
  await page.getByRole("button", { name: "New document" }).click();
  const box = page.getByLabel("File title");
  await expect(box).toBeVisible();
  await box.click();
  await box.press("ControlOrMeta+A");
  await typeSlowly(page, title);
  const editor = editorOf(page);
  await editor.click();
  return editor;
}

async function styledLine(page: Page, text: string, style: string) {
  await typeSlowly(page, text);
  await page
    .getByRole("combobox", { name: "Paragraph style" })
    .selectOption({ label: style });
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+ArrowRight" : "End",
  );
  await page.keyboard.press("Enter");
}

async function fileMenu(page: Page, item: string) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 500);
  await page.getByRole("menuitem", { name: item, exact: true }).click();
  return download;
}

async function savedBytes(download: Download) {
  return readFileSync((await download.path())!);
}

/** Bring the watermark letters into the middle of the recording. */
async function showWord(page: Page, index: number) {
  await page
    .locator(".page-watermark span")
    .nth(index)
    .evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
  await beat(page, 800);
}

const pageOne = [
  "The committee met on Sunday 12 October in the potting shed. Present: Priya, Ruth, Marek and Asha. Apologies: Tom.",
  "Ruth reported that the rainwater tanks are in. The harvest supper is Saturday 7 November.",
  "Asha will book the village hall. Marek will print the plot map. Priya will write to members who missed the meeting.",
  "The tool library needs a new lock. The compost bay is full, so the next work party will turn it.",
  "Marek will seal the cracked pane in the greenhouse before the first frost.",
];

const pageTwo = [
  "The club agreed to keep the subscription at five pounds.",
  "The tool library opens on the first Saturday of each month.",
  "Next meeting: 2 November, 10 am, in the potting shed. Please bring spare seed packets.",
];

async function writeParagraphs(page: Page, paragraphs: string[]) {
  for (const text of paragraphs) {
    await page.keyboard.insertText(text);
    await page.keyboard.press("Enter");
  }
}

test("72-mark-a-draft", async ({ page }) => {
  await page.goto("/");
  await caption(
    page,
    "Priya's garden-club minutes are not ready to send.",
    1600,
  );
  const editor = await newDocument(page, "Garden club minutes");
  await styledLine(page, "Garden club minutes", "Heading 1");
  await writeParagraphs(page, pageOne);
  await page.getByRole("button", { name: "Page break", exact: true }).click();
  await expect(page.locator(".editor-status")).toContainText("2 pages");
  await styledLine(page, "Decisions", "Heading 1");
  await writeParagraphs(page, pageTwo);
  await expect(page.locator(".page-watermark")).toHaveCount(0);
  await page.locator(".document-stage").evaluate((el) => el.scrollTo({ top: 0 }));
  await beat(page, 600);
  await caption(page, "The pages have no word behind the text.", 1800);

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Page setup" });
  const numbers = setup.getByRole("checkbox", { name: "Page numbers" });
  const field = setup.getByLabel("Watermark");
  await expect(numbers).toBeVisible();
  await expect(field).toBeVisible();
  const numbersBox = (await numbers.boundingBox())!;
  const fieldBox = (await field.boundingBox())!;
  expect(fieldBox.x).toBeGreaterThan(numbersBox.x + 40);
  expect(Math.abs(fieldBox.y - numbersBox.y)).toBeLessThan(80);
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await caption(
    page,
    "In Page setup, beside page numbers, she types the word. No second dialog.",
    1600,
  );
  await field.click();
  await typeSlowly(page, "DRAFT", 80);
  await beat(page, 500);
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();

  const marks = page.locator(".page-watermark");
  await expect(marks).toHaveCount(2);
  await expect(marks).toHaveText(["DRAFT", "DRAFT"]);
  await expect(editor).not.toContainText("DRAFT");
  await showWord(page, 0);
  await caption(
    page,
    "DRAFT sits behind the text on page 1, large and faint. It is not part of the paragraph.",
    2400,
  );
  await showWord(page, 1);
  await caption(page, "Page 2 has the same word.", 2200);
  await caption(page, "Back on page 1, she adds a sentence.", 500);

  const markOnPage = () =>
    marks.first().locator("span").evaluate((el) => {
      const host = el.closest(".page-furniture-page")!.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      return { x: box.x - host.x, y: box.y - host.y };
    });
  const placed = await markOnPage();
  const line = editor.getByText("before the first frost.");
  await line.scrollIntoViewIfNeeded();
  await caption(
    page,
    "She adds to a sentence. The word stays put, and it is still not part of the paragraph.",
    500,
  );
  await line.click();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+ArrowRight" : "End",
  );
  await typeSlowly(page, " The vote was unanimous.", 50);
  await beat(page, 400);
  await expect(editor).toContainText("The vote was unanimous.");
  await expect(editor).not.toContainText("DRAFT");
  await expect(marks).toHaveText(["DRAFT", "DRAFT"]);
  const stayed = await markOnPage();
  expect(Math.abs(stayed.y - placed.y)).toBeLessThan(2);
  expect(Math.abs(stayed.x - placed.x)).toBeLessThan(2);
  await beat(page, 1400);

  await caption(page, "She changes the word to FINAL.", 700);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expect(field).toHaveValue("DRAFT");
  await field.click();
  await page.keyboard.press("ControlOrMeta+A");
  await typeSlowly(page, "FINAL", 80);
  await beat(page, 400);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(marks).toHaveText(["FINAL", "FINAL"]);
  await expect(page.locator(".page-watermark", { hasText: "DRAFT" })).toHaveCount(0);
  await showWord(page, 0);
  await caption(page, "Changing the word updates every page. DRAFT is gone.", 2000);
  await showWord(page, 1);
  await caption(page, "Page 2 says FINAL as well.", 2000);

  await caption(page, "She clears the field.", 500);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await field.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  await beat(page, 400);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".page-watermark")).toHaveCount(0);
  await expect(editor).toContainText("The vote was unanimous.");
  await expect(editor).toContainText("2 November");
  await page.locator(".document-stage").evaluate((el) =>
    el.scrollTo({ top: 0, behavior: "smooth" }),
  );
  await beat(page, 800);
  await caption(
    page,
    "The word is gone from the page. The paragraphs are unchanged.",
    2200,
  );

  await caption(page, "She puts DRAFT back.", 400);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await field.click();
  await typeSlowly(page, "DRAFT", 70);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(marks).toHaveText(["DRAFT", "DRAFT"]);
  await expect(page.getByRole("status")).toContainText("Saved");
  await showWord(page, 0);
  await caption(page, "SuiteLeaf saves DRAFT with the minutes.", 1800);

  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await beat(page, 600);
  await page.getByRole("link", { name: "Garden club minutes" }).click();
  await expect(editor.locator("h1").first()).toHaveText("Garden club minutes");
  await expect(page.locator(".page-watermark")).toHaveText(["DRAFT", "DRAFT"]);
  await expect(editor).toContainText("The vote was unanimous.");
  await showWord(page, 0);
  await caption(
    page,
    "Reopening the file brings the word back, still behind both pages.",
    2000,
  );

  await caption(page, "File, Export DOCX carries that watermark, not a typed paragraph.", 1200);
  const docx = await fileMenu(page, "Export DOCX");
  const zip = await JSZip.loadAsync(await savedBytes(docx));
  const header = await zip.file("word/header1.xml")!.async("string");
  const body = await zip.file("word/document.xml")!.async("string");
  expect(header).toContain("PowerPlusWaterMarkObject");
  expect(header).toContain('string="DRAFT"');
  expect(body).toContain("The vote was unanimous.");
  expect(body).not.toContain("DRAFT");
  await caption(
    page,
    "The Word file has the same watermark. The minutes themselves do not say DRAFT.",
    2200,
  );
});
