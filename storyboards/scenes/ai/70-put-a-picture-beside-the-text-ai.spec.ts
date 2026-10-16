import type { Page } from "@playwright/test";
import { letterLogo } from "../../../tests/letter-picture";
import { askAgent, caption, describeRun, expect, test } from "../harness";

const PROMPT =
  'A letter is open. The garden logo is already in it, and Dear friend starts on the next line. Set the logo to wrap left so the greeting sits beside it. Do not replace the image. Call set_image_wrap once with wrap set to left, then stop.';

const greeting =
  "Dear friend, the garden is ready whenever you are. Come by the gate and sit in the shade. The chairs are under the oak if the afternoon turns warm.";

type ImageAttrs = {
  src?: string;
  alt?: string;
  width?: number | null;
  height?: number | null;
  wrap?: string | null;
};

function letterFile() {
  const logo = letterLogo(200, 156);
  return {
    format: "suiteleaf",
    version: 1,
    id: "70-letter-logo",
    kind: "doc",
    title: "A letter",
    createdAt: "2026-10-13T12:00:00.000Z",
    updatedAt: "2026-10-13T12:00:00.000Z",
    content: {
      type: "doc",
      content: [
        {
          type: "image",
          attrs: {
            src: `data:image/png;base64,${logo.toString("base64")}`,
            alt: "Garden logo",
            width: 200,
            height: 156,
          },
        },
        { type: "paragraph", content: [{ type: "text", text: greeting }] },
      ],
    },
  };
}

function walk(node: unknown, images: ImageAttrs[], texts: string[]) {
  if (!node || typeof node !== "object") return;
  const record = node as { type?: string; attrs?: ImageAttrs; text?: unknown; content?: unknown[] };
  if (record.type === "image" && record.attrs) images.push(record.attrs);
  if (typeof record.text === "string") texts.push(record.text);
  for (const child of record.content ?? []) walk(child, images, texts);
}

async function savedLetter(page: Page) {
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
    const row = rows.find((item) => item.title === "A letter");
    if (!row?.native) throw new Error("A letter was not saved");
    return typeof row.native === "string" ? row.native : row.native.text();
  });
  const saved = JSON.parse(native) as { content?: unknown };
  const images: ImageAttrs[] = [];
  const texts: string[] = [];
  walk(saved.content, images, texts);
  return { images, text: texts.join("") };
}

async function lineBox(page: Page) {
  const picture = page.locator(".document-content img");
  await picture.scrollIntoViewIfNeeded();
  const box = await picture.boundingBox();
  const line = await page.locator(".document-content p", { hasText: "Dear friend" }).evaluate((paragraph) => {
    const node = paragraph.firstChild;
    if (!node?.textContent) return null;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, Math.min(11, node.textContent.length));
    const rect = range.getBoundingClientRect();
    return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom };
  });
  return { picture: box, line };
}

test("70-put-a-picture-beside-the-text-ai", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).waitFor();
  await page.locator("input[type=file]").setInputFiles({
    name: "A letter.sldoc",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(letterFile())),
  });
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toContainText("Dear friend");
  const image = editor.locator("img");
  await expect(image).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Saved");
  const before = await savedLetter(page);
  expect(before.images).toHaveLength(1);
  expect(before.images[0].alt).toBe("Garden logo");
  expect(before.images[0].wrap ?? null).toBeNull();
  expect(before.text).toBe(greeting);
  const blocked = await lineBox(page);
  expect(blocked.picture).toBeTruthy();
  expect(blocked.line).toBeTruthy();
  expect(blocked.picture!.height).toBeGreaterThan(40);
  expect(blocked.line!.y).toBeGreaterThanOrEqual(blocked.picture!.y + blocked.picture!.height - 4);
  await caption(page, "Lena asks the on-device assistant to put the logo beside the greeting.");

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");
  expect(
    run.items.some((item) => item.kind === "tool" && item.name === "set_image_wrap" && item.status === "ok"),
    why,
  ).toBe(true);

  await expect(page.getByRole("status"), why).toContainText("Saved");
  await expect(editor, why).toContainText("Dear friend");
  await expect(image, why).toHaveCount(1);
  const after = await savedLetter(page);
  expect(after.images, why).toHaveLength(1);
  expect(after.images[0].src, why).toBe(before.images[0].src);
  expect(after.images[0].alt, why).toBe("Garden logo");
  expect(after.images[0].width ?? null, why).toBe(before.images[0].width ?? null);
  expect(after.images[0].height ?? null, why).toBe(before.images[0].height ?? null);
  expect(after.images[0].wrap, why).toBe("left");
  expect(after.text, why).toBe(greeting);
  await expect
    .poll(
      async () => {
        const { picture, line } = await lineBox(page);
        if (!picture || !line) return false;
        const overlap = Math.min(picture.y + picture.height, line.bottom) - Math.max(picture.y, line.y);
        return overlap >= 8 && line.x >= picture.x + picture.width - 8;
      },
      { message: why },
    )
    .toBe(true);
});
