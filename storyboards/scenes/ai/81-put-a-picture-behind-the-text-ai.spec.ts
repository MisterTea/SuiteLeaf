import type { Page } from "@playwright/test";
import { stallPhoto } from "../../../tests/sentence-picture";
import { askAgent, caption, describeRun, expect, test } from "../harness";

const HEADING = "Saturday market";
const BEFORE = "The stall opens at nine. ";
const AFTER = "Bring a bag for the greens.";

const PROMPT =
  'The market announcement is open. The heading is "Saturday market". The stall photo is already in the line, between "The stall opens at nine. " and "Bring a bag for the greens." Put that existing photo behind the text so the words stay where they were and draw on top of the photo. Do not delete the photo or the words. Do not replace the photo. Call set_image_wrap once with wrap set to behind, then stop. Do not call insert_image.';

type ImageAttrs = {
  src?: string;
  alt?: string;
  width?: number | null;
  height?: number | null;
  wrap?: string | null;
};

type Piece =
  | { kind: "text"; text: string }
  | { kind: "image"; nodeType: string; attrs: ImageAttrs };

type Box = { x: number; y: number; right: number; bottom: number };

function announcementFile() {
  const photo = stallPhoto(320, 240);
  return {
    format: "suiteleaf",
    version: 1,
    id: "81-market-note",
    kind: "doc",
    title: "Saturday market",
    createdAt: "2026-10-13T12:00:00.000Z",
    updatedAt: "2026-10-13T12:00:00.000Z",
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: HEADING }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: BEFORE },
            {
              type: "inlineImage",
              attrs: {
                src: `data:image/png;base64,${photo.toString("base64")}`,
                alt: "The stall",
                width: 27,
                height: 20,
              },
            },
            { type: "text", text: AFTER },
          ],
        },
      ],
    },
  };
}

function walk(node: unknown, pieces: Piece[]) {
  if (!node || typeof node !== "object") return;
  const record = node as { type?: string; text?: unknown; attrs?: ImageAttrs; content?: unknown[] };
  if (record.type === "text" && typeof record.text === "string") pieces.push({ kind: "text", text: record.text });
  if ((record.type === "image" || record.type === "inlineImage") && record.attrs)
    pieces.push({ kind: "image", nodeType: record.type, attrs: record.attrs });
  for (const child of record.content ?? []) walk(child, pieces);
}

async function savedAnnouncement(page: Page) {
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
    const row = rows.find((item) => item.title === "Saturday market");
    if (!row?.native) throw new Error("Saturday market was not saved");
    return typeof row.native === "string" ? row.native : row.native.text();
  });
  const saved = JSON.parse(native) as { content?: unknown };
  const pieces: Piece[] = [];
  walk(saved.content, pieces);
  return pieces;
}

function sharesLine(picture: Box, word: Box) {
  return Math.min(picture.bottom, word.bottom) - Math.max(picture.y, word.y) >= 8;
}

function overlaps(picture: Box, word: Box) {
  return (
    Math.min(picture.right, word.right) - Math.max(picture.x, word.x) > 8 &&
    Math.min(picture.bottom, word.bottom) - Math.max(picture.y, word.y) > 8
  );
}

function sameBox(before: Box, after: Box) {
  return (
    Math.abs(before.x - after.x) < 3 &&
    Math.abs(before.y - after.y) < 3 &&
    Math.abs(before.right - after.right) < 3 &&
    Math.abs(before.bottom - after.bottom) < 3
  );
}

async function layout(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector(".document-content");
    if (!root) return null;
    const origin = root.getBoundingClientRect();
    const word = (label: string): Box | null => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let current = walker.nextNode(); current; current = walker.nextNode()) {
        const text = current.textContent ?? "";
        const at = text.indexOf(label);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(current, at);
        range.setEnd(current, at + label.length);
        const rect = range.getBoundingClientRect();
        return {
          x: rect.x - origin.x,
          y: rect.y - origin.y,
          right: rect.right - origin.x,
          bottom: rect.bottom - origin.y,
        };
      }
      return null;
    };
    const img = root.querySelector("img");
    const host = img?.closest(".doc-image-host");
    const hostRect = host?.getBoundingClientRect();
    const visualRect = img?.getBoundingClientRect();
    const box = (rect: DOMRect | undefined): Box | null =>
      rect
        ? {
            x: rect.x - origin.x,
            y: rect.y - origin.y,
            right: rect.right - origin.x,
            bottom: rect.bottom - origin.y,
          }
        : null;
    const opens = word("opens at nine");
    let onTop = false;
    if (opens) {
      const top = document.elementFromPoint(
        origin.x + (opens.x + opens.right) / 2,
        origin.y + (opens.y + opens.bottom) / 2,
      );
      onTop = !top?.closest(".doc-image-host");
    }
    const style = img instanceof HTMLElement ? getComputedStyle(img) : null;
    return {
      heading: word("Saturday market"),
      opens,
      bag: word("Bring a bag"),
      slot: box(hostRect),
      visual: box(visualRect),
      opacity: style ? Number(style.opacity) : 1,
      zIndex: style?.zIndex ?? "auto",
      onTop,
      images: root.querySelectorAll("img").length,
    };
  });
}

test("81-put-a-picture-behind-the-text-ai", async ({ page }) => {
  const note = announcementFile();
  const originalSrc = String(
    (note.content.content[1]?.content?.[1] as { attrs?: { src?: string } } | undefined)?.attrs?.src ?? "",
  );
  expect(originalSrc).toMatch(/^data:image\/png;base64,/);

  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).waitFor();
  await page.locator("input[type=file]").setInputFiles({
    name: "Saturday market.sldoc",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(note)),
  });
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toContainText(HEADING);
  await expect(editor).toContainText("The stall opens at nine.");
  await expect(editor).toContainText("Bring a bag for the greens.");
  const image = editor.locator("img");
  await expect(image).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Saved");
  const before = await savedAnnouncement(page);
  const beforeImage = before.find((piece) => piece.kind === "image");
  expect(before.map((piece) => (piece.kind === "text" ? piece.text : "photo")).join("")).toBe(
    `${HEADING}${BEFORE}photo${AFTER}`,
  );
  expect(beforeImage?.kind).toBe("image");
  if (beforeImage?.kind !== "image") return;
  expect(beforeImage.nodeType).toBe("inlineImage");
  expect(beforeImage.attrs.alt).toBe("The stall");
  expect(beforeImage.attrs.src).toBe(originalSrc);
  expect(beforeImage.attrs.wrap ?? null).toBeNull();
  expect(beforeImage.attrs.width ?? null).toBe(27);
  expect(beforeImage.attrs.height ?? null).toBe(20);
  await page.getByRole("button", { name: "AI assistant" }).first().click();
  await page.locator(".agent-sidebar").waitFor();
  await image.scrollIntoViewIfNeeded();
  const beforeLayout = await layout(page);
  expect(beforeLayout?.heading).toBeTruthy();
  expect(beforeLayout?.opens).toBeTruthy();
  expect(beforeLayout?.bag).toBeTruthy();
  expect(beforeLayout?.slot).toBeTruthy();
  expect(beforeLayout!.images).toBe(1);
  expect(beforeLayout!.opens!.right).toBeLessThanOrEqual(beforeLayout!.slot!.x + 8);
  expect(beforeLayout!.bag!.x).toBeGreaterThanOrEqual(beforeLayout!.slot!.right - 4);
  expect(sharesLine(beforeLayout!.slot!, beforeLayout!.opens!)).toBe(true);
  expect(sharesLine(beforeLayout!.slot!, beforeLayout!.bag!)).toBe(true);
  await caption(page, "Lena asks the on-device assistant to put the stall photo behind the announcement.");

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");
  expect(
    run.items.some((item) => item.kind === "tool" && item.name === "set_image_wrap" && item.status === "ok"),
    why,
  ).toBe(true);

  await expect(page.getByRole("status"), why).toContainText("Saved");
  await expect(editor, why).toContainText(HEADING);
  await expect(editor, why).toContainText(BEFORE.trim());
  await expect(editor, why).toContainText(AFTER);
  await expect(image, why).toHaveCount(1);
  const after = await savedAnnouncement(page);
  const afterImage = after.find((piece) => piece.kind === "image");
  expect(after.map((piece) => (piece.kind === "text" ? piece.text : "photo")).join(""), why).toBe(
    `${HEADING}${BEFORE}photo${AFTER}`,
  );
  expect(afterImage?.kind, why).toBe("image");
  if (afterImage?.kind !== "image") return;
  expect(afterImage.nodeType, why).toBe("inlineImage");
  expect(afterImage.attrs.src, why).toBe(beforeImage.attrs.src);
  expect(afterImage.attrs.alt, why).toBe("The stall");
  expect(afterImage.attrs.width ?? null, why).toBe(beforeImage.attrs.width ?? null);
  expect(afterImage.attrs.height ?? null, why).toBe(beforeImage.attrs.height ?? null);
  expect(afterImage.attrs.wrap, why).toBe("behind");
  await expect
    .poll(
      async () => {
        const laid = await layout(page);
        if (!laid?.visual || !laid.opens || !laid.heading || !laid.bag || !laid.slot) return false;
        return (
          laid.images === 1 &&
          overlaps(laid.visual, laid.opens) &&
          overlaps(laid.visual, laid.bag) &&
          laid.onTop &&
          Number(laid.zIndex) < 0 &&
          laid.opacity > 0.2 &&
          laid.opacity < 0.6 &&
          sameBox(beforeLayout!.heading!, laid.heading) &&
          sameBox(beforeLayout!.opens!, laid.opens) &&
          sameBox(beforeLayout!.bag!, laid.bag) &&
          sameBox(beforeLayout!.slot!, laid.slot)
        );
      },
      { message: why },
    )
    .toBe(true);
});
