import type { Locator, Page } from "@playwright/test";
import { gardenClubRecord } from "../../../tests/garden-club-news";
import { askAgent, caption, describeRun, expect, test } from "../harness";

const PROMPT =
  'Garden club news is open. The heading "This week" is the last line of page 1, and Seed swap, garden class, and work day start on page 2. Turn Keep with next on for the heading "This week" only, so that heading moves to page 2 with those three items. Call keep_with_next once with text "This week" and on true, then stop. Do not rewrite the newsletter. Do not insert a page break. Do not change any other paragraph. Do not call write_text, page_setup, insert_page_break, or restore_paragraph.';

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
  }, gardenClubRecord());
  await page.reload();
  await page.getByRole("link", { name: "Garden club news" }).waitFor();
}

async function pageOf(locator: Locator) {
  return locator.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const mid = rect.top + Math.min(rect.height, 12) / 2;
    const pages = [...document.querySelectorAll(".page-furniture-page")];
    return pages.findIndex((page) => {
      const box = page.getBoundingClientRect();
      return mid >= box.top && mid < box.bottom;
    });
  });
}

type JsonNode = {
  type?: string;
  text?: string;
  attrs?: { keepNext?: boolean | null };
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

test("86-keep-the-heading-with-the-list-ai", async ({ page }) => {
  await seedNewsletter(page);
  await caption(page, "Nia asks the on-device assistant to keep the heading with the list.");
  await page.getByRole("link", { name: "Garden club news" }).click();
  const heading = page.getByRole("heading", { name: "This week" });
  const items = [
    page.getByText("Seed swap on Saturday"),
    page.getByText("Garden class at ten"),
    page.getByText("Work day for members"),
  ];
  const beforeHeading = page.getByText("Questions go to the board before Friday.");
  await expect(heading).toBeVisible();
  await expect.poll(() => pageOf(heading)).toBe(0);
  await expect.poll(() => pageOf(beforeHeading)).toBe(0);
  await expect.poll(() => pageOf(items[0])).toBe(1);
  await expect.poll(() => pageOf(items[1])).toBe(1);
  await expect.poll(() => pageOf(items[2])).toBe(1);
  const editor = page.getByRole("textbox", { name: "Document content" });
  const before = await editor.evaluate((el) => el.textContent ?? "");

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  await expect(page.getByRole("status"), why).toContainText("Saved");
  await expect(heading, why).toHaveAttribute("data-keep-next", "true");
  await expect.poll(() => pageOf(beforeHeading), { message: why }).toBe(0);
  await expect.poll(() => pageOf(heading), { message: why }).toBe(1);
  await expect.poll(() => pageOf(items[0]), { message: why }).toBe(1);
  await expect.poll(() => pageOf(items[1]), { message: why }).toBe(1);
  await expect.poll(() => pageOf(items[2]), { message: why }).toBe(1);
  await expect(editor, why).toContainText("Meet at the gate. Bring gloves and a mug.");
  expect(await editor.evaluate((el) => el.textContent ?? ""), why).toBe(before);

  const saved = await savedNewsletter(page);
  const nodes: JsonNode[] = [];
  if (saved.content) walk(saved.content, (node) => nodes.push(node));
  const headingNode = nodes.find((node) => node.type === "heading" && textOf(node) === "This week");
  expect(headingNode?.attrs?.keepNext, why).toBe(true);
  const others = nodes.filter((node) => node !== headingNode && node.attrs?.keepNext === true);
  expect(others.map(textOf), why).toEqual([]);
  expect(nodes.some((node) => node.type === "pageBreak"), why).toBe(false);
});
