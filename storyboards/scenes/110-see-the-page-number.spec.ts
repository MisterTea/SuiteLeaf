import { beat, caption, expect, test, typeSlowly } from "./harness";
import type { Page } from "@playwright/test";

const editorOf = (page: Page) =>
  page.getByRole("textbox", { name: "Document content" });

async function showTop(page: Page) {
  await page.locator(".document-stage").evaluate((el) => {
    el.scrollTo({ top: 0, left: 0, behavior: "instant" });
  });
  await beat(page, 350);
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

async function pageBreak(page: Page) {
  const button = page.getByRole("button", { name: "Page break", exact: true });
  if (!(await button.isVisible())) {
    await page.getByRole("button", { name: "More tools", exact: true }).click();
    await expect(button).toBeVisible();
  }
  await button.click();
}

async function numbers(page: Page) {
  return page.locator(".paginated-paper .page-number").allTextContents();
}

async function showNumber(page: Page, index: number, text: string) {
  const el = page.locator(".paginated-paper .page-number").nth(index);
  await expect(el).toHaveText(text);
  await el.evaluate((node) => {
    node.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
  });
  await beat(page, 400);
  const box = await el.boundingBox();
  expect(box, text).toBeTruthy();
  expect(box!.height, text).toBeGreaterThan(11);
  expect(box!.y, text).toBeGreaterThan(70);
  expect(box!.y + box!.height, text).toBeLessThan(740);
}

async function headerText(page: Page) {
  return (await page.locator(".paginated-paper .page-header").first().textContent()) ?? "";
}

async function controlsTogether(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Page setup" });
  const numbersSwitch = dialog.getByRole("checkbox", { name: "Page numbers" });
  const header = dialog.getByLabel("Page header");
  const apply = dialog.getByRole("button", { name: "Apply", exact: true });
  await expect(numbersSwitch).toBeInViewport();
  await expect(header).toBeInViewport();
  await expect(apply).toBeInViewport();
  const clear = await page.evaluate(() => {
    const box = (el: Element) => el.getBoundingClientRect();
    const dialogEl = document.querySelector(".page-setup-dialog") as HTMLElement;
    const body = dialogEl.querySelector(".dialog-body") as HTMLElement;
    const switchEl = dialogEl.querySelector(
      ".page-setup-numbers input[type=checkbox]",
    ) as HTMLElement;
    const headerEl = dialogEl.querySelector('[aria-label="Page header"]') as HTMLElement;
    const applyEl = [...dialogEl.querySelectorAll("button")].find(
      (button) => button.textContent === "Apply",
    ) as HTMLElement;
    const dialogBox = box(dialogEl);
    const bodyBox = box(body);
    const inside = (el: HTMLElement, host: DOMRect) => {
      const r = box(el);
      return (
        r.height > 8 &&
        r.top >= host.top - 1 &&
        r.bottom <= host.bottom + 1 &&
        r.bottom <= window.innerHeight + 1
      );
    };
    return inside(switchEl, dialogBox) && inside(headerEl, bodyBox) && inside(applyEl, dialogBox);
  });
  expect(clear).toBe(true);
}

test("110-see-the-page-number", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Sam is numbering the town council minutes.", 1600);
  await page.getByRole("button", { name: "New document" }).click();
  const title = page.getByLabel("File title");
  await title.click();
  await title.press("ControlOrMeta+A");
  await typeSlowly(page, "Minutes");
  const editor = editorOf(page);
  await editor.click();
  await page.getByLabel("Paragraph style").selectOption("1");
  await typeSlowly(page, "Minutes", 70);
  await editor.press("Enter");
  await typeSlowly(page, "The hearing opens at seven.", 28);
  await beat(page, 300);
  await pageBreak(page);
  await typeSlowly(page, "The vote is next week.", 28);
  await expect(page.locator(".editor-status")).toContainText("2 pages");
  await expect(page.locator(".save-status")).toContainText("Saved");

  await caption(page, "She gives the pages a header. The corner stays blank.", 1400);
  let setup = await openSetup(page);
  await showTop(page);
  await setup.getByLabel("Page header").click();
  await typeSlowly(page, "Draft minutes", 70);
  await expect.poll(async () => headerText(page)).toBe("Draft minutes");
  await beat(page, 500);
  expect(await numbers(page)).toEqual([]);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await showTop(page);
  expect(await headerText(page)).toBe("Draft minutes");
  expect(await numbers(page)).toEqual([]);
  await caption(page, "Draft minutes is on the page. There is still no page number.", 2200);

  await caption(page, "She opens Page setup. The number, the header, and Apply are on screen.", 1500);
  setup = await openSetup(page);
  await showTop(page);
  await controlsTogether(page);
  expect(await numbers(page)).toEqual([]);
  await beat(page, 400);

  await caption(page, "She turns page numbers on.", 900);
  await setup.getByRole("checkbox", { name: "Page numbers" }).click();
  await expect.poll(() => numbers(page)).toEqual(["1 / 2", "2 / 2"]);
  await showNumber(page, 0, "1 / 2");
  await expect(setup).toBeVisible();
  await caption(page, "Before Apply, page 1 shows 1 / 2 in the corner.", 2400);

  await showNumber(page, 1, "2 / 2");
  await caption(page, "Page 2 shows 2 / 2. She has not applied.", 2400);
  await showNumber(page, 0, "1 / 2");
  await beat(page, 400);

  await caption(page, "Cancel. The number leaves. Draft minutes stays.", 900);
  await setup.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(setup).toBeHidden();
  await expect.poll(() => numbers(page)).toEqual([]);
  expect(await headerText(page)).toBe("Draft minutes");
  await beat(page, 400);
  await editor.getByText("The hearing opens at seven.").click();
  await caption(page, "The corner is blank again.", 1800);

  await caption(page, "She turns page numbers on again.", 900);
  setup = await openSetup(page);
  await showTop(page);
  await setup.getByRole("checkbox", { name: "Page numbers" }).click();
  await expect.poll(() => numbers(page)).toEqual(["1 / 2", "2 / 2"]);
  await showNumber(page, 0, "1 / 2");
  await beat(page, 500);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await expect.poll(() => numbers(page)).toEqual(["1 / 2", "2 / 2"]);
  await showNumber(page, 0, "1 / 2");
  await caption(page, "Apply keeps 1 / 2 in the corner she just saw.", 2200);
  await showNumber(page, 1, "2 / 2");
  await caption(page, "And 2 / 2 stays on the next page.", 2000);

  await caption(page, "She closes the file, then opens it again.", 900);
  await expect(page.locator(".save-status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await beat(page, 600);
  await page.getByRole("link", { name: "Minutes" }).click();
  await expect(editor).toContainText("The hearing opens at seven.");
  await editor.getByText("The hearing opens at seven.").click();
  await expect.poll(() => numbers(page)).toEqual(["1 / 2", "2 / 2"]);
  expect(await headerText(page)).toBe("Draft minutes");
  await showNumber(page, 0, "1 / 2");
  await caption(page, "Saved and reopened. 1 / 2 is still in the corner.", 2200);

  await caption(page, "She types Town council in the header.", 1200);
  setup = await openSetup(page);
  await showTop(page);
  await controlsTogether(page);
  const header = setup.getByLabel("Page header");
  await header.click();
  await header.press("ControlOrMeta+A");
  await typeSlowly(page, "Town council", 80);
  await expect.poll(async () => headerText(page)).toBe("Town council");
  await expect.poll(() => numbers(page)).toEqual(["1 / 2", "2 / 2"]);
  await showNumber(page, 0, "1 / 2");
  await expect(setup).toBeVisible();
  await controlsTogether(page);
  await beat(page, 400);
  await caption(
    page,
    "Town council is on the page before Apply, and 1 / 2 stays in the corner.",
    2800,
  );
});
