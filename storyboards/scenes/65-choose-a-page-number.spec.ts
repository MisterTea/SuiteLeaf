import type { Page } from "@playwright/test";
import { createFile, serializeFile, type DocFile } from "../../packages/core/src";
import { beat, caption, expect, test, typeSlowly } from "./harness";

function minutes(): DocFile {
  const file = createFile("doc", "Minutes") as DocFile;
  file.content = {
    type: "doc",
    attrs: {
      pageSettings: {
        size: "letter",
        landscape: false,
        margin: 72,
        header: "Garden club minutes",
        footer: "",
        pageNumbers: true,
      },
    },
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "October meeting" }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Present: Ben, Ruth, and Joy.",
          },
        ],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "The committee set the date and agreed the roof budget.",
          },
        ],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "The next meeting is the first Tuesday of December.",
          },
        ],
      },
      { type: "pageBreak" },
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Actions" }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Ruth will order the wood. Joy will book the room.",
          },
        ],
      },
    ],
  };
  return file;
}

/** Keep the caption on the outline so it never covers a page number. */
async function say(page: Page, text: string, hold = 1500) {
  await caption(page, text, 0);
  await page.evaluate(() => {
    const bar = document.getElementById("storyboard-caption");
    if (!bar) return;
    bar.style.left = "16px";
    bar.style.right = "auto";
    bar.style.top = "auto";
    bar.style.bottom = "16px";
    bar.style.transform = "none";
    bar.style.maxWidth = "240px";
    bar.style.textAlign = "left";
  });
  await beat(page, hold);
}

/** Scroll a footer number into the middle of the stage. */
async function showFooter(page: Page, index: number) {
  const number = page.locator(".page-number").nth(index);
  await number.evaluate((el) => {
    const stage = el.closest(".document-stage") as HTMLElement;
    const stageBox = stage.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const top = stage.scrollTop + (box.top - stageBox.top) - stageBox.height * 0.4;
    stage.scrollTo({ top: Math.max(0, top), behavior: "auto" });
  });
  await beat(page, 400);
  await expect(number).toBeInViewport();
}

/** Show the top of a page, where a top-right number sits. */
async function showPage(page: Page, index: number) {
  await page.locator(".page-furniture-page").nth(index).evaluate((el) => {
    const stage = el.closest(".document-stage") as HTMLElement;
    const stageBox = stage.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const top = stage.scrollTop + (box.top - stageBox.top) - 8;
    stage.scrollTo({ top: Math.max(0, top), behavior: "auto" });
  });
  await beat(page, 450);
  await expect(page.locator(".page-number").nth(index)).toBeInViewport();
}

test("65-choose-a-page-number", async ({ page }) => {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Minutes.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(minutes())),
  });
  await expect(page.locator(".editor-status")).toContainText("2 pages");
  await page.locator(".paper-container").evaluate((el) => {
    el.style.paddingBottom = "48vh";
  });
  const numbers = page.locator(".page-number");
  await expect(numbers).toHaveText(["1 / 2", "2 / 2"]);
  await showFooter(page, 0);
  await expect(page.locator(".page-furniture-page").first()).toHaveAttribute(
    "data-number-side",
    "right",
  );
  await say(page, "Page 1 ends with “1 / 2”, at the bottom right.", 1800);
  await showFooter(page, 1);
  await say(page, "Page 2 ends with “2 / 2”. The total is still there.", 1700);

  await say(
    page,
    "Page setup puts the format and the position next to the checkbox. No second dialog.",
    700,
  );
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Page setup" });
  await expect(page.getByRole("dialog")).toHaveCount(1);
  const pageWord = setup.getByRole("radio", { name: "Page 1" });
  const bottomCenter = setup.getByRole("radio", { name: "Bottom center" });
  await expect(setup.getByRole("radio", { name: "1 / 2" })).toBeChecked();
  await expect(setup.getByRole("radio", { name: "Bottom right" })).toBeChecked();
  await pageWord.scrollIntoViewIfNeeded();
  await beat(page, 500);
  await pageWord.click();
  await beat(page, 450);
  await bottomCenter.click();
  await expect(setup.locator("#page-numbers-hint")).toContainText(
    "Bottom center of every page, as “Page 1”",
  );
  await say(page, "He picks “Page 1”, hiding the total, and Bottom center.", 1700);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await expect(numbers).toHaveText(["Page 1", "Page 2"]);
  await expect(page.locator(".page-furniture-page").first()).toHaveAttribute(
    "data-number-side",
    "center",
  );
  await showFooter(page, 0);
  await say(page, "Page 1 shows “Page 1” in the center of the footer. No total.", 1800);
  await showFooter(page, 1);
  await say(page, "Page 2 shows “Page 2” in the center. Neither page shows a total.", 1800);

  await say(page, "The number is not footer text. He types a footer, and it stays.", 700);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const footer = setup.getByLabel("Page footer");
  await footer.click();
  await typeSlowly(page, "Committee draft", 40);
  await beat(page, 400);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".page-footer-text").first()).toHaveText("Committee draft");
  await expect(numbers).toHaveText(["Page 1", "Page 2"]);
  await showFooter(page, 0);
  await say(page, "“Committee draft” is the footer. “Page 1” is still in the center.", 2000);

  await say(page, "Top right moves the number into the header. The footer number is gone.", 700);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await setup.getByRole("radio", { name: "Top right" }).click();
  await beat(page, 600);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".page-furniture-page").first()).toHaveAttribute(
    "data-number-side",
    "top-right",
  );
  await expect(page.locator(".page-footer").first()).not.toContainText("Page");
  await expect(page.locator(".page-header").first()).toHaveText("Garden club minutes");
  await page.locator(".document-stage").evaluate((el) => {
    el.scrollTo({ top: 0, behavior: "auto" });
  });
  await beat(page, 500);
  await say(page, "“Page 1” sits at the top right, beside the header.", 1800);
  await showPage(page, 1);
  await expect(numbers).toHaveText(["Page 1", "Page 2"]);
  await say(page, "Page 2 matches. He saves and comes back.", 1400);

  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await beat(page, 600);
  await page.getByRole("link", { name: "Minutes" }).click();
  await expect(page.locator(".editor-status")).toContainText("2 pages");
  await expect(numbers).toHaveText(["Page 1", "Page 2"]);
  await expect(page.locator(".page-furniture-page").first()).toHaveAttribute(
    "data-number-side",
    "top-right",
  );
  await expect(page.locator(".page-footer-text").first()).toHaveText("Committee draft");
  await page.locator(".document-stage").evaluate((el) => {
    el.scrollTo({ top: 0, behavior: "auto" });
  });
  await beat(page, 400);
  await say(page, "Reopened. Still “Page 1” at the top right. The footer is untouched.", 2000);

  await say(page, "Turning page numbers off removes them from every page, in one step.", 700);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await setup.getByLabel("Page numbers").uncheck();
  await beat(page, 500);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(numbers).toHaveCount(0);
  await expect(page.locator(".page-footer-text").first()).toHaveText("Committee draft");
  await page.locator(".page-footer-text").first().evaluate((el) => {
    const stage = el.closest(".document-stage") as HTMLElement;
    const stageBox = stage.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const top = stage.scrollTop + (box.top - stageBox.top) - stageBox.height * 0.34;
    stage.scrollTo({ top: Math.max(0, top), behavior: "auto" });
  });
  await beat(page, 400);
  await say(page, "The numbers are gone. “Committee draft” is still in the footer.", 1700);

  await say(page, "Turning them back on restores “Page N” at the top right.", 700);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expect(setup.getByRole("radio", { name: "Page 1" })).toBeChecked();
  await expect(setup.getByRole("radio", { name: "Top right" })).toBeChecked();
  await setup.getByLabel("Page numbers").check();
  await beat(page, 450);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(numbers).toHaveText(["Page 1", "Page 2"]);
  await page.locator(".document-stage").evaluate((el) => {
    el.scrollTo({ top: 0, behavior: "auto" });
  });
  await beat(page, 400);
  await say(page, "“Page 1” is back at the top right. The wording and the place were kept.", 2000);
});
