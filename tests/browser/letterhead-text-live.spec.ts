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
        header: "Club minutes",
        footer: "Draft",
        headerFromEdge: inch(1),
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
    const header = paper.querySelector(".page-header") as HTMLElement;
    const footer = paper.querySelector(".page-footer") as HTMLElement;
    const title = paper.querySelector("h1") as HTMLElement;
    const furniture = header.closest(".page-furniture-page") as HTMLElement;
    const pageBox = furniture.getBoundingClientRect();
    const paperBox = paper.getBoundingClientRect();
    const zoom = paperBox.width / paper.offsetWidth || 1;
    const headerBox = header.getBoundingClientRect();
    const titleBox = title.getBoundingClientRect();
    return {
      width: parseFloat(paper.style.getPropertyValue("--page-width")),
      height: parseFloat(paper.style.getPropertyValue("--page-height")),
      headerText: header.textContent,
      footerText: footer.querySelector(".page-footer-text")?.textContent ?? "",
      headerTop: (headerBox.top - pageBox.top) / zoom / 96,
      footerFromBottom: (pageBox.bottom - footer.getBoundingClientRect().bottom) / zoom / 96,
      headerAboveTitle: headerBox.bottom <= titleBox.top + 2,
    };
  });
}

async function near(page: Page, key: "headerTop" | "footerFromBottom", expected: number) {
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

test("header and footer words show before apply, and cancel restores them", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openMinutes(page);
  expect((await sheet(page)).headerText).toBe("Club minutes");
  await near(page, "headerTop", 1);

  const dialog = await openSetup(page);
  const headerField = dialog.getByLabel("Page header");
  const footerField = dialog.getByLabel("Page footer");
  const apply = dialog.getByRole("button", { name: "Apply", exact: true });
  await expect(headerField).toBeInViewport();
  await expect(footerField).toBeInViewport();
  await expect(apply).toBeInViewport();

  await headerField.fill("Town council");
  await expect.poll(async () => (await sheet(page)).headerText).toBe("Town council");
  await near(page, "headerTop", 1);
  const preview = await sheet(page);
  expect(preview.headerAboveTitle).toBe(true);
  expect(preview.footerText).toBe("Draft");
  await expect(dialog).toBeVisible();

  await footerField.fill("Hearing notes");
  await expect.poll(async () => (await sheet(page)).footerText).toBe("Hearing notes");
  await near(page, "footerFromBottom", 1);
  expect((await sheet(page)).headerAboveTitle).toBe(true);

  await dialog.getByRole("radio", { name: "Landscape" }).check();
  await expect.poll(async () => (await sheet(page)).width).toBe(1056);
  await expect.poll(async () => (await sheet(page)).height).toBe(816);
  const wide = await sheet(page);
  expect(wide.width).toBeGreaterThan(wide.height);
  expect(wide.headerText).toBe("Town council");
  expect(wide.footerText).toBe("Hearing notes");
  await expect(dialog).toBeVisible();
  await expect(headerField).toBeInViewport();
  await expect(footerField).toBeInViewport();
  await expect(apply).toBeInViewport();
  const together = await page.evaluate(() => {
    const body = document.querySelector(".page-setup-dialog .dialog-body") as HTMLElement;
    const header = document.querySelector('[aria-label="Page header"]') as HTMLElement;
    const footer = document.querySelector('[aria-label="Page footer"]') as HTMLElement;
    const applyBtn = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Apply",
    ) as HTMLElement;
    const box = (el: HTMLElement) => el.getBoundingClientRect();
    const onScreen = (el: HTMLElement) => {
      const r = box(el);
      return r.top >= -1 && r.bottom <= window.innerHeight + 1 && r.height > 8;
    };
    const bodyBox = box(body);
    const inBody = (el: HTMLElement) => {
      const r = box(el);
      return r.top >= bodyBox.top - 1 && r.bottom <= bodyBox.bottom + 1;
    };
    return onScreen(header) && onScreen(footer) && onScreen(applyBtn) && inBody(header) && inBody(footer);
  });
  expect(together).toBe(true);

  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await sheet(page)).headerText).toBe("Club minutes");
  await expect.poll(async () => (await sheet(page)).footerText).toBe("Draft");
  await expect.poll(async () => (await sheet(page)).width).toBe(816);
  const restored = await savedPage(page);
  expect(restored.header).toBe("Club minutes");
  expect(restored.footer).toBe("Draft");
  expect(restored.landscape).not.toBe(true);

  const again = await openSetup(page);
  await again.getByLabel("Page header").fill("Town council");
  await expect.poll(async () => (await sheet(page)).headerText).toBe("Town council");
  await again.getByLabel("Page footer").fill("Hearing notes");
  await expect.poll(async () => (await sheet(page)).footerText).toBe("Hearing notes");
  await again.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(again).toBeHidden();
  await expect.poll(async () => (await sheet(page)).headerText).toBe("Town council");
  const kept = await savedPage(page);
  expect(kept.header).toBe("Town council");
  expect(kept.footer).toBe("Hearing notes");

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Minutes" }).click();
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
    "Minutes",
  );
  await expect.poll(async () => (await sheet(page)).headerText).toBe("Town council");
  expect((await sheet(page)).footerText).toBe("Hearing notes");
});
