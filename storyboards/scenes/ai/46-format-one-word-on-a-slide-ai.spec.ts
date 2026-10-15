import type { Page } from "@playwright/test";
import { askAgent, caption, describeRun, expect, openApp, test } from "../harness";

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
  const text = (elementId: string, content: string, y: number, fontSize: number) => ({
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
          elements: [text("title-line", title, 190, 28), text("when-line", when, 300, 24)],
        },
      },
    },
  });
}

const PROMPT =
  'In the title "Spring fair for the community centre", make only the word fair bold, only the word community the accent green, and only the word centre italic. Every other word stays in the theme style. Do not mark the text box as overriding the theme.';

function box(page: Page, content: string) {
  return page.locator(".slide-canvas .slide-text").filter({ hasText: content });
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

type SavedElement = {
  id?: string;
  content?: string;
  themeOverride?: boolean;
  bold?: boolean;
  italic?: boolean;
  fontFamily?: string;
  color?: string;
  runs?: { text: string; bold?: boolean; italic?: boolean; underline?: boolean; color?: string }[];
};

async function savedTitle(page: Page): Promise<SavedElement | undefined> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("SuiteLeaf");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
    });
    const rows = await new Promise<{ title?: string; native?: string | Blob }[]>((resolve, reject) => {
      const tx = db.transaction("encoded", "readonly");
      const req = tx.objectStore("encoded").getAll();
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
    });
    const row = rows.find((item) => item.title === "Fundraiser pitch");
    if (!row?.native) return undefined;
    const text = typeof row.native === "string" ? row.native : await row.native.text();
    const saved = JSON.parse(text) as {
      content: { slideOrder: string[]; slides: Record<string, { elements: SavedElement[] }> };
    };
    const elements = saved.content.slideOrder.flatMap((id) => saved.content.slides[id].elements);
    return elements.find((el) => el.content === "Spring fair for the community centre");
  });
}

test("46-format-one-word-on-a-slide-ai", async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole("button", { name: "Open / import" })).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (await chooser).setFiles({
    name: "Fundraiser pitch.slslides",
    mimeType: "application/json",
    buffer: Buffer.from(deck()),
  });
  await expect(page.getByLabel("File title")).toHaveValue("Fundraiser pitch");
  await expect(page.locator(".slide-canvas")).toHaveCSS("background-color", "rgb(13, 40, 24)");
  await expect(box(page, title).locator("textarea")).toHaveValue(title);
  await caption(page, "The fundraiser title is on Meadow. One word each should be bold, green, and italic.");
  await caption(page, "", 0);

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  const body = "rgb(216, 243, 220)";
  const accent = "rgb(61, 220, 132)";
  await expect.poll(() => wordCss(page, title, "fair"), { timeout: 15000 }).toMatchObject({
    weight: "700",
    style: "normal",
    color: body,
  });
  await expect.poll(() => wordCss(page, title, "community")).toMatchObject({
    color: accent,
    weight: "400",
    style: "normal",
  });
  await expect.poll(() => wordCss(page, title, "centre")).toMatchObject({
    style: "italic",
    weight: "400",
    decoration: "none",
  });
  await expect.poll(() => wordCss(page, title, "Spring")).toMatchObject({
    weight: "400",
    style: "normal",
    color: body,
  });
  await expect.poll(() => wordCss(page, title, "for")).toMatchObject({
    weight: "400",
    style: "normal",
    color: body,
  });
  await expect.poll(() => box(page, title).evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/Source Sans/);

  await box(page, title).click();
  await expect(page.locator(".theme-override-bar"), why).toHaveCount(0);

  let saved: SavedElement | undefined;
  await expect
    .poll(async () => {
      saved = await savedTitle(page);
      return saved?.runs?.find((run) => run.text === "fair")?.bold ?? false;
    })
    .toBe(true);
  const titleEl = saved!;
  expect(titleEl.themeOverride, why).toBeFalsy();
  expect(titleEl.bold, why).toBeFalsy();
  expect(titleEl.italic, why).toBeFalsy();
  expect(titleEl.fontFamily, why).toBe("Source Sans");
  expect(titleEl.color, why).toBe(meadow.bodyColor);
  expect(titleEl.runs?.find((item) => item.text === "community")?.color, why).toBe(meadow.accent);
  expect(titleEl.runs?.find((item) => item.text === "community")?.bold, why).toBeFalsy();
  expect(titleEl.runs?.find((item) => item.text === "centre")?.italic, why).toBe(true);
  expect(titleEl.runs?.find((item) => item.text === "centre")?.underline, why).toBeFalsy();
  expect(titleEl.runs?.find((item) => item.text.includes("Spring"))?.bold, why).toBeFalsy();
  await caption(page, "Only fair is bold, community is the accent green, and centre is italic.", 1600);
});
