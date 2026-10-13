import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beat, caption, expect, test } from "./harness";
import { letterDocx, letterLogo } from "../../tests/letter-picture";

const greeting =
  "Dear friend, the garden is ready whenever you are. Come by the gate and sit in the shade. The chairs are under the oak if the afternoon turns warm.";

function letterFile() {
  const logo = letterLogo(200, 156);
  return {
    format: "suiteleaf",
    version: 1,
    id: "70-letter-logo",
    kind: "doc",
    title: "A letter",
    createdAt: "2026-10-13T12:00:00.000Z",
    updatedAt: "2026-10-13T12:00:00.000Z",
    content: {
      type: "doc",
      content: [
        {
          type: "image",
          attrs: {
            src: `data:image/png;base64,${logo.toString("base64")}`,
            alt: "Garden logo",
            width: 200,
            height: 156,
          },
        },
        { type: "paragraph", content: [{ type: "text", text: greeting }] },
      ],
    },
  };
}

async function lineBox(page: import("@playwright/test").Page) {
  const picture = (await page.locator(".document-content img").boundingBox())!;
  const line = await page.locator(".document-content p", { hasText: "Dear friend" }).evaluate((paragraph) => {
    const node = paragraph.firstChild;
    if (!node?.textContent) return null;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, Math.min(11, node.textContent.length));
    const rect = range.getBoundingClientRect();
    return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom };
  });
  return { picture, line: line! };
}

test("70-put-a-picture-beside-the-text", async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), "storyboard-70-"));
  const letterPath = join(dir, "A letter.sldoc");
  writeFileSync(letterPath, JSON.stringify(letterFile()));

  await page.goto("/");
  await caption(page, "Lena opens her letter. The logo takes a whole line, and “Dear friend” starts underneath.");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (await chooser).setFiles(letterPath);
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toContainText("Dear friend");
  const image = editor.locator("img");
  await expect(image).toBeVisible();
  await image.scrollIntoViewIfNeeded();
  const blocked = await lineBox(page);
  expect(blocked.line.y).toBeGreaterThanOrEqual(blocked.picture.y + blocked.picture.height - 4);
  await beat(page, 1200);

  await caption(page, "She selects the logo. Wrap text is on the picture, not on the corner handles.", 1200);
  await image.hover();
  await image.click();
  const wrap = page.getByRole("button", { name: "Wrap text", exact: true });
  const corner = editor.locator('[data-resize-handle="bottom-right"]');
  await expect(wrap).toBeVisible();
  await expect(corner).toBeVisible();
  const wrapBox = (await wrap.boundingBox())!;
  const cornerBox = (await corner.boundingBox())!;
  const overlaps =
    wrapBox.x < cornerBox.x + cornerBox.width &&
    cornerBox.x < wrapBox.x + wrapBox.width &&
    wrapBox.y < cornerBox.y + cornerBox.height &&
    cornerBox.y < wrapBox.y + wrapBox.height;
  expect(overlaps).toBe(false);
  await beat(page, 700);
  await wrap.click();
  const menu = page.getByRole("menu", { name: "Wrap text" });
  await expect(menu.getByRole("menuitemradio", { name: "Left" })).toBeVisible();
  await expect(menu.getByRole("menuitemradio", { name: "Right" })).toBeVisible();
  await expect(menu.getByRole("menuitemradio", { name: "Break text" })).toBeVisible();
  const menuBox = (await menu.boundingBox())!;
  expect(
    menuBox.x < cornerBox.x + cornerBox.width &&
      cornerBox.x < menuBox.x + menuBox.width &&
      menuBox.y < cornerBox.y + cornerBox.height &&
      cornerBox.y < menuBox.y + menuBox.height,
  ).toBe(false);
  await beat(page, 1100);

  await menu.getByRole("menuitemradio", { name: "Left", exact: true }).click();
  await expect
    .poll(async () => {
      const { picture, line } = await lineBox(page);
      const overlap = Math.min(picture.y + picture.height, line.bottom) - Math.max(picture.y, line.y);
      return overlap >= 8 && line.x >= picture.x + picture.width - 8;
    })
    .toBe(true);
  await page.getByText("Dear friend").click();
  await caption(page, "Wrap text, Left. The greeting moves up and runs beside the logo.", 1600);

  await image.click();
  await wrap.click();
  await menu.getByRole("menuitemradio", { name: "Right", exact: true }).click();
  await expect
    .poll(async () => {
      const { picture, line } = await lineBox(page);
      const overlap = Math.min(picture.y + picture.height, line.bottom) - Math.max(picture.y, line.y);
      return overlap >= 8 && line.right <= picture.x + 8;
    })
    .toBe(true);
  await page.getByText("Dear friend").click();
  await caption(page, "Right puts the logo on the other side. The greeting stays on the left.", 1600);

  await image.click();
  await wrap.click();
  await menu.getByRole("menuitemradio", { name: "Break text", exact: true }).click();
  await expect
    .poll(async () => {
      const { picture, line } = await lineBox(page);
      return line.y >= picture.y + picture.height - 4;
    })
    .toBe(true);
  await page.getByText("Dear friend").click();
  await caption(page, "Break text puts the logo back on its own line. The greeting returns underneath.", 1600);

  await page.getByRole("button", { name: "Back to files" }).click();
  await beat(page, 500);
  const wordChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (
    await wordChooser
  ).setFiles({
    name: "A letter.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(await letterDocx("left")),
  });
  await expect(page.getByLabel("File title")).toHaveValue("A letter");
  await expect(editor).toContainText("Dear friend");
  await expect(image).toBeVisible();
  await image.scrollIntoViewIfNeeded();
  await expect
    .poll(async () => {
      const { picture, line } = await lineBox(page);
      const overlap = Math.min(picture.y + picture.height, line.bottom) - Math.max(picture.y, line.y);
      return overlap >= 8 && line.x >= picture.x + picture.width - 8;
    })
    .toBe(true);
  await page.getByText("Dear friend").click();
  await caption(page, "She opens a Word letter whose logo is already wrapped square on the left.", 1500);

  const notes = page.locator(".import-notes");
  await notes.scrollIntoViewIfNeeded();
  await notes.locator("summary").click();
  await expect(notes).toContainText("line and page breaks");
  await expect(notes).not.toContainText("floating placement");
  await caption(page, "The import note no longer says the floating placement was dropped.", 1800);
  await notes.locator("summary").click();
  await image.scrollIntoViewIfNeeded();
  await beat(page, 400);

  await expect(page.getByRole("status")).toContainText("Saved");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const download = await downloading;
  const savedPath = join(dir, download.suggestedFilename());
  await download.saveAs(savedPath);
  const saved = JSON.parse(readFileSync(savedPath, "utf8"));
  expect(JSON.stringify(saved.content)).toContain('"wrap":"left"');
  await beat(page, 600);
  await page.getByRole("button", { name: "Back to files" }).click();
  await beat(page, 500);
  const reopen = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (await reopen).setFiles(savedPath);
  const same = page.getByRole("dialog", { name: /already/i });
  await expect(image.or(same)).toBeVisible();
  if (await same.isVisible()) await same.getByRole("button", { name: "Replace" }).click();
  await expect(editor).toContainText("Dear friend");
  await expect
    .poll(async () => {
      const { picture, line } = await lineBox(page);
      const overlap = Math.min(picture.y + picture.height, line.bottom) - Math.max(picture.y, line.y);
      return overlap >= 8 && line.x >= picture.x + picture.width - 8;
    })
    .toBe(true);
  await caption(page, "The logo still sits beside “Dear friend.”", 2000);
});
