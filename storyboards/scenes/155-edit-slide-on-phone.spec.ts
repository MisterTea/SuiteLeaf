import type { Page } from "@playwright/test";
import { beat, caption, expect, test, typeSlowly } from "./harness";

function mobileDeck() {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const slideId = crypto.randomUUID();
  return JSON.stringify({
    format: "suiteleaf",
    version: 1,
    id,
    title: "Quarterly review",
    createdAt: now,
    updatedAt: now,
    kind: "slide",
    content: {
      id,
      width: 960,
      height: 540,
      slideOrder: [slideId],
      slides: {
        [slideId]: {
          id: slideId,
          layout: "title",
          background: { color: "#f8fafc" },
          elements: [
            {
              id: "title-line",
              type: "text",
              x: 60,
              y: 80,
              width: 840,
              height: 70,
              content: "Quarterly review",
              fontSize: 34,
              color: "#0f172a",
              bold: true,
            },
            {
              id: "body-line",
              type: "text",
              x: 60,
              y: 190,
              width: 840,
              height: 120,
              content: "All project milestones completed on schedule.",
              fontSize: 22,
              color: "#334155",
            },
          ],
        },
      },
    },
  });
}

test("155-edit-slide-on-phone", async ({ page }) => {
  await caption(
    page,
    "Maya opens the quarterly review deck on her phone.",
    1600,
  );
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  const openBtn = page.getByRole("button", { name: /Open|import/i });
  if (await openBtn.isVisible()) {
    await openBtn.click();
    await (await chooser).setFiles({
      name: "Quarterly review.slslides",
      mimeType: "application/json",
      buffer: Buffer.from(mobileDeck()),
    });
  } else {
    await page
      .locator('input[type="file"]:not([webkitdirectory])')
      .first()
      .setInputFiles({
        name: "Quarterly review.slslides",
        mimeType: "application/json",
        buffer: Buffer.from(mobileDeck()),
      });
  }

  const canvas = page.locator(".slide-canvas");
  await canvas.waitFor();
  await expect(canvas).toBeVisible();
  await beat(page, 900);

  await caption(
    page,
    "Tapping a text box centers and zooms it smoothly for phone reading.",
    1600,
  );
  const bodyBox = page.locator('.slide-element[data-element-id="body-line"]');
  await bodyBox.click();
  await beat(page, 600);

  // Double click / tap to start editing
  await bodyBox.dblclick();
  const editor = bodyBox.locator("textarea, .element-editor, .ProseMirror").first();
  await expect(editor).toBeVisible();
  await beat(page, 700);

  await caption(
    page,
    "Typing on the on-screen keyboard stays steady without jerky scrolling.",
    1600,
  );
  await page.keyboard.press("Home");
  await typeSlowly(page, "Key update: ", 50);
  await beat(page, 900);

  await caption(
    page,
    "Tapping away onto the canvas finishes editing and commits the change.",
    1600,
  );
  await page.locator(".slide-stage-viewport").click({ position: { x: 10, y: 10 } });
  await beat(page, 800);
  await expect(bodyBox).toContainText("Key update: All project milestones");
  await beat(page, 1200);
});
