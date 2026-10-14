import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { askAgent, beat, caption, describeRun, electronApps, electronMode, expect, openApp, test } from "../harness";

type Element = { type: string; content?: string; shapeType?: string; x: number; y: number; width: number; height: number; fill?: string };
type Slide = { layout?: string; background?: { color?: string }; elements: Element[] };

/** Keeps a copy the way Priya would: Download on the web, Save As on the desktop. Returns the parsed file. */
async function keepCopy(page: Page) {
  const dir = mkdtempSync(join(tmpdir(), "storyboard-20-ai-"));
  const saved = join(dir, "Spring Garden Kickoff.slslides");
  if (electronMode) {
    await electronApps.get(page)!.evaluate(({ dialog }, path) => {
      (dialog as unknown as Record<string, unknown>).showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, saved);
    await page.getByRole("button", { name: "Save As", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Saved to file");
  } else {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download", exact: true }).click();
    await (await download).saveAs(saved);
  }
  return JSON.parse(readFileSync(saved, "utf8"));
}

/** Hue (0–360), saturation and lightness (0–1) of a #rrggbb color. */
function hsl(color = "") {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return { h: NaN, s: NaN, l: NaN };
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    l = (max + min) / 2,
    d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  const h = d === 0 ? 0 : max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return { h: (h + 360) % 360, s, l };
}

const texts = (slide: Slide) => slide.elements.filter((e) => e.type === "text").map((e) => e.content ?? "");

test("20-build-a-presentation-ai", async ({ page }) => {
  await openApp(page);
  await caption(page, "Priya has ten minutes to make slides for Saturday's community garden meeting.");
  await caption(page, "She asks SuiteLeaf's on-device assistant to build the deck.", 1200);
  await caption(page, "", 0);

  const build = await askAgent(
    page,
    "Make a presentation called Spring Garden Kickoff for Saturday's garden meeting. Start with a title slide: Spring Garden Kickoff, subtitle Community Garden · Saturday 10 am. " +
      "Then a slide called This season's plan with three bullets: Tomatoes and basil in the sunny beds, New compost bins by the shed, Watering rota on the noticeboard. " +
      "Then How you can help, with two lists side by side: Saturdays (Weeding, 9–11 am; Watering rota) and In May (Seedling swap; Plant sale stall). " +
      "Finish with a section slide that just says Questions? On the title slide, put a yellow sun in the top-right corner and make that slide's background sage green.",
  );
  let why = describeRun(build);
  expect(build.state, why).toBe("done");
  const rows = page.locator(".thumbnail-row");
  await expect(page.getByLabel("File title"), why).toHaveValue("Spring Garden Kickoff");
  await expect(rows, why).toHaveCount(4);
  await caption(page, "Gemma built four slides: the title, the plan, the volunteer jobs and a closing section.", 2400);

  await caption(page, "Looking it over, Priya wants the volunteer jobs first. She asks…");
  await caption(page, "", 0);
  const reorder = await askAgent(page, "Actually, put How you can help before This season's plan.");
  // The session keeps the first request's transcript, so this covers both.
  why = describeRun(reorder);
  expect(reorder.state, why).toBe("done");
  await expect(rows.nth(1), why).toContainText("How you can help");
  await expect(rows.nth(2), why).toContainText("This season's plan");
  await expect(page.getByRole("status"), why).toContainText(electronMode ? "Draft saved" : "Saved on this device");
  await page.getByRole("button", { name: "Close assistant" }).click();
  await beat(page, 500);
  await caption(page, "The volunteer slide moved up. Everything saved itself as Gemma worked.", 2000);

  await caption(page, "She clicks through the slides to check them.", 900);
  for (let i = 0; i < 4; i++) {
    await rows.nth(i).click();
    await beat(page, 1300);
  }
  await rows.nth(0).click();
  await beat(page, 600);

  const file = await keepCopy(page);
  const deck = file.content as { slideOrder: string[]; slides: Record<string, Slide> };
  const slides = deck.slideOrder.map((id) => deck.slides[id]);
  const listing = `${why}\nSlides: ${JSON.stringify(slides.map((s) => ({ layout: s.layout, background: s.background, elements: s.elements.map(({ type, content, shapeType, x, y, width, height, fill }) => ({ type, content, shapeType, x, y, width, height, fill })) })))}`;

  // Four slides in the order Title, How you can help, This season's plan, Questions?
  expect(slides.map((s) => texts(s)[0]?.trim()), listing).toEqual(["Spring Garden Kickoff", "How you can help", "This season's plan", "Questions?"]);
  const [titleSlide, help, plan, questions] = slides;

  // Every box holds what Priya asked for; no stand-in text anywhere.
  const all = slides.flatMap(texts).join("\n");
  expect(all, listing).not.toMatch(/Slide Title|First key point|Click to add/i);
  expect(texts(titleSlide)[1], listing).toContain("Community Garden · Saturday 10 am");
  for (const bullet of ["Tomatoes and basil in the sunny beds", "New compost bins by the shed", "Watering rota on the noticeboard"])
    expect(texts(plan).slice(1).join("\n"), listing).toContain(bullet);

  // The volunteer slide uses the Two columns layout: Saturday jobs on one side, May events on the other.
  expect(help.layout, listing).toBe("two-column");
  const [left, right] = texts(help).slice(1);
  expect(left, listing).toMatch(/Saturday/);
  expect(left, listing).toMatch(/Weeding/);
  expect(left, listing).not.toMatch(/Seedling/);
  expect(right, listing).toMatch(/May/);
  expect(right, listing).toMatch(/Seedling swap/);
  expect(right, listing).toMatch(/Plant sale stall/);

  // The title slide has a sage background and a round yellow sun in the top-right corner.
  const sage = hsl(titleSlide.background?.color);
  expect(sage.h, listing).toBeGreaterThanOrEqual(70);
  expect(sage.h, listing).toBeLessThanOrEqual(180);
  expect(sage.s, listing).toBeLessThanOrEqual(0.5);
  expect(sage.l, listing).toBeGreaterThanOrEqual(0.45);
  const suns = titleSlide.elements.filter((e) => e.type === "shape" && e.shapeType === "ellipse");
  expect(suns, listing).toHaveLength(1);
  const sun = suns[0];
  expect(sun.width, listing).toBe(sun.height);
  const yellow = hsl(sun.fill);
  expect(yellow.h, listing).toBeGreaterThanOrEqual(40);
  expect(yellow.h, listing).toBeLessThanOrEqual(62);
  expect(yellow.s, listing).toBeGreaterThanOrEqual(0.7);
  expect(sun.x + sun.width / 2, listing).toBeGreaterThan(960 * 0.6);
  expect(sun.y + sun.height / 2, listing).toBeLessThan(540 * 0.4);

  // The section slide is dark.
  expect(questions.layout, listing).toBe("section");
  expect(hsl(questions.background?.color).l, listing).toBeLessThan(0.3);
  await caption(page, "Four slides in order, a sage title slide with a yellow sun, saved on this device.", 2000);
});
