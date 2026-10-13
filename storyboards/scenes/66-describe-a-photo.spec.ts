import { readFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import JSZip from "jszip";
import { beat, caption, expect, test, typeSlowly } from "./harness";

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

test("66-describe-a-photo", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Lena is writing the seed-swap sign-up. A member who uses a screen reader will hear this photo.");
  await page.getByRole("button", { name: "New document" }).click();
  const title = page.getByLabel("File title");
  await title.click();
  await title.press("ControlOrMeta+A");
  await typeSlowly(page, "Seed swap sign-up", 40);
  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.click();
  await typeSlowly(page, "The stall on Saturday morning.", 28);
  await page.keyboard.press("Enter");
  await beat(page, 400);

  await caption(page, "She adds the stall photo. The file on her camera is named IMG_2044.", 1200);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Insert image", exact: true }).click();
  await (await chooser).setFiles({
    name: "IMG_2044.jpg",
    mimeType: "image/png",
    buffer: stallPhoto(),
  });
  const image = editor.locator("img");
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("alt", "");
  await beat(page, 900);

  await caption(page, "She selects the photo. Alt text sits beside it, apart from the corner handles.", 1000);
  await image.click();
  const card = page.locator(".image-alt-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("No description");
  await expect(card).not.toContainText("IMG_2044");
  const cardBox = (await card.boundingBox())!;
  const imageBox = (await image.boundingBox())!;
  expect(cardBox.x).toBeGreaterThanOrEqual(imageBox.x + imageBox.width - 1);
  for (const corner of ["top-right", "bottom-right"]) {
    const handle = (await editor.locator(`[data-resize-handle="${corner}"]`).boundingBox())!;
    expect(cardBox.x).toBeGreaterThanOrEqual(handle.x + handle.width - 1);
  }
  await beat(page, 1200);

  await caption(page, "Google would offer IMG_2044 as the description. This field starts empty.", 1400);
  await card.getByRole("button", { name: "Alt text", exact: true }).click();
  const field = page.getByRole("textbox", { name: "Description" });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("");
  await beat(page, 800);
  await typeSlowly(page, sentence, 42);
  await beat(page, 700);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(image).toHaveAttribute("alt", sentence);
  await expect(card).toContainText(sentence);
  await caption(page, "Apply stores that sentence on the photo.", 1400);

  await caption(page, "She clicks away, then selects the photo again.", 900);
  await editor.locator("p").first().click();
  await expect(card).toBeHidden();
  await beat(page, 500);
  await image.click();
  await expect(card).toContainText(sentence);
  await expect(card).not.toContainText("IMG_2044");
  await beat(page, 800);
  await card.getByRole("button", { name: "Alt text", exact: true }).click();
  await expect(field).toHaveValue(sentence);
  await caption(page, "The same sentence is there. Not the file name.", 1800);

  await caption(page, "She clears it and applies. The photo stays.", 900);
  await field.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  await expect(field).toHaveValue("");
  await beat(page, 800);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("alt", "");
  await expect(card).toContainText("No description");
  await expect(card).not.toContainText("IMG_2044");
  await caption(page, "The description is empty. Nothing is left over from IMG_2044.", 1800);

  await caption(page, "She writes the sentence back. That is the description she wants to keep.", 1000);
  await card.getByRole("button", { name: "Alt text", exact: true }).click();
  await expect(field).toHaveValue("");
  await typeSlowly(page, sentence, 36);
  await beat(page, 500);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(image).toHaveAttribute("alt", sentence);
  await expect(page.getByRole("status")).toContainText("Saved");
  await caption(page, "It saves on this device. She leaves and opens the note again.", 1400);

  await page.getByRole("button", { name: "Back to files" }).click();
  await beat(page, 700);
  await page.getByRole("link", { name: /Seed swap sign-up/ }).click();
  await expect(editor).toContainText("Saturday morning");
  await expect(image).toHaveAttribute("alt", sentence);
  await image.click();
  await expect(card).toContainText(sentence);
  await card.getByRole("button", { name: "Alt text", exact: true }).click();
  await expect(field).toHaveValue(sentence);
  await caption(page, "The description is still on the photo.", 1800);
  await page.getByRole("button", { name: "Close alt text" }).click();
  await beat(page, 400);

  await caption(page, "File, Export DOCX. Word gets that sentence, not the file name and not “Image”.", 1100);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 600);
  await page.getByRole("menuitem", { name: "Export DOCX", exact: true }).click();
  const docx = await downloading;
  const zip = await JSZip.loadAsync(readFileSync((await docx.path())!));
  const xml = await zip.file("word/document.xml")!.async("string");
  expect(xml).toContain(`descr="${sentence}"`);
  expect(xml).toContain(`name="${sentence}"`);
  expect(xml).not.toContain('name="Image"');
  expect(xml).not.toContain("IMG_2044");
  await caption(page, `Saved “${docx.suggestedFilename()}”. A screen reader, and Word, get the sentence Lena wrote.`, 2400);
});
