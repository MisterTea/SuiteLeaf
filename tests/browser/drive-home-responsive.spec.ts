import { expect, test } from "@playwright/test";

for (const width of [320, 390, 700, 1024]) {
  test(`SuiteDrive header scrolls and controls fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await page.addInitScript(() => {
      localStorage.setItem("suiteleaf:node-session", JSON.stringify({
        url: location.origin,
        token: "layout-token",
        user: { id: "u1", name: "Ann", role: "admin" },
      }));
    });
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      const body = path === "/api/node/info"
        ? { name: "SuiteLeaf node", mode: "cluster", auth: { enabled: true } }
        : path === "/api/auth/get-session"
          ? { session: {}, user: { id: "u1", name: "Ann", role: "admin" } }
          : { items: [], folders: [], notices: [] };
      return route.fulfill({ json: body });
    });
    await page.goto("/");
    const note = page.locator(".cluster-note");
    await expect(note).toContainText("Files are saved to SuiteDrive");
    await expect(note).toBeInViewport();
    const initialTop = (await note.boundingBox())!.y;
    await page.evaluate(() => window.scrollTo(0, 250));
    const scrolled = await page.evaluate(() => window.scrollY);
    expect(scrolled).toBeGreaterThan(100);
    expect((await note.boundingBox())!.y).toBeCloseTo(initialTop - scrolled, 0);

    const toolbar = page.locator(".drive-toolbar");
    await toolbar.scrollIntoViewIfNeeded();
    const bounds = (await toolbar.boundingBox())!;
    const buttons = toolbar.locator("button");
    await expect(buttons).toHaveCount(4);
    const rectangles = [];
    for (const button of await buttons.all()) {
      await expect(button).toBeInViewport();
      const rect = (await button.boundingBox())!;
      expect(rect.x).toBeGreaterThanOrEqual(bounds.x - 1);
      expect(rect.x + rect.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
      rectangles.push(rect);
    }
    for (let i = 0; i < rectangles.length; i++) {
      for (let j = i + 1; j < rectangles.length; j++) {
        const a = rectangles[i]!;
        const b = rectangles[j]!;
        const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1
          && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1;
        expect(overlap).toBe(false);
      }
    }
    if (width <= 390) expect(new Set(rectangles.map((rect) => Math.round(rect.y))).size).toBeGreaterThan(1);
    if (width === 390) await page.screenshot({ path: "test-results/suitedrive-mobile-wrapped.png" });
  });
}
