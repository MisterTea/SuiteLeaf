import { createFile, serializeFile, type DocFile } from "@suiteleaf/core";
import type { Page } from "@playwright/test";
import { askAgent, caption, describeRun, expect, test } from "../harness";

const PROMPT =
  'October minutes is open. Page numbers already say Page N at the bottom center. The footer is already Committee draft. Set Start at to 4 and turn on Cover has no number, so the cover has no number, the next page says Page 1, and Start at stays 4. Call page_setup once with page_number_start 4 and cover_has_no_number true. Stop. Do not type the page number into the footer or the document. Do not change the footer. Do not pass footer, header, page_numbers, or different_first_page. Do not call write_text.';

const BODY = [
  "October minutes",
  "The committee met on Tuesday. These pages belong in a packet that already has a cover and two letters.",
  "Votes",
  "The budget passed. The next meeting is in November.",
];

/** The two-page minutes from storyboard 75: Page N, bottom center, footer Committee draft. */
function minutes(): DocFile {
  const file = createFile("doc", "October minutes") as DocFile;
  file.content = {
    type: "doc",
    attrs: {
      pageSettings: {
        size: "letter",
        landscape: false,
        margin: 72,
        header: "",
        footer: "Committee draft",
        pageNumbers: true,
        pageNumberFormat: "page",
        pageNumberPosition: "bottom-center",
        pageNumberPositionSet: true,
      },
    },
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "October minutes" }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "The committee met on Tuesday. These pages belong in a packet that already has a cover and two letters.",
          },
        ],
      },
      { type: "pageBreak" },
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Votes" }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "The budget passed. The next meeting is in November.",
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
    const row = rows.find((item) => item.title === "October minutes");
    if (!row?.native) throw new Error("October minutes was not saved");
    return row.native;
  });
  const saved = JSON.parse(native) as {
    content?: { attrs?: { pageSettings?: Record<string, unknown> }; content?: unknown[] };
  };
  return saved.content?.attrs?.pageSettings ?? {};
}

test("75-start-numbering-at-ai", async ({ page }) => {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "October minutes.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(minutes())),
  });
  await expect(page.locator(".editor-status")).toContainText("2 pages");
  await expect(page.locator(".page-number")).toHaveText(["Page 1", "Page 2"]);
  const faces = page.locator(".page-furniture-page");
  await expect(faces.nth(0).locator(".page-footer-text")).toHaveText("Committee draft");
  await expect(faces.nth(1).locator(".page-footer-text")).toHaveText("Committee draft");
  await caption(page, "Ben asks the on-device assistant to start at 4, then leave the cover unnumbered.");

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  await expect(page.getByRole("dialog", { name: "Page setup" }), why).toBeHidden();
  await expect(page.getByRole("status"), why).toContainText("Saved");
  const settings = await savedSettings(page);
  expect(settings.pageNumberStart, why).toBe(4);
  expect(settings.coverHasNoNumber, why).toBe(true);
  expect(settings.footer, why).toBe("Committee draft");
  expect(settings.pageNumbers, why).toBe(true);
  expect(settings.pageNumberFormat, why).toBe("page");
  expect(settings.pageNumberPosition, why).toBe("bottom-center");

  await expect(faces.nth(0).locator(".page-number"), why).toHaveCount(0);
  await expect(faces.nth(0).locator(".page-footer-text"), why).toHaveText("Committee draft");
  await expect(faces.nth(1).locator(".page-number"), why).toHaveText("Page 1");
  await expect(faces.nth(1).locator(".page-footer-text"), why).toHaveText("Committee draft");
  await expect(page.locator(".editor-status"), why).toContainText("2 pages");

  const editor = page.getByRole("textbox", { name: "Document content" });
  for (const line of BODY) await expect(editor, why).toContainText(line);
  await expect(editor, why).not.toContainText("Committee draft");
  await expect(editor, why).not.toContainText("Page 4");
  await expect(editor, why).not.toContainText("Page 1");
});
