import { createFile, serializeFile, type DocFile } from "@suiteleaf/core";
import type { Page } from "@playwright/test";
import { askAgent, caption, describeRun, expect, test } from "../harness";

const PROMPT =
  'Minutes is open. Set the page numbers to the wording Page 1, at the bottom center, and set the footer to Committee draft. Then move the page number to the top right. Turn page numbers off, then turn them on again so Page 1 is still at the top right and Committee draft is still in the footer. Call page_setup with page_number_format page, page_number_position bottom-center, and footer Committee draft. Call page_setup with page_number_position top-right. Call page_setup with page_numbers false. Call page_setup with page_numbers true. Stop. Do not type the page number into the document. Keep the header Garden club minutes.';

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
        content: [{ type: "text", text: "Present: Ben, Ruth, and Joy." }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "The committee set the date and agreed the roof budget." }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "The next meeting is the first Tuesday of December." }],
      },
      { type: "pageBreak" },
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Actions" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "Ruth will order the wood. Joy will book the room." }],
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

test("65-choose-a-page-number-ai", async ({ page }) => {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Minutes.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(minutes())),
  });
  await expect(page.locator(".editor-status")).toContainText("2 pages");
  await expect(page.locator(".page-number")).toHaveText(["1 / 2", "2 / 2"]);
  await caption(page, "Ben asks the on-device assistant for “Page N” at the top right.");

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  await expect(page.getByRole("dialog", { name: "Page setup" }), why).toBeHidden();
  await expect(page.getByRole("status"), why).toContainText("Saved");
  const settings = await savedSettings(page);
  expect(settings.pageNumbers, why).toBe(true);
  expect(settings.pageNumberFormat, why).toBe("page");
  expect(settings.pageNumberPosition, why).toBe("top-right");
  expect(settings.pageNumberPositionSet, why).toBe(true);
  expect(settings.footer, why).toBe("Committee draft");
  expect(settings.header, why).toBe("Garden club minutes");

  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor, why).toContainText("October meeting");
  await expect(editor, why).toContainText("Ruth will order the wood. Joy will book the room.");
  await expect(editor, why).not.toContainText("Committee draft");
  await expect(page.locator(".page-number"), why).toHaveText(["Page 1", "Page 2"]);
  await expect(page.locator(".page-furniture-page").first(), why).toHaveAttribute("data-number-side", "top-right");
  await expect(page.locator(".page-footer").first(), why).not.toContainText("Page");
  await expect(page.locator(".page-header").first(), why).toHaveText("Garden club minutes");
  await expect(page.locator(".page-footer-text").first(), why).toHaveText("Committee draft");
});
