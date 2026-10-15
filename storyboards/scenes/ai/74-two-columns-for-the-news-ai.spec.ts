import type { Page } from "@playwright/test";
import { createFile, serializeFile, type DocFile, type JsonNode } from "@suiteleaf/core";
import { askAgent, caption, describeRun, expect, test } from "../harness";

const heading = "Garden club news for the March plant sale";
const items = [
  "Plant sale Saturday at the hall. Bring pots, labels, and a bag for the extras.",
  "Compost workshop starts at ten. Members should bring gloves and a bucket.",
  "New officers this year: Nia chairs, and Sam keeps the minutes.",
];

const PROMPT =
  'Garden club news is open. Put only the three items under the heading into two columns. Leave the heading full width. Do not column the heading. Do not rewrite the newsletter text. Call set_columns once with from_text "Plant sale Saturday", to_text "New officers", and columns 2, then stop.';

function paragraph(text: string): JsonNode {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

async function seedNewsletter(page: Page) {
  const file = createFile("doc", "Garden club news") as DocFile;
  file.content = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: heading }] },
      ...items.map(paragraph),
    ],
  };
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
  }, {
    id: file.id,
    title: file.title,
    updatedAt: file.updatedAt,
    native: serializeFile(file),
  });
  await page.reload();
  await page.getByRole("link", { name: "Garden club news" }).click();
  await expect(page.getByRole("textbox", { name: "Document content" })).toBeVisible();
}

function textOf(node: JsonNode | undefined): string {
  if (!node) return "";
  if (node.text) return node.text;
  return (node.content ?? []).map((child) => textOf(child)).join("");
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

test("74-two-columns-for-the-news-ai", async ({ page }) => {
  await seedNewsletter(page);
  await caption(page, "Nia asks the on-device assistant to put the three news items in two columns.");
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(page.locator(".document-content > h1")).toHaveText(heading);
  await expect(page.locator(".doc-columns")).toHaveCount(0);
  await expect(editor).toContainText("Saturday");
  await expect(editor).toContainText("Sam keeps");

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");
  await expect(page.getByRole("status"), why).toContainText("Saved");

  const saved = await savedNewsletter(page);
  const top = saved.content?.content ?? [];
  const title = top.find((node) => node.type === "heading");
  expect(textOf(title), why).toBe(heading);
  expect(title?.type, why).toBe("heading");
  const groups = top.filter((node) => node.type === "columnLayout");
  expect(groups, why).toHaveLength(1);
  expect(groups[0]?.attrs?.columns, why).toBe(2);
  expect(textOf(groups[0]), why).not.toContain(heading);
  const body = (groups[0]?.content ?? []).filter((node) => node.type === "paragraph");
  expect(body.map((node) => textOf(node)), why).toEqual(items);
  expect(textOf(saved.content), why).toBe(heading + items.join(""));
  await expect(page.locator(".document-content > h1"), why).toHaveText(heading);
  await expect(page.locator(".doc-columns > p"), why).toHaveCount(3);
  await expect(page.locator(".doc-columns h1"), why).toHaveCount(0);
  await expect(page.locator(".doc-columns"), why).toContainText("Saturday");
  await expect(page.locator(".doc-columns"), why).toContainText("Sam keeps");
});
