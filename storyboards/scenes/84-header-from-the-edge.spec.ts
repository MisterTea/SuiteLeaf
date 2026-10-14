import { beat, caption, expect, test, typeSlowly } from "./harness";
import type { Page } from "@playwright/test";

const editorOf = (page: Page) =>
  page.getByRole("textbox", { name: "Document content" });

async function places(page: Page) {
  return page.evaluate(() => {
    const paper = document.querySelector(".paginated-paper") as HTMLElement;
    const content = document.querySelector(".document-content") as HTMLElement;
    const header = paper.querySelector(".page-header") as HTMLElement;
    const footer = paper.querySelector(".page-footer") as HTMLElement;
    const sheet = footer.closest(".page-furniture-page") as HTMLElement;
    const first = content.querySelector("p") as HTMLElement;
    const pageBox = sheet.getBoundingClientRect();
    const zoom = paper.getBoundingClientRect().width / paper.offsetWidth || 1;
    const fromTop = (el: HTMLElement) =>
      (el.getBoundingClientRect().top - pageBox.top) / zoom / 96;
    const fromBottom = (el: HTMLElement) =>
      (pageBox.bottom - el.getBoundingClientRect().bottom) / zoom / 96;
    const style = getComputedStyle(content);
    return {
      headerTop: fromTop(header),
      textTop: fromTop(first),
      footerBottom: fromBottom(footer),
      padTop: parseFloat(style.paddingTop) / 96,
      padBottom: parseFloat(style.paddingBottom) / 96,
    };
  });
}

function near(actual: number, expected: number) {
  expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(
    0.1,
  );
}

async function showTop(page: Page) {
  await page.locator(".document-stage").evaluate((el) => {
    el.scrollTo({ top: 0, behavior: "smooth" });
  });
  await beat(page, 700);
}

async function showFooter(page: Page) {
  await page.locator(".page-footer").first().evaluate((el) => {
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  });
  await beat(page, 800);
}

/** Keep Apply above the caption bar so a refusal is visible. */
async function liftDialog(page: Page) {
  await page.locator(".page-setup-dialog").evaluate((el) => {
    el.style.maxHeight = "calc(100vh - 210px)";
  });
}

async function replaceField(page: Page, label: string, value: string, delay = 140) {
  const setup = page.getByRole("dialog", { name: "Page setup" });
  await liftDialog(page);
  const field = setup.getByLabel(label);
  await field.scrollIntoViewIfNeeded();
  // "0.5" typed key by key passes through "0", which is refused. Set it whole.
  if (value === "0.5") {
    await field.fill("0.5");
    await beat(page, 500);
    return field;
  }
  await field.click();
  await field.press("ControlOrMeta+A");
  await beat(page, 250);
  await typeSlowly(page, value, delay);
  return field;
}

async function pointAtTitle(page: Page) {
  await page
    .getByRole("dialog", { name: "Page setup" })
    .getByRole("heading", { name: "Page setup" })
    .hover();
  await beat(page, 300);
}

test("84-header-from-the-edge", async ({ page }) => {
  await page.goto("/");
  await caption(
    page,
    "Priya’s thesis needs the header close to the top, and the notes an inch in.",
    1600,
  );
  await page.getByRole("button", { name: "New document" }).click();
  const title = page.getByLabel("File title");
  await title.click();
  await title.press("ControlOrMeta+A");
  await typeSlowly(page, "Thesis notes");
  const editor = editorOf(page);
  await editor.click();
  await typeSlowly(
    page,
    "The council notes start an inch in from the edge of the page.",
    22,
  );
  await expect(page.locator(".save-status")).toContainText("Saved");
  await beat(page, 400);

  await caption(page, "Page setup. The margin is 1 inch, and the header uses that same distance.", 900);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Page setup" });
  await expect(setup).toBeVisible();
  await liftDialog(page);
  for (const label of ["Top margin", "Bottom margin", "Left margin", "Right margin"]) {
    const field = setup.getByLabel(label);
    await field.fill("1");
    await beat(page, 180);
  }
  await replaceField(page, "Page header", "Town council", 45);
  await beat(page, 300);
  await replaceField(page, "Page footer", "Hearing notes", 35);
  await beat(page, 300);
  await replaceField(page, "Header from edge", "1", 160);
  await replaceField(page, "Footer from edge", "1", 160);
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");
  await beat(page, 600);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await showTop(page);
  const same = await places(page);
  near(same.headerTop, 1);
  expect(same.textTop).toBeGreaterThan(same.headerTop + 0.1);
  const paper = await page.locator(".paginated-paper").boundingBox();
  if (paper) await page.mouse.move(paper.x + 120, paper.y + 96, { steps: 14 });
  await caption(
    page,
    "Town council sits an inch from the top. The notes start on the next line.",
    2200,
  );

  await caption(page, "The margin stays 1 inch. She sets Header from edge to 0.5 inches.", 900);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await replaceField(page, "Header from edge", "0.5");
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");
  await expect(setup.getByRole("button", { name: "Apply", exact: true })).toBeEnabled();
  await beat(page, 700);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await showTop(page);
  const half = await places(page);
  near(half.headerTop, 0.5);
  near(half.textTop, 1);
  near(half.padTop, 1);
  if (paper) await page.mouse.move(paper.x + 140, paper.y + 52, { steps: 12 });
  await caption(
    page,
    "Only the header moves up. The notes stay an inch in.",
    2200,
  );

  await caption(page, "She sets Header from edge to 1.5 inches, past the margin.", 900);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await replaceField(page, "Header from edge", "1.5");
  await expect(setup.getByText("The header is inside the text area, so the text moves down below it. The top margin does not change.")).toBeVisible();
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");
  await pointAtTitle(page);
  await caption(
    page,
    "The note says the header is inside the text, so the text moves down. The margin still says 1 inch.",
    2400,
  );
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await showTop(page);
  const into = await places(page);
  near(into.headerTop, 1.5);
  expect(into.textTop).toBeGreaterThan(into.headerTop);
  expect(into.padTop).toBeGreaterThan(1.5);
  if (paper) await page.mouse.move(paper.x + 150, paper.y + into.textTop * 96, { steps: 12 });
  await caption(
    page,
    "Town council moved down, and the notes start below it. The margin is still 1 inch.",
    2200,
  );

  await caption(page, "She tries 0.", 700);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await replaceField(page, "Header from edge", "0");
  await expect(setup.getByRole("alert")).toHaveText(
    "The header must be at least 0.25 inches from the edge.",
  );
  const apply = setup.getByRole("button", { name: "Apply", exact: true });
  await expect(apply).toBeDisabled();
  await page.keyboard.press("Enter");
  await expect(setup).toBeVisible();
  await setup.getByRole("button", { name: "Apply", exact: true }).hover({ force: true });
  await beat(page, 300);
  await caption(
    page,
    "Zero is refused. The header must be at least 0.25 inches from the edge, and Apply stays off.",
    2400,
  );

  await caption(page, "She puts the header back at 0.5 inches.", 700);
  await replaceField(page, "Header from edge", "0.5");
  await expect(setup.getByLabel("Footer from edge")).toHaveValue("1");
  await expect(apply).toBeEnabled();
  await beat(page, 400);
  await apply.click();
  await expect(setup).toBeHidden();
  await editor.click();
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.insertText(
    `\n${Array.from({ length: 38 }, () => "The hearing note continues down the page.").join("\n")}`,
  );
  await beat(page, 500);
  await showFooter(page);
  await caption(
    page,
    "The notes run to the bottom margin. The footer still sits 1 inch from the edge.",
    1800,
  );

  await caption(page, "Footer from edge works the same way. She sets it to 0.5 inches.", 900);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await replaceField(page, "Footer from edge", "0.5");
  await expect(setup.getByLabel("Bottom margin")).toHaveValue("1");
  await expect(setup.getByLabel("Header from edge")).toHaveValue("0.5");
  await expect(apply).toBeEnabled();
  await beat(page, 500);
  await apply.click();
  await expect(setup).toBeHidden();
  await showFooter(page);
  const footerHalf = await places(page);
  near(footerHalf.footerBottom, 0.5);
  near(footerHalf.padBottom, 1);
  near(footerHalf.headerTop, 0.5);
  await caption(
    page,
    "The footer moves toward the edge. The notes stay an inch in.",
    2000,
  );

  await caption(page, "She sets Footer from edge to 1.5 inches, past the margin.", 800);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await replaceField(page, "Footer from edge", "1.5");
  await expect(setup.getByText("The footer is inside the text area, so the text moves up above it. The bottom margin does not change.")).toBeVisible();
  await expect(setup.getByLabel("Bottom margin")).toHaveValue("1");
  await pointAtTitle(page);
  await caption(
    page,
    "The footer is inside the text, so the text moves up. The bottom margin still says 1 inch.",
    2200,
  );
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await showFooter(page);
  const footerInto = await places(page);
  near(footerInto.footerBottom, 1.5);
  expect(footerInto.padBottom).toBeGreaterThan(1.5);
  await caption(page, "The footer moved up into the page. The margin did not change.", 1800);

  await caption(page, "Zero is refused for the footer too, and Apply stays off.", 800);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await replaceField(page, "Footer from edge", "0");
  await expect(setup.getByRole("alert")).toHaveText(
    "The footer must be at least 0.25 inches from the edge.",
  );
  await expect(apply).toBeDisabled();
  await beat(page, 1600);

  await caption(page, "She puts both distances back to 0.5 inches, then reopens the file.", 900);
  await replaceField(page, "Footer from edge", "0.5");
  await expect(setup.getByLabel("Header from edge")).toHaveValue("0.5");
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");
  await beat(page, 500);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await showTop(page);
  await beat(page, 400);

  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await beat(page, 700);
  await page.getByRole("link", { name: "Thesis notes" }).click();
  await expect(editor).toContainText("council notes");
  const kept = await places(page);
  near(kept.headerTop, 0.5);
  near(kept.textTop, 1);
  near(kept.footerBottom, 0.5);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await liftDialog(page);
  await expect(setup.getByLabel("Header from edge")).toHaveValue("0.5");
  await expect(setup.getByLabel("Footer from edge")).toHaveValue("0.5");
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");
  await beat(page, 900);
  await caption(
    page,
    "The header is still 0.5 inches from the edge, and the margin is still 1 inch.",
    2400,
  );
});
