import type { Page } from "@playwright/test";
import { createFile, serializeFile, type Slide, type SlideElement, type SlideFile } from "@suiteleaf/core";
import { askAgent, caption, describeRun, expect, openApp, test } from "../harness";

const meadow = "rgb(13, 40, 24)";
const centre = "rgb(46, 125, 50)";
const aside = "The hall holds 180, chairs included.";
const neighbour = "Bring a neighbour if you can.";
const quote = "This centre is where the town shows up for each other.";
const follows = "Read it twice.";

function text(content: string, extra: Partial<SlideElement> = {}): SlideElement {
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

function body(content: string, extra: Partial<SlideElement> = {}) {
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

function shape(y = 430): SlideElement {
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

/** The same plain fundraiser deck the human storyboard starts from. */
function fundraiserDeck(): SlideFile {
  const file = createFile("slide", "Fundraiser pitch") as SlideFile;
  const slides: Slide[] = [
    {
      id: crypto.randomUUID(),
      title: "Fundraiser pitch",
      layout: "title",
      background: { color: "#ffffff" },
      notes: "",
      elements: [
        text("Fundraiser pitch", { x: 80, y: 160, width: 800, height: 90, fontSize: 44, align: "center" }),
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
      id: crypto.randomUUID(),
      title: "Why we're here",
      layout: "title-body",
      notes: "",
      elements: [text("Why we're here"), body("The roof leaks.\nThe hall is booked most nights.\nWe need a Saturday that pays for both.")],
    },
    {
      id: crypto.randomUUID(),
      title: "The hall",
      layout: "title-body",
      notes: "",
      elements: [
        text("The hall"),
        body("Doors at 6. Music at 7."),
        text(aside, { y: 300, height: 70, fontSize: 18, bold: false, fontFamily: "Georgia", placeholder: undefined }),
        shape(),
      ],
    },
    {
      id: crypto.randomUUID(),
      title: "The evening",
      layout: "title-body",
      notes: "",
      elements: [text("The evening"), body("Supper, a raffle, and one short speech.")],
    },
    {
      id: crypto.randomUUID(),
      title: "Who it's for",
      layout: "title-body",
      notes: "",
      elements: [text("Who it's for"), body("Neighbours, the youth club, and anyone who uses the kitchen.")],
    },
    {
      id: crypto.randomUUID(),
      title: "What we need",
      layout: "title-body",
      notes: "",
      elements: [text("What we need"), body("£4,000 for the roof. £800 for the kitchen."), shape(400)],
    },
    {
      id: crypto.randomUUID(),
      title: "A line from the chair",
      layout: "title-body",
      notes: "",
      elements: [
        text("A line from the chair"),
        text(quote, { y: 160, height: 120, fontSize: 22, bold: false, align: "center", placeholder: undefined }),
        body(follows, { y: 320, height: 50 }),
      ],
    },
    {
      id: crypto.randomUUID(),
      title: "How to help",
      layout: "title-body",
      notes: "",
      elements: [
        text("How to help"),
        body("Bring a dish. Buy a ticket. Stay to stack chairs."),
        text(neighbour, { y: 340, height: 60, fontSize: 18, bold: false, fontFamily: "Georgia", placeholder: undefined }),
      ],
    },
    {
      id: crypto.randomUUID(),
      title: "Join us",
      layout: "section",
      background: { color: "#1e293b" },
      notes: "",
      elements: [text("Join us", { y: 200, height: 100, fontSize: 46, align: "center", color: "#f8fafc" })],
    },
    {
      id: crypto.randomUUID(),
      title: "Thank you",
      layout: "title",
      notes: "",
      elements: [text("Thank you", { y: 200, height: 90, fontSize: 44, align: "center" })],
    },
  ];
  const [first, ...rest] = slides;
  const firstId = file.content.slideOrder[0];
  file.content.slides = { [firstId]: { ...first, id: firstId } };
  file.content.slideOrder = [firstId, ...rest.map((slide) => slide.id)];
  for (const slide of rest) file.content.slides[slide.id] = slide;
  return file;
}

async function seedDeck(page: Page) {
  await page.evaluate(async (native) => {
    const file = JSON.parse(native) as { id: string; title: string; updatedAt: string };
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("SuiteLeaf");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("encoded", "readwrite");
        tx.objectStore("encoded").put({ id: file.id, title: file.title, updatedAt: file.updatedAt, native });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  }, serializeFile(fundraiserDeck()));
  await page.reload();
}

type SavedElement = {
  type: string;
  content?: string;
  fontFamily?: string;
  italic?: boolean;
  themeOverride?: boolean;
  fill?: string;
};
type SavedSlide = { background?: { color?: string }; transition?: { type?: string }; elements: SavedElement[] };
type SavedFile = {
  content: {
    theme?: { name?: string; accent?: string; headingFont?: string; bodyFont?: string; background?: string };
    slideOrder: string[];
    slides: Record<string, SavedSlide>;
  };
};

async function savedDeck(page: Page): Promise<SavedFile | null> {
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
    if (!row?.native) return null;
    const text = typeof row.native === "string" ? row.native : await row.native.text();
    return JSON.parse(text) as SavedFile;
  });
}

async function fontOf(page: Page, content: string) {
  return page.locator(".slide-canvas").evaluate((root, content) => {
    const area = [...root.querySelectorAll("textarea")].find((node) => (node as HTMLTextAreaElement).value === content);
    const box = area?.parentElement;
    if (!box) return { family: "", style: "" };
    const css = getComputedStyle(box);
    return { family: css.fontFamily, style: css.fontStyle };
  }, content);
}

const PROMPT =
  "Open the presentation called Fundraiser pitch. Apply the Meadow theme to every slide in that deck, and set the theme's accent colour to #2E7D32. " +
  'On the slide titled A line from the chair, set the quote "This centre is where the town shows up for each other." to italic Georgia, and mark that quote as overriding the theme so it stays italic Georgia. ' +
  "Every other text box, including the notes that were already written in Georgia, should follow the Meadow theme. " +
  "Then give every slide a fade transition except slides 4, 5 and 6, which should have no transition. " +
  "Do not add, delete, or rewrite any slides, and do not start the slideshow.";

test("32-give-a-deck-a-theme-and-transitions-ai", async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole("button", { name: "New presentation" })).toBeVisible();
  await seedDeck(page);
  await expect(page.getByRole("link", { name: "Fundraiser pitch" })).toBeVisible();
  await caption(page, "Dev asks the assistant to give the fundraiser pitch one look, and a fade that skips one section.");
  await caption(page, "", 0);

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");
  if (await page.locator(".presenter-overlay").isVisible().catch(() => false)) await page.keyboard.press("Escape");

  await expect(page.getByLabel("File title"), why).toHaveValue("Fundraiser pitch");
  const rows = page.locator(".thumbnail-row");
  await expect(rows, why).toHaveCount(10);

  let saved: SavedFile | null = null;
  await expect
    .poll(async () => {
      saved = await savedDeck(page);
      return saved?.content.theme?.name ?? "";
    }, { timeout: 15000 })
    .toBe("Meadow");
  const file = saved!;
  expect(file.content.theme, why).toMatchObject({
    name: "Meadow",
    accent: "#2e7d32",
    headingFont: "Montserrat",
    bodyFont: "Source Sans",
    background: "#0d2818",
  });
  const slides = file.content.slideOrder.map((id) => file.content.slides[id]);
  expect(slides, why).toHaveLength(10);
  for (const slide of slides) expect(slide.background?.color, why).toBe("#0d2818");
  for (const [index, slide] of slides.entries()) {
    const type = slide.transition?.type ?? "none";
    expect(type, `${why}\nslide ${index + 1} transition`).toBe(index >= 3 && index <= 5 ? "none" : "fade");
  }
  const quoteEl = slides[6].elements.find((el) => el.content === quote);
  expect(quoteEl, why).toMatchObject({ fontFamily: "Georgia", italic: true, themeOverride: true });
  const asideEl = slides[2].elements.find((el) => el.content === aside);
  const neighbourEl = slides[7].elements.find((el) => el.content === neighbour);
  const followsEl = slides[6].elements.find((el) => el.content === follows);
  expect(asideEl, why).toMatchObject({ fontFamily: "Source Sans" });
  expect(asideEl?.themeOverride, why).not.toBe(true);
  expect(neighbourEl, why).toMatchObject({ fontFamily: "Source Sans" });
  expect(neighbourEl?.themeOverride, why).not.toBe(true);
  expect(followsEl?.fontFamily, why).toBe("Source Sans");
  expect(followsEl?.themeOverride, why).not.toBe(true);
  const shapes = slides.flatMap((slide) => slide.elements.filter((el) => el.type === "shape"));
  expect(shapes.length, why).toBeGreaterThan(0);
  for (const shapeEl of shapes) expect(shapeEl.fill, why).toBe("#2e7d32");

  const labels = [
    "Slide 1, fade transition: Fundraiser pitch",
    "Slide 2, fade transition: Why we're here",
    "Slide 3, fade transition: The hall",
    "Slide 4: The evening",
    "Slide 5: Who it's for",
    "Slide 6: What we need",
    "Slide 7, fade transition: A line from the chair",
    "Slide 8, fade transition: How to help",
    "Slide 9, fade transition: Join us",
    "Slide 10, fade transition: Thank you",
  ];
  for (const [index, label] of labels.entries()) await expect(rows.nth(index), why).toHaveAttribute("aria-label", label);

  await rows.nth(2).click();
  await expect(page.locator(".slide-canvas"), why).toHaveCSS("background-color", meadow);
  await expect.poll(() => fontOf(page, aside).then((font) => font.family), why).toMatch(/Source Sans/);
  await expect.poll(() => fontOf(page, "The hall").then((font) => font.family), why).toMatch(/Montserrat/);
  await expect(page.locator(".slide-canvas .slide-shape"), why).toHaveCSS("background-color", centre);

  await rows.nth(6).click();
  await expect.poll(() => fontOf(page, quote).then((font) => font.family), why).toMatch(/Georgia/);
  await expect.poll(() => fontOf(page, quote).then((font) => font.style), why).toBe("italic");
  await expect.poll(() => fontOf(page, follows).then((font) => font.family), why).toMatch(/Source Sans/);
  await expect.poll(() => fontOf(page, "A line from the chair").then((font) => font.family), why).toMatch(/Montserrat/);

  await rows.nth(8).click();
  await expect(page.locator(".slide-canvas"), why).toHaveCSS("background-color", meadow);
  await expect.poll(() => fontOf(page, "Join us").then((font) => font.family), why).toMatch(/Montserrat/);
  await caption(page, "Meadow is on the deck, the quote stays italic Georgia, and slides 4 to 6 cut.", 1600);
});
