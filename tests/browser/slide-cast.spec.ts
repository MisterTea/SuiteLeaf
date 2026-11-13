import { expect, test } from "@playwright/test";
import { createFile } from "../../packages/core/src/native-file";
import { castFrame, frameChunks } from "../../apps/web/src/editors/slide-cast-protocol";
import { startOfShow } from "../../apps/web/src/editors/slide-fade-in";

test("the Cast audience canvas fits the TV and reveals objects without overflowing", async ({ page }) => {
  await page.route("https://www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js", (route) => route.fulfill({
    contentType: "application/javascript",
    body: `window.cast={framework:{CastReceiverContext:{getInstance:()=>({addCustomMessageListener:(_,listener)=>window.receiveCast=listener,removeCustomMessageListener:()=>{},start:()=>{}})}}};`,
  }));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/cast-receiver.html");
  const file = createFile("slide");
  if (file.kind !== "slide") throw new Error("Expected slides");
  const deck = file.content;
  const slide = deck.slides[deck.slideOrder[0]];
  slide.background = { color: "#ffffff" };
  slide.elements = [
    { id: "title", type: "text", content: "SuiteLeaf Cast", x: 60, y: 60, width: 800, height: 100, fontSize: 44, bold: true },
    { id: "point", type: "shape", shapeType: "rect", x: 60, y: 240, width: 840, height: 180, fill: "#2563eb", animation: "appear-on-click" },
  ];
  const frame = castFrame(deck, 0, startOfShow(0), null);
  const send = async () => {
    await page.evaluate((chunks) => {
      const host = window as typeof window & { receiveCast(event: { senderId: string; data: unknown }): void };
      for (const data of chunks) host.receiveCast({ senderId: "test", data });
    }, frameChunks(JSON.stringify(frame), crypto.randomUUID()));
  };
  await expect(page.getByText("Ready to present with SuiteLeaf")).toBeVisible();
  await send();
  await expect(page.locator('[data-element-id="point"]')).toBeHidden();
  frame.cursor.revealed = 1;
  await send();
  await expect(page.locator('[data-element-id="point"]')).toBeVisible();
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(viewport);
    const canvas = page.locator(".cast-slide");
    await expect.poll(async () => {
      const bounds = await canvas.boundingBox();
      return bounds ? Math.abs(bounds.width / bounds.height - 16 / 9) : 1;
    }).toBeLessThan(0.01);
    // ResizeObserver updates the painted slide after the outer CSS box resizes.
    await expect.poll(async () => {
      const outer = (await canvas.boundingBox())!;
      const shape = (await page.locator('[data-element-id="point"]').boundingBox())!;
      return shape.x + shape.width < outer.x + outer.width;
    }).toBe(true);
    const canvasBox = (await canvas.boundingBox())!;
    const shapeBox = (await page.locator('[data-element-id="point"]').boundingBox())!;
    expect(canvasBox.x).toBeGreaterThanOrEqual(0);
    expect(canvasBox.y).toBeGreaterThanOrEqual(0);
    expect(canvasBox.x + canvasBox.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(canvasBox.y + canvasBox.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(shapeBox.x).toBeGreaterThan(canvasBox.x);
    expect(shapeBox.x + shapeBox.width).toBeLessThan(canvasBox.x + canvasBox.width);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(viewport.height);
  }
  await page.screenshot({ path: "test-results/browser/cast-audience.png" });
  frame.blank = "#000000";
  await send();
  await expect(page.locator(".cast-blank")).toHaveCSS("background-color", "rgb(0, 0, 0)");
});
