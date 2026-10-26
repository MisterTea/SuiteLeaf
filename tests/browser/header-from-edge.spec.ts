import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createFile, serializeFile, type DocFile } from "../../packages/core/src";

function thesis(): DocFile {
  const file = createFile("doc", "Thesis notes") as DocFile;
  file.content = {
    type: "doc",
    attrs: {
      pageSettings: {
        margin: 96,
        marginTop: 96,
        marginBottom: 96,
        marginLeft: 96,
        marginRight: 96,
        header: "Town council",
        footer: "Hearing notes",
        headerFromEdge: 96,
        footerFromEdge: 96,
        pageNumbers: false,
      },
    },
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "The council notes start an inch in from the edge of the page.",
          },
        ],
      },
    ],
  };
  return file;
}

async function openThesis(page: Page) {
  await page.goto("/");
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({
    name: "thesis-notes.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(thesis())),
  });
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
    "council notes",
  );
  await expect(page.locator(".page-header").first()).toHaveText("Town council");
}

async function places(page: Page) {
  return page.evaluate(() => {
    const paper = document.querySelector(".paginated-paper") as HTMLElement;
    const content = document.querySelector(".document-content") as HTMLElement;
    const header = paper.querySelector(".page-header") as HTMLElement;
    const footer = paper.querySelector(".page-footer") as HTMLElement;
    const sheet = footer.closest(".page-furniture-page") as HTMLElement;
    const first = content.querySelector("p") as HTMLElement;
    const pageBox = sheet.getBoundingClientRect();
    const zoom = paper.getBoundingClientRect().width / paper.offsetWidth || 1;
    const fromTop = (el: HTMLElement) =>
      (el.getBoundingClientRect().top - pageBox.top) / zoom / 96;
    const fromBottom = (el: HTMLElement) =>
      (pageBox.bottom - el.getBoundingClientRect().bottom) / zoom / 96;
    const style = getComputedStyle(content);
    return {
      headerTop: fromTop(header),
      textTop: fromTop(first),
      footerBottom: fromBottom(footer),
      padTop: parseFloat(style.paddingTop) / 96,
      padBottom: parseFloat(style.paddingBottom) / 96,
    };
  });
}

function near(actual: number, expected: number) {
  expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(0.1);
}

async function setField(page: Page, label: string, value: string) {
  const field = page.getByRole("dialog", { name: "Page setup" }).getByLabel(label);
  await field.fill(value);
  return field;
}

test("header and footer distances stay separate from the margin", async ({ page }) => {
  await openThesis(page);
  const start = await places(page);
  near(start.headerTop, 1);
  expect(start.textTop).toBeGreaterThan(start.headerTop + 0.12);
  expect(start.padTop).toBeGreaterThan(1.1);
  near(start.footerBottom, 1);
  expect(start.padBottom).toBeGreaterThan(1.1);

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Page setup" });
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");
  await expect(setup.getByLabel("Header from edge")).toHaveValue("1");
  await expect(setup.getByLabel("Footer from edge")).toHaveValue("1");
  await setField(page, "Header from edge", "0.5");
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");
  await expect(setup.getByLabel("Bottom margin")).toHaveValue("1");
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();

  await expect.poll(async () => (await places(page)).headerTop).toBeLessThan(0.7);
  const half = await places(page);
  near(half.headerTop, 0.5);
  near(half.textTop, 1);
  near(half.padTop, 1);
  expect(half.padBottom).toBeGreaterThan(1.1);

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expect(setup.getByLabel("Header from edge")).toHaveValue("0.5");
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");
  await setField(page, "Header from edge", "1.5");
  await expect(setup.getByText(/header is inside the text area/)).toBeVisible();
  await expect(setup.getByText(/top margin does not change/)).toBeVisible();
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await expect.poll(async () => (await places(page)).textTop).toBeGreaterThan(1.5);
  const into = await places(page);
  near(into.headerTop, 1.5);
  expect(into.textTop).toBeGreaterThan(into.headerTop);
  expect(into.padTop).toBeGreaterThan(1.5);
  expect(into.padBottom).toBeGreaterThan(1.1);

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");
  await setField(page, "Header from edge", "0");
  await expect(setup.getByRole("alert")).toHaveText(
    "The header must be at least 0.25 inches from the edge.",
  );
  const apply = setup.getByRole("button", { name: "Apply", exact: true });
  await expect(apply).toBeDisabled();
  await page.keyboard.press("Enter");
  await expect(setup).toBeVisible();
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");

  await setField(page, "Header from edge", "0.5");
  await setField(page, "Footer from edge", "0");
  await expect(setup.getByRole("alert")).toHaveText(
    "The footer must be at least 0.25 inches from the edge.",
  );
  await expect(apply).toBeDisabled();
  await setField(page, "Footer from edge", "0.5");
  await expect(apply).toBeEnabled();
  await expect(setup.getByLabel("Bottom margin")).toHaveValue("1");
  await apply.click();
  await expect(setup).toBeHidden();
  await expect.poll(async () => (await places(page)).footerBottom).toBeLessThan(0.7);
  const footerClear = await places(page);
  near(footerClear.footerBottom, 0.5);
  near(footerClear.headerTop, 0.5);
  near(footerClear.padBottom, 1);
  near(footerClear.textTop, 1);

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await setField(page, "Footer from edge", "1.5");
  await expect(setup.getByText(/footer is inside the text area/)).toBeVisible();
  await expect(setup.getByText(/bottom margin does not change/)).toBeVisible();
  await expect(setup.getByLabel("Bottom margin")).toHaveValue("1");
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect.poll(async () => (await places(page)).padBottom).toBeGreaterThan(1.5);
  const footerInto = await places(page);
  near(footerInto.footerBottom, 1.5);
  expect(footerInto.padBottom).toBeGreaterThan(1.5);
  near(footerInto.padTop, 1);

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await setField(page, "Footer from edge", "0.5");
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const saved = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  expect(saved.content.attrs.pageSettings).toMatchObject({
    marginTop: 96,
    marginBottom: 96,
    headerFromEdge: 48,
    footerFromEdge: 48,
    header: "Town council",
  });

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Thesis notes" }).click();
  await expect(page.locator(".page-header").first()).toHaveText("Town council");
  const reopened = await places(page);
  near(reopened.headerTop, 0.5);
  near(reopened.textTop, 1);
  near(reopened.footerBottom, 0.5);
  near(reopened.padBottom, 1);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expect(setup.getByLabel("Header from edge")).toHaveValue("0.5");
  await expect(setup.getByLabel("Footer from edge")).toHaveValue("0.5");
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");
  await expect(setup.getByLabel("Bottom margin")).toHaveValue("1");
});
