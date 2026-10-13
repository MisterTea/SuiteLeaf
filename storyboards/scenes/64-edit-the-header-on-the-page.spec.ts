import type { Locator, Page } from "@playwright/test";
import { createFile, serializeFile } from "../../packages/core/src";
import { beat, caption, expect, test, typeSlowly } from "./harness";

const body = "The harvest supper is Saturday. Bring a dish to share.";

/** Put a header or footer in the upper half, clear of the caption bar. */
async function showFurniture(page: Page, locator: Locator) {
  await locator.evaluate((el) => {
    const stage = el.closest(".document-stage");
    if (!(stage instanceof HTMLElement)) return;
    const stageRect = stage.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const delta = rect.top - stageRect.top - stage.clientHeight * 0.28;
    stage.scrollTo({ top: Math.max(0, stage.scrollTop + delta), behavior: "smooth" });
  });
  await beat(page, 800);
}

test("64-edit-the-header-on-the-page", async ({ page }) => {
  const file = createFile("doc", "Minutes");
  if (file.kind !== "doc") throw new Error("expected a document");
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
            text: "Present: Ben, Ruth, Marek, and Asha. The club agreed to mulch the beds.",
          },
        ],
      },
      { type: "pageBreak" },
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Decisions" }],
      },
      { type: "paragraph", content: [{ type: "text", text: body }] },
    ],
  };

  await page.goto("/");
  await caption(page, "Ben opens the club minutes. The running header still says “Garden club minutes”.", 700);
  await page.locator("input[type=file]").setInputFiles({
    name: "minutes.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toContainText(body);
  await expect(page.locator(".editor-status")).toContainText("2 pages");
  const page1 = page.locator(".page-furniture-page").nth(0);
  const page2 = page.locator(".page-furniture-page").nth(1);
  await expect(page2.locator(".page-header")).toHaveText("Garden club minutes");
  await expect(page2.locator(".page-number")).toHaveText("2 / 2");
  await showFurniture(page, page2.locator(".page-header"));
  await caption(page, "Page 2. He double-clicks that header. Page setup stays closed.", 1200);

  await page2.locator(".page-header").hover();
  await beat(page, 400);
  await page2.locator(".page-header").dblclick();
  const header = page.getByRole("textbox", { name: "Header for every page" });
  await expect(header).toBeFocused();
  await expect(page.getByRole("dialog", { name: "Page setup" })).toHaveCount(0);
  await expect(page.locator(".paginated-paper")).toHaveClass(/is-editing-furniture/);
  await expect(page.locator(".page-furniture-scope")).toHaveText("Header · all pages");
  const opacity = await page.locator(".document-content").evaluate((el) =>
    Number(getComputedStyle(el).opacity),
  );
  expect(opacity).toBeLessThan(0.5);
  await showFurniture(page, header);
  await caption(page, "The minutes dim, and the whole header is selected — ready to replace.", 1500);

  await typeSlowly(page, "October minutes", 55);
  await expect(header).toHaveValue("October minutes");
  await expect(page1.locator(".page-header")).toHaveText("October minutes");
  await caption(page, "He types “October minutes”. The page shows it before he leaves the header.", 1600);

  await page.getByRole("heading", { name: "Decisions" }).click();
  await expect(header).toHaveCount(0);
  await expect(page.locator(".paginated-paper")).not.toHaveClass(/is-editing-furniture/);
  await expect(editor).toContainText(body);
  await expect(page2.locator(".page-header")).toHaveText("October minutes");
  await caption(page, "A click in the minutes closes the header. The body text is unchanged.", 1600);

  await page.locator(".document-stage").evaluate((el) =>
    el.scrollTo({ top: 0, behavior: "smooth" }),
  );
  await beat(page, 700);
  const firstHeader = await page1.locator(".page-header").boundingBox();
  if (firstHeader)
    await page.mouse.move(
      firstHeader.x + 20,
      firstHeader.y + firstHeader.height - 8,
      { steps: 10 },
    );
  await expect(page1.locator(".page-header")).toHaveText("October minutes");
  await caption(page, "The header is shared, so page 1 says October minutes too.", 1700);

  await showFurniture(page, page1.locator(".page-footer"));
  await page1.locator(".page-footer").hover();
  await beat(page, 350);
  await page1.locator(".page-footer").dblclick();
  const footer = page.getByRole("textbox", { name: "Footer for every page" });
  await expect(footer).toBeFocused();
  await expect(footer).toHaveValue("");
  await showFurniture(page, page1.locator(".page-footer"));
  const number = page1.locator(".page-number");
  await expect(number).toHaveText("1 / 2");
  await expect(page2.locator(".page-number")).toHaveText("2 / 2");
  const numberBox = await number.boundingBox();
  expect(numberBox).toBeTruthy();
  expect(numberBox!.y).toBeGreaterThan(120);
  expect(numberBox!.y).toBeLessThan(560);
  await caption(page, "The footer is separate from the page number. The number stays a number.", 1400);
  await typeSlowly(page, "Draft", 80);
  await expect(footer).toHaveValue("Draft");
  await expect(number).toHaveText("1 / 2");
  await expect(page2.locator(".page-number")).toHaveText("2 / 2");
  expect(await footer.inputValue()).not.toContain("1");
  await page.mouse.move(numberBox!.x + numberBox!.width / 2, numberBox!.y + numberBox!.height / 2, {
    steps: 8,
  });
  await caption(page, "“Draft” sits beside 1. He never types over the number.", 1700);

  await page.keyboard.press("Escape");
  await expect(footer).toHaveCount(0);
  await expect(page.locator(".paginated-paper")).not.toHaveClass(/is-editing-furniture/);
  await expect(page1.locator(".page-footer")).toContainText("Draft");
  await expect(number).toHaveText("1 / 2");
  await expect(page2.locator(".page-header")).toHaveText("October minutes");
  await expect(editor).toContainText(body);
  await showFurniture(page, page1.locator(".page-footer"));
  await caption(page, "Escape returns to the minutes. Draft and the page number both stay.", 1600);

  await caption(page, "He closes the file and opens it again.", 500);
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await beat(page, 600);
  await page.getByRole("link", { name: "Minutes" }).click();
  await expect(editor).toContainText(body);
  await page2.locator(".page-header").evaluate((el) =>
    el.scrollIntoView({ behavior: "smooth", block: "center" }),
  );
  await beat(page, 800);
  await expect(page.locator(".page-header").nth(1)).toHaveText("October minutes");
  await expect(page.locator(".page-footer").nth(1)).toContainText("Draft");
  await expect(page.locator(".page-number").nth(1)).toHaveText("2 / 2");
  await caption(page, "He reopens the file. October minutes and Draft are still on the page.", 2200);
});
