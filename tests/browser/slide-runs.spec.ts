import { editSlideText } from "./slide-text-helpers";
import { expect, test } from "@playwright/test";

const title = "Spring fair for the community centre";

function deck() {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const slideId = crypto.randomUUID();
  return JSON.stringify({
    format: "suiteleaf",
    version: 1,
    id,
    title: "Fundraiser pitch",
    createdAt: now,
    updatedAt: now,
    kind: "slide",
    content: {
      id,
      width: 960,
      height: 540,
      theme: {
        id: "meadow",
        name: "Meadow",
        background: "#0d2818",
        headingColor: "#ffffff",
        bodyColor: "#d8f3dc",
        accent: "#95d5b2",
        headingFont: "Montserrat",
        bodyFont: "Source Sans",
      },
      slideOrder: [slideId],
      slides: {
        [slideId]: {
          id: slideId,
          background: { color: "#0d2818" },
          elements: [
            {
              id: "title-line",
              type: "text",
              x: 70,
              y: 170,
              width: 820,
              height: 80,
              content: title,
              fontSize: 26,
              fontFamily: "Source Sans",
              color: "#d8f3dc",
              align: "center",
            },
            {
              id: "when-line",
              type: "text",
              x: 70,
              y: 280,
              width: 820,
              height: 70,
              content: "Saturday at the hall",
              fontSize: 22,
              fontFamily: "Source Sans",
              color: "#d8f3dc",
              align: "center",
            },
          ],
        },
      },
    },
  });
}

test("bold and colour apply to one word, and the theme still restyles the rest", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({
    name: "Fundraiser pitch.slslides",
    mimeType: "application/json",
    buffer: Buffer.from(deck()),
  });
  await expect(page.getByLabel("File title")).toHaveValue("Fundraiser pitch");
  const line = page
    .locator(".slide-canvas .slide-text")
    .filter({ hasText: title });
  await editSlideText(line);
  const editor = line.locator(".element-editor");
  await expect(editor).toHaveAttribute("contenteditable", "true");

  const point = await editor.evaluate((root, word) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !(node.textContent ?? "").includes(word))
      node = walker.nextNode();
    const at = (node?.textContent ?? "").indexOf(word);
    const range = document.createRange();
    range.setStart(node!, at);
    range.setEnd(node!, at + word.length);
    const rect = range.getBoundingClientRect();
    range.detach?.();
    const sel = window.getSelection();
    sel?.removeAllRanges();
    const again = document.createRange();
    again.setStart(node!, at);
    again.setEnd(node!, at + word.length);
    sel?.addRange(again);
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, "fair");
  await page.mouse.click(point.x, point.y);
  await editor.evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !(node.textContent ?? "").includes("fair"))
      node = walker.nextNode();
    const at = (node?.textContent ?? "").indexOf("fair");
    const range = document.createRange();
    range.setStart(node!, at);
    range.setEnd(node!, at + 4);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  });
  await page.getByRole("button", { name: "Bold", exact: true }).click();

  const css = (word: string) =>
    line.evaluate((root, word) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && !node.textContent?.includes(word))
        node = walker.nextNode();
      if (!node?.parentElement) return null;
      const style = getComputedStyle(node.parentElement);
      return { weight: style.fontWeight, color: style.color };
    }, word);

  await expect.poll(() => css("fair")).toMatchObject({ weight: "700" });
  await expect.poll(() => css("Spring")).toMatchObject({ weight: "400" });
  await expect(page.locator(".theme-override-bar")).toHaveCount(0);

  await page.getByRole("button", { name: "Theme", exact: true }).click();
  await page.getByRole("button", { name: "Ink", exact: true }).click();
  await expect
    .poll(() => css("Spring"))
    .toMatchObject({
      weight: "400",
      color: "rgb(229, 231, 235)",
    });
  await expect.poll(() => css("fair")).toMatchObject({ weight: "700" });

  await page
    .locator(".slide-canvas .slide-text")
    .filter({ hasText: "Saturday" })
    .click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await expect(page.locator(".theme-override-bar")).toContainText(
    "Overrides theme",
  );
  await page.getByRole("button", { name: "Reset to theme" }).click();
  await expect(page.locator(".theme-override-bar")).toHaveCount(0);
});

test("typing at a bulleted line start survives undo and accepts Tab", async ({
  page,
}) => {
  const file = JSON.parse(deck());
  const box = file.content.slides[file.content.slideOrder[0]].elements[0];
  box.content = "• First\n• Second";
  box.hang = 24;
  box.runs = [
    { text: "• First" },
    { text: "\n", paragraphBreak: true },
    { text: "• Second" },
  ];
  await page.goto("/");
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({
    name: "Bullets.slslides",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(file)),
  });

  const editor = page.locator('[data-element-id="title-line"] .element-editor');
  await editSlideText(
    page.locator('.slide-canvas [data-element-id="title-line"]'),
  );
  await expect(editor).toBeFocused();
  await editor.evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !node.textContent?.includes("Second"))
      node = walker.nextNode();
    if (!node) throw new Error("Missing second bullet text");
    window
      .getSelection()!
      .collapse(node, node.textContent!.indexOf("Second") + 1);
  });
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("X");
  await expect(editor).toContainText("XSecond");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor).not.toContainText("XSecond");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(editor).toContainText("XSecond");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor).not.toContainText("XSecond");
  await page.keyboard.type("Y");
  await expect(editor).toContainText("YSecond");
  await page.keyboard.press("Tab");
  await expect(editor).toBeFocused();
  await expect(editor.locator("ul ul")).toHaveCount(1);

  const plainBox = page.locator('.slide-canvas [data-element-id="when-line"]');
  await editSlideText(plainBox);
  const plain = plainBox.locator('[contenteditable="true"]');
  await plain.press("ControlOrMeta+a");
  await plain.press("ArrowRight");
  await page.keyboard.press("Tab");
  await expect(plain).toBeFocused();
  // Plain text keeps a literal tab and typing continues in the same text box.
  await page.keyboard.type("!");
  await expect(plain).toContainText("Saturday at the hall\t!");
});

test("multiline undo keeps the editor usable and right-click offers text actions", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({
    name: "Multiline.slslides",
    mimeType: "application/json",
    buffer: Buffer.from(deck()),
  });

  const box = page.locator('[data-element-id="title-line"]');
  await editSlideText(box);
  const editor = box.locator('[contenteditable="true"]');
  await expect(editor).toBeFocused();

  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("First\n\nLast");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor).toBeFocused();
  await expect(editor).toContainText("First");
  await expect(editor).toContainText("Last");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("!");
  await expect(editor).toContainText("Last!");

  await editor.click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Slide text actions" });
  await expect(
    menu.getByRole("menuitem", { name: "Paste without formatting" }),
  ).toBeVisible();
  await expect(editor).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(editor).toBeFocused();

  await page.keyboard.press("ControlOrMeta+a");
  const textPoint = await editor.evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !node.textContent?.includes("Last"))
      node = walker.nextNode();
    if (!node) throw new Error("Missing last line");
    const range = document.createRange();
    range.selectNodeContents(node);
    const rect = Array.from(range.getClientRects()).find(
      (box) => box.width > 0,
    )!;
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await page.mouse.click(textPoint.x, textPoint.y, { button: "right" });
  await menu.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(editor).toHaveText("");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor).toContainText("Last!");
  await expect(editor).toBeFocused();
});

test("caret stays visible at the start of an imported bullet line", async ({
  page,
}) => {
  const file = JSON.parse(deck());
  const box = file.content.slides[file.content.slideOrder[0]].elements[0];
  box.content = "▪ First\n▪ Second";
  box.align = "left";
  box.runs = [
    { text: "▪ ", font: "SuiteLeaf Sprig", paraHang: 27, color: "#333399" },
    { text: "First" },
    { text: "\n", paragraphBreak: true, paraHang: 22, paraMargin: 36 },
    { text: "▪ ", font: "SuiteLeaf Sprig", color: "#000000" },
    { text: "Second" },
  ];
  await page.goto("/");
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({
    name: "Bullet caret.slslides",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(file)),
  });
  const editor = page.locator('[data-element-id="title-line"] .element-editor');
  await editSlideText(
    page.locator('.slide-canvas [data-element-id="title-line"]'),
  );
  await expect(editor).toBeFocused();
  for (const word of ["First", "Second"]) {
    await editor.evaluate((root, word) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && node.textContent !== word) node = walker.nextNode();
      if (!node) throw new Error("Missing bullet text");
      window.getSelection()!.collapse(node, 1);
    }, word);
    await page.keyboard.press("ArrowLeft");
    await expect
      .poll(() =>
        editor.evaluate(() => window.getSelection()?.anchorNode?.textContent),
      )
      .toBe(word);
    const caret = await editor.evaluate(() => {
      const selection = window.getSelection()!;
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      return { height: rect.height, text: selection.anchorNode?.textContent };
    });
    expect(caret.height).toBeGreaterThan(10);
    await page.keyboard.type("X");
    await expect(editor).toContainText(`X${word}`);
  }
});
