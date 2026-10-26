import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import JSZip from "jszip";
import { createFile, serializeFile, type JsonNode } from "../../packages/core/src";

const welcome =
  "Welcome to the October meeting of the Riverside Garden Club. We are glad you came to the greenhouse this evening. Before the frost we need to decide the south bed, and we want this welcome to stay easy to read while the vote itself stays compact. Please take a copy of the minutes and a seat near the door.";
const motion = [
  "Plant the south bed with beans.",
  "Second the motion and open the vote.",
  "The vote carries if members present agree.",
];

function item(text: string): JsonNode {
  return {
    type: "listItem",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

async function openMinutes(page: Page) {
  const file = createFile("doc", "Garden club minutes");
  if (file.kind !== "doc") throw new Error("expected a document");
  file.content = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: welcome }] },
      { type: "paragraph", content: [{ type: "text", text: "Motion" }] },
      { type: "bulletList", content: motion.map(item) },
    ],
  };
  await page.goto("/");
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({
    name: "minutes.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
    "greenhouse",
  );
}

function paragraph(page: Page, text: string) {
  const hasText = text === "Motion" ? /^Motion$/ : text;
  return page.locator(".document-content p", { hasText });
}

test.use({ viewport: { width: 1280, height: 800 } });

test("line spacing follows the caret, changes only the selection, and survives save and Word", async ({
  page,
}) => {
  await openMinutes(page);
  await paragraph(page, "greenhouse").click();
  const control = page.getByRole("button", { name: /Line spacing/ });
  await expect(control).toContainText("Single");
  await control.click();
  const menu = page.getByRole("listbox", { name: "Line spacing" });
  await expect(menu.getByRole("option", { name: "Single", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  for (const name of ["Single", "1.15", "1.5", "Double"])
    await expect(menu.getByRole("option", { name, exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await menu.getByRole("option", { name: "1.5", exact: true }).click();
  await expect(menu).toBeHidden();
  await expect(paragraph(page, "greenhouse")).toHaveAttribute("data-line-spacing", "1.5");
  await expect(paragraph(page, "Motion")).toHaveAttribute("data-line-spacing", "single");
  for (const line of motion)
    await expect(paragraph(page, line)).toHaveAttribute("data-line-spacing", "single");
  await expect(control).toContainText("1.5");

  await paragraph(page, motion[0]).click();
  await paragraph(page, motion[2]).click({ modifiers: ["Shift"] });
  await expect(control).toContainText("Single");
  await control.click();
  await page.getByRole("option", { name: "Double", exact: true }).click();
  await expect(paragraph(page, "greenhouse")).toHaveAttribute("data-line-spacing", "1.5");
  await expect(paragraph(page, "Motion")).toHaveAttribute("data-line-spacing", "single");
  for (const line of motion)
    await expect(paragraph(page, line)).toHaveAttribute("data-line-spacing", "double");

  await control.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox", { name: "Line spacing" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Escape");

  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Garden club minutes" }).click();
  await expect(paragraph(page, "greenhouse")).toHaveAttribute("data-line-spacing", "1.5");
  for (const line of motion)
    await expect(paragraph(page, line)).toHaveAttribute("data-line-spacing", "double");
  await paragraph(page, "greenhouse").click();
  await expect(page.getByRole("button", { name: /Line spacing/ })).toContainText("1.5");
  await paragraph(page, motion[0]).click();
  await expect(page.getByRole("button", { name: /Line spacing/ })).toContainText("Double");

  await page.getByRole("button", { name: "File", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export DOCX" }).click();
  const xml = await JSZip.loadAsync(await readFile((await (await download).path())!)).then(
    (zip) => zip.file("word/document.xml")!.async("string"),
  );
  const paragraphs = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((match) => match[0]);
  expect(paragraphs.find((p) => p.includes("greenhouse"))).toContain('w:line="360"');
  expect(paragraphs.find((p) => p.includes("beans"))).toContain('w:line="480"');
  expect(paragraphs.find((p) => p.includes(">Motion<"))).toContain('w:line="240"');
});
