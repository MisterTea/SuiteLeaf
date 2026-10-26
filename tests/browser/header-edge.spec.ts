import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createFile, serializeFile } from "../../packages/core/src";

const inch = (n: number) => n * 96;

function thesis() {
  const file = createFile("doc", "Thesis notes");
  if (file.kind !== "doc") throw new Error("expected a document");
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
        headerFromEdge: inch(1),
        footerFromEdge: inch(1),
        pageNumbers: false,
      },
    },
    content: [
      paragraph("The hearing notes stay an inch from the edge of the page."),
      paragraph("Binding comments belong in the margin, not on the text."),
    ],
  };
  return file;
}

async function placement(page: Page) {
  return page.evaluate(() => {
    const pageEl = document.querySelector(".page-furniture-page") as HTMLElement;
    const header = document.querySelector(".page-header") as HTMLElement;
    const footer = document.querySelector(".page-footer") as HTMLElement;
    const body = document.querySelector(".document-content p") as HTMLElement;
    const content = document.querySelector(".document-content") as HTMLElement;
    const pageBox = pageEl.getBoundingClientRect();
    const zoom = pageBox.height / pageEl.offsetHeight || 1;
    const style = getComputedStyle(content);
    return {
      header: (header.getBoundingClientRect().top - pageBox.top) / zoom,
      body: (body.getBoundingClientRect().top - pageBox.top) / zoom,
      footer: (pageBox.bottom - footer.getBoundingClientRect().bottom) / zoom,
      paddingTop: Number.parseFloat(style.paddingTop),
      paddingBottom: Number.parseFloat(style.paddingBottom),
    };
  });
}

async function openSetup(page: Page) {
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Page setup" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function setInches(page: Page, label: string, value: string) {
  const field = page.getByLabel(label);
  await field.scrollIntoViewIfNeeded();
  await field.fill(value);
}

test("header and footer distances stay separate from the page margin", async ({
  page,
}) => {
  test.setTimeout(90000);
  const file = thesis();
  await page.goto("/");
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({
    name: "Thesis notes.sldoc",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
    "hearing notes",
  );

  const same = await placement(page);
  expect(Math.abs(same.header - inch(1))).toBeLessThan(6);
  expect(same.body).toBeGreaterThan(same.header + 12);
  expect(same.paddingTop).toBeGreaterThan(inch(1) + 12);

  let dialog = await openSetup(page);
  await expect(dialog.getByLabel("Header from edge")).toHaveValue("1");
  await expect(dialog.getByLabel("Footer from edge")).toHaveValue("1");
  await expect(dialog.getByLabel("Top margin")).toHaveValue("1");
  await setInches(page, "Header from edge", "0.5");
  await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(dialog).toBeHidden();

  const half = await placement(page);
  expect(Math.abs(half.header - inch(0.5))).toBeLessThan(6);
  expect(Math.abs(half.body - inch(1))).toBeLessThan(6);
  expect(Math.abs(half.paddingTop - inch(1))).toBeLessThan(2);

  dialog = await openSetup(page);
  await setInches(page, "Header from edge", "1.5");
  await expect(dialog).toContainText("inside the text area");
  await expect(dialog).toContainText("moves down");
  await expect(dialog.getByLabel("Top margin")).toHaveValue("1");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  const pushed = await placement(page);
  expect(pushed.header).toBeGreaterThan(inch(1.4));
  expect(pushed.body).toBeGreaterThan(pushed.header + 12);
  expect(pushed.paddingTop).toBeGreaterThan(inch(1.5));

  dialog = await openSetup(page);
  await setInches(page, "Header from edge", "0");
  await expect(dialog).toContainText("at least 0.25 inches");
  await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  dialog = await openSetup(page);
  await expect(dialog.getByLabel("Header from edge")).toHaveValue("1.5");
  await expect(dialog.getByLabel("Top margin")).toHaveValue("1");
  await setInches(page, "Header from edge", "0.5");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();

  const footerBefore = await placement(page);
  dialog = await openSetup(page);
  await setInches(page, "Footer from edge", "0.5");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  const footerHalf = await placement(page);
  expect(Math.abs(footerHalf.footer - inch(0.5))).toBeLessThan(6);
  expect(Math.abs(footerHalf.paddingBottom - inch(1))).toBeLessThan(2);
  expect(Math.abs(footerHalf.body - footerBefore.body)).toBeLessThan(6);

  dialog = await openSetup(page);
  await setInches(page, "Footer from edge", "1.5");
  await expect(dialog).toContainText("moves up");
  await expect(dialog.getByLabel("Bottom margin")).toHaveValue("1");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  const footerPushed = await placement(page);
  expect(footerPushed.paddingBottom).toBeGreaterThan(inch(1.5));
  expect(Math.abs(footerPushed.footer - inch(1.5))).toBeLessThan(6);

  dialog = await openSetup(page);
  await setInches(page, "Footer from edge", "0");
  await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toBeDisabled();
  await setInches(page, "Footer from edge", "0.5");
  await expect(dialog.getByLabel("Top margin")).toHaveValue("1");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();

  await expect(page.getByRole("status")).toContainText("Saved");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const saved = JSON.parse(
    await readFile((await (await downloading).path())!, "utf8"),
  );
  expect(saved.content.attrs.pageSettings.headerFromEdge).toBe(inch(0.5));
  expect(saved.content.attrs.pageSettings.footerFromEdge).toBe(inch(0.5));
  expect(saved.content.attrs.pageSettings.marginTop).toBe(inch(1));
  expect(saved.content.attrs.pageSettings.marginBottom).toBe(inch(1));

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Thesis notes" }).click();
  await expect(page.locator(".page-header").first()).toHaveText("Town council");
  const again = await placement(page);
  expect(Math.abs(again.header - inch(0.5))).toBeLessThan(6);
  expect(Math.abs(again.footer - inch(0.5))).toBeLessThan(6);
  expect(Math.abs(again.paddingTop - inch(1))).toBeLessThan(2);
  dialog = await openSetup(page);
  await expect(dialog.getByLabel("Header from edge")).toHaveValue("0.5");
  await expect(dialog.getByLabel("Footer from edge")).toHaveValue("0.5");
  await expect(dialog.getByLabel("Top margin")).toHaveValue("1");
});
