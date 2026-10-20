import type { Locator, Page } from "@playwright/test";
import { serializeFile } from "@suiteleaf/core";
import { CHART_NOTES, NEXT_NOTES, q3Update } from "../../tests/q3-comment-deck";
import { beat, caption, expect, test, typeSlowly } from "./harness";

const mod = process.platform === "darwin" ? "Meta" : "Control";

async function pointAt(page: Page, target: Locator) {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
}

async function openMenu(page: Page, name: string) {
  await page.locator(".file-menu").getByRole("button", { name, exact: true }).click();
  await beat(page, 450);
}

test("60-comment-on-a-slide", async ({ page }) => {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Q3 update.slslides",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(q3Update())),
  });
  await expect(page.locator(".slides-editor")).toBeVisible();
  const chart = page.locator('[data-element-id="chart"]');
  const notes = page.locator(".notes-textarea");
  await expect(chart).toBeVisible();
  await expect(notes).toHaveValue(CHART_NOTES);
  await expect(page.locator(".slide-comment-mark")).toHaveCount(0);

  await caption(
    page,
    "Maria opens Q3 update on the chart slide. There is no comment mark. The speaker notes are for the room.",
    1800,
  );

  await caption(
    page,
    "She selects the chart and presses ⌘⌥M. The note opens beside the chart, so the bars stay visible.",
    1400,
  );
  await pointAt(page, chart);
  await chart.click();
  await beat(page, 400);
  await page.keyboard.press(`${mod}+Alt+KeyM`);
  const comment = page.getByRole("textbox", { name: "Comment" });
  await expect(comment).toBeFocused();
  const dock = page.locator(".slide-comment-dock");
  await expect(dock).toBeVisible();
  const chartBox = (await chart.boundingBox())!;
  const dockBox = (await dock.boundingBox())!;
  const phone = (page.viewportSize()?.width ?? 1280) < 700;
  if (phone) expect(chartBox.y + chartBox.height).toBeLessThanOrEqual(dockBox.y + 4);
  else expect(chartBox.x + chartBox.width).toBeLessThanOrEqual(dockBox.x + 4);
  await beat(page, 500);
  await typeSlowly(page, "Use the September numbers");
  await beat(page, 400);
  const name = page.getByRole("textbox", { name: "Your name" });
  await pointAt(page, name);
  await name.click();
  await typeSlowly(page, "Maria");
  await beat(page, 300);
  const post = page.getByRole("button", { name: "Comment", exact: true });
  await pointAt(page, post);
  await post.click();

  const mark = page.getByRole("button", { name: "Comment on Quarterly revenue chart" });
  await expect(mark).toBeVisible();
  await expect(page.locator(".slide-comment-message").first()).toContainText("Maria");
  await expect(page.locator(".slide-comment-message").first()).toContainText(
    "Use the September numbers",
  );
  await expect(notes).toHaveValue(CHART_NOTES);
  await caption(
    page,
    "The mark sits on the chart, with Maria’s name. The speaker notes are unchanged.",
    1800,
  );

  await caption(
    page,
    "She replies in the same thread. The reply stays under the first note, with her name.",
    1400,
  );
  const reply = page.getByRole("textbox", { name: "Reply" });
  await expect(reply).toBeFocused();
  await typeSlowly(page, "Priya has them.");
  await beat(page, 300);
  const replyButton = page.getByRole("button", { name: "Reply", exact: true });
  await pointAt(page, replyButton);
  await replyButton.click();
  const messages = page.locator(".slide-comment-message");
  await expect(messages).toHaveCount(2);
  await expect(messages.nth(0)).toContainText("Use the September numbers");
  await expect(messages.nth(1)).toContainText("Priya has them.");
  await expect(messages.nth(1)).toContainText("Maria");
  await beat(page, 800);

  await caption(
    page,
    "The next slide is clean. The chart comment is not sitting on top of it.",
    1200,
  );
  const next = page.locator(".thumbnail-row").nth(1);
  await pointAt(page, next);
  await next.click();
  await expect(page.locator(".slide-comment-mark")).toHaveCount(0);
  await expect(page.locator(".slide-comment-dock")).toHaveCount(0);
  await expect(notes).toHaveValue(NEXT_NOTES);
  await beat(page, 900);

  await caption(page, "Coming back, the mark is on the chart again.", 1200);
  const back = page.locator(".thumbnail-row").nth(0);
  await pointAt(page, back);
  await back.click();
  await expect(mark).toBeVisible();
  await expect(notes).toHaveValue(CHART_NOTES);
  await beat(page, 600);

  await caption(
    page,
    "Resolve is a labeled button. The mark leaves the slide.",
    1200,
  );
  await pointAt(page, mark);
  await mark.click();
  await beat(page, 400);
  const resolve = page.getByRole("button", { name: "Resolve" });
  await pointAt(page, resolve);
  await resolve.click();
  await expect(page.locator(".slide-comment-mark")).toHaveCount(0);
  await expect(page.locator(".slide-comment-notice")).toContainText("Resolved");
  await beat(page, 700);

  await caption(
    page,
    "Comments, then Resolved. Reopen puts the mark back in one click.",
    1400,
  );
  await openMenu(page, "Comments");
  await page.getByRole("menuitem", { name: "Resolved" }).click();
  const resolved = page.getByRole("region", { name: "Resolved comments" });
  await expect(resolved).toContainText("Use the September numbers");
  await expect(resolved).toContainText("Priya has them.");
  await beat(page, 600);
  const reopen = resolved.getByRole("button", { name: "Reopen" });
  await pointAt(page, reopen);
  await reopen.click();
  await expect(mark).toBeVisible();
  await expect(messages).toHaveCount(2);
  await beat(page, 800);

  await caption(
    page,
    "She closes the file and opens it again. Both notes are still on the chart.",
    1400,
  );
  await expect(page.locator(".save-status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await beat(page, 600);
  const file = page.getByRole("link", { name: "Q3 update" });
  await expect(file).toBeVisible();
  await pointAt(page, file);
  await file.click();
  await expect(mark).toBeVisible();
  await expect(notes).toHaveValue(CHART_NOTES);
  await mark.click();
  await expect(page.locator(".slide-comment-message")).toHaveCount(2);
  await expect(page.locator(".slide-comment-message").nth(1)).toContainText(
    "Priya has them.",
  );
  await beat(page, 1600);
});
