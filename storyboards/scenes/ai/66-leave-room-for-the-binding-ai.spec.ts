import { createFile, serializeFile, type DocFile } from "@suiteleaf/core";
import { documentPageSettings, pageSideInsets } from "@suiteleaf/core/document-layout";
import type { Page } from "@playwright/test";
import { askAgent, caption, describeRun, expect, test } from "../harness";

const PROMPT =
  "Minutes is open. Set a 0.5 inch gutter so odd pages start further from the left and even pages start further from the right, while the outside edge stays at the original margin. Do not change the four edge margins into one shared margin. Do not set the gutter back to 0. Call page_setup once with gutter_inches 0.5. Stop.";

/** Saved page settings store each edge in CSS pixels, 96 per inch. */
const px = (inches: number) => Math.round(inches * 96);

/** The default edge, the same on every side before a gutter is added. */
const MARGIN = px(0.75);

/**
 * Minutes, as the binding story seeds it: a cover, an even page, and an odd
 * page. Each edge keeps its own margin. There is no gutter yet.
 */
function minutes(): DocFile {
  const file = createFile("doc", "Minutes") as DocFile;
  const paragraph = (text: string) => ({
    type: "paragraph",
    content: [{ type: "text", text }],
  });
  file.content = {
    type: "doc",
    attrs: {
      pageSettings: {
        margin: MARGIN,
        marginTop: MARGIN,
        marginBottom: MARGIN,
        marginLeft: MARGIN,
        marginRight: MARGIN,
        top: MARGIN,
        bottom: MARGIN,
        left: MARGIN,
        right: MARGIN,
      },
    },
    content: [
      paragraph("Cover. These minutes are bound on the left."),
      paragraph("The club agreed on the tanks, the shed roof, and the harvest dinner."),
      { type: "pageBreak" },
      paragraph("Even page. On this side the binding is on the right."),
      paragraph("The timber for the shed roof is ordered before the end of the month."),
      { type: "pageBreak" },
      paragraph("Odd page. The binding is on the left again."),
      paragraph("The seed swap is in November, after the harvest dinner."),
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

/** First-line inset from the paper edge, in CSS pixels. */
async function lineBox(page: Page, marker: string) {
  await page
    .locator(".document-content p", { hasText: marker })
    .first()
    .evaluate((el) => el.scrollIntoView({ block: "center" }));
  return page.evaluate((needle) => {
    const paper = document.querySelector(".paginated-paper") as HTMLElement;
    const paperBox = paper.getBoundingClientRect();
    const scale = paperBox.width / paper.offsetWidth || 1;
    const el = [...document.querySelectorAll(".document-content p")].find((node) =>
      node.textContent?.includes(needle),
    ) as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(el);
    const line = range.getClientRects()[0];
    const block = el.getBoundingClientRect();
    return {
      lineLeft: (line.left - paperBox.left) / scale,
      blockRight: (paperBox.right - block.right) / scale,
    };
  }, marker);
}

test("66-leave-room-for-the-binding-ai", async ({ page }) => {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Minutes.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(minutes())),
  });
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toContainText("Cover. These minutes are bound on the left.");
  await expect(editor).toContainText("Even page. On this side the binding is on the right.");
  await expect(editor).toContainText("Odd page. The binding is on the left again.");
  await expect(page.locator(".editor-status")).toContainText("3 pages");
  await page.evaluate(() => document.fonts.ready);
  const beforeText = await editor.evaluate((el) => el.textContent ?? "");
  const before = await savedSettings(page);
  expect(before.gutter ?? 0).toBe(0);
  expect(before.margin).toBe(MARGIN);
  expect(before.marginTop).toBe(MARGIN);
  expect(before.marginBottom).toBe(MARGIN);
  expect(before.marginLeft).toBe(MARGIN);
  expect(before.marginRight).toBe(MARGIN);
  const beforeEven = await lineBox(page, "Even page");
  const beforeOdd = await lineBox(page, "Odd page");
  expect(Math.abs(beforeEven.lineLeft - beforeOdd.lineLeft)).toBeLessThan(2);
  expect(Math.abs(beforeEven.blockRight - beforeOdd.blockRight)).toBeLessThan(2);
  await caption(page, "Ben asks the on-device assistant to leave room for the binding.");

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  await expect(page.getByRole("dialog", { name: "Page setup" }), why).toBeHidden();
  await expect
    .poll(async () => (await savedSettings(page)).gutter, { timeout: 10000 })
    .toBe(px(0.5));
  const settings = await savedSettings(page);
  expect(settings.gutter, why).toBe(px(0.5));
  expect(settings.margin, why).toBe(MARGIN);
  expect(settings.marginTop, why).toBe(MARGIN);
  expect(settings.marginBottom, why).toBe(MARGIN);
  expect(settings.marginLeft, why).toBe(MARGIN);
  expect(settings.marginRight, why).toBe(MARGIN);
  expect(settings.top, why).toBe(MARGIN);
  expect(settings.bottom, why).toBe(MARGIN);
  expect(settings.left, why).toBe(MARGIN);
  expect(settings.right, why).toBe(MARGIN);

  const laid = documentPageSettings({
    type: "doc",
    attrs: { pageSettings: settings },
  });
  const oddInset = pageSideInsets(laid, 3);
  const evenInset = pageSideInsets(laid, 2);
  expect(laid.gutter, why).toBe(px(0.5));
  expect(oddInset.left - laid.left, why).toBe(px(0.5));
  expect(oddInset.right, why).toBe(laid.right);
  expect(evenInset.left, why).toBe(laid.left);
  expect(evenInset.right - laid.right, why).toBe(px(0.5));

  await expect(page.locator(".page-gutter-band"), why).toHaveCount(3);
  await expect(page.locator('[data-bind="odd"]', { hasText: "Odd page" }), why).toBeAttached();
  await expect(page.locator('[data-bind="even"]', { hasText: "Even page" }), why).toBeAttached();
  await expect(page.locator('[data-bind="odd"]', { hasText: "Cover" }), why).toBeAttached();
  const odd = await lineBox(page, "Odd page");
  const even = await lineBox(page, "Even page");
  expect(odd.lineLeft - beforeOdd.lineLeft, why).toBeGreaterThan(44);
  expect(odd.lineLeft - beforeOdd.lineLeft, why).toBeLessThan(52);
  expect(Math.abs(odd.blockRight - beforeOdd.blockRight), why).toBeLessThan(3);
  expect(Math.abs(even.lineLeft - beforeEven.lineLeft), why).toBeLessThan(3);
  expect(even.blockRight - beforeEven.blockRight, why).toBeGreaterThan(44);
  expect(even.blockRight - beforeEven.blockRight, why).toBeLessThan(52);

  expect(await editor.evaluate((el) => el.textContent ?? ""), why).toBe(beforeText);
});
