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

/** Scroll Page setup so the chips and the small pages sit in view together. */
async function showMiniature(page: Page) {
  await page.evaluate(() => {
    const body = document.querySelector(
      ".page-setup-dialog .dialog-body",
    ) as HTMLElement;
    const format = [...body.querySelectorAll("fieldset")].find(
      (field) => field.querySelector("legend")?.textContent === "Format",
    ) as HTMLElement;
    const preview = body.querySelector(".page-setup-preview") as HTMLElement;
    const bodyBox = body.getBoundingClientRect();
    const formatBox = format.getBoundingClientRect();
    body.scrollTop += formatBox.top - bodyBox.top - 4;
    const next = body.getBoundingClientRect();
    const previewBox = preview.getBoundingClientRect();
    if (previewBox.bottom > next.bottom - 4) {
      body.scrollTop += previewBox.bottom - next.bottom + 8;
    }
  });
  await beat(page, 300);
}

async function cornerClear(
  page: Page,
  roman: string,
  fraction: string,
  corner: "top-right" | "bottom-center",
) {
  const report = await page.evaluate(
    ({ romanText, fractionText, which }) => {
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
      const sheets = [...preview.querySelectorAll(".page-setup-preview-sheet")];
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
      const problems: string[] = [];
      if (window.innerHeight !== 800) problems.push("viewport");
      if (!romanEl || !fractionEl) problems.push("chips");
      if (!inside(romanEl, port)) problems.push("roman chip");
      if (!inside(fractionEl, port)) problems.push("fraction chip");
      if (romanEl && fractionEl && overlap(romanEl, fractionEl))
        problems.push("chips overlap");
      if (!sheets.length) problems.push("no sheets");
      sheets.forEach((sheet, index) => {
        const number = sheet.querySelector(".page-setup-preview-number");
        const label = sheet.parentElement?.querySelector(".page-setup-preview-label");
        if (!inside(sheet, port)) problems.push(`sheet ${index} clipped`);
        if (sheet.getAttribute("data-number-corner") !== which)
          problems.push(`sheet ${index} corner`);
        if (!number) {
          problems.push(`sheet ${index} number`);
          return;
        }
        const s = box(sheet);
        const n = box(number);
        const pageShaped = s.height >= s.width * 1.2;
        const onPage =
          n.left >= s.left - 1 &&
          n.right <= s.right + 1 &&
          n.top >= s.top - 1 &&
          n.bottom <= s.bottom + 1;
        const cx = (n.left + n.right) / 2;
        const placed =
          which === "top-right"
            ? n.top - s.top <= s.height * 0.22 && s.right - n.right <= 14
            : s.bottom - n.bottom <= 14 &&
              Math.abs(cx - (s.left + s.width / 2)) <= 10;
        if (!pageShaped || !onPage || !placed)
          problems.push(
            `sheet ${index} number ${JSON.stringify({
              pageShaped,
              onPage,
              placed,
              top: Math.round(n.top - s.top),
              right: Math.round(s.right - n.right),
              bottom: Math.round(s.bottom - n.bottom),
            })}`,
          );
        if (label) {
          const r = box(label);
          const labelInside =
            r.width > 8 &&
            r.height > 8 &&
            r.top >= port.top - 1 &&
            r.bottom <= port.bottom + 1 &&
            r.left >= port.left - 1 &&
            r.right <= port.right + 1 &&
            r.bottom <= window.innerHeight - 8;
          if (!labelInside)
            problems.push(
              `label ${index} ${Math.round(r.width)}x${Math.round(r.height)}`,
            );
        }
        if (!clearOfCaption(sheet)) problems.push(`sheet ${index} under caption`);
        if (!clearOfCaption(number)) problems.push(`number ${index} under caption`);
      });
      const skip = preview.querySelector(".page-setup-preview-skip");
      if (skip && !inside(skip, port)) problems.push("skip clipped");
      if (skip && !clearOfCaption(skip)) problems.push("skip under caption");
      if (!inside(apply, host) || !clearOfCaption(apply)) problems.push("apply");
      if (
        romanEl &&
        fractionEl &&
        (!clearOfCaption(romanEl) || !clearOfCaption(fractionEl))
      )
        problems.push("caption");
      return problems;
    },
    { romanText: roman, fractionText: fraction, which: corner },
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

test("127-draw-the-number-on-the-preview", async ({ page }) => {
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
  await say(page, "Sam's preface is five pages. The first page says iv.", 2000);
  await showPageTop(page, 4);
  await expect(page.locator(".paginated-paper .page-number").nth(4)).toHaveText("viii");
  await say(page, "The last page says viii. She opens Page setup.", 1800);

  let setup = await openSetup(page);
  await showMiniature(page);
  const roman = setup.getByRole("radio", { name: "iv … viii", exact: true });
  const fraction = setup.getByRole("radio", { name: "4 / 8", exact: true });
  const preview = setup.getByRole("group", { name: "Page preview" });
  const miniature = preview.locator(".page-setup-preview-sheet");
  await expect(roman).toBeChecked();
  await expect(fraction).toBeVisible();
  await expect(setup.getByRole("radio", { name: "Top right", exact: true })).toBeChecked();
  await expect(miniature).toHaveCount(2);
  await expect(miniature.nth(0).locator(".page-setup-preview-number")).toHaveText("iv");
  await expect(miniature.nth(1).locator(".page-setup-preview-number")).toHaveText("viii");
  await expect(preview.locator(".page-setup-preview-skip-label")).toHaveText(
    "Pages v\u2013vii skipped",
  );
  await cornerClear(page, "iv … viii", "4 / 8", "top-right");
  await preview.locator(".page-setup-preview-label").nth(1).hover();
  await say(
    page,
    "Each sheet is a small page. iv and viii sit in the top-right corner. The count is still 4 / 8.",
    3200,
  );

  await setup.getByRole("radio", { name: "Bottom center", exact: true }).click();
  await beat(page, 400);
  await expect(setup.getByRole("button", { name: "Apply", exact: true })).toBeVisible();
  await expect(miniature.nth(0)).toHaveAttribute("data-number-corner", "bottom-center");
  await expect(miniature.nth(1)).toHaveAttribute("data-number-corner", "bottom-center");
  await cornerClear(page, "iv … viii", "4 / 8", "bottom-center");
  await preview.locator(".page-setup-preview-label").nth(0).hover();
  await say(
    page,
    "She moves the number to the bottom center. Before Apply, both pages show it there.",
    3200,
  );

  await setup.getByRole("radio", { name: "Top right", exact: true }).click();
  await beat(page, 400);
  await cornerClear(page, "iv … viii", "4 / 8", "top-right");
  await preview.locator(".page-setup-preview-label").nth(1).hover();
  await say(page, "Top right puts iv and viii back in the corner.", 2000);
  await closeSetup(page);

  await say(page, "She shortens the preface to two pages.", 1000);
  await removeLastPage(page);
  await removeLastPage(page);
  await removeLastPage(page);
  await expect(page.locator(".editor-status")).toContainText("2 pages");
  await expect.poll(() => numbers(page)).toEqual(["iv", "v"]);
  await showPageTop(page, 0);
  await say(page, "Two pages remain: iv and v.", 900);

  setup = await openSetup(page);
  await showMiniature(page);
  await say(
    page,
    "Exactly two small pages. iv and v, in the top-right corner. There is no third.",
    400,
  );
  await expect(setup.getByRole("radio", { name: "iv, v", exact: true })).toBeChecked();
  await expect(setup.getByRole("radio", { name: "4 / 5", exact: true })).toBeVisible();
  await expect(setup.getByRole("radio", { name: "iv, v, vi", exact: true })).toHaveCount(0);
  await expect(preview.locator(".page-setup-preview-sheet")).toHaveCount(2);
  await expect(preview.locator(".page-setup-preview-skip")).toHaveCount(0);
  await expect(preview.locator(".page-setup-preview-number")).toHaveText(["iv", "v"]);
  await cornerClear(page, "iv, v", "4 / 5", "top-right");
  await preview.locator(".page-setup-preview-label").nth(1).hover();
  await beat(page, 2200);
  await closeSetup(page);

  await say(page, "Three more pages. The preface is five pages again.", 1000);
  await addPage(page, "Notes on the sources.");
  await addPage(page, "A page of thanks.");
  await addPage(page, "The index.");
  await expect(page.locator(".editor-status")).toContainText("5 pages");
  await expect.poll(() => numbers(page)).toEqual(["iv", "v", "vi", "vii", "viii"]);

  setup = await openSetup(page);
  await showMiniature(page);
  await expect(setup.getByRole("radio", { name: "iv … viii", exact: true })).toBeChecked();
  await expect(setup.getByRole("radio", { name: "4 / 8", exact: true })).toBeVisible();
  await expect(preview.locator(".page-setup-preview-number")).toHaveText(["iv", "viii"]);
  await cornerClear(page, "iv … viii", "4 / 8", "top-right");
  await preview.locator(".page-setup-preview-label").nth(1).hover();
  await say(page, "Before Apply, iv and viii are in the top-right corner again.", 2200);

  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await expect.poll(() => numbers(page)).toEqual(["iv", "v", "vi", "vii", "viii"]);
  await say(page, "She applies, then closes the file and opens it again.", 1500);
  await expect(page.locator(".save-status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await beat(page, 500);
  await page.getByRole("link", { name: "Preface" }).click();
  await expect(editor).toContainText("The front matter starts here.");
  await expect.poll(() => numbers(page)).toEqual(["iv", "v", "vi", "vii", "viii"]);

  setup = await openSetup(page);
  await showMiniature(page);
  const kept = setup.getByRole("radio", { name: "iv … viii", exact: true });
  await expect(kept).toBeChecked();
  await expect(setup.getByRole("radio", { name: "4 / 8", exact: true })).toBeVisible();
  await expect(setup.getByRole("radio", { name: "Top right", exact: true })).toBeChecked();
  await expect(preview.locator(".page-setup-preview-number")).toHaveText(["iv", "viii"]);
  await cornerClear(page, "iv … viii", "4 / 8", "top-right");
  await kept.hover();
  await beat(page, 500);
  await preview.locator(".page-setup-preview-label").nth(1).hover();
  await say(
    page,
    "Saved and reopened. The preview still draws iv and viii in the top right. The count is 4 / 8.",
    3200,
  );
});
