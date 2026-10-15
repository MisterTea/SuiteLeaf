import { createFile, serializeFile, type DocFile } from "@suiteleaf/core";
import type { Page } from "@playwright/test";
import { askAgent, caption, describeRun, expect, test } from "../harness";

const PROMPT =
  'Minutes is open. Change the running header from Garden club minutes to October minutes, and set the footer to Draft. Do not type October minutes or Draft into the body. Do not remove page numbers. Call page_setup once with header "October minutes" and footer "Draft". Do not pass page_numbers, first_header, different_first_page, even_header, odd_header, or watermark. Leave page numbers on. Stop.';

const BODY = "The harvest supper is Saturday. Bring a dish to share.";

/** Minutes, as the storyboard opens them: one shared header and page numbers on. */
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
            text: "Present: Ben, Ruth, Marek, and Asha. The club agreed to mulch the beds.",
          },
        ],
      },
      { type: "pageBreak" },
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Decisions" }],
      },
      { type: "paragraph", content: [{ type: "text", text: BODY }] },
    ],
  };
  return file;
}

async function savedMinutes(page: Page) {
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
  return JSON.parse(native) as {
    content?: {
      attrs?: { pageSettings?: Record<string, unknown> };
      content?: unknown;
    };
  };
}

/** Text in the document body. Page settings, including the header and footer, are not walked. */
function bodyTexts(node: unknown): string[] {
  if (!node || typeof node !== "object") return [];
  const record = node as { text?: unknown; content?: unknown };
  const own = typeof record.text === "string" ? [record.text] : [];
  const children = Array.isArray(record.content) ? record.content.flatMap(bodyTexts) : [];
  return [...own, ...children];
}

test("64-edit-the-header-on-the-page-ai", async ({ page }) => {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Minutes.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(minutes())),
  });
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toContainText("October meeting");
  await expect(editor).toContainText(BODY);
  await expect(editor).toContainText("Decisions");
  await expect(page.locator(".editor-status")).toContainText("2 pages");
  await expect(page.locator(".page-header").nth(1)).toHaveText("Garden club minutes");
  await expect(page.locator(".page-number")).toHaveText(["1 / 2", "2 / 2"]);
  await expect(page.getByRole("status")).toContainText("Saved");
  const before = await savedMinutes(page);
  const beforeBody = bodyTexts(before.content?.content);
  expect(before.content?.attrs?.pageSettings?.header).toBe("Garden club minutes");
  expect(before.content?.attrs?.pageSettings?.pageNumbers).toBe(true);
  expect(beforeBody.join("\n")).not.toContain("October minutes");
  expect(beforeBody.join("\n")).not.toContain("Draft");
  await caption(page, "Ben asks the on-device assistant to change the running header and set the footer.");

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  await expect(page.getByRole("dialog", { name: "Page setup" }), why).toBeHidden();
  await expect(page.getByRole("status"), why).toContainText("Saved");
  const saved = await savedMinutes(page);
  const settings = saved.content?.attrs?.pageSettings ?? {};
  expect(settings.header, why).toBe("October minutes");
  expect(settings.footer, why).toBe("Draft");
  expect(settings.pageNumbers, why).toBe(true);
  const body = bodyTexts(saved.content?.content);
  expect(body, why).toEqual(beforeBody);
  expect(body.join("\n"), why).not.toContain("October minutes");
  expect(body.join("\n"), why).not.toContain("Draft");
});
