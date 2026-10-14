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
    const sheet = header.closest(".page-furniture-page") as HTMLElement;
    const title = (content.querySelector("h1") ?? content.querySelector("p")) as HTMLElement;
    const pageBox = sheet.getBoundingClientRect();
    const zoom = paper.getBoundingClientRect().width / paper.offsetWidth || 1;
    const fromTop = (el: HTMLElement) =>
      (el.getBoundingClientRect().top - pageBox.top) / zoom / 96;
    const fromBottom = (el: HTMLElement) =>
      (pageBox.bottom - el.getBoundingClientRect().bottom) / zoom / 96;
    const style = getComputedStyle(content);
    const footerTop = footer.getBoundingClientRect().top;
    const above = [...content.querySelectorAll("h1, p")].filter((el) => {
      const box = el.getBoundingClientRect();
      return box.height > 0 && box.top >= pageBox.top && box.bottom <= footerTop + 1;
    });
    const last = above.at(-1);
    const gap = last
      ? (footerTop - last.getBoundingClientRect().bottom) / zoom / 96
      : null;
    return {
      headerTop: fromTop(header),
      headerBottom: (header.getBoundingClientRect().bottom - pageBox.top) / zoom / 96,
      textTop: fromTop(title),
      footerBottom: fromBottom(footer),
      padTop: parseFloat(style.paddingTop) / 96,
      padBottom: parseFloat(style.paddingBottom) / 96,
      gap,
    };
  });
}

function near(actual: number, expected: number) {
  expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(0.1);
}

async function showTop(page: Page) {
  await page.locator(".document-stage").evaluate((el) => {
    el.scrollTo({ top: 0, behavior: "smooth" });
  });
  await beat(page, 700);
}

async function showFooter(page: Page) {
  await page.locator(".page-footer").first().evaluate((el) => {
    const stage = el.closest(".document-stage");
    if (!(stage instanceof HTMLElement)) {
      el.scrollIntoView({ block: "center" });
      return;
    }
    el.scrollIntoView({ block: "center" });
    const box = stage.getBoundingClientRect();
    stage.scrollTop += el.getBoundingClientRect().top - (box.top + box.height * 0.38);
  });
  await beat(page, 700);
}

/** Keep the margin field and the distance note on screen together. */
async function showMarginAndNote(page: Page, marginLabel: string, noteText: string) {
  const fields = page.getByRole("dialog", { name: "Page setup" }).locator(".page-setup-fields");
  await fields.evaluate(
    (el, args) => {
      const margin = el.querySelector(`[aria-label="${args.marginLabel}"]`);
      if (!(margin instanceof HTMLElement)) return;
      const note = [...el.querySelectorAll("p")].find((item) =>
        item.textContent?.includes(args.noteText),
      );
      const marginTop = margin.getBoundingClientRect().top;
      const origin = el.getBoundingClientRect().top;
      el.scrollTop += marginTop - origin - 4;
      if (!(note instanceof HTMLElement)) return;
      const overflow = note.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom;
      if (overflow > 0) el.scrollTop += overflow + 8;
    },
    { marginLabel, noteText },
  );
  await beat(page, 250);
}

/** Keep Apply above the caption bar so the note stays readable. */
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
    await beat(page, 450);
    return field;
  }
  await field.click();
  await field.press("ControlOrMeta+A");
  await beat(page, 200);
  await typeSlowly(page, value, delay);
  return field;
}

test("91-keep-the-letterhead-off-the-title", async ({ page }) => {
  await page.goto("/");
  await caption(
    page,
    "Sam is laying out the council minutes. The letterhead and the title both want an inch.",
    1700,
  );
  await page.getByRole("button", { name: "New document" }).click();
  const title = page.getByLabel("File title");
  await title.click();
  await title.press("ControlOrMeta+A");
  await typeSlowly(page, "Minutes");
  const editor = editorOf(page);
  await editor.click();
  await page.getByLabel("Paragraph style").selectOption("1");
  await typeSlowly(page, "Minutes", 70);
  await expect(page.locator(".save-status")).toContainText("Saved");
  await beat(page, 400);

  await caption(
    page,
    "Page setup. A 1 inch margin, the header Town council, and Header from edge at 1 inch.",
    1400,
  );
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Page setup" });
  await expect(setup).toBeVisible();
  await liftDialog(page);
  for (const label of ["Top margin", "Bottom margin", "Left margin", "Right margin"]) {
    const field = setup.getByLabel(label);
    await field.scrollIntoViewIfNeeded();
    await field.fill("1");
    await beat(page, 160);
  }
  await replaceField(page, "Page header", "Town council", 40);
  await beat(page, 250);
  await replaceField(page, "Page footer", "Hearing notes", 35);
  await beat(page, 250);
  await replaceField(page, "Header from edge", "1", 150);
  await replaceField(page, "Footer from edge", "1", 150);
  const headerNote = setup.getByText(
    "The header reaches the text, so the text starts below it. The top margin does not change.",
  );
  await headerNote.scrollIntoViewIfNeeded();
  await expect(headerNote).toBeVisible();
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");
  await expect(setup.getByLabel("Header from edge")).toHaveValue("1");
  await expect(
    setup.getByText(
      "The footer reaches the text, so the text stops above it. The bottom margin does not change.",
    ),
  ).toBeVisible();
  await expect(setup.getByLabel("Bottom margin")).toHaveValue("1");
  await beat(page, 400);
  await caption(
    page,
    "Both numbers are 1 inch. The note says the header reaches the text, so the title starts below it.",
    2400,
  );
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await showTop(page);
  const even = await places(page);
  near(even.headerTop, 1);
  expect(even.textTop).toBeGreaterThan(even.headerBottom);
  expect(even.padTop).toBeGreaterThan(1.1);
  const paper = await page.locator(".paginated-paper").boundingBox();
  if (paper) {
    await page.mouse.move(paper.x + 140, paper.y + even.headerTop * 96 + 8, { steps: 12 });
    await beat(page, 350);
    await page.mouse.move(paper.x + 160, paper.y + even.textTop * 96 + 10, { steps: 10 });
  }
  await caption(
    page,
    "Town council has its own line, an inch from the top. Minutes starts underneath. The margin is still 1 inch.",
    2600,
  );

  await caption(
    page,
    "She sets Header from edge to 0.5 inches. That fits inside the 1 inch margin.",
    1200,
  );
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await replaceField(page, "Header from edge", "0.5");
  await expect(setup.getByText(/header reaches the text/)).toHaveCount(0);
  await expect(setup.getByText(/inside the text area/)).toHaveCount(0);
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");
  await beat(page, 500);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await showTop(page);
  const half = await places(page);
  near(half.headerTop, 0.5);
  near(half.textTop, 1);
  near(half.padTop, 1);
  if (paper) await page.mouse.move(paper.x + 140, paper.y + half.headerTop * 96 + 6, { steps: 10 });
  await caption(
    page,
    "Only the letterhead moves up. Minutes is at the 1 inch margin.",
    2200,
  );

  await caption(page, "She sets Header from edge to 1.5 inches, past the margin.", 1100);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await replaceField(page, "Header from edge", "1.5");
  const past = setup.getByText(
    "The header is inside the text area, so the text moves down below it. The top margin does not change.",
  );
  await past.scrollIntoViewIfNeeded();
  await expect(past).toBeVisible();
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");
  await caption(
    page,
    "The note says the header is inside the text, so the title moves down. The margin still says 1 inch.",
    2400,
  );
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await showTop(page);
  const into = await places(page);
  near(into.headerTop, 1.5);
  expect(into.textTop).toBeGreaterThan(into.headerBottom);
  expect(into.padTop).toBeGreaterThan(1.5);
  if (paper)
    await page.mouse.move(paper.x + 160, paper.y + into.textTop * 96 + 8, { steps: 12 });
  await caption(
    page,
    "Town council moved down, and Minutes starts below it. The top margin did not change.",
    2200,
  );

  await caption(
    page,
    "She puts the header back at 1 inch, then fills the page so the notes meet the footer.",
    1400,
  );
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await replaceField(page, "Header from edge", "1");
  await expect(setup.getByLabel("Footer from edge")).toHaveValue("1");
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await editor.click();
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.insertText(
    `\n${Array.from({ length: 36 }, (_, index) => `Hearing note ${index + 1}.`).join("\n")}`,
  );
  await beat(page, 600);
  await showFooter(page);
  const footerEven = await places(page);
  near(footerEven.footerBottom, 1);
  expect(footerEven.padBottom).toBeGreaterThan(1.1);
  expect(footerEven.gap).not.toBeNull();
  expect(footerEven.gap!).toBeGreaterThan(0.05);
  await caption(
    page,
    "The footer follows the same rule. Hearing notes has its own line. The bottom margin is still 1 inch.",
    2400,
  );

  await caption(page, "Footer from edge at 0.5 inches fits inside the margin.", 1100);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await replaceField(page, "Footer from edge", "0.5");
  await expect(setup.getByText(/footer reaches the text/)).toHaveCount(0);
  await expect(setup.getByLabel("Bottom margin")).toHaveValue("1");
  await expect(setup.getByLabel("Header from edge")).toHaveValue("1");
  await beat(page, 400);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await showFooter(page);
  const footerHalf = await places(page);
  near(footerHalf.footerBottom, 0.5);
  near(footerHalf.padBottom, 1);
  await caption(
    page,
    "Only the footer moves toward the edge. The notes stay an inch from the bottom.",
    2200,
  );

  await caption(page, "She sets Footer from edge to 1.5 inches, past the margin.", 1100);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await replaceField(page, "Footer from edge", "1.5");
  const footerPast = setup.getByText(
    "The footer is inside the text area, so the text moves up above it. The bottom margin does not change.",
  );
  await setup.getByLabel("Bottom margin").scrollIntoViewIfNeeded();
  await expect(setup.getByLabel("Bottom margin")).toHaveValue("1");
  await caption(page, "The bottom margin still says 1 inch.", 1500);
  await footerPast.scrollIntoViewIfNeeded();
  await expect(footerPast).toBeVisible();
  await footerPast.hover();
  await caption(
    page,
    "The note says the footer is inside the text, so the notes move up.",
    2200,
  );
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await showFooter(page);
  const footerInto = await places(page);
  near(footerInto.footerBottom, 1.5);
  expect(footerInto.padBottom).toBeGreaterThan(1.5);
  expect(footerInto.gap).not.toBeNull();
  expect(footerInto.gap!).toBeGreaterThan(0.05);
  await caption(
    page,
    "Hearing notes moved up, and the notes stop above it. The margin did not change.",
    2000,
  );

  await caption(
    page,
    "She sets both distances back to 1 inch, then reopens the file.",
    1200,
  );
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await replaceField(page, "Footer from edge", "1");
  await expect(setup.getByLabel("Header from edge")).toHaveValue("1");
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");
  await expect(setup.getByLabel("Bottom margin")).toHaveValue("1");
  await beat(page, 400);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await expect(page.locator(".save-status")).toContainText("Saved");
  await showTop(page);
  await beat(page, 300);

  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await beat(page, 700);
  await page.getByRole("link", { name: "Minutes" }).click();
  await expect(editor).toContainText("Minutes");
  await showTop(page);
  const kept = await places(page);
  near(kept.headerTop, 1);
  expect(kept.textTop).toBeGreaterThan(kept.headerBottom);
  expect(kept.padTop).toBeGreaterThan(1.1);
  near(kept.footerBottom, 1);
  expect(kept.padBottom).toBeGreaterThan(1.1);
  const again = await page.locator(".paginated-paper").boundingBox();
  if (again)
    await page.mouse.move(again.x + 200, again.y + kept.textTop * 96 + 12, { steps: 12 });
  await caption(
    page,
    "Saved and reopened. Town council is still above Minutes, not beside it.",
    2400,
  );
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await liftDialog(page);
  await showMarginAndNote(page, "Top margin", "reaches the text");
  await expect(setup.getByLabel("Header from edge")).toHaveValue("1");
  await expect(setup.getByLabel("Footer from edge")).toHaveValue("1");
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");
  await expect(setup.getByLabel("Bottom margin")).toHaveValue("1");
  await caption(
    page,
    "Header and footer are still 1 inch from the edge. Both margins are still 1 inch.",
    2400,
  );
});
