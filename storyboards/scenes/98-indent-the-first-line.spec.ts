import { readFileSync } from "node:fs";
import JSZip from "jszip";
import type { Page } from "@playwright/test";
import { beat, caption, expect, test, typeSlowly } from "./harness";

const story =
  "The river was still dark when Mara reached the old bridge. She counted the lamps twice and waited for the first cart, both hands on the rail, the way her mother had taught her to wait, with her eyes on the far bank.";
const square =
  "By noon the market had filled the square. Someone was selling apples from a wooden crate, and the smell of warm bread came up from the bakery on the corner by the river road. The carts were already lined up.";
const citation =
  "Okada, Mara. The Lamps on the Bridge. Riverside Press, 2019. A study of the night market, the people who wait for the first cart, and the lamps that stay lit until morning over the water.";

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
    const advance = lines.length > 1 ? lines[1].top - lines[0].top : 0;
    return { lines, half, advance };
  });
}

function expectWrapped(info: Awaited<ReturnType<typeof linesOf>>) {
  expect(info.lines.length).toBeGreaterThan(1);
  expect(info.half).toBeGreaterThan(30);
}

test("98-indent-the-first-line", async ({ page }) => {
  await page.goto("/");
  await caption(
    page,
    "Nia opens a new document and types two paragraphs of a short story.",
  );
  await page.getByRole("button", { name: "New document" }).click();
  const title = page.getByLabel("File title");
  await title.click();
  await title.press("ControlOrMeta+A");
  await typeSlowly(page, "The lamps on the bridge", 28);
  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.click();
  await typeSlowly(page, story, 16);
  await page.keyboard.press("Enter");
  await typeSlowly(page, square, 16);
  await beat(page, 600);

  await caption(
    page,
    "First line and hanging live on the same control as line spacing and space before and after. No second dialog.",
  );
  await paragraph(page, "old bridge").click();
  const spacing = page.getByRole("button", { name: /Line spacing/ });
  await expect(spacing).toContainText("Single");
  await expect(spacing).toHaveAttribute("aria-label", /Special indent none/);
  await spacing.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("listbox", { name: "Line spacing" }),
  ).toBeVisible();
  await expect(
    page.getByRole("listbox", { name: "Special indent" }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "None", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("option", { name: "First line", exact: true }),
  ).toBeInViewport();
  await expect(
    page.getByRole("option", { name: "Hanging", exact: true }),
  ).toBeInViewport();
  await expect(
    page.getByRole("textbox", { name: "Indent by", exact: true }),
  ).toHaveValue("0.5");
  await expect(
    page.getByRole("textbox", { name: "Space before", exact: true }),
  ).toHaveValue("0");
  await expect(
    page.getByRole("textbox", { name: "Space after", exact: true }),
  ).toHaveValue("0");
  await beat(page, 1400);
  await page.getByRole("option", { name: "1.5", exact: true }).click();
  await expect(
    page.getByRole("listbox", { name: "Line spacing" }),
  ).toBeHidden();
  await expect(spacing).toContainText("1.5");
  await spacing.click();
  const after = page.getByRole("textbox", { name: "Space after", exact: true });
  await after.click();
  await page.keyboard.press("ControlOrMeta+A");
  await typeSlowly(page, "12", 80);
  await page.keyboard.press("Enter");
  await expect(after).toHaveValue("12");
  const beforeIndent = await linesOf(page, "old bridge");
  expectWrapped(beforeIndent);
  await beat(page, 800);

  await caption(
    page,
    "She chooses a first-line indent of 0.5 inches. Only that paragraph. Line spacing stays 1.5.",
  );
  await page.getByRole("option", { name: "First line", exact: true }).click();
  await expect(
    page.getByRole("option", { name: "First line", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("option", { name: "Hanging", exact: true }),
  ).toHaveAttribute("aria-selected", "false");
  await beat(page, 1200);
  await page.keyboard.press("Escape");
  await expect(paragraph(page, "old bridge")).toHaveAttribute(
    "data-first-line-indent",
    "0.5",
  );
  await expect(paragraph(page, "old bridge")).toHaveAttribute(
    "data-line-spacing",
    "1.5",
  );
  await expect(paragraph(page, "old bridge")).toHaveAttribute(
    "data-space-after",
    "12",
  );
  await expect(paragraph(page, "old bridge")).not.toHaveAttribute(
    "data-hanging-indent",
  );
  await expect(paragraph(page, "wooden crate")).not.toHaveAttribute(
    "data-first-line-indent",
  );
  await expect(spacing).toContainText("1.5");
  await expect(spacing).toHaveAttribute("aria-label", /Space after 12 points/);
  await expect(spacing).toHaveAttribute(
    "aria-label",
    /First line indent 0.5 inches/,
  );
  const storyLines = await linesOf(page, "old bridge");
  const squareLines = await linesOf(page, "wooden crate");
  expectWrapped(storyLines);
  expectWrapped(squareLines);
  expect(storyLines.lines[0].left - storyLines.lines[1].left).toBeGreaterThan(
    storyLines.half - 6,
  );
  expect(storyLines.lines[0].left - storyLines.lines[1].left).toBeLessThan(
    storyLines.half + 8,
  );
  expect(
    Math.abs(storyLines.lines[1].left - squareLines.lines[0].left),
  ).toBeLessThan(4);
  expect(
    Math.abs(squareLines.lines[0].left - squareLines.lines[1].left),
  ).toBeLessThan(4);
  expect(Math.abs(storyLines.advance - beforeIndent.advance)).toBeLessThan(2);
  await beat(page, 1600);

  await caption(
    page,
    "She selects both paragraphs and sets the same first-line indent. Both first lines move in.",
  );
  await paragraph(page, "old bridge").click();
  await paragraph(page, "wooden crate").click({ modifiers: ["Shift"] });
  await spacing.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("option", { name: "First line", exact: true }).click();
  await beat(page, 900);
  await page.keyboard.press("Escape");
  await expect(paragraph(page, "old bridge")).toHaveAttribute(
    "data-first-line-indent",
    "0.5",
  );
  await expect(paragraph(page, "wooden crate")).toHaveAttribute(
    "data-first-line-indent",
    "0.5",
  );
  await expect(paragraph(page, "old bridge")).toHaveAttribute(
    "data-line-spacing",
    "1.5",
  );
  await expect(paragraph(page, "old bridge")).toHaveAttribute(
    "data-space-after",
    "12",
  );
  await expect(paragraph(page, "wooden crate")).toHaveAttribute(
    "data-line-spacing",
    "single",
  );
  await expect(paragraph(page, "wooden crate")).not.toHaveAttribute(
    "data-space-after",
  );
  const both = await linesOf(page, "wooden crate");
  expect(both.lines[0].left - both.lines[1].left).toBeGreaterThan(
    both.half - 6,
  );
  await beat(page, 1400);

  await caption(
    page,
    "She sets the first paragraph back to none. Only that paragraph returns to the margin.",
  );
  await paragraph(page, "old bridge").click();
  await spacing.click();
  await page.getByRole("option", { name: "None", exact: true }).click();
  await beat(page, 800);
  await page.keyboard.press("Escape");
  await expect(paragraph(page, "old bridge")).not.toHaveAttribute(
    "data-first-line-indent",
  );
  await expect(paragraph(page, "old bridge")).not.toHaveAttribute(
    "data-hanging-indent",
  );
  await expect(paragraph(page, "wooden crate")).toHaveAttribute(
    "data-first-line-indent",
    "0.5",
  );
  await expect(paragraph(page, "old bridge")).toHaveAttribute(
    "data-line-spacing",
    "1.5",
  );
  await expect(paragraph(page, "old bridge")).toHaveAttribute(
    "data-space-after",
    "12",
  );
  const cleared = await linesOf(page, "old bridge");
  expect(Math.abs(cleared.lines[0].left - cleared.lines[1].left)).toBeLessThan(
    4,
  );
  const kept = await linesOf(page, "wooden crate");
  expect(kept.lines[0].left - kept.lines[1].left).toBeGreaterThan(
    kept.half - 6,
  );
  await beat(page, 1400);

  await caption(
    page,
    "She types a works-cited line and chooses a hanging indent of 0.5 inches from the same control.",
  );
  const endOfSquare = await paragraph(page, "wooden crate").evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter(
      (rect) => rect.width > 2 && rect.height > 2,
    );
    const last = rects[rects.length - 1];
    return { x: last.right - 4, y: last.top + last.height / 2 };
  });
  await page.mouse.click(endOfSquare.x, endOfSquare.y);
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+ArrowRight" : "End",
  );
  await page.keyboard.press("Enter");
  await spacing.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("option", { name: "Hanging", exact: true }).click();
  await expect(
    page.getByRole("option", { name: "Hanging", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("option", { name: "First line", exact: true }),
  ).toHaveAttribute("aria-selected", "false");
  await beat(page, 900);
  await page.keyboard.press("Escape");
  await page.locator(".document-content").focus();
  await typeSlowly(page, citation, 16);
  await expect(paragraph(page, "Riverside Press")).toHaveAttribute(
    "data-hanging-indent",
    "0.5",
  );
  await expect(paragraph(page, "Riverside Press")).not.toHaveAttribute(
    "data-first-line-indent",
  );
  await expect(paragraph(page, "wooden crate")).toHaveAttribute(
    "data-first-line-indent",
    "0.5",
  );
  await expect(paragraph(page, "wooden crate")).not.toHaveAttribute(
    "data-hanging-indent",
  );
  await expect(paragraph(page, "old bridge")).toHaveAttribute(
    "data-line-spacing",
    "1.5",
  );
  await expect(paragraph(page, "old bridge")).toHaveAttribute(
    "data-space-after",
    "12",
  );
  const hung = await linesOf(page, "Riverside Press");
  const margin = await linesOf(page, "old bridge");
  expectWrapped(hung);
  expect(hung.lines[1].left - hung.lines[0].left).toBeGreaterThan(
    hung.half - 6,
  );
  expect(hung.lines[1].left - hung.lines[0].left).toBeLessThan(hung.half + 8);
  expect(Math.abs(hung.lines[0].left - margin.lines[0].left)).toBeLessThan(4);
  await paragraph(page, "Riverside Press").scrollIntoViewIfNeeded();
  await beat(page, 1600);

  await caption(
    page,
    "Increase indent still shifts a whole list item. The citation's hanging indent stays.",
  );
  await page.keyboard.press("Enter");
  await spacing.click();
  await page.getByRole("option", { name: "None", exact: true }).click();
  await page.keyboard.press("Escape");
  const toolbar = page.getByRole("toolbar", { name: "Document formatting" });
  await toolbar.getByRole("button", { name: "Bulleted list" }).click();
  await typeSlowly(page, "Apples", 40);
  await page.keyboard.press("Enter");
  await typeSlowly(page, "Pears", 40);
  await toolbar.getByRole("button", { name: "Increase indent" }).click();
  await expect(editor.locator("ul ul li")).toHaveText("Pears");
  await expect(paragraph(page, "Riverside Press")).toHaveAttribute(
    "data-hanging-indent",
    "0.5",
  );
  await expect(paragraph(page, "wooden crate")).toHaveAttribute(
    "data-first-line-indent",
    "0.5",
  );
  await editor.locator("ul ul li").scrollIntoViewIfNeeded();
  await beat(page, 1200);
  await toolbar.getByRole("button", { name: "Decrease indent" }).click();
  await expect(editor.locator("ul ul")).toHaveCount(0);
  await beat(page, 800);

  await caption(
    page,
    "She saves, returns home, and reopens. The first-line indent and the hanging indent are still there.",
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
    "data-line-spacing",
    "1.5",
  );
  await expect(paragraph(page, "old bridge")).toHaveAttribute(
    "data-space-after",
    "12",
  );
  await expect(paragraph(page, "old bridge")).not.toHaveAttribute(
    "data-first-line-indent",
  );
  await expect(paragraph(page, "wooden crate")).toHaveAttribute(
    "data-first-line-indent",
    "0.5",
  );
  await expect(paragraph(page, "Riverside Press")).toHaveAttribute(
    "data-hanging-indent",
    "0.5",
  );
  await expect(paragraph(page, "Riverside Press")).not.toHaveAttribute(
    "data-first-line-indent",
  );
  const reopenedStory = await linesOf(page, "wooden crate");
  const reopenedCite = await linesOf(page, "Riverside Press");
  expect(
    reopenedStory.lines[0].left - reopenedStory.lines[1].left,
  ).toBeGreaterThan(reopenedStory.half - 6);
  expect(
    reopenedCite.lines[1].left - reopenedCite.lines[0].left,
  ).toBeGreaterThan(reopenedCite.half - 6);
  await paragraph(page, "wooden crate").click();
  await expect(spacing).toHaveAttribute(
    "aria-label",
    /First line indent 0.5 inches/,
  );
  await beat(page, 700);
  await paragraph(page, "Riverside Press").click();
  await expect(spacing).toHaveAttribute(
    "aria-label",
    /Hanging indent 0.5 inches/,
  );
  // The paragraph switches follow the caret. Park them on the flush story
  // paragraph so they do not sit on the citation's wrapped line.
  await paragraph(page, "old bridge").click({ position: { x: 12, y: 8 } });
  await page
    .locator(".document-stage")
    .evaluate((el) => el.scrollTo({ top: 0, behavior: "smooth" }));
  await beat(page, 1800);

  await caption(
    page,
    "File, Export DOCX. The story paragraph has a first-line indent. The citation has a hanging indent.",
  );
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 600);
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export DOCX" }).click();
  const xml = await JSZip.loadAsync(
    readFileSync((await (await download).path())!),
  ).then((zip) => zip.file("word/document.xml")!.async("string"));
  const paragraphs = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(
    (match) => match[0],
  );
  const storyXml = paragraphs.find((item) => item.includes("old bridge"));
  const squareXml = paragraphs.find((item) => item.includes("wooden crate"));
  const citeXml = paragraphs.find((item) => item.includes("Riverside Press"));
  expect(storyXml).not.toContain("w:firstLine");
  expect(storyXml).not.toContain("w:hanging");
  expect(storyXml).toContain('w:line="360"');
  expect(storyXml).toContain('w:after="240"');
  expect(squareXml).toContain('w:firstLine="720"');
  expect(squareXml).not.toContain("w:hanging");
  expect(citeXml).toContain('w:hanging="720"');
  expect(citeXml).toContain('w:left="720"');
  expect(citeXml).not.toContain("w:firstLine");
  await caption(
    page,
    "The story's first line sits in. The citation's wrapped line sits in. Word keeps both.",
    2200,
  );
});
