import { createFile, serializeFile, type DocFile } from "@suiteleaf/core";
import type { Page } from "@playwright/test";
import { askAgent, caption, describeRun, expect, test } from "../harness";

const PROMPT =
  'Call page_setup once with different_first_page true and first_header "Riverside Garden Club", then stop. Do not type into the document. Do not change the header, the footer, the margins, or the page numbers. first_header is page 1 only. Page 1 shows "Riverside Garden Club" and no page number. Page 2 still shows "Garden club minutes" and "2 / 2". Leave header as "Garden club minutes".';

/** Minutes, as the human story opens them: one header and page numbers on every page. */
function minutes(): DocFile {
  const file = createFile("doc", "Minutes") as DocFile;
  file.content = {
    type: "doc",
    attrs: {
      pageSettings: {
        size: "letter",
        landscape: false,
        margin: 72,
        header: "Garden club minutes",
        footer: "",
        pageNumbers: true,
      },
    },
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "October meeting" }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "The committee agreed the budget for the new shed and set the date of the dinner.",
          },
        ],
      },
      { type: "pageBreak" },
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Plot assignments" }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "North beds take the first twelve plots. South beds take the rest.",
          },
        ],
      },
    ],
  };
  return file;
}

async function savedSettings(page: Page) {
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
    const row = rows.find((item) => item.title === "Minutes");
    if (!row?.native) throw new Error("Minutes was not saved");
    return row.native;
  });
  const saved = JSON.parse(native) as {
    content?: { attrs?: { pageSettings?: Record<string, unknown> } };
  };
  return saved.content?.attrs?.pageSettings ?? {};
}

test("61-different-first-page-ai", async ({ page }) => {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Minutes.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(minutes())),
  });
  await expect(page.locator(".editor-status")).toContainText("2 pages");
  const headers = page.locator(".page-header");
  await expect(headers).toHaveCount(2);
  await expect(headers.nth(0)).toHaveText("Garden club minutes");
  await expect(headers.nth(1)).toHaveText("Garden club minutes");
  await expect(page.locator(".page-number")).toHaveText(["1 / 2", "2 / 2"]);
  await caption(page, "Ben asks the on-device assistant for a different first page.");

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  await expect(page.getByRole("dialog", { name: "Page setup" }), why).toBeHidden();
  await expect(page.getByRole("status"), why).toContainText("Saved");
  const settings = await savedSettings(page);
  expect(settings.differentFirstPage, why).toBe(true);
  expect(settings.firstHeader, why).toBe("Riverside Garden Club");
  expect(settings.firstFooter, why).toBe("");
  expect(settings.header, why).toBe("Garden club minutes");
  expect(settings.footer, why).toBe("");
  expect(settings.pageNumbers, why).toBe(true);

  await expect(headers.nth(0), why).toHaveText("Riverside Garden Club");
  await expect(headers.nth(1), why).toHaveText("Garden club minutes");
  await expect(page.locator(".page-furniture-page").nth(0).locator(".page-number"), why).toHaveCount(0);
  await expect(page.locator(".page-furniture-page").nth(1).locator(".page-number"), why).toHaveText("2 / 2");

  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor, why).toContainText("October meeting");
  await expect(editor, why).toContainText("North beds take the first twelve plots");
  await expect(editor, why).not.toContainText("Riverside Garden Club");

  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await page.getByRole("link", { name: "Minutes" }).click();
  await expect(page.locator(".editor-status")).toContainText("2 pages");
  await expect(headers.nth(0), why).toHaveText("Riverside Garden Club");
  await expect(headers.nth(1), why).toHaveText("Garden club minutes");
  await expect(page.locator(".page-furniture-page").nth(0).locator(".page-number"), why).toHaveCount(0);
  await expect(page.locator(".page-furniture-page").nth(1).locator(".page-number"), why).toHaveText("2 / 2");
});
