import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { crc32, deflateSync } from "node:zlib";
import JSZip from "jszip";

const sentence = "Neighbors trading seed packets at the spring stall.";

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

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

async function newDocument(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  const title = page.getByLabel("File title");
  await title.click();
  await title.press("ControlOrMeta+A");
  await title.fill("Seed swap sign-up");
  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.click();
  return editor;
}

async function insertStall(page: Page) {
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({
    name: "IMG_2044.jpg",
    mimeType: "image/png",
    buffer: stallPhoto(),
  });
}

test("a new photo starts with an empty description and alt text stays with the image", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const editor = await newDocument(page);
  await page.keyboard.type("The stall on Saturday morning.");
  await page.keyboard.press("Enter");
  await insertStall(page);
  const image = editor.locator("img");
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("alt", "");

  await image.click();
  const card = page.locator(".image-alt-card");
  await expect(card).toBeVisible();
  await expect(card.getByRole("button", { name: "Alt text", exact: true })).toBeVisible();
  await expect(card).toContainText("No description");
  await expect(card).not.toContainText("IMG_2044");
  const cardBox = (await card.boundingBox())!;
  const imageBox = (await image.boundingBox())!;
  expect(overlaps(cardBox, imageBox)).toBe(false);
  for (const corner of ["top-left", "top-right", "bottom-left", "bottom-right"]) {
    const handle = editor.locator(`[data-resize-handle="${corner}"]`);
    await expect(handle).toBeVisible();
    expect(overlaps(cardBox, (await handle.boundingBox())!)).toBe(false);
  }

  await card.getByRole("button", { name: "Alt text", exact: true }).click();
  const field = page.getByRole("textbox", { name: "Description" });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("");
  await field.fill(sentence);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(field).toBeHidden();
  await expect(image).toHaveAttribute("alt", sentence);
  await expect(card).toContainText(sentence);

  await card.getByRole("button", { name: "Alt text", exact: true }).click();
  await expect(field).toHaveValue(sentence);
  await field.fill("");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("alt", "");
  await expect(card).toContainText("No description");
  await expect(card).not.toContainText("IMG_2044");

  await card.getByRole("button", { name: "Alt text", exact: true }).click();
  await field.fill(sentence);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Saved");

  const native = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const saved = JSON.parse(await readFile((await (await native).path())!, "utf8"));
  expect(JSON.stringify(saved.content)).toContain(sentence);
  expect(JSON.stringify(saved.content)).not.toContain("IMG_2044");

  const docxDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Export DOCX", exact: true }).click();
  const zip = await JSZip.loadAsync(await readFile((await (await docxDownload).path())!));
  const doc = await zip.file("word/document.xml")!.async("string");
  expect(doc).toContain(`descr="${sentence}"`);
  expect(doc).toContain(`name="${sentence}"`);
  expect(doc).not.toContain('name="Image"');
  expect(doc).not.toContain("IMG_2044");

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: /Seed swap sign-up/ }).click();
  await expect(editor.locator("img")).toHaveAttribute("alt", sentence);
  await editor.locator("img").click();
  await expect(page.locator(".image-alt-card")).toContainText(sentence);
  await page.getByRole("button", { name: "Alt text", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Description" })).toHaveValue(sentence);
});

test("alt text stays on screen on a narrow phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const editor = await newDocument(page);
  await insertStall(page);
  const image = editor.locator("img");
  await expect(image).toBeVisible();
  await image.click();
  const card = page.locator(".image-alt-card");
  await expect(card).toBeVisible();
  const box = (await card.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(391);
  expect(box.y + box.height).toBeLessThanOrEqual(845);
  await card.getByRole("button", { name: "Alt text", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Description" })).toHaveValue("");
  const open = (await card.boundingBox())!;
  expect(open.x).toBeGreaterThanOrEqual(0);
  expect(open.x + open.width).toBeLessThanOrEqual(391);
  expect(open.y + open.height).toBeLessThanOrEqual(845);
});
