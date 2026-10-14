import type { Page } from "@playwright/test";
import { createFile, serializeFile, type DocFile } from "../../packages/core/src";
import { beat, caption, expect, test } from "./harness";

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
        pageNumberFormat: "fraction",
        pageNumberPosition: "bottom-right",
        pageNumberPositionSet: false,
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

/** Centered captions sit under the dialog. Corner captions stay on the left so they do not cover the number. */
async function say(page: Page, text: string, hold: number, place: "center" | "left" = "center") {
  await caption(page, text, 0);
  await page.evaluate((where) => {
    const bar = document.getElementById("storyboard-caption") as HTMLElement | null;
    if (!bar) return;
    bar.style.bottom = "24px";
    if (where === "left") {
      bar.style.left = "24px";
      bar.style.right = "auto";
      bar.style.transform = "none";
      bar.style.maxWidth = "320px";
      bar.style.textAlign = "left";
    } else {
      bar.style.left = "50%";
      bar.style.right = "auto";
      bar.style.transform = "translateX(-50%)";
      bar.style.maxWidth = "80%";
      bar.style.textAlign = "center";
    }
  }, place);
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

/** Show the top of a page: the header and a top-right number share that row. */
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

/** Show the bottom of a page so the corner number sits on the page edge. */
async function showPageBottom(page: Page, index: number) {
  const face = page.locator(".page-furniture-page").nth(index);
  await face.evaluate((el) => {
    const stage = el.closest(".document-stage") as HTMLElement;
    const stageBox = stage.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const wantBottom = stageBox.bottom - 150;
    stage.scrollTo({
      top: Math.max(0, stage.scrollTop + (box.bottom - wantBottom)),
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
  const position = dialog.getByRole("group", { name: "Position" });
  const apply = dialog.getByRole("button", { name: "Apply", exact: true });
  await expect(format).toBeInViewport();
  await expect(position).toBeInViewport();
  await expect(apply).toBeInViewport();
  const clear = await page.evaluate(() => {
    const box = (el: Element) => el.getBoundingClientRect();
    const dialogEl = document.querySelector(".page-setup-dialog") as HTMLElement;
    const formatEl = [...dialogEl.querySelectorAll("fieldset")].find(
      (field) => field.querySelector("legend")?.textContent === "Format",
    ) as HTMLElement;
    const positionEl = [...dialogEl.querySelectorAll("fieldset")].find(
      (field) => field.querySelector("legend")?.textContent === "Position",
    ) as HTMLElement;
    const applyEl = [...dialogEl.querySelectorAll("button")].find(
      (button) => button.textContent === "Apply",
    ) as HTMLElement;
    const host = box(dialogEl);
    const inside = (el: HTMLElement) => {
      const r = box(el);
      return (
        r.width > 40 &&
        r.height > 16 &&
        r.top >= -1 &&
        r.bottom <= window.innerHeight - 8 &&
        r.top >= host.top - 1 &&
        r.bottom <= host.bottom + 1 &&
        r.left >= host.left - 1 &&
        r.right <= host.right + 1
      );
    };
    return window.innerHeight === 800 && inside(formatEl) && inside(positionEl) && inside(applyEl);
  });
  expect(clear).toBe(true);
}

async function clearOfHeader(page: Page, index: number, text: string) {
  const face = page.locator(".page-furniture-page").nth(index);
  await expect(face).toHaveAttribute("data-number-side", "top-right");
  await expect(face.locator(".page-number")).toHaveText(text);
  const placed = await face.evaluate((pageEl) => {
    const header = pageEl.querySelector(".page-header") as HTMLElement;
    const number = pageEl.querySelector(".page-number") as HTMLElement;
    const textBox = header.getBoundingClientRect();
    const pill = number.getBoundingClientRect();
    const sheet = pageEl.getBoundingClientRect();
    return {
      header: header.textContent,
      gap: pill.left - textBox.right,
      sameRow: Math.abs(pill.top - textBox.top) < 28,
      onRight: pill.left > sheet.left + sheet.width * 0.45,
      nearTop: pill.top - sheet.top < sheet.height * 0.2,
    };
  });
  expect(placed.header).toBe("Draft minutes");
  expect(placed.gap).toBeGreaterThan(8);
  expect(placed.sameRow).toBe(true);
  expect(placed.onRight).toBe(true);
  expect(placed.nearTop).toBe(true);
}

test("113-see-where-the-number-goes", async ({ page }) => {
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
  await expect.poll(() => numbers(page)).toEqual(["1 / 2", "2 / 2"]);

  await showPageTop(page, 0);
  await expect(page.locator(".paginated-paper .page-header").first()).toHaveText(
    "Draft minutes",
  );
  await say(page, "Sam opens the minutes. The header says Draft minutes.", 2000);

  await showPageBottom(page, 0);
  await readableNumber(page, 0);
  await say(page, "The corner of page 1 says 1 / 2.", 2000, "left");

  let setup = await openSetup(page);
  await showPageTop(page, 0);
  await controlsTogether(page);
  await expect.poll(() => numbers(page)).toEqual(["1 / 2", "2 / 2"]);
  const corner = await readableNumber(page, 0);
  const pageBox = await page.locator(".page-furniture-page").first().boundingBox();
  expect(pageBox).toBeTruthy();
  expect(corner.y).toBeGreaterThan(pageBox!.y + pageBox!.height * 0.55);
  await say(page, "She opens Page setup. Format, position, and Apply are on screen.", 1600);

  await say(page, "She chooses Page 1.", 700);
  await setup.getByRole("radio", { name: "Page 1" }).check();
  await expect.poll(() => numbers(page)).toEqual(["Page 1", "Page 2"]);
  await showPageTop(page, 0);
  await expect(page.locator(".page-furniture-page").first()).toHaveAttribute(
    "data-number-side",
    "right",
  );
  const cornerPage = await page.locator(".page-furniture-page").first().boundingBox();
  const stillCorner = await readableNumber(page, 0);
  expect(cornerPage).toBeTruthy();
  expect(stillCorner.y).toBeGreaterThan(cornerPage!.y + cornerPage!.height * 0.4);
  await expect(setup).toBeVisible();
  await controlsTogether(page);
  await say(page, "Before Apply, that corner says Page 1.", 2400);

  await say(page, "She puts the number at the top right.", 800);
  await setup.getByRole("radio", { name: "Top right" }).check();
  await expect.poll(() => numbers(page)).toEqual(["Page 1", "Page 2"]);
  await showPageTop(page, 0);
  await clearOfHeader(page, 0, "Page 1");
  await clearOfHeader(page, 1, "Page 2");
  await readableNumber(page, 0);
  await readableNumber(page, 1);
  await expect(setup).toBeVisible();
  await controlsTogether(page);
  await say(page, "Before Apply, Page 1 sits at the top right, clear of Draft minutes.", 2400);
  await say(page, "Page 2 shows Page 2 in the same place. She has not applied.", 2600);
  await say(page, "Cancel.", 600);
  await setup.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(setup).toBeHidden();
  await expect.poll(() => numbers(page)).toEqual(["1 / 2", "2 / 2"]);
  await expect(page.locator(".page-furniture-page").first()).toHaveAttribute(
    "data-number-side",
    "right",
  );
  await showPageBottom(page, 0);
  await readableNumber(page, 0);
  await say(page, "Cancel puts 1 / 2 back in the corner.", 2200, "left");

  setup = await openSetup(page);
  await say(page, "She chooses Page 1 at the top right again.", 800);
  await setup.getByRole("radio", { name: "Page 1" }).check();
  await setup.getByRole("radio", { name: "Top right" }).check();
  await expect.poll(() => numbers(page)).toEqual(["Page 1", "Page 2"]);
  await showPageTop(page, 0);
  await clearOfHeader(page, 0, "Page 1");
  await controlsTogether(page);
  await beat(page, 500);
  await say(page, "She sees Page 1 at the top right, then applies.", 1600);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await expect.poll(() => numbers(page)).toEqual(["Page 1", "Page 2"]);
  await showPageTop(page, 0);
  await clearOfHeader(page, 0, "Page 1");
  await readableNumber(page, 0);
  await say(page, "Apply keeps Page 1 at the top right.", 2200);
  await showPageTop(page, 1);
  await clearOfHeader(page, 1, "Page 2");
  await say(page, "Page 2 keeps Page 2 there too.", 1800);

  await say(page, "She closes the file, then opens it again.", 900);
  await expect(page.locator(".save-status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await beat(page, 500);
  await page.getByRole("link", { name: "Minutes" }).click();
  await expect(editor).toContainText("The hearing opens at seven.");
  await expect.poll(() => numbers(page)).toEqual(["Page 1", "Page 2"]);
  await showPageTop(page, 0);
  await clearOfHeader(page, 0, "Page 1");
  await say(page, "Saved and reopened. Page 1 is still at the top right.", 2400);
});
