import { readFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import JSZip from "jszip";
import { rotationStoryDocx } from "../../tests/word-image-caption-fixtures";
import { beat, caption, expect, test } from "./harness";

const description = "Fruit on a table.";
const line = "Saturday stall";
const sentence = "We arrived at noon.";
const docxMime =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Wide market photo: blue sky on top, red stall on the left, so a quarter turn is obvious. */
function marketPhoto(width: number, height: number) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      let rgb = [214, 196, 168];
      if (y < Math.round(height * 0.3)) rgb = [120, 168, 214];
      if (x < Math.round(width * 0.13)) rgb = [196, 48, 42];
      if (y > Math.round(height * 0.35) && y < height - 16 && x > 48 && x < width * 0.72) {
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

test("156-keep-the-turn-from-word", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Nia opens a Word file. The market photo was already turned 90 degrees.");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (
    await chooser
  ).setFiles({
    name: "Saturday market.docx",
    mimeType: docxMime,
    buffer: Buffer.from(await rotationStoryDocx(marketPhoto(280, 160), marketPhoto(200, 120))),
  });
  const editor = page.getByRole("textbox", { name: "Document content" });
  const same = page.getByRole("dialog", { name: /already/ });
  await expect(editor.or(same)).toBeVisible();
  if (await same.isVisible()) {
    await same.getByRole("button", { name: "Keep both" }).click();
  }
  const image = editor.locator("img").first();
  await expect(image).toBeVisible();
  await page.locator(".document-stage").evaluate((el) => el.scrollTo(0, 0));

  await caption(page, "The photo arrives sideways. Saturday stall is under it. The description is not.", 1600);
  const captionLine = editor.locator(".doc-image-caption").first();
  await expect(captionLine).toHaveText(line);
  await expect(image).toHaveAttribute("alt", description);
  await expect
    .poll(async () => {
      const box = await image.boundingBox();
      return box != null && box.height > box.width + 8;
    })
    .toBe(true);
  const sideways = (await image.boundingBox())!;
  expect(sideways.height).toBeGreaterThan(sideways.width);
  const hostText = await editor.locator(".doc-image-host").first().innerText();
  expect(hostText).toContain(line);
  expect(hostText).not.toContain(description);
  const outside = await editor.evaluate((root) => {
    const hosts = root.querySelectorAll(".doc-image-host");
    return [...root.querySelectorAll("p")]
      .filter((paragraph) => ![...hosts].some((host) => host.contains(paragraph)))
      .map((paragraph) => paragraph.textContent ?? "");
  });
  expect(outside).toContain(sentence);
  expect(outside.join("\n")).not.toContain(line);
  expect(outside.join("\n")).not.toContain(description);
  const captionBox = (await captionLine.boundingBox())!;
  const sentenceBox = (await editor.getByText(sentence).boundingBox())!;
  expect(captionBox.y).toBeGreaterThanOrEqual(sideways.y + sideways.height - 2);
  expect(sentenceBox.y).toBeGreaterThan(captionBox.y);
  await beat(page, 1400);

  await caption(page, "She selects the photo. The card already says 90 degrees.", 1000);
  await image.click({ position: { x: 24, y: 24 } });
  const card = page.locator(".image-alt-card");
  await expect(card).toBeVisible();
  await expect(card.locator(".image-turn-angle")).toHaveText("90 degrees");
  await expect(card.getByRole("textbox", { name: "Caption" })).toHaveValue(line);
  await expect(card).toContainText(description);
  await expect(card.getByRole("button", { name: "Alt text", exact: true })).toBeVisible();
  const cardText = await card.innerText();
  expect(cardText).toContain(description);
  expect(hostText).not.toContain(description);
  await beat(page, 1600);

  const second = editor.locator("img").nth(1);
  await second.scrollIntoViewIfNeeded();
  await second.click({ position: { x: 24, y: 24 } });
  await expect(card.locator(".image-turn-angle")).toHaveText("0 degrees");
  const flat = (await second.boundingBox())!;
  expect(flat.width).toBeGreaterThan(flat.height);
  expect(Math.abs(flat.width / flat.height - 200 / 120)).toBeLessThan(0.2);
  await caption(page, "A second photo has no rotation. Its card says 0 degrees, and the box stays wide.", 1600);

  await image.scrollIntoViewIfNeeded();
  await image.click({ position: { x: 24, y: 24 } });
  await expect(card.locator(".image-turn-angle")).toHaveText("90 degrees");
  await card.getByRole("button", { name: "Turn left", exact: true }).click();
  await expect(card.locator(".image-turn-angle")).toHaveText("0 degrees");
  const restored = (await image.boundingBox())!;
  expect(restored.width).toBeGreaterThan(restored.height);
  expect(Math.abs(restored.width - sideways.height)).toBeLessThan(6);
  expect(Math.abs(restored.height - sideways.width)).toBeLessThan(6);
  await expect(captionLine).toHaveText(line);
  await expect(image).toHaveAttribute("alt", description);
  await expect(editor.getByText(sentence)).toBeVisible();
  await caption(page, "Turn left. The first photo is upright again, and the card says 0 degrees.", 1600);

  await caption(page, "She turns it right again. The note keeps 90 degrees, the caption, and the description.", 900);
  await card.getByRole("button", { name: "Turn right", exact: true }).click();
  await expect(card.locator(".image-turn-angle")).toHaveText("90 degrees");
  await expect
    .poll(async () => {
      const box = await image.boundingBox();
      return box != null && box.height > box.width;
    })
    .toBe(true);
  await expect(page.getByRole("status")).toContainText("Saved");
  await beat(page, 800);

  await caption(page, "She leaves and opens the file again. The card still says 90 degrees.", 900);
  await page.getByRole("button", { name: "Back to files" }).click();
  await beat(page, 700);
  await page.getByRole("link", { name: /Saturday market/ }).click();
  await expect(editor.getByText(sentence)).toBeVisible();
  const reopened = editor.locator("img").first();
  await expect(reopened).toHaveAttribute("alt", description);
  await expect(editor.locator(".doc-image-caption").first()).toHaveText(line);
  await expect
    .poll(async () => {
      const box = await reopened.boundingBox();
      return box != null && box.height > box.width;
    })
    .toBe(true);
  await reopened.click({ position: { x: 24, y: 24 } });
  await expect(card.locator(".image-turn-angle")).toHaveText("90 degrees");
  await expect(card).toContainText(description);
  await expect(card.getByRole("textbox", { name: "Caption" })).toHaveValue(line);
  await beat(page, 1400);

  await caption(page, "Word stores the 90 degree turn. The caption follows the photo. The description stays the alt text.", 1100);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 500);
  await page.getByRole("menuitem", { name: "Export DOCX", exact: true }).click();
  const docx = await downloading;
  const xml = await JSZip.loadAsync(readFileSync((await docx.path())!)).then((zip) =>
    zip.file("word/document.xml")!.async("string"),
  );
  const drawings = [...xml.matchAll(/<w:drawing\b[\s\S]*?<\/w:drawing>/g)].map(
    (match) => match[0],
  );
  expect(drawings[0]).toContain('rot="5400000"');
  expect(drawings[0]).toContain(`descr="${description}"`);
  const drawing = xml.indexOf("</w:drawing>");
  const captionAt = xml.indexOf(line);
  expect(captionAt).toBeGreaterThan(drawing);
  expect(xml.indexOf("We arrived at")).toBeGreaterThan(captionAt);
  expect(xml).toContain(">noon<");
  expect(xml).not.toContain(`<w:t>${description}</w:t>`);
  await caption(page, "Saturday stall stays under the photo, still a quarter turn from Word.", 2000);
});
