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
    const title = content.querySelector("h1") as HTMLElement;
    const pageBox = sheet.getBoundingClientRect();
    const zoom = paper.getBoundingClientRect().width / paper.offsetWidth || 1;
    const fromTop = (el: HTMLElement) =>
      (el.getBoundingClientRect().top - pageBox.top) / zoom / 96;
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
      footerBottom: (pageBox.bottom - footer.getBoundingClientRect().bottom) / zoom / 96,
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

async function noScroll(
  page: Page,
  keep: { field: string; note?: string },
) {
  const setup = page.getByRole("dialog", { name: "Page setup" });
  const body = setup.locator(".dialog-body");
  const narrow = (page.viewportSize()?.width ?? 1000) <= 700;
  if (!narrow) {
    const metrics = await body.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);
    return;
  }
  await body.evaluate((el, args) => {
    const target = args.note
      ? [...el.querySelectorAll("p")].find((node) => node.textContent?.includes(args.note!))
      : el.querySelector(`[aria-label="${args.field}"]`);
    const pair =
      target?.closest(".measure-pair") ??
      target?.closest("label") ??
      target;
    if (!(pair instanceof HTMLElement)) return;
    const box = el.getBoundingClientRect();
    const rect = pair.getBoundingClientRect();
    if (rect.top < box.top + 4 || rect.bottom > box.bottom - 4)
      el.scrollTop += rect.top - box.top - Math.max(8, (box.height - rect.height) / 2);
  }, keep);
  const visible = await body.evaluate((el, args) => {
    const box = el.getBoundingClientRect();
    const inside = (node: Element | null) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      return rect.height > 0 && rect.top >= box.top - 2 && rect.bottom <= box.bottom + 2;
    };
    const note = args.note
      ? [...el.querySelectorAll("p")].find((node) => node.textContent?.includes(args.note!)) ?? null
      : null;
    return {
      note: args.note ? inside(note) : true,
      field: inside(el.querySelector(`[aria-label="${args.field}"]`)),
    };
  }, keep);
  expect(visible.field, keep.field).toBe(true);
  expect(visible.note, keep.note ?? keep.field).toBe(true);
  await expect(setup.getByRole("button", { name: "Apply", exact: true })).toBeInViewport();
  await expect(setup.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport();
}

test("94-see-the-margin-and-the-reason", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Sam is laying out the minutes. The footer will sit past the margin.", 1700);
  await page.getByRole("button", { name: "New document" }).click();
  const title = page.getByLabel("File title");
  await title.click();
  await title.press("ControlOrMeta+A");
  await typeSlowly(page, "Minutes");
  const editor = editorOf(page);
  await editor.click();
  await page.getByLabel("Paragraph style").selectOption("1");
  await typeSlowly(page, "Minutes", 70);
  await editor.press("Enter");
  await typeSlowly(page, "The hearing opens at seven.", 28);
  await expect(page.locator(".save-status")).toContainText("Saved");
  await beat(page, 300);

  await caption(page, "Page setup. A 1 inch margin, and a header and footer.", 1400);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Page setup" });
  await expect(setup).toBeVisible();
  for (const label of ["Top margin", "Bottom margin", "Left margin", "Right margin"]) {
    await setup.getByLabel(label).fill("1");
    await beat(page, 180);
  }
  const header = setup.getByLabel("Page header");
  await header.click();
  await typeSlowly(page, "Town council", 40);
  await beat(page, 200);
  const footer = setup.getByLabel("Page footer");
  await footer.click();
  await typeSlowly(page, "Hearing notes", 40);
  await beat(page, 250);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await editor.click();
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.insertText(
    `\n${Array.from({ length: 40 }, (_, index) => `Hearing note ${index + 1}.`).join("\n")}`,
  );
  await beat(page, 500);
  await showFooter(page);
  await caption(page, "The notes reach the footer. Hearing notes sits above them.", 1800);

  await caption(page, "She sets Footer from edge to 1.5 inches.", 1200);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expect(setup).toBeVisible();
  const footerDistance = setup.getByLabel("Footer from edge");
  await footerDistance.click();
  await footerDistance.press("ControlOrMeta+A");
  await beat(page, 200);
  await typeSlowly(page, "0.2", 160);
  await expect(setup.getByText("at least 0.25 inches")).toBeVisible();
  await expect(setup.getByRole("button", { name: "Apply", exact: true })).toBeDisabled();
  await expect(setup.getByLabel("Bottom margin")).toHaveValue("1");
  await caption(page, "Under 0.25 inches, Apply stays off. Bottom is still 1 inch.", 2000);

  await footerDistance.click();
  await footerDistance.press("ControlOrMeta+A");
  await beat(page, 200);
  await typeSlowly(page, "1.5", 180);
  const footerNote = setup.getByText(
    "The footer is inside the text area, so the text moves up above it. The bottom margin does not change.",
  );
  await expect(footerNote).toBeVisible();
  await expect(setup.getByLabel("Bottom margin")).toHaveValue("1");
  await expect(setup.getByLabel("Footer from edge")).toHaveValue("1.5");
  await noScroll(page, {
    field: "Bottom margin",
    note: "The footer is inside the text area",
  });
  await footerNote.hover();
  await beat(page, 300);
  await setup.getByLabel("Bottom margin").hover();
  await caption(
    page,
    "The note and Bottom are on screen together. The margin is still 1 inch.",
    2400,
  );
  await expect(setup.getByRole("button", { name: "Apply", exact: true })).toBeEnabled();
  await expect(setup.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  await setup.getByRole("button", { name: "Apply", exact: true }).hover();
  await caption(page, "Apply and Cancel stay on screen. She applies.", 1600);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await showFooter(page);
  const pushed = await places(page);
  near(pushed.footerBottom, 1.5);
  expect(pushed.padBottom).toBeGreaterThan(1.5);
  expect(pushed.gap).not.toBeNull();
  expect(pushed.gap!).toBeGreaterThan(0.05);
  await caption(page, "The footer moved in, and the notes stop above it.", 2000);

  await caption(page, "She sets Header from edge to 1.5 inches.", 1200);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const headerDistance = setup.getByLabel("Header from edge");
  await headerDistance.click();
  await headerDistance.press("ControlOrMeta+A");
  await beat(page, 200);
  await typeSlowly(page, "1.5", 180);
  const headerNote = setup.getByText(
    "The header is inside the text area, so the text moves down below it. The top margin does not change.",
  );
  await expect(headerNote).toBeVisible();
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");
  await expect(setup.getByLabel("Header from edge")).toHaveValue("1.5");
  await noScroll(page, {
    field: "Top margin",
    note: "The header is inside the text area",
  });
  await headerNote.hover();
  await beat(page, 250);
  await setup.getByLabel("Top margin").hover();
  await caption(page, "That note and Top are both visible. Top still says 1 inch.", 2200);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await showTop(page);
  const into = await places(page);
  near(into.headerTop, 1.5);
  expect(into.textTop).toBeGreaterThan(into.headerBottom);
  expect(into.padTop).toBeGreaterThan(1.5);
  await caption(page, "Town council moved down. Minutes starts below it.", 2000);

  await caption(page, "A half inch fits inside the 1 inch margin.", 1200);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await setup.getByLabel("Header from edge").fill("0.5");
  await beat(page, 400);
  await expect(setup.getByText(/header is inside the text area/)).toHaveCount(0);
  await expect(setup.getByText(/header reaches the text/)).toHaveCount(0);
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");
  await noScroll(page, { field: "Header from edge" });
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await showTop(page);
  const half = await places(page);
  near(half.headerTop, 0.5);
  near(half.textTop, 1);
  near(half.padTop, 1);
  const paper = await page.locator(".paginated-paper").boundingBox();
  if (paper) {
    await page.mouse.move(paper.x + 220, paper.y + 70, { steps: 12 });
    await beat(page, 350);
    await page.mouse.move(paper.x + 240, paper.y + 130, { steps: 10 });
  }
  await caption(page, "Only the header moves up. Minutes stays at 1 inch.", 2600);
});
