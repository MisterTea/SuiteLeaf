import { readFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import JSZip from "jszip";
import { beat, caption, expect, test, typeSlowly } from "./harness";

const description = "Fruit on a table.";
const line = "Saturday stall";
const sentence = "We arrived at noon.";

/** Wide market photo: blue sky on top, red stall on the left, so a quarter turn is obvious. */
function marketPhoto(width = 280, height = 160) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      let rgb = [214, 196, 168];
      if (y < 48) rgb = [120, 168, 214];
      if (x < 36) rgb = [196, 48, 42];
      if (y > 56 && y < height - 16 && x > 48 && x < width * 0.72) {
        const colors = [
          [196, 48, 42],
          [232, 186, 48],
          [64, 150, 60],
          [168, 64, 120],
        ];
        const column = Math.floor((x - 48) / 36);
        if ((x - 48) % 36 < 30 && (y - 56) % 34 < 28) rgb = colors[column % colors.length];
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

test("155-turn-the-photo", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Nia has a market photo that was taken sideways.");
  await page.getByRole("button", { name: "New document" }).click();
  const title = page.getByLabel("File title");
  await title.click();
  await title.press("ControlOrMeta+A");
  await typeSlowly(page, "Saturday market", 40);
  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.click();

  await caption(page, "The photo is in the note, with a sentence after it.", 1000);
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
  await typeSlowly(page, description, 22);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(image).toHaveAttribute("alt", description);

  await caption(page, "The card has the caption, and Turn right and Turn left. It says 0 degrees.", 1200);
  const captionField = card.getByRole("textbox", { name: "Caption" });
  await captionField.click();
  await typeSlowly(page, line, 40);
  const captionLine = editor.locator(".doc-image-caption");
  await expect(captionLine).toHaveText(line);
  await expect(card.locator(".image-turn-angle")).toHaveText("0 degrees");
  await expect(card.getByRole("button", { name: "Turn right", exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Turn left", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(editor.locator("[data-rotate-handle]")).toHaveCount(0);
  const upright = (await image.boundingBox())!;
  expect(upright.width).toBeGreaterThan(upright.height);
  await beat(page, 800);

  await caption(page, "Turn right. The photo is sideways, the box swaps, and the caption stays under it.", 800);
  await card.getByRole("button", { name: "Turn right", exact: true }).click();
  await expect(card.locator(".image-turn-angle")).toHaveText("90 degrees");
  const sideways = (await image.boundingBox())!;
  expect(Math.abs(sideways.width - upright.height)).toBeLessThan(4);
  expect(Math.abs(sideways.height - upright.width)).toBeLessThan(4);
  expect(sideways.height).toBeGreaterThan(sideways.width);
  await expect(captionLine).toHaveText(line);
  await expect(image).toHaveAttribute("alt", description);
  const hostText = await editor.locator(".doc-image-host").innerText();
  expect(hostText).toContain(line);
  expect(hostText).not.toContain(description);
  const captionBox = (await captionLine.boundingBox())!;
  const sentenceBox = (await editor.getByText(sentence).boundingBox())!;
  expect(captionBox.y).toBeGreaterThanOrEqual(sideways.y + sideways.height - 2);
  expect(captionBox.x).toBeLessThan(sideways.x + sideways.width);
  expect(sentenceBox.y).toBeGreaterThan(captionBox.y);
  const outside = await editor.evaluate((root) => {
    const host = root.querySelector(".doc-image-host");
    return [...root.querySelectorAll("p")]
      .filter((paragraph) => !host?.contains(paragraph))
      .map((paragraph) => paragraph.textContent ?? "");
  });
  expect(outside).toContain(sentence);
  expect(outside.join("\n")).not.toContain(line);
  expect(outside.join("\n")).not.toContain(description);
  await beat(page, 1400);

  await caption(page, "Turn left. The photo is upright again, and the card says 0 degrees.", 800);
  await card.getByRole("button", { name: "Turn left", exact: true }).click();
  await expect(card.locator(".image-turn-angle")).toHaveText("0 degrees");
  const restored = (await image.boundingBox())!;
  expect(Math.abs(restored.width - upright.width)).toBeLessThan(4);
  expect(Math.abs(restored.height - upright.height)).toBeLessThan(4);
  await expect(captionLine).toHaveText(line);
  await expect(image).toHaveAttribute("alt", description);
  await beat(page, 1200);

  await caption(page, "She turns it right again. The note saves the angle, the caption, and the description.", 900);
  await card.getByRole("button", { name: "Turn right", exact: true }).click();
  await expect(card.locator(".image-turn-angle")).toHaveText("90 degrees");
  await expect(page.getByRole("status")).toContainText("Saved");
  await beat(page, 800);

  await caption(page, "She leaves and opens the note again. The photo is still at 90 degrees.", 900);
  await page.getByRole("button", { name: "Back to files" }).click();
  await beat(page, 700);
  await page.getByRole("link", { name: /Saturday market/ }).click();
  await expect(editor.getByText(sentence)).toBeVisible();
  const reopenedCaption = editor.locator(".doc-image-caption");
  await expect(reopenedCaption).toHaveText(line);
  const reopened = editor.locator("img");
  await expect(reopened).toHaveAttribute("alt", description);
  await expect
    .poll(async () => {
      const box = await reopened.boundingBox();
      return box != null && box.height > box.width;
    })
    .toBe(true);
  const again = (await reopened.boundingBox())!;
  expect(again.height).toBeGreaterThan(again.width);
  expect(Math.abs(again.width - upright.height)).toBeLessThan(4);
  expect(Math.abs(again.height - upright.width)).toBeLessThan(4);
  const reopenedCaptionBox = (await reopenedCaption.boundingBox())!;
  expect(reopenedCaptionBox.y).toBeGreaterThanOrEqual(again.y + again.height - 2);
  await reopened.click();
  await expect(card.locator(".image-turn-angle")).toHaveText("90 degrees");
  await expect(card).toContainText(description);
  await expect(card.getByRole("textbox", { name: "Caption" })).toHaveValue(line);
  await beat(page, 1200);

  await caption(page, "Word stores the 90 degree turn. The caption follows the photo. The description stays the alt text.", 1100);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 500);
  await page.getByRole("menuitem", { name: "Export DOCX", exact: true }).click();
  const docx = await downloading;
  const xml = await JSZip.loadAsync(readFileSync((await docx.path())!)).then((zip) =>
    zip.file("word/document.xml")!.async("string"),
  );
  const drawing = xml.indexOf("</w:drawing>");
  expect(xml).toContain('rot="5400000"');
  expect(xml).toContain(`descr="${description}"`);
  expect(xml.indexOf(line)).toBeGreaterThan(drawing);
  expect(xml.indexOf(sentence)).toBeGreaterThan(xml.indexOf(line));
  expect(xml).not.toContain(`<w:t>${description}</w:t>`);
  await caption(page, "Saturday stall stays under the photo, turned a quarter to the right.", 2000);
});
