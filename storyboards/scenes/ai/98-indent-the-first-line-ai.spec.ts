import type { Page } from "@playwright/test";
import { createFile, serializeFile, type DocFile, type JsonNode } from "@suiteleaf/core";
import { indentChoice, indentInches } from "@suiteleaf/core/paragraph-indent";
import { askAgent, caption, describeRun, expect, test } from "../harness";

const story =
  "The river was still dark when Mara reached the old bridge. She counted the lamps twice and waited for the first cart, both hands on the rail, the way her mother had taught her to wait, with her eyes on the far bank.";
const square =
  "By noon the market had filled the square. Someone was selling apples from a wooden crate, and the smell of warm bread came up from the bakery on the corner by the river road. The carts were already lined up.";
const citation =
  "Okada, Mara. The Lamps on the Bridge. Riverside Press, 2019. A study of the night market, the people who wait for the first cart, and the lamps that stay lit until morning over the water.";

const PROMPT =
  'The lamps on the bridge is open. Set a 0.5 inch first-line indent on each body paragraph, and a 0.5 inch hanging indent on the works-cited line. Do not indent the whole paragraph. Call set_indent with the body paragraph text, kind "first-line", and inches 0.5. Call set_indent with the works-cited text, kind "hanging", and inches 0.5. Then stop. Do not call write_text.';

function paragraph(text: string): JsonNode {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function storyFile(): DocFile {
  const file = createFile("doc", "The lamps on the bridge") as DocFile;
  file.content = {
    type: "doc",
    content: [paragraph(story), paragraph(square), paragraph(citation)],
  };
  return file;
}

async function seedStory(page: Page) {
  const file = storyFile();
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
  await page.getByRole("link", { name: "The lamps on the bridge" }).click();
  await expect(page.getByRole("textbox", { name: "Document content" })).toBeVisible();
  await expect(page.getByText("old bridge")).toBeVisible();
  await expect(page.getByText("wooden crate")).toBeVisible();
  await expect(page.getByText("Riverside Press")).toBeVisible();
}

function textOf(node: JsonNode | undefined): string {
  if (!node) return "";
  if (node.text) return node.text;
  return (node.content ?? []).map((child) => textOf(child)).join("");
}

function walk(node: JsonNode, visit: (node: JsonNode) => void) {
  visit(node);
  for (const child of node.content ?? []) walk(child, visit);
}

async function savedStory(page: Page) {
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
    const row = rows.find((item) => item.title === "The lamps on the bridge");
    if (!row?.native) throw new Error("The lamps on the bridge was not saved");
    return row.native;
  });
  return JSON.parse(native) as { content?: JsonNode };
}

test("98-indent-the-first-line-ai", async ({ page }) => {
  await seedStory(page);
  await caption(page, "Nia asks the on-device assistant to indent the first line and hang the citation.");
  const editor = page.getByRole("textbox", { name: "Document content" });
  const before = await editor.evaluate((el) => el.textContent ?? "");

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  await expect(page.getByRole("status"), why).toContainText("Saved");
  const bridge = page.locator(".document-content p", { hasText: "old bridge" });
  const market = page.locator(".document-content p", { hasText: "wooden crate" });
  const cited = page.locator(".document-content p", { hasText: "Riverside Press" });
  await expect(bridge, why).toHaveAttribute("data-first-line-indent", "0.5");
  await expect(bridge, why).not.toHaveAttribute("data-hanging-indent");
  await expect(market, why).toHaveAttribute("data-first-line-indent", "0.5");
  await expect(market, why).not.toHaveAttribute("data-hanging-indent");
  await expect(cited, why).toHaveAttribute("data-hanging-indent", "0.5");
  await expect(cited, why).not.toHaveAttribute("data-first-line-indent");
  expect(await editor.evaluate((el) => el.textContent ?? ""), why).toBe(before);

  const saved = await savedStory(page);
  const nodes: JsonNode[] = [];
  if (saved.content) walk(saved.content, (node) => nodes.push(node));
  const paragraphs = nodes.filter((node) => node.type === "paragraph" && textOf(node).trim());
  const byText = (needle: string) => paragraphs.find((node) => textOf(node).includes(needle));
  const storyNode = byText("old bridge");
  const squareNode = byText("wooden crate");
  const citeNode = byText("Riverside Press");
  expect(textOf(storyNode), why).toBe(story);
  expect(textOf(squareNode), why).toBe(square);
  expect(textOf(citeNode), why).toBe(citation);
  expect(indentChoice(storyNode?.attrs), why).toEqual({ kind: "firstLine", inches: 0.5 });
  expect(indentChoice(squareNode?.attrs), why).toEqual({ kind: "firstLine", inches: 0.5 });
  expect(indentChoice(citeNode?.attrs), why).toEqual({ kind: "hanging", inches: 0.5 });
  expect(indentInches(storyNode?.attrs?.hangingIndent), why).toBe(0);
  expect(indentInches(squareNode?.attrs?.hangingIndent), why).toBe(0);
  expect(indentInches(citeNode?.attrs?.firstLineIndent), why).toBe(0);
  const others = paragraphs.filter((node) => node !== storyNode && node !== squareNode && node !== citeNode);
  expect(others.map((node) => indentChoice(node.attrs)), why).toEqual([]);
});
