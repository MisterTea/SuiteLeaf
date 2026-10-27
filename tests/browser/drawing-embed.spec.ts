import { expect, test, type Locator, type Page } from "@playwright/test";

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
