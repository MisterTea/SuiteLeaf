import type { Locator, Page } from "@playwright/test";
import { askAgent, caption, describeRun, expect, openApp, test } from "../harness";

const PROMPT =
  'Q3 update is open. Make only the September callout fade in on the next click. Do not animate the chart. Do not change the slide transition. Call animate_object on the September callout with fade in on click: object "September", animation "fade-on-click". Do not call any other tool. Stop.';

function text(content: string, extra: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    type: "text",
    x: 48,
    y: 28,
    width: 520,
    height: 52,
    content,
    fontSize: 32,
    bold: true,
    fontFamily: "Arial",
    color: "#1e293b",
    align: "left",
    ...extra,
  };
}

function bar(x: number, y: number, height: number, fill: string) {
  return {
    id: crypto.randomUUID(),
    type: "shape",
    shapeType: "rect",
    x,
    y,
    width: 56,
    height,
    fill,
    stroke: fill,
  };
}

function label(content: string, x: number) {
  return text(content, {
    x,
    y: 368,
    width: 56,
    height: 28,
    fontSize: 14,
    bold: false,
    align: "center",
    color: "#3c4043",
  });
}

/** The same chart slide the human scene opens, before September waits for a click. */
function q3Deck() {
  const now = new Date().toISOString();
  const chart = {
    id: crypto.randomUUID(),
    title: "Q3 update",
    layout: "blank",
    background: { color: "#ffffff" },
    elements: [
      text("Q3 update"),
      text("Revenue by month", {
        y: 84,
        width: 360,
        height: 32,
        fontSize: 16,
        bold: false,
        color: "#64748b",
      }),
      bar(56, 230, 130, "#a8c7fa"),
      bar(132, 190, 170, "#7baaf7"),
      bar(208, 140, 220, "#1a73e8"),
      bar(284, 210, 150, "#a8c7fa"),
      label("Jul", 56),
      label("Aug", 132),
      label("Sep", 208),
      label("Oct", 284),
      text("September", {
        x: 520,
        y: 188,
        width: 380,
        height: 84,
        fontSize: 36,
        align: "center",
        color: "#7a4e00",
        fill: "#fef7e0",
      }),
    ],
  };
  const after = {
    id: crypto.randomUUID(),
    title: "What changed",
    layout: "title-body",
    background: { color: "#ffffff" },
    elements: [
      text("What changed"),
      text("October held steady.", {
        y: 140,
        width: 640,
        height: 80,
        fontSize: 28,
        bold: false,
        color: "#334155",
      }),
    ],
  };
  const id = crypto.randomUUID();
  return JSON.stringify({
    format: "suiteleaf",
    version: 1,
    id,
    title: "Q3 update",
    createdAt: now,
    updatedAt: now,
    kind: "slide",
    content: {
      id,
      width: 960,
      height: 540,
      slideOrder: [chart.id, after.id],
      slides: {
        [chart.id]: chart,
        [after.id]: after,
      },
    },
  });
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
  }, q3Deck());
  await page.reload();
}

type SavedElement = { id?: string; type?: string; content?: string; animation?: string };
type SavedSlide = { transition?: { type?: string }; elements?: SavedElement[] };
type SavedFile = { content: { slides: Record<string, SavedSlide> } };

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
    const row = rows.find((item) => item.title === "Q3 update");
    if (!row?.native) return null;
    const text = typeof row.native === "string" ? row.native : await row.native.text();
    return JSON.parse(text) as SavedFile;
  });
}

function chartSlide(file: SavedFile | null) {
  return Object.values(file?.content.slides ?? {}).find((slide) => slide.elements?.some((el) => el.content === "September"));
}

function septemberId(file: SavedFile | null) {
  return chartSlide(file)?.elements?.find((el) => el.content === "September")?.id ?? "";
}

/** September fades in on click. The chart, the Sep label, and every other object do not. */
function assertFade(file: SavedFile | null, why: string, id: string) {
  const slide = chartSlide(file);
  const september = slide?.elements?.find((el) => el.content === "September");
  const shapes = slide?.elements?.filter((el) => el.type === "shape") ?? [];
  const others = slide?.elements?.filter((el) => el.id !== september?.id && el.animation) ?? [];
  const transitions = Object.values(file?.content.slides ?? {}).map((item) => item.transition?.type ?? "");
  expect(september, why).toBeTruthy();
  expect(september?.id, why).toBe(id);
  expect(september?.animation, why).toBe("fade-on-click");
  expect(september?.type, why).toBe("text");
  expect(slide?.elements?.length, why).toBe(11);
  expect(shapes, why).toHaveLength(4);
  for (const shape of shapes) expect(shape.animation, why).toBeUndefined();
  expect(slide?.elements?.find((el) => el.content === "Sep")?.animation, why).toBeUndefined();
  expect(others, why).toEqual([]);
  expect(transitions, why).toEqual(["", ""]);
}

async function pointAt(page: Page, target: Locator, dx = 0.5, dy = 0.5) {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width * dx, box.y + box.height * dy, { steps: 8 });
}

test("61-fade-in-on-click-ai", async ({ page }) => {
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

  await openApp(page);
  await expect(page.getByRole("button", { name: "New presentation" })).toBeVisible();
  await seedDeck(page);
  await expect(page.getByRole("link", { name: "Q3 update", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Q3 update", exact: true }).click();
  await expect(page.getByLabel("File title")).toHaveValue("Q3 update");
  const canvas = page.locator(".slide-canvas");
  await expect(canvas.locator("textarea").first()).toHaveValue("Q3 update");
  await expect(canvas.locator("textarea").last()).toHaveValue("September");
  await expect(canvas.locator("textarea").last()).toBeVisible();
  await expect(canvas.locator(".slide-shape")).toHaveCount(4);
  await expect(canvas.locator(".has-fade-on-click")).toHaveCount(0);
  const seeded = await savedDeck(page);
  const id = septemberId(seeded);
  expect(id).not.toBe("");
  expect(chartSlide(seeded)?.elements?.find((el) => el.content === "September")?.animation).toBeUndefined();
  await caption(page, "Maria asks for the September callout to fade in on the next click.");
  await caption(page, "", 0);

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");
  expect(run.metrics.toolCalls, why).toBe(1);
  expect(run.metrics.tools, why).toEqual(["animate_object"]);

  let saved: SavedFile | null = null;
  await expect
    .poll(
      async () => {
        saved = await savedDeck(page);
        return chartSlide(saved)?.elements?.find((el) => el.content === "September")?.animation ?? "";
      },
      { timeout: 15000 },
    )
    .toBe("fade-on-click");
  assertFade(saved, why, id);
  await expect(canvas.locator(".has-fade-on-click textarea")).toHaveValue("September");
  await expect(canvas.locator(".has-fade-on-click textarea")).toBeVisible();
  await expect(canvas.locator(".slide-shape.has-fade-on-click")).toHaveCount(0);
  await caption(page, "September stays on the slide. The chart is not marked.", 1200);

  await expect(page.locator(".save-status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  const row = page.getByRole("link", { name: "Q3 update", exact: true });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByLabel("File title")).toHaveValue("Q3 update");
  await expect(page.locator(".has-fade-on-click textarea")).toHaveValue("September");
  await expect(page.locator(".has-fade-on-click textarea")).toBeVisible();
  const reopened = await savedDeck(page);
  assertFade(reopened, why, id);
  await caption(page, "She opens Q3 update again. September still fades in on the next click.", 1000);

  await page.getByRole("button", { name: "Slideshow", exact: true }).click();
  const show = page.locator(".presenter-overlay");
  const box = show.locator(".presenter-slide-box");
  await expect(show).toBeVisible();
  await expect(show.getByText("Slide 1 of 2")).toBeVisible();
  await expect(box.getByText("Q3 update", { exact: true })).toBeVisible();
  await expect(box.getByText("Revenue by month", { exact: true })).toBeVisible();
  await expect(box.getByText("Sep", { exact: true })).toBeVisible();
  await expect(box.getByText("September", { exact: true })).toBeHidden();
  await pointAt(page, box, 0.5, 0.48);
  await page.mouse.down();
  await page.mouse.up();
  await expect(show.getByText("Slide 1 of 2")).toBeVisible();
  await expect(box.getByText("September", { exact: true })).toBeVisible();
  await expect(box.getByText("Sep", { exact: true })).toBeVisible();
  await caption(page, "One click fades September in. The slide stays put.", 1200);
});
