import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { createFile, serializeFile } from "../../packages/core/src";
import {
  councilLetterDocx,
  plainNoteDocx,
} from "../word-margin-fixtures";

const tenth = 0.1;

async function openBytes(
  page: Page,
  name: string,
  bytes: Uint8Array,
  mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
) {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name,
    mimeType: mime,
    buffer: Buffer.from(bytes),
  });
  const editor = page.getByRole("textbox", { name: "Document content" });
  const same = page.getByRole("dialog", { name: /already/ });
  await expect(editor.or(same)).toBeVisible();
  if (await same.isVisible())
    await same.getByRole("button", { name: "Keep both" }).click();
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

function closeEnough(
  actual: { top: number; right: number; bottom: number; left: number; textTop: number; textLeft: number },
  edges: { top: number; right: number; bottom: number; left: number },
) {
  for (const edge of ["top", "right", "bottom", "left"] as const)
    expect(Math.abs(actual[edge] - edges[edge])).toBeLessThanOrEqual(tenth);
  expect(Math.abs(actual.textTop - edges.top)).toBeLessThanOrEqual(tenth);
  expect(Math.abs(actual.textLeft - edges.left)).toBeLessThanOrEqual(tenth);
}

async function expectFields(
  page: Page,
  edges: { top: string; bottom: string; left: string; right: string },
) {
  const dialog = page.getByRole("dialog", { name: "Page setup" });
  await expect(dialog.getByLabel("Top margin")).toHaveValue(edges.top);
  await expect(dialog.getByLabel("Bottom margin")).toHaveValue(edges.bottom);
  await expect(dialog.getByLabel("Left margin")).toHaveValue(edges.left);
  await expect(dialog.getByLabel("Right margin")).toHaveValue(edges.right);
}

test("Word's four page margins show, lay out, and round-trip", async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.stack || e.message));

  await openBytes(page, "Council letter.docx", await councilLetterDocx());
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toContainText("City Council");
  closeEnough(await insets(page), { top: 1.5, right: 0.75, bottom: 0.75, left: 1 });

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expectFields(page, { top: "1.5", bottom: "0.75", left: "1", right: "0.75" });
  const right = page.getByLabel("Right margin");
  await right.fill("1");
  await expect(page.locator(".margin-preview-page")).toHaveClass(/edge-marginRight/);
  await expect(page.locator(".page-margin-note")).toContainText("Right is the edge that will move");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Page setup" })).toBeHidden();
  closeEnough(await insets(page), { top: 1.5, right: 1, bottom: 0.75, left: 1 });

  await page.getByRole("button", { name: "File", exact: true }).click();
  const docxDownload = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export DOCX", exact: true }).click();
  const docx = await JSZip.loadAsync(await readFile((await (await docxDownload).path())!));
  const xml = await docx.file("word/document.xml")!.async("string");
  expect(xml).toContain('w:top="2160"');
  expect(xml).toContain('w:bottom="1080"');
  expect(xml).toContain('w:left="1440"');
  expect(xml).toContain('w:right="1440"');

  const nativeDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const saved = JSON.parse(await readFile((await (await nativeDownload).path())!, "utf8"));
  expect(saved.content.attrs.pageSettings).toMatchObject({
    marginTop: 144,
    marginBottom: 72,
    marginLeft: 96,
    marginRight: 96,
  });

  await openBytes(page, "Council letter again.docx", await docx.generateAsync({ type: "uint8array" }));
  await expect(editor).toContainText("City Council");
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expectFields(page, { top: "1.5", bottom: "0.75", left: "1", right: "1" });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await openBytes(page, "Plain note.docx", await plainNoteDocx());
  await expect(editor).toContainText("Staff note");
  closeEnough(await insets(page), { top: 0.75, right: 0.75, bottom: 0.75, left: 0.75 });
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expectFields(page, { top: "0.75", bottom: "0.75", left: "0.75", right: "0.75" });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await openBytes(
    page,
    "Council letter.sldoc",
    Buffer.from(JSON.stringify(saved)),
    "application/json",
  );
  await expect(editor).toContainText("City Council");
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expectFields(page, { top: "1.5", bottom: "0.75", left: "1", right: "1" });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  const older = createFile("doc", "Older letter");
  if (older.kind !== "doc") throw new Error("expected a document");
  older.content = {
    type: "doc",
    attrs: { pageSettings: { margin: 96, pageNumbers: false } },
    content: [{ type: "paragraph", content: [{ type: "text", text: "Filed under one margin." }] }],
  };
  await openBytes(page, "Older letter.sldoc", Buffer.from(serializeFile(older)), "application/json");
  await expect(editor).toContainText("Filed under one margin.");
  closeEnough(await insets(page), { top: 1, right: 1, bottom: 1, left: 1 });
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expectFields(page, { top: "1", bottom: "1", left: "1", right: "1" });
  expect(errors).toEqual([]);
});
