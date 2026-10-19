import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { beat, caption, expect, test, typeSlowly } from "./harness";

const meadow = "rgb(13, 40, 24)";
const centre = "rgb(46, 125, 50)";
const aside = "The hall holds 180, chairs included.";
const neighbour = "Bring a neighbour if you can.";
const quote = "This centre is where the town shows up for each other.";
const follows = "Read it twice.";

function text(
  content: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id: crypto.randomUUID(),
    type: "text",
    x: 72,
    y: 36,
    width: 820,
    height: 64,
    content,
    fontSize: 34,
    bold: true,
    fontFamily: "Arial",
    color: "#1e293b",
    align: "left",
    placeholder: "Click to add title",
    ...extra,
  };
}

function body(content: string, extra: Record<string, unknown> = {}) {
  return text(content, {
    y: 130,
    height: 150,
    fontSize: 20,
    bold: false,
    color: "#334155",
    placeholder: "Click to add text",
    ...extra,
  });
}

function shape(y = 430) {
  return {
    id: crypto.randomUUID(),
    type: "shape",
    shapeType: "roundRect",
    x: 72,
    y,
    width: 168,
    height: 40,
    fill: "#94a3b8",
    stroke: "#94a3b8",
  };
}

/** The plain fundraiser deck Dev already wrote, before any theme. */
function fundraiserDeck() {
  const now = new Date().toISOString();
  const slides = [
    {
      title: "Fundraiser pitch",
      layout: "title",
      background: { color: "#ffffff" },
      elements: [
        text("Fundraiser pitch", {
          x: 80,
          y: 160,
          width: 800,
          height: 90,
          fontSize: 44,
          align: "center",
        }),
        text("Community centre · Saturday", {
          y: 270,
          height: 50,
          fontSize: 22,
          bold: false,
          align: "center",
          color: "#64748b",
          placeholder: "Click to add subtitle",
        }),
      ],
    },
    {
      title: "Why we're here",
      layout: "title-body",
      elements: [
        text("Why we're here"),
        body("The roof leaks.\nThe hall is booked most nights.\nWe need a Saturday that pays for both."),
      ],
    },
    {
      title: "The hall",
      layout: "title-body",
      elements: [
        text("The hall"),
        body("Doors at 6. Music at 7."),
        text(aside, {
          y: 300,
          height: 70,
          fontSize: 18,
          bold: false,
          fontFamily: "Georgia",
          placeholder: undefined,
        }),
        shape(),
      ],
    },
    {
      title: "The evening",
      layout: "title-body",
      elements: [text("The evening"), body("Supper, a raffle, and one short speech.")],
    },
    {
      title: "Who it's for",
      layout: "title-body",
      elements: [text("Who it's for"), body("Neighbours, the youth club, and anyone who uses the kitchen.")],
    },
    {
      title: "What we need",
      layout: "title-body",
      elements: [text("What we need"), body("£4,000 for the roof. £800 for the kitchen."), shape(400)],
    },
    {
      title: "A line from the chair",
      layout: "title-body",
      elements: [
        text("A line from the chair"),
        text(quote, {
          y: 160,
          height: 120,
          fontSize: 22,
          bold: false,
          align: "center",
          placeholder: undefined,
        }),
        body(follows, { y: 320, height: 50 }),
      ],
    },
    {
      title: "How to help",
      layout: "title-body",
      elements: [
        text("How to help"),
        body("Bring a dish. Buy a ticket. Stay to stack chairs."),
        text(neighbour, {
          y: 340,
          height: 60,
          fontSize: 18,
          bold: false,
          fontFamily: "Georgia",
          placeholder: undefined,
        }),
      ],
    },
    {
      title: "Join us",
      layout: "section",
      background: { color: "#1e293b" },
      elements: [
        text("Join us", {
          y: 200,
          height: 100,
          fontSize: 46,
          align: "center",
          color: "#f8fafc",
        }),
      ],
    },
    {
      title: "Thank you",
      layout: "title",
      elements: [
        text("Thank you", {
          y: 200,
          height: 90,
          fontSize: 44,
          align: "center",
        }),
      ],
    },
  ].map((slide) => ({ id: crypto.randomUUID(), notes: "", ...slide }));
  const id = crypto.randomUUID();
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
      slideOrder: slides.map((slide) => slide.id),
      slides: Object.fromEntries(slides.map((slide) => [slide.id, slide])),
    },
  });
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
    return rect ? { x: rect.x + Math.min(rect.width / 2, 80), y: rect.y + rect.height / 2 } : null;
  }, content);
  expect(point).toBeTruthy();
  await page.mouse.click(point!.x, point!.y);
}

test("32-give-a-deck-a-theme-and-transitions", async ({ page }) => {
  await page.addInitScript(() => {
    let current: Element | null = null;
    const change = (el: Element | null) => {
      current = el;
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    };
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => current,
    });
    Element.prototype.requestFullscreen = function () {
      return change(this);
    };
    document.exitFullscreen = () => change(null);
  });

  await page.goto("/");
  await caption(page, "Dev opens the fundraiser pitch. Ten slides, written in a hurry.", 1600);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (await chooser).setFiles({
    name: "Fundraiser pitch.slslides",
    mimeType: "application/json",
    buffer: Buffer.from(fundraiserDeck()),
  });
  await expect(page.getByLabel("File title")).toHaveValue("Fundraiser pitch");
  await expect(page.locator(".thumbnail-row")).toHaveCount(10);
  await expect(page.locator(".slide-canvas")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await beat(page, 600);

  await caption(page, "Most of the type is Arial. Two notes were set in Georgia along the way.", 1400);
  await page.getByRole("option", { name: "Slide 3" }).click();
  await expect.poll(() => family(page, aside)).toMatch(/Georgia/);
  await beat(page, 800);

  await caption(page, "Theme opens a panel of whole looks, not just background colours.", 1200);
  await page.getByRole("button", { name: "Theme", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Theme" })).toBeVisible();
  const meadowCard = page.getByRole("button", { name: "Meadow", exact: true });
  await expect(meadowCard).toBeVisible();
  await beat(page, 500);

  await meadowCard.hover();
  await caption(page, "Hovering Meadow previews it on this slide, Georgia note included.", 1600);
  await expect(page.locator(".slide-canvas")).toHaveCSS("background-color", meadow);
  await expect.poll(() => family(page, aside)).toMatch(/Source Sans/);
  await expect.poll(() => family(page, "The hall")).toMatch(/Montserrat/);
  await page.getByRole("heading", { name: "Theme" }).hover();
  await caption(page, "Move away and the slide returns to the way Dev wrote it.", 1000);
  await expect(page.locator(".slide-canvas")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect.poll(() => family(page, aside)).toMatch(/Georgia/);

  await caption(page, "One click puts Meadow on every slide. The Georgia notes follow too.", 1200);
  await meadowCard.click();
  await expect(meadowCard).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".slide-canvas")).toHaveCSS("background-color", meadow);
  await expect.poll(() => family(page, aside)).toMatch(/Source Sans/);
  await page.getByRole("option", { name: "Slide 8" }).click();
  await expect.poll(() => family(page, neighbour)).toMatch(/Source Sans/);
  await page.getByRole("option", { name: "Slide 9" }).click();
  await expect(page.locator(".slide-canvas")).toHaveCSS("background-color", meadow);
  await expect.poll(() => family(page, "Join us")).toMatch(/Montserrat/);
  await beat(page);

  await caption(page, "The centre's green is #2E7D32. Dev types it into the accent colour.", 1200);
  await page.getByRole("option", { name: "Slide 3" }).click();
  const hex = page.getByLabel("Accent hex");
  await hex.click();
  await page.keyboard.press("ControlOrMeta+A");
  await typeSlowly(page, "#2E7D32", 50);
  await expect(page.locator(".slide-canvas .slide-shape")).toHaveCSS("background-color", centre);
  await expect(hex).toHaveValue("#2e7d32");
  await beat(page);

  await caption(page, "One line should stay in italic Georgia. That marks it as an exception.", 1400);
  await page.getByRole("option", { name: "Slide 7" }).click();
  await clickText(page, quote);
  await page.getByLabel("Font family").selectOption("Georgia");
  await page.getByRole("button", { name: "Italic" }).click();
  await expect(page.locator(".theme-override-bar")).toContainText("Overrides theme");
  await expect(page.getByRole("button", { name: "Reset to theme" })).toBeVisible();
  await expect.poll(() => family(page, quote)).toMatch(/Georgia/);
  await expect.poll(() => fontStyle(page, quote)).toBe("italic");
  await beat(page, 700);

  await caption(page, "Ink restyles the deck. The quote stays Georgia. Everything else moves.", 1400);
  await page.getByRole("button", { name: "Ink", exact: true }).click();
  await expect.poll(() => family(page, quote)).toMatch(/Georgia/);
  await expect.poll(() => fontStyle(page, quote)).toBe("italic");
  await expect.poll(() => family(page, follows)).toMatch(/Arial/);
  await expect.poll(() => family(page, "A line from the chair")).toMatch(/Trebuchet/);
  await beat(page, 900);
  await caption(page, "Back to Meadow, and the centre's green is still the accent.", 1200);
  await page.getByRole("button", { name: "Meadow", exact: true }).click();
  await expect.poll(() => family(page, quote)).toMatch(/Georgia/);
  await expect.poll(() => fontStyle(page, quote)).toBe("italic");
  await expect.poll(() => family(page, follows)).toMatch(/Source Sans/);
  await expect.poll(() => family(page, "A line from the chair")).toMatch(/Montserrat/);
  await page.getByRole("option", { name: "Slide 3" }).click();
  await expect(page.locator(".slide-canvas .slide-shape")).toHaveCSS("background-color", centre);
  await beat(page, 600);

  await caption(page, "A new slide already matches. So does a new shape, and a new layout.", 1400);
  await page.getByRole("option", { name: "Slide 10" }).click();
  await page.keyboard.press("ControlOrMeta+M");
  await expect(page.locator(".thumbnail-row")).toHaveCount(11);
  await expect(page.locator(".slide-canvas")).toHaveCSS("background-color", meadow);
  await expect(page.locator(".slide-canvas textarea").first()).toHaveAttribute(
    "placeholder",
    "Click to add title",
  );
  await expect
    .poll(() =>
      page.locator(".slide-canvas .slide-text").first().evaluate((el) => getComputedStyle(el).fontFamily),
    )
    .toMatch(/Montserrat/);
  await page.getByRole("button", { name: "Slide", exact: true }).click();
  await page.getByRole("menuitem", { name: "Apply layout" }).hover();
  await page.getByRole("menuitem", { name: "Section header" }).click();
  await expect(page.locator(".slide-canvas")).toHaveCSS("background-color", meadow);
  await page.getByRole("button", { name: "Rectangle" }).click();
  await expect(page.locator(".slide-canvas .slide-shape")).toHaveCSS("background-color", centre);
  await beat(page);

  // Slide, Transition, Fade: three clicks, and All slides is already selected.
  await caption(page, "Slide, Transition, Fade. 0.4 seconds, on every slide.", 1400);
  await page.getByRole("button", { name: "Slide", exact: true }).click();
  await page.getByRole("menuitem", { name: "Transition", exact: true }).click();
  await expect(page.getByRole("button", { name: "All slides", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Fade", exact: true }).click();
  await expect(page.locator(".transition-status")).toHaveText("Fade · 0.4 s · all slides");
  await expect(page.locator(".thumbnail-transition")).toHaveCount(11);
  await beat(page, 600);

  await caption(page, "Play previews the fade on this slide.", 900);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator(".slide-canvas")).toHaveClass(/deck-motion-fade/);
  await beat(page, 700);

  await caption(page, "The slideshow fades from one slide to the next.", 1000);
  await page.getByRole("option", { name: "Slide 1, fade transition" }).click();
  await page.keyboard.press("ControlOrMeta+Enter");
  const show = page.locator(".presenter-overlay");
  await expect(show).toBeVisible();
  await beat(page, 500);
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".presenter-slide-box")).toHaveClass(/deck-motion-fade/);
  await beat(page, 800);
  await page.keyboard.press("Escape");
  await expect(show).toHaveCount(0);
  await beat(page, 400);

  await caption(page, "Slides 4 to 6 should cut. The rest keep the fade.", 1400);
  await page.getByRole("option", { name: "Slide 4, fade transition" }).click();
  await page.getByRole("option", { name: "Slide 6, fade transition" }).click({ modifiers: ["Shift"] });
  await expect(page.getByRole("button", { name: /Selected \(3\)/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "None", exact: true }).click();
  await expect(page.getByRole("option", { name: "Slide 4: The evening" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Slide 5: Who it's for" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Slide 6: What we need" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Slide 3, fade transition" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Slide 7, fade transition" })).toBeVisible();
  await expect(page.locator(".thumbnail-transition")).toHaveCount(8);
  await beat(page, 500);

  await page.getByRole("option", { name: "Slide 3, fade transition" }).click();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(show).toBeVisible();
  await beat(page, 400);
  await page.keyboard.press("ArrowRight");
  await expect(show).toContainText("Slide 4 of 11");
  await expect(page.locator(".presenter-slide-box")).not.toHaveClass(/deck-motion/);
  await caption(page, "Arriving at slide 4 is a cut.", 900);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(show).toContainText("Slide 7 of 11");
  await expect(page.locator(".presenter-slide-box")).toHaveClass(/deck-motion-fade/);
  await caption(page, "Slide 7 still fades in.", 1200);
  await page.keyboard.press("Escape");
  await expect(show).toHaveCount(0);

  await caption(page, "Dev downloads the file. On another computer, the look and the fades are still there.", 1600);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("Fundraiser pitch.slslides");
  const bytes = readFileSync((await download.path())!);
  const saved = JSON.parse(bytes.toString("utf8"));
  expect(saved.content.theme).toMatchObject({
    name: "Meadow",
    accent: "#2e7d32",
    headingFont: "Montserrat",
    bodyFont: "Source Sans",
  });
  const slides = saved.content.slideOrder.map((id: string) => saved.content.slides[id]);
  const quoteEl = slides[6].elements.find((el: { content?: string }) => el.content === quote);
  expect(quoteEl).toMatchObject({ fontFamily: "Georgia", italic: true, themeOverride: true });
  expect(slides[2].transition.type).toBe("fade");
  expect(slides[3].transition.type).toBe("none");
  expect(slides[5].transition.type).toBe("none");
  expect(slides[6].transition.type).toBe("fade");
  // The copy on this computer can finish saving with the same timestamp.
  // An older time makes the import a different revision, so Keep both appears.
  saved.updatedAt = new Date(Date.parse(saved.updatedAt) - 60_000).toISOString();

  await page.goto("/");
  await caption(page, "The deck is already on this computer. Open the downloaded file anyway.", 1400);
  const again = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (await again).setFiles({
    name: "Fundraiser pitch.slslides",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(saved)),
  });
  const same = page.getByRole("dialog");
  await expect(same).toContainText("already in this browser");
  await caption(page, "Keep both. The copy that just came in still has Meadow, the quote, and the fades.", 1600);
  await same.getByRole("button", { name: "Keep both" }).click();
  await expect(page.getByLabel("File title")).toHaveValue(/Fundraiser pitch/);
  await page.getByRole("button", { name: "Theme", exact: true }).click();
  await expect(page.getByRole("button", { name: "Meadow", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Accent hex")).toHaveValue("#2e7d32");
  await page.getByRole("option", { name: "Slide 7, fade transition" }).click();
  await expect.poll(() => family(page, quote)).toMatch(/Georgia/);
  await expect.poll(() => fontStyle(page, quote)).toBe("italic");
  await expect(page.locator(".thumbnail-transition")).toHaveCount(8);
  await beat(page, 1600);
});
