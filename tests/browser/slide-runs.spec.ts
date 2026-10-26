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
  const line = page.locator(".slide-canvas .slide-text").filter({ hasText: title });
  await line.locator("textarea").dblclick();
  const editor = line.locator(".element-editor");
  await expect(editor).toHaveAttribute("contenteditable", "true");

  const point = await editor.evaluate((root, word) => {
    const value = root.textContent ?? "";
    const at = value.indexOf(word);
    const node = root.firstChild?.firstChild ?? root.firstChild;
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
    const value = root.textContent ?? "";
    const at = value.indexOf("fair");
    const node = document.createTreeWalker(root, NodeFilter.SHOW_TEXT).nextNode();
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
      const span = [...root.querySelectorAll("span")].find((node) => {
        const text = node.textContent ?? "";
        return text === word || text.trim() === word;
      });
      if (!span) return null;
      const style = getComputedStyle(span);
      return { weight: style.fontWeight, color: style.color };
    }, word);

  await expect.poll(() => css("fair")).toMatchObject({ weight: "700" });
  await expect.poll(() => css("Spring")).toMatchObject({ weight: "400" });
  await expect(page.locator(".theme-override-bar")).toHaveCount(0);

  await page.getByRole("button", { name: "Theme", exact: true }).click();
  await page.getByRole("button", { name: "Ink", exact: true }).click();
  await expect.poll(() => css("Spring")).toMatchObject({
    weight: "400",
    color: "rgb(229, 231, 235)",
  });
  await expect.poll(() => css("fair")).toMatchObject({ weight: "700" });

  await page.locator(".slide-canvas .slide-text").filter({ hasText: "Saturday" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await expect(page.locator(".theme-override-bar")).toContainText("Overrides theme");
  await page.getByRole("button", { name: "Reset to theme" }).click();
  await expect(page.locator(".theme-override-bar")).toHaveCount(0);
});
