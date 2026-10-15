import type { Page } from "@playwright/test";
import { stallNote } from "../../../tests/sentence-picture";
import { askAgent, caption, describeRun, expect, test } from "../harness";

const PROMPT =
  'A note is open. The stall photo is already in it, on its own line between "Meet at the" and "stall on Saturday." Put that same photo in the sentence, between the and stall, about as tall as the words, not the width of the page. Do not replace the photo. Do not call insert_image. Do not call wrap_image. Call set_image_wrap once with wrap set to inline, then stop.';

const BEFORE = "Meet at the ";
const AFTER = "stall on Saturday.";

type SavedNode = {
  type?: string;
  text?: string;
  attrs?: { src?: string; alt?: string; width?: number | null; height?: number | null };
  content?: SavedNode[];
};

function picturesIn(node: SavedNode | undefined, parent: SavedNode | null = null, found: { node: SavedNode; parent: SavedNode | null }[] = []) {
  if (!node) return found;
  if (node.type === "image" || node.type === "inlineImage") found.push({ node, parent });
  for (const child of node.content ?? []) picturesIn(child, node, found);
  return found;
}

async function savedNote(page: Page) {
  const native = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open("SuiteLeaf");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => resolve(open.result);
    });
    const rows = await new Promise<{ title?: string; native?: string | Blob }[]>((resolve, reject) => {
      const tx = db.transaction("encoded", "readonly");
      const request = tx.objectStore("encoded").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const row = rows.find((item) => item.title === "Saturday note");
    if (!row?.native) throw new Error("Saturday note was not saved");
    return typeof row.native === "string" ? row.native : row.native.text();
  });
  return JSON.parse(native) as { content?: SavedNode };
}

test("73-put-a-picture-in-the-sentence-ai", async ({ page }) => {
  const note = stallNote();
  const originalSrc = String(note.content.content[1]?.attrs?.src ?? "");
  expect(originalSrc).toMatch(/^data:image\/png;base64,/);

  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).waitFor();
  await page.locator("input[type=file]").setInputFiles({
    name: "Saturday note.sldoc",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(note)),
  });
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toContainText("stall on Saturday");
  const image = editor.locator("img");
  await expect(image).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Saved");

  const before = await savedNote(page);
  const beforePictures = picturesIn(before.content);
  expect(beforePictures).toHaveLength(1);
  expect(beforePictures[0]?.node.type).toBe("image");
  expect(beforePictures[0]?.parent?.type).toBe("doc");
  expect(beforePictures[0]?.node.attrs?.src).toBe(originalSrc);
  expect(beforePictures[0]?.node.attrs?.alt).toBe("The stall");
  await caption(page, "Lena asks the on-device assistant to put the stall photo between “the” and “stall”.");

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");
  expect(
    run.items.some((item) => item.kind === "tool" && item.name === "set_image_wrap" && item.status === "ok"),
    why,
  ).toBe(true);

  await expect(page.getByRole("status"), why).toContainText("Saved");
  await expect(editor, why).toContainText("stall on Saturday");
  const after = await savedNote(page);
  const pictures = picturesIn(after.content);
  expect(pictures, why).toHaveLength(1);
  const photo = pictures[0]!;
  expect(photo.node.type, why).toBe("inlineImage");
  expect(photo.parent?.type, why).toBe("paragraph");
  expect(after.content?.content?.some((block) => block.type === "image"), why).toBe(false);

  const children = photo.parent?.content ?? [];
  const imageAt = children.findIndex((child) => child.type === "inlineImage");
  expect(imageAt, why).toBeGreaterThan(0);
  const beforeText = children
    .slice(0, imageAt)
    .map((child) => (child.type === "text" ? (child.text ?? "") : ""))
    .join("");
  const afterText = children
    .slice(imageAt + 1)
    .map((child) => (child.type === "text" ? (child.text ?? "") : ""))
    .join("");
  expect(beforeText, why).toBe(BEFORE);
  expect(afterText, why).toBe(AFTER);
  expect(afterText, why).toContain("on Saturday");
  expect(beforeText + afterText, why).toBe(`${BEFORE}${AFTER}`);

  const textParagraphs = (after.content?.content ?? []).filter((block) =>
    (block.content ?? []).some((child) => child.type === "text" && (child.text ?? "").trim()),
  );
  expect(textParagraphs, why).toHaveLength(1);

  expect(photo.node.attrs?.src, why).toBe(originalSrc);
  expect(photo.node.attrs?.alt, why).toBe("The stall");
  const width = Number(photo.node.attrs?.width ?? 0);
  const height = Number(photo.node.attrs?.height ?? 0);
  expect(height, why).toBeGreaterThanOrEqual(12);
  expect(height, why).toBeLessThanOrEqual(32);
  expect(width, why).toBeGreaterThanOrEqual(12);
  expect(width, why).toBeLessThan(120);
});
