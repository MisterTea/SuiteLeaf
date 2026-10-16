import { crc32, deflateSync } from "node:zlib";
import JSZip from "jszip";
import { createFile, serializeFile } from "@suiteleaf/core";
import { exportDocx } from "@suiteleaf/core/docx-export";
import type { Page } from "@playwright/test";
import { askAgent, caption, describeRun, expect, test } from "../harness";

const sentence = "Neighbors trading seed packets at the spring stall.";
const PROMPT = `The sign-up note is open and the stall photo is already in it. Set that photo's description to ${sentence} Do not use the file name IMG_2044 as the description, and do not replace or resize the photo. Call set_image_description once with that sentence. Stop.`;

/** The stall photo the human storyboard inserts from the camera file IMG_2044. */
function stallPhoto(width = 280, height = 180) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      let rgb = [186, 214, 232];
      if (y > 28 && y < 52 && x > 24 && x < width - 24) rgb = [196, 92, 74];
      if (y > 118) rgb = [214, 196, 168];
      if (y > 78 && y < 118 && x > 36 && x < width - 36 && (x - 36) % 28 < 22) {
        const colors = [
          [90, 140, 70],
          [212, 168, 52],
          [70, 110, 160],
          [168, 84, 64],
        ];
        rgb = colors[Math.floor((x - 36) / 28) % colors.length];
      }
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
  alt?: string;
  title?: string;
  width?: number | null;
  height?: number | null;
};

function imagesIn(node: unknown, found: ImageAttrs[] = []): ImageAttrs[] {
  if (!node || typeof node !== "object") return found;
  const record = node as { type?: string; attrs?: ImageAttrs; content?: unknown[] };
  if (record.type === "image" && record.attrs) found.push(record.attrs);
  for (const child of record.content ?? []) imagesIn(child, found);
  return found;
}

/** The sign-up note after the stall photo is in it, with no description. */
async function seedNote(page: Page, src: string) {
  const file = createFile("doc", "Seed swap sign-up");
  if (file.kind !== "doc") throw new Error("expected a document");
  file.content = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "The stall on Saturday morning." }],
      },
      { type: "image", attrs: { src, alt: "", title: "IMG_2044.jpg" } },
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

async function savedNote(page: Page) {
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
  return JSON.parse(native) as { title?: string; content?: unknown };
}

test("66-describe-a-photo-ai", async ({ page }) => {
  const src = `data:image/png;base64,${stallPhoto().toString("base64")}`;
  await seedNote(page, src);
  await caption(page, "Lena asks the on-device assistant to describe the stall photo for a screen reader.");
  await page.getByRole("link", { name: "Seed swap sign-up", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor.getByText("The stall on Saturday morning.")).toBeVisible();
  const image = editor.locator("img");
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("alt", "");
  await expect(image).toHaveAttribute("src", src);
  await expect(page.locator(".save-status")).toContainText("Saved");
  const before = imagesIn((await savedNote(page)).content);
  expect(before).toHaveLength(1);
  expect(before[0].src).toBe(src);
  expect(before[0].alt ?? "").toBe("");
  expect(before[0].alt ?? "").not.toBe("IMG_2044");
  expect(before[0].title).toBe("IMG_2044.jpg");

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  await expect(editor.getByText("The stall on Saturday morning."), why).toBeVisible();
  await expect(image, why).toBeVisible();
  await expect(image, why).toHaveAttribute("src", src);
  await expect(image, why).toHaveAttribute("alt", sentence);
  await expect(page.locator(".save-status"), why).toContainText("Saved");
  const saved = await savedNote(page);
  const after = imagesIn(saved.content);
  expect(after, why).toHaveLength(1);
  expect(after[0].src, why).toBe(src);
  expect(after[0].alt, why).toBe(sentence);
  expect(after[0].alt, why).not.toBe("IMG_2044");
  expect(after[0].alt, why).not.toBe("IMG_2044.jpg");
  expect(after[0].alt ?? "", why).not.toBe("");
  expect(after[0].title, why).toBe("IMG_2044.jpg");
  expect(after[0].width ?? null, why).toBe(before[0].width ?? null);
  expect(after[0].height ?? null, why).toBe(before[0].height ?? null);

  const zip = await JSZip.loadAsync(await exportDocx({ title: saved.title ?? "Seed swap sign-up", content: saved.content as never }));
  const xml = await zip.file("word/document.xml")!.async("string");
  expect(xml, why).toContain(`descr="${sentence}"`);
  expect(xml, why).toContain(`name="${sentence}"`);
  expect(xml, why).not.toContain('name="Image"');
  expect(xml, why).not.toContain("IMG_2044");
});
