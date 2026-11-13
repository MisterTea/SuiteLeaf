import { expect, test } from "@playwright/test";

test("animation ribbon and pane leave the slide visible and preview the painted object", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^New presentation/ }).click();
  await page.getByRole("button", { name: "Animations", exact: true }).click();
  const ribbon = page.getByRole("region", { name: "Animations ribbon" });
  const pane = page.getByRole("complementary", { name: "Animation pane" });
  const box = page.locator(".slide-canvas [data-element-id]").first();
  await box.click();
  await ribbon.getByRole("button", { name: "Fly in", exact: true }).click();
  await page.getByLabel("Animation duration").fill("2");
  await ribbon.getByRole("button", { name: "Preview", exact: true }).click();
  await expect
    .poll(() => box.evaluate((el) => el.getAnimations().length))
    .toBeGreaterThan(0);
  await expect
    .poll(() => box.evaluate((el) => Number(getComputedStyle(el).opacity)))
    .toBeGreaterThan(0.1);
  await ribbon
    .getByRole("button", { name: "Stop preview", exact: true })
    .click();
  await expect
    .poll(() => box.evaluate((el) => el.getAnimations().length))
    .toBe(0);
  await expect(box).toHaveCSS("opacity", "1");
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 950 });
    await expect(
      ribbon.getByRole("button", { name: "Zoom", exact: true }),
    ).toBeInViewport();
    await expect(pane).toBeInViewport();
    const canvasRect = await page.locator(".slide-canvas").boundingBox();
    const paneRect = await pane.boundingBox();
    const ribbonRect = await ribbon.boundingBox();
    expect(canvasRect!.width).toBeGreaterThan(250);
    expect(canvasRect!.y).toBeGreaterThanOrEqual(
      ribbonRect!.y + ribbonRect!.height,
    );
    expect(canvasRect!.x + canvasRect!.width).toBeLessThanOrEqual(
      paneRect!.x + 1,
    );
  }
  await page.screenshot({ path: "test-results/slide-animations.png" });
});

test("slideshow plays entrance effects using the ribbon's with/after timing", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^New presentation/ }).click();
  await page.getByRole("button", { name: "Animations", exact: true }).click();
  const ribbon = page.getByRole("region", { name: "Animations ribbon" });
  const boxes = page.locator(".slide-canvas [data-element-id]");
  await boxes.nth(0).click();
  await ribbon.getByRole("button", { name: "Fade", exact: true }).click();
  await page.getByLabel("Animation duration").fill("1.2");
  await boxes.nth(1).click();
  await ribbon.getByRole("button", { name: "Wipe", exact: true }).click();
  await page.getByLabel("Animation start").selectOption("after");
  await page.getByLabel("Animation duration").fill("0.8");
  await page.getByRole("button", { name: "Slideshow", exact: true }).click();
  const show = page.locator(".presenter-slide-box");
  await expect(show.locator("[data-fade='hidden']")).toHaveCount(2);
  await show.click();
  await expect(show.locator(".fade-on-click-enter")).toHaveCSS(
    "animation-duration",
    "1.2s",
  );
  await expect(show.locator(".wipe-on-click-enter")).toHaveCSS(
    "animation-delay",
    "1.2s",
  );
  await expect(show.locator(".wipe-on-click-enter")).toHaveCSS(
    "animation-duration",
    "0.8s",
  );
  await expect
    .poll(() =>
      show
        .locator(".wipe-on-click-enter")
        .evaluate((el) => Number(getComputedStyle(el).opacity)),
    )
    .toBe(1);
  await page.keyboard.press("Escape");
});

test("Appear preview visibly resets the slide before revealing each object", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^New presentation/ }).click();
  await page.getByRole("button", { name: "Animations", exact: true }).click();
  const ribbon = page.getByRole("region", { name: "Animations ribbon" });
  const boxes = page.locator(".slide-canvas [data-element-id]");
  for (const index of [0, 1]) {
    await boxes.nth(index).click();
    await ribbon.getByRole("button", { name: "Appear", exact: true }).click();
  }
  await ribbon.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(boxes.nth(0)).toHaveCSS("opacity", "0");
  await expect(boxes.nth(1)).toHaveCSS("opacity", "0");
  await expect(boxes.nth(0)).toHaveCSS("opacity", "1");
  await expect(boxes.nth(1)).toHaveCSS("opacity", "0");
  await expect(boxes.nth(1)).toHaveCSS("opacity", "1");
  await ribbon
    .getByRole("button", { name: "Stop preview", exact: true })
    .click();
  await expect(boxes.nth(0)).toHaveCSS("opacity", "1");
  await expect(boxes.nth(1)).toHaveCSS("opacity", "1");
  // A row preview also resets an already-visible Appear object.
  await page
    .getByRole("complementary", { name: "Animation pane" })
    .getByRole("button", { name: /^Preview / })
    .first()
    .click();
  await expect(boxes.nth(0)).toHaveCSS("opacity", "0");
  await expect(boxes.nth(0)).toHaveCSS("opacity", "1");
});

test("one picture preview hides and reveals its image, fill and outline together", async ({
  page,
}) => {
  const slideId = "layered-slide";
  const now = new Date().toISOString();
  const file = {
    format: "suiteleaf",
    version: 1,
    id: crypto.randomUUID(),
    kind: "slide",
    title: "Layered picture",
    createdAt: now,
    updatedAt: now,
    content: {
      id: crypto.randomUUID(),
      width: 960,
      height: 540,
      slideOrder: [slideId],
      slides: { [slideId]: { id: slideId, elements: [] as unknown[] } },
    },
  };
  const base = {
    x: 100,
    y: 100,
    width: 400,
    height: 200,
    sourceShapeId: "5",
    animation: "appear-on-click" as const,
    animationOrder: 1,
  };
  const src =
    "data:image/svg+xml;base64," +
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="tomato"/></svg>',
    ).toString("base64");
  file.content.slides[slideId].elements = [
    { ...base, id: "fill", type: "shape", shapeType: "rect", fill: "#ffffff" },
    { ...base, id: "picture", type: "image", src, alt: "Slide image" },
    {
      ...base,
      id: "outline",
      type: "shape",
      shapeType: "rect",
      fill: "transparent",
      stroke: "#000000",
      strokeWidth: 2,
    },
  ];
  await page.goto("/");
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({
    name: "Layered picture.slslides",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(file)),
  });
  await page.getByRole("button", { name: "Animations", exact: true }).click();
  const layers = page.locator(".slide-canvas [data-element-id]");
  await page
    .getByRole("button", { name: "Preview Picture 1", exact: true })
    .click();
  await expect
    .poll(() =>
      layers.evaluateAll((nodes) =>
        nodes.map((node) => getComputedStyle(node).opacity),
      ),
    )
    .toEqual(["0", "0", "0"]);
  await expect
    .poll(() =>
      layers.evaluateAll((nodes) =>
        nodes.map((node) => getComputedStyle(node).opacity),
      ),
    )
    .toEqual(["1", "1", "1"]);
  await page.getByRole("button", { name: "Stop preview", exact: true }).click();
  await expect
    .poll(() =>
      layers.evaluateAll((nodes) =>
        nodes.every((node) => node.getAnimations().length === 0),
      ),
    )
    .toBe(true);
});

test("long bullet labels keep their opening words visible and truncate at the right edge", async ({
  page,
}) => {
  const now = new Date().toISOString();
  const lines = [
    "Do readings and attend lectures! That's your primary source for the material",
    "Do all assignments on time — that's a big chunk of the grade",
    "Prepare for the exams — historically these have been difficult for some",
  ];
  const file = {
    format: "suiteleaf",
    version: 1,
    id: crypto.randomUUID(),
    kind: "slide",
    title: "Bullet animations",
    createdAt: now,
    updatedAt: now,
    content: {
      id: crypto.randomUUID(),
      width: 960,
      height: 540,
      slideOrder: ["a"],
      slides: {
        a: {
          id: "a",
          elements: [
            {
              id: "bullets",
              type: "text",
              x: 50,
              y: 50,
              width: 800,
              height: 300,
              content: lines.join("\n"),
              paragraphBuilds: lines.map((_, index) => ({
                start: index,
                end: index,
                order: index + 1,
              })),
            },
          ],
        },
      },
    },
  };
  await page.goto("/");
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({
    name: "Bullets.slslides",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(file)),
  });
  await page.getByRole("button", { name: "Animations", exact: true }).click();
  const labels = page.locator(".animation-row-label");
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 950 });
    for (const label of await labels.all()) {
      await expect(label).toBeInViewport();
      const layout = await label.evaluate((node) => {
        const bounds = node.getBoundingClientRect();
        const button = node.closest("button")!.getBoundingClientRect();
        const range = document.createRange();
        range.setStart(node.firstChild!, 0);
        range.setEnd(node.firstChild!, 10);
        const start = range.getBoundingClientRect();
        return {
          left: bounds.left,
          right: bounds.right,
          buttonLeft: button.left,
          buttonRight: button.right,
          startLeft: start.left,
          startRight: start.right,
          overflow: node.scrollWidth > node.clientWidth,
          ellipsis: getComputedStyle(node).textOverflow,
          justify: getComputedStyle(node.closest("button")!).justifyContent,
        };
      });
      expect(layout.justify).toBe("flex-start");
      expect(layout.left).toBeGreaterThanOrEqual(layout.buttonLeft);
      expect(layout.right).toBeLessThanOrEqual(layout.buttonRight + 1);
      expect(layout.startLeft).toBeGreaterThanOrEqual(layout.left);
      expect(layout.startRight).toBeLessThan(layout.right);
      expect(layout.overflow).toBe(true);
      expect(layout.ellipsis).toBe("ellipsis");
    }
  }
});

test("highlighting a bullet before choosing an entrance preserves selection and animates just that bullet", async ({
  page,
}) => {
  const now = new Date().toISOString();
  const lines = ["• First bullet", "• Second bullet", "• Third bullet"];
  const file = {
    format: "suiteleaf",
    version: 1,
    id: crypto.randomUUID(),
    kind: "slide",
    title: "Selected bullets",
    createdAt: now,
    updatedAt: now,
    content: {
      id: crypto.randomUUID(),
      width: 960,
      height: 540,
      slideOrder: ["a"],
      slides: {
        a: {
          id: "a",
          elements: [
            {
              id: "bullets",
              type: "text",
              x: 50,
              y: 50,
              width: 800,
              height: 300,
              fontSize: 28,
              content: lines.join("\n"),
              runs: lines.flatMap((text, index) => [
                ...(index ? [{ text: "\n", paragraphBreak: true }] : []),
                { text },
              ]),
            },
          ],
        },
      },
    },
  };
  await page.goto("/");
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({
    name: "Selected bullets.slslides",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(file)),
  });
  await page.getByRole("button", { name: "Animations", exact: true }).click();
  await page.locator('.slide-canvas [data-element-id="bullets"]').dblclick();
  const editor = page.locator(
    '.slide-canvas .element-editor[contenteditable="true"]',
  );
  await expect(editor).toBeFocused();
  const target = await editor.evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !node.textContent?.includes("Second bullet"))
      node = walker.nextNode();
    const start = node!.textContent!.indexOf("Second bullet");
    const range = document.createRange();
    range.setStart(node!, start);
    range.setEnd(node!, start + "Second bullet".length);
    const rect = range.getBoundingClientRect();
    return {
      x: rect.left + 1,
      end: rect.right - 1,
      y: rect.top + rect.height / 2,
    };
  });
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await page.mouse.move(target.end, target.y, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toContain("Second");
  await page
    .getByRole("region", { name: "Animations ribbon" })
    .getByRole("button", { name: "Fly in", exact: true })
    .click();
  await page.getByRole("button", { name: "Slideshow", exact: true }).click();
  const paragraphs = page.locator(
    '.presenter-slide-box [data-element-id="bullets"] .slide-para',
  );
  await expect(paragraphs).toHaveCount(3);
  await expect(paragraphs.nth(0)).toBeVisible();
  await expect(paragraphs.nth(1)).toBeHidden();
  await expect(paragraphs.nth(2)).toBeVisible();
  await page.locator(".presenter-slide-box").click();
  await expect(paragraphs.nth(1)).toHaveCSS(
    "animation-name",
    "fly-in-on-click",
  );
  await expect(paragraphs.nth(1)).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator(".slide-canvas").click({ position: { x: 5, y: 5 } });
  await page.locator('.slide-canvas [data-element-id="bullets"]').click();
  await page
    .getByRole("region", { name: "Animations ribbon" })
    .getByRole("button", { name: "Zoom", exact: true })
    .click();
  await page.getByRole("button", { name: "Slideshow", exact: true }).click();
  const whole = page.locator(
    '.presenter-slide-box [data-element-id="bullets"]',
  );
  await expect(whole).toBeHidden();
  await page.locator(".presenter-slide-box").click();
  await expect(whole).toHaveClass(/zoom-on-click-enter/);
  await expect(whole).toBeVisible();
});
