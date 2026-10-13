import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect, caption, beat } from "./harness";

const title = "Spring fair for the community centre";
const when = "Saturday at the hall";
const meadow = {
  id: "meadow",
  name: "Meadow",
  background: "#0d2818",
  headingColor: "#ffffff",
  bodyColor: "#d8f3dc",
  accent: "#3ddc84",
  headingFont: "Montserrat",
  bodyFont: "Source Sans",
};
function deck() {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const slideId = crypto.randomUUID();
  const text = (
    elementId: string,
    content: string,
    y: number,
    fontSize: number,
  ) => ({
    id: elementId,
    type: "text",
    x: 120,
    y,
    width: 720,
    height: 78,
    content,
    fontSize,
    fontFamily: meadow.bodyFont,
    color: meadow.bodyColor,
    align: "center" as const,
  });
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
      theme: meadow,
      slideOrder: [slideId],
      slides: {
        [slideId]: {
          id: slideId,
          layout: "title",
          background: { color: meadow.background },
          elements: [
    text("title-line", title, 190, 28),
    text("when-line", when, 300, 24),
          ],
        },
      },
    },
  });
}

function box(page: Page, content: string) {
  return page.locator(".slide-canvas .slide-text").filter({ hasText: content });
}

async function editBox(page: Page, content: string) {
  const target = box(page, content).locator("textarea, .element-editor").first();
  await target.dblclick();
  await expect(box(page, content).locator(".element-editor")).toHaveAttribute(
    "contenteditable",
    "true",
  );
  await beat(page, 350);
}

async function selectWord(page: Page, content: string, word: string) {
  const editor = box(page, content).locator(".element-editor");
  const point = await editor.evaluate((root, word) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const value = node.textContent ?? "";
      const at = value.indexOf(word);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + word.length);
      const rect = range.getBoundingClientRect();
      return {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
      };
    }
    return null;
  }, word);
  expect(point, `could not find “${word}”`).toBeTruthy();
  await page.mouse.move(point!.x, point!.y, { steps: 10 });
  await beat(page, 200);
  await page.mouse.dblclick(point!.x, point!.y);
  await expect
    .poll(() => editor.evaluate(() => window.getSelection()?.toString() ?? ""))
    .toContain(word);
  await beat(page, 450);
}

async function wordCss(page: Page, content: string, word: string) {
  return box(page, content).evaluate((root, word) => {
    const span = [...root.querySelectorAll("span")].find((node) => {
      const text = node.textContent ?? "";
      return (
        text === word ||
        text.trim() === word ||
        text.includes(` ${word} `) ||
        text.startsWith(`${word} `) ||
        text.endsWith(` ${word}`)
      );
    });
    if (!span) return null;
    const css = getComputedStyle(span);
    return {
      weight: css.fontWeight,
      style: css.fontStyle,
      decoration: css.textDecorationLine,
      color: css.color,
    };
  }, word);
}

test("46-format-one-word-on-a-slide", async ({ page }) => {
  await page.goto("/");
  await caption(
    page,
    "Dev opens the fundraiser pitch. Meadow is already on the title.",
    1500,
  );
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (await chooser).setFiles({
    name: "Fundraiser pitch.slslides",
    mimeType: "application/json",
    buffer: Buffer.from(deck()),
  });
  await expect(page.getByLabel("File title")).toHaveValue("Fundraiser pitch");
  await expect(page.locator(".slide-canvas")).toHaveCSS(
    "background-color",
    "rgb(13, 40, 24)",
  );
  await expect
    .poll(() =>
      box(page, title).evaluate((el) => getComputedStyle(el).fontFamily),
    )
    .toMatch(/Source Sans/);
  await expect(box(page, title).locator("textarea")).toHaveValue(title);
  await beat(page, 800);

  await caption(
    page,
    "Double-click, select fair, and press Cmd/Ctrl+B. Only that word goes bold.",
    1400,
  );
  await editBox(page, title);
  await selectWord(page, title, "fair");
  await page.keyboard.press("ControlOrMeta+b");
  await beat(page, 700);
  await expect.poll(() => wordCss(page, title, "fair")).toMatchObject({
    weight: "700",
    style: "normal",
  });
  await expect.poll(() => wordCss(page, title, "Spring")).toMatchObject({
    weight: "400",
  });
  await expect.poll(() => wordCss(page, title, "community")).toMatchObject({
    weight: "400",
    style: "normal",
  });
  await expect(page.locator(".theme-override-bar")).toHaveCount(0);
  await beat(page, 500);

  await caption(
    page,
    "Community takes the accent green. Fair stays bold, and the other words stay put.",
    1400,
  );
  await selectWord(page, title, "community");
  await page.getByRole("button", { name: "Accent colour for the selection" }).click();
  await beat(page, 800);
  await expect.poll(() => wordCss(page, title, "community")).toMatchObject({
    color: "rgb(61, 220, 132)",
    weight: "400",
  });
  await page.keyboard.press("Escape");
  await beat(page, 800);
  await expect.poll(() => wordCss(page, title, "fair")).toMatchObject({
    weight: "700",
    color: "rgb(216, 243, 220)",
  });
  await expect(page.locator(".theme-override-bar")).toHaveCount(0);

  await caption(
    page,
    "Centre gets italic, then underline. The rest of the line does not.",
    1300,
  );
  await editBox(page, title);
  await selectWord(page, title, "centre");
  await page.getByRole("button", { name: "Italic", exact: true }).click();
  await beat(page, 400);
  await page.getByRole("button", { name: "Underline", exact: true }).click();
  await beat(page, 700);
  await expect.poll(() => wordCss(page, title, "centre")).toMatchObject({
    style: "italic",
    decoration: "underline",
    weight: "400",
  });
  await expect.poll(() => wordCss(page, title, "fair")).toMatchObject({
    weight: "700",
    style: "normal",
    decoration: "none",
  });
  await page.keyboard.press("Escape");
  await beat(page, 600);
  await caption(page, "Undo takes the underline off and leaves the italic.", 1100);
  await page.getByRole("button", { name: "Undo (Cmd+Z)" }).click();
  await beat(page, 700);
  await expect.poll(() => wordCss(page, title, "centre")).toMatchObject({
    style: "italic",
    decoration: "none",
  });

  await caption(
    page,
    "Ink restyles the words Dev left alone. Fair, community, and centre keep what was set by hand.",
    1400,
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Theme", exact: true }).click();
  await page.getByRole("button", { name: "Ink", exact: true }).click();
  await beat(page, 900);
  await page.getByRole("button", { name: "Close panel" }).click();
  await expect(page.locator(".slide-canvas")).toHaveCSS(
    "background-color",
    "rgb(17, 24, 39)",
  );
  await expect
    .poll(() => box(page, title).evaluate((el) => getComputedStyle(el).fontFamily))
    .toMatch(/Arial/);
  await expect.poll(() => wordCss(page, title, "Spring")).toMatchObject({
    weight: "400",
    style: "normal",
    color: "rgb(229, 231, 235)",
  });
  await expect.poll(() => wordCss(page, title, "for")).toMatchObject({
    weight: "400",
    color: "rgb(229, 231, 235)",
  });
  await expect.poll(() => wordCss(page, title, "fair")).toMatchObject({
    weight: "700",
    color: "rgb(229, 231, 235)",
  });
  await expect.poll(() => wordCss(page, title, "community")).toMatchObject({
    color: "rgb(61, 220, 132)",
    weight: "400",
  });
  await expect.poll(() => wordCss(page, title, "centre")).toMatchObject({
    style: "italic",
    decoration: "none",
    weight: "400",
  });
  await expect(page.locator(".theme-override-bar")).toHaveCount(0);
  await beat(page, 800);

  await caption(
    page,
    "On the other box, with no caret, Bold still styles every word and marks Overrides theme.",
    1400,
  );
  await box(page, when).click();
  await page.keyboard.press("Escape");
  await beat(page, 300);
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await expect(page.locator(".theme-override-bar")).toContainText("Overrides theme");
  await expect(box(page, when)).toHaveCSS("font-weight", "700");
  await beat(page, 1400);
  await caption(page, "Reset to theme clears that exception.", 1100);
  await page.getByRole("button", { name: "Reset to theme" }).click();
  await expect(page.locator(".theme-override-bar")).toHaveCount(0);
  await expect(box(page, when)).toHaveCSS("font-weight", "400");
  await beat(page, 600);

  await caption(
    page,
    "Dev downloads the file and opens the copy. The words are still formatted.",
    1400,
  );
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("Fundraiser pitch.slslides");
  const bytes = readFileSync((await download.path())!);
  const saved = JSON.parse(bytes.toString("utf8"));
  const elements = saved.content.slideOrder.flatMap(
    (id: string) => saved.content.slides[id].elements,
  );
  const titleEl = elements.find((el: { content?: string }) => el.content === title);
  expect(titleEl.themeOverride).toBeFalsy();
  expect(titleEl.runs.find((run: { text: string }) => run.text === "fair").bold).toBe(true);
  expect(titleEl.runs.find((run: { text: string }) => run.text === "community").color).toBe(
    meadow.accent,
  );
  expect(titleEl.runs.find((run: { text: string }) => run.text === "centre").italic).toBe(
    true,
  );
  expect(
    titleEl.runs.find((run: { text: string }) => run.text === "centre").underline,
  ).toBeFalsy();
  expect(saved.content.theme.name).toBe("Ink");

  await page.goto("/");
  const again = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (await again).setFiles({
    name: "Fundraiser pitch.slslides",
    mimeType: "application/json",
    buffer: bytes,
  });
  const same = page.getByRole("dialog");
  await expect(same).toContainText("already in this browser");
  await same.getByRole("button", { name: "Keep both" }).click();
  await expect(page.getByLabel("File title")).toHaveValue(/Fundraiser pitch/);
  await expect.poll(() => wordCss(page, title, "fair")).toMatchObject({ weight: "700" });
  await expect.poll(() => wordCss(page, title, "community")).toMatchObject({
    color: "rgb(61, 220, 132)",
  });
  await expect.poll(() => wordCss(page, title, "centre")).toMatchObject({
    style: "italic",
  });
  await expect.poll(() => wordCss(page, title, "Spring")).toMatchObject({
    weight: "400",
    color: "rgb(229, 231, 235)",
  });
  await beat(page, 1400);
});
