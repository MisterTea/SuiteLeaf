import { expect, test, type Page } from "@playwright/test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { letterDocx, letterGreeting, letterLogo } from "../letter-picture";

test.use({ viewport: { width: 1280, height: 800 } });

const paginated = (page: Page) =>
  page.evaluate(
    () =>
      new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

async function newDocument(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  const title = page.getByLabel("File title");
  await title.fill("Lena's letter");
  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.click();
  return editor;
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

async function placement(page: Page) {
  const image = page.locator(".document-content img");
  const picture = (await image.boundingBox())!;
  const line = await page.locator(".document-content p", { hasText: "Dear friend" }).evaluate((paragraph) => {
    const node = paragraph.firstChild;
    if (!node || !node.textContent) return null;
    const range = document.createRange();
    const end = Math.min(11, node.textContent.length);
    range.setStart(node, 0);
    range.setEnd(node, end);
    const rect = range.getBoundingClientRect();
    return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
  });
  return { picture, line: line! };
}

function isBeside(
  picture: { x: number; y: number; width: number; height: number },
  line: { x: number; y: number; right: number; bottom: number },
  side: "left" | "right",
) {
  const overlap = Math.min(picture.y + picture.height, line.bottom) - Math.max(picture.y, line.y);
  if (overlap < 8) return false;
  if (side === "left") return line.x >= picture.x + picture.width - 8;
  return line.right <= picture.x + 8;
}

async function expectBeside(page: Page, side: "left" | "right") {
  await expect.poll(async () => {
    const { picture, line } = await placement(page);
    return isBeside(picture, line, side);
  }).toBe(true);
}

function onItsOwnLine(picture: { y: number; height: number }, line: { y: number }) {
  return line.y >= picture.y + picture.height - 2;
}

async function chooseWrap(page: Page, name: "Left" | "Right" | "Break text") {
  const image = page.locator(".document-content img");
  await image.click();
  await page.getByRole("button", { name: "Wrap text", exact: true }).click();
  await page.getByRole("menuitemradio", { name, exact: true }).click();
  await page.locator(".document-content p", { hasText: "Dear friend" }).click();
  await paginated(page);
}

test("wrap text puts a picture beside the paragraph and keeps corner resize", async ({ page }) => {
  const editor = await newDocument(page);
  await page.locator('input[type=file][accept*="image/png"]').setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: letterLogo(),
  });
  await expect(editor.locator("img")).toBeVisible();
  await page.keyboard.type(letterGreeting);
  await expect.poll(async () => (await placement(page)).line.y).toBeGreaterThan(0);
  const blocked = await placement(page);
  expect(blocked.line.y).toBeGreaterThanOrEqual(blocked.picture.y + blocked.picture.height - 2);

  await editor.locator("img").click();
  const wrap = page.getByRole("button", { name: "Wrap text", exact: true });
  const corner = editor.locator('[data-resize-handle="bottom-right"]');
  await expect(wrap).toBeVisible();
  await expect(corner).toBeVisible();
  const wrapBox = (await wrap.boundingBox())!;
  const cornerBox = (await corner.boundingBox())!;
  expect(overlaps(wrapBox, cornerBox)).toBe(false);
  await wrap.click();
  const menu = page.getByRole("menu", { name: "Wrap text" });
  await expect(menu).toBeVisible();
  const menuBox = (await menu.boundingBox())!;
  expect(overlaps(menuBox, cornerBox)).toBe(false);
  await menu.getByRole("menuitemradio", { name: "Left", exact: true }).click();
  await editor.locator("p", { hasText: "Dear friend" }).click();
  await expectBeside(page, "left");

  await chooseWrap(page, "Right");
  await expectBeside(page, "right");

  await chooseWrap(page, "Break text");
  const broken = await placement(page);
  expect(onItsOwnLine(broken.picture, broken.line)).toBe(true);

  await editor.locator("img").click();
  await wrap.click();
  await expect(menu.getByRole("menuitemradio", { name: "Break text" })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(menu.getByRole("menuitemradio", { name: "Left" })).toBeFocused();
  await page.keyboard.press("Enter");
  await editor.locator("p", { hasText: "Dear friend" }).click();
  await expectBeside(page, "left");

  const before = (await editor.locator("img").boundingBox())!;
  await editor.locator("img").click();
  const handle = (await corner.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 48, handle.y + handle.height / 2 + 24, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await editor.locator("img").boundingBox())!.width).toBeGreaterThan(before.width + 20);
  await editor.locator("p", { hasText: "Dear friend" }).click();
  await expectBeside(page, "left");

  await expect(page.getByRole("status")).toContainText("Saved");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const file = await download;
  const savedPath = join(mkdtempSync(join(tmpdir(), "wrap-")), file.suggestedFilename());
  await file.saveAs(savedPath);
  const saved = JSON.parse(readFileSync(savedPath, "utf8"));
  expect(JSON.stringify(saved.content)).toContain('"wrap":"left"');

  await page.getByRole("button", { name: "Back to files" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (await chooser).setFiles(savedPath);
  const same = page.getByRole("dialog", { name: /already/ });
  await expect(editor.locator("img").or(same)).toBeVisible();
  if (await same.isVisible()) await same.getByRole("button", { name: "Replace" }).click();
  await expectBeside(page, "left");
});

test("a square-wrapped Word picture opens beside the text", async ({ page }) => {
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (
    await chooser
  ).setFiles({
    name: "A letter.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(await letterDocx("left")),
  });
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor.locator("img")).toBeVisible();
  await expect(editor).toContainText("Dear friend");
  await expectBeside(page, "left");
  const notes = page.locator(".import-notes");
  await notes.locator("summary").click();
  await expect(notes).not.toContainText("floating placement");

  await page.goto("/");
  const inlineChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (
    await inlineChooser
  ).setFiles({
    name: "Plain letter.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(await letterDocx("inline")),
  });
  await expect(editor.locator("p").filter({ has: page.locator("img") })).toContainText(
    "Dear friend",
  );
  await expect.poll(async () =>
    editor.evaluate(() => {
      const paragraph = [...document.querySelectorAll(".document-content p")].find(
        (item) => item.textContent?.includes("Dear friend") && item.querySelector("img"),
      );
      const img = paragraph?.querySelector("img:not(.ProseMirror-separator)")?.getBoundingClientRect();
      if (!paragraph || !img) return 0;
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      let node: Node | null = null;
      for (let current = walker.nextNode(); current; current = walker.nextNode()) {
        if (current.textContent?.includes("Dear")) {
          node = current;
          break;
        }
      }
      if (!node?.textContent) return 0;
      const range = document.createRange();
      const start = node.textContent.indexOf("Dear");
      range.setStart(node, start);
      range.setEnd(node, start + 4);
      const line = range.getBoundingClientRect();
      return Math.min(img.bottom, line.bottom) - Math.max(img.top, line.top);
    }),
  ).toBeGreaterThanOrEqual(8);
});
