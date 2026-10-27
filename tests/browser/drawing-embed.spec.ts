import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">
  <rect x="10" y="10" width="80" height="80" fill="#1a73e8"/>
</svg>
`;
const PICKED = { name: "logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from(LOGO) };

/** The SVG text a picture on the page shows. */
const svgOf = (picture: Locator) =>
  picture.evaluate((img: HTMLImageElement) => {
    const binary = atob(img.src.slice(img.src.indexOf(",") + 1));
    return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  });

/** Double-click a picture, change its SVG in Drawing, and go back. */
async function redraw(page: Page, target: Locator, title: string) {
  await target.dblclick();
  const drawing = page.getByRole("dialog", { name: `Picture in ${title}` });
  await expect(drawing).toBeVisible();
  const source = drawing.getByLabel("SVG source");
  await expect(source).toHaveValue(LOGO);
  // The drawing covers the whole window, the file's own header included.
  const box = (await drawing.boundingBox())!;
  expect(box.width).toBe(page.viewportSize()!.width);
  expect(box.height).toBe(page.viewportSize()!.height);
  await source.fill(LOGO.replace('fill="#1a73e8"', 'fill="#d93025"'));
  await drawing.getByRole("button", { name: `Back to ${title}` }).click();
  await expect(drawing).toHaveCount(0);
}

async function noDrawingFiles(page: Page) {
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("button", { name: "Drawings", exact: true }).click();
  await expect(page.locator(".file-row")).toHaveCount(0);
}

test("an SVG picture on a slide opens in Drawing, and the slide takes the change on the way back", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: /^New presentation/ }).click();
  await page.locator('input[type="file"][accept*="image/svg+xml"]').setInputFiles(PICKED);
  const box = page.locator(".slide-canvas .slide-image").first();
  const picture = box.locator("img");
  await expect(picture).toBeVisible();
  await redraw(page, box, "Untitled presentation");
  await expect.poll(() => svgOf(picture)).toContain('fill="#d93025"');
  await expect(page.getByRole("status").filter({ hasText: /Saved|Unsaved/ })).toBeVisible();
  // The slide's own undo takes the change back, so the presentation recorded it.
  await page.locator(".slide-canvas").click({ position: { x: 5, y: 5 } });
  await page.getByRole("button", { name: "Undo (Cmd+Z)" }).click();
  await expect.poll(() => svgOf(picture)).toContain('fill="#1a73e8"');
  await noDrawingFiles(page);
});

test("an SVG picture in a document opens in Drawing, and the document takes the change on the way back", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: /^New document/ }).click();
  await page.locator(".document-content").click();
  await page.locator('input[type="file"][accept*=".svg"]').setInputFiles(PICKED);
  const picture = page.locator(".document-content img").first();
  await expect(picture).toBeVisible();
  await redraw(page, picture, "Untitled document");
  await expect.poll(() => svgOf(picture)).toContain('fill="#d93025"');
  await page.locator(".document-content").press("ControlOrMeta+z");
  await expect.poll(() => svgOf(picture)).toContain('fill="#1a73e8"');
  await noDrawingFiles(page);
});

test("an SVG file in a MARP deck opens in Drawing, and the deck keeps naming the same file", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: /^New MARP deck/ }).click();
  const markdown = page.getByLabel("Presentation markdown");
  await page.locator('input[type="file"][accept*="image/svg+xml"]').setInputFiles(PICKED);
  await expect(markdown).toHaveValue(/!\[[^\]]*\]\(media\/logo\.svg\)/);
  const before = await markdown.inputValue();
  const box = page.locator(".slide-canvas .slide-image").first();
  await box.dblclick();
  const drawing = page.getByRole("dialog", { name: "media/logo.svg in Untitled presentation" });
  await expect(drawing.getByLabel("SVG source")).toHaveValue(LOGO);
  await drawing.getByLabel("SVG source").fill(LOGO.replace('fill="#1a73e8"', 'fill="#d93025"'));
  await drawing.getByRole("button", { name: "Back to Untitled presentation" }).click();
  await expect(drawing).toHaveCount(0);
  await expect.poll(() => svgOf(box.locator("img"))).toContain('fill="#d93025"');
  expect(await markdown.inputValue()).toBe(before);
  await page.getByRole("button", { name: "Undo (Cmd+Z)" }).click();
  await expect.poll(() => svgOf(box.locator("img"))).toContain('fill="#1a73e8"');
});

const RED = LOGO.replace('fill="#1a73e8"', 'fill="#d93025"');

async function newDocumentWith(page: Page, copies: number) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: /^New document/ }).click();
  await page.locator(".document-content").click();
  for (let i = 0; i < copies; i++)
    await page.locator('input[type="file"][accept*=".svg"]').setInputFiles(PICKED);
  const pictures = page.locator(".document-content img");
  await expect(pictures).toHaveCount(copies);
  return pictures;
}

test("editing one of two copies of an SVG in a document changes only that copy, and only once Drawing is left", async ({
  page,
}) => {
  const pictures = await newDocumentWith(page, 2);
  await pictures.nth(1).dblclick();
  const drawing = page.getByRole("dialog", { name: "Picture in Untitled document" });
  // Edit on the canvas: select the square and nudge it right.
  await drawing.locator(".drawing-host").locator("rect").click();
  const canvas = drawing.getByRole("application", { name: "Drawing canvas" });
  for (let i = 0; i < 5; i++) await canvas.press("ArrowRight");
  await expect(drawing.getByLabel("SVG source")).toHaveValue(/<rect x="15" y="10"/);
  // The document is still as it was while the picture is open.
  expect(await svgOf(pictures.nth(0))).toBe(LOGO);
  expect(await svgOf(pictures.nth(1))).toBe(LOGO);
  const status = page.locator(".save-status");
  const unsaved = page.waitForFunction(() => document.querySelector(".save-status")?.textContent === "Unsaved changes");
  await drawing.getByRole("button", { name: "Back to Untitled document" }).click();
  await expect.poll(() => svgOf(pictures.nth(1))).toContain('<rect x="15" y="10"');
  expect(await svgOf(pictures.nth(0))).toBe(LOGO);
  // Going back is a change to the document, which it saves.
  await unsaved;
  await expect(status).toHaveText("Saved on this device");
  await page.reload();
  await expect(pictures).toHaveCount(2);
  await expect.poll(() => svgOf(pictures.nth(1))).toContain('<rect x="15" y="10"');
  expect(await svgOf(pictures.nth(0))).toBe(LOGO);
});

test("a document exported to Word carries an edited SVG picture as a PNG", async ({ page }) => {
  const pictures = await newDocumentWith(page, 1);
  await redraw(page, pictures.first(), "Untitled document");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Export DOCX", exact: true }).click();
  const zip = await JSZip.loadAsync(await readFile((await (await download).path())!));
  const media = Object.keys(zip.files).filter((name) => name.startsWith("word/media/") && !zip.files[name].dir);
  expect(media, media.join(", ")).toHaveLength(1);
  expect(media[0]).toMatch(/\.png$/);
  const png = await zip.file(media[0])!.async("uint8array");
  expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
});

test("keys pressed in Drawing change the drawing, not the slide underneath, and leaving unchanged adds no undo step", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: /^New presentation/ }).click();
  await page.locator('input[type="file"][accept*="image/svg+xml"]').setInputFiles(PICKED);
  const box = page.locator(".slide-canvas .slide-image");
  await expect(box).toHaveCount(1);
  // Double-clicking also leaves the picture selected on the slide.
  await box.dblclick();
  const drawing = page.getByRole("dialog", { name: "Picture in Untitled presentation" });
  const source = drawing.getByLabel("SVG source");
  const canvas = drawing.getByRole("application", { name: "Drawing canvas" });
  await drawing.locator(".drawing-host").locator("rect").click();
  await canvas.press("Delete");
  await expect(source).not.toHaveValue(/<rect/);
  await expect(box).toHaveCount(1);
  await canvas.press("ControlOrMeta+z");
  await expect(source).toHaveValue(LOGO);
  await expect(box).toHaveCount(1);
  await drawing.getByRole("button", { name: "Back to Untitled presentation" }).click();
  await expect(drawing).toHaveCount(0);
  expect(await svgOf(box.locator("img"))).toBe(LOGO);
  // The only step to undo is adding the picture.
  await page.getByRole("button", { name: "Undo (Cmd+Z)" }).click();
  await expect(box).toHaveCount(0);
});

test("a slide picture keeps its width and takes the drawing's new shape", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: /^New presentation/ }).click();
  await page.locator('input[type="file"][accept*="image/svg+xml"]').setInputFiles(PICKED);
  const box = page.locator(".slide-canvas .slide-image");
  const before = (await box.boundingBox())!;
  await box.dblclick();
  const drawing = page.getByRole("dialog", { name: "Picture in Untitled presentation" });
  await drawing.getByLabel("SVG source").fill(LOGO.replace('height="100" viewBox="0 0 200 100"', 'height="400" viewBox="0 0 200 400"'));
  await drawing.getByRole("button", { name: "Back to Untitled presentation" }).click();
  await expect.poll(async () => (await box.boundingBox())!.height).toBeGreaterThan(before.height * 1.5);
  const after = (await box.boundingBox())!;
  expect(Math.abs(after.width - before.width)).toBeLessThan(1);
  expect(after.height / after.width).toBeCloseTo(2, 1);
});

test("an SVG file a MARP deck shows twice changes in both places", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: /^New MARP deck/ }).click();
  const markdown = page.getByLabel("Presentation markdown");
  const input = page.locator('input[type="file"][accept*="image/svg+xml"]');
  await input.setInputFiles(PICKED);
  await expect(markdown).toHaveValue(/media\/logo\.svg/);
  await input.setInputFiles(PICKED);
  await expect.poll(async () => (await markdown.inputValue()).match(/\(media\/logo\.svg\)/g)?.length).toBe(2);
  const boxes = page.locator(".slide-canvas .slide-image");
  await expect(boxes).toHaveCount(2);
  await boxes.first().dblclick();
  const drawing = page.getByRole("dialog", { name: "media/logo.svg in Untitled presentation" });
  await drawing.getByLabel("SVG source").fill(RED);
  await drawing.getByRole("button", { name: "Back to Untitled presentation" }).click();
  for (const i of [0, 1]) await expect.poll(() => svgOf(boxes.nth(i).locator("img"))).toBe(RED);
  expect((await markdown.inputValue()).match(/\(media\/logo\.svg\)/g)?.length).toBe(2);
});
