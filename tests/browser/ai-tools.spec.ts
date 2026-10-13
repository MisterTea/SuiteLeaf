import { test, expect, type Page } from "@playwright/test";

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
