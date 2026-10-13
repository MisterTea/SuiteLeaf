import { readFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import JSZip from "jszip";
import { captionStoryDocx } from "../../tests/word-image-caption-fixtures";
import { beat, caption, expect, test, typeSlowly } from "./harness";

const description = "Fruit on a table.";
const line = "Saturday stall";
const edited = "Sunday stall";
const sentence = "We arrived at noon.";
const docxMime =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

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

test("153-keep-the-caption-from-word", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Nia opens a Word file. The market photo has a caption and a description.");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (
    await chooser
  ).setFiles({
    name: "Saturday market.docx",
    mimeType: docxMime,
    buffer: Buffer.from(await captionStoryDocx(marketPhoto())),
  });
  const editor = page.getByRole("textbox", { name: "Document content" });
  const same = page.getByRole("dialog", { name: /already/ });
  await expect(editor.or(same)).toBeVisible();
  if (await same.isVisible()) {
    await same.getByRole("button", { name: "Keep both" }).click();
  }
  const image = editor.locator("img");
  await expect(image).toBeVisible();
  await page.locator(".document-stage").evaluate((el) => el.scrollTo(0, 0));

  await caption(page, "Saturday stall is under the photo. Fruit on a table is not a line under it.", 1400);
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
  const imageBox = (await image.boundingBox())!;
  const sentenceBox = (await editor.getByText(sentence).boundingBox())!;
  expect(captionBox.y).toBeGreaterThan(imageBox.y);
  expect(sentenceBox.y).toBeGreaterThan(captionBox.y);
  await beat(page, 1200);

  await caption(page, "She selects the photo. The card shows Caption and the description as two fields.", 1200);
  await image.scrollIntoViewIfNeeded();
  await image.click({ position: { x: 32, y: 32 } });
  const card = page.locator(".image-alt-card");
  await expect(card).toBeVisible();
  await expect(card.getByText("Caption", { exact: true })).toBeVisible();
  await expect(card.getByRole("textbox", { name: "Caption" })).toHaveValue(line);
  await expect(card).toContainText(description);
  await expect(card.getByRole("button", { name: "Alt text", exact: true })).toBeVisible();
  const cardText = await card.innerText();
  expect(cardText).toContain(description);
  expect(hostText).not.toContain(description);
  await beat(page, 1400);

  await caption(page, "She changes the caption to Sunday stall. The line under the photo changes.", 1000);
  const captionField = card.getByRole("textbox", { name: "Caption" });
  await captionField.click();
  await captionField.press("ControlOrMeta+A");
  await typeSlowly(page, edited, 50);
  await expect(captionLine).toHaveText(edited);
  await expect(image).toHaveAttribute("alt", description);
  await expect(editor.getByText(sentence)).toBeVisible();
  const editedBox = (await captionLine.boundingBox())!;
  const stillNoon = (await editor.getByText(sentence).boundingBox())!;
  expect(stillNoon.y).toBeGreaterThan(editedBox.y);
  await expect(page.getByRole("status")).toContainText("Saved");
  await beat(page, 1200);

  await caption(page, "She leaves and opens the file again. Sunday stall and the description are still on the photo.", 1000);
  await page.getByRole("button", { name: "Back to files" }).click();
  await beat(page, 700);
  await page.getByRole("link", { name: /Saturday market/ }).click();
  await expect(editor.getByText(sentence)).toBeVisible();
  const reopened = editor.locator(".doc-image-caption");
  await expect(reopened).toHaveText(edited);
  await expect(editor.locator("img")).toHaveAttribute("alt", description);
  await editor.locator("img").click();
  await expect(card).toContainText(description);
  await expect(card.getByRole("textbox", { name: "Caption" })).toHaveValue(edited);
  const reopenedHost = await editor.locator(".doc-image-host").innerText();
  expect(reopenedHost).toContain(edited);
  expect(reopenedHost).not.toContain(description);
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
  expect(xml.indexOf(edited)).toBeGreaterThan(drawing);
  expect(xml.indexOf("We arrived at")).toBeGreaterThan(xml.indexOf(edited));
  expect(xml).toContain(">noon<");
  expect(xml).not.toContain(`<w:t>${description}</w:t>`);
  const exported = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((match) => match[0]);
  const captionXml = exported.find((item) => item.includes(edited));
  const noonXml = exported.find((item) => item.includes("We arrived at"));
  expect(captionXml).toMatch(/<w:pStyle\b[^>]*w:val="Caption"/);
  expect(noonXml).not.toMatch(/w:val="Caption"/);
  await caption(page, "Sunday stall stays under the photo. We arrived at noon stays a sentence.", 2000);
});
