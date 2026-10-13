import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { createFile, serializeFile, type DocFile } from "../../packages/core/src";

const inch = (n: number) => n * 96;
const longHeader =
  "Town council minutes of the Tuesday hearing, with the vote recorded for the members present";

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
        pageNumberFormat: "fraction",
        pageNumberPosition: "bottom-right",
        pageNumberPositionSet: false,
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

async function controlsTogether(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Page setup" });
  const format = dialog.getByRole("group", { name: "Format" });
  const position = dialog.getByRole("group", { name: "Position" });
  const apply = dialog.getByRole("button", { name: "Apply", exact: true });
  await expect(format).toBeInViewport();
  await expect(position).toBeInViewport();
  await expect(apply).toBeInViewport();
  const clear = await page.evaluate(() => {
    const box = (el: Element) => el.getBoundingClientRect();
    const dialogEl = document.querySelector(".page-setup-dialog") as HTMLElement;
    const formatEl = [...dialogEl.querySelectorAll("fieldset")].find(
      (field) => field.querySelector("legend")?.textContent === "Format",
    ) as HTMLElement;
    const positionEl = [...dialogEl.querySelectorAll("fieldset")].find(
      (field) => field.querySelector("legend")?.textContent === "Position",
    ) as HTMLElement;
    const applyEl = [...dialogEl.querySelectorAll("button")].find(
      (button) => button.textContent === "Apply",
    ) as HTMLElement;
    const host = box(dialogEl);
    const inside = (el: HTMLElement) => {
      const r = box(el);
      return (
        r.width > 40 &&
        r.height > 16 &&
        r.top >= host.top - 1 &&
        r.bottom <= host.bottom + 1 &&
        r.left >= host.left - 1 &&
        r.right <= host.right + 1 &&
        r.top >= -1 &&
        r.bottom <= window.innerHeight + 1
      );
    };
    return window.innerHeight === 800 && inside(formatEl) && inside(positionEl) && inside(applyEl);
  });
  expect(clear).toBe(true);
}

/** The number sits on the header row, to the right of the header, and does not cover it. */
async function clearOfHeader(page: Page) {
  const placed = await page.evaluate(() => {
    return [...document.querySelectorAll(".page-furniture-page")].map((pageEl) => {
      const header = pageEl.querySelector(".page-header") as HTMLElement | null;
      const number = pageEl.querySelector(".page-number") as HTMLElement | null;
      if (!header || !number) return null;
      const text = header.getBoundingClientRect();
      const pill = number.getBoundingClientRect();
      const sheet = pageEl.getBoundingClientRect();
      const gap = pill.left - text.right;
      return {
        header: header.textContent,
        number: number.textContent,
        side: pageEl.getAttribute("data-number-side"),
        gap,
        covers: gap < 4 && pill.bottom > text.top + 1 && pill.top < text.bottom - 1,
        sameRow: Math.abs(pill.top - text.top) < 28,
        onRight: pill.left > sheet.left + sheet.width * 0.45,
        nearTop: pill.top - sheet.top < sheet.height * 0.2,
      };
    });
  });
  expect(placed).toHaveLength(2);
  for (const face of placed) {
    expect(face).toBeTruthy();
    expect(face!.side).toBe("top-right");
    expect(face!.covers).toBe(false);
    expect(face!.gap).toBeGreaterThan(8);
    expect(face!.sameRow).toBe(true);
    expect(face!.onRight).toBe(true);
    expect(face!.nearTop).toBe(true);
  }
}

test("page number format and position show before apply", async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openMinutes(page);
  await expect.poll(() => numbers(page)).toEqual(["1 / 2", "2 / 2"]);
  await expect(page.locator(".page-furniture-page").nth(0)).toHaveAttribute(
    "data-number-side",
    "right",
  );
  await expect(page.locator(".paginated-paper .page-header").first()).toHaveText(
    "Draft minutes",
  );

  const dialog = await openSetup(page);
  await controlsTogether(page);
  await expect.poll(() => numbers(page)).toEqual(["1 / 2", "2 / 2"]);

  const fraction = dialog.getByRole("radio", { name: "1 / 2" });
  await fraction.focus();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("radio", { name: "Page 1" })).toBeChecked();
  await expect.poll(() => numbers(page)).toEqual(["Page 1", "Page 2"]);
  await expect(page.locator(".page-furniture-page").first()).toHaveAttribute(
    "data-number-side",
    "right",
  );
  await expect(dialog).toBeVisible();
  const beforePosition = await savedPage(page);
  expect(beforePosition.pageNumberFormat).toBe("fraction");
  expect(beforePosition.pageNumberPositionSet).not.toBe(true);

  await dialog.getByRole("radio", { name: "Top right" }).check();
  await expect(page.locator(".page-furniture-page").first()).toHaveAttribute(
    "data-number-side",
    "top-right",
  );
  await expect.poll(() => numbers(page)).toEqual(["Page 1", "Page 2"]);
  await controlsTogether(page);
  await dialog.getByLabel("Page header").fill(longHeader);
  await expect(page.locator(".paginated-paper .page-header").first()).toHaveText(longHeader);
  await clearOfHeader(page);
  await expect(page.locator(".page-watermark")).toHaveCount(0);
  await dialog.getByLabel("Start at").fill("4");
  await dialog.getByRole("checkbox", { name: "Cover has no number" }).check();
  await dialog.getByRole("checkbox", { name: "Different first page" }).check();
  await dialog.getByLabel("Watermark").fill("DRAFT");
  await expect.poll(() => numbers(page)).toEqual(["Page 4", "Page 5"]);
  await expect(page.locator(".page-watermark")).toHaveCount(0);
  await expect(page.locator(".paginated-paper .page-header").first()).toHaveText(longHeader);
  const unsaved = await savedPage(page);
  expect(unsaved.pageNumberFormat).toBe("fraction");
  expect(unsaved.pageNumberPositionSet).not.toBe(true);
  expect(unsaved.header).toBe("Draft minutes");
  expect(unsaved.pageNumberStart ?? 1).toBe(1);
  expect(unsaved.watermark ?? "").toBe("");

  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => numbers(page)).toEqual(["1 / 2", "2 / 2"]);
  await expect(page.locator(".page-furniture-page").first()).toHaveAttribute(
    "data-number-side",
    "right",
  );
  await expect(page.locator(".paginated-paper .page-header").first()).toHaveText(
    "Draft minutes",
  );
  const restored = await savedPage(page);
  expect(restored.pageNumberFormat).toBe("fraction");
  expect(restored.pageNumbers).toBe(true);

  const again = await openSetup(page);
  await again.getByRole("radio", { name: "Page 1" }).check();
  await again.getByRole("radio", { name: "Top right" }).check();
  await expect.poll(() => numbers(page)).toEqual(["Page 1", "Page 2"]);
  await clearOfHeader(page);
  await again.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(again).toBeHidden();
  await expect.poll(() => numbers(page)).toEqual(["Page 1", "Page 2"]);
  await clearOfHeader(page);
  const kept = await savedPage(page);
  expect(kept.pageNumberFormat).toBe("page");
  expect(kept.pageNumberPosition).toBe("top-right");
  expect(kept.pageNumberPositionSet).toBe(true);
  expect(kept.header).toBe("Draft minutes");

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Minutes" }).click();
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
    "The vote is next week.",
  );
  await expect.poll(() => numbers(page)).toEqual(["Page 1", "Page 2"]);
  await expect(page.locator(".page-furniture-page").nth(1)).toHaveAttribute(
    "data-number-side",
    "top-right",
  );
  await clearOfHeader(page);
});
