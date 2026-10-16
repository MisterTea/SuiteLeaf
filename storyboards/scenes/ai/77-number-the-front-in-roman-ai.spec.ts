import { createFile, serializeFile, type DocFile } from "@suiteleaf/core";
import type { Page } from "@playwright/test";
import { askAgent, caption, describeRun, expect, test } from "../harness";

const PROMPT =
  'Field report is open. Call page_setup once with page_number_format roman. Then call set_numbering_restart once with heading "Chapter 1". The front pages read i and ii, and Arabic numbers start at Chapter 1. Leave the footer as Draft. Do not type the numbers into the document. Stop.';

/** The four-page report from the human story: two front pages, then Chapter 1. */
function report(): DocFile {
  const file = createFile("doc", "Field report") as DocFile;
  const paragraph = (text: string) => ({
    type: "paragraph",
    content: [{ type: "text", text }],
  });
  const heading = (text: string) => ({
    type: "heading",
    attrs: { level: 1 },
    content: [{ type: "text", text }],
  });
  file.content = {
    type: "doc",
    attrs: {
      pageSettings: {
        size: "letter",
        landscape: false,
        margin: 72,
        header: "",
        footer: "Draft",
        pageNumbers: true,
        pageNumberFormat: "page",
        pageNumberPosition: "bottom-center",
        pageNumberPositionSet: true,
      },
    },
    content: [
      heading("Contents"),
      paragraph("Maps and tables for the field season."),
      { type: "pageBreak" },
      heading("Figures"),
      paragraph("The site plan and the rain chart."),
      { type: "pageBreak" },
      heading("Chapter 1"),
      paragraph("The survey began in March."),
      { type: "pageBreak" },
      paragraph("The first chapter continues with the soil samples."),
    ],
  };
  return file;
}

const BODY = [
  "Contents",
  "Maps and tables for the field season.",
  "Figures",
  "The site plan and the rain chart.",
  "Chapter 1",
  "The survey began in March.",
  "The first chapter continues with the soil samples.",
];

type SavedNode = {
  type?: string;
  text?: string;
  attrs?: { startArabic?: boolean };
  content?: SavedNode[];
};

async function savedReport(page: Page) {
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
    const row = rows.find((item) => item.title === "Field report");
    if (!row?.native) throw new Error("Field report was not saved");
    return row.native;
  });
  return JSON.parse(native) as {
    content?: {
      attrs?: { pageSettings?: Record<string, unknown> };
      content?: SavedNode[];
    };
  };
}

function textsOf(node: SavedNode | undefined): string[] {
  if (!node) return [];
  const own = typeof node.text === "string" ? [node.text] : [];
  return [...own, ...(node.content ?? []).flatMap(textsOf)];
}

test("77-number-the-front-in-roman-ai", async ({ page }) => {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Field report.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(report())),
  });
  await expect(page.locator(".editor-status")).toContainText("4 pages");
  await expect(page.locator(".page-number")).toHaveText(["Page 1", "Page 2", "Page 3", "Page 4"]);
  await expect(page.locator(".page-footer-text").first()).toHaveText("Draft");
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toContainText("The survey began in March.");
  await caption(page, "Amara asks the on-device assistant to number the front in roman.");

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");
  expect(run.metrics.tools, why).toContain("set_numbering_restart");

  await expect(page.getByRole("dialog", { name: "Page setup" }), why).toBeHidden();
  await expect(page.getByRole("status"), why).toContainText("Saved");
  await expect(page.locator(".editor-status"), why).toContainText("4 pages");

  const saved = await savedReport(page);
  const settings = saved.content?.attrs?.pageSettings ?? {};
  expect(settings.pageNumberFormat, why).toBe("roman");
  expect(settings.footer, why).toBe("Draft");
  expect(settings.header, why).toBe("");
  expect(settings.pageNumbers, why).toBe(true);
  expect(settings.pageNumberPosition, why).toBe("bottom-center");
  expect(settings.pageNumberPositionSet, why).toBe(true);
  expect(settings.pageNumberStart ?? 1, why).toBe(1);
  expect(settings.margin, why).toBe(72);
  expect(settings.gutter ?? 0, why).toBe(0);
  expect(settings.coverHasNoNumber ?? false, why).toBe(false);

  const blocks = saved.content?.content ?? [];
  const arabic = blocks.filter((node) => node.type === "heading" && node.attrs?.startArabic === true);
  expect(arabic, why).toHaveLength(1);
  expect(textsOf(arabic[0]), why).toEqual(["Chapter 1"]);
  expect(blocks.flatMap(textsOf), why).toEqual(BODY);

  await expect(page.locator(".page-number"), why).toHaveText(["i", "ii", "1", "2"]);
  await expect(page.locator(".page-footer-text"), why).toHaveText(["Draft", "Draft", "Draft", "Draft"]);
  await expect(page.locator("h1[data-start-arabic='true']"), why).toHaveText("Chapter 1");
  await expect(editor, why).toContainText("Maps and tables for the field season.");
  await expect(editor, why).toContainText("The site plan and the rain chart.");
  await expect(editor, why).toContainText("The survey began in March.");
  await expect(editor, why).toContainText("The first chapter continues with the soil samples.");
  await expect(editor, why).not.toContainText("Draft");

  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await page.getByRole("link", { name: "Field report" }).click();
  await expect(page.locator(".editor-status"), why).toContainText("4 pages");
  await expect(page.locator(".page-number"), why).toHaveText(["i", "ii", "1", "2"]);
  await expect(page.locator(".page-footer-text"), why).toHaveText(["Draft", "Draft", "Draft", "Draft"]);
  await expect(page.locator("h1[data-start-arabic='true']"), why).toHaveText("Chapter 1");
});
