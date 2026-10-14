import { expect, test, type Page } from "@playwright/test";
import { createFile, serializeFile, type DocFile } from "../../packages/core/src";

const inch = (n: number) => n * 96;

function minutes(): DocFile {
  const file = createFile("doc", "Minutes") as DocFile;
  const paragraph = (text: string) => ({
    type: "paragraph",
    content: [{ type: "text", text }],
  });
  file.content = {
    type: "doc",
    attrs: {
      pageSettings: {
        margin: inch(1),
        marginTop: inch(1),
        marginBottom: inch(1),
        marginLeft: inch(1),
        marginRight: inch(1),
        header: "Town council",
        footer: "Hearing notes",
        headerFromEdge: inch(0.75),
        footerFromEdge: inch(0.75),
        pageNumbers: false,
      },
    },
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Minutes" }] },
      ...Array.from({ length: 36 }, (_, index) =>
        paragraph(`Hearing note ${index + 1} stays clear of the footer.`),
      ),
    ],
  };
  return file;
}

async function openMinutes(page: Page) {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Minutes.sldoc",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(minutes())),
  });
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
    "Minutes",
  );
}

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

async function openSetup(page: Page) {
  const button = page.getByRole("button", { name: "Page setup", exact: true });
  if (!(await button.isVisible())) {
    await page.getByRole("button", { name: "More tools", exact: true }).click();
    await expect(button).toBeVisible();
  }
  await button.click();
  const dialog = page.getByRole("dialog", { name: "Page setup" });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** The laptop dialog shows the distance, its explanation, and the margin without scrolling. */
async function pairVisible(page: Page, margin: string, distance: string, note: string) {
  const dialog = page.getByRole("dialog", { name: "Page setup" });
  const body = dialog.locator(".dialog-body");
  const metrics = await body.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);

  const marginField = dialog.getByLabel(margin);
  const distanceField = dialog.getByLabel(distance);
  const explanation = dialog.getByText(note);
  await expect(marginField).toBeInViewport();
  await expect(distanceField).toBeInViewport();
  await expect(explanation).toBeInViewport();
  await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toBeInViewport();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport();

  const layout = await page.evaluate(
    ({ marginLabel, distanceLabel, noteText }) => {
      const marginEl = document.querySelector(`[aria-label="${marginLabel}"]`) as HTMLElement;
      const distanceEl = document.querySelector(
        `[aria-label="${distanceLabel}"]`,
      ) as HTMLElement;
      const noteEl = [...document.querySelectorAll("p")].find((item) =>
        item.textContent?.includes(noteText),
      ) as HTMLElement;
      const box = (el: HTMLElement) => el.getBoundingClientRect();
      const a = box(marginEl);
      const b = box(distanceEl);
      const n = box(noteEl);
      const overlaps = (p: DOMRect, q: DOMRect) =>
        p.top < q.bottom - 1 &&
        p.bottom > q.top + 1 &&
        p.left < q.right - 1 &&
        p.right > q.left + 1;
      const hit = (el: HTMLElement) => {
        const r = box(el);
        const node = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return node === el || el.contains(node);
      };
      return {
        sameRow: Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < 8,
        noteBelow: n.top >= a.bottom - 2 && n.top >= b.bottom - 2,
        marginClear: !overlaps(a, n) && hit(marginEl),
        distanceClear: !overlaps(b, n) && hit(distanceEl),
      };
    },
    { marginLabel: margin, distanceLabel: distance, noteText: note },
  );
  expect(layout.sameRow).toBe(true);
  expect(layout.noteBelow).toBe(true);
  expect(layout.marginClear).toBe(true);
  expect(layout.distanceClear).toBe(true);
}

test("page setup shows the margin and the reason together", async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openMinutes(page);
  const before = await places(page);
  near(before.headerTop, 0.75);
  near(before.textTop, 1);

  let dialog = await openSetup(page);
  await dialog.getByLabel("Footer from edge").fill("0.2");
  await expect(dialog.getByText("at least 0.25 inches")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("Bottom margin")).toHaveValue("1");
  await expect(dialog.getByLabel("Bottom margin")).toBeInViewport();

  await dialog.getByLabel("Footer from edge").fill("1.5");
  await dialog.getByLabel("Header from edge").fill("1.5");
  await expect(dialog.getByLabel("Bottom margin")).toHaveValue("1");
  await expect(dialog.getByLabel("Top margin")).toHaveValue("1");
  await pairVisible(
    page,
    "Bottom margin",
    "Footer from edge",
    "The footer is inside the text area, so the text moves up above it. The bottom margin does not change.",
  );
  await pairVisible(
    page,
    "Top margin",
    "Header from edge",
    "The header is inside the text area, so the text moves down below it. The top margin does not change.",
  );
  await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(dialog).toBeHidden();

  const pushed = await places(page);
  near(pushed.footerBottom, 1.5);
  near(pushed.headerTop, 1.5);
  expect(pushed.padBottom).toBeGreaterThan(1.5);
  expect(pushed.padTop).toBeGreaterThan(1.5);
  expect(pushed.textTop).toBeGreaterThan(pushed.headerBottom);
  expect(pushed.gap).not.toBeNull();
  expect(pushed.gap!).toBeGreaterThan(0.05);

  dialog = await openSetup(page);
  await expect(dialog.getByLabel("Bottom margin")).toHaveValue("1");
  await expect(dialog.getByLabel("Top margin")).toHaveValue("1");
  await dialog.getByLabel("Header from edge").fill("0.5");
  await expect(dialog.getByText(/header is inside the text area/)).toHaveCount(0);
  await expect(dialog.getByText(/header reaches the text/)).toHaveCount(0);
  await expect(dialog.getByLabel("Top margin")).toHaveValue("1");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(dialog).toBeHidden();

  const half = await places(page);
  near(half.headerTop, 0.5);
  near(half.textTop, 1);
  near(half.padTop, 1);
  near(half.footerBottom, 1.5);
  expect(half.padBottom).toBeGreaterThan(1.5);
});

test("a phone-width page setup can scroll to every field", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await openMinutes(page);
  const dialog = await openSetup(page);
  await dialog.getByLabel("Footer from edge").fill("1.5");
  await dialog.getByLabel("Header from edge").fill("1.5");
  const body = dialog.locator(".dialog-body");
  const taller = await body.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
  expect(taller).toBe(true);

  for (const label of [
    "Top margin",
    "Bottom margin",
    "Left margin",
    "Right margin",
    "Header from edge",
    "Footer from edge",
    "Page header",
    "Page footer",
  ]) {
    const field = dialog.getByLabel(label);
    await field.scrollIntoViewIfNeeded();
    await expect(field).toBeInViewport();
  }
  const footerNote = dialog.getByText("The footer is inside the text area");
  await footerNote.scrollIntoViewIfNeeded();
  await expect(footerNote).toBeInViewport();
  const headerNote = dialog.getByText("The header is inside the text area");
  await headerNote.scrollIntoViewIfNeeded();
  await expect(headerNote).toBeInViewport();
  await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toBeInViewport();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport();
});
