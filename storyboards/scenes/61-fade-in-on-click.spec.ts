import type { Locator, Page } from "@playwright/test";
import { beat, caption, expect, test } from "./harness";

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

/** Maria's chart slide, before the callout is set to wait for a click. */
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

async function pointAt(page: Page, target: Locator, dx = 0.5, dy = 0.5) {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width * dx, box.y + box.height * dy, { steps: 14 });
}

async function openDeck(page: Page) {
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (await chooser).setFiles({
    name: "Q3 update.slslides",
    mimeType: "application/json",
    buffer: Buffer.from(q3Deck()),
  });
  await expect(page.getByLabel("File title")).toHaveValue("Q3 update");
}

test("61-fade-in-on-click", async ({ page }) => {
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

  await openDeck(page);
  await caption(
    page,
    "Maria opens Q3 update. The chart and the September callout are both on the slide.",
    1800,
  );
  const canvas = page.locator(".slide-canvas");
  const callout = canvas.locator("textarea").last();
  await expect(canvas.locator("textarea").first()).toHaveValue("Q3 update");
  await expect(callout).toHaveValue("September");
  await expect(callout).toBeVisible();
  await expect(canvas.locator(".slide-shape")).toHaveCount(4);
  await beat(page, 600);

  await caption(page, "She selects only the callout.", 900);
  await pointAt(page, callout);
  await callout.click();
  await expect(callout.locator("..")).toHaveClass(/selected/);
  await beat(page, 500);

  await caption(
    page,
    "Insert, Animation, Fade in on click. Three clicks. No animation sidebar.",
    1100,
  );
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await beat(page, 700);
  await page.getByRole("menuitem", { name: "Animation", exact: true }).hover();
  await beat(page, 800);
  await page.getByRole("menuitem", { name: "Fade in on click" }).click();
  const marked = canvas.locator(".has-fade-on-click");
  await expect(marked).toHaveCount(1);
  await expect(marked.locator("textarea")).toHaveValue("September");
  await expect(marked.locator(".fade-on-click-mark")).toHaveText("On click");
  await expect(marked.locator("textarea")).toBeVisible();
  await beat(page, 400);

  await caption(
    page,
    "September is marked. The chart is not. She can still read the callout while she edits.",
    1800,
  );
  const tallest = canvas.locator(".slide-shape").nth(2);
  await pointAt(page, tallest);
  await tallest.click();
  await expect(tallest).not.toHaveClass(/has-fade-on-click/);
  await expect(canvas.locator(".has-fade-on-click")).toHaveCount(1);
  await beat(page, 800);

  await caption(page, "She starts the slideshow. The chart is there. September is not.", 1400);
  await page.getByRole("button", { name: "Slideshow", exact: true }).click();
  const show = page.locator(".presenter-overlay");
  const box = show.locator(".presenter-slide-box");
  await expect(show).toBeVisible();
  await expect(box.getByText("Q3 update", { exact: true })).toBeVisible();
  await expect(box.getByText("Revenue by month", { exact: true })).toBeVisible();
  await expect(box.getByText("Sep", { exact: true })).toBeVisible();
  await expect(box.getByText("September", { exact: true })).toBeHidden();
  await expect(show.getByText("Slide 1 of 2")).toBeVisible();
  await beat(page, 1200);

  await caption(page, "One click fades September in. The slide stays put.", 900);
  await pointAt(page, box, 0.5, 0.48);
  await page.mouse.down();
  await page.mouse.up();
  await expect(show.getByText("Slide 1 of 2")).toBeVisible();
  await expect(box.getByText("September", { exact: true })).toBeVisible();
  await expect(box.locator(".fade-on-click-enter")).toHaveCount(1);
  await expect(box.getByText("Revenue by month", { exact: true })).toBeVisible();
  await beat(page, 1400);

  await caption(page, "The next click moves on to the following slide.", 900);
  await pointAt(page, box, 0.5, 0.45);
  await page.mouse.down();
  await page.mouse.up();
  await expect(show.getByText("Slide 2 of 2")).toBeVisible();
  await expect(box.getByText("What changed", { exact: true })).toBeVisible();
  await expect(box.getByText("October held steady.", { exact: true })).toBeVisible();
  await beat(page, 1200);

  await page.keyboard.press("Escape");
  await expect(show).toHaveCount(0);
  await expect(page.locator(".save-status")).toContainText("Saved");
  await caption(page, "She goes back to her files. The deck saved on this computer.", 1400);
  await page.getByRole("button", { name: "Back to files" }).click();
  const row = page.getByRole("link", { name: /Q3 update/ });
  await expect(row).toBeVisible();
  await pointAt(page, row, 0.35);
  await caption(page, "She opens Q3 update again and presents. September still waits for the click.", 1600);
  await row.click();
  await expect(page.locator(".has-fade-on-click textarea")).toHaveValue("September");
  await page.getByRole("button", { name: "Slideshow", exact: true }).click();
  await expect(box.getByText("September", { exact: true })).toBeHidden();
  await expect(box.getByText("Q3 update", { exact: true })).toBeVisible();
  await beat(page, 900);
  await pointAt(page, box, 0.5, 0.48);
  await page.mouse.down();
  await page.mouse.up();
  await expect(box.getByText("September", { exact: true })).toBeVisible();
  await expect(show.getByText("Slide 1 of 2")).toBeVisible();
  await caption(page, "The same click fades September in. The slide has not moved.", 1800);
});
