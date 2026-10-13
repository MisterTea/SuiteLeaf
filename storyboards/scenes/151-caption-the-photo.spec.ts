import { readFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import JSZip from "jszip";
import { beat, caption, expect, test, typeSlowly } from "./harness";

const description = "Fruit on a table.";
const line = "Saturday stall";
const sentence = "We arrived at noon.";

/** A small market photo: fruit on the left, the stall cloth on the right. */
function marketPhoto(width = 280, height = 180) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      let rgb = [214, 196, 168];
      if (y < 36) rgb = [120, 168, 214];
      if (y > 48 && y < 150 && x > 24 && x < width * 0.72) {
        const colors = [
          [196, 48, 42],
          [232, 186, 48],
          [64, 150, 60],
          [168, 64, 120],
        ];
        const column = Math.floor((x - 24) / 36);
        if ((x - 24) % 36 < 30 && (y - 48) % 34 < 28) rgb = colors[column % colors.length];
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

test("151-caption-the-photo", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Nia has a photo of the Saturday market in her notes.");
  await page.getByRole("button", { name: "New document" }).click();
  const title = page.getByLabel("File title");
  await title.click();
  await title.press("ControlOrMeta+A");
  await typeSlowly(page, "Saturday market", 40);
  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.click();

  await caption(page, "The photo is already in the note, with a sentence after it.", 1000);
  const insert = page.getByRole("button", { name: "Insert image", exact: true });
  if (!(await insert.isVisible())) {
    await page.getByRole("button", { name: "More tools" }).click();
    await beat(page, 300);
  }
  const chooser = page.waitForEvent("filechooser");
  await insert.click();
  await (await chooser).setFiles({
    name: "market.png",
    mimeType: "image/png",
    buffer: marketPhoto(),
  });
  const image = editor.locator("img");
  await expect(image).toBeVisible();
  await typeSlowly(page, sentence, 28);
  await beat(page, 400);

  await image.click();
  const card = page.locator(".image-alt-card");
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Alt text", exact: true }).click();
  const alt = page.getByRole("textbox", { name: "Description" });
  await typeSlowly(page, description, 28);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(image).toHaveAttribute("alt", description);
  await expect(card).toContainText(description);
  await beat(page, 500);

  await caption(page, "The card beside the photo has the description and a Caption field.", 1400);
  const captionField = card.getByRole("textbox", { name: "Caption" });
  await expect(captionField).toBeVisible();
  await expect(card.getByText("Caption", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const before = (await image.boundingBox())!;
  await captionField.click();
  await beat(page, 400);

  await caption(page, "She types a caption. It shows under the photo, smaller than the sentence.", 900);
  await typeSlowly(page, line, 50);
  const captionLine = editor.locator(".doc-image-caption");
  await expect(captionLine).toBeVisible();
  await expect(captionLine).toHaveText(line);
  await expect(image).toHaveAttribute("alt", description);
  const hostText = await editor.locator(".doc-image-host").innerText();
  expect(hostText).toContain(line);
  expect(hostText).not.toContain(description);
  const outside = await editor.evaluate((root) => {
    const host = root.querySelector(".doc-image-host");
    return [...root.querySelectorAll("p")]
      .filter((paragraph) => !host?.contains(paragraph))
      .map((paragraph) => paragraph.textContent ?? "");
  });
  expect(outside).toContain(sentence);
  expect(outside.join("\n")).not.toContain(line);
  expect(outside.join("\n")).not.toContain(description);
  const captionBox = (await captionLine.boundingBox())!;
  const sentenceBox = (await editor.getByText(sentence).boundingBox())!;
  expect(sentenceBox.y).toBeGreaterThan(captionBox.y);
  const captionSize = await captionLine.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const bodySize = await editor.getByText(sentence).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(captionSize).toBeLessThan(bodySize);
  const after = (await image.boundingBox())!;
  expect(Math.abs(after.width - before.width)).toBeLessThan(2);
  expect(Math.abs(after.height - before.height)).toBeLessThan(2);
  await beat(page, 1200);

  await caption(page, "She clears the caption. The line goes away. The photo and its description stay.", 1000);
  await captionField.click();
  await captionField.press("ControlOrMeta+A");
  await captionField.press("Backspace");
  await expect(captionLine).toBeHidden();
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("alt", description);
  await expect(card).toContainText(description);
  await expect(editor.getByText(sentence)).toBeVisible();
  const cleared = (await image.boundingBox())!;
  expect(Math.abs(cleared.width - before.width)).toBeLessThan(2);
  expect(Math.abs(cleared.height - before.height)).toBeLessThan(2);
  await beat(page, 1200);

  await caption(page, "She types the caption again. It saves with the note.", 900);
  await captionField.click();
  await typeSlowly(page, line, 40);
  await expect(captionLine).toHaveText(line);
  await expect(page.getByRole("status")).toContainText("Saved");
  await beat(page, 800);

  await caption(page, "She leaves and opens the note again.", 900);
  await page.getByRole("button", { name: "Back to files" }).click();
  await beat(page, 700);
  await page.getByRole("link", { name: /Saturday market/ }).click();
  await expect(editor.getByText(sentence)).toBeVisible();
  const reopened = editor.locator(".doc-image-caption");
  await expect(reopened).toBeVisible();
  await expect(reopened).toHaveText(line);
  await expect(editor.locator("img")).toHaveAttribute("alt", description);
  await editor.locator("img").click();
  await expect(card).toContainText(description);
  await expect(card.getByRole("textbox", { name: "Caption" })).toHaveValue(line);
  await beat(page, 1400);

  await caption(page, "Word gets the caption after the photo. The description stays the alt text.", 1100);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 500);
  await page.getByRole("menuitem", { name: "Export DOCX", exact: true }).click();
  const docx = await downloading;
  const xml = await JSZip.loadAsync(readFileSync((await docx.path())!)).then((zip) =>
    zip.file("word/document.xml")!.async("string"),
  );
  const drawing = xml.indexOf("</w:drawing>");
  expect(xml).toContain(`descr="${description}"`);
  expect(xml.indexOf(line)).toBeGreaterThan(drawing);
  expect(xml.indexOf(sentence)).toBeGreaterThan(xml.indexOf(line));
  expect(xml).not.toContain(`<w:t>${description}</w:t>`);
  await caption(page, "Saturday stall stays under the photo. Fruit on a table stays the description.", 2000);
});
