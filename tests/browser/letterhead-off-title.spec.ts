import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
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
        headerFromEdge: inch(1),
        footerFromEdge: inch(1),
        pageNumbers: false,
      },
    },
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Minutes" }] },
      ...Array.from({ length: 40 }, (_, index) =>
        paragraph(`The hearing note ${index + 1} stays clear of the letterhead.`),
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
  await expect(page.locator(".page-header").first()).toHaveText("Town council");
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
    const fromBottom = (el: HTMLElement) =>
      (pageBox.bottom - el.getBoundingClientRect().bottom) / zoom / 96;
    const style = getComputedStyle(content);
    const footerTop = footer.getBoundingClientRect().top;
    const above = [...content.querySelectorAll("h1, p")].filter((el) => {
      const box = el.getBoundingClientRect();
      return box.height > 0 && box.top >= pageBox.top && box.bottom <= footerTop + 1;
    });
    const last = above.at(-1);
    const gap = last
      ? (footerTop - last.getBoundingClientRect().bottom) / zoom / 96
      : null;
    return {
      headerTop: fromTop(header),
      headerBottom: (header.getBoundingClientRect().bottom - pageBox.top) / zoom / 96,
      textTop: fromTop(title),
      footerBottom: fromBottom(footer),
      padTop: parseFloat(style.paddingTop) / 96,
      padBottom: parseFloat(style.paddingBottom) / 96,
      gap,
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

test("a one-line letterhead at the margin sits off the title", async ({ page }) => {
  await openMinutes(page);
  const even = await places(page);
  near(even.headerTop, 1);
  expect(even.textTop).toBeGreaterThan(even.headerBottom);
  expect(even.padTop).toBeGreaterThan(1.1);
  near(even.footerBottom, 1);
  expect(even.padBottom).toBeGreaterThan(1.1);
  expect(even.gap).not.toBeNull();
  expect(even.gap!).toBeGreaterThan(0.05);

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Page setup" });
  await expect(setup.getByLabel("Header from edge")).toHaveValue("1");
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");
  await expect(setup.getByLabel("Footer from edge")).toHaveValue("1");
  await expect(setup.getByLabel("Bottom margin")).toHaveValue("1");
  await expect(setup.getByText(/header reaches the text/)).toBeVisible();
  await expect(setup.getByText(/top margin does not change/)).toBeVisible();
  await expect(setup.getByText(/footer reaches the text/)).toBeVisible();
  await expect(setup.getByText(/bottom margin does not change/)).toBeVisible();

  await setField(page, "Header from edge", "0.5");
  await expect(setup.getByText(/header reaches the text/)).toHaveCount(0);
  await expect(setup.getByText(/inside the text area/)).toHaveCount(0);
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await expect.poll(async () => (await places(page)).headerTop).toBeLessThan(0.7);
  const half = await places(page);
  near(half.headerTop, 0.5);
  near(half.textTop, 1);
  near(half.padTop, 1);
  expect(half.padBottom).toBeGreaterThan(1.1);

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await setField(page, "Header from edge", "1.5");
  await expect(setup.getByText(/header is inside the text area/)).toBeVisible();
  await expect(setup.getByText(/moves down/)).toBeVisible();
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  const into = await places(page);
  near(into.headerTop, 1.5);
  expect(into.textTop).toBeGreaterThan(into.headerBottom);
  expect(into.padTop).toBeGreaterThan(1.5);
  near(into.footerBottom, 1);

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await setField(page, "Header from edge", "1");
  await setField(page, "Footer from edge", "0.5");
  await expect(setup.getByText(/footer reaches the text/)).toHaveCount(0);
  await expect(setup.getByLabel("Bottom margin")).toHaveValue("1");
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  const footerHalf = await places(page);
  near(footerHalf.footerBottom, 0.5);
  near(footerHalf.padBottom, 1);
  near(footerHalf.headerTop, 1);
  expect(footerHalf.textTop).toBeGreaterThan(footerHalf.headerBottom);

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await setField(page, "Footer from edge", "1.5");
  await expect(setup.getByText(/footer is inside the text area/)).toBeVisible();
  await expect(setup.getByText(/moves up/)).toBeVisible();
  await expect(setup.getByLabel("Bottom margin")).toHaveValue("1");
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await expect.poll(async () => (await places(page)).gap ?? 0).toBeGreaterThan(0.05);
  const footerInto = await places(page);
  near(footerInto.footerBottom, 1.5);
  expect(footerInto.padBottom).toBeGreaterThan(1.5);

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await setField(page, "Header from edge", "1");
  await setField(page, "Footer from edge", "1");
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");
  await expect(setup.getByLabel("Bottom margin")).toHaveValue("1");
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const saved = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  expect(saved.content.attrs.pageSettings).toMatchObject({
    marginTop: inch(1),
    marginBottom: inch(1),
    headerFromEdge: inch(1),
    footerFromEdge: inch(1),
    header: "Town council",
    footer: "Hearing notes",
  });

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Minutes" }).click();
  await expect(page.locator(".page-header").first()).toHaveText("Town council");
  const again = await places(page);
  near(again.headerTop, 1);
  expect(again.textTop).toBeGreaterThan(again.headerBottom);
  expect(again.padTop).toBeGreaterThan(1.1);
  near(again.footerBottom, 1);
  expect(again.padBottom).toBeGreaterThan(1.1);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expect(setup.getByLabel("Header from edge")).toHaveValue("1");
  await expect(setup.getByLabel("Footer from edge")).toHaveValue("1");
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");
  await expect(setup.getByLabel("Bottom margin")).toHaveValue("1");
});
