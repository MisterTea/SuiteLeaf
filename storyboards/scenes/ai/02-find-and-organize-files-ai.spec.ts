import { askAgent, beat, caption, describeRun, expect, openApp, test } from "../harness";

test("02-find-and-organize-files-ai", async ({ page }) => {
  await openApp(page);
  await caption(page, "Maya's library is empty, so she starts with a sample document.");
  await page.getByRole("button", { name: "Sample document" }).click();
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toContainText("Welcome to SuiteLeaf");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();

  await caption(page, "She asks the on-device assistant to set up the garden club's files.");
  const setup = await askAgent(
    page,
    "I look after the garden club's paperwork. Please make a spreadsheet called Garden club budget, a presentation called Garden club talk, and a document called Garden club newsletter that says: Harvest supper on Saturday. Bring a dish to share.",
  );
  let why = describeRun(setup);
  expect(setup.state, why).toBe("done");
  const back = page.getByRole("button", { name: "Back to files" });
  if (await back.isVisible()) await back.click();
  const rows = page.locator(".file-row");
  await expect(rows, why).toHaveCount(4);
  for (const name of ["Garden club budget", "Garden club talk", "Garden club newsletter", "Welcome to SuiteLeaf"])
    await expect(page.getByRole("link", { name, exact: true }), why).toBeVisible();
  await caption(page, "Gemma made the budget, the talk and the newsletter, each with its full name.", 2000);

  await caption(page, "She can't remember where she wrote about the harvest.");
  const find = await askAgent(page, "Which of my files mention the harvest?");
  why = describeRun(find);
  expect(find.state, why).toBe("done");
  await expect(page.getByRole("heading", { name: /Results for “.*harvest.*”/i }), why).toBeVisible();
  await expect(rows, why).toHaveCount(1);
  await expect(rows.first(), why).toContainText("Garden club newsletter");
  await expect(rows.first().locator(".file-snippet"), why).toContainText("Harvest supper on Saturday");
  await expect(rows.first(), why).toBeInViewport({ ratio: 1 });
  await caption(page, "\"Harvest\" is only inside the newsletter, so it's found and the line is quoted.", 2200);

  await caption(page, "Next she starts November's issue and tidies up.");
  const tidy = await askAgent(
    page,
    "Make a copy of the newsletter for November called Garden club newsletter - November. Then delete the Welcome to SuiteLeaf sample, I don't need it anymore. Then show me just my documents, A to Z.",
  );
  why = describeRun(tidy);
  expect(tidy.state, why).toBe("done");
  await expect(page.getByRole("link", { name: "Welcome to SuiteLeaf", exact: true }), why).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Garden club newsletter copy", exact: true }), why).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Documents", exact: true }), why).toBeVisible();
  await expect(page.getByRole("button", { name: "Sort by name" }), why).toHaveClass(/active/);
  await expect(rows, why).toHaveText([/^Garden club newsletter(?! -)/, /^Garden club newsletter - November/]);
  await caption(page, "The sample is gone, and her documents are listed A to Z: both newsletters, each with its own name.", 2400);

  await page.getByRole("button", { name: "All files", exact: true }).click();
  await expect(rows).toHaveCount(4);
  await caption(page, "All files: four garden club files.", 1400);
  await page.getByRole("link", { name: "Garden club newsletter", exact: true }).click();
  await expect(page.getByLabel("File title")).toHaveValue("Garden club newsletter");
  await expect(editor).toContainText("Harvest supper on Saturday.");
  await expect(editor).toContainText("Bring a dish to share.");
  await caption(page, "The original newsletter is unchanged, ready for October.", 1800);
  await beat(page, 600);
});
