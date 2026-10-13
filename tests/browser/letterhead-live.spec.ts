import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { createFile, serializeFile, type DocFile } from "../../packages/core/src";

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
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Minutes" }] },
      ...Array.from({ length: 34 }, (_, index) =>
        paragraph(`Hearing note ${index + 1} stays clear of the footer.`),
      ),
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

async function places(page: Page) {
  return page.evaluate(() => {
    const paper = document.querySelector(".paginated-paper") as HTMLElement;
    const content = document.querySelector(".document-content") as HTMLElement;
    const header = paper.querySelector(".page-header") as HTMLElement;
    const footer = paper.querySelector(".page-footer") as HTMLElement;
    const sheet = header.closest(".page-furniture-page") as HTMLElement;
    const title = content.querySelector("h1") as HTMLElement;
    const pageBox = sheet.getBoundingClientRect();
    const zoom = paper.getBoundingClientRect().width / paper.offsetWidth || 1;
    const fromTop = (el: HTMLElement) =>
      (el.getBoundingClientRect().top - pageBox.top) / zoom / 96;
    const style = getComputedStyle(content);
    const footerTop = footer.getBoundingClientRect().top;
    const above = [...content.querySelectorAll("h1, p")].filter((el) => {
      const box = el.getBoundingClientRect();
      return box.height > 0 && box.top >= pageBox.top - 1 && box.bottom <= footerTop + 1;
    });
    const last = above.at(-1);
    const gap = last
      ? (footerTop - last.getBoundingClientRect().bottom) / zoom / 96
      : null;
    return {
      headerTop: fromTop(header),
      textTop: fromTop(title),
      footerBottom: (pageBox.bottom - footer.getBoundingClientRect().bottom) / zoom / 96,
      padTop: parseFloat(style.paddingTop) / 96,
      padBottom: parseFloat(style.paddingBottom) / 96,
      gap,
    };
  });
}

async function near(page: Page, key: "headerTop" | "textTop" | "footerBottom" | "padTop", expected: number) {
  await expect.poll(async () => {
    const spot = await places(page);
    return Math.abs(spot[key] - expected) <= 0.12;
  }, { timeout: 8000 }).toBe(true);
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

test("the letterhead moves before apply, and cancel puts it back", async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openMinutes(page);
  await near(page, "footerBottom", 1);
  await near(page, "headerTop", 0.75);
  await near(page, "textTop", 1);

  let dialog = await openSetup(page);
  const before = await places(page);
  await dialog.getByLabel("Bottom margin").fill("2");
  await expect(dialog.getByLabel("Bottom margin")).toHaveValue("2");
  await expect.poll(async () => Math.abs((await places(page)).footerBottom - before.footerBottom) <= 0.12).toBe(true);
  await expect.poll(async () => Math.abs((await places(page)).padBottom - 2) <= 0.12).toBe(true);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  await near(page, "footerBottom", 1);
  await expect
    .poll(async () => Math.abs((await places(page)).padBottom - before.padBottom) <= 0.12)
    .toBe(true);

  dialog = await openSetup(page);
  await dialog.getByLabel("Footer from edge").fill("1.5");
  await near(page, "footerBottom", 1.5);
  const moved = await places(page);
  expect(moved.padBottom).toBeGreaterThan(1.5);
  expect(moved.gap).not.toBeNull();
  expect(moved.gap!).toBeGreaterThan(0.05);
  await expect(dialog.getByLabel("Bottom margin")).toHaveValue("1");
  const note = dialog.getByText(
    "The footer is inside the text area, so the text moves up above it. The bottom margin does not change.",
  );
  await expect(note).toBeVisible();
  await expect(dialog.getByLabel("Footer from edge")).toBeInViewport();
  await expect(dialog.getByLabel("Bottom margin")).toBeInViewport();
  await expect(note).toBeInViewport();
  await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toBeInViewport();
  const clear = await page.evaluate(() => {
    const bottom = document.querySelector('[aria-label="Bottom margin"]') as HTMLElement;
    const noteEl = [...document.querySelectorAll("p")].find((item) =>
      item.textContent?.includes("The footer is inside the text area"),
    ) as HTMLElement;
    const box = (el: HTMLElement) => el.getBoundingClientRect();
    const a = box(bottom);
    const n = box(noteEl);
    const overlaps =
      a.top < n.bottom - 1 &&
      a.bottom > n.top + 1 &&
      a.left < n.right - 1 &&
      a.right > n.left + 1;
    const hit = document.elementFromPoint(a.left + a.width / 2, a.top + a.height / 2);
    const body = document.querySelector(".page-setup-dialog .dialog-body") as HTMLElement;
    return {
      overlaps,
      hitsBottom: hit === bottom || bottom.contains(hit),
      scrolls: body.scrollHeight > body.clientHeight + 1,
    };
  });
  expect(clear.overlaps).toBe(false);
  expect(clear.hitsBottom).toBe(true);
  expect(clear.scrolls).toBe(false);

  const unsaved = await savedPage(page);
  expect(unsaved.footerFromEdge).toBe(inch(1));
  expect(unsaved.marginBottom).toBe(inch(1));

  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  await near(page, "footerBottom", 1);
  await near(page, "headerTop", 0.75);
  const restored = await savedPage(page);
  expect(restored.footerFromEdge).toBe(inch(1));

  dialog = await openSetup(page);
  await dialog.getByLabel("Footer from edge").fill("1.5");
  await near(page, "footerBottom", 1.5);
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(dialog).toBeHidden();
  await near(page, "footerBottom", 1.5);
  const kept = await savedPage(page);
  expect(kept.footerFromEdge).toBe(inch(1.5));
  expect(kept.marginBottom).toBe(inch(1));
  expect(kept.headerFromEdge).toBe(inch(0.75));

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Minutes" }).click();
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText("Minutes");
  await near(page, "footerBottom", 1.5);
  await near(page, "textTop", 1);

  dialog = await openSetup(page);
  await dialog.getByLabel("Header from edge").fill("0.5");
  await near(page, "headerTop", 0.5);
  await near(page, "textTop", 1);
  await near(page, "padTop", 1);
  await near(page, "footerBottom", 1.5);
  await expect(dialog.getByLabel("Top margin")).toHaveValue("1");
  await expect(dialog.getByText(/header is inside the text area/)).toHaveCount(0);
  const headerSaved = await savedPage(page);
  expect(headerSaved.headerFromEdge).toBe(inch(0.75));
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  await near(page, "headerTop", 0.75);
  await near(page, "textTop", 1);
});
