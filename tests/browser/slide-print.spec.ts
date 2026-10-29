import { expect, test } from "@playwright/test";
import { createFile, serializeFile } from "../../packages/core/src";

test("prints all slide canvases as separate full-size PDF pages", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "PDF output requires Chromium");
  const file = createFile("slide", "Print the whole deck");
  if (file.kind !== "slide") throw new Error("Expected slides");
  const template = file.content.slides[file.content.slideOrder[0]];
  const slides = [0, 1, 2].map((index) => ({
    ...template,
    id: `slide-${index}`,
    title: `Page ${index + 1}`,
    elements: [
      {
        id: `text-${index}`,
        type: "text" as const,
        x: 40,
        y: 40,
        width: 700,
        height: 80,
        fontSize: 32,
        content: `Page ${index + 1}`,
      },
    ],
  }));
  file.content.slideOrder = slides.map((slide) => slide.id);
  file.content.slides = Object.fromEntries(
    slides.map((slide) => [slide.id, slide]),
  );
  await page.goto("/");
  await page
    .locator('input[type="file"]:not([webkitdirectory])')
    .first()
    .setInputFiles({
      name: "print.slslides",
      mimeType: "application/json",
      buffer: Buffer.from(serializeFile(file)),
    });
  await page.locator(".slide-canvas").waitFor();
  await page.getByRole("option", { name: /^Slide 2:/ }).click();
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await page.emulateMedia({ media: "print" });
  const pages = page.locator(".slides-print-page");
  await expect(pages).toHaveCount(3);
  await expect(page.locator(".workspace-header")).toBeHidden();
  const boxes = await pages.evaluateAll((nodes) =>
    nodes.map((node) => {
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }),
  );
  expect(
    boxes.every(
      (box) => box.width === 1280 && box.height === 720 && box.x === 0,
    ),
  ).toBe(true);
  expect(boxes.map((box) => box.y)).toEqual([0, 720, 1440]);
  const pdf = await page.pdf({
    preferCSSPageSize: true,
    printBackground: true,
  });
  expect(
    (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length,
  ).toBe(3);
  await page.emulateMedia({ media: "screen" });
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await expect(page.locator(".thumbnail-row.active")).toHaveAttribute(
    "data-slide-id",
    "slide-1",
  );
  await expect(page.locator(".slides-print-deck")).toHaveCount(0);
});

test("prints painted Marp diagrams and charts after their runtimes finish", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "PDF output requires Chromium");
  await page.goto("/");
  await page
    .locator('input[type="file"]:not([webkitdirectory])')
    .first()
    .setInputFiles({
      name: "painted.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(`---
marp: true
---
# Diagram
<div class="mermaid">flowchart LR
A[Input] --> B[Output]</div>

---
# Chart
<canvas id="bars" width="700" height="350"></canvas>
<script>new Chart(document.getElementById('bars'), {type:'bar',data:{labels:['A','B'],datasets:[{data:[2,5],backgroundColor:'#00693e'}]},options:{animation:false,responsive:false}})</script>

---
# Tall table
<table style="font-size:80px">${Array.from({ length: 9 }, (_, i) => `<tr><td>Row ${i}</td><td>Value</td></tr>`).join("")}</table>
`),
    });
  await page.locator(".slide-canvas").first().waitFor();
  // The editor fits the imported deck to its slides first, which changes what prints.
  await expect(page.locator(".slide-canvas").first()).not.toHaveAttribute("aria-busy", "true");
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await page.emulateMedia({ media: "print" });
  await page.waitForFunction(() => {
    const frames = [
      ...document.querySelectorAll<HTMLIFrameElement>(
        ".marp-print-deck iframe",
      ),
    ];
    return (
      frames.length === 3 &&
      frames.every((frame) => frame.dataset.loaded === "true")
    );
  });
  const painted = await page
    .locator(".marp-print-deck iframe")
    .evaluateAll((frames) =>
      frames.map((frame) => {
        const f = frame as HTMLIFrameElement;
        const svg = f.contentDocument!.querySelector(".mermaid svg");
        const image = f.contentDocument!.querySelector(
          "canvas + img, img[src^='data:image/png']",
        ) as HTMLImageElement | null;
        const table = f.contentDocument!.querySelector("table");
        const section = table?.closest("section");
        return {
          tableOverflow:
            table && section
              ? table.getBoundingClientRect().bottom -
                section.getBoundingClientRect().bottom
              : 0,
          error: f.dataset.renderError,
          diagramWidth: svg?.getBoundingClientRect().width ?? 0,
          nodes: svg?.querySelectorAll(".node").length ?? 0,
          imageWidth: image?.naturalWidth ?? 0,
          imageHeight: image?.naturalHeight ?? 0,
        };
      }),
    );
  expect(painted.every((item) => !item.error)).toBe(true);
  expect(painted[0].diagramWidth).toBeGreaterThan(100);
  expect(painted[0].nodes).toBe(2);
  expect(painted[1].imageWidth).toBe(700);
  expect(painted[1].imageHeight).toBe(350);
  expect(painted[2].tableOverflow).toBeLessThanOrEqual(1);
  const pdf = await page.pdf({
    preferCSSPageSize: true,
    printBackground: true,
  });
  expect(
    (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length,
  ).toBe(3);
});
