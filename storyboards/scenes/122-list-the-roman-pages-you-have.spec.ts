import type { Page } from "@playwright/test";
import { createFile, serializeFile, type DocFile } from "../../packages/core/src";
import { beat, caption, expect, test, typeSlowly } from "./harness";

const inch = (n: number) => n * 96;

function preface(): DocFile {
  const file = createFile("doc", "Preface") as DocFile;
  file.content = {
    type: "doc",
    attrs: {
      pageSettings: {
        size: "letter",
        landscape: false,
        margin: inch(1),
        marginTop: inch(1),
        marginBottom: inch(1),
        marginLeft: inch(1),
        marginRight: inch(1),
        header: "",
        footer: "",
        headerFromEdge: inch(0.5),
        footerFromEdge: inch(0.5),
        pageNumbers: true,
        pageNumberFormat: "page",
        pageNumberPosition: "top-right",
        pageNumberPositionSet: true,
        pageNumberStart: 4,
      },
    },
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Introduction" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "The front matter fits on this page." }],
      },
      { type: "pageBreak" },
      {
        type: "paragraph",
        content: [{ type: "text", text: "The notes end here." }],
      },
    ],
  };
  return file;
}

async function say(page: Page, text: string, hold: number) {
  await caption(page, text, 0);
  await page.evaluate(() => {
    const bar = document.getElementById("storyboard-caption") as HTMLElement | null;
    if (!bar) return;
    bar.style.top = "auto";
    bar.style.bottom = "24px";
    bar.style.left = "50%";
    bar.style.right = "auto";
    bar.style.transform = "translateX(-50%)";
    bar.style.maxWidth = "760px";
    bar.style.textAlign = "center";
  });
  await beat(page, hold);
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

async function closeSetup(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Page setup" });
  await dialog.getByRole("button", { name: "Close page setup" }).click();
  await expect(dialog).toBeHidden();
  await beat(page, 400);
}

async function numbers(page: Page) {
  return page.locator(".paginated-paper .page-number").allTextContents();
}

async function showPageTop(page: Page, index: number) {
  const face = page.locator(".page-furniture-page").nth(index);
  await face.evaluate((el) => {
    const stage = el.closest(".document-stage") as HTMLElement;
    const stageBox = stage.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    stage.scrollTo({
      top: Math.max(0, stage.scrollTop + (box.top - stageBox.top) - 8),
      behavior: "auto",
    });
  });
  await beat(page, 450);
}

async function readableNumber(page: Page, index: number) {
  const el = page.locator(".paginated-paper .page-number").nth(index);
  const box = await el.boundingBox();
  expect(box, `page number ${index}`).toBeTruthy();
  expect(box!.height).toBeGreaterThan(10);
  expect(box!.y).toBeGreaterThan(64);
  expect(box!.y + box!.height).toBeLessThan(690);
  return box!;
}

/** The format chips, Start at, and Apply stay readable together. */
async function chipsTogether(
  page: Page,
  fraction: string,
  pageLabel: string,
  roman: string,
) {
  const dialog = page.getByRole("dialog", { name: "Page setup" });
  const fractionChip = dialog.getByRole("radio", { name: fraction, exact: true });
  const pageChip = dialog.getByRole("radio", { name: pageLabel, exact: true });
  const romanChip = dialog.getByRole("radio", { name: roman, exact: true });
  const start = dialog.getByRole("spinbutton", { name: "Start at" });
  const apply = dialog.getByRole("button", { name: "Apply", exact: true });
  await expect(fractionChip).toBeInViewport();
  await expect(pageChip).toBeInViewport();
  await expect(romanChip).toBeInViewport();
  await expect(start).toBeInViewport();
  await expect(apply).toBeInViewport();
  const clear = await page.evaluate(
    ({ fractionText, pageText, romanText }) => {
      const box = (el: Element) => el.getBoundingClientRect();
      const dialogEl = document.querySelector(".page-setup-dialog") as HTMLElement;
      const format = [...dialogEl.querySelectorAll("fieldset")].find(
        (field) => field.querySelector("legend")?.textContent === "Format",
      ) as HTMLElement;
      const chip = (text: string) =>
        [...format.querySelectorAll("label")].find(
          (label) => label.textContent?.trim() === text,
        ) as HTMLElement;
      const fractionEl = chip(fractionText);
      const pageEl = chip(pageText);
      const romanEl = chip(romanText);
      const startEl = dialogEl.querySelector("[aria-label='Start at']") as HTMLElement;
      const applyEl = [...dialogEl.querySelectorAll("button")].find(
        (button) => button.textContent === "Apply",
      ) as HTMLElement;
      const host = box(dialogEl);
      const inside = (el: HTMLElement) => {
        const r = box(el);
        return (
          r.width > 24 &&
          r.height > 16 &&
          r.top >= host.top - 1 &&
          r.bottom <= host.bottom + 1 &&
          r.left >= host.left - 1 &&
          r.right <= host.right + 1 &&
          r.top >= -1 &&
          r.bottom <= window.innerHeight - 8 &&
          el.scrollWidth <= el.clientWidth + 1
        );
      };
      const overlap = (a: HTMLElement, b: HTMLElement) => {
        const ra = box(a);
        const rb = box(b);
        return (
          ra.left < rb.right - 1 &&
          ra.right > rb.left + 1 &&
          ra.top < rb.bottom - 1 &&
          ra.bottom > rb.top + 1
        );
      };
      const captionBar = document.getElementById("storyboard-caption");
      const clearOfCaption = (el: HTMLElement) => {
        if (!captionBar) return true;
        return !overlap(el, captionBar);
      };
      const chips = [fractionEl, pageEl, romanEl];
      return (
        window.innerHeight === 800 &&
        chips.every((el) => inside(el) && clearOfCaption(el)) &&
        inside(startEl) &&
        inside(applyEl) &&
        clearOfCaption(startEl) &&
        clearOfCaption(applyEl) &&
        !overlap(fractionEl, pageEl) &&
        !overlap(pageEl, romanEl) &&
        !overlap(fractionEl, romanEl) &&
        chips.every((el) => !overlap(el, startEl) && !overlap(el, applyEl)) &&
        !overlap(startEl, applyEl)
      );
    },
    { fractionText: fraction, pageText: pageLabel, romanText: roman },
  );
  expect(clear).toBe(true);
  return romanChip;
}

async function addPage(page: Page, text: string) {
  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.click();
  await beat(page, 250);
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End",
  );
  await beat(page, 200);
  const button = page.getByRole("button", { name: "Page break", exact: true });
  if (!(await button.isVisible())) {
    await page.getByRole("button", { name: "More tools", exact: true }).click();
    await expect(button).toBeVisible();
  }
  await button.click();
  await beat(page, 350);
  await typeSlowly(page, text, 55);
  await beat(page, 400);
}

test("122-list-the-roman-pages-you-have", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Preface.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(preface())),
  });
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toContainText("The notes end here.");
  await expect(page.locator(".editor-status")).toContainText("2 pages");
  await expect.poll(() => numbers(page)).toEqual(["Page 4", "Page 5"]);
  await showPageTop(page, 0);
  await readableNumber(page, 0);
  await say(
    page,
    "Sam's preface is two pages. It starts at 4, so these pages say Page 4 and Page 5.",
    2800,
  );

  let setup = await openSetup(page);
  await showPageTop(page, 0);
  await expect(setup.getByRole("spinbutton", { name: "Start at" })).toHaveValue("4");
  await expect(setup.getByRole("radio", { name: "iv, v, vi", exact: true })).toHaveCount(0);
  const two = await chipsTogether(page, "4 / 5", "Page 4", "iv, v");
  await two.hover();
  await readableNumber(page, 0);
  await say(
    page,
    "The roman chip says iv, v. There is no vi. The count is still 4 / 5.",
    3400,
  );

  await two.click();
  await expect(two).toBeChecked();
  await expect.poll(() => numbers(page)).toEqual(["iv", "v"]);
  await showPageTop(page, 0);
  await readableNumber(page, 0);
  await expect(setup).toBeVisible();
  await say(page, "She selects that chip. Before Apply, the first page says iv.", 2400);
  await showPageTop(page, 1);
  const second = page.locator(".paginated-paper .page-number").nth(1);
  await expect(second).toHaveText("v");
  await expect(second).toBeInViewport();
  await readableNumber(page, 1);
  await say(page, "The last page says v. The chip stops there. It does not add vi.", 2600);

  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await expect.poll(() => numbers(page)).toEqual(["iv", "v"]);
  await showPageTop(page, 0);
  await readableNumber(page, 0);
  await say(page, "Apply keeps roman numbering on the two pages she has.", 2000);

  await say(page, "She closes the file, then opens it again.", 900);
  await expect(page.locator(".save-status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await beat(page, 500);
  await page.getByRole("link", { name: "Preface" }).click();
  await expect(editor).toContainText("The front matter fits on this page.");
  await expect.poll(() => numbers(page)).toEqual(["iv", "v"]);
  await showPageTop(page, 0);
  await readableNumber(page, 0);
  await say(page, "Saved and reopened. The first page still says iv.", 2000);

  setup = await openSetup(page);
  await showPageTop(page, 0);
  const kept = await chipsTogether(page, "4 / 5", "Page 4", "iv, v");
  await kept.hover();
  await expect(kept).toBeChecked();
  await readableNumber(page, 0);
  await say(page, "The chip still says iv, v. It did not grow a vi.", 2800);
  await closeSetup(page);

  await say(page, "She selects the second page and deletes it.", 900);
  await editor.locator(":scope > p").last().click({ clickCount: 3 });
  await beat(page, 600);
  await page.keyboard.press("Backspace");
  await beat(page, 500);
  await page.keyboard.press("Backspace");
  await expect(page.locator(".editor-status")).toContainText("1 page");
  await expect.poll(() => numbers(page)).toEqual(["iv"]);
  await showPageTop(page, 0);
  await readableNumber(page, 0);
  await say(page, "One page remains, and it says iv.", 1800);

  setup = await openSetup(page);
  await showPageTop(page, 0);
  const one = await chipsTogether(page, "4 / 4", "Page 4", "iv");
  await one.hover();
  await expect(one).toBeChecked();
  await expect(setup.locator("#page-numbers-hint")).toContainText("only page");
  await readableNumber(page, 0);
  await say(page, "The chip says iv, and it stops there.", 2800);
  await closeSetup(page);

  await say(page, "She adds two pages, so the preface has three.", 900);
  await addPage(page, "A third page.");
  await addPage(page, "More notes.");
  await expect(page.locator(".editor-status")).toContainText("3 pages");
  await expect.poll(() => numbers(page)).toEqual(["iv", "v", "vi"]);
  await showPageTop(page, 2);
  await readableNumber(page, 2);
  await say(page, "The last page says vi.", 1600);

  setup = await openSetup(page);
  const three = await chipsTogether(page, "4 / 6", "Page 4", "iv, v, vi");
  await three.hover();
  await expect(three).toBeChecked();
  await showPageTop(page, 0);
  await readableNumber(page, 0);
  await showPageTop(page, 2);
  await expect(page.locator(".paginated-paper .page-number").nth(2)).toHaveText("vi");
  await readableNumber(page, 2);
  await expect(setup.getByRole("button", { name: "Apply", exact: true })).toBeVisible();
  await say(
    page,
    "Three pages. Before Apply, the chip says iv, v, vi, and the last page says vi.",
    3400,
  );
  await closeSetup(page);

  await say(page, "Two more pages. A long preface should not list every numeral.", 1200);
  await addPage(page, "The sources.");
  await addPage(page, "The index.");
  await expect(page.locator(".editor-status")).toContainText("5 pages");
  await expect.poll(() => numbers(page)).toEqual(["iv", "v", "vi", "vii", "viii"]);

  setup = await openSetup(page);
  const long = await chipsTogether(page, "4 / 8", "Page 4", "iv … viii");
  await long.hover();
  await expect(long).toBeChecked();
  await showPageTop(page, 0);
  await expect(page.locator(".paginated-paper .page-number").nth(0)).toHaveText("iv");
  await readableNumber(page, 0);
  await say(page, "The chip keeps the first number, iv, then an ellipsis.", 2200);
  await showPageTop(page, 4);
  await expect(page.locator(".paginated-paper .page-number").nth(4)).toHaveText("viii");
  await readableNumber(page, 4);
  await expect(setup).toBeVisible();
  await say(
    page,
    "And the last, viii. Five pages read iv … viii. The count is 4 / 8.",
    3400,
  );
});
