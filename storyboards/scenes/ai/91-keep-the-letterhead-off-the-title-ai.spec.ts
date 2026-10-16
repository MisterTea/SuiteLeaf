import { createFile, serializeFile, type DocFile } from "@suiteleaf/core";
import type { Page } from "@playwright/test";
import { askAgent, caption, describeRun, expect, test } from "../harness";

const PROMPT =
  'Minutes is open. Set the top margin to 1 inch, the header to Town council, and header from edge to 1 inch. Call page_setup once with margin_top_inches 1, header "Town council", and header_from_edge_inches 1. Stop. Do not type the title into the header. Do not call write_text.';

const TITLE = "Minutes";
const LETTERHEAD = "Town council";
const BODY = "The hearing opens at seven.";

/** Saved page settings store each edge in CSS pixels, 96 per inch. */
const px = (inches: number) => Math.round(inches * 96);

/**
 * Minutes before page setup: a 0.75 inch margin, no letterhead, and the title
 * in the body. The assistant has to set the 1 inch margin, the header, and
 * the header distance.
 */
function minutes(): DocFile {
  const file = createFile("doc", "Minutes") as DocFile;
  const margin = px(0.75);
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
        header: "",
        footer: "",
        headerFromEdge: margin,
        footerFromEdge: margin,
        pageNumbers: false,
      },
    },
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: TITLE }],
      },
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
    const row = rows.find((item) => item.title === "Minutes");
    if (!row?.native) throw new Error("Minutes was not saved");
    return row.native;
  });
  const saved = JSON.parse(native) as {
    content?: { attrs?: { pageSettings?: Record<string, unknown> } };
  };
  return saved.content?.attrs?.pageSettings ?? {};
}

/** Where the letterhead and the title sit on the page, in inches. */
async function places(page: Page) {
  return page.evaluate(() => {
    const paper = document.querySelector(".paginated-paper") as HTMLElement | null;
    const content = document.querySelector(".document-content") as HTMLElement | null;
    const header = paper?.querySelector(".page-header") as HTMLElement | null;
    const sheet = header?.closest(".page-furniture-page") as HTMLElement | null;
    const title = (content?.querySelector("h1") ?? content?.querySelector("p")) as HTMLElement | null;
    if (!paper || !content || !header || !sheet || !title || paper.offsetWidth === 0) return null;
    const pageBox = sheet.getBoundingClientRect();
    const zoom = paper.getBoundingClientRect().width / paper.offsetWidth || 1;
    const fromTop = (el: HTMLElement) => (el.getBoundingClientRect().top - pageBox.top) / zoom / 96;
    const style = getComputedStyle(content);
    return {
      headerTop: fromTop(header),
      headerBottom: (header.getBoundingClientRect().bottom - pageBox.top) / zoom / 96,
      textTop: fromTop(title),
      padTop: parseFloat(style.paddingTop) / 96,
      headerText: (header.querySelector(".page-header-text")?.textContent ?? header.textContent ?? "").trim(),
      titleText: (title.textContent ?? "").trim(),
    };
  });
}

function near(actual: number, expected: number) {
  expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(0.1);
}

test("91-keep-the-letterhead-off-the-title-ai", async ({ page }) => {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Minutes.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(minutes())),
  });
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toContainText(TITLE);
  await expect(editor).toContainText(BODY);
  await caption(page, "Sam asks the on-device assistant to set the letterhead an inch down, off the title.");

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
  expect(settings.header, why).toBe(LETTERHEAD);
  expect(String(settings.header), why).not.toMatch(/minutes/i);
  expect(settings.headerFromEdge, why).toBe(px(1));
  expect(settings.marginTop, why).toBe(px(1));
  expect(settings.top, why).toBe(px(1));
  expect(settings.marginTop, why).not.toBe(px(1.5));
  expect(settings.headerFromEdge, why).not.toBe(px(0.5));
  expect(settings.headerFromEdge, why).not.toBe(px(1.5));

  await page.locator(".document-stage").evaluate((el) => {
    el.scrollTo({ top: 0 });
  });
  await expect.poll(async () => places(page), { timeout: 15000 }).not.toBeNull();
  const layout = await places(page);
  expect(layout, why).not.toBeNull();
  expect(layout!.headerText, why).toBe(LETTERHEAD);
  expect(layout!.headerText, why).not.toMatch(/minutes/i);
  expect(layout!.titleText, why).toBe(TITLE);
  near(layout!.headerTop, 1);
  expect(layout!.textTop, why).toBeGreaterThan(layout!.headerBottom);
  expect(layout!.padTop, why).toBeGreaterThan(1.1);
  await expect(editor, why).toContainText(TITLE);
  await expect(editor, why).toContainText(BODY);
});
