import { expect, test } from "@playwright/test";

function deck() {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const slideId = crypto.randomUUID();
  return JSON.stringify({
    format: "suiteleaf",
    version: 1,
    id,
    title: "Theme check",
    createdAt: now,
    updatedAt: now,
    kind: "slide",
    content: {
      id,
      width: 960,
      height: 540,
      slideOrder: [slideId],
      slides: {
        [slideId]: {
          id: slideId,
          layout: "title-body",
          background: { color: "#ffffff" },
          elements: [
            {
              id: crypto.randomUUID(),
              type: "text",
              x: 80,
              y: 40,
              width: 700,
              height: 70,
              content: "Hello",
              fontSize: 40,
              bold: true,
              fontFamily: "Arial",
              color: "#111111",
              placeholder: "Click to add title",
            },
            {
              id: crypto.randomUUID(),
              type: "text",
              x: 80,
              y: 200,
              width: 700,
              height: 80,
              content: "A free box",
              fontSize: 18,
              fontFamily: "Georgia",
              color: "#333333",
            },
            {
              id: crypto.randomUUID(),
              type: "shape",
              shapeType: "roundRect",
              x: 80,
              y: 360,
              width: 140,
              height: 40,
              fill: "#cccccc",
              stroke: "#cccccc",
            },
          ],
        },
      },
    },
  });
}

async function family(page: import("@playwright/test").Page, content: string) {
  return page.locator(".slide-canvas").evaluate((root, content) => {
    const area = [...root.querySelectorAll("textarea")].find(
      (node) => (node as HTMLTextAreaElement).value === content,
    );
    return area?.parentElement ? getComputedStyle(area.parentElement).fontFamily : "";
  }, content);
}

test("a theme restyles free text, and reduced motion cuts transitions", async ({ page }) => {
  await page.addInitScript(() => {
    let current: Element | null = null;
    const change = (el: Element | null) => {
      current = el;
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
  await page.locator("input[type=file]").setInputFiles({
    name: "Theme check.slslides",
    mimeType: "application/json",
    buffer: Buffer.from(deck()),
  });
  await expect(page.getByLabel("File title")).toHaveValue("Theme check");

  await page.getByRole("button", { name: "Theme", exact: true }).click();
  await page.getByRole("button", { name: "Meadow", exact: true }).click();
  await expect(page.locator(".slide-canvas")).toHaveCSS("background-color", "rgb(13, 40, 24)");
  await expect.poll(() => family(page, "Hello")).toMatch(/Montserrat/);
  await expect.poll(() => family(page, "A free box")).toMatch(/Source Sans/);
  await expect(page.locator(".slide-shape")).toHaveCSS("background-color", "rgb(149, 213, 178)");

  await page.getByLabel("Heading font").selectOption("Georgia");
  await expect.poll(() => family(page, "Hello")).toMatch(/Georgia/);
  await expect.poll(() => family(page, "A free box")).toMatch(/Source Sans/);
  await page.getByLabel("Accent hex").fill("#2e7d32");
  await expect(page.locator(".slide-shape")).toHaveCSS("background-color", "rgb(46, 125, 50)");

  const box = page.locator(".slide-canvas textarea").nth(1);
  await box.click();
  await page.getByLabel("Font family").selectOption("Georgia");
  await expect(page.locator(".theme-override-bar")).toContainText("Overrides theme");
  await page.getByRole("button", { name: "Ink", exact: true }).click();
  await expect.poll(() => family(page, "A free box")).toMatch(/Georgia/);
  await expect.poll(() => family(page, "Hello")).toMatch(/Trebuchet/);
  await page.getByRole("button", { name: "Reset to theme" }).click();
  await expect.poll(() => family(page, "A free box")).toMatch(/Arial/);

  await page.keyboard.press("ControlOrMeta+M");
  await expect(page.locator(".thumbnail-row")).toHaveCount(2);
  await expect(page.locator(".slide-canvas")).toHaveCSS("background-color", "rgb(17, 24, 39)");
  await page.getByRole("button", { name: "Rectangle" }).click();
  await expect(page.locator(".slide-canvas .slide-shape")).toHaveCSS(
    "background-color",
    "rgb(129, 140, 248)",
  );

  await page.getByRole("button", { name: "Slide", exact: true }).click();
  await page.getByRole("menuitem", { name: "Transition", exact: true }).click();
  await page.getByRole("button", { name: "Fade", exact: true }).click();
  await expect(page.locator(".thumbnail-transition")).toHaveCount(2);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.locator(".presenter-overlay")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(150);
  await expect(page.locator(".presenter-slide-box")).not.toHaveClass(/deck-motion/);
});
