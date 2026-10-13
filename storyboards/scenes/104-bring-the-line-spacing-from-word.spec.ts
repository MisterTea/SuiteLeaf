import { readFileSync } from "node:fs";
import JSZip from "jszip";
import type { Page } from "@playwright/test";
import { lineSpacingStoryDocx } from "../../tests/word-line-spacing-fixtures";
import { beat, caption, expect, test } from "./harness";

const docxMime =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function paragraph(page: Page, text: string) {
  return page.locator(".document-content p", { hasText: text });
}

async function lineAdvance(page: Page, text: string) {
  return paragraph(page, text).evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter(
      (rect) => rect.width > 2 && rect.height > 2,
    );
    const tops: number[] = [];
    for (const rect of rects) {
      if (!tops.some((top) => Math.abs(top - rect.top) < 2)) tops.push(rect.top);
    }
    tops.sort((a, b) => a - b);
    if (tops.length < 2) throw new Error("paragraph did not wrap");
    const gaps = tops.slice(1).map((top, index) => top - tops[index]);
    return gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  });
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
  await expect(editor).toContainText("counted the lamps");
  await expect(editor).toContainText("slow count");
  await page.locator(".document-stage").evaluate((el) => el.scrollTo(0, 0));
}

async function showSpacing(
  page: Page,
  name: "Single" | "1.15" | "1.5" | "Double",
) {
  const spacing = page.getByRole("button", { name: /Line spacing/ });
  await expect(spacing).toContainText(name);
  await beat(page, 1000);
  await spacing.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const option = page
    .getByRole("listbox", { name: "Line spacing" })
    .getByRole("option", { name, exact: true });
  await expect(option).toHaveAttribute("aria-selected", "true");
  for (const preset of ["Single", "1.15", "1.5", "Double"])
    await expect(
      page.getByRole("option", { name: preset, exact: true }),
    ).toBeVisible();
  await beat(page, 1500);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox", { name: "Line spacing" })).toBeHidden();
}

test("104-bring-the-line-spacing-from-word", async ({ page }) => {
  await page.goto("/");
  await caption(
    page,
    "Nia opens a Word file. The story is spaced at 1.5. The next paragraph has no line spacing, so it stays single. The verse is double.",
  );
  await openWord(page, "The river at night.docx", await lineSpacingStoryDocx());
  const story = paragraph(page, "counted the lamps");
  const plain = paragraph(page, "wooden crate");
  const verse = paragraph(page, "slow count");
  const exact = paragraph(page, "exact height");
  await expect(story).toHaveAttribute("data-line-spacing", "1.5");
  await expect(story).toHaveAttribute("data-first-line-indent", "0.5");
  await expect(story).toHaveAttribute("style", /line-height:\s*2(?:;|$)/);
  await expect(story).toHaveAttribute("style", /text-indent:\s*0\.5in/);
  await expect(plain).toHaveAttribute("data-line-spacing", "single");
  await expect(plain).not.toHaveAttribute("data-first-line-indent");
  await expect(verse).toHaveAttribute("data-line-spacing", "double");
  await expect(verse).toHaveAttribute("style", /line-height:\s*2\.6666/);
  await expect(exact).toHaveAttribute("data-line-spacing", "single");
  await expect(exact).toContainText("still arrived");

  const storyLines = await linesOf(page, "counted the lamps");
  expect(storyLines.lines.length).toBeGreaterThan(1);
  expect(storyLines.lines[0].left - storyLines.lines[1].left).toBeGreaterThan(
    storyLines.half - 8,
  );
  const storyGap = await lineAdvance(page, "counted the lamps");
  const plainGap = await lineAdvance(page, "wooden crate");
  const verseGap = await lineAdvance(page, "slow count");
  expect(storyGap).toBeGreaterThan(plainGap * 1.25);
  expect(verseGap).toBeGreaterThan(storyGap * 1.15);
  await beat(page, 1800);

  await caption(
    page,
    "The line-spacing control shows 1.5. The first line is still indented half an inch. There is no second dialog.",
  );
  await story.click();
  const spacing = page.getByRole("button", { name: /Line spacing/ });
  await expect(spacing).toContainText("1.5");
  await expect(spacing).toHaveAttribute(
    "aria-label",
    /Line spacing, 1\.5\..*First line indent 0\.5 inches/,
  );
  await beat(page, 900);
  await spacing.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("listbox", { name: "Line spacing" }).getByRole("option", {
      name: "1.5",
      exact: true,
    }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("listbox", { name: "Special indent" }).getByRole("option", {
      name: "First line",
      exact: true,
    }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("textbox", { name: "Indent by", exact: true }),
  ).toHaveValue("0.5");
  await beat(page, 1700);
  await page.keyboard.press("Escape");

  await caption(page, "The plain paragraph shows Single.");
  await plain.click();
  await showSpacing(page, "Single");

  await caption(page, "The verse shows Double.");
  await verse.scrollIntoViewIfNeeded();
  await verse.click();
  await showSpacing(page, "Double");

  await caption(
    page,
    "An exact line height is not one of the four multiples. That paragraph stays single, and its words are still here.",
  );
  await exact.scrollIntoViewIfNeeded();
  await exact.click();
  await expect(spacing).toContainText("Single");
  await expect(exact).toContainText("exact height");
  await beat(page, 1400);

  await caption(
    page,
    "She sets the story back to Single. The verse stays double, and the first-line indent stays.",
  );
  await page
    .locator(".document-stage")
    .evaluate((el) => el.scrollTo({ top: 0, behavior: "smooth" }));
  await beat(page, 600);
  await story.click();
  await spacing.click();
  await page
    .getByRole("listbox", { name: "Line spacing" })
    .getByRole("option", { name: "Single", exact: true })
    .click();
  await expect(page.getByRole("listbox", { name: "Line spacing" })).toBeHidden();
  await expect(spacing).toContainText("Single");
  await expect(story).toHaveAttribute("data-line-spacing", "single");
  await expect(story).toHaveAttribute("data-first-line-indent", "0.5");
  await expect(verse).toHaveAttribute("data-line-spacing", "double");
  const tightened = await lineAdvance(page, "counted the lamps");
  expect(tightened).toBeLessThan(storyGap * 0.85);
  expect(await lineAdvance(page, "slow count")).toBeGreaterThan(verseGap * 0.9);
  await beat(page, 1600);
  await verse.scrollIntoViewIfNeeded();
  await verse.click();
  await expect(spacing).toContainText("Double");
  await beat(page, 1400);

  await caption(
    page,
    "She saves, returns home, and reopens. The verse is still double spaced.",
  );
  await page
    .locator(".document-stage")
    .evaluate((el) => el.scrollTo({ top: 0, behavior: "smooth" }));
  await beat(page, 700);
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await beat(page, 800);
  await page.getByRole("link", { name: /The river at night/ }).click();
  await expect(story).toHaveAttribute("data-line-spacing", "single");
  await expect(story).toHaveAttribute("data-first-line-indent", "0.5");
  await expect(plain).toHaveAttribute("data-line-spacing", "single");
  await expect(verse).toHaveAttribute("data-line-spacing", "double");
  await expect(exact).toHaveAttribute("data-line-spacing", "single");
  await verse.scrollIntoViewIfNeeded();
  await verse.click();
  await expect(spacing).toContainText("Double");
  await beat(page, 1400);

  await caption(
    page,
    "File, Export DOCX. The verse has line 480. The story she set back to single has line 240.",
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
  const storyXml = paragraphs.find((item) => item.includes("counted the lamps"));
  const verseXml = paragraphs.find((item) => item.includes("slow count"));
  const exactXml = paragraphs.find((item) => item.includes("exact height"));
  expect(verseXml).toContain('w:line="480"');
  expect(verseXml).toContain('w:lineRule="auto"');
  expect(storyXml).toContain('w:line="240"');
  expect(storyXml).toContain('w:lineRule="auto"');
  expect(storyXml).toContain('w:firstLine="720"');
  expect(exactXml).toContain('w:line="240"');
  expect(exactXml).not.toContain('w:lineRule="exact"');
  await caption(
    page,
    "The story is single, the verse is double, and the first line is still indented. Word keeps all three.",
    2200,
  );
});
