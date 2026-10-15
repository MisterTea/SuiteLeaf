import { createFile, serializeFile } from "@suiteleaf/core";
import type { Page } from "@playwright/test";
import { stallPhoto } from "../../../tests/sentence-picture";
import { askAgent, caption, describeRun, expect, test } from "../harness";

const SENTENCE = "Meet at the stall on Saturday.";
const BEFORE = "Meet at the ";
const AFTER = "stall on Saturday.";

const PROMPT = `The caret is between "the" and "stall" in "Meet at the stall on Saturday." Insert the stall photo there, in that sentence, on the same line as the words. Call insert_picture_at_caret once with before "stall", then stop. Do not call insert_image. Do not add a paragraph and do not put the photo at the end.`;

type SavedNode = {
  type?: string;
  text?: string;
  attrs?: { src?: string; width?: number | null; height?: number | null };
  content?: SavedNode[];
};

/** Lena's note, with the caret still to be placed between "the" and "stall". */
async function seedNote(page: Page) {
  const file = createFile("doc", "Saturday note");
  if (file.kind !== "doc") throw new Error("expected a document");
  file.content = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: SENTENCE }] }],
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
  await page.getByRole("link", { name: "Saturday note", exact: true }).waitFor();
}

async function clickBetweenTheAndStall(page: Page) {
  const point = await page.evaluate(() => {
    const root = document.querySelector(".document-content");
    if (!root) return null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let current = walker.nextNode(); current; current = walker.nextNode()) {
      const text = current.textContent ?? "";
      const at = text.indexOf("stall");
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(current, at);
      range.setEnd(current, at + 1);
      const rect = range.getBoundingClientRect();
      return { x: rect.x, y: rect.y + rect.height / 2 };
    }
    return null;
  });
  expect(point).not.toBeNull();
  await page.mouse.click(point!.x, point!.y);
}

async function savedDocument(page: Page) {
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
    const row = rows.find((item) => item.title === "Saturday note");
    if (!row?.native) throw new Error("Saturday note was not saved");
    return row.native;
  });
  return JSON.parse(native) as { content?: SavedNode };
}

function picturesIn(node: SavedNode | undefined, found: SavedNode[] = []): SavedNode[] {
  if (!node) return found;
  if (node.type === "image" || node.type === "inlineImage") found.push(node);
  for (const child of node.content ?? []) picturesIn(child, found);
  return found;
}

test("76-insert-a-picture-at-the-caret-ai", async ({ page }) => {
  const photo = stallPhoto();
  await seedNote(page);
  await caption(page, "Lena asks the on-device assistant to put the stall photo between “the” and “stall”.");
  await page.getByRole("link", { name: "Saturday note", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toContainText(SENTENCE);
  await expect(page.locator(".save-status")).toContainText("Saved");
  await clickBetweenTheAndStall(page);

  const run = await askAgent(page, PROMPT, {
    files: [{ name: "stall.png", mimeType: "image/png", buffer: photo }],
  });
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  const words = await editor.evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let text = "";
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      if (el?.closest("button, .doc-image-actions, .doc-image-crop-hint")) continue;
      text += node.textContent ?? "";
    }
    return text;
  });
  expect(words, why).toBe(SENTENCE);
  await expect(page.locator(".save-status"), why).toContainText("Saved");
  const saved = await savedDocument(page);
  const blocks = (saved.content?.content ?? []).filter(
    (block) => block.type !== "paragraph" || (block.content?.length ?? 0) > 0,
  );
  expect(blocks, why).toHaveLength(1);
  expect(blocks[0]?.type, why).toBe("paragraph");

  const children = blocks[0]?.content ?? [];
  const pictures = picturesIn(saved.content);
  expect(pictures, why).toHaveLength(1);
  expect(pictures[0]?.type, why).toBe("inlineImage");
  expect(children.filter((child) => child.type === "image"), why).toHaveLength(0);

  const imageAt = children.findIndex((child) => child.type === "inlineImage");
  expect(imageAt, why).toBeGreaterThan(0);
  const before = children
    .slice(0, imageAt)
    .map((child) => (child.type === "text" ? (child.text ?? "") : ""))
    .join("");
  const after = children
    .slice(imageAt + 1)
    .map((child) => (child.type === "text" ? (child.text ?? "") : ""))
    .join("");
  expect(before + after, why).toBe(SENTENCE);
  expect(before, why).toBe(BEFORE);
  expect(after, why).toBe(AFTER);
  expect(String(pictures[0]?.attrs?.src ?? ""), why).toMatch(/^data:image\/png;base64,/);
  const height = Number(pictures[0]?.attrs?.height ?? 0);
  expect(height, why).toBeGreaterThanOrEqual(12);
  expect(height, why).toBeLessThanOrEqual(32);
});
