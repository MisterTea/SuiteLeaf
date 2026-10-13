import type { Page } from "@playwright/test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import JSZip from "jszip";
import { beat, caption, expect, test, typeSlowly } from "./harness";

/** Stall on the left, parking lot on the right, so a crop is obvious on camera. */
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

async function drag(page: Page, dx: number) {
  const handle = page.locator('[data-crop-edge="right"]');
  const box = (await handle.boundingBox())!;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y, { steps: 8 });
  await beat(page, 250);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y, { steps: 28 });
  await page.mouse.up();
  await beat(page, 500);
}

test("57-crop-a-photo", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Lena is making the seed-swap sign-up note.");
  await page.getByRole("button", { name: "New document" }).click();
  const title = page.getByLabel("File title");
  await title.click();
  await title.press("ControlOrMeta+A");
  await typeSlowly(page, "Seed swap sign-up");
  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.click();
  await typeSlowly(page, "Saturday, 9 to noon. The stall is by the gate.");
  await page.keyboard.press("Enter");

  await caption(page, "She adds the photo. It shows the stall and the parking lot.", 1000);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Insert image", exact: true }).click();
  const photo = stallPhoto();
  await (await chooser).setFiles({
    name: "seed-swap.png",
    mimeType: "image/png",
    buffer: photo,
  });
  const image = editor.locator("img");
  await expect(image).toBeVisible();
  await image.scrollIntoViewIfNeeded();
  await beat(page, 900);
  const src = await image.getAttribute("src");

  await caption(page, "Crop is its own control. The corner handles still resize the whole photo.", 1200);
  await image.click();
  const crop = page.getByRole("button", { name: "Crop", exact: true });
  const corner = editor.locator('[data-resize-handle="bottom-right"]');
  await expect(crop).toBeVisible();
  await expect(corner).toBeVisible();
  await crop.scrollIntoViewIfNeeded();
  await beat(page, 800);
  const cropBox = (await crop.boundingBox())!;
  const cornerBox = (await corner.boundingBox())!;
  expect(
    cropBox.x < cornerBox.x + cornerBox.width &&
      cornerBox.x < cropBox.x + cropBox.width &&
      cropBox.y < cornerBox.y + cornerBox.height &&
      cornerBox.y < cropBox.y + cropBox.height,
  ).toBe(false);

  await crop.click();
  await expect(page.getByText("The rest of the photo stays the same size.")).toBeVisible();
  await expect(corner).toBeHidden();
  await beat(page, 700);
  const frame = editor.locator("[data-resize-wrapper]");
  const before = (await frame.boundingBox())!;
  const fullWidth = await image.evaluate((el) => el.offsetWidth);
  await caption(page, "She drags the right edge in. The stall stays the same size.", 900);
  await drag(page, -Math.round(fullWidth * 0.42));
  const cropped = (await frame.boundingBox())!;
  expect(Math.abs(cropped.x - before.x)).toBeLessThan(4);
  expect(cropped.width).toBeLessThan(before.width * 0.7);
  expect(Math.abs(cropped.height - before.height)).toBeLessThan(4);
  expect(await image.evaluate((el) => el.offsetWidth)).toBeGreaterThan(fullWidth - 2);
  expect(await image.getAttribute("src")).toBe(src);
  await beat(page, 800);

  await caption(page, "She opens Crop again and drags the edge back. The parking lot was never deleted.", 1100);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await beat(page, 400);
  await crop.click();
  await drag(page, Math.round(fullWidth * 0.42));
  await expect.poll(async () => (await frame.boundingBox())!.width).toBeGreaterThan(before.width * 0.9);
  await beat(page, 700);

  await caption(page, "She hides the parking lot again, then downloads the note.", 1000);
  await drag(page, -Math.round(fullWidth * 0.42));
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("Seed swap sign-up.sldoc");
  const savedPath = join(mkdtempSync(join(tmpdir(), "storyboard-57-")), download.suggestedFilename());
  await download.saveAs(savedPath);
  const saved = JSON.parse(readFileSync(savedPath, "utf8"));
  expect(JSON.stringify(saved.content)).toContain("cropRight");
  expect(JSON.stringify(saved.content)).toContain(String(src).slice(0, 48));
  await beat(page, 600);

  await caption(page, "She opens that copy. The crop is still the stall.", 1000);
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  const openChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (await openChooser).setFiles(savedPath);
  const same = page.getByRole("dialog", { name: /already/ });
  const reopenedImage = editor.locator("img");
  await expect(reopenedImage.or(same)).toBeVisible();
  if (await same.isVisible()) await same.getByRole("button", { name: "Replace" }).click();
  await expect(reopenedImage).toBeVisible();
  await reopenedImage.scrollIntoViewIfNeeded();
  await expect.poll(async () => (await frame.boundingBox())?.width ?? 9999).toBeLessThan(before.width * 0.75);
  await beat(page, 800);

  await caption(page, "Reset crop brings the parking lot back in one click.", 900);
  await image.click();
  await page.getByRole("button", { name: "Reset crop", exact: true }).click();
  await expect.poll(async () => (await frame.boundingBox())!.width).toBeGreaterThan(before.width * 0.9);
  await beat(page, 900);

  await caption(page, "She crops once more and exports for Word. The file keeps every pixel.", 1000);
  await crop.click();
  await drag(page, -Math.round(fullWidth * 0.42));
  await page.getByRole("button", { name: "Done", exact: true }).click();
  const docxPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 400);
  await page.getByRole("menuitem", { name: "Export DOCX", exact: true }).click();
  const docx = await docxPromise;
  const zip = await JSZip.loadAsync(readFileSync((await docx.path())!));
  const names = Object.keys(zip.files);
  const xml = await zip.file("word/document.xml")!.async("string");
  expect(xml).toMatch(/<a:srcRect[^>]*\br="\d{4,}"/);
  const mediaName = names.find((name) => /media\/.+\.(png|jpe?g|gif)$/i.test(name));
  expect(mediaName, names.join("\n")).toBeTruthy();
  expect(Buffer.from(await zip.file(mediaName!)!.async("uint8array")).equals(photo)).toBe(true);
  await caption(page, "Word gets the stall, and the parking lot is still in the file.", 1800);
});
