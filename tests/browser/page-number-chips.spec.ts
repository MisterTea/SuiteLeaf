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
        pageNumbers: true,
        pageNumberFormat: "page",
        pageNumberPosition: "top-right",
        pageNumberPositionSet: true,
        pageNumberStart: 1,
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

async function savedStart(page: Page) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const file = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  return file.content.attrs.pageSettings.pageNumberStart ?? 1;
}

/** Both format chips, Start at, and Apply are on screen together. */
async function chipsTogether(page: Page, fraction: string, pageLabel: string) {
  const dialog = page.getByRole("dialog", { name: "Page setup" });
  const fractionChip = dialog.getByRole("radio", { name: fraction, exact: true });
  const pageChip = dialog.getByRole("radio", { name: pageLabel, exact: true });
  const start = dialog.getByRole("spinbutton", { name: "Start at" });
  const apply = dialog.getByRole("button", { name: "Apply", exact: true });
  await expect(fractionChip).toBeInViewport();
  await expect(pageChip).toBeInViewport();
  await expect(start).toBeInViewport();
  await expect(apply).toBeInViewport();
  await expect(pageChip).toBeChecked();
  await expect(page.locator(".paginated-paper .page-number").first()).toHaveText(pageLabel);
  const clear = await page.evaluate(({ fractionText, pageText }) => {
    const box = (el: Element) => el.getBoundingClientRect();
    const dialogEl = document.querySelector(".page-setup-dialog") as HTMLElement;
    const format = [...dialogEl.querySelectorAll("fieldset")].find(
      (field) => field.querySelector("legend")?.textContent === "Format",
    ) as HTMLElement;
    const chip = (text: string) =>
      [...format.querySelectorAll("label")].find(
        (label) => label.textContent?.trim() === text,
      ) as HTMLElement;
    const fractionEl = chip(fractionText);
    const pageEl = chip(pageText);
    const startEl = dialogEl.querySelector("[aria-label='Start at']") as HTMLElement;
    const applyEl = [...dialogEl.querySelectorAll("button")].find(
      (button) => button.textContent === "Apply",
    ) as HTMLElement;
    const host = box(dialogEl);
    const inside = (el: HTMLElement) => {
      const r = box(el);
      return (
        r.width > 24 &&
        r.height > 16 &&
        r.top >= host.top - 1 &&
        r.bottom <= host.bottom + 1 &&
        r.left >= host.left - 1 &&
        r.right <= host.right + 1 &&
        r.top >= -1 &&
        r.bottom <= window.innerHeight - 1 &&
        el.scrollWidth <= el.clientWidth + 1 &&
        el.scrollHeight <= el.clientHeight + 1
      );
    };
    const overlap = (a: HTMLElement, b: HTMLElement) => {
      const ra = box(a);
      const rb = box(b);
      return (
        ra.left < rb.right - 1 &&
        ra.right > rb.left + 1 &&
        ra.top < rb.bottom - 1 &&
        ra.bottom > rb.top + 1
      );
    };
    return (
      window.innerHeight === 800 &&
      inside(fractionEl) &&
      inside(pageEl) &&
      inside(startEl) &&
      inside(applyEl) &&
      !overlap(fractionEl, pageEl) &&
      !overlap(fractionEl, startEl) &&
      !overlap(pageEl, startEl) &&
      !overlap(fractionEl, applyEl) &&
      !overlap(pageEl, applyEl) &&
      !overlap(startEl, applyEl)
    );
  }, { fractionText: fraction, pageText: pageLabel });
  expect(clear).toBe(true);
}

test("format chips follow the starting number before apply", async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openMinutes(page);
  await expect.poll(() => numbers(page)).toEqual(["Page 1", "Page 2"]);

  const dialog = await openSetup(page);
  const start = dialog.getByRole("spinbutton", { name: "Start at" });
  await expect(start).toHaveValue("1");
  await chipsTogether(page, "1 / 2", "Page 1");

  await start.fill("12");
  await expect(start).toHaveValue("12");
  await expect(dialog).toBeVisible();
  await expect.poll(() => numbers(page)).toEqual(["Page 12", "Page 13"]);
  await chipsTogether(page, "12 / 13", "Page 12");
  expect(await savedStart(page)).toBe(1);

  await start.fill("3");
  await expect(start).toHaveValue("3");
  await expect.poll(() => numbers(page)).toEqual(["Page 3", "Page 4"]);
  await chipsTogether(page, "3 / 4", "Page 3");
  expect(await savedStart(page)).toBe(1);

  await start.fill("0");
  await expect(start).toHaveValue("0");
  await expect(start).toHaveAttribute("aria-invalid", "true");
  await expect.poll(() => numbers(page)).toEqual(["Page 3", "Page 4"]);
  await chipsTogether(page, "3 / 4", "Page 3");
  await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toBeEnabled();

  await start.fill("12");
  await expect.poll(() => numbers(page)).toEqual(["Page 12", "Page 13"]);
  await chipsTogether(page, "12 / 13", "Page 12");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => numbers(page)).toEqual(["Page 12", "Page 13"]);
  expect(await savedStart(page)).toBe(12);

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Minutes" }).click();
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
    "The vote is next week.",
  );
  await expect.poll(() => numbers(page)).toEqual(["Page 12", "Page 13"]);
  const again = await openSetup(page);
  await expect(again.getByRole("spinbutton", { name: "Start at" })).toHaveValue("12");
  await chipsTogether(page, "12 / 13", "Page 12");
});
