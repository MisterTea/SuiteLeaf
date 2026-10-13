import { gardenPicture } from "../fixtures";
import { askAgent, beat, caption, describeRun, electronMode, expect, openApp, test } from "../harness";

const signups = [
  ["Name", "Bringing", "Hoping for"],
  ["Asha", "Runner beans", "Chillies"],
  ["Marek", "Calendula", "Squash"],
  ["Priya", "Tomatoes", "Herbs"],
  ["Joy", "Sweet peas", "Anything!"],
];

test("05-tables-images-and-links-ai", async ({ page }) => {
  await openApp(page);
  await caption(page, "Asha is making a sign-up sheet for the seed swap. She asks SuiteLeaf's on-device assistant to lay it out.");
  const run = await askAgent(
    page,
    "Make a new document called Seed swap sign-up. Put the heading Seed swap at the top, then the line: Bring seeds to share on Saturday 14 November at the garden shed. " +
      "Then add a sign-up table with the columns Name, Bringing and Hoping for, and these sign-ups in this order: Asha brings Runner beans and hopes for Chillies; Marek brings Calendula and hopes for Squash; Priya brings Tomatoes and hopes for Herbs; Joy brings Sweet peas and hopes for Anything! " +
      "Below the table write \"Last year's swap table:\" and add a photo I'll pick. Finish with the line: Full rules are on the club website. Link the words club website to example.org/seed-swap.",
    { files: [{ name: "garden.png", mimeType: "image/png", buffer: gardenPicture() }] },
  );
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  const editor = page.getByRole("textbox", { name: "Document content" });
  const table = editor.locator("table");
  const rows = table.locator("tr");
  await expect(page.getByLabel("File title"), why).toHaveValue("Seed swap sign-up");
  await expect(editor.locator("h1"), why).toHaveText("Seed swap");
  await expect(editor, why).toContainText("Bring seeds to share on Saturday 14 November at the garden shed.");
  await expect(table, why).toHaveCount(1);
  await expect(rows, why).toHaveCount(5);
  await expect(rows.first().locator("th"), why).toHaveText(signups[0]);
  for (const [i, row] of signups.entries()) await expect(rows.nth(i).locator("td, th"), why).toHaveText(row);
  await caption(page, "A sign-up table with a bold header row and the four sign-ups in order.", 2000);

  const image = editor.locator("img");
  await expect(image, why).toHaveCount(1);
  await expect(table.locator("img"), why).toHaveCount(0);
  const intro = editor.locator(":scope > p").filter({ hasText: "Last year's swap table:" });
  await expect(intro, why).toHaveCount(1);
  await expect(intro.locator("xpath=following::img[1]"), why).toHaveCount(1);
  const link = editor.locator('a[href="https://example.org/seed-swap"]');
  await expect(link, why).toHaveText("club website");
  await expect(link.locator("xpath=ancestor::p[1]"), why).toHaveText("Full rules are on the club website.");
  await link.scrollIntoViewIfNeeded();
  await caption(page, "Gemma had her pick the photo, put it under its line, and linked \"club website\" to the rules.", 2400);

  await caption(page, "The photo is a bit big. Asha clicks it and drags a corner to shrink it.", 1200);
  await image.click();
  const corner = editor.locator('[data-resize-handle="bottom-right"]');
  await expect(corner).toBeVisible();
  await beat(page, 600);
  const start = (await corner.boundingBox())!;
  const from = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
  await page.mouse.move(from.x, from.y, { steps: 5 });
  await page.mouse.down();
  await page.mouse.move(from.x - 110, from.y - 61, { steps: 20 });
  await page.mouse.up();
  await expect.poll(async () => (await image.boundingBox())!.width).toBeLessThan(300);
  await editor.locator(":scope > p").last().click();
  await expect(page.getByRole("status")).toContainText(electronMode ? "Draft saved" : "Saved on this device");
  await page.locator(".document-stage").evaluate((el) => el.scrollTo({ top: 0, behavior: "smooth" }));
  await caption(
    page,
    electronMode
      ? "The table, the resized photo and the link, kept as a draft until she chooses Save As."
      : "The table, the resized photo and the link, all saved.",
    2200,
  );
  await beat(page, 600);
});
