import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { beat, caption, expect, test, typeSlowly } from "./harness";

const meadow = "rgb(13, 40, 24)";
const centre = "rgb(46, 125, 50)";
const lighter = "rgb(102, 187, 106)";
const quote = "The town shows up for each other.";
const free = "Bring indoor shoes.";
const follows = "Ages 8 and up.";

function text(content: string, extra: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    type: "text",
    x: 72,
    y: 40,
    width: 800,
    height: 72,
    content,
    fontSize: 36,
    bold: true,
    fontFamily: "Arial",
    color: "#1e293b",
    placeholder: "Click to add title",
    ...extra,
  };
}

function deck(title: string, theme: object | undefined, slides: object[]) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const withIds = slides.map((slide) => ({
    id: crypto.randomUUID(),
    notes: "",
    ...slide,
  }));
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
      ...(theme ? { theme } : {}),
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

function fundraiser() {
  return deck("Fundraiser pitch", centreTheme, [
    {
      layout: "title",
      background: { color: "#0d2818" },
      elements: [
        text("Fundraiser pitch", {
          x: 80,
          y: 170,
          width: 800,
          height: 80,
          fontSize: 44,
          align: "center",
          fontFamily: "Montserrat",
          color: "#ffffff",
        }),
        text("Community centre · Saturday", {
          y: 270,
          height: 48,
          fontSize: 22,
          bold: false,
          align: "center",
          fontFamily: "Source Sans",
          color: "#d8f3dc",
          placeholder: "Click to add subtitle",
        }),
      ],
    },
    {
      layout: "title-body",
      background: { color: "#0d2818" },
      elements: [
        text("The hall", { fontFamily: "Montserrat", color: "#ffffff" }),
        text("Doors at 6. Music at 7.", {
          y: 140,
          height: 70,
          fontSize: 22,
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
          width: 180,
          height: 44,
          fill: "#2e7d32",
          stroke: "#2e7d32",
        },
      ],
    },
  ]);
}

function spring() {
  return deck("Spring classes", paper, [
    {
      layout: "title",
      background: { color: "#ffffff" },
      elements: [
        text("Spring classes", {
          x: 80,
          y: 170,
          width: 800,
          height: 80,
          fontSize: 44,
          align: "center",
          fontFamily: "Georgia",
          color: "#1a1a1a",
        }),
        text("Next week's programme", {
          y: 270,
          height: 48,
          fontSize: 22,
          bold: false,
          align: "center",
          fontFamily: "Arial",
          color: "#3c4043",
          placeholder: "Click to add subtitle",
        }),
      ],
    },
    {
      layout: "title-body",
      background: { color: "#ffffff" },
      elements: [
        text("Saturday mornings", { fontFamily: "Georgia", color: "#1a1a1a" }),
        text("Yoga, then painting.", {
          y: 140,
          height: 60,
          fontSize: 22,
          bold: false,
          fontFamily: "Arial",
          color: "#3c4043",
          placeholder: "Click to add text",
        }),
        text(free, {
          y: 230,
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
          width: 180,
          height: 44,
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
          y: 150,
          height: 90,
          fontSize: 22,
          bold: false,
          align: "center",
          fontFamily: "Georgia",
          italic: true,
          color: "#f4e4d4",
          placeholder: undefined,
          themeOverride: true,
        }),
        text(follows, {
          y: 270,
          height: 50,
          fontSize: 20,
          bold: false,
          fontFamily: "Arial",
          color: "#3c4043",
          placeholder: "Click to add text",
        }),
      ],
    },
  ]);
}

function scratch() {
  return deck("Scratch", undefined, [
    {
      layout: "title",
      background: { color: "#111827" },
      elements: [
        text("Scratch", {
          y: 190,
          width: 800,
          height: 80,
          fontSize: 44,
          align: "center",
          fontFamily: "Arial",
          color: "#f8fafc",
        }),
      ],
    },
  ]);
}

async function fontOf(page: Page, content: string) {
  return page.locator(".slide-canvas").evaluate((root, content) => {
    const area = [...root.querySelectorAll("textarea")].find(
      (node) => (node as HTMLTextAreaElement).value === content,
    );
    const box = area?.parentElement;
    if (!box) return { family: "", style: "" };
    const css = getComputedStyle(box);
    return { family: css.fontFamily, style: css.fontStyle };
  }, content);
}

const family = async (page: Page, content: string) => (await fontOf(page, content)).family;
const fontStyle = async (page: Page, content: string) => (await fontOf(page, content)).style;

async function clickText(page: Page, content: string) {
  const point = await page.locator(".slide-canvas").evaluate((root, content) => {
    const area = [...root.querySelectorAll("textarea")].find(
      (node) => (node as HTMLTextAreaElement).value === content,
    );
    const rect = area?.getBoundingClientRect();
    return rect
      ? { x: rect.x + Math.min(rect.width / 2, 80), y: rect.y + rect.height / 2 }
      : null;
  }, content);
  expect(point).toBeTruthy();
  await page.mouse.click(point!.x, point!.y);
}

async function importDeck(page: Page, title: string, json: string) {
  if (await page.getByRole("button", { name: "Back to files" }).isVisible()) {
    await expect(page.locator(".save-status")).toContainText("Saved");
    await page.getByRole("button", { name: "Back to files" }).click();
  }
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

async function openTheme(page: Page) {
  const theme = page.getByRole("button", { name: "Theme", exact: true });
  if ((await theme.getAttribute("aria-pressed")) !== "true") await theme.click();
  await expect(page.getByRole("heading", { name: "Theme" })).toBeVisible();
}

test("47-save-a-theme-for-another-deck", async ({ page }) => {
  await page.goto("/");
  await caption(
    page,
    "Dev opens Fundraiser pitch. Meadow is already there, in the centre's green.",
    1600,
  );
  await importDeck(page, "Fundraiser pitch", fundraiser());
  await expect(page.locator(".slide-canvas")).toHaveCSS("background-color", meadow);
  await beat(page, 700);
  await page.getByRole("option", { name: "Slide 2: The hall" }).click();
  await expect(page.locator(".slide-canvas .slide-shape")).toHaveCSS("background-color", centre);
  await expect.poll(() => family(page, "The hall")).toMatch(/Montserrat/);
  await expect.poll(() => family(page, "Doors at 6. Music at 7.")).toMatch(/Source Sans/);
  await beat(page, 600);

  await caption(page, "Theme shows Meadow, accent #2E7D32, Montserrat, and Source Sans.", 1400);
  await openTheme(page);
  await expect(page.getByRole("button", { name: "Meadow", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".transition-status").first()).toContainText("#2E7D32");
  await expect(page.locator(".transition-status").first()).toContainText("Montserrat");
  await expect(page.locator(".transition-status").first()).toContainText("Source Sans");
  await beat(page, 800);

  // Save to library, type the name, Save: two clicks plus typing.
  const library = page.getByRole("region", { name: "Library" });
  await caption(page, "Save to library. One name, and it is listed immediately.", 1200);
  await library.getByRole("button", { name: "Save to library" }).scrollIntoViewIfNeeded();
  await library.getByRole("button", { name: "Save to library" }).click();
  const name = page.getByLabel("Theme name");
  await expect(name).toBeFocused();
  await typeSlowly(page, "Centre green", 70);
  await beat(page, 500);
  await library.getByRole("button", { name: "Save", exact: true }).click();
  const centreCard = library.getByRole("button", { name: "Centre green", exact: true });
  await centreCard.scrollIntoViewIfNeeded();
  await expect(centreCard).toBeVisible();
  await expect(centreCard).toContainText("#2E7D32");
  await expect(library).toContainText("Centre green is in the library.");
  await beat(page, 1800);

  await caption(page, "Dev closes the deck. After a reload, Spring classes is still Paper.", 1500);
  await expect(page.locator(".save-status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByRole("link", { name: "Fundraiser pitch", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: "Fundraiser pitch", exact: true })).toBeVisible();
  await beat(page, 600);
  await importDeck(page, "Spring classes", spring());
  await expect(page.locator(".slide-canvas")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect.poll(() => family(page, "Spring classes")).toMatch(/Georgia/);
  await beat(page, 500);

  await caption(page, "Centre green is in the library of this other deck.", 1300);
  await openTheme(page);
  await centreCard.scrollIntoViewIfNeeded();
  await expect(centreCard).toContainText("#2E7D32");
  for (const builtIn of ["Paper", "Meadow", "Ink", "Warm Sand"])
    await expect(page.getByRole("button", { name: builtIn, exact: true })).toBeVisible();
  await beat(page, 700);

  await caption(page, "Hover previews the saved look. One click copies it onto every slide.", 1400);
  await centreCard.hover();
  await expect(page.locator(".slide-canvas")).toHaveCSS("background-color", meadow);
  await beat(page, 900);
  await centreCard.click();
  await expect(centreCard).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".slide-canvas")).toHaveCSS("background-color", meadow);
  await expect.poll(() => family(page, "Spring classes")).toMatch(/Montserrat/);
  await page.getByRole("option", { name: "Slide 2: Saturday mornings" }).click();
  await expect.poll(() => family(page, free)).toMatch(/Source Sans/);
  await expect(page.locator(".slide-canvas .slide-shape")).toHaveCSS("background-color", centre);
  await beat(page, 700);

  await page.getByRole("option", { name: "Slide 3: A line to keep" }).click();
  await clickText(page, quote);
  await expect(page.locator(".theme-override-bar")).toContainText("Overrides theme");
  await expect.poll(() => family(page, quote)).toMatch(/Georgia/);
  await expect.poll(() => fontStyle(page, quote)).toBe("italic");
  await expect.poll(() => family(page, follows)).toMatch(/Source Sans/);
  await expect.poll(() => family(page, "A line to keep")).toMatch(/Montserrat/);
  await caption(page, "The italic Georgia quote was set by hand, so it stays. The line under it follows.", 1800);

  await page.getByLabel("Accent hex").scrollIntoViewIfNeeded();
  const hex = page.getByLabel("Accent hex");
  await hex.click();
  await page.keyboard.press("ControlOrMeta+A");
  await typeSlowly(page, "#66BB6A", 70);
  await expect(page.getByRole("region", { name: "Library" })).toContainText(
    "The library still has Centre green",
  );
  await page.getByRole("option", { name: "Slide 2: Saturday mornings" }).click();
  await expect(page.locator(".slide-canvas .slide-shape")).toHaveCSS("background-color", lighter);
  await centreCard.scrollIntoViewIfNeeded();
  await expect(centreCard).toContainText("#2E7D32");
  await caption(page, "A lighter green changes this deck only. The library still says #2E7D32.", 2000);

  await caption(page, "Fundraiser pitch is still the centre's green. The saved theme did not change.", 800);
  await expect(page.locator(".save-status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Fundraiser pitch", exact: true }).click();
  await expect(page.getByLabel("File title")).toHaveValue("Fundraiser pitch");
  await page.getByRole("option", { name: "Slide 2: The hall" }).click();
  await expect(page.locator(".slide-canvas .slide-shape")).toHaveCSS("background-color", centre);
  await openTheme(page);
  await expect(page.getByLabel("Accent hex")).toHaveValue("#2e7d32");
  await centreCard.scrollIntoViewIfNeeded();
  await expect(centreCard).toContainText("#2E7D32");
  await beat(page, 1600);

  await caption(page, "Paper, Meadow, Ink, and Warm Sand stay. Paper still restyles a scratch slide.", 800);
  await importDeck(page, "Scratch", scratch());
  await expect(page.locator(".slide-canvas")).toHaveCSS("background-color", "rgb(17, 24, 39)");
  await openTheme(page);
  for (const builtIn of ["Paper", "Meadow", "Ink", "Warm Sand"])
    await expect(page.getByRole("button", { name: builtIn, exact: true })).toBeVisible();
  await beat(page, 500);
  await page.getByRole("button", { name: "Paper", exact: true }).click();
  await expect(page.locator(".slide-canvas")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect.poll(() => family(page, "Scratch")).toMatch(/Georgia/);
  await beat(page, 1600);

  await caption(page, "Centre green in the library never changed, so Spring classes can take that copy again.", 1500);
  await expect(page.locator(".save-status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Spring classes", exact: true }).click();
  await expect(page.getByLabel("File title")).toHaveValue("Spring classes");
  await openTheme(page);
  await centreCard.scrollIntoViewIfNeeded();
  await centreCard.click();
  await page.getByRole("option", { name: "Slide 2: Saturday mornings" }).click();
  await expect(page.locator(".slide-canvas .slide-shape")).toHaveCSS("background-color", centre);
  await expect(page.locator(".save-status")).toContainText("Saved");
  await beat(page, 700);

  await caption(page, "Dev downloads Spring classes. The look travels in the file.", 1400);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("Spring classes.slslides");
  const bytes = readFileSync((await download.path())!);
  const saved = JSON.parse(bytes.toString("utf8"));
  expect(saved.content.theme).toMatchObject({
    name: "Centre green",
    accent: "#2e7d32",
    headingFont: "Montserrat",
    bodyFont: "Source Sans",
    background: "#0d2818",
  });
  const slides = saved.content.slideOrder.map((id: string) => saved.content.slides[id]);
  expect(slides.every((slide: { transition?: unknown }) => slide.transition == null)).toBe(true);
  const quoteEl = slides[2].elements.find((el: { content?: string }) => el.content === quote);
  expect(quoteEl).toMatchObject({
    fontFamily: "Georgia",
    italic: true,
    color: "#f4e4d4",
    themeOverride: true,
  });
  await beat(page, 600);

  await page.evaluate(() => localStorage.removeItem("suiteleaf_slide_theme_library"));
  saved.id = crypto.randomUUID();
  saved.content.id = saved.id;
  await page.getByRole("button", { name: "Back to files" }).click();
  const again = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (await again).setFiles({
    name: "Spring classes.slslides",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(saved)),
  });
  await expect(page.getByLabel("File title")).toHaveValue("Spring classes");
  await expect(page.locator(".slide-canvas")).toHaveCSS("background-color", meadow);
  await openTheme(page);
  await expect(page.getByRole("region", { name: "Library" })).toContainText("No saved themes yet");
  await expect(page.getByLabel("Accent hex")).toHaveValue("#2e7d32");
  await expect(page.locator(".transition-status").first()).toContainText("Montserrat");
  await expect(page.locator(".transition-status").first()).toContainText("Source Sans");
  await page.getByRole("option", { name: "Slide 3: A line to keep" }).click();
  await clickText(page, quote);
  await expect(page.locator(".theme-override-bar")).toContainText("Overrides theme");
  await expect.poll(() => family(page, quote)).toMatch(/Georgia/);
  await expect.poll(() => fontStyle(page, quote)).toBe("italic");
  await expect.poll(() => family(page, follows)).toMatch(/Source Sans/);
  await page.getByRole("region", { name: "Library" }).getByText("No saved themes yet").scrollIntoViewIfNeeded();
  await caption(
    page,
    "On a computer that never saved Centre green, the file still looks the same.",
    2400,
  );
});
