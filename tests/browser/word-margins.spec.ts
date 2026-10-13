import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { createFile, serializeFile } from "../../packages/core/src";
import {
  councilLetterDocx,
  plainNoteDocx,
} from "../word-margin-fixtures";

const docxType =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const tenth = 9.6;

async function openBytes(
  page: Page,
  name: string,
  mimeType: string,
  buffer: Buffer,
) {
  await expect(page.getByLabel("Search files")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Document content" })).toHaveCount(0);
  await page.locator("input[type=file]").setInputFiles({ name, mimeType, buffer });
  const keep = page.getByRole("button", { name: "Keep both", exact: true });
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor.or(keep)).toBeVisible();
  if (await keep.isVisible()) await keep.click();
  await expect(editor).toBeVisible();
}

async function insets(page: Page) {
  return page.evaluate(() => {
    const paper = document.querySelector(".paginated-paper") as HTMLElement;
    const content = document.querySelector(".document-content") as HTMLElement;
    const heading = content.querySelector("h1") as HTMLElement;
    const block = (content.querySelector("table") ?? heading) as HTMLElement;
    const zoom = Number(paper.style.zoom) || 1;
    const paperBox = paper.getBoundingClientRect();
    const headingBox = heading.getBoundingClientRect();
    const blockBox = block.getBoundingClientRect();
    const style = getComputedStyle(content);
    return {
      zoom,
      padTop: parseFloat(style.paddingTop),
      padRight: parseFloat(style.paddingRight),
      padBottom: parseFloat(style.paddingBottom),
      padLeft: parseFloat(style.paddingLeft),
      lineTop: (headingBox.top - paperBox.top) / zoom,
      lineLeft: (headingBox.left - paperBox.left) / zoom,
      blockLeft: (blockBox.left - paperBox.left) / zoom,
      blockRight: (paperBox.right - blockBox.right) / zoom,
    };
  });
}

function near(actual: number, inches: number) {
  expect(Math.abs(actual - inches * 96)).toBeLessThanOrEqual(tenth);
}

test("Word margins: four edges, layout, export, default, and a one-margin file", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto("/");
  await openBytes(
    page,
    "Council letter.docx",
    docxType,
    Buffer.from(await councilLetterDocx()),
  );
  await expect(page.getByRole("textbox", { name: "Document content" }).locator("h1")).toHaveText(
    "City Council",
  );
  const opened = await insets(page);
  expect(opened.zoom).toBe(1);
  near(opened.padTop, 1.5);
  near(opened.padBottom, 0.75);
  near(opened.padLeft, 1);
  near(opened.padRight, 0.75);
  near(opened.lineTop, 1.5);
  near(opened.lineLeft, 1);
  near(opened.blockLeft, 1);
  near(opened.blockRight, 0.75);

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Page setup" });
  await expect(setup.getByLabel("Top margin")).toHaveValue("1.5");
  await expect(setup.getByLabel("Bottom margin")).toHaveValue("0.75");
  await expect(setup.getByLabel("Left margin")).toHaveValue("1");
  await expect(setup.getByLabel("Right margin")).toHaveValue("0.75");
  await setup.getByLabel("Right margin").fill("1");
  await expect(setup.locator(".margin-preview-row span").nth(1)).toHaveText("1");
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  const changed = await insets(page);
  near(changed.padRight, 1);
  near(changed.padTop, 1.5);
  near(changed.padBottom, 0.75);
  near(changed.padLeft, 1);
  near(changed.blockRight, 1);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Export DOCX", exact: true }).click();
  const zip = await JSZip.loadAsync(await readFile((await (await download).path())!));
  const xml = await zip.file("word/document.xml")!.async("string");
  expect(xml).toContain('w:top="2160"');
  expect(xml).toContain('w:bottom="1080"');
  expect(xml).toContain('w:left="1440"');
  expect(xml).toContain('w:right="1440"');

  const native = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const saved = JSON.parse(await readFile((await (await native).path())!, "utf8"));
  expect(saved.content.attrs.pageSettings).toMatchObject({
    marginTop: 144,
    marginBottom: 72,
    marginLeft: 96,
    marginRight: 96,
  });

  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await openBytes(
    page,
    "Council letter.sldoc",
    "application/vnd.suiteleaf.doc+json",
    Buffer.from(JSON.stringify(saved)),
  );
  await expect(page.getByRole("heading", { name: "City Council" })).toBeVisible();
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const reopened = page.getByRole("dialog", { name: "Page setup" });
  await expect(reopened.getByLabel("Top margin")).toHaveValue("1.5");
  await expect(reopened.getByLabel("Bottom margin")).toHaveValue("0.75");
  await expect(reopened.getByLabel("Left margin")).toHaveValue("1");
  await expect(reopened.getByLabel("Right margin")).toHaveValue("1");
  await reopened.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await openBytes(page, "Plain note.docx", docxType, Buffer.from(await plainNoteDocx()));
  const plain = await insets(page);
  near(plain.padTop, 0.75);
  near(plain.padBottom, 0.75);
  near(plain.padLeft, 0.75);
  near(plain.padRight, 0.75);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const defaults = page.getByRole("dialog", { name: "Page setup" });
  for (const label of ["Top margin", "Bottom margin", "Left margin", "Right margin"])
    await expect(defaults.getByLabel(label)).toHaveValue("0.75");
  await defaults.getByRole("button", { name: "Cancel", exact: true }).click();

  const older = createFile("doc", "Older council letter");
  if (older.kind !== "doc") throw new Error("expected a document");
  older.content = {
    type: "doc",
    attrs: { pageSettings: { margin: 96 } },
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Older letter" }],
      },
    ],
  };
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await openBytes(
    page,
    "Older council letter.sldoc",
    "application/vnd.suiteleaf.doc+json",
    Buffer.from(serializeFile(older)),
  );
  const legacy = await insets(page);
  near(legacy.padTop, 1);
  near(legacy.padRight, 1);
  near(legacy.padBottom, 1);
  near(legacy.padLeft, 1);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const oneMargin = page.getByRole("dialog", { name: "Page setup" });
  for (const label of ["Top margin", "Bottom margin", "Left margin", "Right margin"])
    await expect(oneMargin.getByLabel(label)).toHaveValue("1");
});
