import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { crc32, deflateSync } from "node:zlib";
import JSZip from "jszip";

test.use({ viewport: { width: 1280, height: 800 } });

/** 240×120 PNG: green stall on the left, gray parking lot on the right. */
function stallPhoto(width = 240, height = 120) {
  const stall = Math.round(width * 0.58);
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const rgb =
        x < stall
          ? y < 28
            ? x % 16 < 8
              ? [196, 48, 42]
              : [255, 236, 210]
            : [64, 150, 60]
          : (x - stall) % 36 < 3
            ? [245, 245, 245]
            : [150, 154, 158];
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

async function newDocument(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.click();
  return editor;
}

async function drag(page: Page, selector: string, dx: number, dy = 0) {
  const handle = page.locator(selector);
  const box = (await handle.boundingBox())!;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 10 });
  await page.mouse.up();
}

test("crop hides an edge without scaling the photo, and reset and Word keep the pixels", async ({
  page,
}) => {
  const editor = await newDocument(page);
  const photo = stallPhoto();
  await page.locator('input[type=file][accept*="image/png"]').setInputFiles({
    name: "stall.png",
    mimeType: "image/png",
    buffer: photo,
  });
  const image = editor.locator("img");
  await expect(image).toBeVisible();
  const src = await image.getAttribute("src");
  await image.click();

  const crop = page.getByRole("button", { name: "Crop", exact: true });
  const corner = editor.locator('[data-resize-handle="bottom-right"]');
  await expect(crop).toBeVisible();
  await expect(corner).toBeVisible();
  await expect(corner).toHaveCSS("opacity", "1");
  await expect(crop).not.toHaveAttribute("data-resize-handle", /.+/);
  const cropBox = (await crop.boundingBox())!;
  const cornerBox = (await corner.boundingBox())!;
  const overlaps =
    cropBox.x < cornerBox.x + cornerBox.width &&
    cornerBox.x < cropBox.x + cropBox.width &&
    cropBox.y < cornerBox.y + cornerBox.height &&
    cornerBox.y < cropBox.y + cropBox.height;
  expect(overlaps).toBe(false);

  const frame = editor.locator("[data-resize-wrapper]");
  const before = (await frame.boundingBox())!;
  await crop.click();
  await expect(page.getByText("The rest of the photo stays the same size.")).toBeVisible();
  await expect(corner).toBeHidden();
  const fullWidth = await image.evaluate((el) => el.offsetWidth);
  await drag(page, '[data-crop-edge="right"]', -Math.round(fullWidth * 0.42));

  const after = (await frame.boundingBox())!;
  expect(Math.abs(after.x - before.x)).toBeLessThan(4);
  expect(after.width).toBeLessThan(before.width * 0.7);
  expect(after.width).toBeGreaterThan(before.width * 0.45);
  expect(Math.abs(after.height - before.height)).toBeLessThan(4);
  expect(await image.evaluate((el) => el.offsetWidth)).toBeGreaterThan(fullWidth - 2);
  expect(await image.getAttribute("src")).toBe(src);

  const stall = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, {
    x: after.x + 48,
    y: after.y + after.height / 2,
  });
  const parking = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, {
    x: before.x + before.width - 8,
    y: before.y + before.height / 2,
  });
  expect(stall).toBe("IMG");
  expect(parking).not.toBe("IMG");

  await page.getByRole("button", { name: "Done", exact: true }).click();
  await crop.click();
  await drag(page, '[data-crop-edge="right"]', Math.round(fullWidth * 0.42));
  await expect.poll(async () => (await frame.boundingBox())!.width).toBeGreaterThan(before.width * 0.9);

  await drag(page, '[data-crop-edge="right"]', -Math.round(fullWidth * 0.42));
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const saved = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  const savedImage = JSON.stringify(saved.content);
  expect(savedImage).toContain("cropRight");
  expect(savedImage).toContain(String(src).slice(0, 40));

  await image.click();
  await page.getByRole("button", { name: "Reset crop", exact: true }).click();
  await expect.poll(async () => (await frame.boundingBox())!.width).toBeGreaterThan(before.width * 0.9);
  await expect(page.getByRole("button", { name: "Reset crop", exact: true })).toBeHidden();

  await crop.click();
  await drag(page, '[data-crop-edge="right"]', -Math.round(fullWidth * 0.42));
  await page.getByRole("button", { name: "Done", exact: true }).click();
  const docxDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Export DOCX", exact: true }).click();
  const zip = await JSZip.loadAsync(await readFile((await (await docxDownload).path())!));
  const xml = await zip.file("word/document.xml")!.async("string");
  expect(xml).toMatch(/<a:srcRect[^>]*\br="\d{4,}"/);
  const names = Object.keys(zip.files);
  const mediaName = names.find((name) => /word\/media\/.+\.(png|jpe?g|gif)$/i.test(name));
  expect(mediaName, names.join("\n")).toBeTruthy();
  const bytes = await zip.file(mediaName!)!.async("nodebuffer");
  expect(bytes.equals(photo)).toBe(true);
});
