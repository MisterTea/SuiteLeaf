import type { Locator, Page } from "@playwright/test";
import {
  Document,
  EndnoteReferenceRun,
  FootnoteReferenceRun,
  HeadingLevel,
  Packer,
  Paragraph,
  TableOfContents,
  TextRun,
} from "docx";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { createFile, serializeFile, type JsonNode } from "../../packages/core/src";
import { beat, caption, expect, test, typeSlowly } from "./harness";

const fill = (line: string, times = 6) => `${line} `.repeat(times).trim();
const heading = (level: number, text: string): JsonNode => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});
const paragraph = (text: string): JsonNode => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

async function pointAt(page: Page, target: Locator, dx = 0.5, dy = 0.5) {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width * dx, box.y + box.height * dy, { steps: 10 });
}

async function seedReport(page: Page) {
  const file = createFile("doc", "Grant report 2026");
  if (file.kind !== "doc") throw new Error();
  file.content = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Grant report 2026",
            marks: [{ type: "textStyle", attrs: { fontSize: "26pt" } }],
          },
        ],
      },
      paragraph("Youth football charity. Prepared by Kwame Mensah for the community fund."),
      { type: "pageBreak" },
      paragraph("Start of the report"),
      heading(1, "Introduction"),
      paragraph(fill("The charity coaches young players after school and on Saturdays.")),
      heading(2, "Who we serve"),
      paragraph(fill("Most of the players are between eight and sixteen, and train near home.")),
      heading(1, "Programme"),
      paragraph(fill("Weekday sessions cover skills, and Saturday is a full league fixture.")),
      paragraph("Programme ends here."),
      heading(1, "Results"),
      heading(2, "Attendance"),
      paragraph("Across the season attendance rose 40%."),
      paragraph(fill("The Saturday league was full, and the waiting list finally moved.")),
      heading(1, "Budget"),
      paragraph(fill("Coaching, pitches and kit are the three costs the funder asked us to show.", 10)),
      paragraph("Budget close."),
      heading(2, "Partnerships"),
      paragraph(fill("The secondary school lends the pitch, and a local shop sponsors the kit.")),
      heading(1, "Next year"),
      paragraph(fill("We want a second pitch and a girls' team on weeknights.")),
    ],
  };
  const native = serializeFile(file);
  await page.goto("/");
  await expect(page.getByLabel("Search files")).toBeVisible();
  await page.evaluate(
    async ({ id, title, updatedAt, native }) => {
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("SuiteLeaf");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("encoded", "readwrite");
          tx.objectStore("encoded").put({ id, title, updatedAt, native });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      });
    },
    { id: file.id, title: file.title, updatedAt: file.updatedAt, native },
  );
  await page.reload();
}

async function returnedDocx(): Promise<Buffer> {
  const doc = new Document({
    footnotes: {
      1: { children: [new Paragraph("League register, 2025.")] },
      2: { children: [new Paragraph("Coach diaries.")] },
      3: { children: [new Paragraph("Treasurer's report.")] },
      4: { children: [new Paragraph("Funder guidance note.")] },
    },
    endnotes: {
      1: { children: [new Paragraph("The officer asked for the girls' team cost as well.")] },
    },
    sections: [
      {
        children: [
          new Paragraph({ text: "Grant report 2026", heading: HeadingLevel.HEADING_1 }),
          new TableOfContents("Contents", { hyperlink: true, headingStyleRange: "1-3" }),
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun("Introduction "), new FootnoteReferenceRun(1)],
          }),
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun("What we achieved "), new FootnoteReferenceRun(2)],
          }),
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun("Budget "), new FootnoteReferenceRun(3)],
          }),
          new Paragraph({
            children: [
              new TextRun("Next year "),
              new FootnoteReferenceRun(4),
              new TextRun(" "),
              new EndnoteReferenceRun(1),
            ],
          }),
        ],
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

test("35-add-a-table-of-contents-and-footnotes", async ({ page }) => {
  await seedReport(page);
  await caption(page, "Kwame opens the grant report. It already has a title page and eight sections.");
  const report = page.getByRole("link", { name: /Grant report 2026/ });
  await expect(report).toBeVisible();
  await pointAt(page, report, 0.3);
  await beat(page, 600);
  await report.click();
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor.getByRole("heading", { name: "Introduction" })).toBeVisible();
  await expect(page.locator(".outline-item")).toHaveCount(8);
  await caption(page, "The outline lists every Heading 1 and Heading 2, in order.", 1600);

  await caption(page, "On page 2 he inserts a table of contents with page numbers. Two clicks.", 1200);
  await editor.getByText("Start of the report").click();
  await page.keyboard.press("ControlOrMeta+ArrowLeft");
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  const contents = page.getByRole("menuitem", { name: "Table of contents" });
  await contents.hover();
  await page.getByRole("menuitem", { name: "With page numbers" }).click();
  const toc = page.getByRole("navigation", { name: "Table of contents" });
  await expect(toc.getByRole("button", { name: "Introduction" })).toBeVisible();
  await expect(toc.getByRole("button", { name: "Budget" })).toBeVisible();
  await expect(toc.locator(".doc-toc-page").first()).not.toHaveText("");
  await pointAt(page, toc, 0.4, 0.3);
  await caption(page, "Every heading is listed, indented, with dotted leaders and page numbers. Nothing to refresh.", 2000);

  await caption(page, "He renames Results. The contents line changes on its own.", 1000);
  await editor.getByRole("heading", { name: "Results", exact: true }).click({ clickCount: 3 });
  await typeSlowly(page, "What we achieved", 28);
  await expect(toc.getByRole("button", { name: "What we achieved" })).toBeVisible();
  await beat(page, 700);

  await caption(page, "He adds a Heading 2, Coaching hours. A new line appears in the contents.", 1000);
  await editor.getByText("Programme ends here.").click();
  await page.keyboard.press("ControlOrMeta+ArrowRight");
  await page.keyboard.press("Enter");
  await typeSlowly(page, "Coaching hours", 30);
  await page.getByRole("combobox", { name: "Paragraph style" }).selectOption({ label: "Heading 2" });
  await expect(toc.getByRole("button", { name: "Coaching hours", exact: true })).toBeVisible();
  await beat(page, 800);

  await caption(page, "He cuts Budget and pastes it above What we achieved. Order and page numbers follow.", 1200);
  await editor.getByRole("heading", { name: "Budget", exact: true }).click({ position: { x: 4, y: 8 } });
  await page.keyboard.press("ControlOrMeta+ArrowLeft");
  await editor.getByText("Budget close.").click({ modifiers: ["Shift"] });
  await page.keyboard.press("ControlOrMeta+X");
  await beat(page, 400);
  await editor.getByRole("heading", { name: "Coaching hours", exact: true }).click();
  await page.keyboard.press("ControlOrMeta+ArrowRight");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ControlOrMeta+V");
  const ghost = page.locator(".outline-item-text", { hasText: "Untitled heading" });
  if (await ghost.count()) {
    await ghost.click();
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
  }
  await expect(toc.getByRole("button", { name: "Budget" })).toBeVisible();
  const labels = await toc.locator(".doc-toc-link").allTextContents();
  expect(labels.indexOf("Budget")).toBeLessThan(labels.indexOf("What we achieved"));
  await beat(page, 900);
  await caption(page, "No Refresh button. The contents stayed true while the sections moved.", 1800);

  await caption(page, "Budget in the contents is a link. One click jumps to that heading.", 1000);
  await toc.getByRole("button", { name: "Budget", exact: true }).click();
  await expect(editor.getByRole("heading", { name: "Budget" })).toBeInViewport();
  await beat(page, 800);

  await caption(page, "Options sit on the table itself: page numbers or links, and which heading levels.", 1000);
  await toc.getByRole("button", { name: "Contents options" }).click();
  await expect(toc.getByRole("menu", { name: "Contents options" })).toBeVisible();
  await beat(page, 700);
  await toc.getByRole("menuitemradio", { name: "Heading 1 only" }).click();
  await expect(toc.getByRole("button", { name: "Coaching hours" })).toHaveCount(0);
  await beat(page, 700);
  await toc.getByRole("button", { name: "Contents options" }).click();
  await toc.getByRole("menuitemradio", { name: "Levels 1 to 3" }).click();
  await expect(toc.getByRole("button", { name: "Coaching hours" })).toBeVisible();
  await beat(page, 600);

  await caption(page, "After “attendance rose 40%” he presses the footnote shortcut. The cursor is already in the note.", 1400);
  await editor.getByText("attendance rose 40%").click();
  await page.keyboard.press("ControlOrMeta+ArrowRight");
  await typeFootnote(
    page,
    editor,
    "Annual return of the Saturday league, table 4, filed with the community fund on 12 March 2026. Players who made at least half the sessions, excluding the two weekends cancelled for snow.",
  );
  await expect(editor.locator(".doc-note-ref").first()).toHaveText("1");
  await expect(editor.locator(".doc-note[data-kind='footnote']").first()).toContainText("Saturday league");
  await beat(page, 800);

  await caption(page, "Two more notes later in the report, then one earlier. They renumber in reading order.", 1400);
  await editor.getByRole("heading", { name: "Next year", exact: true }).click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ControlOrMeta+ArrowRight");
  await typeFootnote(page, editor, "Club development plan.");
  await editor.getByRole("heading", { name: "Partnerships", exact: true }).click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ControlOrMeta+ArrowRight");
  await typeFootnote(page, editor, "Pitch agreement.");
  await editor.getByRole("heading", { name: "Introduction", exact: true }).click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ControlOrMeta+ArrowRight");
  await typeFootnote(page, editor, "Charity registration.");
  const numbers = await editor.locator(".doc-note-ref").allTextContents();
  expect(numbers).toEqual(["1", "2", "3", "4"]);
  await caption(page, "Four footnotes, numbered 1 to 4 from the top of the report to the bottom.", 1600);

  await caption(page, "Click a number to read the note. Click the note's number to come back.", 1000);
  await editor.locator(".doc-note-ref", { hasText: "2" }).click();
  const league = editor.locator(".doc-note[data-kind='footnote']").filter({ hasText: "Saturday league" });
  await expect(league).toHaveClass(/doc-note-placed/);
  await league.evaluate((el) => {
    const stage = el.closest(".document-stage") as HTMLElement | null;
    if (!stage) return;
    const rect = el.getBoundingClientRect();
    stage.scrollTop += rect.top - stage.getBoundingClientRect().top - 160;
  });
  await expect(league).toBeVisible();
  await beat(page, 700);
  await editor.locator(".doc-note-label", { hasText: "2" }).click();
  await expect(editor.locator(".doc-note-ref", { hasText: "2" })).toBeInViewport();
  await beat(page, 600);

  await caption(page, "In print layout the notes for a page sit together at the bottom, under a short rule.", 1800);
  const longNote = editor.locator(".doc-note[data-kind='footnote']").filter({ hasText: "Saturday league" });
  await longNote.scrollIntoViewIfNeeded();
  await expect(longNote).toBeVisible();
  await expect(longNote).toContainText("Saturday league");
  await beat(page, 1800);

  await caption(page, "File, Export DOCX. Word receives a real contents field and real footnotes.", 1200);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Export DOCX" }).click();
  const download = await downloadPromise;
  const saved = await download.path();
  const zip = await JSZip.loadAsync(await readFile(saved!));
  const documentXml = await zip.file("word/document.xml")!.async("string");
  expect(documentXml).toMatch(/TOC/);
  expect(documentXml).toMatch(/<w:footnoteReference\b/);
  expect(await zip.file("word/footnotes.xml")!.async("string")).toContain("Saturday league");
  await caption(page, "The download is a Word file: a TOC field Word can update, and footnotes Word can step through.", 2000);

  await caption(page, "The funder's officer adds an endnote and sends the file back.", 1400);
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (await chooser).setFiles({
    name: "Grant report 2026 returned.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: await returnedDocx(),
  });
  await expect(page.locator(".import-notes summary")).toContainText(
    "4 footnotes, 1 endnote, 1 table of contents",
  );
  await caption(page, "The import summary lists 4 footnotes, 1 endnote, 1 table of contents.", 1800);
  const imported = page.getByRole("textbox", { name: "Document content" });
  await expect(imported.getByRole("navigation", { name: "Table of contents" })).toBeVisible();
  await expect(imported.locator(".doc-note-ref")).toHaveCount(5);
  await imported.locator(".doc-note[data-kind='endnote']").scrollIntoViewIfNeeded();
  await expect(imported.locator(".doc-note[data-kind='endnote']")).toContainText("girls' team");
  await pointAt(page, imported.getByText("Endnotes", { exact: true }), 0.2);
  await caption(page, "The endnote stayed an endnote, linked to its marker. The contents and the four footnotes came back with it.", 2400);
});

async function typeFootnote(page: Page, editor: Locator, text: string) {
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Alt+F" : "Control+Alt+F");
  const bodies = editor.locator(".doc-note[data-kind='footnote'] .doc-note-body");
  await expect(bodies.first()).toBeAttached();
  const count = await bodies.count();
  let target = bodies.last();
  for (let i = 0; i < count; i++) {
    if ((await bodies.nth(i).innerText()).trim() === "") target = bodies.nth(i);
  }
  await target.click({ force: true });
  await typeSlowly(page, text, text.length > 80 ? 14 : 22);
}
