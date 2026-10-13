import { test, expect } from "@playwright/test";
import { createFile, serializeFile, type JsonNode } from "../../packages/core/src";

const heading = (level: number, text: string): JsonNode => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});
const paragraph = (text: string): JsonNode => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

test("table of contents stays live and footnotes link from the page", async ({ page }) => {
  const file = createFile("doc", "Notes and contents");
  if (file.kind !== "doc") throw new Error();
  const body = "The section runs long enough to reach another page. ".repeat(12);
  file.content = {
    type: "doc",
    content: [
      paragraph("Contents"),
      heading(1, "Introduction"),
      paragraph(body),
      heading(2, "Who we serve"),
      paragraph("Families across the city."),
      heading(1, "Results"),
      paragraph("Across the season attendance rose 40%."),
      heading(1, "Budget"),
      paragraph(body),
    ],
  };
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "notes.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor.getByRole("heading", { name: "Introduction" })).toBeVisible();
  await editor.locator("p").first().click();
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await page.getByRole("menuitem", { name: "Table of contents" }).hover();
  await page.getByRole("menuitem", { name: "With page numbers" }).click();
  const toc = page.getByRole("navigation", { name: "Table of contents" });
  await expect(toc.getByRole("button", { name: "Introduction" })).toBeVisible();
  await expect(toc.getByRole("button", { name: "Who we serve" })).toBeVisible();
  await expect(toc.getByRole("button", { name: "Budget" })).toBeVisible();
  await expect(toc.locator(".doc-toc-page").first()).not.toHaveText("");

  await editor.getByRole("heading", { name: "Results", exact: true }).click({ clickCount: 3 });
  await page.keyboard.type("What we achieved");
  await expect(toc.getByRole("button", { name: "What we achieved" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toHaveCount(0);

  await toc.getByRole("button", { name: "Contents options" }).click();
  await expect(toc.getByRole("menu", { name: "Contents options" })).toBeVisible();
  await toc.getByRole("menuitemradio", { name: "Heading 1 only" }).click();
  await expect(toc.getByRole("button", { name: "Who we serve" })).toHaveCount(0);
  await expect(toc.getByRole("button", { name: "Introduction" })).toBeVisible();
  await toc.getByRole("button", { name: "Contents options" }).click();
  await toc.getByRole("menuitemradio", { name: "Levels 1 to 3" }).click();
  await expect(toc.getByRole("button", { name: "Who we serve" })).toBeVisible();

  await toc.getByRole("button", { name: "Budget" }).click();
  await expect(editor.getByRole("heading", { name: "Budget" })).toBeInViewport();

  await editor.getByText("attendance rose 40%").click();
  await page.keyboard.press("ControlOrMeta+ArrowRight");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Alt+F" : "Control+Alt+F");
  await page.keyboard.type("League register, 2025.");
  await expect(editor.locator(".doc-note-ref")).toHaveText("1");
  const note = editor.locator(".doc-note[data-kind='footnote']");
  await expect(note).toContainText("League register, 2025.");
  await expect(note).toHaveClass(/doc-note-placed/);
  const refBox = await editor.locator(".doc-note-ref").boundingBox();
  const noteBox = await note.boundingBox();
  expect(refBox && noteBox).toBeTruthy();
  expect(noteBox!.y).toBeGreaterThan(refBox!.y);

  await note.locator(".doc-note-label").click();
  await expect(editor.locator(".doc-note-ref")).toBeInViewport();
});
