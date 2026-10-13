import type { Page } from "@playwright/test";
import { createFile, serializeFile, type DocFile } from "../../packages/core/src";
import { beat, caption, expect, test, typeSlowly } from "./harness";

const inch = (n: number) => n * 96;

function preface(): DocFile {
  const file = createFile("doc", "Preface") as DocFile;
  const paragraph = (text: string) => ({
    type: "paragraph",
    content: [{ type: "text", text }],
  });
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
        pageNumberFormat: "roman",
        pageNumberPosition: "top-right",
        pageNumberPositionSet: true,
        pageNumberStart: 4,
      },
    },
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Preface" }],
      },
      paragraph("The front matter starts here."),
      { type: "pageBreak" },
      paragraph("Notes on the second page."),
      { type: "pageBreak" },
      paragraph("Notes on the third page."),
      { type: "pageBreak" },
      paragraph("Notes on the fourth page."),
      { type: "pageBreak" },
      paragraph("The index ends the preface."),
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

/** Scroll Page setup so the format chips and the miniature sit in view together. */
async function showMiniature(page: Page) {
  await page.evaluate(() => {
    const body = document.querySelector(
      ".page-setup-dialog .dialog-body",
    ) as HTMLElement;
    const format = [...body.querySelectorAll("fieldset")].find(
      (field) => field.querySelector("legend")?.textContent === "Format",
    ) as HTMLElement;
    const bodyBox = body.getBoundingClientRect();
    const formatBox = format.getBoundingClientRect();
    body.scrollTop += formatBox.top - bodyBox.top - 4;
  });
  await beat(page, 300);
}

async function miniatureClear(page: Page, roman: string, fraction: string) {
  const report = await page.evaluate(
    ({ romanText, fractionText }) => {
      const box = (el: Element) => el.getBoundingClientRect();
      const dialog = document.querySelector(".page-setup-dialog") as HTMLElement;
      const body = dialog.querySelector(".dialog-body") as HTMLElement;
      const format = [...dialog.querySelectorAll("fieldset")].find(
        (field) => field.querySelector("legend")?.textContent === "Format",
      ) as HTMLElement;
      const chip = (text: string) =>
        [...format.querySelectorAll("label")].find(
          (label) => label.textContent?.trim() === text,
        ) as HTMLElement;
      const romanEl = chip(romanText);
      const fractionEl = chip(fractionText);
      const preview = dialog.querySelector(".page-setup-preview") as HTMLElement;
      const sheets = [...preview.querySelectorAll(".page-setup-preview-page")];
      const skip = preview.querySelector(".page-setup-preview-skip");
      const skipLabel = preview.querySelector(
        ".page-setup-preview-skip-label",
      ) as HTMLElement | null;
      const apply = [...dialog.querySelectorAll("button")].find(
        (button) => button.textContent === "Apply",
      ) as HTMLElement;
      const port = box(body);
      const host = box(dialog);
      const inside = (el: Element, frame: DOMRect) => {
        const r = box(el);
        return (
          r.width > 16 &&
          r.height > 12 &&
          r.top >= frame.top - 1 &&
          r.bottom <= frame.bottom + 1 &&
          r.left >= frame.left - 1 &&
          r.right <= frame.right + 1 &&
          r.top >= 0 &&
          r.bottom <= window.innerHeight - 8
        );
      };
      const overlap = (a: Element, b: Element) => {
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
      const clearOfCaption = (el: Element) => !captionBar || !overlap(el, captionBar);
      const unclipped = (el: Element) => {
        const node = el as HTMLElement;
        return (
          node.scrollWidth <= node.clientWidth + 1 &&
          node.scrollHeight <= node.clientHeight + 1
        );
      };
      const problems: string[] = [];
      if (window.innerHeight !== 800) problems.push("viewport");
      if (!romanEl || !fractionEl) problems.push("chips");
      if (!inside(romanEl, port) || !unclipped(romanEl)) problems.push("roman chip");
      if (!inside(fractionEl, port) || !unclipped(fractionEl)) problems.push("fraction chip");
      if (overlap(romanEl, fractionEl)) problems.push("chips overlap");
      if (!sheets.length) problems.push("no sheets");
      sheets.forEach((sheet, index) => {
        const number = sheet.querySelector(".page-setup-preview-number");
        const label = sheet.querySelector(".page-setup-preview-label");
        if (!inside(sheet, port)) problems.push(`sheet ${index} clipped`);
        if (number && !unclipped(number)) problems.push(`number ${index} clipped`);
        if (label && !unclipped(label)) problems.push(`label ${index} clipped`);
        if (!clearOfCaption(sheet)) problems.push(`sheet ${index} under caption`);
      });
      if (skip) {
        const r = box(skip);
        const why: string[] = [];
        if (!(r.width > 16 && r.height > 16))
          why.push(`size ${Math.round(r.width)}x${Math.round(r.height)}`);
        if (r.top < port.top - 1) why.push(`above body ${Math.round(r.top - port.top)}`);
        if (r.bottom > port.bottom + 1)
          why.push(`below body ${Math.round(r.bottom - port.bottom)}`);
        if (r.left < port.left - 1) why.push("left of body");
        if (r.right > port.right + 1)
          why.push(`right of body ${Math.round(r.right - port.right)}`);
        if (r.bottom > window.innerHeight - 8) why.push("below window");
        if (skipLabel && !unclipped(skipLabel))
          why.push(
            `text ${skipLabel.scrollWidth}x${skipLabel.scrollHeight} in ${skipLabel.clientWidth}x${skipLabel.clientHeight}`,
          );
        if (why.length) problems.push(`skip clipped: ${why.join("; ")}`);
        if (!clearOfCaption(skip)) problems.push("skip under caption");
      }
      if (!inside(apply, host) || !clearOfCaption(apply)) problems.push("apply");
      if (!clearOfCaption(romanEl) || !clearOfCaption(fractionEl)) problems.push("caption");
      for (let i = 0; i < sheets.length; i++) {
        for (let j = i + 1; j < sheets.length; j++) {
          if (overlap(sheets[i]!, sheets[j]!)) problems.push("sheets overlap");
        }
        if (skip && overlap(sheets[i]!, skip)) problems.push("skip overlaps a sheet");
      }
      return problems;
    },
    { romanText: roman, fractionText: fraction },
  );
  expect(report, "miniature layout").toEqual([]);
}

async function removeLastPage(page: Page) {
  const editor = page.getByRole("textbox", { name: "Document content" });
  const last = editor.locator(":scope > p").filter({ hasText: /\S/ }).last();
  const text = ((await last.textContent()) ?? "").trim();
  await last.scrollIntoViewIfNeeded();
  await beat(page, 250);
  await last.click({ clickCount: 3 });
  await beat(page, 400);
  await page.keyboard.press("Backspace");
  await beat(page, 250);
  await page.keyboard.press("Backspace");
  await beat(page, 400);
  if ((await editor.getByText(text, { exact: true }).count()) > 0) {
    await last.click({ clickCount: 3 });
    await beat(page, 250);
    await page.keyboard.press("Backspace");
    await beat(page, 200);
    await page.keyboard.press("Backspace");
    await beat(page, 300);
  }
  await expect(editor).not.toContainText(text);
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

test("124-preview-the-roman-ends", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Preface.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(preface())),
  });
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toContainText("The index ends the preface.");
  await expect(page.locator(".editor-status")).toContainText("5 pages");
  await expect.poll(() => numbers(page)).toEqual(["iv", "v", "vi", "vii", "viii"]);

  await showPageTop(page, 0);
  await say(page, "Sam's preface is five pages. The first page says iv.", 2200);
  await showPageTop(page, 4);
  await expect(page.locator(".paginated-paper .page-number").nth(4)).toHaveText("viii");
  await say(page, "The last page says viii. She opens Page setup before Apply.", 2200);

  let setup = await openSetup(page);
  await showMiniature(page);
  const roman = setup.getByRole("radio", { name: "iv … viii", exact: true });
  const fraction = setup.getByRole("radio", { name: "4 / 8", exact: true });
  await expect(roman).toBeChecked();
  await expect(fraction).toBeVisible();
  const preview = setup.getByRole("group", { name: "Page preview" });
  const miniature = preview.locator(".page-setup-preview-page");
  await expect(miniature).toHaveCount(2);
  await expect(miniature.nth(0).locator(".page-setup-preview-number")).toHaveText(
    "iv at the top right",
  );
  await expect(miniature.nth(1).locator(".page-setup-preview-number")).toHaveText(
    "viii at the top right",
  );
  await expect(preview.locator(".page-setup-preview-skip-label")).toHaveText(
    "Pages v\u2013vii skipped",
  );
  await expect(setup.getByRole("button", { name: "Apply", exact: true })).toBeVisible();
  await miniatureClear(page, "iv … viii", "4 / 8");
  await roman.hover();
  await say(
    page,
    "The chip says iv … viii. The count is still 4 / 8.",
    2400,
  );
  await miniature.nth(0).hover();
  await beat(page, 500);
  await preview.locator(".page-setup-preview-skip").hover();
  await beat(page, 600);
  await miniature.nth(1).hover();
  await say(
    page,
    "The preview shows iv, marks the pages it skipped, and ends on viii. vi is not the last sheet.",
    3400,
  );

  await closeSetup(page);
  await say(page, "She shortens the preface to two pages.", 1200);
  await removeLastPage(page);
  await removeLastPage(page);
  await removeLastPage(page);
  await expect(page.locator(".editor-status")).toContainText("2 pages");
  await expect.poll(() => numbers(page)).toEqual(["iv", "v"]);
  await showPageTop(page, 0);
  await say(page, "Two pages remain: iv and v.", 1800);

  setup = await openSetup(page);
  await showMiniature(page);
  const twoChip = setup.getByRole("radio", { name: "iv, v", exact: true });
  await expect(twoChip).toBeChecked();
  await expect(setup.getByRole("radio", { name: "iv, v, vi", exact: true })).toHaveCount(0);
  await expect(setup.getByRole("radio", { name: "4 / 5", exact: true })).toBeVisible();
  await expect(preview.locator(".page-setup-preview-page")).toHaveCount(2);
  await expect(preview.locator(".page-setup-preview-skip")).toHaveCount(0);
  await expect(
    preview.locator(".page-setup-preview-number").nth(0),
  ).toHaveText("iv at the top right");
  await expect(
    preview.locator(".page-setup-preview-number").nth(1),
  ).toHaveText("v at the top right");
  await miniatureClear(page, "iv, v", "4 / 5");
  await preview.locator(".page-setup-preview-page").nth(1).hover();
  await say(page, "Exactly two sheets. iv and v. There is no third.", 2800);
  await closeSetup(page);

  await say(page, "She adds one page.", 900);
  await addPage(page, "A third page.");
  await expect(page.locator(".editor-status")).toContainText("3 pages");
  await expect.poll(() => numbers(page)).toEqual(["iv", "v", "vi"]);
  setup = await openSetup(page);
  await showMiniature(page);
  const threeChip = setup.getByRole("radio", { name: "iv, v, vi", exact: true });
  await expect(threeChip).toBeChecked();
  await expect(setup.getByRole("radio", { name: "4 / 6", exact: true })).toBeVisible();
  await expect(preview.locator(".page-setup-preview-page")).toHaveCount(3);
  await expect(preview.locator(".page-setup-preview-skip")).toHaveCount(0);
  await expect(preview.locator(".page-setup-preview-number")).toHaveText([
    "iv at the top right",
    "v at the top right",
    "vi at the top right",
  ]);
  await miniatureClear(page, "iv, v, vi", "4 / 6");
  await threeChip.hover();
  await say(
    page,
    "Three pages. The preview lists iv, v, and vi, the same as the chip.",
    3000,
  );
  await closeSetup(page);

  await say(page, "Two more pages. The preface is five pages again.", 1000);
  await addPage(page, "The sources.");
  await addPage(page, "The index.");
  await expect(page.locator(".editor-status")).toContainText("5 pages");
  await expect.poll(() => numbers(page)).toEqual(["iv", "v", "vi", "vii", "viii"]);
  setup = await openSetup(page);
  await showMiniature(page);
  await expect(setup.getByRole("radio", { name: "iv … viii", exact: true })).toBeChecked();
  await expect(setup.getByRole("radio", { name: "4 / 8", exact: true })).toBeVisible();
  await expect(preview.locator(".page-setup-preview-number")).toHaveText([
    "iv at the top right",
    "viii at the top right",
  ]);
  await expect(preview.locator(".page-setup-preview-skip-label")).toHaveText(
    "Pages v\u2013vii skipped",
  );
  await miniatureClear(page, "iv … viii", "4 / 8");
  await preview.locator(".page-setup-preview-page").nth(1).hover();
  await say(page, "Before Apply, the preview is iv and viii again.", 2400);

  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await expect.poll(() => numbers(page)).toEqual(["iv", "v", "vi", "vii", "viii"]);
  await say(page, "She applies, then closes the file and opens it again.", 1600);
  await expect(page.locator(".save-status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await beat(page, 500);
  await page.getByRole("link", { name: "Preface" }).click();
  await expect(editor).toContainText("The front matter starts here.");
  await expect.poll(() => numbers(page)).toEqual(["iv", "v", "vi", "vii", "viii"]);
  await showPageTop(page, 0);
  await say(page, "Saved and reopened. The first page still says iv.", 1800);

  setup = await openSetup(page);
  await showMiniature(page);
  const kept = setup.getByRole("radio", { name: "iv … viii", exact: true });
  await expect(kept).toBeChecked();
  await expect(setup.getByRole("radio", { name: "4 / 8", exact: true })).toBeVisible();
  await expect(preview.locator(".page-setup-preview-number")).toHaveText([
    "iv at the top right",
    "viii at the top right",
  ]);
  await expect(preview.locator(".page-setup-preview-skip-label")).toHaveText(
    "Pages v\u2013vii skipped",
  );
  await miniatureClear(page, "iv … viii", "4 / 8");
  await kept.hover();
  await preview.locator(".page-setup-preview-page").nth(1).hover();
  await say(page, "The preview still shows iv and viii. The count is 4 / 8.", 3200);
});
