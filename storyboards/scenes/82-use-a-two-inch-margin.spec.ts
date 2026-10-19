import { readFileSync } from "node:fs";
import JSZip from "jszip";
import type { Download, Page } from "@playwright/test";
import { pageEdgeInsets } from "../../tests/page-insets";
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

function expectTwoInches(insets: Awaited<ReturnType<typeof pageEdgeInsets>>) {
  for (const edge of ["left", "right", "top", "bottom"] as const)
    expect(Math.abs(insets[edge] - 2), edge).toBeLessThanOrEqual(0.1);
}

const marginFields = ["Top margin", "Bottom margin", "Left margin", "Right margin"];

async function replaceMargin(page: Page, value: string) {
  const setup = page.getByRole("dialog", { name: "Page setup" });
  for (const label of marginFields) {
    const field = setup.getByLabel(label);
    await field.scrollIntoViewIfNeeded();
    await field.click();
    await field.press("ControlOrMeta+A");
    await typeSlowly(page, value, 40);
  }
}

/** Park the pointer on the title so the error and the gray Apply button stay readable. */
async function pointAtTitle(page: Page) {
  await page
    .getByRole("dialog", { name: "Page setup" })
    .getByRole("heading", { name: "Page setup" })
    .hover();
  await beat(page, 400);
}

test("82-use-a-two-inch-margin", async ({ page }) => {
  await page.goto("/");
  await caption(
    page,
    "Priya is formatting her thesis. The department wants two inches of margin.",
  );
  const editor = await newDocument(page, "Thesis notes");
  await typeSlowly(
    page,
    "The committee marks the bound copy in the margin. Two inches keeps their notes off the words, on every edge of the page.",
    28,
  );
  await expect(page.getByRole("status")).toContainText("Saved");
  const before = await pageEdgeInsets(page);
  expect(before.left).toBeLessThan(1.5);
  await caption(
    page,
    "The text starts at the usual inset, well under two inches.",
    1800,
  );

  await caption(page, "In Page setup she sets the margin to 2 inches.", 800);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Page setup" });
  await expect(setup).toBeVisible();
  await replaceMargin(page, "2");
  const apply = setup.getByRole("button", { name: "Apply", exact: true });
  await expect(apply).toBeEnabled();
  await beat(page, 900);
  await apply.click();
  await expect(setup).toBeHidden();
  expectTwoInches(await pageEdgeInsets(page));
  const paper = await page.locator(".paginated-paper").boundingBox();
  if (paper) await page.mouse.move(paper.x + 48, paper.y + 80, { steps: 12 });
  await caption(
    page,
    "Apply commits it. The text moves in, and the gap is two inches on every edge.",
    2200,
  );

  await caption(page, "She tries 4 inches.", 700);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await replaceMargin(page, "4");
  await expect(setup.getByRole("alert")).toHaveText(
    "A margin cannot be more than 3 inches.",
  );
  await expect(apply).toBeDisabled();
  await page.keyboard.press("Enter");
  await expect(setup).toBeVisible();
  await pointAtTitle(page);
  await caption(
    page,
    "Four inches is refused. The reason is on the field, and Apply stays off.",
    2200,
  );

  await caption(page, "She tries 0.", 700);
  await replaceMargin(page, "0");
  await expect(setup.getByRole("alert")).toHaveText(
    "A margin must be at least 0.25 inches.",
  );
  await expect(apply).toBeDisabled();
  await pointAtTitle(page);
  await caption(
    page,
    "Zero is refused the same way. A margin must be at least 0.25 inches.",
    2200,
  );
  await setup.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(setup).toBeHidden();
  expectTwoInches(await pageEdgeInsets(page));
  await caption(page, "The page is still at two inches. She reopens the file.", 1600);

  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await beat(page, 600);
  await page.getByRole("link", { name: "Thesis notes" }).click();
  await expect(editor).toContainText("committee marks");
  expectTwoInches(await pageEdgeInsets(page));
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  for (const label of marginFields)
    await expect(setup.getByLabel(label)).toHaveValue("2");
  await beat(page, 1200);
  await caption(page, "The margin is still 2 inches after the file is reopened.", 1800);
  await setup.getByRole("button", { name: "Cancel", exact: true }).click();

  await caption(page, "She downloads Word. Every edge is two inches.", 800);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 500);
  await page.getByRole("menuitem", { name: "Export DOCX", exact: true }).click();
  const docx: Download = await downloading;
  const xml = await JSZip.loadAsync(readFileSync((await docx.path())!)).then((zip) =>
    zip.file("word/document.xml")!.async("string"),
  );
  expect(xml).toContain("<w:pgMar");
  for (const edge of ["top", "right", "bottom", "left"])
    expect(xml).toContain(`w:${edge}="2880"`);
  await caption(
    page,
    "The Word file writes two inches on the top, bottom, left, and right.",
    2200,
  );
});
