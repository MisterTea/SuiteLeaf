import { createFile, serializeFile, type DocFile } from "@suiteleaf/core";
import type { Page } from "@playwright/test";
import { askAgent, caption, describeRun, expect, test } from "../harness";

const PROMPT =
  "Thesis notes is open. Set the page margin to 2 inches. Call page_setup once with margin_inches 2, then stop. Do not rewrite the notes.";

const BODY =
  "The committee marks the bound copy in the margin. Two inches keeps their notes off the words, on every edge of the page.";

/** Saved page settings store each edge in CSS pixels, 96 per inch. */
const px = (inches: number) => Math.round(inches * 96);

/** Thesis notes at the usual 0.75 inch margin, well under two inches. */
function thesis(): DocFile {
  const file = createFile("doc", "Thesis notes") as DocFile;
  file.content = {
    type: "doc",
    attrs: {
      pageSettings: {
        margin: px(0.75),
      },
    },
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: BODY }],
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
    const row = rows.find((item) => item.title === "Thesis notes");
    if (!row?.native) throw new Error("Thesis notes was not saved");
    return row.native;
  });
  const saved = JSON.parse(native) as {
    content?: { attrs?: { pageSettings?: Record<string, unknown> } };
  };
  return saved.content?.attrs?.pageSettings ?? {};
}

/** How far the first line sits from the left edge of the paper, in inches. */
async function textLeftInches(page: Page) {
  return page.evaluate(() => {
    const paper = document.querySelector(".paginated-paper") as HTMLElement | null;
    const content = document.querySelector(".document-content") as HTMLElement | null;
    const first = content?.querySelector(":scope > *") as HTMLElement | null;
    if (!paper || !content || !first) throw new Error("The page is not on screen");
    const box = content.getBoundingClientRect();
    const paperBox = paper.getBoundingClientRect();
    const firstBox = first.getBoundingClientRect();
    const zoom = box.width / content.offsetWidth || 1;
    return (firstBox.left - paperBox.left) / zoom / 96;
  });
}

const EDGE_KEYS = [
  "marginTop",
  "marginBottom",
  "marginLeft",
  "marginRight",
  "top",
  "bottom",
  "left",
  "right",
] as const;

test("82-use-a-two-inch-margin-ai", async ({ page }) => {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Thesis notes.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(thesis())),
  });
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toContainText("The committee marks the bound copy");
  await expect(editor).toContainText("on every edge of the page");
  const before = await editor.evaluate((el) => el.textContent ?? "");
  const beforeLeft = await textLeftInches(page);
  expect(beforeLeft).toBeLessThan(1.5);
  await caption(page, "Priya asks the on-device assistant for a two-inch margin.");

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  await expect(page.getByRole("dialog", { name: "Page setup" }), why).toBeHidden();
  await expect(page.getByRole("status"), why).toContainText("Saved");
  const settings = await savedSettings(page);
  expect(settings.margin, why).toBe(px(2));
  for (const key of EDGE_KEYS) expect(settings[key], why).toBe(px(2));

  const afterLeft = await textLeftInches(page);
  expect(afterLeft, why).toBeGreaterThan(beforeLeft);
  expect(Math.abs(afterLeft - 2), why).toBeLessThanOrEqual(0.1);

  expect(await editor.evaluate((el) => el.textContent ?? ""), why).toBe(before);
  await expect(editor, why).toContainText(BODY);
});
