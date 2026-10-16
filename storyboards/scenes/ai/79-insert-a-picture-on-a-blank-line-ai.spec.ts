import { createFile, serializeFile } from "@suiteleaf/core";
import type { Page } from "@playwright/test";
import { stallPhoto } from "../../../tests/sentence-picture";
import { askAgent, caption, describeRun, expect, test } from "../harness";

const TITLE = "Market day";
const WORDS = "Saturday market";
const REST = "The stall opens at nine.";

const PROMPT = `The caret is in an empty paragraph under the title "Market day". Insert the stall photo there, in that empty paragraph, in line, about as tall as the text, not the width of the page. Then the words "Saturday market" sit on that same line, after the photo. Call insert_picture_on_blank_line once with text "Saturday market", then stop. Do not call insert_image. Do not call write_text. Do not add another paragraph. Do not paste a second picture. Do not change the wrap.`;

type SavedNode = {
  type?: string;
  text?: string;
  attrs?: { src?: string; width?: number | null; height?: number | null };
  content?: SavedNode[];
};

/** A title, the blank line Lena opened with Enter, and the rest of the note. */
function marketNote() {
  const file = createFile("doc", TITLE);
  if (file.kind !== "doc") throw new Error("expected a document");
  file.content = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: TITLE }] },
      { type: "paragraph" },
      { type: "paragraph", content: [{ type: "text", text: REST }] },
    ],
  };
  return file;
}

async function clickBlankLine(page: Page) {
  const point = await page.evaluate(() => {
    const root = document.querySelector(".document-content");
    if (!root) return null;
    const empty = [...root.querySelectorAll("p")].find((paragraph) => {
      return !(paragraph.textContent ?? "").replace(/\u00a0/g, " ").trim();
    });
    if (!empty) return null;
    const rect = empty.getBoundingClientRect();
    if (rect.height >= 4) return { x: rect.left + 16, y: rect.top + rect.height / 2 };
    const previous = empty.previousElementSibling?.getBoundingClientRect();
    return { x: (previous?.left ?? rect.left) + 16, y: (previous?.bottom ?? rect.top) + 8 };
  });
  expect(point).not.toBeNull();
  await page.mouse.click(point!.x, point!.y);
}

async function savedDocument(page: Page) {
  const native = await page.evaluate(async (title) => {
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
    const row = rows.find((item) => item.title === title);
    if (!row?.native) throw new Error(`${title} was not saved`);
    return row.native;
  }, TITLE);
  return JSON.parse(native) as { content?: SavedNode };
}

function textOf(node: SavedNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  if (node.type === "inlineImage" || node.type === "image") return "";
  return (node.content ?? []).map((child) => textOf(child)).join("");
}

function picturesIn(node: SavedNode | undefined, found: SavedNode[] = []): SavedNode[] {
  if (!node) return found;
  if (node.type === "image" || node.type === "inlineImage") found.push(node);
  for (const child of node.content ?? []) picturesIn(child, found);
  return found;
}

test("79-insert-a-picture-on-a-blank-line-ai", async ({ page }) => {
  const photo = stallPhoto();
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: `${TITLE}.suiteleaf`,
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(marketNote())),
  });
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(page.getByRole("heading", { name: TITLE })).toBeVisible();
  await expect(editor).toContainText(REST);
  await expect(page.locator(".save-status")).toContainText("Saved");
  await caption(page, "Lena asks the on-device assistant to put the stall photo on the blank line.");
  await clickBlankLine(page);

  const run = await askAgent(page, PROMPT, {
    files: [{ name: "stall.png", mimeType: "image/png", buffer: photo }],
  });
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  await expect(editor, why).toContainText(TITLE);
  await expect(editor, why).toContainText(WORDS);
  await expect(editor, why).toContainText(REST);
  await expect(page.locator(".save-status"), why).toContainText("Saved");
  await expect
    .poll(async () => JSON.stringify(await savedDocument(page)).includes('"inlineImage"'), { message: why })
    .toBe(true);

  const saved = await savedDocument(page);
  const blocks = (saved.content?.content ?? []).filter(
    (block) => block.type !== "paragraph" || (block.content?.length ?? 0) > 0,
  );
  expect(blocks, why).toHaveLength(3);
  expect(blocks[0]?.type, why).toBe("heading");
  expect(textOf(blocks[0]), why).toBe(TITLE);
  expect(blocks[1]?.type, why).toBe("paragraph");
  expect(textOf(blocks[2]), why).toBe(REST);

  const children = blocks[1]?.content ?? [];
  expect(children[0]?.type, why).toBe("inlineImage");
  expect(children.filter((child) => child.type === "image"), why).toHaveLength(0);
  expect(children.filter((child) => child.type === "hardBreak"), why).toHaveLength(0);
  const after = children
    .slice(1)
    .map((child) => textOf(child))
    .join("");
  expect(after, why).toBe(WORDS);
  expect(textOf(blocks[1]), why).toBe(WORDS);

  const pictures = picturesIn(saved.content);
  expect(pictures, why).toHaveLength(1);
  expect(pictures[0]?.type, why).toBe("inlineImage");
  expect(pictures.filter((picture) => picture.type === "image"), why).toHaveLength(0);
  expect(String(pictures[0]?.attrs?.src ?? ""), why).toMatch(/^data:image\/png;base64,/);
  const height = Number(pictures[0]?.attrs?.height ?? 0);
  const width = Number(pictures[0]?.attrs?.width ?? 0);
  expect(height, why).toBeGreaterThanOrEqual(12);
  expect(height, why).toBeLessThanOrEqual(32);
  expect(width, why).toBeGreaterThanOrEqual(12);
  expect(width, why).toBeLessThanOrEqual(96);
});
