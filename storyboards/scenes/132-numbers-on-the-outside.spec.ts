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

/** Keep the odd/even switch and the small pages on screen together. */
async function showSpread(page: Page) {
  await page.evaluate(() => {
    const body = document.querySelector(
      ".page-setup-dialog .dialog-body",
    ) as HTMLElement;
    const variants = body.querySelector(".page-setup-variants") as HTMLElement;
    const preview = body.querySelector(".page-setup-preview") as HTMLElement;
    const align = () => {
      const delta =
        variants.getBoundingClientRect().top - body.getBoundingClientRect().top;
      if (Math.abs(delta) > 1) body.scrollTop += delta;
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
    face.scrollIntoView({ block: "center", inline: "nearest" });
  }, index);
  await beat(page, 450);
}

async function layoutClear(page: Page, mode: "ends" | "spread") {
  const report = await page.evaluate((which) => {
    const box = (el: Element) => el.getBoundingClientRect();
    const dialog = document.querySelector(".page-setup-dialog") as HTMLElement;
    const body = dialog.querySelector(".dialog-body") as HTMLElement;
    const preview = dialog.querySelector(".page-setup-preview") as HTMLElement;
    const sheets = [...preview.querySelectorAll(".page-setup-preview-sheet")];
    const apply = [...dialog.querySelectorAll("button")].find(
      (button) => button.textContent === "Apply",
    ) as HTMLElement;
    const oddEven = [...dialog.querySelectorAll("label")].find((label) =>
      label.textContent?.includes("Different odd and even pages"),
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
    if (!inside(oddEven, port)) problems.push("switch clipped");
    if (!clearOfCaption(oddEven)) problems.push("switch under caption");
    if (sheets.length !== 2) problems.push(`sheets ${sheets.length}`);
    sheets.forEach((sheet, index) => {
      const number = sheet.querySelector(".page-setup-preview-number");
      const label = sheet.parentElement?.querySelector(".page-setup-preview-label");
      if (!inside(sheet, port)) problems.push(`sheet ${index} clipped`);
      if (!number) {
        problems.push(`sheet ${index} number`);
        return;
      }
      const s = box(sheet);
      const n = box(number);
      const pageShaped = s.height >= s.width * 0.95;
      const onPage =
        n.left >= s.left - 1 &&
        n.right <= s.right + 1 &&
        n.top >= s.top - 1 &&
        n.bottom <= s.bottom + 1;
      const corner = sheet.getAttribute("data-number-corner");
      const onLeft = n.left - s.left <= 18 && n.right < s.left + s.width * 0.72;
      const onRight = s.right - n.right <= 18 && n.left > s.left + s.width * 0.28;
      const atTop = n.top - s.top <= 18 && n.bottom < s.top + s.height * 0.45;
      const placed =
        corner === "top-left"
          ? onLeft && atTop
          : corner === "top-right"
            ? onRight && atTop
            : false;
      if (!pageShaped || !onPage || !placed)
        problems.push(
          `sheet ${index} ${corner} ${JSON.stringify({
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
    if (which === "spread") {
      const even = preview.querySelector("[data-preview-role='last-even']");
      const odd = preview.querySelector("[data-preview-role='last-odd']");
      if (!even || !odd) problems.push("roles");
      else if (box(even).left >= box(odd).left) problems.push("order");
    }
    const skip = preview.querySelector(".page-setup-preview-skip");
    if (which === "ends" && skip && !inside(skip, port)) problems.push("skip clipped");
    if (which === "ends" && !skip) problems.push("skip missing");
    if (which === "spread" && skip) problems.push("skip present");
    if (!inside(apply, host) || !clearOfCaption(apply)) problems.push("apply");
    return problems;
  }, mode);
  expect(report, "preview layout").toEqual([]);
}

async function pageOnScreen(
  page: Page,
  index: number,
  corner: "top-left" | "top-right",
) {
  const report = await page.evaluate(
    ({ index: i, corner: which }) => {
      const face = document.querySelectorAll(".page-furniture-page")[i] as HTMLElement;
      const number = face.querySelector(".page-number") as HTMLElement | null;
      const stage = document.querySelector(".document-stage") as HTMLElement;
      if (!number) return ["missing number"];
      const box = (el: Element) => el.getBoundingClientRect();
      const s = box(face);
      const n = box(number);
      const port = box(stage);
      const dialog = document.querySelector(".page-setup-dialog") as HTMLElement;
      const overlap = (a: DOMRect, b: DOMRect) =>
        a.left < b.right - 1 &&
        a.right > b.left + 1 &&
        a.top < b.bottom - 1 &&
        a.bottom > b.top + 1;
      const onLeft = n.left - s.left <= 24 && n.right < s.left + s.width * 0.62;
      const onRight = s.right - n.right <= 24 && n.left > s.left + s.width * 0.38;
      const atTop = n.top - s.top < s.height * 0.22 && n.bottom < s.top + s.height * 0.4;
      const placed = which === "top-left" ? onLeft && atTop : onRight && atTop;
      const inStage =
        n.top >= Math.max(port.top, 0) + 2 &&
        n.bottom <= Math.min(port.bottom, window.innerHeight) - 2 &&
        n.left >= port.left + 2 &&
        n.right <= port.right - 2;
      const problems: string[] = [];
      if (face.getAttribute("data-number-side") !== which) problems.push("side");
      if (!placed)
        problems.push(
          `corner ${JSON.stringify({
            left: Math.round(n.left - s.left),
            right: Math.round(s.right - n.right),
            top: Math.round(n.top - s.top),
            width: Math.round(s.width),
          })}`,
        );
      if (!inStage) problems.push("off screen");
      if (dialog && overlap(n, box(dialog))) problems.push("under dialog");
      const captionBar = document.getElementById("storyboard-caption");
      if (captionBar && overlap(n, box(captionBar))) problems.push("under caption");
      return problems;
    },
    { index, corner },
  );
  expect(report, `document page ${index + 1}`).toEqual([]);
}

test("132-numbers-on-the-outside", async ({ page }) => {
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
  await say(page, "Sam's preface is five pages. The number is already at the top right.", 1800);

  let setup = await openSetup(page);
  await showSpread(page);
  const oddEven = setup.getByRole("checkbox", { name: "Different odd and even pages" });
  const preview = setup.getByRole("group", { name: "Page preview" });
  const miniature = preview.locator(".page-setup-preview-sheet");
  await expect(oddEven).not.toBeChecked();
  await expect(setup.getByRole("radio", { name: "Top right", exact: true })).toBeChecked();
  await expect(miniature).toHaveCount(2);
  await expect(preview.locator(".page-setup-preview-number")).toHaveText(["Page 1", "Page 5"]);
  await expect(preview.locator(".page-setup-preview-skip-label")).toHaveText(
    "Pages 2\u20134 skipped",
  );
  await layoutClear(page, "ends");
  await miniature.nth(1).hover({ position: { x: 100, y: 24 } });
  await say(
    page,
    "Page setup shows page 1 and the last page. Both numbers sit at the top right.",
    2600,
  );

  await showDocumentPage(page, 3);
  await pageOnScreen(page, 3, "top-right");
  await say(page, "On the page itself, page 4's number is at the top right too.", 1800);

  await oddEven.hover();
  await beat(page, 300);
  await oddEven.check();
  await caption(
    page,
    "She turns on different odd and even pages. Before Apply, page 4 slides to the left. Page 5 stays on the right.",
    0,
  );
  await beat(page, 700);
  await showSpread(page);
  await expect(setup.getByRole("button", { name: "Apply", exact: true })).toBeVisible();
  await expect(setup.getByRole("radio", { name: "Top right", exact: true })).toBeChecked();
  await expect(preview.locator(".page-setup-preview-number")).toHaveText(["Page 4", "Page 5"]);
  await expect(preview.locator("[data-preview-role='last-even']")).toContainText(
    "Page 4 · last even",
  );
  await expect(preview.locator("[data-preview-role='last-odd']")).toContainText(
    "Page 5 · last odd",
  );
  await layoutClear(page, "spread");
  await showDocumentPage(page, 3);
  await pageOnScreen(page, 3, "top-left");
  await beat(page, 1600);

  await showDocumentPage(page, 4);
  await pageOnScreen(page, 4, "top-right");
  await say(
    page,
    "The pages match the preview. Page 4 is on the left. Page 5 is still on the right. Apply is still waiting.",
    2600,
  );

  await showDocumentPage(page, 3);
  await oddEven.hover();
  await beat(page, 250);
  await oddEven.uncheck();
  await caption(
    page,
    "She turns the switch off. Every page, including the last one, puts the number back at the top right.",
    0,
  );
  await beat(page, 700);
  await showSpread(page);
  await expect(setup.getByRole("radio", { name: "Top right", exact: true })).toBeChecked();
  await expect(preview.locator(".page-setup-preview-number")).toHaveText(["Page 1", "Page 5"]);
  await layoutClear(page, "ends");
  await showDocumentPage(page, 3);
  await pageOnScreen(page, 3, "top-right");
  await showDocumentPage(page, 4);
  await pageOnScreen(page, 4, "top-right");
  await beat(page, 1800);

  await showDocumentPage(page, 3);
  await oddEven.hover();
  await beat(page, 250);
  await oddEven.check();
  await caption(
    page,
    "On again. Page 4 on the left, page 5 on the right. She applies.",
    0,
  );
  await beat(page, 600);
  await showSpread(page);
  await expect(preview.locator(".page-setup-preview-number")).toHaveText(["Page 4", "Page 5"]);
  await layoutClear(page, "spread");
  await showDocumentPage(page, 3);
  await pageOnScreen(page, 3, "top-left");
  await beat(page, 1400);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await expect(page.locator(".save-status")).toContainText("Saved");
  await say(page, "She closes the file and opens it again.", 1400);
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await beat(page, 500);
  await page.getByRole("link", { name: "Preface" }).click();
  await expect(editor).toContainText("The front matter starts here.");

  setup = await openSetup(page);
  await showSpread(page);
  await expect(
    setup.getByRole("checkbox", { name: "Different odd and even pages" }),
  ).toBeChecked();
  await expect(preview.locator(".page-setup-preview-number")).toHaveText(["Page 4", "Page 5"]);
  await layoutClear(page, "spread");
  await showDocumentPage(page, 3);
  await pageOnScreen(page, 3, "top-left");
  await showDocumentPage(page, 4);
  await pageOnScreen(page, 4, "top-right");
  await say(
    page,
    "Saved and reopened. Page 4 is still on the left, and page 5 is still on the right.",
    2800,
  );
});
