import type { Page } from "@playwright/test";
import { createFile, serializeFile, type DocFile, type JsonNode } from "@suiteleaf/core";
import { paragraphSpacePoints } from "@suiteleaf/core/paragraph-spacing";
import { askAgent, caption, describeRun, expect, test } from "../harness";

const welcome =
  "Welcome to the October meeting of the Riverside Garden Club. We are glad you came to the greenhouse this evening. Before the frost we need to decide the south bed, and we want this welcome to stay easy to read while the vote itself stays compact. Please take a copy of the minutes and a seat near the door.";
const motion = [
  "Plant the south bed with beans.",
  "Second the motion and open the vote.",
  "The vote carries if members present agree.",
];

const PROMPT =
  'Garden club minutes is open. Put 12 pt of space after the welcome paragraph and 12 pt of space before the Motion heading. Leave line spacing as it is: the welcome stays 1.5 and every motion line stays double. Leave 0 pt after every motion line. Call set_paragraph_spacing with text "greenhouse" and after_pt 12. Call set_paragraph_spacing with text "Motion" and before_pt 12. Then stop. Do not rewrite the minutes. Do not call write_text, set_list, align_text, keep_with_next, dont_leave_one_line, page_setup, insert_page_break, or restore_paragraph.';

function item(text: string): JsonNode {
  return {
    type: "listItem",
    content: [
      {
        type: "paragraph",
        attrs: { lineSpacing: "double" },
        content: [{ type: "text", text }],
      },
    ],
  };
}

async function seedMinutes(page: Page) {
  const file = createFile("doc", "Garden club minutes") as DocFile;
  file.content = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { lineSpacing: "1.5" },
        content: [{ type: "text", text: welcome }],
      },
      {
        type: "heading",
        attrs: { level: 2, spaceBefore: 0, spaceAfter: 0 },
        content: [{ type: "text", text: "Motion" }],
      },
      { type: "bulletList", content: motion.map(item) },
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
  await page.getByRole("link", { name: /Garden club minutes/ }).waitFor();
}

type SavedNode = {
  type?: string;
  text?: string;
  attrs?: { lineSpacing?: unknown; spaceBefore?: unknown; spaceAfter?: unknown };
  content?: SavedNode[];
};

function textOf(node: SavedNode): string {
  if (node.text) return node.text;
  return (node.content ?? []).map(textOf).join("");
}

function walk(node: SavedNode, visit: (node: SavedNode) => void) {
  visit(node);
  for (const child of node.content ?? []) walk(child, visit);
}

async function savedMinutes(page: Page) {
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
    const row = rows.find((item) => item.title === "Garden club minutes");
    if (!row?.native) throw new Error("Garden club minutes was not saved");
    return row.native;
  });
  return JSON.parse(native) as { content?: SavedNode };
}

/** Saved points: 12 is 12, and a missing side is 0. Anything else fails. */
function savedPoints(value: unknown) {
  if (value == null || value === "" || value === 0 || value === "0") return 0;
  if (value === 12 || value === "12") return 12;
  return paragraphSpacePoints(value);
}

test("95-space-before-and-after-ai", async ({ page }) => {
  await seedMinutes(page);
  await caption(page, "Priya asks the on-device assistant for space after the welcome and before Motion.");
  await page.getByRole("link", { name: /Garden club minutes/ }).click();
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toContainText("greenhouse");
  await expect(page.getByRole("heading", { name: "Motion", exact: true })).toBeVisible();
  const welcomeBlock = editor.locator("p", { hasText: "greenhouse" });
  const heading = page.getByRole("heading", { name: "Motion", exact: true });
  await expect(welcomeBlock).toHaveAttribute("data-line-spacing", "1.5");
  await expect(welcomeBlock).not.toHaveAttribute("data-space-after", "12");
  await expect(heading).toHaveAttribute("data-space-before", "0");
  for (const line of motion) {
    const item = editor.locator("p", { hasText: line });
    await expect(item).toHaveAttribute("data-line-spacing", "double");
    await expect(item).not.toHaveAttribute("data-space-after");
  }
  const before = await editor.evaluate((el) => el.textContent ?? "");

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  await expect(page.getByRole("status"), why).toContainText("Saved");
  await expect(welcomeBlock, why).toHaveAttribute("data-space-after", "12");
  await expect(welcomeBlock, why).toHaveAttribute("data-line-spacing", "1.5");
  await expect(heading, why).toHaveAttribute("data-space-before", "12");
  await expect(heading, why).toHaveAttribute("data-space-after", "0");
  for (const line of motion) {
    const item = editor.locator("p", { hasText: line });
    await expect(item, why).toHaveAttribute("data-line-spacing", "double");
    const after = await item.getAttribute("data-space-after");
    expect(after == null || after === "0", why).toBe(true);
  }
  expect(await editor.evaluate((el) => el.textContent ?? ""), why).toBe(before);

  const saved = await savedMinutes(page);
  const nodes: SavedNode[] = [];
  if (saved.content) walk(saved.content, (node) => nodes.push(node));
  const welcomeNode = nodes.find((node) => node.type === "paragraph" && textOf(node).includes("greenhouse"));
  const headingNode = nodes.find((node) => node.type === "heading" && textOf(node) === "Motion");
  const motionNodes = motion.map((line) => nodes.find((node) => node.type === "paragraph" && textOf(node) === line));
  expect(welcomeNode, why).toBeTruthy();
  expect(headingNode, why).toBeTruthy();
  expect(savedPoints(welcomeNode?.attrs?.spaceAfter), why).toBe(12);
  expect(savedPoints(welcomeNode?.attrs?.spaceBefore), why).toBe(0);
  expect(welcomeNode?.attrs?.lineSpacing, why).toBe("1.5");
  expect(savedPoints(headingNode?.attrs?.spaceBefore), why).toBe(12);
  expect(savedPoints(headingNode?.attrs?.spaceAfter), why).toBe(0);
  for (const node of motionNodes) {
    expect(node, why).toBeTruthy();
    expect(savedPoints(node?.attrs?.spaceAfter), why).toBe(0);
    expect(savedPoints(node?.attrs?.spaceBefore), why).toBe(0);
    expect(node?.attrs?.lineSpacing, why).toBe("double");
  }
});
