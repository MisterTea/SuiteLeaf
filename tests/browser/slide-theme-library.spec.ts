import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const meadow = "rgb(13, 40, 24)";
const centre = "rgb(46, 125, 50)";
const lighter = "rgb(102, 187, 106)";
const quote = "The town shows up.";
const free = "Bring indoor shoes.";

function text(content: string, extra: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    type: "text",
    x: 72,
    y: 48,
    width: 760,
    height: 70,
    content,
    fontSize: 36,
    bold: true,
    fontFamily: "Arial",
    color: "#1e293b",
    placeholder: "Click to add title",
    ...extra,
  };
}

function deck(title: string, theme: Record<string, unknown> | undefined, slides: object[]) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const withIds = slides.map((slide) => ({ id: crypto.randomUUID(), notes: "", ...slide }));
  return JSON.stringify({
    format: "suiteleaf",
    version: 1,
    id,
    title,
    createdAt: now,
    updatedAt: now,
    kind: "slide",
    content: {
      id,
      width: 960,
      height: 540,
      theme,
      slideOrder: withIds.map((slide) => slide.id),
      slides: Object.fromEntries(withIds.map((slide) => [slide.id, slide])),
    },
  });
}

const centreTheme = {
  id: "meadow",
  name: "Meadow",
  background: "#0d2818",
  headingColor: "#ffffff",
  bodyColor: "#d8f3dc",
  accent: "#2e7d32",
  headingFont: "Montserrat",
  bodyFont: "Source Sans",
};

function fundraiser() {
  return deck("Fundraiser pitch", centreTheme, [
    {
      layout: "title",
      background: { color: "#0d2818" },
      elements: [
        text("Fundraiser pitch", {
          y: 180,
          fontFamily: "Montserrat",
          color: "#ffffff",
          align: "center",
        }),
      ],
    },
    {
      layout: "title-body",
      background: { color: "#0d2818" },
      elements: [
        text("The hall", { fontFamily: "Montserrat", color: "#ffffff" }),
        text("Doors at 6.", {
          y: 150,
          height: 60,
          fontSize: 20,
          bold: false,
          fontFamily: "Source Sans",
          color: "#d8f3dc",
          placeholder: "Click to add text",
        }),
        {
          id: crypto.randomUUID(),
          type: "shape",
          shapeType: "roundRect",
          x: 72,
          y: 400,
          width: 160,
          height: 40,
          fill: "#2e7d32",
          stroke: "#2e7d32",
        },
      ],
    },
  ]);
}

const paper = {
  id: "paper",
  name: "Paper",
  background: "#ffffff",
  headingColor: "#1a1a1a",
  bodyColor: "#3c4043",
  accent: "#1a73e8",
  headingFont: "Georgia",
  bodyFont: "Arial",
};

function spring() {
  return deck("Spring classes", paper, [
    {
      layout: "title",
      background: { color: "#ffffff" },
      elements: [
        text("Spring classes", {
          y: 180,
          fontFamily: "Georgia",
          color: "#1a1a1a",
          align: "center",
        }),
      ],
    },
    {
      layout: "title-body",
      background: { color: "#ffffff" },
      elements: [
        text("Saturday mornings", { fontFamily: "Georgia", color: "#1a1a1a" }),
        text(free, {
          y: 160,
          height: 50,
          fontSize: 18,
          bold: false,
          fontFamily: "Arial",
          color: "#3c4043",
          placeholder: undefined,
        }),
        {
          id: crypto.randomUUID(),
          type: "shape",
          shapeType: "roundRect",
          x: 72,
          y: 400,
          width: 160,
          height: 40,
          fill: "#1a73e8",
          stroke: "#1a73e8",
        },
      ],
    },
    {
      layout: "title-body",
      background: { color: "#ffffff" },
      elements: [
        text("A line to keep", { fontFamily: "Georgia", color: "#1a1a1a" }),
        text(quote, {
          y: 160,
          height: 80,
          fontSize: 22,
          bold: false,
          fontFamily: "Georgia",
          italic: true,
          color: "#6d4c41",
          placeholder: undefined,
          themeOverride: true,
        }),
      ],
    },
  ]);
}

async function importDeck(page: Page, title: string, json: string) {
  if (await page.getByRole("button", { name: "Back to files" }).isVisible())
    await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByRole("button", { name: "Open / import" })).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (await chooser).setFiles({
    name: `${title}.slslides`,
    mimeType: "application/json",
    buffer: Buffer.from(json),
  });
  await expect(page.getByLabel("File title")).toHaveValue(title);
  await expect(page.locator(".save-status")).toContainText("Saved");
}

async function family(page: Page, content: string) {
  return page.locator(".slide-canvas").evaluate((root, content) => {
    const area = [...root.querySelectorAll("textarea")].find(
      (node) => (node as HTMLTextAreaElement).value === content,
    );
    return area?.parentElement ? getComputedStyle(area.parentElement).fontFamily : "";
  }, content);
}

test("a saved theme applies to another deck as a copy", async ({ page }) => {
  test.setTimeout(90000);
  await page.goto("/");
  await importDeck(page, "Fundraiser pitch", fundraiser());
  await page.getByRole("button", { name: "Theme", exact: true }).click();
  const library = page.getByRole("region", { name: "Library" });
  await library.getByRole("button", { name: "Save to library" }).click();
  await page.getByLabel("Theme name").fill("Centre green");
  await library.getByRole("button", { name: "Save", exact: true }).click();
  await expect(library.getByRole("button", { name: "Centre green", exact: true })).toContainText(
    "#2E7D32",
  );
  const stored = await page.evaluate(() =>
    localStorage.getItem("suiteleaf_slide_theme_library"),
  );
  expect(stored).toContain("Centre green");
  expect(stored).toContain("#2e7d32");

  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByRole("link", { name: "Fundraiser pitch", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: "Fundraiser pitch", exact: true })).toBeVisible();
  await importDeck(page, "Spring classes", spring());
  await page.getByRole("button", { name: "Theme", exact: true }).click();
  const saved = page
    .getByRole("region", { name: "Library" })
    .getByRole("button", { name: "Centre green", exact: true });
  await expect(saved).toContainText("#2E7D32");
  await saved.click();
  await expect(page.locator(".slide-canvas")).toHaveCSS("background-color", meadow);
  await expect.poll(() => family(page, "Spring classes")).toMatch(/Montserrat/);
  await page.getByRole("option", { name: "Slide 2: Saturday mornings" }).click();
  await expect.poll(() => family(page, free)).toMatch(/Source Sans/);
  await expect(page.locator(".slide-canvas .slide-shape")).toHaveCSS("background-color", centre);
  await page.getByRole("option", { name: "Slide 3: A line to keep" }).click();
  await expect.poll(() => family(page, quote)).toMatch(/Georgia/);
  const point = await page.locator(".slide-canvas").evaluate((root, content) => {
    const area = [...root.querySelectorAll("textarea")].find(
      (node) => (node as HTMLTextAreaElement).value === content,
    );
    const rect = area?.getBoundingClientRect();
    return rect ? { x: rect.x + 40, y: rect.y + rect.height / 2 } : null;
  }, quote);
  await page.mouse.click(point!.x, point!.y);
  await expect(page.locator(".theme-override-bar")).toContainText("Overrides theme");

  await page.getByLabel("Accent hex").scrollIntoViewIfNeeded();
  await page.getByLabel("Accent hex").fill("#66BB6A");
  await page.getByRole("option", { name: "Slide 2: Saturday mornings" }).click();
  await expect(page.locator(".slide-canvas .slide-shape")).toHaveCSS("background-color", lighter);
  await expect(saved).toContainText("#2E7D32");
  await expect(page.getByRole("region", { name: "Library" })).toContainText(
    "The library still has Centre green",
  );
  const afterEdit = await page.evaluate(() =>
    localStorage.getItem("suiteleaf_slide_theme_library"),
  );
  expect(afterEdit).toContain("#2e7d32");
  expect(afterEdit).not.toContain("#66bb6a");

  await expect(page.locator(".save-status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Fundraiser pitch", exact: true }).click();
  await expect(page.getByLabel("File title")).toHaveValue("Fundraiser pitch");
  await page.getByRole("option", { name: "Slide 2: The hall" }).click();
  await expect(page.locator(".slide-canvas .slide-shape")).toHaveCSS("background-color", centre);
  await page.getByRole("button", { name: "Theme", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Library" }).getByRole("button", { name: "Centre green" }),
  ).toContainText("#2E7D32");
  for (const name of ["Paper", "Meadow", "Ink", "Warm Sand"])
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();

  await importDeck(
    page,
    "Scratch",
    deck("Scratch", undefined, [
      {
        layout: "title",
        background: { color: "#111827" },
        elements: [
          text("Scratch", {
            y: 180,
            fontFamily: "Arial",
            color: "#f8fafc",
            align: "center",
          }),
        ],
      },
    ]),
  );
  await page.getByRole("button", { name: "Theme", exact: true }).click();
  await page.getByRole("button", { name: "Paper", exact: true }).click();
  await expect(page.locator(".slide-canvas")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect.poll(() => family(page, "Scratch")).toMatch(/Georgia/);

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Spring classes", exact: true }).click();
  await expect(page.locator(".save-status")).toContainText("Saved");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const download = await downloading;
  const savedFile = JSON.parse(readFileSync((await download.path())!, "utf8"));
  expect(savedFile.content.theme).toMatchObject({
    name: "Centre green",
    accent: "#66bb6a",
    headingFont: "Montserrat",
    bodyFont: "Source Sans",
  });
  const slides = savedFile.content.slideOrder.map(
    (id: string) => savedFile.content.slides[id],
  );
  expect(slides.every((slide: { transition?: unknown }) => slide.transition == null)).toBe(true);
  const quoteEl = slides[2].elements.find((el: { content?: string }) => el.content === quote);
  expect(quoteEl).toMatchObject({
    fontFamily: "Georgia",
    italic: true,
    themeOverride: true,
  });

  await page.evaluate(() => localStorage.removeItem("suiteleaf_slide_theme_library"));
  savedFile.id = crypto.randomUUID();
  savedFile.content.id = savedFile.id;
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByRole("button", { name: "Open / import" })).toBeVisible();
  const again = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (await again).setFiles({
    name: "Spring classes.slslides",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(savedFile)),
  });
  await expect(page.getByLabel("File title")).toHaveValue("Spring classes");
  await page.getByRole("button", { name: "Theme", exact: true }).click();
  await expect(page.getByRole("region", { name: "Library" })).toContainText("No saved themes yet");
  await expect(page.getByLabel("Accent hex")).toHaveValue("#66bb6a");
  await expect(page.locator(".transition-status").first()).toContainText("Montserrat");
  await page.getByRole("option", { name: "Slide 3: A line to keep" }).click();
  await expect.poll(() => family(page, quote)).toMatch(/Georgia/);
});

test("the theme library fits on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Fundraiser pitch.slslides",
    mimeType: "application/json",
    buffer: Buffer.from(fundraiser()),
  });
  await expect(page.getByLabel("File title")).toHaveValue("Fundraiser pitch");
  await page.getByRole("button", { name: "Theme", exact: true }).click();
  const save = page.getByRole("button", { name: "Save to library" });
  await save.scrollIntoViewIfNeeded();
  await expect(save).toBeVisible();
  const box = await save.boundingBox();
  expect(box).toBeTruthy();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await save.click();
  const field = page.getByLabel("Theme name");
  await expect(field).toBeVisible();
  const fieldBox = await field.boundingBox();
  expect(fieldBox!.x + fieldBox!.width).toBeLessThanOrEqual(390);
});
