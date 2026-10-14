import type { Page } from "@playwright/test";
import { createFile, serializeFile, type DocFile } from "../../packages/core/src";
import { beat, caption, expect, test, typeSlowly } from "./harness";

const inch = (n: number) => n * 96;

function minutes(): DocFile {
  const file = createFile("doc", "Minutes") as DocFile;
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
        header: "Draft minutes",
        footer: "",
        headerFromEdge: inch(0.5),
        footerFromEdge: inch(0.5),
        pageNumbers: true,
        pageNumberFormat: "page",
        pageNumberPosition: "top-right",
        pageNumberPositionSet: true,
        pageNumberStart: 1,
      },
    },
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Minutes" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "The hearing opens at seven." }],
      },
      { type: "pageBreak" },
      {
        type: "paragraph",
        content: [{ type: "text", text: "The vote is next week." }],
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

async function chipsTogether(page: Page, fraction: string, pageLabel: string) {
  const dialog = page.getByRole("dialog", { name: "Page setup" });
  const fractionChip = dialog.getByRole("radio", { name: fraction, exact: true });
  const pageChip = dialog.getByRole("radio", { name: pageLabel, exact: true });
  const start = dialog.getByRole("spinbutton", { name: "Start at" });
  const apply = dialog.getByRole("button", { name: "Apply", exact: true });
  await expect(fractionChip).toBeInViewport();
  await expect(pageChip).toBeInViewport();
  await expect(start).toBeInViewport();
  await expect(apply).toBeInViewport();
  await expect(pageChip).toBeChecked();
  const clear = await page.evaluate(({ fractionText, pageText }) => {
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
    return (
      window.innerHeight === 800 &&
      inside(fractionEl) &&
      inside(pageEl) &&
      inside(startEl) &&
      inside(applyEl) &&
      clearOfCaption(fractionEl) &&
      clearOfCaption(pageEl) &&
      clearOfCaption(startEl) &&
      clearOfCaption(applyEl) &&
      !overlap(fractionEl, pageEl) &&
      !overlap(fractionEl, startEl) &&
      !overlap(pageEl, startEl) &&
      !overlap(fractionEl, applyEl) &&
      !overlap(pageEl, applyEl) &&
      !overlap(startEl, applyEl)
    );
  }, { fractionText: fraction, pageText: pageLabel });
  expect(clear).toBe(true);
  return pageChip;
}

async function replaceStart(page: Page, value: string) {
  const start = page.getByRole("spinbutton", { name: "Start at" });
  await start.click();
  await beat(page, 250);
  await start.selectText();
  await beat(page, 200);
  await typeSlowly(page, value, 160);
}

test("117-show-the-start-on-the-chips", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Minutes.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(minutes())),
  });
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toContainText("The hearing opens at seven.");
  await expect(page.locator(".editor-status")).toContainText("2 pages");
  await expect.poll(() => numbers(page)).toEqual(["Page 1", "Page 2"]);

  await showPageTop(page, 0);
  await readableNumber(page, 0);
  await say(page, "Sam's minutes follow 11 pages of front matter. This page says Page 1.", 2200);

  let setup = await openSetup(page);
  await showPageTop(page, 0);
  await expect(setup.getByRole("spinbutton", { name: "Start at" })).toHaveValue("1");
  const opening = await chipsTogether(page, "1 / 2", "Page 1");
  await opening.hover();
  await readableNumber(page, 0);
  await say(
    page,
    "She opens Page setup. The chips say 1 / 2 and Page 1. Page 1 is selected, and the page agrees.",
    2800,
  );

  await say(page, "She sets Start at to 12.", 700);
  await replaceStart(page, "12");
  await expect(setup.getByRole("spinbutton", { name: "Start at" })).toHaveValue("12");
  await expect.poll(() => numbers(page)).toEqual(["Page 12", "Page 13"]);
  await showPageTop(page, 0);
  const started = await chipsTogether(page, "12 / 13", "Page 12");
  await started.hover();
  await readableNumber(page, 0);
  await expect(setup).toBeVisible();
  await expect(page.locator(".paginated-paper .page-number").nth(1)).toHaveText("Page 13");
  await say(
    page,
    "Before Apply, the chips say 12 / 13 and Page 12. The page says Page 12.",
    2800,
  );

  await say(page, "She sets Start at to 3.", 700);
  await replaceStart(page, "3");
  await expect(setup.getByRole("spinbutton", { name: "Start at" })).toHaveValue("3");
  await expect.poll(() => numbers(page)).toEqual(["Page 3", "Page 4"]);
  const stepped = await chipsTogether(page, "3 / 4", "Page 3");
  await stepped.hover();
  await readableNumber(page, 0);
  await say(page, "Both chips follow. They say 3 / 4 and Page 3, still before Apply.", 2600);

  await say(page, "She tries 0.", 600);
  await replaceStart(page, "0");
  const start = setup.getByRole("spinbutton", { name: "Start at" });
  await expect(start).toHaveValue("0");
  await expect(setup.locator("#page-numbers-hint")).toHaveText(
    "Numbering starts at 1 or later. The page stays on Page 3.",
  );
  await expect.poll(() => numbers(page)).toEqual(["Page 3", "Page 4"]);
  await chipsTogether(page, "3 / 4", "Page 3");
  await readableNumber(page, 0);
  await say(page, "Zero does not change the chips. They stay on 3, and the page stays on Page 3.", 2800);

  await say(page, "She sets 12 again.", 600);
  await replaceStart(page, "12");
  await expect.poll(() => numbers(page)).toEqual(["Page 12", "Page 13"]);
  await chipsTogether(page, "12 / 13", "Page 12");
  await readableNumber(page, 0);
  await say(page, "The chips say 12 / 13 and Page 12 again. She applies.", 1800);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await expect.poll(() => numbers(page)).toEqual(["Page 12", "Page 13"]);
  await showPageTop(page, 0);
  await readableNumber(page, 0);
  await say(page, "Apply keeps Page 12.", 1800);

  await say(page, "She closes the file, then opens it again.", 900);
  await expect(page.locator(".save-status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await beat(page, 500);
  await page.getByRole("link", { name: "Minutes" }).click();
  await expect(editor).toContainText("The hearing opens at seven.");
  await expect.poll(() => numbers(page)).toEqual(["Page 12", "Page 13"]);
  await showPageTop(page, 0);
  await readableNumber(page, 0);
  await say(page, "Saved and reopened. The page still starts at Page 12.", 2000);

  setup = await openSetup(page);
  await showPageTop(page, 0);
  await expect(setup.getByRole("spinbutton", { name: "Start at" })).toHaveValue("12");
  const kept = await chipsTogether(page, "12 / 13", "Page 12");
  await kept.hover();
  await readableNumber(page, 0);
  await say(page, "The chips still say 12 / 13 and Page 12.", 2600);
});
