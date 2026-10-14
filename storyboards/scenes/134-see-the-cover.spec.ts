import type { Page } from "@playwright/test";
import { createFile, serializeFile, type DocFile } from "../../packages/core/src";
import { beat, caption, expect, test } from "./harness";

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
        pageNumberFormat: "page",
        pageNumberPosition: "top-right",
        pageNumberPositionSet: true,
        pageNumberStart: 1,
        differentOddEven: true,
        coverHasNoNumber: false,
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

/** Keep the cover switch and the miniature pages on screen together. */
async function showCover(page: Page) {
  await page.evaluate(() => {
    const body = document.querySelector(
      ".page-setup-dialog .dialog-body",
    ) as HTMLElement;
    const cover = [...body.querySelectorAll("label")].find((label) =>
      label.textContent?.includes("Cover has no number"),
    ) as HTMLElement;
    const preview = body.querySelector(".page-setup-preview") as HTMLElement;
    const align = () => {
      const delta =
        cover.getBoundingClientRect().top - body.getBoundingClientRect().top;
      if (Math.abs(delta) > 1) body.scrollTop += delta - 4;
    };
    align();
    const port = body.getBoundingClientRect();
    const box = preview.getBoundingClientRect();
    if (box.bottom > port.bottom - 4) {
      body.scrollTop += box.bottom - port.bottom + 8;
      return;
    }
    align();
  });
  await beat(page, 200);
}

async function showDocumentPage(page: Page, index: number) {
  await page.evaluate((i) => {
    const face = document.querySelectorAll(".page-furniture-page")[i] as HTMLElement;
    const stage = document.querySelector(".document-stage") as HTMLElement;
    const delta = face.getBoundingClientRect().top - stage.getBoundingClientRect().top;
    stage.scrollTop += delta - 6;
  }, index);
  await beat(page, 450);
}

async function layoutClear(page: Page) {
  const report = await page.evaluate(() => {
    const box = (el: Element) => el.getBoundingClientRect();
    const dialog = document.querySelector(".page-setup-dialog") as HTMLElement;
    const body = dialog.querySelector(".dialog-body") as HTMLElement;
    const preview = dialog.querySelector(".page-setup-preview") as HTMLElement;
    const cover = preview.querySelector("[data-preview-role='cover']");
    const next = preview.querySelector("[data-preview-role='next']");
    const apply = [...dialog.querySelectorAll("button")].find(
      (button) => button.textContent === "Apply",
    ) as HTMLElement;
    const coverSwitch = [...dialog.querySelectorAll("label")].find((label) =>
      label.textContent?.includes("Cover has no number"),
    ) as HTMLElement;
    const port = box(body);
    const host = box(dialog);
    const inside = (el: Element, frame: DOMRect) => {
      const r = box(el);
      return (
        r.width > 8 &&
        r.height > 8 &&
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
    if (window.innerHeight !== 800 || window.innerWidth !== 1280) problems.push("viewport");
    if (!inside(coverSwitch, port)) problems.push("cover switch clipped");
    if (!clearOfCaption(coverSwitch)) problems.push("cover switch under caption");
    if (!cover || !next) problems.push("roles");
    else if (box(cover).left >= box(next).left) problems.push("order");
    const sheets = [cover, next].filter((sheet): sheet is Element => !!sheet);
    sheets.forEach((pageEl, index) => {
      const sheet = pageEl.querySelector(".page-setup-preview-sheet");
      const number = pageEl.querySelector(".page-setup-preview-number");
      const label = pageEl.querySelector(".page-setup-preview-label");
      if (!sheet || !number) {
        problems.push(`sheet ${index} missing`);
        return;
      }
      if (!inside(sheet, port)) problems.push(`sheet ${index} clipped`);
      const s = box(sheet);
      const n = box(number);
      const pageShaped = s.height >= s.width * 0.9;
      const onPage =
        n.left >= s.left - 1 &&
        n.right <= s.right + 1 &&
        n.top >= s.top - 1 &&
        n.bottom <= s.bottom + 1;
      const corner = sheet.getAttribute("data-number-corner");
      const onRight = s.right - n.right <= 18 && n.left > s.left + s.width * 0.28;
      const atTop = n.top - s.top <= 18 && n.bottom < s.top + s.height * 0.45;
      const centered =
        Math.abs(n.left + n.width / 2 - (s.left + s.width / 2)) < 28 &&
        Math.abs(n.top + n.height / 2 - (s.top + s.height / 2)) < 36;
      const placed =
        index === 0
          ? corner === "none" && number.textContent === "No number" && centered
          : corner === "top-right" && onRight && atTop && number.textContent === "Page 1";
      if (!pageShaped || !onPage || !placed)
        problems.push(
          `sheet ${index} ${corner} ${number.textContent} ${JSON.stringify({
            pageShaped,
            onPage,
            placed,
            left: Math.round(n.left - s.left),
            right: Math.round(s.right - n.right),
            top: Math.round(n.top - s.top),
          })}`,
        );
      if (label && !inside(label, port)) problems.push(`label ${index} clipped`);
      if (!clearOfCaption(sheet)) problems.push(`sheet ${index} under caption`);
      if (!clearOfCaption(number)) problems.push(`number ${index} under caption`);
    });
    if (!inside(apply, host) || !clearOfCaption(apply)) problems.push("apply");
    return problems;
  });
  expect(report, "preview layout").toEqual([]);
}

async function pageOnScreen(
  page: Page,
  index: number,
  corner: "top-left" | "top-right" | "none",
) {
  const report = await page.evaluate(
    ({ index: i, corner: which }) => {
      const face = document.querySelectorAll(".page-furniture-page")[i] as HTMLElement;
      const number = face.querySelector(".page-number") as HTMLElement | null;
      const stage = document.querySelector(".document-stage") as HTMLElement;
      const box = (el: Element) => el.getBoundingClientRect();
      const s = box(face);
      const port = box(stage);
      const dialog = document.querySelector(".page-setup-dialog") as HTMLElement | null;
      const overlap = (a: DOMRect, b: DOMRect) =>
        a.left < b.right - 1 &&
        a.right > b.left + 1 &&
        a.top < b.bottom - 1 &&
        a.bottom > b.top + 1;
      const problems: string[] = [];
      const side = face.getAttribute("data-number-side");
      if (side !== which) problems.push(`side ${side}`);
      const topBand = {
        top: s.top,
        bottom: s.top + Math.min(72, s.height * 0.22),
        left: s.left,
        right: s.right,
      } as DOMRect;
      const inStage =
        s.top >= Math.max(port.top, 0) - 2 &&
        s.top <= Math.min(port.bottom, window.innerHeight) - 48 &&
        s.left >= port.left - 2 &&
        s.right <= port.right + 2;
      if (!inStage) problems.push("off screen");
      if (which === "none") {
        if (number) problems.push("number still drawn");
        if (dialog && overlap(topBand, box(dialog))) problems.push("under dialog");
        return problems;
      }
      if (!number) return ["missing number"];
      const n = box(number);
      const onLeft = n.left - s.left <= 24 && n.right < s.left + s.width * 0.62;
      const onRight = s.right - n.right <= 24 && n.left > s.left + s.width * 0.38;
      const atTop = n.top - s.top < s.height * 0.22 && n.bottom < s.top + s.height * 0.4;
      const placed = which === "top-left" ? onLeft && atTop : onRight && atTop;
      const numberInStage =
        n.top >= Math.max(port.top, 0) + 2 &&
        n.bottom <= Math.min(port.bottom, window.innerHeight) - 2 &&
        n.left >= port.left + 2 &&
        n.right <= port.right - 2;
      if (!placed)
        problems.push(
          `corner ${JSON.stringify({
            left: Math.round(n.left - s.left),
            right: Math.round(s.right - n.right),
            top: Math.round(n.top - s.top),
            width: Math.round(s.width),
          })}`,
        );
      if (!numberInStage) problems.push("number off screen");
      if (dialog && overlap(n, box(dialog))) problems.push("under dialog");
      const captionBar = document.getElementById("storyboard-caption");
      if (captionBar && overlap(n, box(captionBar))) problems.push("under caption");
      return problems;
    },
    { index, corner },
  );
  expect(report, `document page ${index + 1}`).toEqual([]);
}

test("134-see-the-cover", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Preface.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(preface())),
  });
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toContainText("Notes on the third page.");
  await expect(page.locator(".editor-status")).toContainText("3 pages");
  await say(
    page,
    "Sam's preface is three pages. Numbers are on, and even pages already sit on the left.",
    1700,
  );

  let setup = await openSetup(page);
  await showCover(page);
  const cover = setup.getByRole("checkbox", { name: "Cover has no number" });
  const oddEven = setup.getByRole("checkbox", { name: "Different odd and even pages" });
  const preview = setup.getByRole("group", { name: "Page preview" });
  await expect(oddEven).toBeChecked();
  await expect(cover).not.toBeChecked();
  await expect(preview.locator(".page-setup-preview-number")).toHaveText(["Page 2", "Page 3"]);
  await showDocumentPage(page, 0);
  await pageOnScreen(page, 0, "top-right");
  await say(
    page,
    "Page setup is open. Page 1 still has a number. Page 2's number is already on the left.",
    0,
  );
  await showDocumentPage(page, 1);
  await pageOnScreen(page, 1, "top-left");
  await preview.locator("[data-preview-role='last-even'] .page-setup-preview-number").hover();
  await beat(page, 2000);

  await showDocumentPage(page, 0);
  await cover.hover();
  await beat(page, 280);
  await cover.check();
  await caption(
    page,
    "She turns on Cover has no number. Before Apply, the first page goes blank.",
    0,
  );
  await beat(page, 700);
  await showCover(page);
  await expect(setup.getByRole("button", { name: "Apply", exact: true })).toBeVisible();
  await pageOnScreen(page, 0, "none");
  await beat(page, 1400);

  await caption(
    page,
    "Page 2 says Page 1, on the right. Page 3 says Page 2, on the left.",
    0,
  );
  await showDocumentPage(page, 1);
  await pageOnScreen(page, 1, "top-right");
  await pageOnScreen(page, 2, "top-left");
  await beat(page, 2200);

  await showCover(page);
  await expect(preview.locator(".page-setup-preview-number")).toHaveText(["No number", "Page 1"]);
  await expect(preview.locator("[data-preview-role='cover']")).toContainText("Cover");
  await expect(preview.locator("[data-preview-role='next']")).toContainText("Next page");
  await layoutClear(page);
  await preview.locator("[data-preview-role='next'] .page-setup-preview-number").hover();
  await say(
    page,
    "The preview shows the cover with no numeral, then Page 1 in the outside corner.",
    2400,
  );

  await setup.getByRole("button", { name: "Cancel", exact: true }).hover();
  await beat(page, 240);
  await setup.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(setup).toBeHidden();
  await showDocumentPage(page, 0);
  await pageOnScreen(page, 0, "top-right");
  await say(page, "She cancels. Page 1 has its number again.", 1800);
  await showDocumentPage(page, 1);
  await pageOnScreen(page, 1, "top-left");
  await say(page, "Page 2 is back on the left.", 1600);

  await caption(page, "She turns the cover on again.", 0);
  setup = await openSetup(page);
  await showCover(page);
  await setup.getByRole("checkbox", { name: "Cover has no number" }).hover();
  await beat(page, 200);
  await setup.getByRole("checkbox", { name: "Cover has no number" }).check();
  await caption(page, "On again. The cover is blank before she applies.", 0);
  await beat(page, 500);
  await showCover(page);
  await showDocumentPage(page, 0);
  await pageOnScreen(page, 0, "none");
  await layoutClear(page);
  await beat(page, 1200);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await expect(page.locator(".save-status")).toContainText("Saved");
  await showDocumentPage(page, 0);
  await pageOnScreen(page, 0, "none");
  await say(page, "Applied. The cover stays blank.", 1600);
  await showDocumentPage(page, 1);
  await pageOnScreen(page, 1, "top-right");
  await say(page, "The next page is still Page 1, on the right.", 1600);
  await showDocumentPage(page, 2);
  await pageOnScreen(page, 2, "top-left");
  await say(page, "And page 3 is still Page 2, on the left.", 1600);

  await say(page, "She closes the file and opens it again.", 700);
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await beat(page, 400);
  await page.getByRole("link", { name: "Preface" }).click();
  await expect(editor).toContainText("The front matter starts here.");
  await say(page, "Saved and reopened. The cover is still blank.", 400);

  setup = await openSetup(page);
  await showCover(page);
  await expect(setup.getByRole("checkbox", { name: "Cover has no number" })).toBeChecked();
  await expect(
    setup.getByRole("checkbox", { name: "Different odd and even pages" }),
  ).toBeChecked();
  await expect(setup.getByRole("group", { name: "Page preview" }).locator(".page-setup-preview-number")).toHaveText([
    "No number",
    "Page 1",
  ]);
  await layoutClear(page);
  await showDocumentPage(page, 0);
  await pageOnScreen(page, 0, "none");
  await pageOnScreen(page, 1, "top-right");
  await setup
    .locator("[data-preview-role='next'] .page-setup-preview-number")
    .hover();
  await say(
    page,
    "The cover is still blank, and the next page is still Page 1 on the right.",
    2600,
  );
});
