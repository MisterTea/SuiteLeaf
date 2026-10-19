import type { Page } from "@playwright/test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { Document, ImageRun, Packer, Paragraph, TextRun } from "docx";
import JSZip from "jszip";
import { beat, caption, expect, test } from "./harness";

/** Stall on the left, parking lot on the right, so a crop is obvious on camera. */
function stallPhoto(width = 560, height = 280) {
  const stall = Math.round(width * 0.58);
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      let rgb = [150, 154, 158];
      if (x < stall) {
        if (y < 64) rgb = x % 28 < 14 ? [196, 48, 42] : [255, 236, 210];
        else rgb = (x + y) % 36 < 18 ? [64, 150, 60] : [232, 186, 48];
      } else if (y > 40 && (x - stall) % 52 < 4) rgb = [245, 245, 245];
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

async function croppedWordFile(photo: Buffer) {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [new TextRun("The stall is by the gate.")],
          }),
          new Paragraph({
            children: [
              new ImageRun({
                type: "png",
                data: photo,
                transformation: { width: 420, height: 210 },
                crop: { left: 0, top: 0, right: 42, bottom: 0 },
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

test("67-open-a-cropped-word-picture", async ({ page }) => {
  const photo = stallPhoto();
  const docx = await croppedWordFile(photo);
  const zip = await JSZip.loadAsync(docx);
  const sourceXml = await zip.file("word/document.xml")!.async("string");
  expect(sourceXml).toMatch(/<a:srcRect[^>]*\br="42000"/);

  await page.goto("/");
  await caption(page, "Lena opens the Word file the printer sent back.");
  const openImport = page.getByRole("button", { name: "Open / import" });
  await openImport.scrollIntoViewIfNeeded();
  await beat(page, 500);
  const chooser = page.waitForEvent("filechooser");
  await openImport.click();
  await (await chooser).setFiles({
    name: "Seed swap sign-up.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: docx,
  });

  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(page.getByLabel("File title")).toHaveValue("Seed swap sign-up");
  await expect(editor).toContainText("The stall is by the gate.");
  const image = editor.locator("img");
  await expect(image).toBeVisible();
  await image.scrollIntoViewIfNeeded();
  const frame = editor.locator("[data-crop-frame]");
  await expect(frame).toHaveAttribute("data-cropped", "true");
  const full = (await image.boundingBox())!;
  const cropped = (await frame.boundingBox())!;
  expect(cropped.width).toBeLessThan(full.width * 0.7);
  expect(cropped.width).toBeGreaterThan(full.width * 0.45);
  const src = await image.getAttribute("src");
  expect(src).toContain(photo.toString("base64").slice(0, 48));
  const stall = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, {
    x: cropped.x + 36,
    y: cropped.y + cropped.height / 2,
  });
  const parking = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, {
    x: cropped.x + cropped.width + 28,
    y: cropped.y + cropped.height / 2,
  });
  expect(stall).toBe("IMG");
  expect(parking).not.toBe("IMG");
  await beat(page, 800);

  await caption(page, "The page shows the stall. Nothing says the crop was dropped.", 1200);
  const notes = page.locator(".import-notes");
  await notes.scrollIntoViewIfNeeded();
  await expect(notes.locator("summary")).toHaveText(
    "Imported DOCX: Seed swap sign-up.docx · 1 compatibility note",
  );
  await notes.locator("summary").click();
  await expect(notes.locator("li")).toHaveText([/SuiteLeaf lays out its own pages/]);
  await expect(notes).not.toContainText(/crop/i);
  await beat(page, 2200);
  await notes.locator("summary").click();
  await image.scrollIntoViewIfNeeded();

  await caption(page, "She selects the photo and drags the edge back. The parking lot was still there.", 1100);
  await image.click();
  const crop = page.getByRole("button", { name: "Crop", exact: true });
  await crop.scrollIntoViewIfNeeded();
  await beat(page, 400);
  await crop.click();
  await expect(page.getByText("The rest of the photo stays the same size.")).toBeVisible();
  await drag(page, Math.max(36, Math.round(cropped.width * 0.45)));
  await expect
    .poll(async () => (await frame.boundingBox())!.width)
    .toBeGreaterThan(cropped.width * 1.2);
  await expect(frame).toHaveAttribute("data-cropped", "true");
  expect(await image.getAttribute("src")).toBe(src);
  const revealed = (await frame.boundingBox())!;
  const lot = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, {
    x: cropped.x + cropped.width + 16,
    y: revealed.y + revealed.height / 2,
  });
  expect(lot).toBe("IMG");
  await beat(page, 700);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await beat(page, 400);

  await caption(page, "Reset crop shows the whole picture in one click.", 1000);
  await expect(page.getByRole("button", { name: "Reset crop", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reset crop", exact: true }).click();
  await expect(frame).toHaveAttribute("data-cropped", "false");
  await expect
    .poll(async () => (await image.boundingBox())!.width)
    .toBeGreaterThan(full.width * 0.9);
  await beat(page, 900);

  await caption(page, "She crops the parking lot out again and exports for Word.", 1000);
  await crop.click();
  await drag(page, -Math.round(full.width * 0.42));
  const exportedFrame = (await frame.boundingBox())!;
  expect(exportedFrame.width).toBeLessThan(full.width * 0.7);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await beat(page, 400);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 900);
  await page.getByRole("menuitem", { name: "Export DOCX", exact: true }).click();
  const download = await downloading;
  const docxPath = join(
    mkdtempSync(join(tmpdir(), "storyboard-67-")),
    "Seed swap sign-up.docx",
  );
  await download.saveAs(docxPath);
  const exported = await JSZip.loadAsync(readFileSync(docxPath));
  const exportedXml = await exported.file("word/document.xml")!.async("string");
  expect(exportedXml).toMatch(/<a:srcRect[^>]*\br="\d{4,}"/);
  const mediaName = Object.keys(exported.files).find((name) =>
    /media\/.+\.png$/i.test(name),
  );
  expect(mediaName).toBeTruthy();
  expect(Buffer.from(await exported.file(mediaName!)!.async("uint8array")).equals(photo)).toBe(
    true,
  );
  await beat(page, 600);

  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  const listed = page.getByRole("link", { name: "Seed swap sign-up", exact: true });
  await listed.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await beat(page, 300);
  await caption(page, "She opens that Word file. The stall is still the frame.", 1400);
  const again = page.waitForEvent("filechooser");
  const openAgain = page.getByRole("button", { name: "Open / import" });
  await openAgain.scrollIntoViewIfNeeded();
  await openAgain.click();
  await (await again).setFiles(docxPath);
  await expect(page.getByLabel("File title")).toHaveValue("Seed swap sign-up");
  const reopened = editor.locator("img");
  await expect(reopened).toBeVisible();
  await reopened.scrollIntoViewIfNeeded();
  await expect(frame).toHaveAttribute("data-cropped", "true");
  await expect(notes.locator("summary")).toHaveText(
    "Imported DOCX: Seed swap sign-up.docx · 1 compatibility note",
  );
  const returned = (await frame.boundingBox())!;
  const returnedFull = (await reopened.boundingBox())!;
  expect(returned.width).toBeLessThan(returnedFull.width * 0.7);
  expect(returned.width).toBeGreaterThan(returnedFull.width * 0.45);
  expect(await reopened.getAttribute("src")).toContain(photo.toString("base64").slice(0, 48));
  const stillStall = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, {
    x: returned.x + 36,
    y: returned.y + returned.height / 2,
  });
  const stillLot = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, {
    x: returned.x + returned.width + 28,
    y: returned.y + returned.height / 2,
  });
  expect(stillStall).toBe("IMG");
  expect(stillLot).not.toBe("IMG");
  await caption(page, "Word still shows the stall, and the parking lot is still in the file.", 1800);
});
