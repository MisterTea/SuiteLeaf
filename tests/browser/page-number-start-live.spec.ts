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

async function savedPage(page: Page) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const file = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  return file.content.attrs.pageSettings;
}

/** Start at, the format control, and Apply are on screen together. */
async function controlsTogether(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Page setup" });
  const format = dialog.getByRole("group", { name: "Format" });
  const start = dialog.getByRole("spinbutton", { name: "Start at" });
  const apply = dialog.getByRole("button", { name: "Apply", exact: true });
  await expect(format).toBeInViewport();
  await expect(start).toBeInViewport();
  await expect(apply).toBeInViewport();
  const clear = await page.evaluate(() => {
    const box = (el: Element) => el.getBoundingClientRect();
    const dialogEl = document.querySelector(".page-setup-dialog") as HTMLElement;
    const formatEl = [...dialogEl.querySelectorAll("fieldset")].find(
      (field) => field.querySelector("legend")?.textContent === "Format",
    ) as HTMLElement;
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
        r.bottom <= window.innerHeight + 1
      );
    };
    return window.innerHeight === 800 && inside(formatEl) && inside(startEl) && inside(applyEl);
  });
  expect(clear).toBe(true);
}

/** The number sits at the top right of its page. Returns a position the next page can match. */
async function topRightPlace(page: Page, index: number, text: string) {
  const face = page.locator(".page-furniture-page").nth(index);
  await expect(face).toHaveAttribute("data-number-side", "top-right");
  await expect(face.locator(".page-number")).toHaveText(text);
  const placed = await face.evaluate((pageEl) => {
    const number = pageEl.querySelector(".page-number") as HTMLElement;
    const sheet = pageEl.getBoundingClientRect();
    const pill = number.getBoundingClientRect();
    return {
      right: (sheet.right - pill.right) / sheet.width,
      top: (pill.top - sheet.top) / sheet.height,
    };
  });
  expect(placed.right).toBeGreaterThan(-0.02);
  expect(placed.right).toBeLessThan(0.2);
  expect(placed.top).toBeGreaterThan(-0.02);
  expect(placed.top).toBeLessThan(0.2);
  return placed;
}

test("starting number shows before apply", async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openMinutes(page);
  await expect.poll(() => numbers(page)).toEqual(["Page 1", "Page 2"]);
  const first = await topRightPlace(page, 0, "Page 1");
  const second = await topRightPlace(page, 1, "Page 2");
  expect(Math.abs(first.right - second.right)).toBeLessThan(0.04);
  expect(Math.abs(first.top - second.top)).toBeLessThan(0.04);

  const dialog = await openSetup(page);
  await controlsTogether(page);
  await expect.poll(() => numbers(page)).toEqual(["Page 1", "Page 2"]);
  const start = dialog.getByRole("spinbutton", { name: "Start at" });
  await expect(start).toHaveValue("1");
  await expect(dialog.getByRole("radio", { name: "Page 1" })).toBeChecked();

  await start.fill("12");
  await expect(start).toHaveValue("12");
  await expect.poll(() => numbers(page)).toEqual(["Page 12", "Page 13"]);
  await expect(dialog).toBeVisible();
  const startedFirst = await topRightPlace(page, 0, "Page 12");
  const startedSecond = await topRightPlace(page, 1, "Page 13");
  expect(Math.abs(startedFirst.right - first.right)).toBeLessThan(0.04);
  expect(Math.abs(startedFirst.top - first.top)).toBeLessThan(0.04);
  expect(Math.abs(startedSecond.right - second.right)).toBeLessThan(0.04);
  expect(Math.abs(startedSecond.top - second.top)).toBeLessThan(0.04);
  const unsaved = await savedPage(page);
  expect(unsaved.pageNumberStart ?? 1).toBe(1);

  await start.fill("0");
  await expect(start).toHaveValue("0");
  await expect(start).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.locator("#page-numbers-hint")).toHaveText(
    "Numbering starts at 1 or later. The page stays on Page 12.",
  );
  await expect.poll(() => numbers(page)).toEqual(["Page 12", "Page 13"]);
  await controlsTogether(page);
  await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toBeEnabled();

  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => numbers(page)).toEqual(["Page 1", "Page 2"]);
  const restored = await savedPage(page);
  expect(restored.pageNumberStart ?? 1).toBe(1);
  expect(restored.pageNumberFormat).toBe("page");

  const again = await openSetup(page);
  await again.getByRole("spinbutton", { name: "Start at" }).fill("12");
  await expect.poll(() => numbers(page)).toEqual(["Page 12", "Page 13"]);
  await again.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(again).toBeHidden();
  await expect.poll(() => numbers(page)).toEqual(["Page 12", "Page 13"]);
  const kept = await savedPage(page);
  expect(kept.pageNumberStart).toBe(12);
  expect(kept.pageNumberFormat).toBe("page");
  expect(kept.pageNumberPosition).toBe("top-right");

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Minutes" }).click();
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
    "The vote is next week.",
  );
  await expect.poll(() => numbers(page)).toEqual(["Page 12", "Page 13"]);
  await topRightPlace(page, 0, "Page 12");
  await topRightPlace(page, 1, "Page 13");
});
