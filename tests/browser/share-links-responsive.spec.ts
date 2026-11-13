import { expect, test } from "@playwright/test";
import { createFile, serializeFile } from "../../packages/core/src/native-file";

test("an anonymous public presentation paints its canvas inside the viewer", async ({
  page,
}) => {
  const file = createFile("slide", "Public slides");
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/node/info")
      return route.fulfill({
        json: {
          name: "SuiteLeaf node",
          mode: "cluster",
          auth: { enabled: true },
        },
      });
    if (path === "/api/public/files/public-token")
      return route.fulfill({ body: serializeFile(file) });
    return route.fulfill({ status: 401, json: { error: "Sign in required" } });
  });
  await page.goto("/#/public/public-token");
  const canvas = page.locator(".slides-canvas-stage");
  await expect(canvas).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();
  await expect(canvas).toBeInViewport();
  const bounds = (await canvas.boundingBox())!;
  expect(bounds.width).toBeGreaterThan(100);
  expect(bounds.height).toBeGreaterThan(100);
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(
    page.viewportSize()!.width + 1,
  );
  expect(
    await page.evaluate(() => localStorage.getItem("suiteleaf:node-session")),
  ).toBeNull();
});

for (const viewport of [
  { width: 320, height: 568 },
  { width: 854, height: 320 },
]) {
  test(`sharing actions fit and remain reachable at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const file = createFile("slide", "Shared presentation");
    const item = {
      id: "server-id",
      name: "Shared presentation.slslides",
      kind: "file",
      ownerId: "owner",
      role: "owner",
      parentId: null,
      trashed: false,
      headVersionId: "v1",
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      size: 100,
    };
    await page.addInitScript(() =>
      localStorage.setItem(
        "suiteleaf:node-session",
        JSON.stringify({
          url: location.origin,
          token: "test-token",
          user: { id: "owner", name: "Owner" },
        }),
      ),
    );
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/content"))
        return route.fulfill({
          body: serializeFile(file),
          headers: { etag: '"v1"' },
        });
      const json =
        path === "/api/node/info"
          ? { name: "SuiteLeaf node", mode: "cluster", auth: { enabled: true } }
          : path === "/api/auth/get-session"
            ? { session: {}, user: { id: "owner", name: "Owner" } }
            : path === "/api/drive/items/server-id"
              ? item
              : path.endsWith("/access")
                ? {
                    yourRole: "owner",
                    parent: null,
                    grants: [
                      {
                        principalId: "owner",
                        principalType: "owner",
                        name: "Owner",
                        role: "owner",
                        inheritedFrom: null,
                      },
                    ],
                  }
                : path.endsWith("/public-link")
                  ? { allowed: true, token: "public-token" }
                  : {
                      items: [],
                      comments: [],
                      notices: [],
                      people: [],
                      folders: [],
                    };
      return route.fulfill({ json });
    });
    await page.goto("/#/shared/server-id");
    const share = page.getByRole("button", { name: "Share", exact: true });
    await share.click();
    const pane = page.getByRole("dialog");
    const actions = pane.locator(".share-link-actions");
    await expect(actions.getByRole("button")).toHaveCount(2);
    const rectangles = [];
    for (const button of await actions.getByRole("button").all()) {
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeInViewport();
      const rect = (await button.boundingBox())!;
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width);
      expect(rect.height).toBeGreaterThanOrEqual(44);
      rectangles.push(rect);
    }
    const [a, b] = rectangles;
    const overlap =
      Math.min(a!.x + a!.width, b!.x + b!.width) - Math.max(a!.x, b!.x) > 1 &&
      Math.min(a!.y + a!.height, b!.y + b!.height) - Math.max(a!.y, b!.y) > 1;
    expect(overlap).toBe(false);
    expect(
      await pane.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    ).toBe(true);
  });
}
