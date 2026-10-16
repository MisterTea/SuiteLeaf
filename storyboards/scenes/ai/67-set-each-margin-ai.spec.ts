import { createFile, serializeFile, type DocFile } from "@suiteleaf/core";
import type { Page } from "@playwright/test";
import { askAgent, caption, describeRun, expect, test } from "../harness";

const PROMPT =
  "Minutes is open. Set the top margin to 1.5 inches, the bottom to 0.75, the left to 1, and the right to 0.75. Do not use one margin for every edge. First try a top margin of 0, which must be refused and must not change the file. Then call page_setup once with margin_top_inches 1.5, margin_bottom_inches 0.75, margin_left_inches 1, and margin_right_inches 0.75. Stop.";

/** Saved page settings store each edge in CSS pixels, 96 per inch. */
const px = (inches: number) => Math.round(inches * 96);

/**
 * Minutes, as the page-setup story seeds it: a heading, one sentence, and a
 * single margin so every edge starts equal.
 */
function minutes(): DocFile {
  const file = createFile("doc", "Minutes") as DocFile;
  file.content = {
    type: "doc",
    attrs: {
      pageSettings: {
        margin: px(0.75),
      },
    },
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Town council minutes" }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "The title is in the top margin. The council approved the hall budget and set the next hearing.",
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

/** A page_setup call that asked for a top margin of 0. */
function triedZeroTop(args: unknown) {
  return /"(margin_top_inches|margin_top|top_margin|top_inches|topMargin|marginTop|top)"\s*:\s*0(?:\.0+)?(?!\d)/.test(
    JSON.stringify(args ?? {}),
  );
}

test("67-set-each-margin-ai", async ({ page }) => {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Minutes.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(minutes())),
  });
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toContainText("Town council minutes");
  await expect(editor).toContainText("The council approved the hall budget");
  const before = await editor.evaluate((el) => el.textContent ?? "");
  await caption(page, "Ben asks the on-device assistant to set each margin.");

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  const setups = run.items.filter((item) => item.kind === "tool" && item.name === "page_setup");
  expect(
    setups.some((item) => item.status === "error" && triedZeroTop(item.args)),
    why,
  ).toBe(true);

  await expect(page.getByRole("dialog", { name: "Page setup" }), why).toBeHidden();
  await expect(page.getByRole("status"), why).toContainText("Saved");
  const settings = await savedSettings(page);
  expect(settings.marginTop, why).toBe(px(1.5));
  expect(settings.marginBottom, why).toBe(px(0.75));
  expect(settings.marginLeft, why).toBe(px(1));
  expect(settings.marginRight, why).toBe(px(0.75));
  expect(settings.top, why).toBe(px(1.5));
  expect(settings.bottom, why).toBe(px(0.75));
  expect(settings.left, why).toBe(px(1));
  expect(settings.right, why).toBe(px(0.75));
  expect(settings.marginTop, why).not.toBe(0);
  expect(settings.top, why).not.toBe(0);
  expect(settings.marginBottom, why).not.toBe(0);
  expect(settings.marginLeft, why).not.toBe(0);
  expect(settings.marginRight, why).not.toBe(0);

  expect(await editor.evaluate((el) => el.textContent ?? ""), why).toBe(before);
  await expect(editor, why).toContainText("Town council minutes");
  await expect(editor, why).toContainText("The council approved the hall budget");
});
