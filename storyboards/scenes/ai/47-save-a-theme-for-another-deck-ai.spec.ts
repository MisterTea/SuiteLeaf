import type { Page } from "@playwright/test";
import { createFile, serializeFile, type Slide, type SlideElement, type SlideFile, type SlideTheme } from "@suiteleaf/core";
import { THEME_LIBRARY_KEY } from "../../../apps/web/src/editors/slide-theme-library";
import { askAgent, caption, describeRun, expect, openApp, test } from "../harness";

const quote = "The town shows up for each other.";
const free = "Bring indoor shoes.";
const follows = "Ages 8 and up.";

const centreTheme: SlideTheme = {
  id: "meadow",
  name: "Meadow",
  background: "#0d2818",
  headingColor: "#ffffff",
  bodyColor: "#d8f3dc",
  accent: "#2e7d32",
  headingFont: "Montserrat",
  bodyFont: "Source Sans",
};

const paper: SlideTheme = {
  id: "paper",
  name: "Paper",
  background: "#ffffff",
  headingColor: "#1a1a1a",
  bodyColor: "#3c4043",
  accent: "#1a73e8",
  headingFont: "Georgia",
  bodyFont: "Arial",
};

function text(content: string, extra: Partial<SlideElement> = {}): SlideElement {
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

function shape(fill: string): SlideElement {
  return {
    id: crypto.randomUUID(),
    type: "shape",
    shapeType: "roundRect",
    x: 72,
    y: 400,
    width: 180,
    height: 44,
    fill,
    stroke: fill,
  };
}

function withSlides(title: string, theme: SlideTheme, slides: Slide[]): SlideFile {
  const file = createFile("slide", title) as SlideFile;
  const [first, ...rest] = slides;
  const firstId = file.content.slideOrder[0];
  file.content.theme = theme;
  file.content.slides = { [firstId]: { ...first, id: firstId } };
  file.content.slideOrder = [firstId, ...rest.map((slide) => slide.id)];
  for (const slide of rest) file.content.slides[slide.id] = slide;
  return file;
}

function fundraiserDeck(): SlideFile {
  return withSlides("Fundraiser pitch", centreTheme, [
    {
      id: crypto.randomUUID(),
      title: "Fundraiser pitch",
      layout: "title",
      background: { color: "#0d2818" },
      notes: "",
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
      id: crypto.randomUUID(),
      title: "The hall",
      layout: "title-body",
      background: { color: "#0d2818" },
      notes: "",
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
        shape("#2e7d32"),
      ],
    },
  ]);
}

function springDeck(): SlideFile {
  return withSlides("Spring classes", paper, [
    {
      id: crypto.randomUUID(),
      title: "Spring classes",
      layout: "title",
      background: { color: "#ffffff" },
      notes: "",
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
      id: crypto.randomUUID(),
      title: "Saturday mornings",
      layout: "title-body",
      background: { color: "#ffffff" },
      notes: "",
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
        shape("#1a73e8"),
      ],
    },
    {
      id: crypto.randomUUID(),
      title: "A line to keep",
      layout: "title-body",
      background: { color: "#ffffff" },
      notes: "",
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

async function seedDecks(page: Page) {
  const natives = [serializeFile(fundraiserDeck()), serializeFile(springDeck())];
  await page.evaluate(async (files) => {
    localStorage.removeItem("suiteleaf_slide_theme_library");
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("SuiteLeaf");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("encoded", "readwrite");
        for (const native of files) {
          const file = JSON.parse(native) as { id: string; title: string; updatedAt: string };
          tx.objectStore("encoded").put({ id: file.id, title: file.title, updatedAt: file.updatedAt, native });
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  }, natives);
  await page.reload();
}

type SavedElement = {
  type: string;
  content?: string;
  fontFamily?: string;
  italic?: boolean;
  themeOverride?: boolean;
  fill?: string;
  color?: string;
};
type SavedSlide = { background?: { color?: string }; elements: SavedElement[] };
type SavedFile = {
  content: {
    theme?: { name?: string; accent?: string; headingFont?: string; bodyFont?: string; background?: string; id?: string };
    slideOrder: string[];
    slides: Record<string, SavedSlide>;
  };
};

async function savedDeck(page: Page, title: string): Promise<SavedFile | null> {
  return page.evaluate(async (title) => {
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
    const row = rows.find((item) => item.title === title);
    if (!row?.native) return null;
    const text = typeof row.native === "string" ? row.native : await row.native.text();
    return JSON.parse(text) as SavedFile;
  }, title);
}

async function libraryThemes(page: Page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as { id?: string; name?: string; accent?: string; headingFont?: string; bodyFont?: string; background?: string }[]) : [];
  }, THEME_LIBRARY_KEY);
}

const PROMPT =
  "This deck is Fundraiser pitch. Its theme is already Meadow, accent #2E7D32, headings Montserrat, body Source Sans. Save that current look to the theme library as Centre green, and apply that saved theme to the presentation Spring classes. Call save_theme once with name Centre green and apply_to Spring classes. Do not change the accent, the fonts, or Fundraiser pitch. Do not call apply_theme. Stop when Spring classes uses Centre green.";

test("47-save-a-theme-for-another-deck-ai", async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole("button", { name: "New presentation" })).toBeVisible();
  await seedDecks(page);
  await expect(page.getByRole("link", { name: "Fundraiser pitch", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Spring classes", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Fundraiser pitch", exact: true }).click();
  await expect(page.getByLabel("File title")).toHaveValue("Fundraiser pitch");
  await caption(page, "Dev asks the assistant to save Centre green and use it on Spring classes.");
  await caption(page, "", 0);

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  let spring: SavedFile | null = null;
  await expect
    .poll(
      async () => {
        spring = await savedDeck(page, "Spring classes");
        const theme = spring?.content.theme;
        return theme ? `${theme.name ?? ""} ${theme.accent?.toLowerCase() ?? ""}` : "";
      },
      { timeout: 15000 },
    )
    .toBe("Centre green #2e7d32");
  const springFile = spring!;
  expect(springFile.content.theme, why).toMatchObject({
    name: "Centre green",
    background: "#0d2818",
    headingFont: "Montserrat",
    bodyFont: "Source Sans",
    accent: "#2e7d32",
  });
  const springSlides = springFile.content.slideOrder.map((id) => springFile.content.slides[id]);
  for (const slide of springSlides) expect(slide.background?.color, why).toBe("#0d2818");
  const freeEl = springSlides.flatMap((slide) => slide.elements).find((el) => el.content === free);
  expect(freeEl, why).toMatchObject({ fontFamily: "Source Sans", color: "#d8f3dc" });
  expect(freeEl?.themeOverride, why).not.toBe(true);
  const headings = ["Spring classes", "Saturday mornings", "A line to keep"];
  for (const heading of headings) {
    const el = springSlides.flatMap((slide) => slide.elements).find((item) => item.content === heading);
    expect(el?.fontFamily, why).toBe("Montserrat");
  }
  const shapes = springSlides.flatMap((slide) => slide.elements.filter((el) => el.type === "shape"));
  expect(shapes.length, why).toBeGreaterThan(0);
  for (const shapeEl of shapes) expect(shapeEl.fill, why).toBe("#2e7d32");

  const fundraiser = await savedDeck(page, "Fundraiser pitch");
  expect(fundraiser?.content.theme, why).toMatchObject({
    accent: "#2e7d32",
    headingFont: "Montserrat",
    bodyFont: "Source Sans",
    background: "#0d2818",
  });

  const library = await libraryThemes(page);
  const centre = library.find((theme) => theme.name === "Centre green");
  expect(centre, why).toMatchObject({
    accent: "#2e7d32",
    headingFont: "Montserrat",
    bodyFont: "Source Sans",
    background: "#0d2818",
  });
  expect(centre?.id ?? "", why).toMatch(/^saved:/);
  expect(["paper", "meadow", "ink", "sand"], why).not.toContain(centre?.id);
  await caption(page, "Centre green is in the library, and Spring classes uses that look.", 1600);
});
