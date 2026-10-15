import type { Page } from "@playwright/test";
import { createFile, serializeFile, type DocFile, type JsonNode } from "@suiteleaf/core";
import { askAgent, caption, describeRun, expect, test } from "../harness";

const PROMPT =
  "Saturday agenda is open. Set a 3 inch tab stop on the Plant sale, Compost, and Officers lines, and put a tab before 9:00, 10:30, and 11:00 so those three times share that column. Do not rewrite the names or the times. Do not use spaces. Call set_tab_stop for Plant sale at 3 inches before 9:00, Compost at 3 inches before 10:30, and Officers at 4 inches before 11:00. Then stop. Do not call write_text.";

const LINES = [
  { text: "Plant sale 9:00", time: "9:00" },
  { text: "Compost 10:30", time: "10:30" },
  { text: "Officers 11:00", time: "11:00" },
] as const;

function paragraph(text: string): JsonNode {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

async function seedAgenda(page: Page) {
  const file = createFile("doc", "Saturday agenda") as DocFile;
  file.content = {
    type: "doc",
    content: LINES.map((line) => paragraph(line.text)),
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
  await page.getByRole("link", { name: "Saturday agenda", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Document content" })).toBeVisible();
}

function textOf(node: JsonNode | undefined): string {
  if (!node) return "";
  if (node.text) return node.text;
  return (node.content ?? []).map((child) => textOf(child)).join("");
}

/** The time's text node starts at the time, and the node before it is a tab. */
function timeAfterTab(node: JsonNode, time: string): boolean {
  const content = node.content ?? [];
  for (let i = 0; i < content.length; i++) {
    const child = content[i];
    if (child.type === "text" && child.text?.includes(time))
      return child.text.startsWith(time) && content[i - 1]?.type === "tab";
  }
  return false;
}

function walk(node: JsonNode, visit: (node: JsonNode) => void) {
  visit(node);
  for (const child of node.content ?? []) walk(child, visit);
}

async function savedAgenda(page: Page) {
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
    const row = rows.find((item) => item.title === "Saturday agenda");
    if (!row?.native) throw new Error("Saturday agenda was not saved");
    return row.native;
  });
  return JSON.parse(native) as { content?: JsonNode };
}

async function timeLeft(page: Page, time: string) {
  return page.locator(".document-content").evaluate((root, time) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.textContent ?? "";
      const start = text.indexOf(time);
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + 1);
      return range.getClientRects()[0]?.left ?? null;
    }
    return null;
  }, time);
}

test("83-line-up-the-times-ai", async ({ page }) => {
  await seedAgenda(page);
  const editor = page.getByRole("textbox", { name: "Document content" });
  for (const line of LINES) await expect(editor).toContainText(line.text);
  await expect(page.locator("p[data-tab-stop]")).toHaveCount(0);
  const before = await Promise.all(LINES.map((line) => timeLeft(page, line.time)));
  expect(before.every((left) => left != null)).toBe(true);
  expect(Math.abs(before[0]! - before[2]!)).toBeGreaterThan(4);
  await caption(page, "Nia asks the on-device assistant to line the times up at 3 inches.");

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  await expect(page.locator("p[data-tab-stop='3']"), why).toHaveCount(3);
  await expect(page.locator("p[data-tab-stop='4']"), why).toHaveCount(0);
  for (const line of LINES) {
    await expect(page.locator(".document-content p", { hasText: line.time }), why).toHaveText(line.text);
  }
  await expect
    .poll(async () => {
      const left = await Promise.all(LINES.map((line) => timeLeft(page, line.time)));
      if (left.some((value) => value == null)) return false;
      const edges = left as number[];
      return Math.max(...edges) - Math.min(...edges) <= 2;
    }, { message: why })
    .toBe(true);

  await expect(page.getByRole("status"), why).toContainText("Saved");
  await expect
    .poll(async () => {
      const saved = await savedAgenda(page);
      const nodes: JsonNode[] = [];
      if (saved.content) walk(saved.content, (node) => nodes.push(node));
      const agenda = LINES.map((line) => nodes.find((node) => node.type === "paragraph" && textOf(node) === line.text));
      if (agenda.some((node) => !node)) return "missing";
      const stops = agenda.map((node) => Number(node?.attrs?.tabStop));
      const tabs = agenda.map((node, i) => timeAfterTab(node!, LINES[i].time));
      const names = agenda.map((node) => textOf(node));
      return `${stops.join(",")}|${tabs.join(",")}|${names.join(" / ")}`;
    }, { message: why })
    .toBe("3,3,3|true,true,true|Plant sale 9:00 / Compost 10:30 / Officers 11:00");
});
