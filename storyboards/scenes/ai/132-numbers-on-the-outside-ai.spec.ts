import { createFile, serializeFile, type DocFile } from "@suiteleaf/core";
import { documentPageSettings, pageFace, type PageSettings } from "@suiteleaf/core/document-layout";
import type { Page } from "@playwright/test";
import { askAgent, caption, describeRun, expect, test } from "../harness";

const PROMPT =
  'Preface is open. The page number is already at the top right. Turn on different odd and even pages and leave the number on the outside edge. Even-page numbers go on the left. Odd-page numbers stay on the right. Call page_setup once with different_odd_even true. Do not pass page_number_position, header, even_header, odd_header, footer, or page_numbers. Do not type numbers into the header. Stop.';

const inch = (n: number) => n * 96;

function preface(): DocFile {
  const file = createFile("doc", "Preface") as DocFile;
  const paragraph = (text: string) => ({
    type: "paragraph",
    content: [{ type: "text", text }],
  });
  file.content = {
    type: "doc",
    attrs: {
      pageSettings: {
        size: "letter",
        landscape: false,
        margin: inch(1),
        marginTop: inch(1),
        marginBottom: inch(1),
        marginLeft: inch(1),
        marginRight: inch(1),
        header: "",
        footer: "",
        headerFromEdge: inch(0.5),
        footerFromEdge: inch(0.5),
        pageNumbers: true,
        pageNumberFormat: "page",
        pageNumberPosition: "top-right",
        pageNumberPositionSet: true,
        pageNumberStart: 1,
      },
    },
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Preface" }],
      },
      paragraph("The front matter starts here."),
      { type: "pageBreak" },
      paragraph("Notes on the second page."),
      { type: "pageBreak" },
      paragraph("Notes on the third page."),
      { type: "pageBreak" },
      paragraph("Notes on the fourth page."),
      { type: "pageBreak" },
      paragraph("The index ends the preface."),
    ],
  };
  return file;
}

async function savedSettings(page: Page): Promise<PageSettings> {
  const native = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open("SuiteLeaf");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => resolve(open.result);
    });
    const rows = await new Promise<{ title?: string; native?: string }[]>((resolve, reject) => {
      const tx = db.transaction("encoded", "readonly");
      const request = tx.objectStore("encoded").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const row = rows.find((item) => item.title === "Preface");
    if (!row?.native) throw new Error("Preface was not saved");
    return row.native;
  });
  const saved = JSON.parse(native) as {
    content?: { attrs?: { pageSettings?: Partial<PageSettings> } };
  };
  return documentPageSettings({
    type: "doc",
    attrs: { pageSettings: saved.content?.attrs?.pageSettings },
  });
}

test("132-numbers-on-the-outside-ai", async ({ page }) => {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Preface.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(preface())),
  });
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toContainText("The index ends the preface.");
  await expect(page.locator(".editor-status")).toContainText("5 pages");
  const faces = page.locator(".page-furniture-page");
  await expect(faces).toHaveCount(5);
  await expect(faces.nth(3)).toHaveAttribute("data-number-side", "top-right");
  await expect(faces.nth(3).locator(".page-number")).toHaveText("Page 4");
  await expect(faces.nth(4)).toHaveAttribute("data-number-side", "top-right");
  await expect(faces.nth(4).locator(".page-number")).toHaveText("Page 5");
  const before = await editor.evaluate((el) => el.textContent ?? "");
  await caption(page, "Sam asks the on-device assistant to put the numbers on the outside.");

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  await expect(page.getByRole("dialog", { name: "Page setup" }), why).toBeHidden();
  await expect(page.getByRole("status"), why).toContainText("Saved");
  const settings = await savedSettings(page);
  expect(settings.differentOddEven, why).toBe(true);
  expect(settings.pageNumbers, why).toBe(true);
  expect(settings.pageNumberFormat, why).toBe("page");
  expect(settings.pageNumberPosition, why).toBe("top-right");
  expect(settings.pageNumberPositionSet, why).toBe(true);
  expect(pageFace(settings, 3, 5), why).toMatchObject({
    numberSide: "top-left",
    pageNumber: "Page 4",
  });
  expect(pageFace(settings, 4, 5), why).toMatchObject({
    numberSide: "top-right",
    pageNumber: "Page 5",
  });
  for (const field of ["header", "footer", "evenHeader", "oddHeader", "evenFooter", "oddFooter"] as const) {
    expect(settings[field], why).not.toMatch(/\d/);
  }

  await expect(faces.nth(3), why).toHaveAttribute("data-number-side", "top-left");
  await expect(faces.nth(3).locator(".page-number"), why).toHaveText("Page 4");
  await expect(faces.nth(4), why).toHaveAttribute("data-number-side", "top-right");
  await expect(faces.nth(4).locator(".page-number"), why).toHaveText("Page 5");
  await expect(faces.nth(3).locator(".page-header"), why).toHaveText("");
  await expect(faces.nth(4).locator(".page-header"), why).toHaveText("");
  expect(await editor.evaluate((el) => el.textContent ?? ""), why).toBe(before);
});
