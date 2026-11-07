import { expect, test } from "@playwright/test";
import { createFile, serializeFile } from "../../packages/core/src/native-file";

for (const viewport of [
  { width: 854, height: 320 },
  { width: 390, height: 844 },
  { width: 1280, height: 720 },
]) {
  test(`file conflicts remain readable and scrollable at ${viewport.width}x${viewport.height}`, async ({
    page,
    isMobile,
  }) => {
    await page.setViewportSize(viewport);
    const file = createFile("slide", "Landscape slides");
    const name = "Landscape slides.slslides";
    let conflict = false;
    const item = () => ({
      id: "layout-slides",
      name,
      kind: "file",
      ownerId: "u1",
      role: "owner",
      mime: "application/vnd.suiteleaf.slides+json",
      parentId: null,
      trashed: false,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      size: 100,
      headVersionId: conflict ? "v2" : "v1",
    });
    await page.addInitScript(() =>
      localStorage.setItem(
        "suiteleaf:node-session",
        JSON.stringify({
          url: location.origin,
          token: "layout-token",
          user: { id: "u1", name: "Ann" },
        }),
      ),
    );
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      const method = route.request().method();
      if (path.endsWith("/content")) {
        if (method === "PUT") {
          conflict = true;
          return route.fulfill({ status: 409, json: { item: item() } });
        }
        return route.fulfill({
          body: serializeFile(file),
          headers: { etag: '"v1"' },
        });
      }
      if (path === "/api/drive/items" && method === "POST") {
        return route.fulfill({
          status: 503,
          json: {
            error:
              "The connection was interrupted while saving a copy. Your presentation changes remain on this device. Please try again when SuiteDrive is available.",
          },
        });
      }
      const body =
        path === "/api/node/info"
          ? { name: "SuiteLeaf node", mode: "cluster", auth: { enabled: true } }
          : path === "/api/auth/get-session"
            ? { session: {}, user: { id: "u1", name: "Ann" } }
            : path === "/api/drive/items"
              ? { items: [item()] }
              : path === "/api/drive/items/layout-slides"
                ? item()
                : {
                    items: [],
                    folders: [],
                    comments: [],
                    notices: [],
                    people: [],
                  };
      return route.fulfill({ json: body });
    });
    await page.goto("/");
    await page.getByRole("button", { name, exact: true }).click();
    const rectangle = page.getByRole("button", {
      name: "Rectangle",
      exact: true,
    });
    await rectangle.scrollIntoViewIfNeeded();
    await rectangle.click();
    const notices = page.getByRole("region", { name: "File notifications" });
    const explanation = notices.locator(".drive-conflict-text");
    await expect(explanation).toBeVisible();
    const bounds = (await explanation.boundingBox())!;
    expect(bounds.width).toBeGreaterThan(viewport.width * 0.65);
    const copy = notices.getByRole("button", {
      name: "Save as copy",
      exact: true,
    });
    await copy.scrollIntoViewIfNeeded();
    await copy.click();
    await expect(notices).toContainText(
      "The connection was interrupted while saving a copy.",
    );
    await expect(explanation).toBeVisible();
    if (isMobile && viewport.height === 320) {
      await notices.evaluate((node) => {
        node.scrollTop = 0;
      });
      const area = (await notices.boundingBox())!;
      const start = {
        x: area.x + area.width / 2,
        y: area.y + area.height - 12,
      };
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [start],
      });
      for (let step = 1; step <= 6; step++) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: start.x, y: start.y - step * 15 }],
        });
        await page.waitForTimeout(25);
      }
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await expect
        .poll(() => notices.evaluate((node) => node.scrollTop))
        .toBeGreaterThan(10);
      await cdp.detach();
    }
    const reload = notices.getByRole("button", {
      name: "Discard local changes and reload",
      exact: true,
    });
    await reload.scrollIntoViewIfNeeded();
    await expect(reload).toBeInViewport();
    const button = (await reload.boundingBox())!;
    expect(button.x).toBeGreaterThanOrEqual(0);
    expect(button.x + button.width).toBeLessThanOrEqual(viewport.width);
    if (viewport.height === 320) {
      const scrolling = await notices.evaluate((node) => ({
        top: node.scrollTop,
        height: node.clientHeight,
        content: node.scrollHeight,
      }));
      expect(scrolling.content).toBeGreaterThan(scrolling.height);
      expect(scrolling.top).toBeGreaterThan(0);
      await page.screenshot({
        path: "test-results/landscape-scrollable-error.png",
      });
    }
  });
}
