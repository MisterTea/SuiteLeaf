import type { Page } from "@playwright/test";
import { createFile, serializeFile, type DocFile } from "../../packages/core/src";
import { beat, caption, expect, test, typeSlowly } from "./harness";

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
        size: "letter",
        landscape: false,
        margin: inch(1),
        marginTop: inch(1),
        marginBottom: inch(1),
        marginLeft: inch(1),
        marginRight: inch(1),
        header: "Garden club minutes",
        footer: "",
        headerFromEdge: inch(0.5),
        footerFromEdge: inch(0.5),
        pageNumbers: true,
        pageNumberFormat: "page",
        pageNumberPosition: "top-right",
        pageNumberPositionSet: true,
        pageNumberStart: 1,
        differentOddEven: false,
        coverHasNoNumber: false,
        differentFirstPage: false,
      },
    },
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "October meeting" }],
      },
      paragraph(
        "The committee agreed the budget for the new shed and set the date of the dinner.",
      ),
      { type: "pageBreak" },
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Plot assignments" }],
      },
      paragraph("North beds take the first twelve plots. South beds take the rest."),
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

async function scrollDialog(page: Page, which: "switch" | "preview" | "letterhead") {
  await page.evaluate((target) => {
    const body = document.querySelector(
      ".page-setup-dialog .dialog-body",
    ) as HTMLElement;
    const el =
      target === "preview"
        ? (body.querySelector(".page-setup-preview") as HTMLElement)
        : target === "letterhead"
          ? (body.querySelector('[aria-label="First page header"]') as HTMLElement)
          : ([...body.querySelectorAll("label")].find((label) =>
              label.textContent?.includes("Different first page"),
            ) as HTMLElement);
    const delta = el.getBoundingClientRect().top - body.getBoundingClientRect().top;
    body.scrollTop += delta - 8;
  }, which);
  await beat(page, 220);
}

async function showDocumentPage(page: Page, index: number) {
  await page.evaluate((i) => {
    const face = document.querySelectorAll(".page-furniture-page")[i] as HTMLElement;
    const stage = document.querySelector(".document-stage") as HTMLElement;
    const delta = face.getBoundingClientRect().top - stage.getBoundingClientRect().top;
    stage.scrollTop += delta - 8;
  }, index);
  await beat(page, 400);
}

async function pageClear(
  page: Page,
  index: number,
  header: string,
  number: string | null,
) {
  const report = await page.evaluate(
    ({ index: i, header: words, number: numeral }) => {
      const face = document.querySelectorAll(".page-furniture-page")[i] as HTMLElement;
      const headerEl = face.querySelector(".page-header") as HTMLElement;
      const numberEl = face.querySelector(".page-number") as HTMLElement | null;
      const stage = document.querySelector(".document-stage") as HTMLElement;
      const dialog = document.querySelector(".page-setup-dialog") as HTMLElement | null;
      const captionBar = document.getElementById("storyboard-caption");
      const box = (el: Element) => el.getBoundingClientRect();
      const overlap = (a: DOMRect, b: DOMRect) =>
        a.left < b.right - 1 &&
        a.right > b.left + 1 &&
        a.top < b.bottom - 1 &&
        a.bottom > b.top + 1;
      const problems: string[] = [];
      const side = face.getAttribute("data-number-side");
      if ((headerEl.textContent ?? "") !== words) problems.push(`header ${headerEl.textContent}`);
      if (numeral == null) {
        if (numberEl) problems.push("number still drawn");
        if (side !== "none") problems.push(`side ${side}`);
      } else {
        if (!numberEl) problems.push("missing number");
        else if (numberEl.textContent !== numeral) problems.push(`number ${numberEl.textContent}`);
        if (side !== "top-right") problems.push(`side ${side}`);
      }
      const port = box(stage);
      const top = box(headerEl);
      const mark = numberEl ? box(numberEl) : null;
      const band = mark ?? {
        top: box(face).top,
        bottom: box(face).top + 36,
        left: box(face).left + 24,
        right: Math.min(box(face).right, port.right) - 8,
        width: 40,
        height: 36,
        x: 0,
        y: 0,
        toJSON() {
          return {};
        },
      };
      const visible = (r: { top: number; bottom: number; left: number; right: number; height: number; width: number }) =>
        r.top >= Math.max(port.top, 0) - 2 &&
        r.bottom <= Math.min(port.bottom, window.innerHeight) - 2 &&
        r.left >= port.left - 2 &&
        r.right <= window.innerWidth - 2 &&
        r.height > 4 &&
        r.width > 8;
      if (words && !visible(top)) problems.push("header off screen");
      if (mark && !visible(mark)) problems.push("number off screen");
      if (!words && !mark && band.top > Math.min(port.bottom, window.innerHeight) - 48)
        problems.push("page top off screen");
      const blocked = (r: DOMRect) => {
        if (dialog && overlap(r, box(dialog))) return "under dialog";
        if (captionBar && overlap(r, box(captionBar))) return "under caption";
        return "";
      };
      if (words) {
        const hit = blocked(top);
        if (hit) problems.push(`header ${hit}`);
      }
      if (mark) {
        const hit = blocked(mark);
        if (hit) problems.push(`number ${hit}`);
        const sheet = box(face);
        const onRight = sheet.right - mark.right <= 28 && mark.left > sheet.left + sheet.width * 0.35;
        const atTop = mark.top - sheet.top < sheet.height * 0.22;
        if (!onRight || !atTop) problems.push("number not top right");
        if (words && overlap(top, mark)) problems.push("number covers header");
      }
      return problems;
    },
    { index, header, number },
  );
  expect(report, `document page ${index + 1}`).toEqual([]);
}

async function previewClear(page: Page, firstHeader: string) {
  const report = await page.evaluate((letterhead) => {
    const box = (el: Element) => el.getBoundingClientRect();
    const dialog = document.querySelector(".page-setup-dialog") as HTMLElement;
    const body = dialog.querySelector(".dialog-body") as HTMLElement;
    const preview = dialog.querySelector(".page-setup-preview") as HTMLElement;
    const sheets = [...preview.querySelectorAll(".page-setup-preview-page")];
    const apply = [...dialog.querySelectorAll("button")].find(
      (button) => button.textContent === "Apply",
    ) as HTMLElement;
    const captionBar = document.getElementById("storyboard-caption");
    const overlap = (a: DOMRect, b: DOMRect) =>
      a.left < b.right - 1 &&
      a.right > b.left + 1 &&
      a.top < b.bottom - 1 &&
      a.bottom > b.top + 1;
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
        r.bottom <= window.innerHeight - 8
      );
    };
    const problems: string[] = [];
    if (window.innerWidth !== 1280 || window.innerHeight !== 800) problems.push("viewport");
    if (sheets.length !== 2) problems.push(`sheets ${sheets.length}`);
    if (!inside(apply, host) || (captionBar && overlap(box(apply), box(captionBar))))
      problems.push("apply");
    sheets.forEach((pageEl, index) => {
      const sheet = pageEl.querySelector(".page-setup-preview-sheet") as HTMLElement;
      const header = pageEl.querySelector(".page-setup-preview-header") as HTMLElement | null;
      const number = pageEl.querySelector(".page-setup-preview-number") as HTMLElement;
      if (!inside(sheet, port)) problems.push(`sheet ${index} clipped`);
      if (captionBar && overlap(box(sheet), box(captionBar)))
        problems.push(`sheet ${index} under caption`);
      const expectedHeader = index === 0 ? letterhead : "Garden club minutes";
      const expectedNumber = index === 0 ? "No number" : "Page 2";
      if ((number.textContent ?? "") !== expectedNumber)
        problems.push(`number ${index} ${number.textContent}`);
      if (!expectedHeader) {
        if (header) problems.push(`header ${index} present`);
      } else if (!header || header.textContent !== expectedHeader) {
        problems.push(`header ${index} ${header?.textContent ?? "missing"}`);
      }
      if (header) {
        if (header.scrollHeight > header.clientHeight + 2) problems.push(`header ${index} clipped`);
        if (overlap(box(header), box(number))) problems.push(`header ${index} covers number`);
        const s = box(sheet);
        const h = box(header);
        if (h.left < s.left - 1 || h.right > s.right + 1 || h.bottom > s.bottom - 1)
          problems.push(`header ${index} outside`);
      }
      const s = box(sheet);
      const n = box(number);
      const corner = sheet.getAttribute("data-number-corner");
      if (index === 0) {
        if (corner !== "none") problems.push(`corner ${corner}`);
      } else if (corner !== "top-right") {
        problems.push(`corner ${corner}`);
      } else {
        const onRight = s.right - n.right <= 18 && n.left > s.left + s.width * 0.28;
        const atTop = n.top - s.top <= 22;
        if (!onRight || !atTop) problems.push("page 2 number misplaced");
      }
    });
    if (box(sheets[0]).left >= box(sheets[1]).left) problems.push("order");
    return problems;
  }, firstHeader);
  expect(report, "preview layout").toEqual([]);
}

test("135-see-a-different-first-page", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Minutes.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(minutes())),
  });
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toContainText("Plot assignments");
  await expect(page.locator(".editor-status")).toContainText("2 pages");
  await showDocumentPage(page, 0);
  await pageClear(page, 0, "Garden club minutes", "Page 1");
  await say(
    page,
    "Sam is sending the club minutes. Page 1 has the shared header and Page 1.",
    1900,
  );

  await showDocumentPage(page, 1);
  await pageClear(page, 1, "Garden club minutes", "Page 2");
  await say(page, "Page 2 repeats that header, and it says Page 2.", 1800);

  let setup = await openSetup(page);
  await scrollDialog(page, "switch");
  const different = setup.getByRole("checkbox", { name: "Different first page" });
  const oddEven = setup.getByRole("checkbox", { name: "Different odd and even pages" });
  const cover = setup.getByRole("checkbox", { name: "Cover has no number" });
  await expect(different).not.toBeChecked();
  await expect(oddEven).not.toBeChecked();
  await expect(cover).not.toBeChecked();
  await expect(setup.getByRole("radio", { name: "Page 1" })).toBeChecked();
  await expect(setup.getByRole("radio", { name: "Top right" })).toBeChecked();
  await showDocumentPage(page, 0);
  await pageClear(page, 0, "Garden club minutes", "Page 1");
  await say(
    page,
    "Page setup is open. Different first page is off, and Page 1 is still there.",
    2000,
  );

  await different.hover();
  await beat(page, 240);
  await different.check();
  await page.mouse.move(160, 200, { steps: 8 });
  await expect(setup.getByRole("button", { name: "Apply", exact: true })).toBeVisible();
  await showDocumentPage(page, 0);
  await pageClear(page, 0, "", null);
  await say(
    page,
    "She ticks Different first page. Before Apply, the header and the number leave page 1.",
    2200,
  );

  await showDocumentPage(page, 1);
  const pageTwo = await page
    .locator(".page-furniture-page")
    .nth(1)
    .locator(".page-number")
    .boundingBox();
  if (pageTwo)
    await page.mouse.move(pageTwo.x + pageTwo.width / 2, pageTwo.y + 4, { steps: 10 });
  await pageClear(page, 1, "Garden club minutes", "Page 2");
  await say(
    page,
    "Page 2 still says Garden club minutes and Page 2. Numbering does not restart.",
    2200,
  );

  await scrollDialog(page, "preview");
  await showDocumentPage(page, 0);
  const preview = setup.getByRole("group", { name: "Page preview" });
  await expect(preview.locator(".page-setup-preview-number")).toHaveText([
    "No number",
    "Page 2",
  ]);
  await previewClear(page, "");
  await preview.locator(".page-setup-preview-number").nth(1).hover();
  await say(
    page,
    "The preview shows a blank first sheet, then Garden club minutes and Page 2.",
    2400,
  );

  await scrollDialog(page, "letterhead");
  const letterhead = setup.getByLabel("First page header");
  await letterhead.click();
  await showDocumentPage(page, 0);
  await say(page, "She types a letterhead for page 1 only.", 700);
  await typeSlowly(page, "Riverside Garden Club", 70);
  await expect(page.locator(".page-furniture-page").nth(0).locator(".page-header")).toHaveText(
    "Riverside Garden Club",
  );
  await pageClear(page, 0, "Riverside Garden Club", null);
  await beat(page, 600);
  await showDocumentPage(page, 1);
  await pageClear(page, 1, "Garden club minutes", "Page 2");
  await say(page, "That line is only on page 1. Page 2 does not gain it.", 2000);

  await scrollDialog(page, "preview");
  await showDocumentPage(page, 0);
  await expect(preview.locator(".page-setup-preview-header")).toHaveText([
    "Riverside Garden Club",
    "Garden club minutes",
  ]);
  await previewClear(page, "Riverside Garden Club");
  await preview.locator(".page-setup-preview-header").first().hover();
  await say(
    page,
    "The preview's first sheet shows the letterhead. The second sheet still has the running header.",
    2400,
  );

  await setup.getByRole("button", { name: "Cancel", exact: true }).hover();
  await beat(page, 200);
  await setup.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(setup).toBeHidden();
  await showDocumentPage(page, 0);
  await pageClear(page, 0, "Garden club minutes", "Page 1");
  await say(page, "She cancels. Page 1 has the shared header and Page 1 again.", 2000);

  await say(page, "She turns Different first page on again and types the letterhead.", 800);
  setup = await openSetup(page);
  await scrollDialog(page, "switch");
  await setup.getByRole("checkbox", { name: "Different first page" }).check();
  await scrollDialog(page, "letterhead");
  await setup.getByLabel("First page header").click();
  await typeSlowly(page, "Riverside Garden Club", 55);
  await showDocumentPage(page, 0);
  await pageClear(page, 0, "Riverside Garden Club", null);
  await showDocumentPage(page, 1);
  await pageClear(page, 1, "Garden club minutes", "Page 2");
  await say(page, "Page 1 is the letterhead. Page 2 is still Page 2. She applies.", 1600);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await expect(page.locator(".save-status")).toContainText("Saved");
  await showDocumentPage(page, 0);
  await pageClear(page, 0, "Riverside Garden Club", null);
  await say(page, "Applied. The letterhead stays, with no number.", 1600);
  await showDocumentPage(page, 1);
  await pageClear(page, 1, "Garden club minutes", "Page 2");
  await say(page, "Page 2 still says Garden club minutes and Page 2.", 1600);

  await say(page, "She closes the file and opens it again.", 700);
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await beat(page, 400);
  await page.getByRole("link", { name: "Minutes" }).click();
  await expect(editor).toContainText("October meeting");
  await showDocumentPage(page, 0);
  await pageClear(page, 0, "Riverside Garden Club", null);
  await say(page, "Saved and reopened. Page 1 is still the letterhead, with no number.", 1800);
  await showDocumentPage(page, 1);
  await pageClear(page, 1, "Garden club minutes", "Page 2");
  setup = await openSetup(page);
  await scrollDialog(page, "preview");
  await expect(setup.getByRole("checkbox", { name: "Different first page" })).toBeChecked();
  await expect(setup.getByRole("checkbox", { name: "Cover has no number" })).not.toBeChecked();
  await expect(setup.getByRole("group", { name: "Page preview" }).locator(".page-setup-preview-number")).toHaveText([
    "No number",
    "Page 2",
  ]);
  await previewClear(page, "Riverside Garden Club");
  await showDocumentPage(page, 0);
  await pageClear(page, 0, "Riverside Garden Club", null);
  await setup
    .locator(".page-setup-preview-number")
    .nth(1)
    .hover();
  await say(
    page,
    "The letterhead is still only on page 1, and page 2 is still Page 2.",
    2400,
  );
});
