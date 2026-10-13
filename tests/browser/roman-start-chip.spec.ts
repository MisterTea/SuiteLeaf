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

async function savedNumbers(page: Page) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const file = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  const settings = file.content.attrs.pageSettings;
  return {
    start: settings.pageNumberStart ?? 1,
    format: settings.pageNumberFormat ?? "fraction",
  };
}

test("the roman chip follows the starting number before apply", async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openMinutes(page);
  await expect.poll(() => numbers(page)).toEqual(["Page 1", "Page 2"]);

  const dialog = await openSetup(page);
  const start = dialog.getByRole("spinbutton", { name: "Start at" });
  await expect(start).toHaveValue("1");
  await expect(dialog.getByRole("radio", { name: "1 / 2", exact: true })).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "Page 1", exact: true })).toBeChecked();
  await expect(dialog.getByRole("radio", { name: "i, ii", exact: true })).toBeVisible();

  await start.fill("4");
  await expect(start).toHaveValue("4");
  await expect(dialog).toBeVisible();
  const romanAtFour = dialog.getByRole("radio", { name: "iv, v", exact: true });
  await expect(romanAtFour).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "4 / 5", exact: true })).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "Page 4", exact: true })).toBeChecked();
  await expect.poll(() => numbers(page)).toEqual(["Page 4", "Page 5"]);
  expect(await savedNumbers(page)).toEqual({ start: 1, format: "page" });

  await romanAtFour.check();
  await expect(romanAtFour).toBeChecked();
  await expect(dialog).toBeVisible();
  await expect.poll(() => numbers(page)).toEqual(["iv", "v"]);
  expect(await savedNumbers(page)).toEqual({ start: 1, format: "page" });

  await start.fill("12");
  await expect(start).toHaveValue("12");
  const romanAtTwelve = dialog.getByRole("radio", { name: "xii, xiii", exact: true });
  await expect(romanAtTwelve).toBeChecked();
  await expect(dialog.getByRole("radio", { name: "12 / 13", exact: true })).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "Page 12", exact: true })).toBeVisible();
  await expect.poll(() => numbers(page)).toEqual(["xii", "xiii"]);

  await start.fill("0");
  await expect(start).toHaveValue("0");
  await expect(start).toHaveAttribute("aria-invalid", "true");
  await expect(romanAtTwelve).toBeChecked();
  await expect.poll(() => numbers(page)).toEqual(["xii", "xiii"]);
  await expect(dialog.locator("#page-numbers-hint")).toHaveText(
    "Numbering starts at 1 or later. The page stays on xii.",
  );
  await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toBeEnabled();

  await start.fill("4");
  await expect(dialog.getByRole("radio", { name: "iv, v", exact: true })).toBeChecked();
  await expect(dialog.getByRole("radio", { name: "4 / 5", exact: true })).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "Page 4", exact: true })).toBeVisible();
  await expect.poll(() => numbers(page)).toEqual(["iv", "v"]);
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => numbers(page)).toEqual(["iv", "v"]);
  expect(await savedNumbers(page)).toEqual({ start: 4, format: "roman" });

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Minutes" }).click();
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
    "The hearing opens at seven.",
  );
  await expect.poll(() => numbers(page)).toEqual(["iv", "v"]);
  const again = await openSetup(page);
  await expect(again.getByRole("spinbutton", { name: "Start at" })).toHaveValue("4");
  await expect(again.getByRole("radio", { name: "iv, v", exact: true })).toBeChecked();
  await expect(again.getByRole("radio", { name: "4 / 5", exact: true })).toBeVisible();
  await expect(again.getByRole("radio", { name: "Page 4", exact: true })).toBeVisible();
});
