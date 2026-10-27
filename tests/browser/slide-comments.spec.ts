import { test, expect, type Page } from "@playwright/test";
import { serializeFile } from "@suiteleaf/core";
import { CHART_NOTES, NEXT_NOTES, q3Update } from "../q3-comment-deck";

const mod = process.platform === "darwin" ? "Meta" : "Control";

async function openDeck(page: Page) {
  await page.goto("/");
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({
    name: "Q3 update.slslides",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(q3Update())),
  });
  await expect(page.locator(".slides-editor")).toBeVisible();
  await expect(page.locator(".notes-textarea")).toHaveValue(CHART_NOTES);
}

async function boxesOverlap(
  page: Page,
  left: string,
  right: string,
) {
  const [a, b] = await Promise.all([
    page.locator(left).boundingBox(),
    page.locator(right).boundingBox(),
  ]);
  expect(a).toBeTruthy();
  expect(b).toBeTruthy();
  return (
    a!.x < b!.x + b!.width &&
    a!.x + a!.width > b!.x &&
    a!.y < b!.y + b!.height &&
    a!.y + a!.height > b!.y
  );
}

test("slide comments stay on the object and out of the speaker notes", async ({
  page,
}) => {
  await openDeck(page);
  await expect(page.locator(".slide-comment-mark")).toHaveCount(0);

  await page.locator('[data-element-id="chart"]').click();
  await page.keyboard.press(`${mod}+Alt+KeyM`);
  const comment = page.getByRole("textbox", { name: "Comment" });
  await expect(comment).toBeFocused();
  await expect(page.locator(".slide-comment-dock")).toBeVisible();
  expect(await boxesOverlap(page, '[data-element-id="chart"]', ".slide-comment-dock")).toBe(
    false,
  );

  await comment.fill("Use the September numbers");
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(page.locator(".slide-comment-error")).toContainText("Add your name");
  await expect(page.locator(".slide-comment-mark")).toHaveCount(0);
  await expect(page.locator(".notes-textarea")).toHaveValue(CHART_NOTES);

  await page.getByRole("textbox", { name: "Your name" }).fill("Maria");
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  const mark = page.getByRole("button", { name: "Comment on Quarterly revenue chart" });
  await expect(mark).toBeVisible();
  const messages = page.locator(".slide-comment-message");
  await expect(messages).toHaveCount(1);
  await expect(messages.first()).toContainText("Maria");
  await expect(messages.first()).toContainText("Use the September numbers");

  const reply = page.getByRole("textbox", { name: "Reply" });
  await expect(reply).toBeFocused();
  await reply.fill("Priya has them.");
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(messages).toHaveCount(2);
  await expect(messages.nth(1)).toContainText("Maria");
  await expect(messages.nth(1)).toContainText("Priya has them.");
  await expect(page.locator(".notes-textarea")).toHaveValue(CHART_NOTES);

  await page.locator(".thumbnail-row").nth(1).click();
  await expect(page.locator(".slide-comment-mark")).toHaveCount(0);
  await expect(page.locator(".slide-comment-dock")).toHaveCount(0);
  await expect(page.locator(".notes-textarea")).toHaveValue(NEXT_NOTES);

  await page.locator(".thumbnail-row").nth(0).click();
  await expect(mark).toBeVisible();
  await expect(page.locator(".notes-textarea")).toHaveValue(CHART_NOTES);
  await mark.click();
  await page.getByRole("button", { name: "Resolve" }).click();
  await expect(page.locator(".slide-comment-mark")).toHaveCount(0);
  await expect(page.locator(".slide-comment-notice")).toContainText("Resolved");

  await page.locator(".file-menu").getByRole("button", { name: "Comments", exact: true }).click();
  await page.getByRole("menuitem", { name: "Resolved" }).click();
  const resolved = page.getByRole("region", { name: "Resolved comments" });
  await expect(resolved).toContainText("Use the September numbers");
  await expect(resolved).toContainText("Priya has them.");
  await resolved.getByRole("button", { name: "Reopen" }).click();
  await expect(mark).toBeVisible();
  await expect(messages).toHaveCount(2);

  await expect(page.locator(".save-status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Q3 update" }).click();
  await expect(mark).toBeVisible();
  await expect(page.locator(".notes-textarea")).toHaveValue(CHART_NOTES);
  await mark.click();
  await expect(page.locator(".slide-comment-message")).toHaveCount(2);
  await expect(page.locator(".slide-comment-message").nth(0)).toContainText("Maria");
  await expect(page.locator(".slide-comment-message").nth(1)).toContainText(
    "Priya has them.",
  );

  const saved = await page.locator(".slides-editor").getAttribute("data-deck-snapshot");
  const deck = JSON.parse(saved ?? "{}") as {
    slides: Record<string, { notes?: string; comments?: { elementId: string }[] }>;
  };
  const chart = Object.values(deck.slides).find((slide) => slide.comments?.length);
  expect(chart?.notes).toBe(CHART_NOTES);
  expect(chart?.comments?.[0].elementId).toBe("chart");
  expect(JSON.stringify(chart?.notes)).not.toContain("September numbers");
});

test("the comment pane opens beside the toolbar like version history, and its × closes it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openDeck(page);
  const button = page.locator(".header-right-tools").getByRole("button", { name: "Comments", exact: true });
  await button.click();
  const pane = page.getByRole("complementary", { name: "Slide comments" });
  await expect(pane).toBeVisible();
  const toolbar = (await page.getByRole("toolbar", { name: "Slides toolbar" }).boundingBox())!;
  const box = (await pane.boundingBox())!;
  expect(box.x + box.width).toBeCloseTo(1280, 0);
  expect(box.y).toBeLessThanOrEqual(toolbar.y);
  expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(box.x + 1);
  await pane.getByRole("button", { name: "Close comments" }).click();
  await expect(pane).toHaveCount(0);

  await page.getByRole("button", { name: "Version history", exact: true }).click();
  const history = (await page.getByRole("complementary", { name: "Version history" }).boundingBox())!;
  expect(Math.abs(history.y - box.y)).toBeLessThan(1);
  expect(Math.abs(history.height - box.height)).toBeLessThan(1);
});
