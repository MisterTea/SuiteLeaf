import { expect, test, type Page } from "@playwright/test";
import { crc32, deflateSync } from "node:zlib";
import { Document, ImageRun, Packer, Paragraph, TextRun } from "docx";

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

async function wordPicture(photo: Buffer, crop?: { right: number }) {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ children: [new TextRun("The stall is by the gate.")] }),
          new Paragraph({
            children: [
              new ImageRun({
                type: "png",
                data: photo,
                transformation: { width: 240, height: 120 },
                ...(crop ? { crop: { left: 0, top: 0, right: crop.right, bottom: 0 } } : {}),
                altText: {
                  title: "Stall and parking lot",
                  description: "Stall and parking lot",
                  name: "Photo",
                },
              }),
            ],
          }),
        ],
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

async function openDocx(page: Page, name: string, buffer: Buffer) {
  await page.goto("/");
  await page.locator('input[type=file][accept*=".docx"]').setInputFiles({
    name,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer,
  });
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toContainText("The stall is by the gate.");
  return editor;
}

async function drag(page: Page, dx: number) {
  const handle = page.locator('[data-crop-edge="right"]');
  const box = (await handle.boundingBox())!;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y, { steps: 12 });
  await page.mouse.up();
}

test("a cropped Word picture opens as the stall and still contains the parking lot", async ({
  page,
}) => {
  const photo = stallPhoto();
  const editor = await openDocx(page, "Seed swap sign-up.docx", await wordPicture(photo, { right: 42 }));
  const notes = page.locator(".import-notes");
  await expect(notes.locator("summary")).toHaveText(
    "Imported DOCX: Seed swap sign-up.docx · 1 compatibility note",
  );
  await expect(notes).not.toContainText(/crop/i);

  const image = editor.locator("img");
  await expect(image).toBeVisible();
  const frame = editor.locator("[data-crop-frame]");
  await expect(frame).toHaveAttribute("data-cropped", "true");
  const fullWidth = await image.evaluate((el) => el.offsetWidth);
  const cropped = (await frame.boundingBox())!;
  expect(cropped.width).toBeLessThan(fullWidth * 0.7);
  expect(cropped.width).toBeGreaterThan(fullWidth * 0.45);
  const src = await image.getAttribute("src");
  expect(src).toContain(photo.toString("base64").slice(0, 40));

  await image.click();
  await page.getByRole("button", { name: "Crop", exact: true }).click();
  const scale = await image.evaluate((el) => {
    const width = el.offsetWidth;
    return width > 0 ? el.getBoundingClientRect().width / width || 1 : 1;
  });
  await drag(page, Math.round(fullWidth * 0.2 * scale));
  await expect
    .poll(async () => (await frame.boundingBox())!.width)
    .toBeGreaterThan(cropped.width * 1.2);
  await expect(frame).toHaveAttribute("data-cropped", "true");
  expect(await image.getAttribute("src")).toBe(src);

  await page.getByRole("button", { name: "Reset crop", exact: true }).click();
  await expect(frame).toHaveAttribute("data-cropped", "false");
  await expect.poll(async () => (await image.boundingBox())!.width).toBeGreaterThan(fullWidth * 0.9);
  await expect(page.getByRole("button", { name: "Reset crop", exact: true })).toBeHidden();
});

test("a Word picture with no crop opens at full size", async ({ page }) => {
  const editor = await openDocx(page, "Full picture.docx", await wordPicture(stallPhoto()));
  const image = editor.locator("img");
  await expect(image).toBeVisible();
  const frame = editor.locator("[data-crop-frame]");
  await expect(frame).toHaveAttribute("data-cropped", "false");
  await image.click();
  await expect(page.getByRole("button", { name: "Crop", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset crop", exact: true })).toBeHidden();
  const box = (await image.boundingBox())!;
  const full = await image.evaluate((el) => el.offsetWidth);
  expect(Math.abs(box.width - full)).toBeLessThan(4);
});
