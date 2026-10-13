import { expect, test, type Page } from "@playwright/test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stallNote, stallSentenceDocx } from "../sentence-picture";

test.use({ viewport: { width: 1280, height: 800 } });

type Box = { x: number; y: number; right: number; bottom: number; width: number; height: number };

async function openNote(page: Page) {
  const dir = mkdtempSync(join(tmpdir(), "inline-picture-"));
  const path = join(dir, "Saturday note.sldoc");
  writeFileSync(path, JSON.stringify(stallNote()));
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (await chooser).setFiles(path);
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toContainText("stall on Saturday");
  return { editor, dir };
}

async function sentence(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector(".document-content");
    if (!root) return null;
    const word = (label: string): Box | null => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let current = walker.nextNode(); current; current = walker.nextNode()) {
        const text = current.textContent ?? "";
        const at = text.indexOf(label);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(current, at);
        range.setEnd(current, at + label.length);
        const rect = range.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      }
      return null;
    };
    const img = root.querySelector("img:not(.ProseMirror-separator)");
    const host = img?.closest("p");
    const line = (host ?? root.querySelector("p"))?.getBoundingClientRect();
    const box = img?.getBoundingClientRect();
    return {
      picture: box
        ? { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, height: box.height }
        : null,
      the: word("the"),
      stall: word("stall"),
      saturday: word("Saturday"),
      lineHeight: line?.height ?? 0,
      paragraphs: root.querySelectorAll("p").length,
    };
  });
}

function sharesLine(picture: Box, word: Box) {
  return Math.min(picture.bottom, word.bottom) - Math.max(picture.y, word.y) >= 8;
}

test("in line puts a picture in the sentence and cut and paste keeps the line", async ({ page }) => {
  const { editor } = await openNote(page);
  const image = editor.locator("img");
  await expect(image).toBeVisible();
  await expect(editor.locator("p img:not(.ProseMirror-separator)")).toHaveCount(0);
  const blocked = (await sentence(page))!;
  expect(blocked.stall!.y).toBeGreaterThanOrEqual(blocked.the!.bottom - 2);

  await image.click();
  await page.getByRole("button", { name: "Wrap text", exact: true }).click();
  const menu = page.getByRole("menu", { name: "Wrap text" });
  await expect(menu.getByRole("menuitemradio", { name: "In line", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitemradio", { name: "Left", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitemradio", { name: "Right", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitemradio", { name: "Break text", exact: true })).toBeVisible();
  await menu.getByRole("menuitemradio", { name: "In line", exact: true }).click();

  await expect(editor.locator("p img:not(.ProseMirror-separator)")).toHaveCount(1);
  await expect.poll(async () => {
    const laid = await sentence(page);
    if (!laid?.picture || !laid.the || !laid.stall) return false;
    return (
      laid.picture.height <= 36 &&
      laid.picture.width < 120 &&
      sharesLine(laid.picture, laid.the) &&
      sharesLine(laid.picture, laid.stall) &&
      sharesLine(laid.stall, laid.the)
    );
  }).toBe(true);

  const before = (await sentence(page))!;
  await image.click();
  const handle = (await editor.locator('[data-resize-handle="bottom-right"]').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 56, handle.y + handle.height / 2 + 40, {
    steps: 8,
  });
  await page.mouse.up();
  await expect.poll(async () => {
    const laid = await sentence(page);
    if (!laid?.picture) return false;
    return laid.picture.height > before.picture!.height + 12 && laid.lineHeight > before.lineHeight + 8;
  }).toBe(true);

  await image.click();
  await page.keyboard.press("ControlOrMeta+x");
  await expect(editor.locator("img:not(.ProseMirror-separator)")).toHaveCount(0);
  await expect.poll(async () => (await sentence(page))?.paragraphs).toBe(1);
  await expect(editor.locator("p")).toHaveText("Meet at the stall on Saturday.");

  await editor.getByText("Saturday.").click();
  await page.keyboard.press("End");
  await page.keyboard.press("ControlOrMeta+v");
  await expect.poll(async () => {
    const laid = await sentence(page);
    if (!laid?.picture || !laid.saturday || laid.paragraphs !== 1) return false;
    return laid.picture.x >= laid.saturday.right - 6 && sharesLine(laid.picture, laid.saturday);
  }).toBe(true);
});

test("a Word inline picture opens in the sentence and survives save", async ({ page }) => {
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (
    await chooser
  ).setFiles({
    name: "Saturday note.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(await stallSentenceDocx()),
  });
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor.locator("p").filter({ has: page.locator("img:not(.ProseMirror-separator)") })).toContainText(
    "Meet at the",
  );
  await expect.poll(async () => {
    const laid = await sentence(page);
    if (!laid?.picture || !laid.the || !laid.stall) return false;
    return sharesLine(laid.picture, laid.the) && sharesLine(laid.picture, laid.stall);
  }).toBe(true);

  await expect(page.getByRole("status")).toContainText("Saved");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const download = await downloading;
  const savedPath = join(mkdtempSync(join(tmpdir(), "inline-save-")), download.suggestedFilename());
  await download.saveAs(savedPath);
  const saved = JSON.parse(readFileSync(savedPath, "utf8"));
  const paragraph = saved.content.content.find((node: { type: string }) =>
    node.type === "paragraph",
  );
  expect(paragraph.content.map((node: { type: string }) => node.type)).toContain("inlineImage");

  await page.getByRole("button", { name: "Back to files" }).click();
  const reopen = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (await reopen).setFiles(savedPath);
  const same = page.getByRole("dialog", { name: /already/i });
  await expect(editor.locator("img").or(same)).toBeVisible();
  if (await same.isVisible()) await same.getByRole("button", { name: "Replace" }).click();
  await expect.poll(async () => {
    const laid = await sentence(page);
    if (!laid?.picture || !laid.the || !laid.stall) return false;
    return sharesLine(laid.picture, laid.the) && sharesLine(laid.picture, laid.stall);
  }).toBe(true);
});
