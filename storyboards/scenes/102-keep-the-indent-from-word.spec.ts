import { readFileSync } from "node:fs";
import JSZip from "jszip";
import type { Page } from "@playwright/test";
import { indentedStoryDocx } from "../../tests/word-indent-fixtures";
import { beat, caption, expect, test } from "./harness";

const docxMime =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function paragraph(page: Page, text: string) {
  return page.locator(".document-content p", { hasText: text });
}

async function linesOf(page: Page, text: string) {
  return paragraph(page, text).evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter(
      (rect) => rect.width > 2 && rect.height > 2,
    );
    const lines: { top: number; left: number }[] = [];
    for (const rect of rects) {
      const line = lines.find((item) => Math.abs(item.top - rect.top) < 3);
      if (!line) lines.push({ top: rect.top, left: rect.left });
      else line.left = Math.min(line.left, rect.left);
    }
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:absolute;left:0;top:0;width:0.5in;height:1px;pointer-events:none;";
    el.appendChild(probe);
    const half = probe.getBoundingClientRect().width;
    probe.remove();
    return { lines, half };
  });
}

function expectWrapped(info: Awaited<ReturnType<typeof linesOf>>) {
  expect(info.lines.length).toBeGreaterThan(1);
  expect(info.half).toBeGreaterThan(20);
}

async function openWord(page: Page, name: string, bytes: Uint8Array) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (
    await chooser
  ).setFiles({
    name,
    mimeType: docxMime,
    buffer: Buffer.from(bytes),
  });
  const editor = page.getByRole("textbox", { name: "Document content" });
  const same = page.getByRole("dialog", { name: /already/ });
  await expect(editor.or(same)).toBeVisible();
  if (await same.isVisible()) {
    await same.getByRole("button", { name: "Keep both" }).click();
  }
  await expect(editor).toContainText("old bridge");
  await page.locator(".document-stage").evaluate((el) => el.scrollTo(0, 0));
}

async function showIndent(page: Page, kind: "First line" | "Hanging" | "None") {
  const spacing = page.getByRole("button", { name: /Line spacing/ });
  await spacing.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const option = page.getByRole("option", { name: kind, exact: true });
  await option.scrollIntoViewIfNeeded();
  await expect(option).toHaveAttribute("aria-selected", "true");
  if (kind !== "None") {
    await expect(
      page.getByRole("textbox", { name: "Indent by", exact: true }),
    ).toHaveValue("0.5");
  }
  await beat(page, 1600);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("listbox", { name: "Line spacing" }),
  ).toBeHidden();
}

test("102-keep-the-indent-from-word", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Nia opens the short story she wrote in Word.");
  await openWord(
    page,
    "The lamps on the bridge.docx",
    await indentedStoryDocx(),
  );
  await expect(paragraph(page, "old bridge")).toHaveAttribute(
    "data-first-line-indent",
    "0.5",
  );
  await expect(paragraph(page, "old bridge")).not.toHaveAttribute(
    "data-hanging-indent",
  );
  await expect(paragraph(page, "wooden crate")).not.toHaveAttribute(
    "data-first-line-indent",
  );
  await expect(paragraph(page, "wooden crate")).not.toHaveAttribute(
    "data-hanging-indent",
  );
  await expect(paragraph(page, "Riverside Press")).toHaveAttribute(
    "data-hanging-indent",
    "0.5",
  );
  await expect(paragraph(page, "Riverside Press")).not.toHaveAttribute(
    "data-first-line-indent",
  );

  await caption(
    page,
    "Only the story's first line sits in. The next line, and the plain paragraph, stay at the margin.",
  );
  const storyLines = await linesOf(page, "old bridge");
  const plainLines = await linesOf(page, "wooden crate");
  expectWrapped(storyLines);
  expectWrapped(plainLines);
  expect(storyLines.lines[0].left - storyLines.lines[1].left).toBeGreaterThan(
    storyLines.half - 6,
  );
  expect(storyLines.lines[0].left - storyLines.lines[1].left).toBeLessThan(
    storyLines.half + 8,
  );
  expect(
    Math.abs(storyLines.lines[1].left - plainLines.lines[0].left),
  ).toBeLessThan(4);
  expect(
    Math.abs(plainLines.lines[0].left - plainLines.lines[1].left),
  ).toBeLessThan(4);
  await beat(page, 1600);

  await caption(
    page,
    "The citation keeps a hanging indent. Its first line stays at the margin, and the wrapped line sits in.",
  );
  await paragraph(page, "Riverside Press").scrollIntoViewIfNeeded();
  const hung = await linesOf(page, "Riverside Press");
  const margin = await linesOf(page, "wooden crate");
  expectWrapped(hung);
  expect(hung.lines[1].left - hung.lines[0].left).toBeGreaterThan(
    hung.half - 6,
  );
  expect(hung.lines[1].left - hung.lines[0].left).toBeLessThan(hung.half + 8);
  expect(Math.abs(hung.lines[0].left - margin.lines[0].left)).toBeLessThan(4);
  await beat(page, 1800);

  await caption(
    page,
    "The line-spacing control names it. First line, 0.5 in. No second dialog.",
  );
  await paragraph(page, "old bridge").click();
  const spacing = page.getByRole("button", { name: /Line spacing/ });
  await expect(spacing).toHaveAttribute(
    "aria-label",
    /First line indent 0.5 inches/,
  );
  await showIndent(page, "First line");

  await caption(page, "The plain paragraph says None.");
  await paragraph(page, "wooden crate").click();
  await expect(spacing).toHaveAttribute("aria-label", /Special indent none/);
  await showIndent(page, "None");

  await caption(page, "The citation says Hanging, 0.5 in.");
  await paragraph(page, "Riverside Press").click();
  await expect(spacing).toHaveAttribute(
    "aria-label",
    /Hanging indent 0.5 inches/,
  );
  await showIndent(page, "Hanging");

  await caption(
    page,
    "She saves, returns home, and reopens. Both indents are still there.",
  );
  await page
    .locator(".document-stage")
    .evaluate((el) => el.scrollTo({ top: 0, behavior: "smooth" }));
  await beat(page, 700);
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await beat(page, 800);
  await page.getByRole("link", { name: /The lamps on the bridge/ }).click();
  await expect(paragraph(page, "old bridge")).toHaveAttribute(
    "data-first-line-indent",
    "0.5",
  );
  await expect(paragraph(page, "wooden crate")).not.toHaveAttribute(
    "data-first-line-indent",
  );
  await expect(paragraph(page, "wooden crate")).not.toHaveAttribute(
    "data-hanging-indent",
  );
  await expect(paragraph(page, "Riverside Press")).toHaveAttribute(
    "data-hanging-indent",
    "0.5",
  );
  await expect(paragraph(page, "Riverside Press")).not.toHaveAttribute(
    "data-first-line-indent",
  );
  const reopenedStory = await linesOf(page, "old bridge");
  const reopenedCite = await linesOf(page, "Riverside Press");
  expect(
    reopenedStory.lines[0].left - reopenedStory.lines[1].left,
  ).toBeGreaterThan(reopenedStory.half - 6);
  expect(
    reopenedCite.lines[1].left - reopenedCite.lines[0].left,
  ).toBeGreaterThan(reopenedCite.half - 6);
  await paragraph(page, "old bridge").click();
  await expect(spacing).toHaveAttribute(
    "aria-label",
    /First line indent 0.5 inches/,
  );
  await beat(page, 1400);

  await caption(
    page,
    "File, Export DOCX. The story still has a first-line indent. The citation still has a hanging indent.",
  );
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 700);
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export DOCX" }).click();
  const xml = await JSZip.loadAsync(
    readFileSync((await (await download).path())!),
  ).then((zip) => zip.file("word/document.xml")!.async("string"));
  const paragraphs = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(
    (match) => match[0],
  );
  const storyXml = paragraphs.find((item) => item.includes("old bridge"));
  const plainXml = paragraphs.find((item) => item.includes("wooden crate"));
  const citeXml = paragraphs.find((item) => item.includes("Riverside Press"));
  expect(storyXml).toContain('w:firstLine="720"');
  expect(storyXml).not.toContain("w:hanging");
  expect(citeXml).toContain('w:left="720"');
  expect(citeXml).toContain('w:hanging="720"');
  expect(citeXml).not.toContain("w:firstLine");
  expect(plainXml).not.toContain("w:ind");
  await caption(
    page,
    "The story's first line sits in. The citation's wrapped line sits in. Word keeps both.",
    2200,
  );
});
