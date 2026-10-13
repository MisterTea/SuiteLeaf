import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { createFile, serializeFile } from "../../packages/core/src";
import {
  councilLetterDocx,
  plainNoteDocx,
} from "../../tests/word-margin-fixtures";
import { beat, caption, expect, test, typeSlowly } from "./harness";
import type { Download, Page } from "@playwright/test";

const editorOf = (page: Page) =>
  page.getByRole("textbox", { name: "Document content" });

async function openFile(
  page: Page,
  name: string,
  bytes: Uint8Array,
  mime: string,
  sameFileCaption?: string,
) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (await chooser).setFiles({
    name,
    mimeType: mime,
    buffer: Buffer.from(bytes),
  });
  const editor = editorOf(page);
  const same = page.getByRole("dialog", { name: /already/ });
  await expect(editor.or(same)).toBeVisible();
  if (await same.isVisible()) {
    if (sameFileCaption) await caption(page, sameFileCaption, 1600);
    await same.getByRole("button", { name: "Keep both" }).click();
  }
}

async function home(page: Page) {
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await expect(editorOf(page)).toHaveCount(0);
}

async function insets(page: Page) {
  return page.evaluate(() => {
    const paper = document.querySelector(".paginated-paper") as HTMLElement;
    const content = document.querySelector(".document-content") as HTMLElement;
    const first = content.querySelector(":scope > *") as HTMLElement;
    const box = content.getBoundingClientRect();
    const paperBox = paper.getBoundingClientRect();
    const firstBox = first.getBoundingClientRect();
    const style = getComputedStyle(content);
    const zoom = box.width / content.offsetWidth || 1;
    const pad = {
      top: parseFloat(style.paddingTop),
      right: parseFloat(style.paddingRight),
      bottom: parseFloat(style.paddingBottom),
      left: parseFloat(style.paddingLeft),
    };
    const inches = (px: number) => px / 96;
    return {
      top: inches((box.top - paperBox.top) / zoom + pad.top),
      right: inches((paperBox.right - box.right) / zoom + pad.right),
      bottom: inches((paperBox.bottom - box.bottom) / zoom + pad.bottom),
      left: inches((box.left - paperBox.left) / zoom + pad.left),
      textTop: inches((firstBox.top - paperBox.top) / zoom),
      textLeft: inches((firstBox.left - paperBox.left) / zoom),
    };
  });
}

function expectInsets(
  actual: { top: number; right: number; bottom: number; left: number; textTop: number; textLeft: number },
  edges: { top: number; right: number; bottom: number; left: number },
) {
  for (const edge of ["top", "right", "bottom", "left"] as const)
    expect(Math.abs(actual[edge] - edges[edge])).toBeLessThanOrEqual(0.1);
  expect(Math.abs(actual.textTop - edges.top)).toBeLessThanOrEqual(0.1);
  expect(Math.abs(actual.textLeft - edges.left)).toBeLessThanOrEqual(0.1);
}

async function openPageSetup(page: Page) {
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Page setup" })).toBeVisible();
}

async function expectMargins(page: Page, top: string, bottom: string, left: string, right: string) {
  const dialog = page.getByRole("dialog", { name: "Page setup" });
  await expect(dialog.getByLabel("Top margin")).toHaveValue(top);
  await expect(dialog.getByLabel("Bottom margin")).toHaveValue(bottom);
  await expect(dialog.getByLabel("Left margin")).toHaveValue(left);
  await expect(dialog.getByLabel("Right margin")).toHaveValue(right);
}

async function downloadBytes(download: Promise<Download>) {
  return readFileSync((await (await download).path())!);
}

test("78-keep-the-word-margins", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Sam opens the council's Word template.");
  await openFile(
    page,
    "Council letter.docx",
    await councilLetterDocx(),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  const editor = editorOf(page);
  await expect(editor).toContainText("City Council");
  await page.locator(".document-stage").evaluate((el) => el.scrollTo(0, 0));
  expectInsets(await insets(page), { top: 1.5, right: 0.75, bottom: 0.75, left: 1 });
  await caption(
    page,
    "The letterhead keeps its room: the title sits lower, and the left gap is wider than the right.",
    2200,
  );

  await caption(page, "Page setup already shows Word's four margins, in inches.");
  await openPageSetup(page);
  await expectMargins(page, "1.5", "0.75", "1", "0.75");
  await beat(page, 1600);

  await caption(page, "She sets Right to 1 inch. That edge lights up, and the other three stay.");
  const right = page.getByLabel("Right margin");
  await right.click();
  await expect(page.locator(".margin-preview-page")).toHaveClass(/edge-marginRight/);
  await expect(page.locator(".page-margin-note")).toContainText(
    "Right is the edge that will move",
  );
  await right.press("ControlOrMeta+A");
  await typeSlowly(page, "1", 120);
  await beat(page, 1200);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Page setup" })).toBeHidden();
  expectInsets(await insets(page), { top: 1.5, right: 1, bottom: 0.75, left: 1 });
  await caption(page, "Only the right gap grows. Top, bottom, and left are unchanged.", 1800);

  await caption(page, "She sends the letter back to Word.");
  const docxEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 1100);
  await page.getByRole("menuitem", { name: "Export DOCX", exact: true }).click();
  const docxBytes = await downloadBytes(docxEvent);
  const xml = await (await JSZip.loadAsync(docxBytes)).file("word/document.xml")!.async("string");
  expect(xml).toContain('w:top="2160"');
  expect(xml).toContain('w:bottom="1080"');
  expect(xml).toContain('w:left="1440"');
  expect(xml).toContain('w:right="1440"');
  await beat(page, 800);

  await caption(page, "She also keeps a SuiteLeaf copy.");
  const nativeEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const nativeBytes = await downloadBytes(nativeEvent);
  const saved = JSON.parse(nativeBytes.toString("utf8"));
  expect(saved.content.attrs.pageSettings).toMatchObject({
    marginTop: 144,
    marginBottom: 72,
    marginLeft: 96,
    marginRight: 96,
  });
  await beat(page, 700);

  await caption(page, "Opening that Word file again: Right is 1 inch, and the other three are the same.");
  await home(page);
  await openFile(
    page,
    "Council letter from Word.docx",
    docxBytes,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  await expect(editor).toContainText("City Council");
  await openPageSetup(page);
  await expectMargins(page, "1.5", "0.75", "1", "1");
  await beat(page, 1600);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await caption(page, "A letter with no page margins opens at the usual 0.75 inch on every edge.");
  await home(page);
  await openFile(
    page,
    "Plain note.docx",
    await plainNoteDocx(),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  await expect(editor).toContainText("This file has no page margins.");
  expectInsets(await insets(page), { top: 0.75, right: 0.75, bottom: 0.75, left: 0.75 });
  await openPageSetup(page);
  await expectMargins(page, "0.75", "0.75", "0.75", "0.75");
  await beat(page, 1600);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await caption(page, "The SuiteLeaf copy still has all four margins.");
  await home(page);
  await openFile(
    page,
    "Council letter.sldoc",
    nativeBytes,
    "application/json",
    "That copy is already in the library, so she keeps both and opens it.",
  );
  await expect(editor).toContainText("City Council");
  await openPageSetup(page);
  await expectMargins(page, "1.5", "0.75", "1", "1");
  await beat(page, 1400);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  const older = createFile("doc", "Older letter");
  if (older.kind !== "doc") throw new Error("expected a document");
  older.content = {
    type: "doc",
    attrs: { pageSettings: { margin: 96, pageNumbers: false } },
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Filed under one margin." }],
      },
    ],
  };
  await caption(page, "An older SuiteLeaf file stored one margin. Every edge opens at that margin.");
  await home(page);
  await openFile(
    page,
    "Older letter.sldoc",
    Buffer.from(serializeFile(older)),
    "application/json",
  );
  await expect(editor).toContainText("Filed under one margin.");
  expectInsets(await insets(page), { top: 1, right: 1, bottom: 1, left: 1 });
  await openPageSetup(page);
  await expectMargins(page, "1", "1", "1", "1");
  await beat(page, 1800);
});
