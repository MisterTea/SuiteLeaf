import { expect, test, type Page } from "@playwright/test";

const PICTURE = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <rect x="40" y="40" width="120" height="80" fill="#e8f0fe" stroke="#1a73e8"/>
  <circle cx="300" cy="200" r="40" fill="#fef7e0"/>
</svg>
`;

async function openDrawing(page: Page, name: string, text: string) {
  await page.goto("/");
  await page
    .locator('input[type="file"]:not([webkitdirectory])')
    .first()
    .setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(text) });
  const canvas = page.getByRole("application", { name: "Drawing canvas" });
  await canvas.waitFor();
  return canvas;
}

/** A shape drawn inside the canvas's shadow root, found by its tag. */
const shape = (page: Page, selector: string) => page.locator(".drawing-host").locator(selector);

test("shows the drawing on the left and its source on the right, and the border between them resizes both", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDrawing(page, "boxes.svg", PICTURE);
  const left = page.locator(".drawing-canvas-pane");
  const right = page.locator(".drawing-source-pane");
  const source = page.getByLabel("SVG source");
  await expect(source).toHaveValue(PICTURE);
  await expect(shape(page, "rect")).toBeVisible();
  const before = { left: (await left.boundingBox())!, right: (await right.boundingBox())! };
  const drawn = (await shape(page, "rect").boundingBox())!;
  expect(before.left.x + before.left.width).toBeLessThanOrEqual(before.right.x + 1);
  expect(Math.abs(before.left.width - before.right.width)).toBeLessThan(4);
  expect(before.right.x + before.right.width).toBeLessThanOrEqual(1440);

  const handle = page.getByRole("separator", { name: "Resize the drawing and source panes" });
  const bar = (await handle.boundingBox())!;
  await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(bar.x + bar.width / 2 + 200, bar.y + bar.height / 2, { steps: 5 });
  await page.mouse.up();
  const after = { left: (await left.boundingBox())!, right: (await right.boundingBox())! };
  expect(after.left.width - before.left.width).toBeGreaterThan(180);
  expect(before.right.width - after.right.width).toBeGreaterThan(180);
  // The picture grows to fit the wider pane.
  await expect.poll(async () => (await shape(page, "rect").boundingBox())!.width).toBeGreaterThan(drawn.width + 10);
});

test("dragging a shape moves it in the source, and editing the source moves it on the canvas", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDrawing(page, "boxes.svg", PICTURE);
  const source = page.getByLabel("SVG source");
  const rect = shape(page, "rect");
  const box = (await rect.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps: 6 });
  await page.mouse.up();
  await expect(source).toHaveValue(/<rect x="(\d+(\.\d+)?)" y="(\d+(\.\d+)?)" width="120"/);
  const moved = /<rect x="([\d.]+)" y="([\d.]+)"/.exec(await source.inputValue())!;
  expect(Number(moved[1])).toBeGreaterThan(60);
  expect(Number(moved[2])).toBeGreaterThan(50);
  // Only the rectangle's start tag changed.
  expect((await source.inputValue()).replace(/<rect[^>]*>/, "")).toBe(PICTURE.replace(/<rect[^>]*>/, ""));
  await expect(page.locator(".drawing-selection")).toBeVisible();
  await expect.poll(() => source.evaluate((area: HTMLTextAreaElement) => area.selectionStart)).toBe(
    PICTURE.indexOf("<rect"),
  );

  const circle = shape(page, "circle");
  const was = (await circle.boundingBox())!;
  await source.fill(PICTURE.replace('cx="300"', 'cx="200"'));
  await source.blur();
  await expect.poll(async () => (await circle.boundingBox())!.x).toBeLessThan(was.x - 20);
});

test("a Mermaid flowchart's nodes can be renamed on the canvas, and clicking one finds it in the source", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const chart = "flowchart LR\n    A[Start] --> B[Finish]\n    B --> C\n";
  await openDrawing(page, "flow.mmd", chart);
  const source = page.getByLabel("Mermaid source");
  const start = shape(page, "g.node").filter({ hasText: "Start" });
  await expect(start).toBeVisible();
  await shape(page, "g.node").filter({ hasText: "Finish" }).click();
  await expect.poll(() => source.evaluate((area: HTMLTextAreaElement) => area.selectionStart)).toBe(
    chart.indexOf("A[Start]"),
  );
  await start.dblclick();
  const label = page.getByRole("textbox", { name: "Label" });
  await expect(label).toHaveValue("Start");
  await label.fill("Begin here");
  await label.press("Enter");
  await expect(source).toHaveValue("flowchart LR\n    A[Begin here] --> B[Finish]\n    B --> C\n");
  await expect(shape(page, "g.node").filter({ hasText: "Begin here" })).toBeVisible();
});

test("a Graphviz graph gains a connected node from the toolbar", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDrawing(page, "pipeline.gv", "digraph {\n    a -> b;\n}\n");
  const source = page.getByLabel("Graphviz source");
  await expect(shape(page, "g.node")).toHaveCount(2);
  await page.getByRole("button", { name: "Add node" }).click();
  const label = page.getByRole("textbox", { name: "Label" });
  await label.fill("Deploy");
  await label.press("Enter");
  await expect(source).toHaveValue('digraph {\n    a -> b;\n    node1 [label="Deploy"];\n}\n');
  await page.getByRole("button", { name: "Connect two nodes" }).click();
  await shape(page, "g.node").filter({ hasText: "b" }).first().click();
  await shape(page, "g.node").filter({ hasText: "Deploy" }).click();
  await expect(source).toHaveValue('digraph {\n    a -> b;\n    node1 [label="Deploy"];\n    b -> node1;\n}\n');
  await expect(shape(page, "g.edge")).toHaveCount(2);
});
