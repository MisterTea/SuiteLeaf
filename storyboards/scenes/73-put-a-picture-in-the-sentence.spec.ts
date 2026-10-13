import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beat, caption, expect, test } from "./harness";
import { stallNote, stallSentenceDocx } from "../../tests/sentence-picture";

type Box = { x: number; y: number; right: number; bottom: number; width: number; height: number };

async function laidOut(page: import("@playwright/test").Page) {
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
      inSentence: Boolean(host?.textContent?.includes("stall") && host.textContent.includes("the")),
    };
  });
}

function sharesLine(picture: Box, word: Box) {
  return Math.min(picture.bottom, word.bottom) - Math.max(picture.y, word.y) >= 8;
}

test("73-put-a-picture-in-the-sentence", async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), "storyboard-73-"));
  const notePath = join(dir, "Saturday note.sldoc");
  writeFileSync(notePath, JSON.stringify(stallNote()));

  await page.goto("/");
  await caption(
    page,
    "Lena opens her note. “Meet at the stall on Saturday.” The photo is on the line below.",
  );
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (await chooser).setFiles(notePath);
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toContainText("stall on Saturday");
  const image = editor.locator("img");
  await expect(image).toBeVisible();
  await image.scrollIntoViewIfNeeded();
  const blocked = (await laidOut(page))!;
  expect(blocked.inSentence).toBe(false);
  expect(blocked.stall!.y).toBeGreaterThanOrEqual((blocked.picture?.bottom ?? blocked.the!.bottom) - 4);
  await beat(page, 1200);

  await caption(page, "She selects the photo. In line is next to Left, Right, and Break text.", 1200);
  await image.click();
  const wrap = page.getByRole("button", { name: "Wrap text", exact: true });
  await expect(wrap).toBeVisible();
  await beat(page, 500);
  await wrap.click();
  const menu = page.getByRole("menu", { name: "Wrap text" });
  await expect(menu.getByRole("menuitemradio", { name: "In line", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitemradio", { name: "Left", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitemradio", { name: "Right", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitemradio", { name: "Break text", exact: true })).toBeVisible();
  await beat(page, 1100);

  await caption(page, "In line. The photo sits between “the” and “stall”, on the same line.", 1000);
  await menu.getByRole("menuitemradio", { name: "In line", exact: true }).click();
  await expect.poll(async () => {
    const laid = await laidOut(page);
    if (!laid?.picture || !laid.the || !laid.stall || !laid.inSentence) return false;
    return (
      laid.picture.height <= 36 &&
      laid.picture.width < 120 &&
      sharesLine(laid.picture, laid.the) &&
      sharesLine(laid.picture, laid.stall)
    );
  }).toBe(true);
  await editor.getByText("Saturday").click();
  await beat(page, 1400);

  await caption(page, "She drags a corner. The photo grows a little, and the line grows with it.", 1000);
  await image.click();
  const before = (await laidOut(page))!;
  const handle = (await editor.locator('[data-resize-handle="bottom-right"]').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await beat(page, 400);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 64, handle.y + handle.height / 2 + 48, {
    steps: 16,
  });
  await page.mouse.up();
  await expect.poll(async () => {
    const laid = await laidOut(page);
    if (!laid?.picture) return false;
    return laid.picture.height > before.picture!.height + 12 && laid.lineHeight > before.lineHeight + 8;
  }).toBe(true);
  await editor.getByText("Saturday").click();
  await beat(page, 1200);

  await caption(page, "She cuts the photo. The words close up. No empty line is left behind.", 1000);
  await image.click();
  await beat(page, 400);
  await page.keyboard.press("ControlOrMeta+x");
  await expect(image).toHaveCount(0);
  await expect(editor.locator("p")).toHaveText("Meet at the stall on Saturday.");
  await beat(page, 1200);

  await caption(page, "She pastes it after Saturday. The photo is at the end of the sentence.", 1000);
  await editor.getByText("Saturday.").click();
  await page.keyboard.press("End");
  await beat(page, 400);
  await page.keyboard.press("ControlOrMeta+v");
  await expect.poll(async () => {
    const laid = await laidOut(page);
    if (!laid?.picture || !laid.saturday || laid.paragraphs !== 1) return false;
    return laid.picture.x >= laid.saturday.right - 8 && sharesLine(laid.picture, laid.saturday);
  }).toBe(true);
  await beat(page, 2000);

  await page.getByRole("button", { name: "Back to files" }).click();
  await beat(page, 400);
  await caption(page, "She opens a Word note. The picture is already in the middle of the sentence.", 700);
  const wordChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (
    await wordChooser
  ).setFiles({
    name: "Saturday note.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(await stallSentenceDocx()),
  });
  await expect(page.getByLabel("File title")).toHaveValue("Saturday note");
  await expect(editor).toContainText("stall on Saturday");
  await expect(image).toBeVisible();
  await image.scrollIntoViewIfNeeded();
  await expect.poll(async () => {
    const laid = await laidOut(page);
    if (!laid?.picture || !laid.the || !laid.stall || !laid.inSentence) return false;
    return sharesLine(laid.picture, laid.the) && sharesLine(laid.picture, laid.stall);
  }).toBe(true);
  await beat(page, 1800);

  await caption(page, "She downloads the SuiteLeaf file and opens that copy. The photo is still between the words.", 800);
  await expect(page.getByRole("status")).toContainText("Saved");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const download = await downloading;
  const savedPath = join(dir, download.suggestedFilename());
  await download.saveAs(savedPath);
  const saved = JSON.parse(readFileSync(savedPath, "utf8"));
  expect(JSON.stringify(saved.content)).toContain('"type":"inlineImage"');
  await beat(page, 600);
  await page.getByRole("button", { name: "Back to files" }).click();
  await beat(page, 500);
  const reopen = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (await reopen).setFiles(savedPath);
  const same = page.getByRole("dialog", { name: /already/i });
  await expect(image.or(same)).toBeVisible();
  if (await same.isVisible()) await same.getByRole("button", { name: "Replace" }).click();
  await expect(editor).toContainText("stall on Saturday");
  await expect.poll(async () => {
    const laid = await laidOut(page);
    if (!laid?.picture || !laid.the || !laid.stall || !laid.inSentence) return false;
    return sharesLine(laid.picture, laid.the) && sharesLine(laid.picture, laid.stall);
  }).toBe(true);
  await caption(page, "“Meet at the” photo “stall on Saturday” still reads as one sentence.", 2000);
});
