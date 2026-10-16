import { createFile, serializeFile, type DocFile } from "@suiteleaf/core";
import type { Page } from "@playwright/test";
import { askAgent, caption, describeRun, expect, test } from "../harness";

const PROMPT =
  "Council letter is open. Town council is 0.5 inches from the top. The footer is 0.5 inches from the edge. The top margin is 1 inch. Change only the header distance to 0.75 inches. The footer stays 0.5 inches. The top margin stays 1 inch. Call page_setup once with header_from_edge_inches 0.75, then stop. Do not change the footer. Do not change the body margin.";

const BODY = "The notes start an inch in from the edge of the page.";

/** Saved page settings store each edge in CSS pixels, 96 per inch. */
const px = (inches: number) => Math.round(inches * 96);

/**
 * The council letter, seeded with the distances Word would have imported:
 * header and footer half an inch from the edge, body an inch in.
 */
function letter(): DocFile {
  const file = createFile("doc", "Council letter") as DocFile;
  const margin = px(1);
  const edge = px(0.5);
  file.content = {
    type: "doc",
    attrs: {
      pageSettings: {
        margin,
        marginTop: margin,
        marginBottom: margin,
        marginLeft: margin,
        marginRight: margin,
        top: margin,
        bottom: margin,
        left: margin,
        right: margin,
        header: "Town council",
        footer: "Hearing notes",
        headerFromEdge: edge,
        footerFromEdge: edge,
        pageNumbers: false,
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
    const row = rows.find((item) => item.title === "Council letter");
    if (!row?.native) throw new Error("Council letter was not saved");
    return row.native;
  });
  const saved = JSON.parse(native) as {
    content?: { attrs?: { pageSettings?: Record<string, unknown> } };
  };
  return saved.content?.attrs?.pageSettings ?? {};
}

const MARGIN_KEYS = [
  "marginTop",
  "marginBottom",
  "marginLeft",
  "marginRight",
  "top",
  "bottom",
  "left",
  "right",
] as const;

test("87-keep-the-letterhead-distance-ai", async ({ page }) => {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Council letter.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(letter())),
  });
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toContainText("notes start an inch in");
  await expect(page.locator(".page-header").first()).toHaveText("Town council");
  await expect(page.locator(".page-footer").first()).toContainText("Hearing notes");
  const before = await editor.evaluate((el) => el.textContent ?? "");
  await caption(page, "Sam asks the on-device assistant to move only the letterhead.");

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");
  expect(
    run.items.some((item) => item.kind === "tool" && item.name === "page_setup" && item.status === "ok"),
    why,
  ).toBe(true);

  await expect(page.getByRole("dialog", { name: "Page setup" }), why).toBeHidden();
  await expect(page.getByRole("status"), why).toContainText("Saved");
  const settings = await savedSettings(page);
  expect(settings.headerFromEdge, why).toBe(px(0.75));
  expect(settings.footerFromEdge, why).toBe(px(0.5));
  expect(settings.headerFromEdge, why).not.toBe(px(0.5));
  expect(settings.footerFromEdge, why).not.toBe(px(0.75));
  expect(settings.header, why).toBe("Town council");
  expect(settings.footer, why).toBe("Hearing notes");
  for (const key of MARGIN_KEYS) {
    expect(settings[key], why).toBe(px(1));
    expect(settings[key], why).not.toBe(px(0.75));
    expect(settings[key], why).not.toBe(px(0.5));
  }
  expect(settings.margin, why).toBe(px(1));
  expect(settings.marginTop, why).toBe(px(1));
  expect(settings.top, why).toBe(px(1));

  expect(await editor.evaluate((el) => el.textContent ?? ""), why).toBe(before);
  await expect(editor, why).toContainText(BODY);
});
