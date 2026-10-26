import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { createFile, serializeFile, type DocFile } from "../../packages/core/src";

const inch = (n: number) => n * 96;

function minutes(): DocFile {
  const file = createFile("doc", "Minutes") as DocFile;
  file.content = {
    type: "doc",
    attrs: {
      pageSettings: {
        size: "letter",
        margin: inch(1),
        marginTop: inch(1),
        marginBottom: inch(1),
        marginLeft: inch(1),
        marginRight: inch(1),
        header: "Town council",
        footer: "Hearing notes",
        headerFromEdge: inch(0.75),
        footerFromEdge: inch(1),
        pageNumbers: false,
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
    ],
  };
  return file;
}

async function openMinutes(page: Page) {
  await page.goto("/");
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({
    name: "Minutes.sldoc",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(minutes())),
  });
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
    "Minutes",
  );
}

async function sheet(page: Page) {
  return page.evaluate(() => {
    const paper = document.querySelector(".paginated-paper") as HTMLElement;
    const content = document.querySelector(".document-content") as HTMLElement;
    const header = paper.querySelector(".page-header") as HTMLElement;
    const title = content.querySelector("h1") as HTMLElement;
    const furniture = header.closest(".page-furniture-page") as HTMLElement;
    const pageBox = furniture.getBoundingClientRect();
    const zoom = paper.getBoundingClientRect().width / paper.offsetWidth || 1;
    const style = getComputedStyle(content);
    return {
      width: parseFloat(paper.style.getPropertyValue("--page-width")),
      height: parseFloat(paper.style.getPropertyValue("--page-height")),
      headerText: header.textContent,
      headerTop: (header.getBoundingClientRect().top - pageBox.top) / zoom / 96,
      textTop: (title.getBoundingClientRect().top - pageBox.top) / zoom / 96,
      padTop: parseFloat(style.paddingTop) / 96,
      titleOnPage: title.getBoundingClientRect().bottom <= pageBox.bottom + 1,
    };
  });
}

async function near(page: Page, key: "headerTop" | "textTop" | "padTop", expected: number) {
  await expect
    .poll(async () => Math.abs((await sheet(page))[key] - expected) <= 0.12)
    .toBe(true);
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

async function savedPage(page: Page) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const file = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  return file.content.attrs.pageSettings;
}

test("paper size changes before apply, and cancel restores letter", async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openMinutes(page);
  const letter = await sheet(page);
  expect(letter.width).toBe(816);
  expect(letter.height).toBe(1056);
  expect(letter.headerText).toBe("Town council");
  await near(page, "textTop", 1);
  await near(page, "headerTop", 0.75);

  let dialog = await openSetup(page);
  await dialog.getByLabel("Paper size").selectOption("a4");
  await dialog.getByLabel("Page header").fill("Agenda");
  await expect.poll(async () => (await sheet(page)).width).toBe(794);
  await expect.poll(async () => (await sheet(page)).height).toBe(1123);
  const preview = await sheet(page);
  expect(preview.headerText).toBe("Agenda");
  expect(preview.titleOnPage).toBe(true);
  await expect(dialog.getByLabel("Paper size")).toHaveValue("a4");
  await expect(page.locator(".paper-size-live")).toHaveText("A4, 8.27 × 11.7 in");
  await expect(dialog).toBeVisible();

  const beside = await page.evaluate(() => {
    const paper = document.querySelector(".paginated-paper")!.getBoundingClientRect();
    const dialogBox = document
      .querySelector(".page-setup-dialog")!
      .getBoundingClientRect();
    const stage = document.querySelector(".document-stage")!.getBoundingClientRect();
    return {
      pageRight: paper.right,
      dialogLeft: dialogBox.left,
      pageTop: paper.top,
      pageBottom: paper.bottom,
      stageTop: stage.top,
      stageBottom: stage.bottom,
    };
  });
  expect(beside.pageRight).toBeLessThanOrEqual(beside.dialogLeft + 2);
  expect(beside.pageTop).toBeGreaterThanOrEqual(beside.stageTop - 1);
  expect(beside.pageBottom).toBeLessThanOrEqual(beside.stageBottom + 1);

  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await sheet(page)).width).toBe(816);
  await expect.poll(async () => (await sheet(page)).height).toBe(1056);
  const restored = await savedPage(page);
  expect(restored.size).not.toBe("a4");
  expect(restored.header).toBe("Town council");

  dialog = await openSetup(page);
  await dialog.getByLabel("Paper size").selectOption("a4");
  await expect.poll(async () => (await sheet(page)).width).toBe(794);
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await sheet(page)).width).toBe(794);
  await expect.poll(async () => (await sheet(page)).height).toBe(1123);
  const kept = await savedPage(page);
  expect(kept.size).toBe("a4");

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Minutes" }).click();
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
    "Minutes",
  );
  await expect.poll(async () => (await sheet(page)).width).toBe(794);
  await expect.poll(async () => (await sheet(page)).height).toBe(1123);

  dialog = await openSetup(page);
  for (const label of ["Top margin", "Bottom margin", "Left margin", "Right margin"])
    await dialog.getByLabel(label).fill("1.5");
  await near(page, "textTop", 1.5);
  await near(page, "padTop", 1.5);
  await near(page, "headerTop", 0.75);
  expect((await sheet(page)).width).toBe(794);

  await dialog.getByLabel("Header from edge").fill("0.5");
  await near(page, "headerTop", 0.5);
  await near(page, "textTop", 1.5);
  expect((await sheet(page)).headerText).toBe("Town council");

  const paperSize = dialog.getByLabel("Paper size");
  const margin = dialog.getByLabel("Top margin");
  const apply = dialog.getByRole("button", { name: "Apply", exact: true });
  await expect(paperSize).toBeInViewport();
  await expect(margin).toBeInViewport();
  await expect(apply).toBeInViewport();
  const clear = await page.evaluate(() => {
    const body = document.querySelector(".page-setup-dialog .dialog-body") as HTMLElement;
    const size = document.querySelector('[aria-label="Paper size"]') as HTMLElement;
    const top = document.querySelector('[aria-label="Top margin"]') as HTMLElement;
    const applyBtn = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Apply",
    ) as HTMLElement;
    const box = (el: HTMLElement) => el.getBoundingClientRect();
    const view = { top: 0, bottom: window.innerHeight };
    const inside = (el: HTMLElement) => {
      const r = box(el);
      return r.top >= view.top - 1 && r.bottom <= view.bottom + 1 && r.height > 0;
    };
    return (
      body.scrollHeight <= body.clientHeight + 1 &&
      inside(size) &&
      inside(top) &&
      inside(applyBtn)
    );
  });
  expect(clear).toBe(true);
});
