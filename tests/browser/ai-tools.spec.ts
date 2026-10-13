import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
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
  const replaced = await call(page, "find_and_replace", { find: "recieve", replace: "receive", all: true });
  expect(replaced).toContain('Replaced 2 of 2 "recieve" with "receive", in: "We receive so much help.", "We receive it gladly."');
  expect(replaced).toContain('No "recieve" is left');
  await expect(doc).not.toContainText("recieve");
  expect(await call(page, "find_and_replace", { find: "recieve", replace: "receive" })).toContain(
    '"receive" is there 2 time(s), so it is already replaced',
  );
  await expect(call(page, "find_and_replace", { find: "recieve", replace: "obtain" })).rejects.toThrow('"recieve" was not found.');

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
  expect(await call(page, "page_setup", { margin_inches: 1 })).toContain('1.00" margins');
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expect(page.getByLabel("Page margins")).toHaveValue("1");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await call(page, "page_setup", { margin_inches: 3 })).toContain('1.50" margins (3" is outside');
  const download = page.waitForEvent("download");
  expect(await call(page, "export_document", { format: "html" })).toContain("downloaded to the browser's downloads");
  expect((await download).suggestedFilename()).toBe("Volunteer letter.html");
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

  expect(await call(page, "set_cells", { start: "A8", values: [["'Code'", "Amount"], ["007", "12.5"]] })).toMatch(/8\tCode\tAmount\n9\t007/);
  expect(await call(page, "set_cells", { range: "A10:B10", values: ["Double", "=B9*2"] })).toContain("Wrote A10:B10.");
  expect(await call(page, "set_cells", { start: "B9", values: [["20"]] })).toContain(
    "Formulas that recalculated by themselves: B10 =B9*2: 25 → 40.",
  );
  expect(await call(page, "set_cells", { start: "B10", values: [["40"]] })).toContain(
    "These formulas were replaced by fixed values, which will not update any more: B10 was =B9*2.",
  );
  expect(await call(page, "format_cells", { range: "B2:D6", number_format: "currency" })).toContain("$6,000.00");
  expect(await call(page, "format_cells", { range: "B2:D6", align: "right" })).toContain("aligned right");
  await expect(call(page, "format_cells", { range: "B2:B9,C2:C9", bold: true })).rejects.toThrow(/2 ranges; .*B2:C9 to cover them all/);
  expect(await call(page, "sort_range", { range: "A1:D5", column: "Budget", order: "descending", has_header: true })).toMatch(
    /2\tEngineering/,
  );
  await expect(page.locator(".sort-range-dialog")).toBeHidden();
  await call(page, "set_cells", { start: "I1", values: [["Item", "Qty"], ["Pens", "3"], ["Ink", "9"], ["Pads", "5"]] });
  expect(await call(page, "sort_range", { range: "I1:J4", column: "Qty", order: "descending", has_header: true })).toMatch(
    /1\tItem\tQty\n2\tInk\t9\n3\tPads\t5\n4\tPens\t3/,
  );
  expect(await call(page, "freeze", { rows: 1 })).toMatch(
    /^Row 1 \(Category, Budget, .*\) now stays at the top while scrolling\. No columns are frozen\.$/,
  );
  await expect(
    call(page, "create_pivot", { range: "A1:C5", rows: ["Category"], value: "Actual", summarize: "SUM", filter_column: "Category", filter_value: "October" }),
  ).rejects.toThrow(/No row has Category equal to "October"; its values are Engineering, .*Leave filter_column/);
  const pivot = await call(page, "create_pivot", {
    range: "A1:C5",
    rows: ["Category"],
    value: "Actual",
    summarize: "SUM",
    filter_column: "Category",
    number_format: "accounting",
  });
  expect(pivot).toContain("Pivot table");
  expect(pivot).toMatch(/Grand Total\t\d+/);
  expect(pivot).toMatch(/as accounting \(.+\): the source cells C2:C5 on sheet "Sheet1" were formatted that way/);
  expect(await call(page, "format_cells", { range: "B2:B6", number_format: "currency" })).toMatch(
    /source cells C2:C5 on sheet "Sheet1" were formatted as currency .* the pivot followed\. Shown as:\n.*\n1\tCategory\t[^\n]*\n2\t\w+\t\$/,
  );
  await expect(call(page, "format_cells", { range: "B2:B6", bold: true })).rejects.toThrow(
    /read-only: it follows A1:C5 on sheet "Sheet1".*its values are C2:C5/,
  );
  await expect(call(page, "set_cells", { start: "D2", values: [["note"]] })).rejects.toThrow(/use copy_pivot/);
  await call(page, "switch_sheet", { name: "Sheet1" });
  expect(await call(page, "copy_pivot")).toMatch(/new sheet "Pivot table \(copy\)", now the active sheet:\n.*\n1\tCategory/);
  expect(await call(page, "set_cells", { start: "D2", values: [["note"]] })).toContain("Wrote D2.");
});

test("spreadsheet filter tools say which rows are showing and what they add up to", async ({ page }) => {
  await page.goto("/");
  await waitForTools(page, "create_file");
  await call(page, "create_file", { kind: "spreadsheet", title: "Shop orders" });
  await waitForTools(page, "filter_rows");
  await call(page, "set_cells", {
    start: "A1",
    values: [
      ["Order", "Status", "Total"],
      ["#1", "Shipped", "48"],
      ["#2", "Pending", "112.5"],
      ["#3", "Cancelled", "64"],
      ["#4", "Pending", "39.99"],
    ],
  });
  const filtered = await call(page, "filter_rows", { column: "Status", show_values: ["pending"] });
  expect(filtered).toContain("2 of 4 row(s) shown, 2 hidden");
  expect(filtered).toMatch(/3\t#2\tPending\t112\.5\n5\t#4\tPending\t39\.99/);
  expect(filtered).not.toContain("Shipped");
  expect(filtered).toContain("Rows 2, 4 are hidden");
  expect(filtered).toContain("Sum of the shown rows: C (Total) 152.49.");
  const read = await call(page, "read_sheet", { range: "C2:C5" });
  expect(read).not.toContain("48");
  expect(read).toContain("Sum of the shown rows: C 152.49.");
  expect(await call(page, "clear_filter", { remove: true })).toContain("all 4 rows are shown");
  expect(await call(page, "read_sheet")).toContain("Shipped");
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

test("file tools download a file, remove it, and open it again without replacing newer changes", async ({ page }) => {
  // The AI panel is open, so files the tools ask for can be chosen there.
  await page.addInitScript(() => sessionStorage.setItem("suiteleaf.ai.open", "1"));
  await page.goto("/");
  await waitForTools(page, "create_file");
  await call(page, "create_file", { kind: "document", title: "Trip list" });
  await waitForTools(page, "write_text");
  expect(await call(page, "write_text", { text: "# Trip\n- Passport\n- Plug adapter" })).toContain("2 as bulleted list items");
  expect(await call(page, "set_list", { from_text: "- Passport", to_text: "Plug adapter", list: "bullet" })).toContain(
    'The paragraphs from "- Passport" to "Plug adapter" are already in a bullet list; nothing changed.',
  );
  expect(await call(page, "set_list", { from_text: "Plug adapter", list: "bullet" })).toContain("give to_text");
  const downloading = page.waitForEvent("download");
  expect(await call(page, "download_file")).toContain('Downloaded "Trip list.sldoc": one SuiteLeaf file with the whole document');
  const saved = test.info().outputPath("Trip list.sldoc");
  await (await downloading).saveAs(saved);
  expect(await call(page, "write_text", { text: "Sunglasses", after: "Plug adapter" })).toContain(
    "1 as new items of the bulleted list",
  );
  await expect(page.getByRole("textbox", { name: "Document content" }).locator("li")).toHaveText(["Passport", "Plug adapter", "Sunglasses"]);
  await expect(page.getByRole("status")).toContainText("Saved");
  await call(page, "back_to_files");
  await waitForTools(page, "open_from_computer");

  const choose = async () => {
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Choose file…" }).click();
    await (await chooser).setFiles(saved);
  };
  const [again] = await Promise.all([call(page, "open_from_computer"), choose()]);
  expect(again).toContain("“Trip list” is already in this browser");
  expect(again).toContain("The one here has newer changes");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

  expect(await call(page, "remove_file", { name: "Trip list" })).toContain("A copy that was downloaded or saved elsewhere is not affected");
  await expect(page.locator(".file-row")).toHaveCount(0);
  const [opened] = await Promise.all([call(page, "open_from_computer"), choose()]);
  expect(opened).toContain('Opened "Trip list.sldoc"');
  await expect(page.getByRole("textbox", { name: "Document content" }).locator("li")).toHaveText(["Passport", "Plug adapter"]);
  await waitForTools(page, "set_list");
  expect(await call(page, "set_list", { from_text: "Trip", list: "bullet" })).toBe('Made 1 paragraph(s) a bullet list: "Trip" (was Heading 1).');
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

test("a CSV opens through its import preview, with codes kept as text, and exports back", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("suiteleaf.ai.open", "1"));
  await page.goto("/");
  await waitForTools(page, "open_from_computer");
  const choose = async () => {
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Choose file…" }).click();
    await (await chooser).setFiles({
      name: "members.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("ID,Name,ZIP,Paid\n00412,Rosa,02139,45\n01205,Mei,10001,0\n"),
    });
  };
  const [opened] = await Promise.all([call(page, "open_from_computer", { keep_codes_as_text: true }), choose()]);
  expect(opened).toContain('Imported "members.csv" from its preview: 2 data rows · 4 columns · comma-separated, plus a header row.');
  expect(opened).toContain("Columns: ID (Text), Name (Text), ZIP (Text), Paid (Number). ID and ZIP have codes with leading zeros");
  expect(opened).toContain("01205\tMei\t10001\t0");
  await waitForTools(page, "export_spreadsheet");
  const download = page.waitForEvent("download");
  expect(await call(page, "export_spreadsheet", { format: "csv" })).toBe(
    `Exported the sheet "Sheet1" as "members.csv"; it downloaded to the browser's downloads.`,
  );
  const csv = readFileSync((await (await download).path())!, "utf8");
  expect(csv.trim().split(/\r?\n/)).toEqual(["ID,Name,ZIP,Paid", "00412,Rosa,02139,45", "01205,Mei,10001,0"]);
});
