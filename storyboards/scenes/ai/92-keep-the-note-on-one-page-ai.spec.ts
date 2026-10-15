import type { Page } from "@playwright/test";
import {
  keepLinesHeading,
  keepLinesRecord,
  keepLinesSpacer,
  reminderLines,
} from "../../../tests/keep-lines-doc";
import { askAgent, caption, describeRun, expect, test } from "../harness";

const PROMPT =
  'Garden club news is open. The reminder is three lines: "Bring gloves,", "a hat,", and "and a trowel." "Bring gloves," is the last line of page 1, and "a hat," and "and a trowel." start page 2. Turn Keep lines together on for that reminder only, so all three lines sit on one page. "What to bring" and "Meet at the gate." stay on page 1. Call keep_lines_together once with text "Bring gloves," and on true, then stop. Do not rewrite the newsletter. Do not insert a page break. Do not call keep_with_next, dont_leave_one_line, write_text, insert_page_break, page_setup, or restore_paragraph.';

async function seed(page: Page) {
  await page.goto("/");
  await expect(page.getByLabel("Search files")).toBeVisible();
  await page.evaluate(async (record) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("SuiteLeaf");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("encoded", "readwrite");
        tx.objectStore("encoded").put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  }, keepLinesRecord());
  await page.reload();
}

/** Page of one line, not the whole paragraph that contains it. */
async function pageOfText(page: Page, text: string) {
  return page.evaluate((needle) => {
    const blocks = [
      ...document.querySelectorAll(
        ".document-content p, .document-content h1, .document-content h2, .document-content h3",
      ),
    ];
    const block = blocks.find((el) => el.textContent?.includes(needle));
    if (!block) return -1;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let combined = "";
    const parts: { node: Text; start: number }[] = [];
    let current: globalThis.Node | null;
    while ((current = walker.nextNode())) {
      if (!(current instanceof Text)) continue;
      parts.push({ node: current, start: combined.length });
      combined += current.textContent ?? "";
    }
    const at = combined.indexOf(needle);
    const part = [...parts].reverse().find((entry) => entry.start <= at);
    if (!part || at < 0) return -1;
    const range = document.createRange();
    const offset = at - part.start;
    range.setStart(part.node, offset);
    range.setEnd(part.node, Math.min(part.node.length, offset + 1));
    const rect = range.getBoundingClientRect();
    const mid = rect.top + Math.max(rect.height, 1) / 2;
    const pages = [...document.querySelectorAll(".page-furniture-page")];
    return pages.findIndex((paper) => {
      const box = paper.getBoundingClientRect();
      return mid >= box.top - 2 && mid < box.bottom + 2;
    });
  }, text);
}

type JsonNode = {
  type?: string;
  text?: string;
  attrs?: { keepLines?: boolean | null };
  content?: JsonNode[];
};

function textOf(node: JsonNode): string {
  if (node.text) return node.text;
  return (node.content ?? []).map(textOf).join("");
}

function walk(node: JsonNode, visit: (node: JsonNode) => void) {
  visit(node);
  for (const child of node.content ?? []) walk(child, visit);
}

async function savedNewsletter(page: Page) {
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
    const row = rows.find((item) => item.title === "Garden club news");
    if (!row?.native) throw new Error("Garden club news was not saved");
    return row.native;
  });
  return JSON.parse(native) as { content?: JsonNode };
}

test("92-keep-the-note-on-one-page-ai", async ({ page }) => {
  const [first, middle, last] = reminderLines;
  await seed(page);
  await caption(page, "Nia asks the on-device assistant to keep the reminder on one page.");
  await page.getByRole("link", { name: "Garden club news" }).click();
  await expect(page.getByRole("heading", { name: keepLinesHeading })).toBeVisible();
  await expect.poll(() => pageOfText(page, keepLinesHeading)).toBe(0);
  await expect.poll(() => pageOfText(page, keepLinesSpacer)).toBe(0);
  await expect.poll(() => pageOfText(page, first)).toBe(0);
  await expect.poll(() => pageOfText(page, middle)).toBe(1);
  await expect.poll(() => pageOfText(page, last)).toBe(1);
  const editor = page.getByRole("textbox", { name: "Document content" });
  const before = await editor.evaluate((el) => el.textContent ?? "");

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  await expect(page.getByRole("status"), why).toContainText("Saved");
  await expect(page.locator("p[data-keep-lines='true']"), why).toHaveCount(1);
  await expect(page.locator("p[data-keep-lines='true']"), why).toContainText(first);
  await expect(page.locator("p[data-keep-lines='true']"), why).toContainText(middle);
  await expect(page.locator("p[data-keep-lines='true']"), why).toContainText(last);
  await expect.poll(() => pageOfText(page, keepLinesHeading), { message: why }).toBe(0);
  await expect.poll(() => pageOfText(page, keepLinesSpacer), { message: why }).toBe(0);
  await expect.poll(() => pageOfText(page, first), { message: why }).toBe(1);
  await expect.poll(() => pageOfText(page, middle), { message: why }).toBe(1);
  await expect.poll(() => pageOfText(page, last), { message: why }).toBe(1);
  expect(await editor.evaluate((el) => el.textContent ?? ""), why).toBe(before);

  const saved = await savedNewsletter(page);
  const nodes: JsonNode[] = [];
  if (saved.content) walk(saved.content, (node) => nodes.push(node));
  const paragraph = nodes.find((node) => node.type === "paragraph" && textOf(node).includes(first));
  expect(paragraph?.attrs?.keepLines, why).toBe(true);
  expect(textOf(paragraph ?? {}), why).toContain(middle);
  expect(textOf(paragraph ?? {}), why).toContain(last);
  const others = nodes.filter((node) => node !== paragraph && node.attrs?.keepLines === true);
  expect(others.map(textOf), why).toEqual([]);
  const headingNode = nodes.find((node) => node.type === "heading" && textOf(node) === keepLinesHeading);
  expect(headingNode?.attrs?.keepLines ?? null, why).toBeNull();
  expect(nodes.some((node) => node.type === "pageBreak"), why).toBe(false);
});
