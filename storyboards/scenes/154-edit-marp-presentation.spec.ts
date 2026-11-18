import type { Page } from "@playwright/test";
import { beat, caption, expect, test, typeSlowly } from "./harness";

const markdown = `---
marp: true
theme: beam_ut
---

# Launch plan

Ship the **beta** in May.

---

# Next steps

- Invite early testers
- Collect user feedback
`;

async function openMarpDeck(page: Page, source = markdown) {
  await page.goto("/");
  await page
    .locator('input[type="file"]:not([webkitdirectory])')
    .first()
    .setInputFiles({
      name: "launch-plan.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(source),
    });
  const canvas = page.locator(".slide-canvas");
  await canvas.waitFor();
  await expect(canvas).not.toHaveAttribute("aria-busy", "true");
  return { canvas, markdown: page.getByLabel("Presentation markdown") };
}

test("154-edit-marp-presentation", async ({ page }) => {
  await caption(
    page,
    "Dev opens the MARP launch plan. The slide renders live from Markdown.",
    1600,
  );
  const { canvas, markdown: mdPane } = await openMarpDeck(page);
  await expect(canvas).toBeVisible();
  await beat(page, 900);

  await caption(
    page,
    "Double-click the heading to edit in place directly on the slide.",
    1500,
  );
  const heading = page.locator(".slide-canvas .slide-element.slide-text").filter({ hasText: "Launch plan" });
  await heading.dblclick();

  const editor = heading.locator(".ProseMirror, .element-editor");
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await beat(page, 600);

  await caption(
    page,
    "Backdrop text hides cleanly—only the active editor text is visible.",
    1500,
  );
  await page.keyboard.press("End");
  await typeSlowly(page, " 2026", 45);
  await beat(page, 800);

  await caption(
    page,
    "Clicking away onto the canvas commits the edit to the Markdown source.",
    1500,
  );
  await page.locator(".slide-stage-viewport").click({ position: { x: 20, y: 20 } });
  await expect(heading).toContainText("Launch plan 2026");
  await expect(mdPane).toHaveValue(/# Launch plan 2026/);
  await beat(page, 1000);

  await caption(
    page,
    "He switches to the Next steps slide to review the roadmap.",
    1400,
  );
  const thumbs = page.locator(".thumbnail-row, .slide-thumbnail");
  if ((await thumbs.count()) > 1) {
    await thumbs.nth(1).click();
  } else {
    await page.keyboard.press("PageDown");
  }
  await beat(page, 1200);
});
