import type { Download, Locator, Page } from "@playwright/test";
import JSZip from "jszip";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync, crc32 } from "node:zlib";
import { wordFixture } from "../../tests/office-fixtures";
import { beat, caption, expect, test, typeSlowly } from "./harness";

const editorOf = (page: Page) => page.getByRole("textbox", { name: "Document content" });

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

async function backToFiles(page: Page) {
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
}

/** Move the caret to the end of the line (End does not on macOS). */
const lineEnd = (page: Page) =>
  page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowRight" : "End");

/** Type a line, then give it a paragraph style from the toolbar menu. */
async function styledLine(page: Page, text: string, style: string) {
  await typeSlowly(page, text);
  await page.getByRole("combobox", { name: "Paragraph style" }).selectOption({ label: style });
  await lineEnd(page);
  await page.keyboard.press("Enter");
}

/** Smoothly bring part of the page into view so the recording shows it. */
async function scrollTo(page: Page, selector: string) {
  await page
    .locator(selector)
    .evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
  await beat(page, 700);
}

/** Scroll the document back to its first page. */
async function showDocumentTop(page: Page) {
  await page
    .locator(".document-stage")
    .evaluate((el) => el.scrollTo({ top: 0, behavior: "smooth" }));
  await beat(page, 700);
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

/** A small landscape picture (sky, sun, and garden rows) as a PNG. */
function gardenPicture(width = 360, height = 200) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      let rgb = [135, 196, 235];
      if ((x - 290) ** 2 + (y - 45) ** 2 < 24 ** 2) rgb = [252, 202, 70];
      if (y > 120 + Math.sin(x / 40) * 8) rgb = [86, 150, 70];
      if (y > 140 && (y - 140) % 18 < 6) rgb = [120, 84, 52];
      raw.set(rgb, y * (width * 3 + 1) + 1 + x * 3);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("02-find-and-organize-files", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Maya's library is empty, so she starts with a sample document.");
  await page.getByRole("button", { name: "Sample document" }).click();
  await expect(editorOf(page)).toContainText("Welcome to SuiteLeaf");
  await caption(page, "The sample opens, ready to read or edit.", 1200);
  await backToFiles(page);

  await caption(page, "She adds the garden club's files: a budget…", 1000);
  await page.getByRole("button", { name: "New spreadsheet" }).click();
  const title = page.getByLabel("File title");
  await title.click();
  await title.press("ControlOrMeta+A");
  await typeSlowly(page, "Garden club budget");
  await page.locator(".sheet-host input.univer-size-full").waitFor();
  await caption(page, "She names it while the grid is still loading, and every letter stays in the title.", 1600);
  await expect(title).toHaveValue("Garden club budget");
  await expect(page.getByRole("status")).toContainText("Saved");
  await backToFiles(page);

  await caption(page, "…a talk for the autumn meeting…", 900);
  await page.getByRole("button", { name: "New presentation" }).click();
  await title.click();
  await title.press("ControlOrMeta+A");
  await typeSlowly(page, "Garden club talk");
  await expect(title).toHaveValue("Garden club talk");
  await expect(page.getByRole("status")).toContainText("Saved");
  await backToFiles(page);

  await caption(page, "…and the October newsletter.", 900);
  await newDocument(page, "Garden club newsletter");
  await typeSlowly(page, "Harvest supper on Saturday. Bring a dish to share.");
  await expect(page.getByRole("status")).toContainText("Saved");
  await backToFiles(page);

  const rows = page.locator(".file-row");
  await expect(rows).toHaveCount(4);
  await scrollTo(page, ".sample-strip");
  await caption(page, "Four files now, newest first, and the samples are still on offer below.", 2000);
  const search = page.getByLabel("Search files");
  await scrollTo(page, ".home-top");
  await caption(page, "Search narrows the list as she types…", 600);
  await search.click();
  await typeSlowly(page, "garden", 90);
  await expect(page.getByRole("heading", { name: "Results for “garden”" })).toBeVisible();
  await expect(rows).toHaveCount(3);
  await caption(page, "…and the results move up, right under the search box.", 1800);
  await search.fill("");
  await typeSlowly(page, "harvest", 90);
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator(".file-snippet")).toContainText("Harvest supper on Saturday");
  await caption(page, "\"harvest\" is only inside the newsletter, so it's found and quoted.", 2200);
  await search.press("Escape");
  await expect(rows).toHaveCount(4);
  await caption(page, "Escape clears the search and brings the home screen back.", 1400);

  await caption(page, "The sidebar filters by type: Documents…", 900);
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  await expect(rows).toHaveCount(2);
  await beat(page);
  await caption(page, "…Spreadsheets…", 600);
  await page.getByRole("button", { name: "Spreadsheets", exact: true }).click();
  await expect(rows).toHaveCount(1);
  await beat(page, 700);
  await caption(page, "…and Presentations.", 600);
  await page.getByRole("button", { name: "Presentations", exact: true }).click();
  await expect(rows).toHaveCount(1);
  await beat(page, 700);
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await expect(rows).toHaveCount(4);

  await caption(page, "Click the Name column to sort A to Z.", 900);
  await page.getByRole("button", { name: "Sort by name" }).click();
  await expect(rows.first()).toContainText("Garden club budget");
  await expect(rows.last()).toContainText("Welcome to SuiteLeaf");
  await beat(page, 1200);
  await page.getByRole("button", { name: "Sort by last edited" }).click();
  await expect(rows.first()).toContainText("Garden club newsletter");

  await caption(page, "Duplicate the newsletter to start next month's issue.", 1100);
  await page.getByRole("button", { name: "Duplicate Garden club newsletter", exact: true }).click();
  const copy = page.getByRole("link", { name: "Garden club newsletter copy", exact: true });
  await expect(copy).toBeVisible();
  await beat(page);
  await caption(page, "Rename the copy right from the list.", 900);
  await page.getByRole("button", { name: "Rename Garden club newsletter copy", exact: true }).click();
  const rename = page.getByRole("dialog", { name: "Rename" });
  const name = rename.getByLabel("Name");
  await expect(name).toHaveValue("Garden club newsletter copy");
  await name.press("ControlOrMeta+A");
  await typeSlowly(page, "Garden club newsletter - November");
  await beat(page, 500);
  await rename.getByRole("button", { name: "OK" }).click();
  await expect(
    page.getByRole("link", { name: "Garden club newsletter - November", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Garden club newsletter", exact: true })).toBeVisible();
  await scrollTo(page, ".file-section");
  await caption(page, "Both newsletters are listed, each with its own name.", 1600);

  await caption(page, "Finally, remove the sample she no longer needs.", 1100);
  await page.getByRole("button", { name: "Remove Welcome to SuiteLeaf", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Delete this file?" });
  await expect(confirm).toContainText("“Welcome to SuiteLeaf” will be deleted from this browser.");
  await caption(page, "SuiteLeaf asks first, and says exactly what will go.", 2000);
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("link", { name: "Welcome to SuiteLeaf", exact: true })).toHaveCount(0);
  await expect(rows).toHaveCount(4);
  await caption(page, "Four garden club files, easy to find by name, by what's inside, or by type.", 2200);
});

test("03-import-word-document", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Lena was emailed a Word document. She opens it in SuiteLeaf.");
  await caption(page, "Choose Open / import and pick the .docx file.", 1000);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (await chooser).setFiles({
    name: "Office field notes.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(await wordFixture()),
  });
  const editor = editorOf(page);
  await expect(editor.locator("h1")).toContainText("Office field notes");
  await expect(editor).toContainText("Hello 世界 — مرحبا");
  await expect(editor.locator("table")).toBeVisible();
  await expect(editor.locator("sup")).toHaveText("2");
  await caption(page, "It converts on this computer into an editable SuiteLeaf copy.", 1600);
  await caption(page, "The heading, bold italic text in three scripts, the link, the table and the ² in \"40 m²\" came through.", 2400);

  const notes = page.locator(".import-notes");
  await expect(notes.locator("summary")).toHaveText(
    "Imported DOCX: Office field notes.docx · 2 compatibility notes",
  );
  await caption(page, "The banner says what was imported. Open it to read the compatibility notes.", 1200);
  await notes.locator("summary").click();
  await expect(notes.locator("li")).toHaveText([
    /1 link with an unsafe or unsupported address \(javascript:\) was removed; its text was kept\./,
    /SuiteLeaf lays out its own pages/,
  ]);
  await caption(page, "One note says an unsafe 'javascript:' link was removed. The other: Word's exact page breaks may differ.", 2600);
  await expect(editor.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(editor.locator('a[href="https://example.org"]')).toHaveText("Reference");
  const pointBelow = async (target: Locator) => {
    const box = (await target.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height + 14, { steps: 8 });
  };
  await pointBelow(editor.getByText("Unsafe link"));
  await caption(page, "\"Unsafe link\" is now plain text. The normal \"Reference\" link was kept.", 2000);
  await notes.locator("summary").click();

  await caption(page, "Now it's just a document. Lena adds a note after \"40 m²\".", 1000);
  await editor.locator(":scope > p").last().click();
  await lineEnd(page);
  await page.keyboard.press("Enter");
  const superscript = page.getByRole("button", { name: "Superscript", exact: true });
  await expect(superscript).toHaveAttribute("aria-pressed", "true");
  await pointBelow(superscript);
  await caption(page, "As in Word, the new line carries on the superscript. The Superscript button shows it's on…", 2200);
  await superscript.click();
  await expect(superscript).toHaveAttribute("aria-pressed", "false");
  await pointBelow(superscript);
  await caption(page, "…so she turns it off and types normally.", 1000);
  await typeSlowly(page, "Reviewed by Lena: figures confirmed with the North team.");
  const note = editor.locator(":scope > p").last();
  await expect(note).toHaveText("Reviewed by Lena: figures confirmed with the North team.");
  await expect(note.locator("sup")).toHaveCount(0);
  await beat(page);
  await expect(page.getByRole("status")).toContainText("Saved");
  await caption(page, "Her edits save automatically. The original .docx is never changed.", 1600);

  await backToFiles(page);
  await expect(page.getByRole("link", { name: "Office field notes", exact: true })).toBeVisible();
  await caption(page, "The imported copy is in her library, ready to edit or export back to Word.", 2000);
});

const report: [string, string, string?][] = [
  ["Summary", "Heading 1", "Riverside Community Garden had its busiest year yet. Forty-two households tended plots, the waiting list fell from thirty names to nine, and the new rainwater tanks carried us through the dry spell in July without a single hosepipe day. This report sets out what we grew, who helped, how the money was spent, and what we plan for next season."],
  ["Growing season", "Heading 1"],
  ["Spring planting", "Heading 2", "A cold April delayed the first sowings by about two weeks. Members moved tomatoes and squash into the greenhouse until mid-May, and the shared seed library lent out more than three hundred packets. Broad beans, early potatoes and salad leaves did especially well in the raised beds by the north fence, where the new compost had been dug in over winter."],
  ["Summer harvest", "Heading 2", "July and August brought the heaviest harvest in the garden's history. We weighed four hundred and twelve kilograms of produce at the Saturday sessions, and members donated just over a quarter of it to the food bank on Mill Street. Courgettes, runner beans and soft fruit were the stars; sweetcorn struggled in the wind and will move to a sheltered bed next year."],
  ["Volunteers", "Heading 1", "Twenty-six volunteers gave roughly nine hundred hours this year. The Tuesday work party rebuilt the tool shed roof, the school gardening club planted a wildflower border along the path, and three members completed first-aid training. We thank every one of them, and especially Ruth Okafor, who stepped down after eight years as plot secretary."],
  ["Budget", "Heading 1"],
  ["Income", "Heading 2", "Plot fees raised four thousand one hundred pounds. The plant sale in May added nine hundred and sixty pounds, and a grant from the town council covered most of the rainwater tanks. Donations through the honesty box at the gate came to about two hundred pounds, roughly the same as last year."],
  ["Expenses", "Heading 2", "The largest costs were the rainwater tanks, the water bill, and timber for the shed roof. Insurance rose by twelve percent. We ended the year with a surplus of six hundred and forty pounds, which the committee proposes to set aside for replacing the greenhouse glazing in two years' time."],
  ["Next year", "Heading 1", "Priorities for next season are an accessible raised bed near the gate, a second compost bay, and a monthly open day for neighbours who are curious about joining. The committee will present a detailed plan at the spring general meeting."],
];

test("04-long-report-with-outline", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Tom is writing the garden's annual report: several sections, a few pages long.");
  const editor = await newDocument(page, "Community garden annual report");
  await caption(page, "He types each section title and picks Heading 1 or Heading 2 from the style menu.", 1200);
  for (const [i, [heading, style, body]] of report.entries()) {
    await styledLine(page, heading, style);
    if (body) {
      if (i === 0) await typeSlowly(page, body.slice(0, 90), 20);
      await page.keyboard.insertText(i === 0 ? body.slice(90) : body);
      await page.keyboard.press("Enter");
    }
    if (i === 2) await caption(page, "Each heading appears in the outline on the left as he goes.", 1200);
  }
  await expect(page.locator(".outline-item")).toHaveCount(report.length);
  await expect(page.locator(".outline-item.level-2")).toHaveCount(4);
  await expect(page.locator(".editor-status")).toContainText(/[2-9] pages/);
  await caption(page, "The finished report runs over two pages. The outline lists every section and sub-section.", 2000);

  const outline = page.locator(".outline");
  const current = outline.locator("[aria-current=location]");
  const jump = async (name: string) => {
    await outline.getByRole("button", { name, exact: true }).click();
    await expect(editor.getByRole("heading", { name, exact: true })).toBeInViewport();
    await expect(current).toHaveText(name);
    await beat(page, 1200);
  };
  await caption(page, "Back to the start: he clicks Summary in the outline.", 900);
  await jump("Summary");
  await caption(page, "As he scrolls, the outline highlights the section he's reading.", 600);
  await page.mouse.move(640, 420);
  for (let i = 0; i < 9; i++) {
    await page.mouse.wheel(0, 70);
    await beat(page, 220);
  }
  await expect(current).not.toHaveText("Summary");
  await beat(page, 1200);
  await caption(page, "To check the money section, he clicks Expenses…", 900);
  await jump("Expenses");
  await caption(page, "…and it opens at the top of the window. The heading starts page 2 with its paragraph.", 2200);
  await caption(page, "Then Volunteers, to add a thank-you.", 700);
  await jump("Volunteers");
  await lineEnd(page);
  await page.keyboard.press("Enter");
  await typeSlowly(page, "A special thank-you to the Saturday tea rota!");
  await expect(
    editor.getByRole("heading", { name: "Volunteers" }).locator("xpath=following-sibling::p[1]"),
  ).toHaveText("A special thank-you to the Saturday tea rota!");
  await expect(page.getByRole("status")).toContainText("Saved");
  await caption(page, "Headings keep a long report easy to move around.", 1800);
});

test("05-tables-images-and-links", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Asha is making a sign-up sheet for the seed swap.");
  const editor = await newDocument(page, "Seed swap sign-up");
  await styledLine(page, "Seed swap", "Heading 1");
  await typeSlowly(page, "Bring seeds to share on Saturday 14 November at the garden shed.");
  await page.keyboard.press("Enter");

  await caption(page, "Insert a table and choose its size: 3 rows by 3 columns, with a header row.", 1000);
  await page.getByRole("button", { name: "Insert table", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Insert table" });
  await dialog.getByLabel("Table rows").fill("3");
  await dialog.getByLabel("Table columns").fill("3");
  await expect(dialog.getByRole("checkbox", { name: "Header row" })).toBeChecked();
  await beat(page, 1200);
  await dialog.getByRole("button", { name: "Create table" }).click();
  const table = editor.locator("table");
  const rows = table.locator("tr");
  await expect(rows).toHaveCount(3);
  await expect(rows.first().locator("th")).toHaveCount(3);
  await beat(page, 300);

  await caption(page, "Fill it in, pressing Tab to move from cell to cell.", 900);
  const cells = [
    "Name", "Bringing", "Hoping for",
    "Asha", "Runner beans", "Chillies",
    "Marek", "Calendula", "Squash",
  ];
  for (const [i, text] of cells.entries()) {
    await typeSlowly(page, text, 25);
    if (i < cells.length - 1) await page.keyboard.press("Tab");
  }
  await showDocumentTop(page);
  await caption(page, "The first row is a bold, shaded header. Tab in the last cell adds a new row.", 1200);
  await page.keyboard.press("Tab");
  await expect(rows).toHaveCount(4);
  for (const [i, text] of ["Joy", "Sweet peas", "Anything!"].entries()) {
    await typeSlowly(page, text, 25);
    if (i < 2) await page.keyboard.press("Tab");
  }
  await beat(page);

  await caption(page, "Priya signed up before Joy. Right-click Marek's row for the table options.", 1200);
  await table.getByText("Marek", { exact: true }).click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Table options" });
  await expect(menu).toBeVisible();
  await caption(page, "Insert rows above or below, columns left or right, or delete them.", 2000);
  await menu.getByRole("menuitem", { name: "Insert row below" }).hover();
  await beat(page, 500);
  await menu.getByRole("menuitem", { name: "Insert row below" }).click();
  await expect(rows).toHaveCount(5);
  await beat(page, 500);
  await rows.nth(3).locator("td").first().click();
  for (const [i, text] of ["Priya", "Tomatoes", "Herbs"].entries()) {
    await typeSlowly(page, text, 25);
    if (i < 2) await page.keyboard.press("Tab");
  }
  await expect(rows.nth(3)).toHaveText("PriyaTomatoesHerbs");
  await expect(rows.nth(4).locator("td").first()).toHaveText("Joy");
  await caption(page, "Priya's row lands right under Marek's.", 1400);

  await caption(page, "Click below the table to keep writing.", 900);
  await editor.locator(":scope > p").last().click();
  await typeSlowly(page, "Last year's swap table:");
  await page.keyboard.press("Enter");
  await caption(page, "Add a photo from the computer with Insert image.", 1000);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Insert image", exact: true }).click();
  await (await chooser).setFiles({ name: "garden.png", mimeType: "image/png", buffer: gardenPicture() });
  const image = editor.locator("img");
  await expect(image).toBeVisible();
  await expect(table.locator("img")).toHaveCount(0);
  await beat(page, 1400);

  await typeSlowly(page, "Full rules are on the club website.");
  await expect(image).toBeVisible();
  await caption(page, "Select \"club website\" and click Insert link.", 1000);
  await page.keyboard.press("ArrowLeft");
  for (let i = 0; i < "club website".length; i++) await page.keyboard.press("Shift+ArrowLeft");
  await page.getByRole("button", { name: "Insert link", exact: true }).click();
  const linkDialog = page.getByRole("dialog", { name: "Insert link" });
  await expect(linkDialog.getByLabel("Link text")).toHaveValue("club website");
  await caption(page, "The link dialog shows the words; she types the address. No need for https://.", 900);
  await typeSlowly(page, "example.org/seed-swap", 45);
  await beat(page, 700);
  await linkDialog.getByRole("button", { name: "Apply" }).click();
  const link = editor.locator('a[href="https://example.org/seed-swap"]');
  await expect(link).toHaveText("club website");
  await lineEnd(page);
  await caption(page, "The words become a link to https://example.org/seed-swap.", 1800);

  await caption(page, "The photo is a bit big. Click it, then drag a corner to shrink it.", 1000);
  await image.click();
  const corner = editor.locator('[data-resize-handle="bottom-right"]');
  await expect(corner).toBeVisible();
  await beat(page, 600);
  const start = (await corner.boundingBox())!;
  const from = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
  await page.mouse.move(from.x, from.y, { steps: 5 });
  await page.mouse.down();
  await page.mouse.move(from.x - 110, from.y - 61, { steps: 20 });
  await page.mouse.up();
  await expect.poll(async () => (await image.boundingBox())!.width).toBeLessThan(300);
  await caption(page, "It keeps its shape, and the new size is saved with the document.", 1600);
  await editor.locator(":scope > p").last().click();
  await lineEnd(page);
  await expect(page.getByRole("status")).toContainText("Saved");
  await showDocumentTop(page);
  await caption(page, "A header row, a row added in the middle, a resized photo and a link, all saved.", 2200);
});

const letter = [
  "Dear volunteers,",
  "Thank you for a wonderful season.",
  "We were happy to recieve so many seed donations this spring.",
  "You will recieve a printed harvest calendar at the supper on Saturday.",
  "If you did not recieve your new gloves, please ask Ruth at the shed.",
  "With warm wishes, the committee",
];

test("06-find-and-replace", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Priya is writing a thank-you letter to the garden volunteers.");
  const editor = await newDocument(page, "Thank-you letter");
  for (const line of letter) {
    await typeSlowly(page, line, 18);
    await page.keyboard.press("Enter");
  }
  await caption(page, "Reading it back, she has spelled \"receive\" wrong three times.", 1800);

  await caption(page, "Open Edit, then Find and replace.", 900);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await beat(page, 500);
  await page.getByRole("menuitem", { name: /Find and replace/ }).click();
  const find = page.getByRole("search", { name: "Find and replace" });
  await expect(find).toBeVisible();
  await find.getByLabel("Find text").click();
  await typeSlowly(page, "recieve", 70);
  const counter = find.locator(".match-counter");
  await expect(counter).toHaveText("1 of 3");
  await caption(page, "Three matches, all highlighted. The current one is darker and outlined.", 1800);
  await find.getByLabel("Replacement text").click();
  await typeSlowly(page, "receive", 70);

  await caption(page, "Replace fixes just this one and moves to the next.", 900);
  await find.getByRole("button", { name: "Replace", exact: true }).click();
  await expect(counter).toHaveText("1 of 2");
  await expect(editor).toContainText("happy to receive");
  await beat(page, 1200);
  await caption(page, "Next: the last one ends a line, so the dialog steps aside to show it.", 900);
  await find.getByRole("button", { name: "Next", exact: true }).click();
  await expect(counter).toHaveText("2 of 2");
  const current = (await page.locator(".doc-search-current").boundingBox())!;
  const dialog = (await find.boundingBox())!;
  expect(
    current.x < dialog.x + dialog.width &&
      dialog.x < current.x + current.width &&
      current.y < dialog.y + dialog.height &&
      dialog.y < current.y + current.height,
  ).toBe(false);
  await beat(page, 2000);
  await caption(page, "Previous goes back one.", 700);
  await find.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(counter).toHaveText("1 of 2");
  await beat(page, 900);

  await caption(page, "Like in Google Docs, she can also drag the dialog by its title.", 900);
  const title = (await find.getByRole("heading", { name: "Find and replace" }).boundingBox())!;
  await page.mouse.move(title.x + 40, title.y + title.height / 2, { steps: 8 });
  await page.mouse.down();
  await page.mouse.move(title.x - 20, title.y + title.height / 2 + 50, { steps: 20 });
  await page.mouse.up();
  await beat(page, 900);

  await caption(page, "…then Replace all fixes the remaining two at once.", 900);
  await find.getByRole("button", { name: "Replace all", exact: true }).click();
  await expect(counter).toHaveText("No results");
  await expect(find).toContainText("Replaced 2 instances of “recieve” with “receive”.");
  await caption(page, "Nothing left to find, and the dialog says what it changed.", 2200);
  await find.getByRole("button", { name: "Close find" }).click();
  await expect(editor).not.toContainText("recieve");
  await expect(editor.getByText(/receive/)).toHaveCount(3);
  await expect(page.getByRole("status")).toContainText("Saved");
  await caption(page, "All three corrected, and the letter is saved.", 1800);
});

test("07-page-setup-and-export", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Ben takes the minutes, then sends them to members who use Word.");
  const editor = await newDocument(page, "October meeting minutes");
  await styledLine(page, "Meeting minutes, 8 October", "Heading 1");
  await typeSlowly(page, "Present: Ben, Ruth, Marek, Asha, Joy. Apologies: Tom.", 20);
  await page.keyboard.press("Enter");
  await page.keyboard.insertText(
    "The committee agreed the budget for the rainwater tanks and set the date of the harvest supper. Ruth will order timber for the shed roof before the end of the month. Asha will run the seed swap in November.",
  );
  await page.keyboard.press("Enter");
  await caption(page, "Appendix A starts on a new page: click Page break and keep typing.", 1200);
  await page.getByRole("button", { name: "Page break", exact: true }).click();
  await expect(page.locator(".editor-status")).toContainText("2 pages");
  await beat(page, 500);
  await styledLine(page, "Appendix A: plot assignments", "Heading 1");
  await page.keyboard.insertText("Plots 1 to 12: north beds. Plots 13 to 30: south beds. Plot 31: school gardening club.");
  await page.keyboard.press("Enter");
  await caption(page, "Insert, Page break does the same (shortcut: Ctrl+Enter, or ⌘+Enter on a Mac).", 1200);
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await beat(page, 500);
  await page.getByRole("menuitem", { name: /^Page break/ }).click();
  await expect(page.locator(".editor-status")).toContainText("3 pages");
  await beat(page, 500);
  await styledLine(page, "Appendix B: work party rota", "Heading 1");
  await page.keyboard.insertText("Tuesdays: Ruth and Marek. Saturdays: Asha, Joy and Ben.");
  await expect(page.locator(".manual-page-break")).toHaveCount(2);
  await beat(page);

  await caption(page, "File, Page setup adds a header and a footer to every page.", 1000);
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 500);
  await page.getByRole("menuitem", { name: "Page setup…", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Page setup" });
  await setup.getByLabel("Page header").click();
  await typeSlowly(page, "Riverside Garden Club");
  await setup.getByLabel("Page footer").click();
  await typeSlowly(page, "Minutes: draft for members");
  const numbers = setup.getByLabel("Page numbers");
  await expect(numbers).not.toBeChecked();
  await caption(page, "Page numbers are off until you ask for them, as in Docs and Word. Ben turns them on.", 1400);
  await numbers.check();
  await beat(page, 600);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  const headers = page.locator(".page-header");
  await expect(headers).toHaveCount(3);
  await expect(headers.first()).toHaveText("Riverside Garden Club");
  await expect(page.locator(".page-footer").first()).toContainText("1 / 3");
  await page
    .locator(".page-footer")
    .first()
    .evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
  await beat(page, 700);
  await caption(page, "Where pages meet: page 1 ends with the footer and \"1 / 3\"; page 2 starts with the header.", 2600);

  await caption(page, "File, Export DOCX makes a Word copy.", 900);
  const docx = await fileMenu(page, "Export DOCX");
  const bytes = await savedBytes(docx);
  const zip = await JSZip.loadAsync(bytes);
  const parts = Object.keys(zip.files);
  const header = await zip.file(parts.find((p) => /word\/header\d*\.xml/.test(p))!)!.async("string");
  expect(header).toContain("Riverside Garden Club");
  const footer = await zip.file(parts.find((p) => /word\/footer\d*\.xml/.test(p))!)!.async("string");
  expect(footer).toContain("Minutes: draft for members");
  expect(footer).toContain("NUMPAGES");
  expect(await zip.file("word/document.xml")!.async("string")).toContain("Appendix B");
  await caption(page, `Saved "${docx.suggestedFilename()}" to Downloads, header and footer included.`, 2000);

  await caption(page, "File, Export HTML makes a copy for the club website.", 900);
  const html = await fileMenu(page, "Export HTML");
  const page1 = (await savedBytes(html)).toString("utf8");
  expect(page1).toContain("<h1>Appendix A: plot assignments</h1>");
  expect(page1).toContain('<header class="page-header">Riverside Garden Club</header>');
  expect(page1).toContain('<footer class="page-footer">Minutes: draft for members</footer>');
  expect(html.suggestedFilename()).toMatch(/\.html$/);
  await caption(page, `Saved "${html.suggestedFilename()}" too: the club name above the minutes, the footer below.`, 2200);
  await expect(editor).toContainText("work party rota");
  await caption(page, "One set of minutes: printed pages for Word users and a web page for everyone else.", 2000);
});

test("08-carry-a-file-to-another-computer", async ({ page }) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto("/");
  await caption(page, "Sofia writes a packing list on her laptop and wants it on her work computer.");
  const editor = await newDocument(page, "Lisbon trip packing list");
  await styledLine(page, "Lisbon, 3 to 7 November", "Heading 1");
  await page.getByRole("button", { name: "Bulleted list", exact: true }).click();
  for (const item of ["Passport and boarding pass", "Plug adapter", "Walking shoes", "Rain jacket"]) {
    await typeSlowly(page, item, 25);
    await page.keyboard.press("Enter");
  }
  await page.keyboard.press("Backspace");
  await expect(editor.locator("li")).toHaveCount(4);
  await expect(page.getByRole("status")).toContainText("Saved");
  await showDocumentTop(page);
  await caption(page, "It autosaves in this browser. To take it with her, she clicks Download.", 1200);

  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("Lisbon trip packing list.sldoc");
  const saved = join(mkdtempSync(join(tmpdir(), "storyboard-08-")), download.suggestedFilename());
  await download.saveAs(saved);
  expect(JSON.parse(readFileSync(saved, "utf8")).title).toBe("Lisbon trip packing list");
  await caption(page, `Saved "${download.suggestedFilename()}": one file she can email or copy to a USB stick.`, 2200);

  await backToFiles(page);
  await caption(page, "To prove the file is all she needs, she removes the list from this browser.", 1000);
  await page.getByRole("button", { name: "Remove Lisbon trip packing list", exact: true }).click();
  await expect(page.getByRole("heading", { name: "A workspace waiting for you" })).toBeVisible();
  await caption(page, "The library is empty, as on a computer that has never seen it.", 1600);

  await caption(page, "On the other computer: Open / import, then choose the .sldoc file.", 1000);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (await chooser).setFiles(saved);
  await expect(editor.locator("h1")).toHaveText("Lisbon, 3 to 7 November");
  await expect(editor.locator("li")).toHaveCount(4);
  await expect(page.getByLabel("File title")).toHaveValue("Lisbon trip packing list");
  await caption(page, "Everything is back: the title, the heading and all four items.", 1600);
  await editor.locator("li").last().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await typeSlowly(page, "Sunglasses");
  await expect(editor.locator("li")).toHaveCount(5);
  await expect(page.getByRole("status")).toContainText("Saved");
  await showDocumentTop(page);
  await caption(page, "She keeps editing, and it saves on this computer now.", 1800);
});
