import type { Locator, Page } from "@playwright/test";
import { beat, caption, expect, test } from "./harness";

function text(content: string) {
  return {
    id: crypto.randomUUID(),
    type: "text",
    x: 72,
    y: 180,
    width: 800,
    height: 120,
    content,
    fontSize: 64,
    bold: true,
    fontFamily: "Arial",
    color: "#1e293b",
    align: "left",
  };
}

function slide(title: string, notes?: string) {
  return {
    id: crypto.randomUUID(),
    title,
    layout: "title",
    background: { color: "#ffffff" },
    notes,
    elements: [text(title)],
  };
}

/** Welcome, a draft called Prices, and Thanks. Prices still has its note. */
function townHall() {
  const now = new Date().toISOString();
  const welcome = slide("Welcome", "Say hello.");
  const prices = slide("Prices", "Finish the draft later.");
  const thanks = slide("Thanks", "Wave.");
  const id = crypto.randomUUID();
  return JSON.stringify({
    format: "suiteleaf",
    version: 1,
    id,
    title: "Town hall",
    createdAt: now,
    updatedAt: now,
    kind: "slide",
    content: {
      id,
      width: 960,
      height: 540,
      slideOrder: [welcome.id, prices.id, thanks.id],
      slides: {
        [welcome.id]: welcome,
        [prices.id]: prices,
        [thanks.id]: thanks,
      },
    },
  });
}

async function pointAt(page: Page, target: Locator, dx = 0.5, dy = 0.5) {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width * dx, box.y + box.height * dy, { steps: 12 });
}

async function openDeck(page: Page) {
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (await chooser).setFiles({
    name: "Town hall.slslides",
    mimeType: "application/json",
    buffer: Buffer.from(townHall()),
  });
  await expect(page.getByLabel("File title")).toHaveValue("Town hall");
}

const rows = (page: Page) => page.locator(".thumbnail-row");
const show = (page: Page) => page.locator(".presenter-overlay");
const box = (page: Page) => show(page).locator(".presenter-slide-box");

async function advance(page: Page) {
  const slideBox = box(page);
  await pointAt(page, slideBox, 0.55, 0.5);
  await page.mouse.down();
  await page.mouse.up();
}

async function leaveShow(page: Page) {
  await page.keyboard.press("Escape");
  await expect(show(page)).toHaveCount(0);
}

async function presentFromStart(page: Page) {
  await page.locator(".slideshow-audience").scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Slideshow options" }).click();
  await beat(page, 400);
  await page.getByRole("menuitem", { name: "Present from beginning" }).click();
  await expect(show(page)).toBeVisible();
}

test("143-skip-the-draft-slide", async ({ page }) => {
  await page.addInitScript(() => {
    let current: Element | null = null;
    const change = (el: Element | null) => {
      current = el;
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    };
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => current,
    });
    Element.prototype.requestFullscreen = function () {
      return change(this);
    };
    document.exitFullscreen = () => change(null);
  });

  await openDeck(page);
  await caption(page, "Nia has Welcome, a draft called Prices, and Thanks.", 1600);
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).nth(0)).toHaveAttribute("aria-label", /Slide 1: Welcome/);
  await expect(rows(page).nth(1)).toHaveAttribute("aria-label", /Slide 2: Prices/);
  await expect(rows(page).nth(2)).toHaveAttribute("aria-label", /Slide 3: Thanks/);
  await expect(page.locator(".thumbnail-skipped")).toHaveCount(0);
  await beat(page, 500);

  await caption(page, "Prices still has its title and a note.", 1200);
  await pointAt(page, rows(page).nth(1));
  await rows(page).nth(1).click();
  await expect(page.locator(".slide-canvas textarea").first()).toHaveValue("Prices");
  await expect(page.locator(".notes-textarea")).toHaveValue("Finish the draft later.");
  await beat(page, 700);

  await caption(page, "She chooses Skip slide. Prices stays in the filmstrip.", 1100);
  await page.getByRole("button", { name: "Skip slide" }).click();
  await expect(rows(page).nth(1)).toContainText("Skipped");
  await expect(rows(page).nth(0)).not.toContainText("Skipped");
  await expect(rows(page).nth(2)).not.toContainText("Skipped");
  await expect(page.locator(".thumbnail-skipped")).toHaveText("Skipped");
  await expect(page.locator(".slide-canvas textarea").first()).toHaveValue("Prices");
  await expect(page.locator(".notes-textarea")).toHaveValue("Finish the draft later.");
  const audience = page.locator(".slideshow-audience");
  await audience.scrollIntoViewIfNeeded();
  await expect(audience).toHaveText("2 slides, 1 skipped");
  await pointAt(page, audience);
  await beat(page, 1400);

  await caption(
    page,
    "Prices is the current slide. The show begins on Thanks, not on Prices.",
    1300,
  );
  await page.getByRole("button", { name: "Slideshow", exact: true }).click();
  await expect(show(page)).toBeVisible();
  await expect(box(page).getByText("Thanks", { exact: true })).toBeVisible();
  await expect(box(page).getByText("Prices", { exact: true })).toHaveCount(0);
  await expect(box(page).getByText("Welcome", { exact: true })).toHaveCount(0);
  await expect(show(page).getByText("Slide 2 of 2")).toBeVisible();
  await beat(page, 1200);
  await leaveShow(page);

  await caption(page, "From the start, the audience sees Welcome, then Thanks.", 1200);
  await presentFromStart(page);
  await expect(box(page).getByText("Welcome", { exact: true })).toBeVisible();
  await expect(box(page).getByText("Prices", { exact: true })).toHaveCount(0);
  await expect(show(page).getByText("Slide 1 of 2")).toBeVisible();
  await beat(page, 1100);
  await advance(page);
  await expect(box(page).getByText("Thanks", { exact: true })).toBeVisible();
  await expect(box(page).getByText("Prices", { exact: true })).toHaveCount(0);
  await expect(box(page).getByText("Welcome", { exact: true })).toHaveCount(0);
  await expect(show(page).getByText("Slide 2 of 2")).toBeVisible();
  await beat(page, 1200);
  await leaveShow(page);
  await expect(page.locator(".slide-canvas textarea").first()).toHaveValue("Prices");
  await expect(page.locator(".notes-textarea")).toHaveValue("Finish the draft later.");

  await caption(page, "Unskip removes the Skipped label. The show is 3 slides.", 1200);
  await expect(page.getByRole("button", { name: "Unskip" })).toBeVisible();
  await page.getByRole("button", { name: "Unskip" }).click();
  await expect(page.locator(".thumbnail-skipped")).toHaveCount(0);
  await audience.scrollIntoViewIfNeeded();
  await expect(audience).toHaveText("3 slides");
  await expect(audience).not.toContainText("skipped");
  await beat(page, 900);

  await caption(page, "The next show includes Prices between Welcome and Thanks.", 1100);
  await presentFromStart(page);
  await expect(box(page).getByText("Welcome", { exact: true })).toBeVisible();
  await expect(show(page).getByText("Slide 1 of 3")).toBeVisible();
  await beat(page, 800);
  await advance(page);
  await expect(box(page).getByText("Prices", { exact: true })).toBeVisible();
  await expect(show(page).getByText("Slide 2 of 3")).toBeVisible();
  await beat(page, 1000);
  await advance(page);
  await expect(box(page).getByText("Thanks", { exact: true })).toBeVisible();
  await expect(show(page).getByText("Slide 3 of 3")).toBeVisible();
  await beat(page, 1000);
  await leaveShow(page);

  await caption(page, "She skips Prices again. The deck still has three slides, in the same order.", 1200);
  await rows(page).nth(1).click();
  await page.getByRole("button", { name: "Skip slide" }).click();
  await expect(rows(page).nth(0)).toHaveAttribute("aria-label", /Welcome/);
  await expect(rows(page).nth(1)).toHaveAttribute("aria-label", /Skipped: Prices/);
  await expect(rows(page).nth(2)).toHaveAttribute("aria-label", /Thanks/);
  await expect(page.locator(".save-status")).toContainText("Saved");
  await beat(page, 800);

  await caption(page, "She goes home and opens the deck again.", 1000);
  await page.getByRole("button", { name: "Back to files" }).click();
  const row = page.getByRole("link", { name: /Town hall/ });
  await expect(row).toBeVisible();
  await pointAt(page, row, 0.35);
  await row.click();
  await expect(page.getByLabel("File title")).toHaveValue("Town hall");
  await expect(rows(page).nth(1)).toContainText("Skipped");
  await expect(rows(page).nth(0)).not.toContainText("Skipped");
  await expect(rows(page).nth(2)).not.toContainText("Skipped");
  await rows(page).nth(1).click();
  await expect(page.locator(".slide-canvas textarea").first()).toHaveValue("Prices");
  await expect(page.locator(".notes-textarea")).toHaveValue("Finish the draft later.");
  await audience.scrollIntoViewIfNeeded();
  await expect(audience).toHaveText("2 slides, 1 skipped");
  await beat(page, 1000);

  await caption(page, "A show from the start still goes Welcome, then Thanks.", 1200);
  await presentFromStart(page);
  await expect(box(page).getByText("Welcome", { exact: true })).toBeVisible();
  await expect(box(page).getByText("Prices", { exact: true })).toHaveCount(0);
  await beat(page, 900);
  await advance(page);
  await expect(box(page).getByText("Thanks", { exact: true })).toBeVisible();
  await expect(box(page).getByText("Prices", { exact: true })).toHaveCount(0);
  await expect(show(page).getByText("Slide 2 of 2")).toBeVisible();
  await caption(page, "Prices waits in the deck, labeled Skipped.", 1600);
});
