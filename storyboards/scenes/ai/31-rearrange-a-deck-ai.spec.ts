import type { Page } from "@playwright/test";
import { createFile, serializeFile, type Slide, type SlideElement, type SlideFile } from "@suiteleaf/core";
import { askAgent, caption, describeRun, expect, openApp, test } from "../harness";

function text(content: string, extra: Partial<SlideElement> = {}): SlideElement {
  return {
    id: crypto.randomUUID(),
    type: "text",
    x: 72,
    y: 46,
    width: 640,
    height: 78,
    content,
    fontSize: 36,
    bold: true,
    color: "#0f172a",
    ...extra,
  };
}

function slide(title: string, extra: SlideElement[] = []): Slide {
  const id = crypto.randomUUID();
  return { id, elements: [text(title), ...extra], notes: "" };
}

function bar(x: number, height: number, fill: string): SlideElement {
  return {
    id: crypto.randomUUID(),
    type: "shape",
    shapeType: "roundRect",
    x,
    y: 430 - height,
    width: 78,
    height,
    fill,
    stroke: "transparent",
    strokeWidth: 0,
  };
}

/** The same eight-slide "Q3 update" the human storyboard starts from. */
function q3Update(): SlideFile {
  const file = createFile("slide", "Q3 update") as SlideFile;
  const chart = slide("Chart", [
    bar(150, 150, "#1a73e8"),
    bar(260, 220, "#34a853"),
    bar(370, 180, "#fbbc04"),
    bar(480, 260, "#ea4335"),
    text("Quarterly revenue", { y: 150, fontSize: 22, bold: false, color: "#334155" }),
  ]);
  const slides = [
    slide("Q3 update"),
    slide("Old pipeline"),
    slide("Old targets"),
    slide("Agenda"),
    slide("Roadmap"),
    slide("Results", [
      text("128% of plan", { y: 150, fontSize: 28, bold: false, color: "#188038" }),
    ]),
    chart,
    slide("Appendix"),
  ];
  const [first, ...rest] = slides;
  const firstId = file.content.slideOrder[0];
  file.content.slides[firstId] = { ...first, id: firstId };
  file.content.slideOrder = [firstId, ...rest.map((item) => item.id)];
  for (const item of rest) file.content.slides[item.id] = item;
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
  }, serializeFile(q3Update()));
  await page.reload();
}

const PROMPT =
  "Open the presentation called Q3 update. Then rearrange that deck: Move the Results slide to the front, so it is slide 1. " +
  "Move the Old pipeline and Old targets slides together, keeping Old pipeline before Old targets, so the pair sits immediately after the Chart slide. " +
  "Duplicate the Chart slide so an identical copy, with the same chart, appears right after it. " +
  "Delete the Old pipeline and Old targets slides. " +
  "On the Results slide, add a text box that says Shipped. and make that text bold and center-aligned. " +
  "On the Results slide, add a rounded rectangle shape. " +
  "Copy that rounded rectangle onto the Q3 update slide at the same position.";

type ShapeSpot = { x: string | null; y: string | null; radius: string };

async function canvasShapes(page: Page): Promise<ShapeSpot[]> {
  return page.locator(".slide-canvas .slide-shape").evaluateAll((nodes) =>
    nodes.map((el) => ({
      x: el.getAttribute("data-x"),
      y: el.getAttribute("data-y"),
      radius: getComputedStyle(el).borderRadius,
    })),
  );
}

test("31-rearrange-a-deck-ai", async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole("button", { name: "New presentation" })).toBeVisible();
  await seedDeck(page);
  await expect(page.getByRole("link", { name: "Q3 update" })).toBeVisible();
  await caption(page, "Maria opens last quarter's update and asks the assistant to reshuffle it.");
  await caption(page, "", 0);

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  const rows = page.locator(".thumbnail-row");
  await expect(page.getByLabel("File title"), why).toHaveValue("Q3 update");
  await expect(rows, why).toHaveCount(7);
  const order = [
    "Slide 1: Results",
    "Slide 2: Q3 update",
    "Slide 3: Agenda",
    "Slide 4: Roadmap",
    "Slide 5: Chart",
    "Slide 6: Chart",
    "Slide 7: Appendix",
  ];
  for (const [i, label] of order.entries()) await expect(rows.nth(i), why).toHaveAttribute("aria-label", label);

  await rows.nth(0).click();
  const shipped = await page.locator(".slide-canvas .slide-text").evaluateAll((els) =>
    els.map((el) => ({
      text: (el.querySelector("textarea") as HTMLTextAreaElement | null)?.value ?? el.textContent ?? "",
      weight: getComputedStyle(el).fontWeight,
      align: getComputedStyle(el).textAlign,
    })),
  );
  const box = shipped.find((item) => /Shipped/.test(item.text));
  expect(box, `${why}\nText boxes: ${JSON.stringify(shipped)}`).toBeTruthy();
  expect(box!.text.trim(), why).toMatch(/^Shipped\.?$/);
  expect(box!.weight, why).toBe("700");
  expect(box!.align, why).toBe("center");
  const callout = (await canvasShapes(page)).filter((shape) => shape.radius === "12px");
  expect(callout, `${why}\nResults shapes: ${JSON.stringify(callout)}`).toHaveLength(1);

  await rows.nth(1).click();
  const pasted = (await canvasShapes(page)).filter((shape) => shape.radius === "12px");
  expect(pasted, `${why}\nSlide 2 shapes: ${JSON.stringify(pasted)}`).toEqual(callout);

  await rows.nth(4).click();
  const chart = await canvasShapes(page);
  await rows.nth(5).click();
  const copy = await canvasShapes(page);
  const spot = (shape: ShapeSpot) => `${shape.x},${shape.y},${shape.radius}`;
  expect(chart.map((shape) => shape.x).sort(), why).toEqual(["150", "260", "370", "480"]);
  expect(copy.map(spot).sort(), `${why}\nChart: ${JSON.stringify(chart)}\nCopy: ${JSON.stringify(copy)}`).toEqual(chart.map(spot).sort());
  await caption(page, "Results leads, the chart is paired, and the old slides are gone.", 1600);
});
