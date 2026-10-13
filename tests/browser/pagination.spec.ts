import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createFile, serializeFile } from "../../packages/core/src";
test("long paragraphs and tables paginate without changing document content", async ({
  page,
}) => {
  const file = createFile("doc", "Page flow regression");
  if (file.kind !== "doc") throw new Error();
  const text =
    "A long paragraph remains editable across page boundaries. ".repeat(160);
  const paragraph = (text: string) => ({
    type: "paragraph",
    content: [{ type: "text", text }],
  });
  file.content = {
    type: "doc",
    content: [
      paragraph(text),
      {
        type: "table",
        content: Array.from({ length: 50 }, (_, i) => ({
          type: "tableRow",
          content: [0, 1].map((c) => ({
            type: "tableCell",
            content: [paragraph(`Row ${i + 1}, column ${c + 1}`)],
          })),
        })),
      },
      paragraph("Document end"),
    ],
  };
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "flow.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  await expect(
    page.locator(".document-content > p .doc-page-spacer").first(),
  ).toBeAttached();
  await expect(page.locator("tr.doc-page-spacer").first()).toBeAttached();
  await expect(page.locator("tr.doc-page-spacer td").first()).toHaveAttribute(
    "colspan",
    "2",
  );
  expect(await page.locator(".page-furniture-page").count()).toBeGreaterThan(2);
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const saved = JSON.parse(
    await readFile((await (await waiting).path())!, "utf8"),
  );
  expect(saved.content.content[0].content[0].text).toBe(text);
  expect(saved.content.content[1].content).toHaveLength(50);
  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.press("ControlOrMeta+End");
  await page.getByRole("button", { name: "Page break", exact: true }).click();
  await expect(page.locator(".manual-page-break")).toHaveCount(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".manual-page-break")).toHaveCount(0);
});
test("a page break leaves the caret at the top of the new page", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "Ctrl+End and Ctrl+Enter are desktop shortcuts.");
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  const editor = page.getByRole("textbox", { name: "Document content" });
  const status = page.locator(".editor-status");
  // Let pagination redraw after typing before moving the caret, as a person would.
  const press = async (key: string) => {
    await page.waitForTimeout(100);
    await page.keyboard.press(key);
  };
  await editor.click();
  await page.keyboard.type("Minutes");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Page break", exact: true }).click();
  await page.keyboard.type("Appendix A");
  await expect(page.locator(".manual-page-break")).toHaveCount(1);
  await expect(status).toContainText("2 pages");
  await expect(editor.locator(":scope > p")).toHaveText([
    "Minutes",
    "Appendix A",
  ]);
  await page.waitForTimeout(300);
  await expect(editor.locator(":scope > p").last()).toBeInViewport();
  await press("ArrowUp");
  await page.keyboard.type("!");
  await expect(editor.locator(":scope > p").first()).toHaveText("Minutes!");
  await expect(page.locator(".manual-page-break")).toHaveCount(1);

  const mac = process.platform === "darwin";
  await press(mac ? "Meta+ArrowDown" : "Control+End");
  await press("ControlOrMeta+Enter");
  await page.keyboard.type("Appendix B");
  await expect(page.locator(".manual-page-break")).toHaveCount(2);
  await expect(status).toContainText("3 pages");
  await expect(editor.locator(":scope > p")).toHaveText([
    "Minutes!",
    "Appendix A",
    "Appendix B",
  ]);

  await press(mac ? "Meta+ArrowLeft" : "Home");
  await press("Backspace");
  await expect(page.locator(".manual-page-break")).toHaveCount(1);
  await expect(status).toContainText("2 pages");
});
