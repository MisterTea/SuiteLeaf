import { test, expect, type Page } from "@playwright/test";
import { wordFixture } from "../office-fixtures";

// The assistant's tools, run directly against the real editors. These test
// the tools, not the model: each call is what Gemma would send.

const call = (page: Page, name: string, args: unknown = {}) =>
  page.evaluate(([n, a]) => window.__suiteleafAgent!.callTool(n as string, a), [name, args] as const);

async function waitForTools(page: Page, name: string) {
  await expect.poll(() => page.evaluate(() => window.__suiteleafAgent?.tools() ?? []), { timeout: 20000 }).toContain(name);
}

test.skip(({ browserName, isMobile }) => browserName !== "chromium" || !!isMobile, "Tool behaviour is browser-independent.");

test("document tools write, style, find, replace and check spelling", async ({ page }) => {
  await page.goto("/");
  await waitForTools(page, "create_file");
  await call(page, "create_file", { kind: "document", title: "Volunteer letter" });
  await waitForTools(page, "write_text");
  await call(page, "write_text", {
    replace_document: true,
    text: "# Thank you\n\nWe recieve so much help.\n\n- Weeding\n- Watering\n\nWe recieve it gladly.",
  });
  await call(page, "write_text", { text: "## Next season\nMore beds." });
  const doc = page.getByRole("textbox", { name: "Document content" });
  await expect(doc.locator("h1")).toHaveText("Thank you");
  await expect(doc.locator("h2")).toHaveText("Next season");
  await expect(doc.locator("ul li")).toHaveCount(2);
  const read = await call(page, "read_document");
  expect(read).toContain("[Heading 1] Thank you");
  expect(read).toContain("[Bullet] Watering");
  expect(read).not.toContain("(empty)\n");

  expect(await call(page, "check_spelling")).toContain('"recieve" (2×): receive');
  await expect(page.getByRole("complementary", { name: "Spelling and grammar" })).toBeVisible();
  expect(await call(page, "find_and_replace", { find: "recieve", replace: "receive", all: true })).toContain("Replaced 2 of 2");
  await expect(doc).not.toContainText("recieve");

  await expect(call(page, "write_text", { text: "Thanks.", after: "Nowhere" })).rejects.toThrow(/paragraphs are: "Thank you"/);
  expect(await call(page, "write_text", { text: "Thanks for the **seedlings**.", after: "# Thank you" })).toContain('in bold: "seedlings"');
  expect(await call(page, "read_document")).toMatch(/1\. \[Heading 1\] Thank you\n2\. \[Paragraph\] Thanks for the seedlings\./);
  expect(await call(page, "find_and_replace", { find: "seedlings", replace: "**seed trays**" })).toContain('"seed trays" in bold');
  await expect(doc.locator("strong")).toHaveText("seed trays");
  await expect(doc).not.toContainText("**");
  await call(page, "undo");
  await call(page, "undo");
  await call(page, "format_text", { text: "so much help", bold: true });
  await expect(doc.locator("strong")).toHaveText("so much help");
  await call(page, "set_style", { text: "More beds", style: "Heading 3" });
  await expect(doc.locator("h3")).toHaveText("More beds.");
  await call(page, "insert_table", { cells: [["Task", "Who"], ["Weeding", "Sam"]], after: "Watering" });
  await expect(doc.locator("table td, table th")).toHaveCount(4);
  await call(page, "insert_link", { text: "Next season", url: "example.org/garden" });
  await expect(doc.locator('a[href="https://example.org/garden"]')).toHaveText("Next season");
  expect(await call(page, "page_setup", { orientation: "landscape", footer: "Garden club" })).toContain("landscape");
  await expect(page.locator(".page-footer").first()).toContainText("Garden club");
  expect(await call(page, "write_text", { after: "# Thank you", text: "Dear friends," })).toContain('right after "Thank you"');
  await expect(doc.locator("h1 + p")).toHaveText("Dear friends,");
  await call(page, "write_text", { after: "Thank you", text: "## Helpers\nAll of you." });
  await expect(doc.locator("h1 + p + p")).toHaveText("We receive so much help.");
  await expect(doc.locator("h1 + p + p + h2")).toHaveText("Helpers");
  await expect(call(page, "set_style", { text: "not in the letter", style: "Heading 1" })).rejects.toThrow(/not in the document/);
});

test("spreadsheet tools write, format, sort, chart and pivot", async ({ page }) => {
  await page.goto("/");
  await waitForTools(page, "open_sample");
  await call(page, "open_sample", { sample: "budget" });
  await waitForTools(page, "read_sheet");
  expect(await call(page, "read_sheet")).toContain("Engineering\t12000\t10800");

  await expect(call(page, "insert_chart", { range: "A2:C5", type: "column" })).rejects.toThrow(/use A1:C5/);
  expect(await call(page, "insert_chart", { range: "A1:C5", type: "column", title: "Studio costs" })).toContain(
    'column chart "Studio costs"',
  );
  await expect(page.locator('[aria-label="Chart: Studio costs"]')).toBeVisible();
  expect(await call(page, "edit_chart", { move_to: "F1", width: 420 })).toContain("moved to F1");

  expect(await call(page, "set_cells", { start: "A8", values: [["Code", "Amount"], ["007", "12.5"]] })).toContain("007");
  expect(await call(page, "format_cells", { range: "B2:D6", number_format: "currency" })).toContain("$6,000.00");
  expect(await call(page, "sort_range", { range: "A1:D5", column: "Budget", order: "descending", has_header: true })).toMatch(
    /2\tEngineering/,
  );
  expect(await call(page, "freeze", { rows: 1 })).toContain("1 row");
  expect(
    await call(page, "create_pivot", { range: "A1:C5", rows: ["Category"], value: "Actual", summarize: "SUM" }),
  ).toContain("Pivot table");
});

test("presentation tools build slides and present", async ({ page }) => {
  await page.goto("/");
  await waitForTools(page, "create_file");
  await call(page, "create_file", { kind: "presentation", title: "Club update" });
  await waitForTools(page, "add_slide");
  await call(page, "set_slide_text", { slide: 1, title: "Club update", subtitle: "Spring" });
  await call(page, "add_slide", { layout: "title-body", title: "Planted", body: "Tomatoes\nBeans" });
  await call(page, "add_shape", { slide: 2, shape: "circle", position: "top-right", fill: "#fde68a" });
  await call(page, "set_speaker_notes", { slide: 2, notes: "We planted 40 seedlings." });
  await call(page, "set_background", { color: "#e2ece9", all_slides: true });
  const read = await call(page, "read_presentation");
  expect(read).toContain("Slide 2 [title-body, background #e2ece9] title: Planted; box 2: Tomatoes / Beans; also ellipse shape");
  expect(read).toContain("notes: We planted 40 seedlings.");
  await call(page, "move_slide", { slide: 2, to: 1 });
  expect(await call(page, "read_presentation")).toMatch(/Slide 1 \[title-body/);
  await call(page, "start_presentation", { with_notes: true });
  expect(await call(page, "next_slide")).toContain("slide 2 of 2");
  await call(page, "end_presentation");
});

test("document tools find superscript text the way people type it", async ({ page }) => {
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (await chooser).setFiles({
    name: "Office field notes.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(await wordFixture()),
  });
  await waitForTools(page, "write_text");
  expect(await call(page, "read_document")).toContain("[Paragraph] North plot: 40 m²");
  await call(page, "write_text", { after: "40 m²", text: "Reviewed: figures confirmed." });
  const doc = page.getByRole("textbox", { name: "Document content" });
  const last = doc.locator(":scope > p").last();
  await expect(last).toHaveText("Reviewed: figures confirmed.");
  await expect(last.locator("sup")).toHaveCount(0);
  await call(page, "write_text", { after: "[Paragraph] North plot: 40 m2", text: "Second note." });
  await expect(doc.locator(":scope > p").nth(-2)).toHaveText("Second note.");
  await call(page, "format_text", { text: "m²", bold: true });
  await expect(doc.locator("strong").last()).toHaveText("m2");
  await expect(call(page, "write_text", { after: "South plot", text: "x" })).rejects.toThrow(/copied exactly.*"North plot: 40 m²"/);
});

test("document tools say where a table and a photo went", async ({ page }) => {
  await page.goto("/");
  await waitForTools(page, "create_file");
  await call(page, "create_file", { kind: "document", title: "Seed swap" });
  await waitForTools(page, "write_text");
  await call(page, "write_text", { text: "# Seed swap\nBring seeds on Saturday.\nFull rules online." });
  expect(
    await call(page, "insert_table", { after: "Bring seeds", cells: [["Name", "Bringing"], ["Asha", "Beans"], ["Marek", "Squash"]] }),
  ).toBe(
    'Inserted a 3×2 table right after "Bring seeds on Saturday.", before "Full rules online.": a header row (Name | Bringing), then 2 row(s) whose first cells are Asha, Marek.',
  );
  const doc = page.getByRole("textbox", { name: "Document content" });
  const typed = await call(page, "write_text", { after: "[Table]", text: "Last year's table:" });
  expect(typed).toContain('right after the table, before "Full rules online."');
  expect(typed).toContain("now has 4 paragraph(s) with text, 1 table(s).");
  await expect(doc.locator("table").locator("xpath=following::p[1]")).toHaveText("Last year's table:");
  expect(await call(page, "write_text", { after: "Marek", text: "Sign up by Friday." })).toContain("right after the table");
  await expect(doc.locator("table").locator("xpath=following::p[1]")).toHaveText("Sign up by Friday.");
  await expect(doc.locator("table td, table th")).toHaveCount(6);

  await page.getByRole("button", { name: "AI assistant" }).first().click();
  const choose = page.getByRole("button", { name: "Choose file…" });
  await expect(call(page, "insert_image", { after: "Nowhere" })).rejects.toThrow(
    /paragraphs are: "Seed swap", "Bring seeds on Saturday.", a table starting "Name", "Sign up by Friday.".*use "table" or "photo"/,
  );
  await expect(choose).toHaveCount(0);
  const inserted = call(page, "insert_image", { after: "Last year's table:" });
  const chooser = page.waitForEvent("filechooser");
  await choose.click();
  await (await chooser).setFiles({
    name: "garden.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"),
  });
  expect(await inserted).toBe('Inserted the photo "garden.png" below "Last year\'s table:", above "Full rules online.".');
  const caption = await call(page, "write_text", { after: "photo", text: "Taken in May." });
  expect(caption).toContain('right after the photo "garden.png", before "Full rules online."');
  expect(caption).toContain("6 paragraph(s) with text, 1 table(s), 1 photo(s).");
  expect(await call(page, "write_text", { after: "garden.png", text: "By Ruth." })).toContain('right after the photo "garden.png", before "Taken in May."');
  expect(await call(page, "read_document")).toMatch(
    /\[Paragraph\] Last year's table:\n\d+\. \[Photo\] garden\.png\n\d+\. \[Paragraph\] By Ruth\.\n\d+\. \[Paragraph\] Taken in May\.\n\d+\. \[Paragraph\] Full rules online\./,
  );
  expect(await call(page, "insert_link", { text: "club site", url: "example.org" })).toContain(
    '"club site" was not in the document, so it was added at the end',
  );
});

test("file list tools search, filter, copy, rename and remove", async ({ page }) => {
  await page.goto("/");
  await waitForTools(page, "create_file");
  await call(page, "create_file", { kind: "document", title: "Club newsletter" });
  await waitForTools(page, "write_text");
  await call(page, "write_text", { text: "Harvest supper on Saturday." });
  expect(await call(page, "create_file", { kind: "spreadsheet", title: "Club budget" })).toContain('Open spreadsheet: "Club budget"');
  await expect(page.getByLabel("File title")).toHaveValue("Club budget");
  await call(page, "back_to_files");
  await waitForTools(page, "search_files");
  const rows = page.locator(".file-row");

  expect(await call(page, "search_files", { query: "harvest" })).toContain('1 file(s) match "harvest" (in the name or the text):\n- "Club newsletter": …Harvest supper');
  await expect(rows).toHaveCount(1);
  expect(await call(page, "duplicate_file", { name: "Club newsletter" })).toContain('called "Club newsletter copy"');
  await call(page, "rename_file", { name: "Club newsletter copy", new_name: "Club newsletter - November" });
  expect(await call(page, "show_files", { show: "documents", sort_by: "name" })).toContain('matching the search "harvest"');
  await expect(rows).toHaveText([/^Club newsletter(?! -)/, /^Club newsletter - November/]);
  await call(page, "remove_file", { name: "Club budget" });
  await expect(page.getByLabel("Search files")).toHaveValue("");
  expect(await call(page, "show_files", { show: "all" })).toBe(
    'Showing all.\n- "Club newsletter"\n- "Club newsletter - November"',
  );
});
