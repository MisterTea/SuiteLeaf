import type { Page } from "@playwright/test";
import { widowNewsletterRecord } from "../../../tests/widow-line-doc";
import { askAgent, caption, describeRun, expect, test } from "../harness";

const PROMPT =
  'Garden club news is open. The paragraph that ends with "See you Saturday." fills the bottom of page 1, and "See you Saturday." is the only line at the top of page 2. Turn Don\'t leave one line on for that paragraph only, so "See you Saturday." stays on page 2 together with "Bring a chair if you can." Call dont_leave_one_line once with text "See you Saturday." and on true, then stop. Do not rewrite the newsletter. Do not insert a page break. Do not change any other paragraph. Do not call write_text, page_setup, insert_page_break, keep_with_next, or restore_paragraph.';

async function seedNewsletter(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).waitFor();
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
  }, widowNewsletterRecord());
  await page.reload();
  await page.getByRole("link", { name: "Garden club news" }).waitFor();
}

/** Page of one line, not the paragraph that contains it. */
async function pageOfText(page: Page, text: string) {
  return page.evaluate((needle) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: globalThis.Node | null = null;
    let found: globalThis.Node | null = null;
    while ((node = walker.nextNode())) {
      if (node.textContent?.includes(needle)) found = node;
    }
    if (!found) return -1;
    const range = document.createRange();
    range.selectNodeContents(found);
    const rect = range.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    const pages = [...document.querySelectorAll(".page-furniture-page")];
    return pages.findIndex((paper) => {
      const box = paper.getBoundingClientRect();
      return mid >= box.top && mid < box.bottom;
    });
  }, text);
}

type JsonNode = {
  type?: string;
  text?: string;
  attrs?: { widowControl?: boolean | null; keepNext?: boolean | null };
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

test("89-dont-leave-one-line-behind-ai", async ({ page }) => {
  await seedNewsletter(page);
  await caption(page, "Nia asks the on-device assistant not to leave one line behind.");
  await page.getByRole("link", { name: "Garden club news" }).click();
  const heading = page.getByRole("heading", { name: "This month" });
  await expect(heading).toBeVisible();
  await expect.poll(() => pageOfText(page, "This month")).toBe(0);
  await expect.poll(() => pageOfText(page, "Roses stay on this page.")).toBe(0);
  await expect.poll(() => pageOfText(page, "Bring a chair if you can.")).toBe(0);
  await expect.poll(() => pageOfText(page, "See you Saturday.")).toBe(1);
  const editor = page.getByRole("textbox", { name: "Document content" });
  const before = await editor.evaluate((el) => el.textContent ?? "");

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  await expect(page.getByRole("status"), why).toContainText("Saved");
  await expect(page.locator("p[data-widow-control='true']"), why).toHaveCount(1);
  await expect(page.locator("p[data-widow-control='true']"), why).toContainText("See you Saturday.");
  await expect(page.locator("p[data-widow-control='true']"), why).toContainText("Bring a chair if you can.");
  await expect.poll(() => pageOfText(page, "This month"), { message: why }).toBe(0);
  await expect.poll(() => pageOfText(page, "Roses stay on this page."), { message: why }).toBe(0);
  await expect.poll(() => pageOfText(page, "Bring a chair if you can."), { message: why }).toBe(1);
  await expect.poll(() => pageOfText(page, "See you Saturday."), { message: why }).toBe(1);
  expect(await editor.evaluate((el) => el.textContent ?? ""), why).toBe(before);

  const saved = await savedNewsletter(page);
  const nodes: JsonNode[] = [];
  if (saved.content) walk(saved.content, (node) => nodes.push(node));
  const paragraph = nodes.find(
    (node) => node.type === "paragraph" && textOf(node).includes("See you Saturday."),
  );
  expect(paragraph?.attrs?.widowControl, why).toBe(true);
  expect(textOf(paragraph ?? {}), why).toContain("Bring a chair if you can.");
  expect(textOf(paragraph ?? {}), why).toContain("Roses stay on this page.");
  const others = nodes.filter((node) => node !== paragraph && node.attrs?.widowControl === true);
  expect(others.map(textOf), why).toEqual([]);
  const headingNode = nodes.find((node) => node.type === "heading" && textOf(node) === "This month");
  expect(headingNode?.attrs?.widowControl ?? null, why).toBeNull();
  expect(nodes.some((node) => node.type === "pageBreak"), why).toBe(false);
});
