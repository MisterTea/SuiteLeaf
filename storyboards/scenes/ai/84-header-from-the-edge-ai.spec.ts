import { createFile, serializeFile, type DocFile } from "@suiteleaf/core";
import type { Page } from "@playwright/test";
import { askAgent, caption, describeRun, expect, test } from "../harness";

const PROMPT =
  "Thesis notes is open. Set Header from edge to 0.5 inches. Leave the body margin at 1 inch. Call page_setup once with header_from_edge_inches 0.5, then stop. Do not rewrite the notes. Do not pass margin_inches. Do not shrink the margin to move the header.";

const BODY = "The council notes start an inch in from the edge of the page.";

/** Saved page settings store each edge in CSS pixels, 96 per inch. */
const px = (inches: number) => Math.round(inches * 96);

/**
 * Thesis notes, as the header-from-edge story seeds it: a 1 inch margin and
 * the header "Town council" on that same inset.
 */
function thesis(): DocFile {
  const file = createFile("doc", "Thesis notes") as DocFile;
  const margin = px(1);
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
        headerFromEdge: margin,
        footerFromEdge: margin,
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
    const row = rows.find((item) => item.title === "Thesis notes");
    if (!row?.native) throw new Error("Thesis notes was not saved");
    return row.native;
  });
  const saved = JSON.parse(native) as {
    content?: { attrs?: { pageSettings?: Record<string, unknown> } };
  };
  return saved.content?.attrs?.pageSettings ?? {};
}

/** Header and first line, in inches from the top of the page. */
async function places(page: Page) {
  return page.evaluate(() => {
    const paper = document.querySelector(".paginated-paper") as HTMLElement | null;
    const content = document.querySelector(".document-content") as HTMLElement | null;
    const header = paper?.querySelector(".page-header") as HTMLElement | null;
    const footer = header?.closest(".page-furniture-page") as HTMLElement | null;
    const first = content?.querySelector("p") as HTMLElement | null;
    if (!paper || !content || !header || !footer || !first) throw new Error("The page is not on screen");
    const pageBox = footer.getBoundingClientRect();
    const zoom = paper.getBoundingClientRect().width / paper.offsetWidth || 1;
    const fromTop = (el: HTMLElement) => (el.getBoundingClientRect().top - pageBox.top) / zoom / 96;
    return {
      headerTop: fromTop(header),
      textTop: fromTop(first),
      padTop: parseFloat(getComputedStyle(content).paddingTop) / 96,
    };
  });
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

test("84-header-from-the-edge-ai", async ({ page }) => {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Thesis notes.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(thesis())),
  });
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toContainText("The council notes start an inch in");
  await expect(editor).toContainText("from the edge of the page");
  await expect(page.locator(".page-header").first()).toHaveText("Town council");
  const before = await editor.evaluate((el) => el.textContent ?? "");
  const beforePlaces = await places(page);
  expect(Math.abs(beforePlaces.headerTop - 1)).toBeLessThanOrEqual(0.1);
  await caption(page, "Priya asks the on-device assistant to move the header closer to the edge.");

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  await expect(page.getByRole("dialog", { name: "Page setup" }), why).toBeHidden();
  await expect(page.getByRole("status"), why).toContainText("Saved");
  const settings = await savedSettings(page);
  expect(settings.headerFromEdge, why).toBe(px(0.5));
  expect(settings.headerFromEdge, why).not.toBe(px(1));
  expect(settings.footerFromEdge, why).toBe(px(1));
  expect(settings.header, why).toBe("Town council");
  expect(settings.footer, why).toBe("Hearing notes");
  expect(settings.margin, why).toBe(px(1));
  expect(settings.margin, why).not.toBe(px(0.5));
  for (const key of MARGIN_KEYS) {
    expect(settings[key], why).toBe(px(1));
    expect(settings[key], why).not.toBe(px(0.5));
  }

  const afterPlaces = await places(page);
  expect(Math.abs(afterPlaces.headerTop - 0.5), why).toBeLessThanOrEqual(0.1);
  expect(afterPlaces.headerTop, why).toBeLessThan(beforePlaces.headerTop - 0.2);
  expect(Math.abs(afterPlaces.textTop - 1), why).toBeLessThanOrEqual(0.1);
  expect(Math.abs(afterPlaces.padTop - 1), why).toBeLessThanOrEqual(0.1);

  expect(await editor.evaluate((el) => el.textContent ?? ""), why).toBe(before);
  await expect(editor, why).toContainText(BODY);
});
