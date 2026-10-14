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
        header: "Draft minutes",
        footer: "",
        headerFromEdge: inch(0.5),
        footerFromEdge: inch(0.5),
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
      { type: "pageBreak" },
      {
        type: "paragraph",
        content: [{ type: "text", text: "The vote is next week." }],
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
    "The vote is next week.",
  );
  await expect(page.locator(".editor-status")).toContainText("2 pages");
}

async function numbers(page: Page) {
  return page.locator(".paginated-paper .page-number").allTextContents();
}

async function headerText(page: Page) {
  return page.locator(".paginated-paper .page-header").first().textContent();
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
        r.top >= -1 &&
        r.bottom <= window.innerHeight + 1
      );
    };
    return (
      window.innerHeight === 800 &&
      inside(switchEl, dialogBox) &&
      inside(headerEl, bodyBox) &&
      inside(applyEl, dialogBox)
    );
  });
  expect(clear).toBe(true);
}

test("page numbers show before apply, and cancel puts them back", async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openMinutes(page);
  expect(await numbers(page)).toEqual([]);
  expect(await headerText(page)).toBe("Draft minutes");

  const dialog = await openSetup(page);
  await controlsTogether(page);
  expect(await numbers(page)).toEqual([]);

  await dialog.getByRole("checkbox", { name: "Page numbers" }).check();
  await expect.poll(() => numbers(page)).toEqual(["1 / 2", "2 / 2"]);
  const badge = await page.locator(".paginated-paper .page-number").first().boundingBox();
  expect(badge).toBeTruthy();
  expect(badge!.height).toBeGreaterThan(11);
  expect(await headerText(page)).toBe("Draft minutes");
  await expect(dialog).toBeVisible();
  const unsaved = await savedPage(page);
  expect(unsaved.pageNumbers).toBe(false);
  expect(unsaved.header).toBe("Draft minutes");

  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => numbers(page)).toEqual([]);
  expect(await headerText(page)).toBe("Draft minutes");
  const restored = await savedPage(page);
  expect(restored.pageNumbers).toBe(false);

  const again = await openSetup(page);
  await again.getByRole("checkbox", { name: "Page numbers" }).check();
  await expect.poll(() => numbers(page)).toEqual(["1 / 2", "2 / 2"]);
  await again.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(again).toBeHidden();
  await expect.poll(() => numbers(page)).toEqual(["1 / 2", "2 / 2"]);
  const kept = await savedPage(page);
  expect(kept.pageNumbers).toBe(true);
  expect(kept.header).toBe("Draft minutes");

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Minutes" }).click();
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
    "The vote is next week.",
  );
  await expect.poll(() => numbers(page)).toEqual(["1 / 2", "2 / 2"]);

  const typing = await openSetup(page);
  await controlsTogether(page);
  await typing.getByLabel("Page header").fill("Town council");
  await expect.poll(() => headerText(page)).toBe("Town council");
  await expect.poll(() => numbers(page)).toEqual(["1 / 2", "2 / 2"]);
  await expect(typing).toBeVisible();
  const beforeApply = await savedPage(page);
  expect(beforeApply.header).toBe("Draft minutes");
  expect(beforeApply.pageNumbers).toBe(true);
});
