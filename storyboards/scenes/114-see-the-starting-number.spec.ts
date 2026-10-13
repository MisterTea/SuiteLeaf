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

async function controlsTogether(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Page setup" });
  const format = dialog.getByRole("group", { name: "Format" });
  const start = dialog.getByRole("spinbutton", { name: "Start at" });
  const apply = dialog.getByRole("button", { name: "Apply", exact: true });
  await expect(format).toBeInViewport();
  await expect(start).toBeInViewport();
  await expect(apply).toBeInViewport();
  const clear = await page.evaluate(() => {
    const box = (el: Element) => el.getBoundingClientRect();
    const dialogEl = document.querySelector(".page-setup-dialog") as HTMLElement;
    const formatEl = [...dialogEl.querySelectorAll("fieldset")].find(
      (field) => field.querySelector("legend")?.textContent === "Format",
    ) as HTMLElement;
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
        r.top >= -1 &&
        r.bottom <= window.innerHeight - 8 &&
        r.top >= host.top - 1 &&
        r.bottom <= host.bottom + 1 &&
        r.left >= host.left - 1 &&
        r.right <= host.right + 1
      );
    };
    return window.innerHeight === 800 && inside(formatEl) && inside(startEl) && inside(applyEl);
  });
  expect(clear).toBe(true);
}

async function topRight(page: Page, index: number, text: string) {
  const face = page.locator(".page-furniture-page").nth(index);
  await expect(face).toHaveAttribute("data-number-side", "top-right");
  await expect(face.locator(".page-number")).toHaveText(text);
  const placed = await face.evaluate((pageEl) => {
    const number = pageEl.querySelector(".page-number") as HTMLElement;
    const sheet = pageEl.getBoundingClientRect();
    const pill = number.getBoundingClientRect();
    return {
      right: (sheet.right - pill.right) / sheet.width,
      top: (pill.top - sheet.top) / sheet.height,
    };
  });
  expect(placed.right).toBeGreaterThan(-0.02);
  expect(placed.right).toBeLessThan(0.2);
  expect(placed.top).toBeGreaterThan(-0.02);
  expect(placed.top).toBeLessThan(0.2);
  return placed;
}

async function replaceStart(page: Page, value: string) {
  const start = page.getByRole("spinbutton", { name: "Start at" });
  await start.click();
  await beat(page, 250);
  await start.selectText();
  await beat(page, 200);
  await typeSlowly(page, value, 160);
}

test("114-see-the-starting-number", async ({ page }) => {
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
  const pageOne = await topRight(page, 0, "Page 1");
  await readableNumber(page, 0);
  await say(
    page,
    "Sam's minutes follow 11 pages of front matter. This page says Page 1.",
    2400,
  );

  await showPageTop(page, 1);
  const pageTwo = await topRight(page, 1, "Page 2");
  expect(Math.abs(pageOne.right - pageTwo.right)).toBeLessThan(0.04);
  expect(Math.abs(pageOne.top - pageTwo.top)).toBeLessThan(0.04);
  await readableNumber(page, 1);
  await say(page, "The next page says Page 2, in the same place.", 2200);

  let setup = await openSetup(page);
  await showPageTop(page, 0);
  await controlsTogether(page);
  await expect(setup.getByRole("spinbutton", { name: "Start at" })).toHaveValue("1");
  await expect(setup.getByRole("radio", { name: "Page 1" })).toBeChecked();
  await readableNumber(page, 0);
  await say(page, "She opens Page setup. Start at, the format, and Apply are on screen.", 2200);

  await say(page, "She sets Start at to 12.", 700);
  await replaceStart(page, "12");
  await expect(setup.getByRole("spinbutton", { name: "Start at" })).toHaveValue("12");
  await expect.poll(() => numbers(page)).toEqual(["Page 12", "Page 13"]);
  await showPageTop(page, 0);
  const started = await topRight(page, 0, "Page 12");
  expect(Math.abs(started.right - pageOne.right)).toBeLessThan(0.04);
  expect(Math.abs(started.top - pageOne.top)).toBeLessThan(0.04);
  await readableNumber(page, 0);
  await expect(setup).toBeVisible();
  await controlsTogether(page);
  await say(page, "Before Apply, this page says Page 12.", 2400);

  await showPageTop(page, 1);
  const startedNext = await topRight(page, 1, "Page 13");
  expect(Math.abs(startedNext.right - pageTwo.right)).toBeLessThan(0.04);
  expect(Math.abs(startedNext.top - pageTwo.top)).toBeLessThan(0.04);
  await readableNumber(page, 1);
  await say(page, "Page 2 says Page 13, in the same place. She has not applied.", 2600);

  await showPageTop(page, 0);
  await say(page, "She tries 0.", 600);
  await replaceStart(page, "0");
  const start = setup.getByRole("spinbutton", { name: "Start at" });
  await expect(start).toHaveValue("0");
  await expect(setup.locator("#page-numbers-hint")).toHaveText(
    "Numbering starts at 1 or later. The page stays on Page 12.",
  );
  await expect.poll(() => numbers(page)).toEqual(["Page 12", "Page 13"]);
  await topRight(page, 0, "Page 12");
  await readableNumber(page, 0);
  await controlsTogether(page);
  await expect(setup.locator("#page-numbers-hint")).toBeInViewport();
  await say(page, "Numbering starts at 1 or later. The page stays on Page 12.", 2800);

  await say(page, "She cancels.", 500);
  await setup.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(setup).toBeHidden();
  await expect.poll(() => numbers(page)).toEqual(["Page 1", "Page 2"]);
  await showPageTop(page, 0);
  await topRight(page, 0, "Page 1");
  await readableNumber(page, 0);
  await say(page, "Cancel puts Page 1 back.", 2000);
  await showPageTop(page, 1);
  await topRight(page, 1, "Page 2");
  await readableNumber(page, 1);
  await say(page, "Page 2 says Page 2 again.", 1800);

  setup = await openSetup(page);
  await showPageTop(page, 0);
  await say(page, "She sets 12 again.", 600);
  await replaceStart(page, "12");
  await expect.poll(() => numbers(page)).toEqual(["Page 12", "Page 13"]);
  await topRight(page, 0, "Page 12");
  await readableNumber(page, 0);
  await controlsTogether(page);
  await say(page, "She sees Page 12, then applies.", 1600);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await expect.poll(() => numbers(page)).toEqual(["Page 12", "Page 13"]);
  await showPageTop(page, 0);
  await topRight(page, 0, "Page 12");
  await readableNumber(page, 0);
  await say(page, "Apply keeps Page 12.", 2000);
  await showPageTop(page, 1);
  await topRight(page, 1, "Page 13");
  await readableNumber(page, 1);
  await say(page, "Page 2 keeps Page 13.", 1800);

  await say(page, "She closes the file, then opens it again.", 900);
  await expect(page.locator(".save-status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await beat(page, 500);
  await page.getByRole("link", { name: "Minutes" }).click();
  await expect(editor).toContainText("The hearing opens at seven.");
  await expect.poll(() => numbers(page)).toEqual(["Page 12", "Page 13"]);
  await showPageTop(page, 0);
  await topRight(page, 0, "Page 12");
  await readableNumber(page, 0);
  await say(page, "Saved and reopened. It still starts at Page 12.", 2200);
  await showPageTop(page, 1);
  await topRight(page, 1, "Page 13");
  await readableNumber(page, 1);
  await say(page, "The next page is still Page 13.", 2200);
});
