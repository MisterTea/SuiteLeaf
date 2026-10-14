import { beat, caption, expect, test, typeSlowly } from "./harness";
import type { Page } from "@playwright/test";

const editorOf = (page: Page) =>
  page.getByRole("textbox", { name: "Document content" });

async function sheet(page: Page) {
  return page.evaluate(() => {
    const paper = document.querySelector(".paginated-paper") as HTMLElement;
    const content = document.querySelector(".document-content") as HTMLElement;
    const header = paper.querySelector(".page-header") as HTMLElement | null;
    const footer = paper.querySelector(".page-footer") as HTMLElement | null;
    const title = content.querySelector("h1") as HTMLElement;
    const furniture = (header?.closest(".page-furniture-page") ??
      paper.querySelector(".page-furniture-page")) as HTMLElement;
    const pageBox = furniture.getBoundingClientRect();
    const paperBox = paper.getBoundingClientRect();
    const zoom = paperBox.width / paper.offsetWidth || 1;
    const headerBox = header?.getBoundingClientRect();
    const footerBox = footer?.getBoundingClientRect();
    const titleBox = title.getBoundingClientRect();
    return {
      width: parseFloat(paper.style.getPropertyValue("--page-width")),
      height: parseFloat(paper.style.getPropertyValue("--page-height")),
      visualWide: paperBox.width > paperBox.height,
      headerText: header?.textContent ?? "",
      footerText: footer?.querySelector(".page-footer-text")?.textContent ?? "",
      headerTop: headerBox ? (headerBox.top - pageBox.top) / zoom / 96 : 0,
      footerFromBottom: footerBox
        ? (pageBox.bottom - footerBox.bottom) / zoom / 96
        : 0,
      headerAboveTitle: headerBox
        ? headerBox.height > 2 && headerBox.bottom <= titleBox.top + 2
        : false,
      titleOnPage: titleBox.bottom <= pageBox.bottom + 1,
    };
  });
}

function near(actual: number, expected: number) {
  expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(
    0.12,
  );
}

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

async function wordsTogether(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Page setup" });
  const header = dialog.getByLabel("Page header");
  const footer = dialog.getByLabel("Page footer");
  const apply = dialog.getByRole("button", { name: "Apply", exact: true });
  await expect(header).toBeInViewport();
  await expect(footer).toBeInViewport();
  await expect(apply).toBeInViewport();
  const clear = await page.evaluate(() => {
    const box = (el: Element) => el.getBoundingClientRect();
    const headerEl = document.querySelector('[aria-label="Page header"]') as HTMLElement;
    const footerEl = document.querySelector('[aria-label="Page footer"]') as HTMLElement;
    const applyEl = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Apply",
    ) as HTMLElement;
    const body = document.querySelector(".page-setup-dialog .dialog-body") as HTMLElement;
    const bodyBox = box(body);
    const onScreen = (el: HTMLElement) => {
      const r = box(el);
      return r.top >= -1 && r.bottom <= window.innerHeight + 1 && r.height > 8;
    };
    const inBody = (el: HTMLElement) => {
      const r = box(el);
      return r.top >= bodyBox.top - 1 && r.bottom <= bodyBox.bottom + 1;
    };
    return (
      onScreen(headerEl) &&
      onScreen(footerEl) &&
      onScreen(applyEl) &&
      inBody(headerEl) &&
      inBody(footerEl)
    );
  });
  expect(clear).toBe(true);
}

test("106-see-the-header-text", async ({ page }) => {
  await page.goto("/");
  await caption(
    page,
    "Sam is writing the minutes. She wants to see the header before she applies it.",
    1800,
  );
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
  await expect(page.locator(".save-status")).toContainText("Saved");
  await beat(page, 400);

  await caption(page, "Page setup. The page header is empty.", 1400);
  let setup = await openSetup(page);
  await showTop(page);
  await beat(page, 500);
  expect((await sheet(page)).headerText).toBe("");
  await wordsTogether(page);

  await caption(page, "She puts the header an inch from the top. Still no words.", 1400);
  for (const label of ["Top margin", "Bottom margin", "Left margin", "Right margin"]) {
    await setup.getByLabel(label).fill("1");
    await beat(page, 120);
  }
  await setup.getByLabel("Header from edge").fill("1");
  await beat(page, 200);
  await setup.getByLabel("Footer from edge").fill("1");
  await beat(page, 400);
  expect((await sheet(page)).headerText).toBe("");
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await showTop(page);
  const placed = await sheet(page);
  expect(placed.headerText).toBe("");
  near(placed.headerTop, 1);

  await caption(page, "She opens Page setup again and types the header.", 1400);
  setup = await openSetup(page);
  await showTop(page);
  const header = setup.getByLabel("Page header");
  await header.click();
  await typeSlowly(page, "Town council", 90);
  await expect.poll(async () => (await sheet(page)).headerText).toBe("Town council");
  await beat(page, 600);
  const appeared = await sheet(page);
  expect(appeared.headerAboveTitle).toBe(true);
  near(appeared.headerTop, 1);
  expect(appeared.titleOnPage).toBe(true);
  await expect(setup).toBeVisible();
  await wordsTogether(page);
  await caption(
    page,
    "Before Apply, Town council is on the page, an inch from the top, above the title.",
    2800,
  );

  await setup.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(setup).toBeHidden();
  await showTop(page);
  const cleared = await sheet(page);
  expect(cleared.headerText).toBe("");
  expect(cleared.footerText).toBe("");
  await caption(page, "Cancel clears it. The page header is empty again.", 2200);

  await caption(page, "She types Town council again, sees it, and applies.", 1400);
  setup = await openSetup(page);
  await showTop(page);
  await setup.getByLabel("Page header").click();
  await typeSlowly(page, "Town council", 80);
  await expect.poll(async () => (await sheet(page)).headerText).toBe("Town council");
  await beat(page, 700);
  expect((await sheet(page)).headerAboveTitle).toBe(true);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await showTop(page);
  expect((await sheet(page)).headerText).toBe("Town council");
  await caption(page, "Apply keeps the header she just saw.", 1800);
  await caption(page, "She closes the file, then opens it again.", 900);

  await expect(page.locator(".save-status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await beat(page, 600);
  await page.getByRole("link", { name: "Minutes" }).click();
  await expect(editor).toContainText("Minutes");
  await showTop(page);
  const reopened = await sheet(page);
  expect(reopened.headerText).toBe("Town council");
  expect(reopened.headerAboveTitle).toBe(true);
  near(reopened.headerTop, 1);
  await caption(page, "Saved and reopened. Town council is still above the title.", 2200);

  await caption(page, "She types a footer. Hearing notes shows before Apply.", 1400);
  setup = await openSetup(page);
  await showTop(page);
  const footer = setup.getByLabel("Page footer");
  await footer.click();
  await typeSlowly(page, "Hearing notes", 80);
  await expect.poll(async () => (await sheet(page)).footerText).toBe("Hearing notes");
  await beat(page, 600);
  const foot = await sheet(page);
  expect(foot.headerText).toBe("Town council");
  near(foot.footerFromBottom, 1);
  await expect(setup).toBeVisible();
  await caption(
    page,
    "Hearing notes is at the bottom of the page. She has not applied.",
    2400,
  );

  await setup.getByRole("radio", { name: "Landscape" }).click();
  await expect.poll(async () => (await sheet(page)).width).toBe(1056);
  await expect.poll(async () => (await sheet(page)).height).toBe(816);
  const wide = await sheet(page);
  expect(wide.visualWide).toBe(true);
  expect(wide.headerText).toBe("Town council");
  expect(wide.footerText).toBe("Hearing notes");
  await expect(setup.getByRole("radio", { name: "Landscape" })).toBeChecked();
  await wordsTogether(page);
  await beat(page, 400);
  await caption(
    page,
    "Before Apply, the page is wider than it is tall. The header, the footer, and Apply stay on screen together.",
    3200,
  );

  await setup.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(setup).toBeHidden();
  await showTop(page);
  const restored = await sheet(page);
  expect(restored.footerText).toBe("");
  expect(restored.headerText).toBe("Town council");
  expect(restored.width).toBe(816);
  expect(restored.height).toBe(1056);
  expect(restored.visualWide).toBe(false);
  await caption(
    page,
    "Cancel puts the old footer back. Town council stays.",
    2600,
  );
});
