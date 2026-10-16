import { crc32, deflateSync } from "node:zlib";
import { createFile, serializeFile } from "@suiteleaf/core";
import type { Page } from "@playwright/test";
import { askAgent, caption, describeRun, expect, test } from "../harness";

const PROMPT = `The photo is already in this note. Crop the right side of that photo enough to hide the parking lot. Do not resize the picture, and do not replace or delete its pixels, so a reset can bring the parking lot back. Call crop_image once with right set to 45, then stop.`;

/** Stall on the left, parking lot on the right, the same picture the human storyboard inserts. */
function stallPhoto(width = 640, height = 320) {
  const stall = Math.round(width * 0.58);
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      let rgb = [150, 154, 158];
      if (x < stall) {
        if (y < 72) rgb = x % 28 < 14 ? [196, 48, 42] : [255, 236, 210];
        else rgb = (x + y) % 36 < 18 ? [64, 150, 60] : [232, 186, 48];
      } else if (y > 48 && (x - stall) % 52 < 4) rgb = [245, 245, 245];
      raw.set(rgb, y * (width * 3 + 1) + 1 + x * 3);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

type ImageAttrs = {
  src?: string;
  width?: number | null;
  height?: number | null;
  cropLeft?: number;
  cropTop?: number;
  cropRight?: number;
  cropBottom?: number;
};

function imagesIn(node: unknown, found: ImageAttrs[] = []): ImageAttrs[] {
  if (!node || typeof node !== "object") return found;
  const record = node as { type?: string; attrs?: ImageAttrs; content?: unknown[] };
  if (record.type === "image" && record.attrs) found.push(record.attrs);
  for (const child of record.content ?? []) imagesIn(child, found);
  return found;
}

/** The seed-swap note after the photo is in it, before anyone crops. */
async function seedNote(page: Page, src: string) {
  const file = createFile("doc", "Seed swap sign-up");
  if (file.kind !== "doc") throw new Error("expected a document");
  file.content = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Saturday, 9 to noon. The stall is by the gate." }],
      },
      { type: "image", attrs: { src, alt: "" } },
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
  await page.getByRole("link", { name: "Seed swap sign-up", exact: true }).waitFor();
}

async function savedImages(page: Page) {
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
    const row = rows.find((item) => item.title === "Seed swap sign-up");
    if (!row?.native) throw new Error("Seed swap sign-up was not saved");
    return row.native;
  });
  const saved = JSON.parse(native) as { content?: unknown };
  return imagesIn(saved.content);
}

test("57-crop-a-photo-ai", async ({ page }) => {
  const src = `data:image/png;base64,${stallPhoto().toString("base64")}`;
  await seedNote(page, src);
  await caption(page, "Lena asks the on-device assistant to crop the parking lot out of the stall photo.");
  await page.getByRole("link", { name: "Seed swap sign-up", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor.getByText("Saturday, 9 to noon. The stall is by the gate.")).toBeVisible();
  const image = editor.locator("img");
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("src", src);
  await expect(page.locator(".save-status")).toContainText("Saved");
  const before = await savedImages(page);
  expect(before).toHaveLength(1);
  expect(before[0].src).toBe(src);

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  await expect(editor.getByText("Saturday, 9 to noon. The stall is by the gate."), why).toBeVisible();
  await expect(image, why).toHaveAttribute("src", src);
  await expect(page.locator(".save-status"), why).toContainText("Saved");
  const after = await savedImages(page);
  expect(after, why).toHaveLength(1);
  expect(after[0].src, why).toBe(src);
  expect(after[0].cropRight ?? 0, why).toBeGreaterThanOrEqual(42);
  expect(after[0].cropLeft ?? 0, why).toBe(0);
  expect(after[0].cropTop ?? 0, why).toBe(0);
  expect(after[0].cropBottom ?? 0, why).toBe(0);
  expect(after[0].width ?? null, why).toBe(before[0].width ?? null);
  expect(after[0].height ?? null, why).toBe(before[0].height ?? null);
});
