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
        landscape: false,
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
  await page.locator("input[type=file]").setInputFiles({
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
    const paperBox = paper.getBoundingClientRect();
    const zoom = paperBox.width / paper.offsetWidth || 1;
    const style = getComputedStyle(content);
    const stage = document.querySelector(".document-stage")!.getBoundingClientRect();
    const dialog = document.querySelector(".page-setup-dialog")?.getBoundingClientRect();
    return {
      width: parseFloat(paper.style.getPropertyValue("--page-width")),
      height: parseFloat(paper.style.getPropertyValue("--page-height")),
      visualWide: paperBox.width > paperBox.height,
      headerText: header.textContent,
      headerTop: (header.getBoundingClientRect().top - pageBox.top) / zoom / 96,
      textTop: (title.getBoundingClientRect().top - pageBox.top) / zoom / 96,
      padTop: parseFloat(style.paddingTop) / 96,
      titleOnPage: title.getBoundingClientRect().bottom <= pageBox.bottom + 1,
      pageInsideStage:
        paperBox.top >= stage.top - 1 &&
        paperBox.bottom <= stage.bottom + 1 &&
        paperBox.left >= stage.left - 1,
      pageBesideDialog: dialog ? paperBox.right <= dialog.left + 2 : true,
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

test("landscape turns before apply, and cancel restores portrait", async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openMinutes(page);
  const portrait = await sheet(page);
  expect(portrait.width).toBe(816);
  expect(portrait.height).toBe(1056);
  expect(portrait.headerText).toBe("Town council");
  await near(page, "textTop", 1);

  let dialog = await openSetup(page);
  await expect(page.locator(".paper-size-live")).toHaveText("Letter, 8.5 × 11 in");
  await dialog.getByRole("radio", { name: "Landscape" }).check();
  await dialog.getByLabel("Page header").fill("Agenda");
  await expect.poll(async () => (await sheet(page)).width).toBe(1056);
  await expect.poll(async () => (await sheet(page)).height).toBe(816);
  const turned = await sheet(page);
  expect(turned.visualWide).toBe(true);
  expect(turned.headerText).toBe("Town council");
  expect(turned.titleOnPage).toBe(true);
  expect(turned.pageInsideStage).toBe(true);
  expect(turned.pageBesideDialog).toBe(true);
  await expect(dialog.getByRole("radio", { name: "Landscape" })).toBeChecked();
  await expect(page.locator(".paper-size-live")).toHaveText("Letter, 11 × 8.5 in");
  await expect(dialog).toBeVisible();

  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await sheet(page)).width).toBe(816);
  await expect.poll(async () => (await sheet(page)).height).toBe(1056);
  const restored = await savedPage(page);
  expect(restored.landscape).not.toBe(true);
  expect(restored.header).toBe("Town council");

  dialog = await openSetup(page);
  await dialog.getByRole("radio", { name: "Landscape" }).check();
  await expect.poll(async () => (await sheet(page)).width).toBe(1056);
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await sheet(page)).width).toBe(1056);
  await expect.poll(async () => (await sheet(page)).height).toBe(816);
  const kept = await savedPage(page);
  expect(kept.landscape).toBe(true);
  expect(kept.size).toBe("letter");

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Minutes" }).click();
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
    "Minutes",
  );
  await expect.poll(async () => (await sheet(page)).width).toBe(1056);
  await expect.poll(async () => (await sheet(page)).height).toBe(816);

  dialog = await openSetup(page);
  await dialog.getByLabel("Paper size").selectOption("a4");
  await expect.poll(async () => (await sheet(page)).width).toBe(1123);
  await expect.poll(async () => (await sheet(page)).height).toBe(794);
  const a4 = await sheet(page);
  expect(a4.visualWide).toBe(true);
  expect(a4.headerText).toBe("Town council");
  expect(a4.pageInsideStage).toBe(true);
  expect(a4.pageBesideDialog).toBe(true);
  await expect(dialog.getByRole("radio", { name: "Landscape" })).toBeChecked();
  await expect(page.locator(".paper-size-live")).toHaveText("A4, 11.7 × 8.27 in");

  for (const label of ["Top margin", "Bottom margin", "Left margin", "Right margin"])
    await dialog.getByLabel(label).fill("1.5");
  await near(page, "textTop", 1.5);
  await near(page, "padTop", 1.5);
  await near(page, "headerTop", 0.75);
  const moved = await sheet(page);
  expect(moved.width).toBe(1123);
  expect(moved.height).toBe(794);

  const paperSize = dialog.getByLabel("Paper size");
  const landscape = dialog.getByRole("radio", { name: "Landscape" });
  const margin = dialog.getByLabel("Top margin");
  const apply = dialog.getByRole("button", { name: "Apply", exact: true });
  await expect(paperSize).toBeInViewport();
  await expect(landscape).toBeInViewport();
  await expect(margin).toBeInViewport();
  await expect(apply).toBeInViewport();
  const clear = await page.evaluate(() => {
    const body = document.querySelector(".page-setup-dialog .dialog-body") as HTMLElement;
    const size = document.querySelector('[aria-label="Paper size"]') as HTMLElement;
    const landscapeInput = [
      ...document.querySelectorAll<HTMLInputElement>('input[name="page-orientation"]'),
    ].find((input) => input.closest("label")?.textContent?.includes("Landscape"));
    const top = document.querySelector('[aria-label="Top margin"]') as HTMLElement;
    const applyBtn = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Apply",
    ) as HTMLElement;
    const inside = (el: HTMLElement | undefined) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.top >= -1 && r.bottom <= window.innerHeight + 1 && r.height > 0;
    };
    return (
      body.scrollHeight <= body.clientHeight + 1 &&
      inside(size) &&
      inside(landscapeInput) &&
      inside(top) &&
      inside(applyBtn)
    );
  });
  expect(clear).toBe(true);
});
