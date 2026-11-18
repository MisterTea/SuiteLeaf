import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("slide carousel delegates swipes to native touch scrolling", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^New presentation/ }).click();
  for (let i = 0; i < 12; i++) await page.locator(".add-slide-sidebar-btn").click();
  const list = page.locator(".thumbnails-list");
  await list.evaluate(node => { node.scrollLeft = 0; });
  const active = await page.locator(".thumbnail-row.active").getAttribute("data-slide-id");
  const bounds = (await list.boundingBox())!;
  const y = bounds.y + bounds.height / 2;
  const session = await page.context().newCDPSession(page);
  await list.evaluate(node => {
    node.setAttribute("data-native-cancels", "0");
    node.addEventListener("pointercancel", () => node.setAttribute("data-native-cancels", "1"));
  });
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 280, y }] });
  for (let x = 260; x >= 100; x -= 20) {
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
    await page.waitForTimeout(16);
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  // A real native pan cancels application pointer handling. Synthetic touch
  // events exercise that handoff; momentum timing belongs to the platform.
  await expect(list).toHaveAttribute("data-native-cancels", "1");
  await expect.poll(() => list.evaluate(node => node.scrollLeft)).toBeGreaterThan(50);
  await expect(page.locator(".thumbnail-row.active")).toHaveAttribute("data-slide-id", active!);
  await expect(page.getByRole("button", { name: "Done", exact: true })).toHaveCount(0);
  await session.detach();
});
